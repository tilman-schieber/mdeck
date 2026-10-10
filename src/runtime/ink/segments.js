// A stroke drawn in another window arrives in segments: { from, points },
// the points from index `from` on. Segments can arrive out of order, and one
// can be lost: one that starts past the points known waits in `early` until
// the gap is filled, rather than being dropped with all that follow it. A
// lost one leaves the gap until the stroke's end message repairs it.

/** Adds a segment to `known` ({ points, early }) and returns it. */
export function joinSegment(known, { from, points }) {
  known.early ??= new Map()
  known.early.set(from, points)
  for (let joined = true; joined;) {
    joined = false
    for (const [at, more] of known.early) {
      if (at > known.points.length) continue
      known.points = [...known.points.slice(0, at), ...more]
      known.early.delete(at)
      joined = true
    }
  }
  return known
}
