import test from 'node:test'
import assert from 'node:assert/strict'
import { joinSegment } from '../src/runtime/ink/segments.js'

const xs = known => known.points.map(([x]) => x)
const segment = (from, values) => ({ from, points: values.map(x => [x, 0]) })

test('a segment that arrives early waits for the one before it', () => {
  const known = { points: [] }
  joinSegment(known, segment(0, [0, 1]))
  joinSegment(known, segment(4, [4, 5]))
  assert.deepEqual(xs(known), [0, 1], 'nothing past the gap yet')
  joinSegment(known, segment(2, [2, 3]))
  assert.deepEqual(xs(known), [0, 1, 2, 3, 4, 5], 'the early segment joins once the gap is filled')
  joinSegment(known, segment(6, [6]))
  assert.deepEqual(xs(known), [0, 1, 2, 3, 4, 5, 6])
})

test('a segment sent again, or a restart from the beginning, replaces the points from there', () => {
  const known = { points: [] }
  joinSegment(known, segment(0, [0, 1, 2]))
  joinSegment(known, segment(1, [1, 2]))
  assert.deepEqual(xs(known), [0, 1, 2])
  joinSegment(known, segment(0, [9, 8]))
  assert.deepEqual(xs(known), [9, 8])
})
