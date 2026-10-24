// What <pinpoint> needs on the slide, on the phones (src/live/answer/answer.js
// repeats isInside) and in the results (src/core/resultsReport.js): where a
// tap landed, and whether it is inside the circle `answer` names.
//
// A tap is { x, y }, each from 0 to 1 across the picture's width and height.
// `answer="62% 31% 8%"` is a circle in percent of the picture (the radius of
// its width); `answer="412 230 40"` is the same in pixels of the picture as
// stored, as an image editor shows them. Spaces or commas separate them.

const round = value => Math.round(value * 10000) / 10000

/** A tap as sent, or null: two numbers from 0 to 1. */
export function tapOf(value) {
  const x = Number(value?.x), y = Number(value?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x: round(x), y: round(y) }
}

/** `answer` as written: { x, y, r, unit: '%' | 'px' }, or null. */
export function parseTarget(text) {
  const parts = String(text ?? '').trim().split(/[\s,;]+/).filter(Boolean)
  if (parts.length !== 3) return null
  const percent = parts.every(part => part.endsWith('%'))
  if (!percent && parts.some(part => part.endsWith('%'))) return null
  const [x, y, r] = parts.map(part => Number(part.replace(/%$/, '')))
  if (![x, y, r].every(Number.isFinite) || x < 0 || y < 0 || r <= 0) return null
  return { x, y, r, unit: percent ? '%' : 'px' }
}

/**
 * The circle as taps are measured: { x, y, r, ratio }, with `r` across the
 * width and `ratio` the picture's height over its width. Pixels need the
 * picture's own size; without it (not loaded yet) there is no circle.
 */
export function targetOn(target, size) {
  const { width, height } = size ?? {}
  if (!target || !(width > 0) || !(height > 0)) return null
  const ratio = height / width
  if (target.unit === '%') return { x: target.x / 100, y: target.y / 100, r: target.r / 100, ratio }
  return { x: target.x / width, y: target.y / height, r: target.r / width, ratio }
}

/** A circle as kept or sent ({ x, y, r, ratio }), or null. */
export const circleOf = value => ['x', 'y', 'r', 'ratio'].every(key => Number.isFinite(value?.[key])) && value.r > 0 && value.ratio > 0 ? value : null

/** Whether a tap is inside the circle, measured in widths so the circle stays round. */
export function isInside(tap, circle) {
  if (!tap || !circle) return false
  return Math.hypot(tap.x - circle.x, (tap.y - circle.y) * circle.ratio) <= circle.r
}

/** A tap as people read it: "62.1% 31.4%". */
export const tapText = tap => `${Math.round(tap.x * 1000) / 10}% ${Math.round(tap.y * 1000) / 10}%`
