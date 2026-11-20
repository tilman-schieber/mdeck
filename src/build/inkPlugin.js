// Saving ink while `mdeck run` runs: the file beside the deck is the source of
// truth, and devices send changes as operations (see applyOp in core/ink.js),
// so strokes drawn on two devices at once never overwrite each other.
//
//   GET  /__mdeck/ink        { ink, deckHash }
//   POST /__mdeck/ink/ops    { deckHash, ops } → { deckHash, renamed }
//
// A slide that gets ink but has no `id:` of its own gets one, written into
// its settings, so the ink stays with it when slides are inserted. Ids by
// position (slide-3) are only trusted when the device saw the current deck
// (deckHash); otherwise the answer is 409 and the device reloads. The server's
// own writes do not reload the open windows (ownWrites.js); instead it sends
// `mdeck:ink`, and the pages fetch the ink again.
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { parseSlides } from '../core/parseSlides.js'
import { setSlideMeta } from '../core/editDeck.js'
import { slideTitle } from '../core/outline.js'
import { slug } from '../live/code.js'
import { inkFileFor, normalizeInk, emptyInk, applyOp, serializeInk, isSlideId, isPageId, baseSlideId, pickInk } from '../core/ink.js'
import { hashSource, isAllowedRequest, send, readJson, BACKUP_DIR } from './editorPlugin.js'
import { markOwnWrite } from './ownWrites.js'
import { expandDeck } from './include.js'

const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/
const BACKUPS_KEPT = 10
// What one request may carry; a stroke has a few hundred points at most.
const MAX_OPS = 1000
const MAX_POINTS = 10000
const MAX_IDS = 10000
const OP_TYPES = ['add', 'remove', 'clear', 'room', 'page']

// Why a request's changes cannot be taken, or null when they are well formed.
function badOps(ops) {
  if (!Array.isArray(ops)) return 'ops must be a list'
  if (ops.length > MAX_OPS) return `At most ${MAX_OPS} changes per request`
  for (const op of ops) {
    if (!op || typeof op !== 'object' || !OP_TYPES.includes(op.type)) return 'Unknown change'
    if (!isSlideId(op.slideId)) return 'Not a slide id'
    if (op.type === 'add' && (!op.stroke || typeof op.stroke !== 'object' || !Array.isArray(op.stroke.points) || op.stroke.points.length > MAX_POINTS)) return `A stroke has at most ${MAX_POINTS} points`
    if (op.type === 'room' && typeof op.open !== 'boolean') return 'A room is open or not'
    if (op.type === 'page' && !isPageId(op.page)) return 'Not a page id'
    if ((op.type === 'remove' || op.type === 'clear') && (!Array.isArray(op.ids) || op.ids.length > MAX_IDS)) return `At most ${MAX_IDS} strokes per change`
  }
  return null
}

function writeAtomic(path, text) {
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, text, 'utf8')
  renameSync(temp, path)
}

// A readable, unique id from the slide's heading, as ids must start with a letter.
function newSlideId(deck, slide, index) {
  const taken = new Set(deck.slides.map(s => s.id))
  let base = slug(slideTitle(slide, index, null)) || 'slide'
  if (!/^[a-z]/.test(base)) base = `slide-${base}`
  let id = base, n = 2
  while (taken.has(id) || !ID_RE.test(id)) id = `${base}-${n++}`
  return id
}

