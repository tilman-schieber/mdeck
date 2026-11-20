import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createInkFile, inkMiddleware } from '../src/build/inkPlugin.js'
import { hashSource } from '../src/build/editorPlugin.js'
import { isOwnWrite } from '../src/build/ownWrites.js'
import { inkFileFor } from '../src/core/ink.js'

const stroke = id => ({ id, tool: 'pen', color: '#e11d48', size: 6, points: [[10, 10, 0.5], [90, 40, 0.6]] })
function deckWith(source) {
  const dir = mkdtempSync(resolve(tmpdir(), 'mdeck-ink-api-'))
  const deck = resolve(dir, 'talk.md')
  writeFileSync(deck, source)
  return { dir, deck, file: createInkFile(deck, { debounceMs: 5 }) }
}
const SOURCE = '---\ntheme: neue\n---\n\n---\n# The important part\n\n- one\n\n---\n# Second\n'

test('the first stroke on a slide without an id gives it one from its heading', () => {
  const { deck, file } = deckWith(SOURCE)
  const { deckHash } = file.read()
  const result = file.apply([{ type: 'add', slideId: 'slide-1', stroke: stroke('ipad:1') }], deckHash)
  assert.equal(result.status, 200)
  assert.deepEqual(result.renamed, [{ from: 'slide-1', to: 'the-important-part' }])
  const source = readFileSync(deck, 'utf8')
  assert.match(source, /id: the-important-part/)
  assert.equal(source.replace(/:::meta\nid: the-important-part\n:::\n/, ''), SOURCE, 'nothing else in the deck changed')
  assert.ok(isOwnWrite(deck, source), 'marked as mdeck\'s own write, so it does not reload the windows')
  assert.equal(result.deckHash, hashSource(source))
  file.flush()
  const saved = JSON.parse(readFileSync(inkFileFor(deck), 'utf8'))
  assert.deepEqual(Object.keys(saved.slides), ['the-important-part'])
  assert.ok(isOwnWrite(inkFileFor(deck), readFileSync(inkFileFor(deck), 'utf8')))
})

test('an id by position is refused when the deck changed since the device saw it', () => {
  const { deck, file } = deckWith(SOURCE)
  const { deckHash } = file.read()
  writeFileSync(deck, SOURCE.replace('# Second', '# Inserted\n\n---\n# Second'))
  const result = file.apply([{ type: 'add', slideId: 'slide-2', stroke: stroke('ipad:1') }], deckHash)
  assert.equal(result.status, 409)
  assert.doesNotMatch(readFileSync(deck, 'utf8'), /id:/)
})

test('two devices drawing at once keep both strokes, and clear keeps what it did not know', () => {
  const { file } = deckWith('---\ntheme: neue\n---\n\n---\nid: s\n---\n# S\n')
  const { deckHash } = file.read()
  file.apply([{ type: 'add', slideId: 's', stroke: stroke('ipad:1') }], deckHash)
  file.apply([{ type: 'add', slideId: 's', stroke: stroke('laptop:1') }], 'an older view of the deck')
  file.apply([{ type: 'clear', slideId: 's', ids: ['ipad:1'] }], deckHash)
  assert.deepEqual(file.read().ink.slides.s.map(s => s.id), ['laptop:1'])
})

test('a device with the view from before a rename still reaches the renamed slide', () => {
  const { file } = deckWith(SOURCE)
  const before = file.read().deckHash
  file.apply([{ type: 'add', slideId: 'slide-1', stroke: stroke('ipad:1') }], before)
  const late = file.apply([{ type: 'add', slideId: 'slide-1', stroke: stroke('laptop:1') }], before)
  assert.equal(late.status, 200)
  assert.deepEqual(file.read().ink.slides['the-important-part'].map(s => s.id), ['ipad:1', 'laptop:1'])
  assert.equal(file.apply([{ type: 'add', slideId: 'nowhere', stroke: stroke('x:1') }], late.deckHash).status, 409)
})

test('ink follows a slide whose id is changed by hand, and stays when the slide is removed', () => {
  const { deck, file } = deckWith('---\ntheme: neue\n---\n\n---\nid: old\n---\n# A\n\n---\n# B\n')
  file.apply([{ type: 'add', slideId: 'old', stroke: stroke('ipad:1') }], file.read().deckHash)
  writeFileSync(deck, '---\ntheme: neue\n---\n\n---\nid: renamed\n---\n# A\n\n---\n# B\n')
  assert.deepEqual(file.deckChanged(), [{ from: 'old', to: 'renamed' }])
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(inkFileFor(deck), 'utf8')).slides), ['renamed'])
  writeFileSync(deck, '---\ntheme: neue\n---\n\n---\n# B\n')
  assert.deepEqual(file.deckChanged(), [])
  assert.deepEqual(Object.keys(file.read().ink.slides), ['renamed'])
})

test('the ink file is backed up once per session, before the first write', () => {
  const { dir, deck, file } = deckWith('---\ntheme: neue\n---\n\n---\nid: s\n---\n# S\n')
  writeFileSync(inkFileFor(deck), JSON.stringify({ version: 1, width: 1920, height: 1080, slides: { s: [stroke('old:1')] } }))
  const { deckHash } = file.read()
  file.apply([{ type: 'add', slideId: 's', stroke: stroke('new:1') }], deckHash); file.flush()
  file.apply([{ type: 'add', slideId: 's', stroke: stroke('new:2') }], deckHash); file.flush()
  const backups = readdirSync(resolve(dir, '.mdeck-backups'))
  assert.equal(backups.length, 1)
  assert.match(backups[0], /^talk\.drawings-.*\.json$/)
  assert.deepEqual(JSON.parse(readFileSync(resolve(dir, '.mdeck-backups', backups[0]), 'utf8')).slides.s.map(s => s.id), ['old:1'])
})

