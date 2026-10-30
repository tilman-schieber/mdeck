// Slide annotations ("ink"): the file format and the operations on it, as
// pure functions for the browser and for Node.
//
// A deck's ink (its drawings) lives in `<deck>.drawings.json` beside `<deck>.md`:
//   { version: 1, width, height, slides: { <slideId>: [stroke, …] } }
//   stroke = { id: '<device>:<n>', tool: 'pen' | 'highlighter', color, size,
//              points: [[x, y, pressure], …] }
// Points are in the deck's design pixels (width × height), to a tenth of a
// pixel. Ink belongs to a slide, not to one of its steps.
import { getStroke } from 'perfect-freehand'

export const INK_VERSION = 1
export const INK_TOOLS = ['pen', 'highlighter']
const COLOR_RE = /^#[0-9a-f]{3,8}$|^[a-z]+$/i
// A slide id is a key of `slides`: a name Object has of its own (__proto__,
// constructor) would reach the object itself instead of the ink.
export const isSlideId = id => typeof id === 'string' && id.length > 0 && id.length <= 200 && !(id in Object.prototype)

/** The drawings file that belongs to a deck file. */
export const inkFileFor = deckPath => String(deckPath).replace(/\.md$/i, '') + '.drawings.json'

/** Where drawings were kept before 2.0; nothing reads it any more. */
export const oldInkFileFor = deckPath => String(deckPath).replace(/\.md$/i, '') + '.ink.json'

export function emptyInk({ width = 1920, height = 1080 } = {}) {
  return { version: INK_VERSION, width, height, slides: {} }
}

const round = (n, digits = 0) => { const f = 10 ** digits; return Math.round(n * f) / f }

