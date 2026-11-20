// The steps of a slide: what appears one press at a time.
//
// Steps follow the slide's document order. Inside an SVG drawing that order
// is also what is drawn on top, so a drawing may number its parts instead:
// `data-step="2"` shows after `data-step="1"`, and parts with the same number
// appear together. A drawing's numbered steps take the place of its first
// one; parts with a bare `data-step` keep their own place.

// [[element, …], …]: each step's elements, in the order they are shown.
export function slideSteps(slide) {
  if (!slide) return []
  const order = []
  const drawings = new Map()
  // A copy of a slide (beside its room in print) shows all of it at once.
  for (const element of slide.querySelectorAll('[data-step]:not([data-slide-copy] [data-step])')) {
    const drawing = element.closest('svg')
    const number = numbered(element.getAttribute('data-step'))
    if (!drawing || number == null) { order.push([element]); continue }
    let parts = drawings.get(drawing)
    if (!parts) {
      parts = new Map()
      drawings.set(drawing, parts)
      order.push(parts)
    }
    if (!parts.has(number)) parts.set(number, [])
    parts.get(number).push(element)
  }
  return order.flatMap(entry => entry instanceof Map
    ? [...entry.keys()].sort((a, b) => a - b).map(number => entry.get(number))
    : [entry])
}

function numbered(value) {
  if (value == null || !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
