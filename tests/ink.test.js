import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { inkFileFor, emptyInk, normalizeInk, validateInk, orphanIds, applyOp, isSlideId, hitTest, strokePath, inkOrder, translateStroke, insidePolygon, strokesInLasso, strokesBox, inkPaint, snapAngle, spacedPoints, INK_SPACING, serializeInk, baseSlideId, pageOf, reachesRoom, hasRoomPage, pickInk } from '../src/core/ink.js'
import { paletteTokens } from '../src/extensions/appearance.js'
import { slidesPlugin } from '../src/build/slidesPlugin.js'
import { checkDeck } from '../src/build/check.js'
import { loadRegistry } from '../src/extensions/discover.js'
import { parseSlides } from '../src/core/parseSlides.js'

const stroke = (id, points = [[10, 10, 0.5], [60, 40, 0.7], [120, 20, 0.6]], extra = {}) => ({ id, tool: 'pen', color: '#e11d48', size: 6, points, ...extra })

test('the ink file sits beside the deck', () => {
  assert.equal(inkFileFor('/talks/lunch.md'), '/talks/lunch.drawings.json')
  assert.equal(inkFileFor('slides.MD'), 'slides.drawings.json')
})

test('normalizing drops broken strokes, rounds points and scales to the theme size', () => {
  const raw = { version: 1, width: 1920, height: 1080, slides: {
    intro: [stroke('a:1', [[10.26, 20.71, 0.444], [30, 40]]), { id: 'bad', points: [] }, 'nonsense'],
    empty: [],
    other: 'x',
  } }
  const ink = normalizeInk(raw)
  assert.deepEqual(Object.keys(ink.slides), ['intro'])
  assert.deepEqual(ink.slides.intro[0].points, [[10.3, 20.7, 0.44], [30, 40, 0.5]])
  const half = normalizeInk(raw, { width: 960, height: 540 })
  assert.deepEqual(half.slides.intro[0].points[0], [5.1, 10.4, 0.44])
  assert.equal(half.slides.intro[0].size, 3)
  assert.deepEqual(normalizeInk(null), emptyInk())
  assert.equal(normalizeInk({ slides: { s: [stroke('x', [[1, 1]], { tool: 'laser', color: 'url(evil)' })] } }).slides.s[0].tool, 'pen', 'unknown tools and colours fall back')
})

test('validation reports what a hand-edited file got wrong', () => {
  assert.deepEqual(validateInk({ version: 1, slides: {} }), [])
  assert.equal(validateInk([]).length, 1)
  const messages = validateInk({ version: 2, slides: { a: 'x', b: [{ points: [] }] } }).map(p => p.message)
  assert.equal(messages.length, 3)
  assert.match(messages[0], /version 2/)
})

test('changes apply once, whatever order the devices send them in', () => {
  let ink = emptyInk()
  ink = applyOp(ink, { type: 'add', slideId: 's', stroke: stroke('ipad:1') })
  const twice = applyOp(ink, { type: 'add', slideId: 's', stroke: stroke('ipad:1') })
  assert.equal(twice.slides.s.length, 1, 'adding the same stroke again replaces it')
  ink = applyOp(twice, { type: 'add', slideId: 's', stroke: stroke('laptop:1') })
  const known = ['ipad:1']
  ink = applyOp(ink, { type: 'clear', slideId: 's', ids: known })
  assert.deepEqual(ink.slides.s.map(s => s.id), ['laptop:1'], 'clear keeps strokes the clearing device did not know')
  ink = applyOp(ink, { type: 'remove', slideId: 's', ids: ['laptop:1'] })
  assert.equal(ink.slides.s, undefined, 'a slide without strokes has no entry')
  const renamed = applyOp(applyOp(emptyInk(), { type: 'add', slideId: 'slide-3', stroke: stroke('a:1') }), { type: 'rename', from: 'slide-3', to: 'lunch' })
  assert.deepEqual(Object.keys(renamed.slides), ['lunch'])
  assert.equal(applyOp(renamed, { type: 'nonsense' }), renamed)
})

