// Saving ink through `mdeck run` (src/build/inkPlugin.js). When the page was
// served by a dev server that lets it save, the controller's changes go
// there, batched, and changes from other windows arrive as `mdeck:ink`.
// Anywhere else (a built deck, a device that may not save) this returns false
// and the ink stays in this browser.
import { replaceInk, renameSlide } from './store.js'
import { retryDelay } from './outbox.js'
import { pairHeaders } from '../../live/pairing.js'
import { devPath } from '../../core/devPath.js'

const BASE = devPath('__mdeck/ink')
const NOTICE_MS = 6000

// A short line over the slide, as the presenter view shows its problems.
function notice(text) {
  if (typeof document === 'undefined') return
  const note = document.querySelector('.ink-notice') ?? document.body.appendChild(Object.assign(document.createElement('div'), { className: 'ink-notice', role: 'alert' }))
  note.textContent = text
  Object.assign(note.style, { position: 'fixed', left: '50%', top: '12px', transform: 'translateX(-50%)', zIndex: 18, maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box', padding: '8px 14px', borderRadius: '12px', background: 'rgba(17,17,17,0.94)', border: '1px solid #5c2b28', color: '#f28b82', fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: '14px', pointerEvents: 'none' })
  clearTimeout(notice.timer)
  notice.timer = setTimeout(() => note.remove(), NOTICE_MS)
}

// A paired iPad sends its token; this computer needs none.
export async function connectInkServer(controller, { headers = () => pairHeaders() } = {}) {
  let response
  try { response = await fetch(BASE, { cache: 'no-store', headers: headers() }) } catch { return false }
  if (!response.ok) return false
  let { ink, deckHash } = await response.json()

  // Changes made in this browser before the server was there go to it first.
  const earlier = controller.localChanges()
  replaceInk(ink)
  let queue = [], sending = false, stale = false
  // Failed attempts in a row; the next one waits longer after each (outbox.js).
  let failures = 0, retry = null

  async function refresh() {
    if (sending || queue.length) { stale = true; return }
    try {
      const fresh = await (await fetch(BASE, { cache: 'no-store', headers: headers() })).json()
      if (sending || queue.length) { stale = true; return }
      deckHash = fresh.deckHash
      replaceInk(fresh.ink)
    } catch {}
  }

  async function flush() {
    if (sending || retry || !queue.length) return
    sending = true
    const ops = queue
    queue = []
    try {
      const reply = await fetch(`${BASE}/ops`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify({ deckHash, ops }) })
      const body = await reply.json().catch(() => ({}))
      failures = 0
      if (reply.ok) {
        deckHash = body.deckHash
        // A slide got its id with this stroke: the audience window and other
        // devices must use it too, or later strokes, the laser and the zoom
        // would name a slide they do not know.
        for (const { from, to } of body.renamed ?? []) { renameSlide(from, to); controller.share({ type: 'rename', from, to }) }
      } else {
        // The deck changed under this page: take the server's ink, and say
        // so, as what was just drawn goes with it.
        console.warn('mdeck: ink not saved:', body.error ?? reply.status)
        notice(`Drawing not saved: ${body.error ?? reply.status}`)
        stale = true
      }
    } catch (error) {
      console.warn('mdeck: ink not saved:', error.message)
      queue = [...ops, ...queue]
      failures++
    } finally {
      sending = false
    }
    if (queue.length && failures) retry = setTimeout(() => { retry = null; flush() }, retryDelay(failures))
    else if (queue.length) flush()
    else if (stale) { stale = false; refresh() }
  }

  const save = op => {
    queue.push(op)
    queueMicrotask(flush)
  }
  controller.useServer(save)
  for (const op of earlier) controller.replay(op)

  import.meta.hot?.on('mdeck:ink', ({ renamed = [] } = {}) => {
    for (const { from, to } of renamed) renameSlide(from, to)
    refresh()
  })
  return true
}

/**
 * A window that only shows ink (the audience window) follows the drawings
 * file too, not only the live messages: a change it missed there (a request
 * the stage room refused, a gap in the network) is put right with the next
 * save. Pages this server does not let read the ink keep the live messages.
 */
export function followInkFile({ headers = () => pairHeaders(), hot = import.meta.hot } = {}) {
  if (!hot) return
  let reading = null, again = false
  async function read() {
    if (reading) { again = true; return }
    reading = (async () => {
      try {
        const response = await fetch(BASE, { cache: 'no-store', headers: headers() })
        if (response.ok) replaceInk((await response.json()).ink)
      } catch {}
    })()
    await reading
    reading = null
    if (again) { again = false; read() }
  }
  hot.on('mdeck:ink', ({ renamed = [] } = {}) => {
    for (const { from, to } of renamed) renameSlide(from, to)
    read()
  })
  // What was saved before this window opened.
  read()
}
