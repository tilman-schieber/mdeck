import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseSlides } from '../src/core/parseSlides.js'
import { shareSlides, stripActivities, stripNotes } from '../src/core/editDeck.js'
import { validateDeck } from '../src/core/validateDeck.js'
import { layoutManifests } from '../src/extensions/discover.js'

const deck = [
  '---\ntheme: neue\n---\n',
  '---\nlayout: title\n---\n# Talk\n',
  '---\n# Before\n\nText\n',
  '---\n# Vote\n\n<poll room="a" options="x|y" />\n',
  '---\n# Cloud\n\n<wordcloud room="b" />\n',
  '---\n:::meta\nid: kept\n:::\n# Named\n',
  '---\n# Code\n\n```html\n<poll room="c" />\n```\n',
  '---\n# Scale\n\n<scale room="d" />\n\n:::notes\nsecret\n:::\n',
  '---\n# Join\n\n<qrcode join />\n',
  '---\n# Follow\n\n<qrcode follow />\n',
  '---\n# Off\n\n<qrcode join="false" url="https://example.org" />\n',
  '---\n# After\n',
].join('\n')

test('stripActivities removes the slides with a live activity and nothing else', () => {
  const { source, ids, removed } = stripActivities(deck)
  const slides = parseSlides(source).slides
  assert.deepEqual(slides.map(slide => slide.content.match(/^# (.+)$/m)?.[1]), ['Talk', 'Before', 'Named', 'Code', 'Follow', 'Off', 'After'])
  assert.deepEqual(removed, ['slide-3', 'slide-4', 'slide-7', 'slide-8'], 'the join code goes with the polls; the follow link stays')
  // Automatic ids move up; explicit ones stay.
  assert.deepEqual(ids, { 'slide-1': 'slide-1', 'slide-2': 'slide-2', kept: 'kept', 'slide-6': 'slide-4', 'slide-9': 'slide-5', 'slide-10': 'slide-6', 'slide-11': 'slide-7' })
  assert.match(source, /```html\n<poll room="c" \/>\n```/, 'a poll inside code is an example, not an activity')
  assert.ok(source.startsWith('---\ntheme: neue\n---\n'), 'the deck settings stay')
})

test('stripActivities leaves a deck without activities, or of nothing else, as it is', () => {
  const plain = '---\ntheme: neue\n---\n\n---\n# A\n\n---\n# B\n'
  assert.equal(stripActivities(plain).source, plain)
  assert.deepEqual(stripActivities(plain).removed, [])
  const only = '---\n# Q\n\n<poll room="q" options="a|b" />\n'
  assert.equal(stripActivities(only).source, only)
})

test('the examples stay valid without their activities, also with the notes stripped', () => {
  for (const name of ['showcase', 'python', 'poll']) {
    const example = readFileSync(new URL(`../examples/${name}/slides.md`, import.meta.url), 'utf8')
    const { source } = stripActivities(stripNotes(example))
    const after = parseSlides(source)
    assert.ok(after.slides.every(slide => !/<(poll|question|wordcloud|scale)\b/i.test(slide.content.replace(/```[\s\S]*?```/g, ''))), name)
    assert.deepEqual(validateDeck(after, { layouts: layoutManifests(`examples/${name}/slides.md`) }).filter(d => d.severity === 'error'), [], name)
  }
})

test('shareSlides keeps the chosen slides, numbered as written, and their drawings follow', () => {
  const { source, ids, removed } = shareSlides(deck, { slides: [3, 5, 11] })
  const slides = parseSlides(source)
  assert.equal(slides.deckConfig.theme, 'neue', 'the deck settings stay')
  assert.deepEqual(slides.slides.map(slide => slide.content.match(/^# (.+)$/m)?.[1]), ['Vote', 'Named', 'After'])
  assert.deepEqual(ids, { 'slide-3': 'slide-1', kept: 'kept', 'slide-11': 'slide-3' })
  assert.equal(removed.length, 8)
  // With --no-polls as well, the poll among them goes too.
  const both = shareSlides(deck, { slides: [3, 5, 11], activities: true })
  assert.deepEqual(parseSlides(both.source).slides.map(slide => slide.content.match(/^# (.+)$/m)?.[1]), ['Named', 'After'])
  assert.throws(() => shareSlides(deck, { slides: [12] }), /has 11 slides; there is no slide 12/)
  assert.equal(shareSlides(deck, { slides: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }).source, deck)
})

test('a style on a slide left out moves to the first kept slide; one in code does not', () => {
  const styled = '---\ntheme: neue\n---\n\n# One\n\n<style>\n  .x { color: red; }\n</style>\n\n---\n# Two\n\n```html\n<style>.code {}</style>\n```\n\n---\n# Three\n'
  const { source } = shareSlides(styled, { slides: [3] })
  const [only] = parseSlides(source).slides
  assert.match(only.content, /^# Three[\s\S]*<style>\n {2}\.x \{ color: red; \}\n<\/style>/)
  assert.doesNotMatch(source, /\.code/)
})