function cleanStroke(stroke, scaleX = 1, scaleY = 1) {
  if (!stroke || typeof stroke !== 'object' || !Array.isArray(stroke.points)) return null
  const points = stroke.points
    .filter(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map(([x, y, pressure = 0.5]) => [round(x * scaleX, 1), round(y * scaleY, 1), round(Math.min(1, Math.max(0, Number(pressure) || 0.5)), 2)])
  if (!points.length) return null
  return {
    id: String(stroke.id ?? ''),
    tool: INK_TOOLS.includes(stroke.tool) ? stroke.tool : 'pen',
    color: typeof stroke.color === 'string' && COLOR_RE.test(stroke.color) ? stroke.color : '#e11d48',
    size: Math.min(80, Math.max(1, Number(stroke.size) || 6)) * Math.sqrt(scaleX * scaleY),
    points,
  }
}

/**
 * A usable ink object from anything read from disk or sent by a client:
 * unknown fields dropped, strokes without points skipped, and points scaled
 * when the deck's design size differs from the one the ink was drawn at.
 */
export function normalizeInk(raw, { width = 1920, height = 1080 } = {}) {
  const ink = emptyInk({ width, height })
  if (!raw || typeof raw !== 'object') return ink
  const scaleX = Number(raw.width) > 0 ? width / raw.width : 1
  const scaleY = Number(raw.height) > 0 ? height / raw.height : 1
  for (const [slideId, strokes] of Object.entries(raw.slides ?? {})) {
    if (!Array.isArray(strokes) || !isSlideId(slideId)) continue
    const clean = strokes.map(stroke => cleanStroke(stroke, scaleX, scaleY)).filter(Boolean)
    if (clean.length) ink.slides[slideId] = clean
  }
  return ink
}

/** Problems with a raw ink file, as { message } objects; empty when it is fine. */
export function validateInk(raw) {
  const problems = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [{ message: 'The drawings file must hold a JSON object' }]
  if (raw.version !== INK_VERSION) problems.push({ message: `Unknown drawings file version ${raw.version}; expected ${INK_VERSION}` })
  if (raw.slides != null && (typeof raw.slides !== 'object' || Array.isArray(raw.slides))) problems.push({ message: 'slides must map slide ids to lists of strokes' })
  for (const [slideId, strokes] of Object.entries(raw.slides ?? {})) {
    if (!Array.isArray(strokes)) { problems.push({ message: `Ink for slide "${slideId}" is not a list` }); continue }
    strokes.forEach((stroke, i) => { if (!cleanStroke(stroke)) problems.push({ message: `Stroke ${i + 1} on slide "${slideId}" has no points` }) })
  }
  return problems
}

/** Slide ids that have ink but are not in the deck any more. */
export function orphanIds(ink, slides) {
  const ids = new Set(slides.map(slide => slide.id))
  return Object.keys(ink?.slides ?? {}).filter(id => !ids.has(id))
}

/**
 * Applies one change and returns a new ink object; applying the same change
 * twice has no further effect.
 *   { type: 'add', slideId, stroke }       adds, or replaces the stroke with that id
 *   { type: 'remove', slideId, ids }       removes those strokes
 *   { type: 'clear', slideId, ids }        the same, for the strokes a device knew about
 *   { type: 'rename', from, to }           moves a slide's ink to a new id
 */
export function applyOp(ink, op) {
  const next = { ...ink, slides: { ...ink.slides } }
  if (op?.type === 'add') {
    const stroke = cleanStroke(op.stroke)
    if (!stroke || !stroke.id || !isSlideId(op.slideId)) return ink
    const list = (next.slides[op.slideId] ?? []).filter(s => s.id !== stroke.id)
    next.slides[op.slideId] = [...list, stroke]
  } else if (op?.type === 'remove' || op?.type === 'clear') {
    if (!isSlideId(op.slideId)) return ink
    const gone = new Set(op.ids ?? [])
    const list = (next.slides[op.slideId] ?? []).filter(stroke => !gone.has(stroke.id))
    if (list.length) next.slides[op.slideId] = list
    else delete next.slides[op.slideId]
  } else if (op?.type === 'rename') {
    if (!isSlideId(op.from) || !isSlideId(op.to) || op.from === op.to || !next.slides[op.from]) return ink
    // A stroke already under the new id (the same change heard twice, say
    // from a window that replays the room's history) is not doubled.
    const known = new Set((next.slides[op.to] ?? []).map(stroke => stroke.id))
    next.slides[op.to] = [...(next.slides[op.to] ?? []), ...next.slides[op.from].filter(stroke => !known.has(stroke.id))]
    delete next.slides[op.from]
  } else {
    return ink
  }
  return next
}

function distanceToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// A pen or a mouse that moves slowly reports many points at almost the same
// spot: a mouse at 1000 Hz, or the Apple Pencil (240 Hz) drawing slowly. The
// stage keeps a point only this many design pixels away from the one before,
// while the stroke is drawn, so the stroke on screen and the saved one have
// the same points. Fewer points keep a long stroke within the limits for
// saving (inkPlugin.js) and for the stage room (live/rooms.js).
export const INK_SPACING = 0.3

/** The points of `added` that lie at least `min` design pixels from the one kept before them, starting after `last`. */
export function spacedPoints(last, added, min = INK_SPACING) {
  const kept = []
  for (const point of added) {
    const before = kept[kept.length - 1] ?? last
    // Points lie on a tenth of a pixel: 10.6 - 10.3 is a hair under 0.3.
    if (!before || Math.hypot(point[0] - before[0], point[1] - before[1]) >= min - 1e-9) kept.push(point)
  }
  return kept
}

/** True when `point` lies within `radius` design pixels of the stroke. */
export function hitTest(stroke, point, radius = 12) {
  const reach = radius + (stroke.size ?? 6) / 2
  const points = stroke.points
  if (points.length === 1) return Math.hypot(point[0] - points[0][0], point[1] - points[0][1]) <= reach
  for (let i = 1; i < points.length; i++) if (distanceToSegment(point, points[i - 1], points[i]) <= reach) return true
  return false
}

const TOOL_OPTIONS = {
  pen: { thinning: 0.6, smoothing: 0.5, streamline: 0.3 },
  highlighter: { thinning: 0, smoothing: 0.6, streamline: 0.4, start: { cap: false }, end: { cap: false } },
}

/**
 * The SVG path of a stroke's outline. Pen strokes follow the pen's pressure;
 * strokes drawn with a finger or mouse (constant pressure) get simulated
 * pressure from their speed.
 */
export function strokePath(stroke, { last = true } = {}) {
  // A straight line (two points) keeps its pressure: simulated from speed,
  // its one long segment would come out hairline thin.
  const constant = stroke.points.length > 2 && stroke.points.every(point => point[2] === stroke.points[0][2])
  // `last`: a finished stroke runs right to its final point instead of
  // trailing behind it, as streamline does for a stroke still being drawn.
  const outline = getStroke(stroke.points, { size: stroke.size, simulatePressure: constant, last, ...TOOL_OPTIONS[stroke.tool] ?? TOOL_OPTIONS.pen })
  if (!outline.length) return ''
  const d = outline.reduce((acc, [x0, y0], i, all) => {
    const [x1, y1] = all[(i + 1) % all.length]
    acc.push(round(x0, 1), round(y0, 1), round((x0 + x1) / 2, 1), round((y0 + y1) / 2, 1))
    return acc
  }, ['M', ...outline[0].map(n => round(n, 1)), 'Q'])
  return d.join(' ') + ' Z'
}

/** The ink file's text: one stroke per line, so it reads well in a diff. */
export function serializeInk(ink) {
  const slides = Object.entries(ink.slides ?? {}).filter(([, strokes]) => strokes.length)
  const body = slides.map(([id, strokes]) => `    ${JSON.stringify(id)}: [\n${strokes.map(stroke => '      ' + JSON.stringify(stroke)).join(',\n')}\n    ]`).join(',\n')
  return `{\n  "version": ${INK_VERSION},\n  "width": ${ink.width},\n  "height": ${ink.height},\n  "slides": {${body ? '\n' + body + '\n  ' : ''}}\n}\n`
}

/** The CSS colour a stroke is drawn with: "accent" is the theme's accent. */
// The pen's own colours follow the slide's appearance: on dark slides red,
// blue and green are lighter (--pen-* in DARK_TOKENS) and black turns into
// the palette's text colour, so a drawing stays readable when a talk
// switches to dark. "accent" is the theme's accent colour.
const PEN_PAINT = {
  accent: 'var(--accent, #e11d48)',
  '#e11d48': 'var(--pen-red, #e11d48)',
  '#2563eb': 'var(--pen-blue, #2563eb)',
  '#16a34a': 'var(--pen-green, #16a34a)',
  '#111111': 'var(--ink, #111111)',
}
export const inkPaint = color => PEN_PAINT[color] ?? color

/** Strokes in drawing order: highlighter below the pen, as on paper. */
export const inkOrder = strokes => [...strokes.filter(s => s.tool === 'highlighter'), ...strokes.filter(s => s.tool !== 'highlighter')]

/**
 * The end of a straight line from `from` to `to`, turned onto the nearest
 * multiple of `step` degrees when it lies within `tolerance` of it (0°, 15°,
 * 30° … by default); its length stays. Further off, the end stays as drawn.
 */
export function snapAngle([x0, y0], [x, y], { step = 15, tolerance = 4 } = {}) {
  const dx = x - x0, dy = y - y0
  const length = Math.hypot(dx, dy)
  if (!length) return [x, y]
  const angle = Math.atan2(dy, dx) * 180 / Math.PI
  const snapped = Math.round(angle / step) * step
  if (Math.abs(angle - snapped) > tolerance) return [x, y]
  const rad = snapped * Math.PI / 180
  return [Math.round((x0 + Math.cos(rad) * length) * 10) / 10, Math.round((y0 + Math.sin(rad) * length) * 10) / 10]
}

/** The stroke moved by dx, dy design pixels; the same id, so it replaces the original. */
export const translateStroke = (stroke, dx, dy) => ({ ...stroke, points: stroke.points.map(([x, y, p]) => [x + dx, y + dy, p]) })

/** Whether a point lies inside a polygon (ray casting). */
export function insidePolygon([x, y], polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i], [bx, by] = polygon[j]
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside
  }
  return inside
}

/** Strokes with at least half their points inside a lasso. */
export const strokesInLasso = (strokes, lasso) => lasso.length < 3 ? []
  : strokes.filter(stroke => stroke.points.filter(point => insidePolygon(point, lasso)).length * 2 >= stroke.points.length)

/** [x0, y0, x1, y1] around strokes, widened by `pad` and half their size; null for none. */
export function strokesBox(strokes, pad = 0) {
  let box = null
  for (const stroke of strokes) {
    const reach = pad + (stroke.size ?? 6) / 2
    for (const [x, y] of stroke.points) {
      box = box ? [Math.min(box[0], x - reach), Math.min(box[1], y - reach), Math.max(box[2], x + reach), Math.max(box[3], y + reach)] : [x - reach, y - reach, x + reach, y + reach]
    }
  }
  return box
}

/** Opacity the SVG layer draws a tool with. */
export const toolOpacity = tool => tool === 'highlighter' ? 0.35 : 1