test('a stroke keeps only points a little apart, measured from the last one kept', () => {
  assert.equal(INK_SPACING, 0.3)
  // A slow mouse at 1000 Hz: positions a tenth of a pixel apart.
  const slow = Array.from({ length: 10 }, (_, i) => [10 + i / 10, 20, 0.5])
  assert.deepEqual(spacedPoints([10, 20, 0.5], slow).map(([x]) => x), [10.3, 10.6, 10.9], 'every third one')
  assert.deepEqual(spacedPoints([0, 0, 0.5], [[0, 0, 0.6], [0.1, 0.1, 0.7]]), [], 'none, while the pen stays put')
  assert.deepEqual(spacedPoints(undefined, [[5, 5, 0.5], [5.1, 5, 0.5], [9, 5, 0.5]]), [[5, 5, 0.5], [9, 5, 0.5]], 'the first point of a stroke counts')
  const fast = [[0, 0, 0.5], [2, 0, 0.5], [4, 1, 0.5]]
  assert.deepEqual(spacedPoints([-2, 0, 0.5], fast), fast, 'normal drawing keeps everything')
})

test('the eraser finds finished strokes', () => {
  const s = stroke('a', [[0, 0, 0.5], [100, 0, 0.5]])
  assert.equal(hitTest(s, [50, 5]), true)
  assert.equal(hitTest(s, [50, 60]), false)
  assert.match(strokePath(s), /^M [\d.-]+ [\d.-]+ Q .* Z$/)
})

test('a lasso selects strokes mostly inside it, and a moved stroke replaces its original', () => {
  const inside = { id: 'a', tool: 'pen', color: '#000', size: 6, points: [[10, 10, 0.5], [20, 10, 0.5], [30, 12, 0.5]] }
  const half = { id: 'b', tool: 'pen', color: '#000', size: 6, points: [[40, 40, 0.5], [200, 40, 0.5]] }
  const outside = { id: 'c', tool: 'pen', color: '#000', size: 6, points: [[300, 300, 0.5], [320, 300, 0.5]] }
  const lasso = [[0, 0], [100, 0], [100, 100], [0, 100]]
  assert.equal(insidePolygon([50, 50], lasso), true)
  assert.equal(insidePolygon([150, 50], lasso), false)
  assert.deepEqual(strokesInLasso([inside, half, outside], lasso).map(s => s.id), ['a', 'b'])
  assert.deepEqual(strokesInLasso([inside], [[0, 0], [100, 0]]), [], 'two points are no lasso')
  assert.deepEqual(strokesBox([inside], 2), [5, 5, 35, 17])
  assert.equal(strokesBox([]), null)

  const moved = translateStroke(inside, 5, -5)
  assert.equal(moved.id, 'a')
  assert.deepEqual(moved.points[0], [15, 5, 0.5])
  const ink = applyOp(applyOp(emptyInk(), { type: 'add', slideId: 's', stroke: inside }), { type: 'add', slideId: 's', stroke: moved })
  assert.equal(ink.slides.s.length, 1)
  assert.deepEqual(ink.slides.s[0].points[0], [15, 5, 0.5])
})

