// How a window that only shows ink (the audience window) follows the
// drawings file: it reads it when it opens and again after every save, so a
// change it missed live is put right.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { applyOp, emptyInk } from '../src/core/ink.js'

register('data:text/javascript,' + encodeURIComponent(`
  export const resolve = (specifier, context, next) => specifier === 'virtual:deck-ink' ? { url: 'virtual:deck-ink', shortCircuit: true } : next(specifier, context)
  export const load = (url, context, next) => url === 'virtual:deck-ink'
    ? { format: 'module', shortCircuit: true, source: 'export default { version: 1, width: 1920, height: 1080, slides: {} }; export const inkFileName = "talk.drawings.json"' }
    : next(url, context)
`))
globalThis.window = { location: { href: 'http://localhost/' } }
globalThis.document = { querySelectorAll: () => [] }
globalThis.CSS = { escape: s => s }
const { followInkFile } = await import('../src/runtime/ink/server.js')
const { changeInk, slideStrokes } = await import('../src/runtime/ink/store.js')

const stroke = (id, x = 10) => ({ id, tool: 'pen', color: '#e11d48', size: 6, points: [[x, 10, 0.5], [90, 40, 0.6]] })
const settle = () => new Promise(done => setImmediate(done))

test('a window that only shows ink follows the saved drawings, and a move it missed live is put right', async () => {
  const handlers = {}
  let saved = applyOp(emptyInk(), { type: 'add', slideId: 'w', stroke: stroke('c:1', 10) })
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ink: saved, deckHash: 'first' }) })
  followInkFile({ headers: () => ({}), hot: { on: (name, handler) => { handlers[name] = handler } } })
  await settle()
  assert.equal(slideStrokes('w')[0].points[0][0], 10, 'what was saved before the window opened')
  // The move never arrived live; the presenter's save names no changes.
  saved = applyOp(saved, { type: 'add', slideId: 'w', stroke: stroke('c:1', 300) })
  handlers['mdeck:ink']({ renamed: [] })
  await settle()
  assert.equal(slideStrokes('w')[0].points[0][0], 300, 'the stroke moved, as saved')
})

test('a page the server does not let read the ink keeps what it has', async () => {
  changeInk({ type: 'add', slideId: 'p', stroke: stroke('d:1') })
  const before = slideStrokes('p')
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'no' }) })
  followInkFile({ headers: () => ({}), hot: { on: () => {} } })
  await settle()
  assert.equal(slideStrokes('p'), before)
})
