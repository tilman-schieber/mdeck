import test from 'node:test'
import assert from 'node:assert/strict'
import { tapOf, parseTarget, targetOn, circleOf, isInside, tapText } from '../src/components/pinpoint.js'
import { normalizeResults, withRoom, resultsCsv } from '../src/core/results.js'
import { activitiesIn, resultsReport, reportAnswersCsv, reportSummaryCsv } from '../src/core/resultsReport.js'
import { parseSlides } from '../src/core/parseSlides.js'
import { hasActivity } from '../src/core/editDeck.js'
import { collectLocalAssetRefs } from '../src/build/slidesPlugin.js'

test('a tap is two numbers from 0 to 1', () => {
  assert.deepEqual(tapOf({ x: 0.123456, y: 1 }), { x: 0.1235, y: 1 })
  for (const bad of [null, 'x', { x: 0.5 }, { x: -0.1, y: 0.5 }, { x: 0.5, y: 1.2 }, { x: '0.5', y: NaN }]) assert.equal(tapOf(bad), null, JSON.stringify(bad))
  assert.equal(tapText({ x: 0.6213, y: 0.3 }), '62.1% 30%')
})

test('the answer is a circle in percent or in pixels of the picture', () => {
  assert.deepEqual(parseTarget('62% 31% 8%'), { x: 62, y: 31, r: 8, unit: '%' })
  assert.deepEqual(parseTarget('412, 230, 40'), { x: 412, y: 230, r: 40, unit: 'px' })
  for (const bad of ['', '62% 31%', '62% 31 8%', '1 2 0', 'a b c', '1 2 3 4']) assert.equal(parseTarget(bad), null, bad)
  const size = { width: 800, height: 400 }
  assert.deepEqual(targetOn(parseTarget('50% 25% 10%'), size), { x: 0.5, y: 0.25, r: 0.1, ratio: 0.5 })
  assert.deepEqual(targetOn(parseTarget('400 100 80'), size), { x: 0.5, y: 0.25, r: 0.1, ratio: 0.5 })
  assert.equal(targetOn(parseTarget('400 100 80'), null), null, 'pixels need the picture loaded')
})

test('the circle stays round on a picture that is not square', () => {
  // 800 × 400: a radius of 80 px is 0.1 of the width and 0.2 of the height.
  const circle = { x: 0.5, y: 0.5, r: 0.1, ratio: 0.5 }
  assert.ok(isInside({ x: 0.5, y: 0.69 }, circle), '76 px below the centre')
  assert.ok(!isInside({ x: 0.5, y: 0.71 }, circle), '84 px below the centre')
  assert.ok(isInside({ x: 0.59, y: 0.5 }, circle))
  assert.ok(!isInside({ x: 0.61, y: 0.5 }, circle))
  assert.equal(circleOf({ x: 0.5, y: 0.5, r: 0, ratio: 1 }), null)
  assert.equal(circleOf(['A']), null)
})

const deck = `---
meta:
  title: Anatomy
---
---
# Where is the left atrium?

<pinpoint room="heart" src="img/heart.png" answer="62% 31% 8%" />
`

test('a pinpoint is an activity with a picture of the deck', () => {
  const parsed = parseSlides(deck)
  assert.ok(hasActivity(parsed.slides[0]))
  assert.ok(collectLocalAssetRefs(deck).includes('img/heart.png'))
  assert.deepEqual(activitiesIn(parsed).map(activity => [activity.room, activity.kind, activity.question]), [['heart', 'spot', 'Where is the left atrium?']])
})

test('kept taps are written as positions, and counted on target with the circle the slide kept', () => {
  const solution = { x: 0.5, y: 0.5, r: 0.1, ratio: 0.5 }
  const answers = [{ phone: 1, at: 't1', value: { x: 0.1, y: 0.1 } }, { phone: 2, at: 't2', value: { x: 0.5, y: 0.69 } }, { phone: 1, at: 't3', value: { x: 0.52, y: 0.5 } }, { phone: 3, at: 't4', value: { x: 0.5, y: 0.8 } }]
  const results = withRoom(normalizeResults({}), 'heart', { answers, solution })
  assert.deepEqual(normalizeResults(JSON.parse(JSON.stringify(results))).rooms.heart.solution, solution, 'the circle survives the file')
  assert.match(resultsCsv(results), /^room,phone,at,answer\nheart,1,t1,10% 10%\n/)
  const report = resultsReport(results, parseSlides(deck))
  assert.deepEqual(report[0].summary.counts, [{ answer: 'on target', count: 2 }, { answer: 'off target', count: 1 }], "each phone's latest tap")
  assert.equal(report[0].summary.voted, 3)
  assert.equal(reportAnswersCsv(report).split('\n')[2], '1,heart,spot,Where is the left atrium?,2,t2,50% 69%')
  assert.ok(reportSummaryCsv(report).includes('1,heart,spot,Where is the left atrium?,on target,2,67%'))
  // Without a kept circle the taps are still there, but nothing counts as on target.
  const plain = resultsReport(withRoom(normalizeResults({}), 'heart', { answers }), parseSlides(deck))
  assert.deepEqual(plain[0].summary.counts, [])
})