export function createInkFile(deckPath, { debounceMs = 300, onChange = () => {} } = {}) {
  const abs = resolve(deckPath)
  const inkPath = inkFileFor(abs)
  let ink = null, timer = null, backedUp = false
  // Ids given to slides, for devices that still saw the deck from before:
  // { from, to, before } applies only to requests made against `before`.
  const renames = []
  let knownIds = null

  const readDeck = () => { const source = readFileSync(abs, 'utf8'); return { source, deck: parseSlides(source), hash: hashSource(source) } }
  const size = deck => ({ width: deck.deckConfig?.width ?? 1920, height: deck.deckConfig?.height ?? 1080 })

  // The file on disk, unless changes are still waiting to be written.
  function current(deck) {
    if (timer && ink) return ink
    try { ink = existsSync(inkPath) ? normalizeInk(JSON.parse(readFileSync(inkPath, 'utf8')), size(deck)) : emptyInk(size(deck)) }
    catch { ink ??= emptyInk(size(deck)) }
    return ink
  }

  function backupOnce() {
    if (backedUp || !existsSync(inkPath)) { backedUp = true; return }
    const dir = resolve(dirname(abs), BACKUP_DIR)
    mkdirSync(dir, { recursive: true })
    const name = basename(inkPath, '.json')
    writeFileSync(resolve(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z')}.json`), readFileSync(inkPath))
    const copies = readdirSync(dir).filter(entry => entry.startsWith(`${name}-`) && entry.endsWith('.json')).sort()
    for (const old of copies.slice(0, -BACKUPS_KEPT)) unlinkSync(resolve(dir, old))
    backedUp = true
  }

  // Writes what waits for the debounce, and nothing when nothing does: a
  // deck that was only shown gets no drawings file (nor a backup) on Ctrl+C.
  function flushPending() { if (timer) flush() }

  function flush() {
    clearTimeout(timer)
    timer = null
    if (!ink) return
    backupOnce()
    const text = serializeInk(ink)
    markOwnWrite(inkPath, text)
    writeAtomic(inkPath, text)
  }

  // A slide whose `id:` was changed in the editor or by hand, at the same
  // place in a deck with the same number of slides, keeps its ink. Ink of a
  // removed slide stays in the file (mdeck check reports it), so undoing the
  // removal brings it back.
  function deckChanged() {
    let deck
    try { deck = readDeck().deck } catch { return [] }
    const ids = deck.slides.map(slide => slide.id)
    const before = knownIds
    knownIds = ids
    if (!before || before.length !== ids.length) return []
    current(deck)
    const moved = []
    ids.forEach((id, i) => {
      const from = before[i]
      if (from !== id && !ids.includes(from) && !before.includes(id) && (ink.slides[from] || ink.rooms[from] || ink.pages[from])) {
        ink = applyOp(ink, { type: 'rename', from, to: id })
        moved.push({ from, to: id })
      }
    })
    if (moved.length) flush()
    return moved
  }
  try { knownIds = readDeck().deck.slides.map(slide => slide.id) } catch {}

  return {
    path: inkPath,
    deckChanged,
    read() {
      const { deck, hash } = readDeck()
      return { ink: current(deck), deckHash: hash }
    },
    apply(ops, deckHash) {
      const problem = badOps(ops)
      if (problem) return { status: 400, error: problem }
      let { source, deck, hash } = readDeck()
      current(deck)
      const renamed = []
      // The changes before a refused one stay applied and get written.
      let applied = false
      const schedule = () => { clearTimeout(timer); timer = setTimeout(flush, debounceMs) }
      const refuse = error => {
        if (applied) { knownIds = deck.slides.map(slide => slide.id); schedule(); onChange({ renamed }) }
        return { status: 409, error, deckHash: hash }
      }
      const seen = deckHash
      const alias = new Map(renames.filter(r => r.before === seen).map(r => [r.from, r.to]))
      // The slides of files the deck includes (include.js) are not in its
      // text; their ids carry their file's name and stay where they are.
      let fromIncludes = null
      const included = id => {
        if (!fromIncludes) {
          try { fromIncludes = new Set(Object.entries(expandDeck(abs, { source }).origins ?? {}).filter(([, origin]) => origin.file !== abs).map(([shown]) => shown)) } catch { fromIncludes = new Set() }
        }
        return fromIncludes.has(id)
      }
      for (const raw of ops) {
        // A blank page's strokes (intro#p4k2) belong to their slide.
        const base = baseSlideId(raw.slideId)
        const layer = raw.slideId.slice(base.length)
        const op = { ...raw, slideId: (alias.get(base) ?? base) + layer }
        if (op.type === 'add' || (op.type === 'room' && op.open) || (op.type === 'page' && !op.remove)) {
          const slideId = baseSlideId(op.slideId)
          const index = deck.slides.findIndex(slide => slide.id === slideId)
          if (index < 0 && !included(slideId)) return refuse(`No slide "${slideId}" in the deck any more`)
          const slide = deck.slides[index]
          if (slide && slide.meta.id == null) {
            // An id by position: only trusted for the deck the device saw.
            if (deckHash !== hash) return refuse('The deck changed; reload')
            const id = newSlideId(deck, slide, index)
            renames.push({ from: slideId, to: id, before: hash })
            source = setSlideMeta(deck, slideId, { id })
            markOwnWrite(abs, source)
            writeAtomic(abs, source)
            deck = parseSlides(source)
            hash = hashSource(source)
            deckHash = hash
            ink = applyOp(ink, { type: 'rename', from: slideId, to: id })
            renamed.push({ from: slideId, to: id })
            alias.set(slideId, id)
            op.slideId = id + layer
          }
        }
        ink = applyOp(ink, op)
        applied = true
      }
      knownIds = deck.slides.map(slide => slide.id)
      schedule()
      onChange({ renamed })
      return { status: 200, deckHash: hash, renamed }
    },
    // Drops one slide's drawings, or all of them, from the launch page; the
    // open windows fetch the ink again. Like any write, it keeps the
    // session's backup first.
    drop(slideId = null) {
      let deck
      try { deck = readDeck().deck } catch { deck = { deckConfig: {} } }
      current(deck)
      // A slide's drawings are its own, its room and its blank pages.
      const has = id => [ink.slides, ink.rooms, ink.pages].some(map => Object.keys(map).some(key => id === null || baseSlideId(key) === id))
      if (!has(slideId)) return
      ink = slideId === null ? emptyInk(size(deck)) : pickInk(ink, id => id !== slideId)
      flush()
      onChange({ renamed: [] })
    },
    flush,
    flushPending,
  }
}

// `authorize(request)` may allow requests beyond this computer (pairing).
export function inkMiddleware(file, { authorize = isAllowedRequest } = {}) {
  return async (request, response, next) => {
    const { pathname } = new URL(request.url, 'http://localhost')
    if (pathname !== '/' && pathname !== '/ops') return next()
    if (!authorize(request)) return send(response, 403, { error: 'Only the presenter can change the ink' })
    try {
      if (pathname === '/' && request.method === 'GET') return send(response, 200, file.read())
      if (pathname === '/ops' && request.method === 'POST') {
        const { deckHash, ops } = await readJson(request)
        const result = file.apply(ops, deckHash)
        return send(response, result.status, result)
      }
      response.setHeader('Allow', pathname === '/' ? 'GET' : 'POST')
      return send(response, 405, { error: 'Method not allowed' })
    } catch (error) {
      return send(response, error.status ?? 500, { error: error.message })
    }
  }
}

// `api.file` lets the launch page drop drawings through the same file.
export function inkPlugin(slidesPath, { authorize } = {}) {
  let ws = null
  const file = createInkFile(slidesPath, { onChange: ({ renamed }) => ws?.send('mdeck:ink', { renamed }) })
  return {
    name: 'vite-plugin-mdeck-ink',
    api: { file },
    configureServer(server) {
      ws = server.ws
      server.middlewares.use('/__mdeck/ink', inkMiddleware(file, { authorize }))
      server.watcher.on('change', changed => {
        if (resolve(changed) !== resolve(slidesPath)) return
        const renamed = file.deckChanged()
        if (renamed.length) server.ws.send('mdeck:ink', { renamed })
      })
      server.httpServer?.once('close', () => file.flush())
    },
  }
}
