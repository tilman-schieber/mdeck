import { h } from 'preact'
import { useMemo } from 'preact/hooks'
import { strokePath, toolOpacity, inkPaint, inkOrder, ROOM_SCALE } from '../../core/ink.js'
import { useSlideInk, currentInk } from './store.js'

// The saved ink of one slide, drawn above its content. It sits inside the
// slide's <section>, so it scales with the stage, prints, and appears in the
// reader's Read mode and in PDFs. It never takes pointer input. `room`: the
// layer covers an expanded slide and the room around it (Room.jsx).
export function InkLayer({ slideId, room = false }) {
  const strokes = useSlideInk(slideId)
  const paths = useMemo(() => inkOrder(strokes).map(stroke => ({ id: stroke.id, d: strokePath(stroke), color: stroke.color, opacity: toolOpacity(stroke.tool), tool: stroke.tool })), [strokes])
  if (!paths.length) return null
  const { width, height } = currentInk()
  const reach = room ? 1 / ROOM_SCALE : 1
  return <svg class="slide-ink" viewBox={`0 0 ${width * reach} ${height * reach}`} preserveAspectRatio="none" aria-hidden="true">
    {paths.map(path => <path key={path.id} d={path.d} style={{ fill: inkPaint(path.color) }} fill-opacity={path.opacity} data-tool={path.tool} />)}
  </svg>
}