test('a finished stroke reaches its last point', () => {
  const points = Array.from({ length: 20 }, (_, i) => [100 + i * 20, 200, 0.5])
  const right = d => Math.max(...d.match(/-?\d+(\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 0))
  assert.ok(right(strokePath({ tool: 'pen', size: 6, points })) >= 480, 'the outline runs to x = 480')
  assert.ok(right(strokePath({ tool: 'pen', size: 6, points }, { last: false })) < right(strokePath({ tool: 'pen', size: 6, points })))
})

test('a slide id that names a property of Object is no slide, in a change or a file', () => {
  assert.deepEqual(['s', 'slide-3', '__proto__', 'constructor', '', 7, 'x'.repeat(201)].map(isSlideId), [true, true, false, false, false, false, false])
  const stroke = { id: 'a:1', tool: 'pen', color: '#000', size: 4, points: [[1, 1, 0.5]] }
  let ink = applyOp(emptyInk(), { type: 'add', slideId: 's', stroke })
  assert.equal(applyOp(ink, { type: 'add', slideId: '__proto__', stroke }), ink)
  assert.equal(applyOp(ink, { type: 'remove', slideId: '__proto__', ids: ['a:1'] }), ink)
  assert.equal(applyOp(ink, { type: 'rename', from: 's', to: '__proto__' }), ink)
  assert.equal(Object.getPrototypeOf(ink.slides), Object.prototype)
  assert.deepEqual(Object.keys(normalizeInk({ version: 1, slides: { s: [stroke], __proto__: [stroke] } }).slides), ['s'])
})

test('renaming a slide twice, or onto ink it already has, does not double strokes', () => {
  const stroke = { id: 'a', tool: 'pen', color: '#000', size: 6, points: [[1, 2, 0.5], [3, 4, 0.5]] }
  let ink = applyOp(emptyInk(), { type: 'add', slideId: 'old', stroke })
  ink = applyOp(ink, { type: 'add', slideId: 'new', stroke })
  ink = applyOp(ink, { type: 'rename', from: 'old', to: 'new' })
  assert.equal(ink.slides.new.length, 1)
  assert.equal(ink.slides.old, undefined)
})

test('a straight line snaps to steps of 15 degrees when close to one', () => {
  // 2° off horizontal: becomes horizontal, same length
  const end = snapAngle([0, 0], [100, Math.tan(2 * Math.PI / 180) * 100])
  assert.equal(end[1], 0)
  assert.ok(Math.abs(end[0] - Math.hypot(100, Math.tan(2 * Math.PI / 180) * 100)) < 0.2)
  // 43° becomes 45°
  const diagonal = snapAngle([10, 10], [10 + 100 * Math.cos(43 * Math.PI / 180), 10 + 100 * Math.sin(43 * Math.PI / 180)])
  assert.ok(Math.abs(Math.atan2(diagonal[1] - 10, diagonal[0] - 10) * 180 / Math.PI - 45) < 0.1)
  // 7° lies between steps, beyond the tolerance: stays as drawn
  const free = [100 * Math.cos(7 * Math.PI / 180), 100 * Math.sin(7 * Math.PI / 180)]
  assert.deepEqual(snapAngle([0, 0], free), free)
  // straight down (90°) and up-left (-135°) snap too
  assert.equal(snapAngle([0, 0], [3, 100])[0], 0)
  const upLeft = snapAngle([0, 0], [-70, -72])
  assert.ok(Math.abs(upLeft[0] - upLeft[1]) < 0.2)
})

test('the highlighter is drawn below the pen', () => {
  const pen = { id: 'p', tool: 'pen' }, highlighter = { id: 'h', tool: 'highlighter' }
  assert.deepEqual(inkOrder([pen, highlighter]).map(s => s.id), ['h', 'p'])
})

test('orphaned ink is found after a slide was removed', () => {
  const deck = parseSlides('---\ntheme: neue\n---\n\n---\nid: intro\n---\n# A\n')
  const ink = normalizeInk({ slides: { intro: [stroke('a')], gone: [stroke('b')] } })
  assert.deepEqual(orphanIds(ink, deck.slides), ['gone'])
})

test('the slides plugin bundles the ink file, scaled to the deck, or nothing with --no-drawings', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mdeck-ink-'))
  const deck = resolve(dir, 'talk.md')
  writeFileSync(deck, '---\ntheme: neue\nwidth: 960\nheight: 540\n---\n\n---\nid: intro\n---\n# A\n')
  const load = options => {
    const plugin = slidesPlugin(deck, options)
    const watched = []
    const code = plugin.load.call({ addWatchFile: file => watched.push(file), warn() {} }, plugin.resolveId('virtual:deck-ink'))
    const [first, second] = code.split('\n')
    return { data: JSON.parse(first.replace(/^export default /, '')), name: JSON.parse(second.replace(/^export const inkFileName = /, '')), watched }
  }
  assert.deepEqual(load().data, emptyInk({ width: 960, height: 540 }), 'no ink file yet')
  assert.deepEqual(load().watched, [], 'a missing file is not watched as a dependency, or Vite fails to load the page')
  writeFileSync(inkFileFor(deck), JSON.stringify({ version: 1, width: 1920, height: 1080, slides: { intro: [stroke('a:1', [[100, 100, 0.5]])] } }))
  const { data, watched } = load()
  assert.deepEqual(data.slides.intro[0].points, [[50, 50, 0.5]])
  assert.deepEqual(watched, [inkFileFor(deck)])
  assert.equal(load().name, 'talk.drawings.json', 'the name for downloading the file')
  assert.deepEqual(load({ ink: false }).data.slides, {})
})

