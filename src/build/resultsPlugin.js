// Keeping the answers while `mdeck run` runs: the presenter's screens send
// each activity's answers as they come in (src/live/client.js), and they go
// into <deck>.results.json beside the deck (src/core/results.js).
//
//   POST /__mdeck/results   { room, closed, answers, solution? } → { ok }
//
// Answers of none take the room out of the file, as Reset does. Writes wait
// a moment, so a burst of votes is one write, and do not reload the open
// windows (ownWrites.js).
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { resultsFileFor, normalizeResults, withRoom, serializeResults } from '../core/results.js'
import { isAllowedRequest, send, readJson } from './editorPlugin.js'
import { markOwnWrite } from './ownWrites.js'

export function createResultsFile(deckPath, { debounceMs = 500 } = {}) {
  const path = resultsFileFor(resolve(deckPath))
  let results = null, timer = null

  const current = () => {
    if (results) return results
    try { results = existsSync(path) ? normalizeResults(JSON.parse(readFileSync(path, 'utf8'))) : normalizeResults({}) }
    catch { results = normalizeResults({}) }
    return results
  }

  function flushPending() { if (timer) flush() }

  function flush() {
    clearTimeout(timer)
    timer = null
    if (!results) return
    // A deck that never kept answers gets no empty file.
    if (!Object.keys(results.rooms).length && !existsSync(path)) return
    const text = serializeResults(results)
    markOwnWrite(path, text)
    const temp = `${path}.${process.pid}.tmp`
    writeFileSync(temp, text, 'utf8')
    renameSync(temp, path)
  }

  return {
    path,
    read: current,
    save(room, entry) {
      results = withRoom(current(), room, entry)
      clearTimeout(timer)
      timer = setTimeout(flush, debounceMs)
    },
    // Drops one room's answers, or all of them (the file goes), from the
    // launch page. Answers still waiting are written first, then the file is
    // read again, so edits by hand count; an open poll that gets another
    // answer keeps its room again.
    drop(room = null) {
      flush()
      results = null
      if (room !== null) results = withRoom(current(), room, { answers: [] })
      if (room !== null && Object.keys(results.rooms).length) return flush()
      results = normalizeResults({})
      if (existsSync(path)) unlinkSync(path)
    },
    flush,
    flushPending,
  }
}

export function resultsMiddleware(file, { authorize = isAllowedRequest } = {}) {
  return async (request, response, next) => {
    const { pathname } = new URL(request.url, 'http://localhost')
    if (pathname !== '/') return next()
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); return send(response, 405, { error: 'Method not allowed' }) }
    if (!authorize(request)) return send(response, 403, { error: 'Only the presenter keeps the results' })
    try {
      const { room, closed, answers, solution } = await readJson(request)
      file.save(String(room ?? ''), { closed, answers, solution })
      return send(response, 200, { ok: true })
    } catch (error) {
      return send(response, error.status ?? 500, { error: error.message })
    }
  }
}

// `api.file` lets the launch page drop answers through the same file.
export function resultsPlugin(slidesPath, { authorize } = {}) {
  const file = createResultsFile(slidesPath)
  return {
    name: 'vite-plugin-mdeck-results',
    api: { file },
    configureServer(server) {
      server.middlewares.use('/__mdeck/results', resultsMiddleware(file, { authorize }))
      server.httpServer?.once('close', () => file.flush())
    },
  }
}
