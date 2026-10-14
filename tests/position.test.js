import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createPositionFile, positionFileFor, positionPlugin } from '../src/build/positionFile.js'
import { livePlugin } from '../src/live/server.js'
import { createServer } from 'node:http'

const deckIn = () => resolve(mkdtempSync(resolve(tmpdir(), 'mdeck-position-')), 'talk.md')

test('the slide the talk was on is kept beside the deck and found again by its id', () => {
  const deck = deckIn()
  let slides = ['intro', 'forces', 'energy']
  const file = createPositionFile(deck, { slides: () => slides, debounceMs: 0 })
  assert.equal(positionFileFor(deck), deck.replace(/\.md$/, '.position.json'))
  assert.equal(file.resume(), null, 'nothing kept yet: the first slide')
  file.save('energy')
  file.flush()
  assert.deepEqual(JSON.parse(readFileSync(file.path, 'utf8')), { slide: 'energy' })
  const again = createPositionFile(deck, { slides: () => slides })
  assert.deepEqual(again.resume(), { slideId: 'energy', index: 2 })
  slides = ['intro', 'new', 'forces', 'energy']
  assert.deepEqual(again.resume(), { slideId: 'energy', index: 3 }, 'a slide added before it')
  slides = ['intro', 'forces']
  assert.equal(again.resume(), null, 'a slide the deck no longer has opens the first one')
})

test('dropping the slide kept removes the file', () => {
  const deck = deckIn()
  writeFileSync(positionFileFor(deck), '{"slide":"b"}\n')
  const file = createPositionFile(deck, { slides: () => ['a', 'b'] })
  assert.deepEqual(file.resume(), { slideId: 'b', index: 1 })
  file.drop()
  assert.equal(existsSync(file.path), false)
  assert.equal(file.resume(), null)
})

const serve = async (t, use) => {
  const server = createServer((request, response) => use(request, response, () => { response.writeHead(404); response.end() }))
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => server.close())
  return `http://localhost:${server.address().port}`
}
const mounted = plugin => { let use; plugin.configureServer({ middlewares: { use: (_, fn) => { use = fn } }, httpServer: null }); return use }

test('the stage room saves slide changes, not windows that open, and moves nobody after a restart', async t => {
  const deck = deckIn()
  writeFileSync(positionFileFor(deck), '{"slide":"b"}\n')
  const position = createPositionFile(deck, { slides: () => ['a', 'b', 'c'], debounceMs: 0 })
  const room = `${await serve(t, mounted(livePlugin({ position, session: () => 'deck' })))}/rooms/deck.stage`
  const state = async () => { const response = await fetch(`${room}/events`); const reader = response.body.getReader(); let text = ''; while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value); reader.cancel(); return JSON.parse(text.match(/^data: (.*)$/m)[1]).state }
  const post = body => fetch(`${room}/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: body }) })

  assert.equal(await state(), null, 'nothing moves on its own')
  await post({ index: 0, step: -1, slideId: 'a', at: 0, screen: 'opened' })
  position.flush()
  assert.deepEqual(JSON.parse(readFileSync(position.path, 'utf8')), { slide: 'b' }, 'a window that opens is no slide change')
  await post({ index: 2, step: 0, slideId: 'c', at: Date.now(), screen: 'laptop' })
  position.flush()
  assert.deepEqual(JSON.parse(readFileSync(position.path, 'utf8')), { slide: 'c' }, 'a slide change is kept')
})

test('the presenter view asks where the talk was, on this computer or a paired iPad', async t => {
  const deck = deckIn()
  writeFileSync(positionFileFor(deck), '{"slide":"c"}\n')
  const position = createPositionFile(deck, { slides: () => ['a', 'b', 'c'] })
  const base = await serve(t, mounted(positionPlugin(position, { authorize: request => request.headers.authorization === 'Bearer ipad' })))
  assert.equal((await fetch(`${base}/`)).status, 403)
  assert.deepEqual(await (await fetch(`${base}/`, { headers: { Authorization: 'Bearer ipad' } })).json(), { slideId: 'c', index: 2 })
  position.drop()
  assert.deepEqual(await (await fetch(`${base}/`, { headers: { Authorization: 'Bearer ipad' } })).json(), { slideId: null })
})