test('mdeck check reports broken ink files and ink for missing slides', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mdeck-ink-check-'))
  const deck = resolve(dir, 'talk.md')
  writeFileSync(deck, '---\ntheme: neue\n---\n\n---\nid: intro\n---\n# A\n')
  const codes = () => checkDeck(deck, loadRegistry(deck)).diagnostics.map(d => [d.code, d.severity])
  assert.deepEqual(codes(), [])
  writeFileSync(inkFileFor(deck), '{ not json')
  assert.deepEqual(codes(), [['invalid-ink', 'error']])
  writeFileSync(inkFileFor(deck), JSON.stringify({ version: 1, slides: { intro: [stroke('a')], gone: [stroke('b')] } }))
  assert.deepEqual(codes(), [['ink-orphan', 'warning']])
})

test('pen colours follow the palette and the appearance', () => {
  assert.equal(inkPaint('accent'), 'var(--accent, #e11d48)')
  assert.equal(inkPaint('#111111'), 'var(--ink, #111111)')
  assert.equal(inkPaint('#e11d48'), 'var(--pen-red, #e11d48)')
  assert.equal(inkPaint('#ffeb3b'), '#ffeb3b', 'other colours stay as drawn')
  const palette = { light: { '--ink': '#111' }, dark: { '--ink': '#eee' } }
  assert.ok(paletteTokens(palette, 'dark')['--pen-red'], 'dark slides get lighter pen colours')
  assert.equal(paletteTokens(palette, 'light')['--pen-red'], undefined)
})

test('built files leave out what is on hidden slides: its words, drawings and answers', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mdeck-hidden-build-'))
  const deck = resolve(dir, 'talk.md')
  writeFileSync(deck, '# A\n\n<poll room="shown" options="Yes, No"></poll>\n---\n:::meta\nhidden: true\n:::\n# Margin 42%\n\n<poll room="secret" options="Up, Down"></poll>\n---\n# C\n')
  writeFileSync(inkFileFor(deck), JSON.stringify({ version: 1, width: 1920, height: 1080, slides: { 'slide-2': [stroke('a:1')], 'slide-3': [stroke('a:2')] } }))
  writeFileSync(resolve(dir, 'talk.results.json'), JSON.stringify({ version: 1, rooms: { shown: { answers: [{ phone: 1, value: 'Yes' }] }, secret: { answers: [{ phone: 1, value: 'Up' }] } } }))
  const load = (id, options) => {
    const plugin = slidesPlugin(deck, options)
    return plugin.load.call({ addWatchFile() {}, warn() {} }, plugin.resolveId(id))
  }
  const json = code => JSON.parse(code.split('\n')[0].replace(/^export default /, ''))
  assert.match(load('virtual:slides', {}), /Margin 42%/, 'mdeck run and the editor keep the whole deck')
  assert.doesNotMatch(load('virtual:slides', { stripHidden: true }), /Margin 42%/)
  assert.deepEqual(Object.keys(json(load('virtual:deck-ink', { stripHidden: true })).slides), ['slide-3'])
  assert.deepEqual(Object.keys(json(load('virtual:deck-results', { stripHidden: true })).rooms), ['shown'])
  assert.deepEqual(Object.keys(json(load('virtual:deck-ink', {})).slides), ['slide-2', 'slide-3'])
})

