// The slide the talk was on, kept in <deck>.position.json beside the deck
// while `mdeck run` runs. After a restart the presenter view offers to go
// on there, at the slide's start; nothing moves on its own. The stage room
// (src/live/server.js) saves every slide change. The slide is found again
// by its id, so slides added before it do not matter; a slide the deck no
// longer has is not offered.
//
//   { "slide": "<slide id>" }
//
//   GET /__mdeck/position   → { slideId, index } or { slideId: null }
//
// The launch page drops it.
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { markOwnWrite } from './ownWrites.js'
import { isAllowedRequest, send } from './editorPlugin.js'

export const positionFileFor = deckPath => String(deckPath).replace(/\.md$/i, '') + '.position.json'

/** `slides()` gives the ids of the deck's slides as shown, in order. */
export function createPositionFile(deckPath, { slides = () => [], debounceMs = 500 } = {}) {
  const path = positionFileFor(resolve(deckPath))
  let kept, timer = null

  const read = () => {
    if (kept !== undefined) return kept
    try { kept = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8'))?.slide ?? null : null } catch { kept = null }
    if (typeof kept !== 'string') kept = null
    return kept
  }

  function flush() {
    clearTimeout(timer)
    timer = null
    if (kept == null) return
    const text = JSON.stringify({ slide: kept }) + '\n'
    try { if (existsSync(path) && readFileSync(path, 'utf8') === text) return } catch {}
    markOwnWrite(path, text)
    const temp = `${path}.${process.pid}.tmp`
    writeFileSync(temp, text, 'utf8')
    renameSync(temp, path)
  }

  return {
    path,
    /** The slide kept, as { slideId, index } in the deck as shown, or null. */
    resume() {
      const slideId = read()
      if (!slideId) return null
      let ids
      try { ids = slides() } catch { return null }
      const index = ids.indexOf(slideId)
      return index > 0 ? { slideId, index } : null
    },
    save(slideId) {
      if (typeof slideId !== 'string' || !slideId || slideId === read()) return
      kept = slideId
      clearTimeout(timer)
      timer = setTimeout(flush, debounceMs)
    },
    // From the launch page: nothing to go on from.
    drop() {
      clearTimeout(timer)
      timer = null
      kept = null
      if (existsSync(path)) unlinkSync(path)
    },
    flush,
  }
}

// For the presenter view, on this computer or a paired iPad.
export function positionPlugin(file, { authorize = isAllowedRequest } = {}) {
  return {
    name: 'vite-plugin-mdeck-position',
    configureServer(server) {
      server.middlewares.use('/__mdeck/position', (request, response, next) => {
        if (request.method !== 'GET' || new URL(request.url, 'http://localhost').pathname !== '/') return next()
        if (!authorize(request)) return send(response, 403, { error: 'Only the presenter goes on where the talk was' })
        return send(response, 200, file.resume() ?? { slideId: null })
      })
    },
  }
}
