import test from 'node:test'
import assert from 'node:assert/strict'
import { retryDelay, compactOutbox, batchSize, BATCH_BYTES } from '../src/runtime/ink/outbox.js'

test('live ink waits longer after each failed attempt, up to five seconds', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 10].map(retryDelay), [0, 250, 500, 1000, 2000, 4000, 5000, 5000])
})

test('while offline only the last dot and zoom of each sender are kept, and the oldest segments go first', () => {
  const seg = (key, from) => ({ type: 'segment', key, from, points: [[0, 0]] })
  const held = [
    { type: 'dot', key: 'a:dot', point: [1, 1] }, seg('a:1', 0), { type: 'zoom', key: 'a:zoom', scale: 2 },
    { type: 'dot', key: 'a:dot', point: [2, 2] }, { type: 'dot', key: 'b:dot', point: [5, 5] }, seg('a:1', 1),
    { type: 'end', key: 'a:1' }, { type: 'op', op: { type: 'add' } }, { type: 'zoom', key: 'a:zoom', scale: 1 },
  ]
  assert.deepEqual(compactOutbox(held).map(m => `${m.type}:${m.point ?? m.from ?? m.scale ?? ''}`),
    ['segment:0', 'dot:2,2', 'dot:5,5', 'segment:1', 'end:', 'op:', 'zoom:1'])
  const many = [...Array.from({ length: 6 }, (_, i) => seg('a:1', i)), { type: 'end', key: 'a:1' }, { type: 'op', op: {} }]
  assert.deepEqual(compactOutbox(many, 4).map(m => m.from ?? m.type), [4, 5, 'end', 'op'], 'ends and saved changes always stay')
})

test('a request to the stage room stays below its size limit, so moving many strokes reaches the others', () => {
  const op = n => ({ type: 'op', key: 'a:op', op: { type: 'add', slideId: 's', stroke: { id: `a:${n}`, points: Array.from({ length: 80 }, (_, i) => [1000.5 + i, 500.5, 0.55]) } } })
  const moved = Array.from({ length: 60 }, (_, i) => op(i))
  const first = batchSize(moved)
  assert.ok(first > 1 && first < moved.length)
  assert.ok(JSON.stringify({ messages: moved.slice(0, first) }).length <= BATCH_BYTES + 100)
  assert.ok(JSON.stringify({ messages: moved.slice(0, first + 1) }).length > BATCH_BYTES)
  assert.equal(batchSize(Array.from({ length: 300 }, () => ({ type: 'dot', key: 'a:dot', point: [1, 1] }))), 100, 'and at most 100 messages')
  const huge = { type: 'op', op: { stroke: { points: Array.from({ length: 5000 }, () => [1000.5, 500.5, 0.5]) } } }
  assert.equal(batchSize([huge, op(1)]), 1, 'a message larger than the limit goes alone')
  assert.equal(batchSize([]), 0)
})