test('room around a slide and blank pages after it are kept with the ink, move with the slide and are left out of the file while there are none', () => {
  const stroke = (id, x = 1) => ({ id, tool: 'pen', color: '#e11d48', size: 6, points: [[x, 2, 0.5]] })
  let ink = applyOp(emptyInk(), { type: 'room', slideId: 'intro', open: true })
  ink = applyOp(ink, { type: 'page', slideId: 'intro', page: 'p1' })
  ink = applyOp(ink, { type: 'page', slideId: 'intro', page: 'p2', at: 0 })
  ink = applyOp(ink, { type: 'add', slideId: 'intro#p1', stroke: stroke('a:1') })
  assert.deepEqual(ink.pages, { intro: ['p2', 'p1'] }, 'a page goes where it is asked for')
  assert.equal(applyOp(ink, { type: 'page', slideId: 'intro', page: 'p1' }), ink, 'the same page twice is one page')
  assert.equal(applyOp(ink, { type: 'page', slideId: 'intro#p1', page: 'p3' }), ink, 'a page has no pages')
  assert.equal(applyOp(ink, { type: 'page', slideId: 'intro', page: 'nope' }), ink, 'a page id starts with p')
  assert.equal(applyOp(ink, { type: 'room', slideId: 'intro', open: true }), ink)
  const moved = applyOp(ink, { type: 'rename', from: 'intro', to: 'start' })
  assert.deepEqual(moved.rooms, { start: { open: true } })
  assert.deepEqual(moved.pages, { start: ['p2', 'p1'] })
  assert.deepEqual(Object.keys(moved.slides), ['start#p1'])
  const back = normalizeInk(JSON.parse(serializeInk(moved)))
  assert.deepEqual([back.rooms, back.pages, back.slides], [moved.rooms, moved.pages, moved.slides])
  assert.deepEqual(orphanIds(moved, [{ id: 'other' }]), ['start'])
  assert.deepEqual(orphanIds(moved, [{ id: 'start' }]), [])
  assert.doesNotMatch(serializeInk(emptyInk()), /rooms|pages/)
  // Closing the room keeps that the slide has one; removing the last page leaves none.
  assert.deepEqual(applyOp(moved, { type: 'room', slideId: 'start', open: false }).rooms, { start: { open: false } })
  assert.equal(applyOp(emptyInk(), { type: 'room', slideId: 'a', open: false }).rooms.a, undefined, 'a slide never expanded has no room')
  const one = applyOp(moved, { type: 'page', slideId: 'start', page: 'p2', remove: true })
  assert.deepEqual(one.pages, { start: ['p1'] })
  assert.deepEqual(applyOp(one, { type: 'page', slideId: 'start', page: 'p1', remove: true }).pages, {})
  assert.deepEqual([baseSlideId('start#p1'), pageOf('start#p1'), pageOf('start'), baseSlideId('a#b')], ['start', 'p1', null, 'a#b'])
  // The room's ink is the slide's own, beyond its right or lower edge; only
  // a slide that was expanded has a page for it in print.
  assert.equal(reachesRoom([stroke('a:2', 1900)], 1920, 1080), false)
  assert.equal(reachesRoom([stroke('a:2', 2000)], 1920, 1080), true)
  const wide = applyOp(moved, { type: 'add', slideId: 'start', stroke: stroke('a:3', 2000) })
  assert.equal(hasRoomPage(wide, 'start'), true)
  assert.equal(hasRoomPage(moved, 'start'), false, 'nothing written around it')
  assert.equal(hasRoomPage({ ...wide, rooms: {} }, 'start'), false, 'a stroke that left a slide never expanded')
  // A build without a slide leaves out all that belongs to it.
  const picked = pickInk(applyOp(wide, { type: 'add', slideId: 'other', stroke: stroke('a:4') }), id => id !== 'start', id => id === 'other' ? 'slide-1' : id)
  assert.deepEqual([Object.keys(picked.slides), picked.rooms, picked.pages], [['slide-1'], {}, {}])
  const kept = pickInk(wide, () => true, id => id === 'start' ? 'slide-3' : id)
  assert.deepEqual([Object.keys(kept.slides).sort(), kept.rooms, kept.pages], [['slide-3', 'slide-3#p1'], { 'slide-3': { open: true } }, { 'slide-3': ['p2', 'p1'] }])
})