test('dropping drawings from the launch page keeps the session\'s backup first', () => {
  const { dir, deck, file } = deckWith('---\ntheme: neue\n---\n\n---\nid: s\n---\n# S\n')
  writeFileSync(inkFileFor(deck), JSON.stringify({ version: 1, width: 1920, height: 1080, slides: { s: [stroke('old:1')] } }))
  file.drop()
  assert.deepEqual(file.read().ink.slides, {})
  const backups = readdirSync(resolve(dir, '.mdeck-backups'))
  assert.equal(backups.length, 1)
  assert.deepEqual(JSON.parse(readFileSync(resolve(dir, '.mdeck-backups', backups[0]), 'utf8')).slides.s.map(s => s.id), ['old:1'])
})

test('changes that are not well formed, or too many, are refused before anything is read', () => {
  const { file } = deckWith(SOURCE)
  const { deckHash } = file.read()
  const bad = ops => file.apply(ops, deckHash).status
  assert.equal(bad('ops'), 400)
  assert.equal(bad([{ type: 'remove', slideId: '__proto__', ids: ['x'] }]), 400)
  assert.equal(bad([{ type: 'add', slideId: 'constructor', stroke: stroke('x:1') }]), 400)
  assert.equal(bad([{ type: 'rename', from: 'slide-1', to: 'slide-2' }]), 400, 'devices do not rename')
  assert.equal(bad([{ type: 'add', slideId: 'slide-1', stroke: { ...stroke('x:1'), points: Array(10001).fill([1, 1, 0.5]) } }]), 400)
  assert.equal(bad([{ type: 'clear', slideId: 'slide-1', ids: Array(10001).fill('x') }]), 400)
  assert.equal(bad(Array(1001).fill({ type: 'remove', slideId: 'slide-1', ids: [] })), 400)
  assert.equal(bad([{ type: 'remove', slideId: 'slide-1', ids: [] }]), 200)
})

test('the changes before a refused one in a batch are kept and written', async () => {
  const { deck, file } = deckWith('---\ntheme: neue\n---\n\n---\nid: s\n---\n# S\n')
  const { deckHash } = file.read()
  const result = file.apply([{ type: 'add', slideId: 's', stroke: stroke('ipad:1') }, { type: 'add', slideId: 'gone', stroke: stroke('ipad:2') }], deckHash)
  assert.equal(result.status, 409)
  assert.deepEqual(file.read().ink.slides.s.map(s => s.id), ['ipad:1'])
  await new Promise(done => setTimeout(done, 20))
  assert.deepEqual(JSON.parse(readFileSync(inkFileFor(deck), 'utf8')).slides.s.map(s => s.id), ['ipad:1'])
})

test('only this computer may change the ink', async () => {
  const { file } = deckWith(SOURCE)
  const handler = inkMiddleware(file)
  const call = headers => new Promise(done => handler({ url: '/', method: 'GET', headers }, { setHeader() {}, writeHead(status) { this.status = status }, end() { done(this.status) } }, () => done('next')))
  assert.equal(await call({ host: 'localhost:5173' }), 200)
  assert.equal(await call({ host: '192.168.1.20:5173' }), 403)
})

test('flushPending writes only what waits: a deck that was only shown gets no drawings file on Ctrl+C', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mdeck-ink-pending-'))
  const deck = resolve(dir, 'talk.md')
  writeFileSync(deck, SOURCE)
  const file = createInkFile(deck, { debounceMs: 60000 })
  file.read()
  file.flushPending()
  assert.equal(existsSync(inkFileFor(deck)), false, 'nothing drawn, nothing written')
  file.apply([{ type: 'add', slideId: 'slide-1', stroke: stroke('dev:1') }], hashSource(SOURCE))
  file.flushPending()
  assert.equal(existsSync(inkFileFor(deck)), true, 'a stroke waiting for the debounce is written')
})

test('room or a blank page on a slide without an id gives it one, and both follow it', () => {
  const { deck, file } = deckWith(SOURCE)
  const { deckHash } = file.read()
  const result = file.apply([
    { type: 'page', slideId: 'slide-2', page: 'p1' },
    { type: 'add', slideId: 'slide-2#p1', stroke: stroke('ipad:1') },
    { type: 'room', slideId: 'slide-2', open: true },
  ], deckHash)
  assert.equal(result.status, 200)
  assert.deepEqual(result.renamed, [{ from: 'slide-2', to: 'second' }])
  file.flush()
  const saved = JSON.parse(readFileSync(inkFileFor(deck), 'utf8'))
  assert.deepEqual(saved.pages, { second: ['p1'] })
  assert.deepEqual(saved.rooms, { second: { open: true } })
  assert.deepEqual(Object.keys(saved.slides), ['second#p1'])
  // The device still says slide-2: it reaches the page under the new id.
  assert.equal(file.apply([{ type: 'add', slideId: 'slide-2#p1', stroke: stroke('ipad:2') }], deckHash).status, 200)
  assert.equal(file.read().ink.slides['second#p1'].length, 2)
  assert.equal(file.apply([{ type: 'page', slideId: 'second', page: 'x' }], result.deckHash).status, 400)
  assert.equal(file.apply([{ type: 'room', slideId: 'second', open: 'yes' }], result.deckHash).status, 400)
  assert.equal(file.apply([{ type: 'page', slideId: 'second', page: 'p1', remove: true }], result.deckHash).status, 200)
  assert.deepEqual(file.read().ink.pages, {})
  // Dropping a slide's drawings drops its room and the strokes of its pages too.
  file.drop('second')
  assert.deepEqual([file.read().ink.slides, file.read().ink.rooms], [{}, {}])
})
