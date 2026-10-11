// Live ink between the windows of one talk: the presenter's view, the
// audience window, other deck windows. Strokes show while they are drawn,
// and every change of the ink (a finished stroke, the eraser, undo) reaches
// the others right away, whether or not a server saves it.
//
// Messages, the same on every transport:
//   { type: 'segment', key, slideId, tool, color, size, from, points }
//       points `from` index on, every ~60 ms while drawing
//   { type: 'end', key, fade, stroke? }  the stroke is finished; a laser
//       trail (tool 'laser', never saved) retracts on its own
//   { type: 'dot', key, slideId, point } the laser's dot (null: hidden), as
//       a hovering pen moves, at most every ~50 ms
//   { type: 'zoom', key, slideId, scale, x, y }  the part of the slide this
//       window shows (stage zoom), at most every ~50 ms
//   { type: 'controls', key, room, controls }  an activity closed or opened,
//       its right answer or results shown or hidden (components/activity.jsx)
//   { type: 'media', key, video, action, time }  a video in the deck played,
//       paused or moved to `time` (components/VideoPlayer.jsx)
//   { type: 'op', op }                  a change of the saved ink (applyOp)
//   { type: 'timer', key, timer }       the talk's countdown (src/runtime/timer.js),
//       when it changes and every few seconds from the window that set it
// Keys start with the sending window's id, so strokes never mix.
import { changeInk, renameSlide } from './store.js'
import { decodeTimer, encodeTimer } from '../timer.js'

const SEGMENT_MS = 60
const DOT_MS = 50
// A window that opens or reloads learns the countdown within this time.
const TIMER_REPEAT_MS = 3000

export function broadcastTransport(name) {
  if (typeof BroadcastChannel === 'undefined') return null
  const channel = new BroadcastChannel(name)
  return {
    send: message => channel.postMessage(message),
    listen: handler => { channel.onmessage = ({ data }) => handler(data) },
    close: () => channel.close(),
  }
}

export function createInkBus(stage, transports) {
  transports = transports.filter(Boolean)
  const me = Math.random().toString(36).slice(2, 8)
  const send = message => { for (const transport of transports) transport.send(message) }

  // The countdown last set here, and whether this window repeats it.
  let timer = null, timerOwned = false
  // Strokes from others, by key: the points so far.
  const incoming = new Map()
  function receive(message) {
    if (!message || typeof message !== 'object' || message.key?.startsWith(`${me}:`)) return
    if (message.type === 'op') {
      if (message.op?.type === 'rename') renameSlide(message.op.from, message.op.to)
      else changeInk(message.op)
    }
    else if (message.type === 'segment') {
      const known = incoming.get(message.key) ?? { ...message, points: [] }
      // A lost segment leaves a gap until the end message repairs it.
      if (message.from <= known.points.length) known.points = [...known.points.slice(0, message.from), ...message.points]
      incoming.set(message.key, known)
      stage.liveStroke(message.key, known)
    } else if (message.type === 'timer') {
      timerOwned = false
      stage.dispatchEvent(new CustomEvent('talktimer', { detail: { timer: message.timer } }))
    } else if (message.type === 'controls') {
      stage.dispatchEvent(new CustomEvent('pollcontrols', { detail: { room: message.room, controls: message.controls } }))
    } else if (message.type === 'media') {
      stage.dispatchEvent(new CustomEvent('mediacontrol', { detail: { video: message.video, action: message.action, time: message.time } }))
    } else if (message.type === 'zoom') {
      if (!message.slideId || message.slideId !== stage._inkSlideId()) return
      const zoom = message.scale > 1 ? { scale: message.scale, x: message.x, y: message.y } : null
      // A hotspot's zoom flies here too; a pinch follows as it comes.
      if (message.fly) stage.flyZoom(zoom, 'remote', { announce: false })
      else stage.setZoom(zoom, 'remote', { announce: false })
    } else if (message.type === 'dot') {
      stage.laserDot(message.key, message.slideId, message.point)
    } else if (message.type === 'end') {
      if (message.stroke) stage.liveStroke(message.key, message.stroke)
      incoming.delete(message.key)
      stage.endLiveStroke(message.key, { fade: !!message.fade })
    }
  }
  for (const transport of transports) transport.listen(receive)

  // Own strokes in progress, sent in small pieces.
  const outgoing = new Map()
  function flush(key) {
    const entry = outgoing.get(key)
    if (!entry) return
    clearTimeout(entry.timer)
    entry.timer = null
    const { detail, sent } = entry
    if (detail.points.length > sent) {
      send({ type: 'segment', key: `${me}:${key}`, slideId: detail.slideId, tool: detail.tool, color: detail.color, size: detail.size, from: sent, points: detail.points.slice(sent) })
      entry.sent = detail.points.length
    }
  }
  stage.addEventListener('inkprogress', ({ detail }) => {
    let entry = outgoing.get(detail.key)
    if (!entry) outgoing.set(detail.key, entry = { detail, sent: 0, timer: null })
    entry.detail = detail
    // A straightened stroke replaces its points: send them again from the start.
    if (detail.restart) entry.sent = 0
    entry.timer ??= setTimeout(() => flush(detail.key), entry.sent ? SEGMENT_MS : 0)
  })
  const finish = (detail, extra = {}) => {
    flush(detail.key)
    outgoing.delete(detail.key)
    send({ type: 'end', key: `${me}:${detail.key}`, ...extra })
  }

  // The laser's dot: the latest position, not every one.
  let dot = null, dotTimer = null
  const sendDot = () => { dotTimer = null; if (dot) send({ type: 'dot', key: `${me}:dot`, ...dot }) }
  stage.addEventListener('inklaserdot', ({ detail }) => {
    dot = detail
    if (!detail.point) { clearTimeout(dotTimer); dotTimer = null; sendDot(); return }
    dotTimer ??= setTimeout(sendDot, DOT_MS)
  })

  // The countdown set here (presenter view → its slide frame): the others
  // follow. This window repeats it while it runs or shows, until another
  // window sets it, so a window that opens later or reloads catches up.
  const sendTimer = () => send({ type: 'timer', key: `${me}:timer`, timer: encodeTimer(timer) })
  stage.addEventListener('talktimer', ({ detail }) => {
    if (!detail?.local) return
    timer = decodeTimer(detail.timer)
    if (!timer) return
    timerOwned = true
    sendTimer()
  })
  setInterval(() => { if (timerOwned && timer && (timer.running || timer.visible)) sendTimer() }, TIMER_REPEAT_MS)

  // An activity's controls changed here: the others follow.
  stage.addEventListener('pollcontrols', ({ detail }) => {
    if (detail?.local) send({ type: 'controls', key: `${me}:controls`, room: detail.room, controls: detail.controls })
  })

  // A video played, paused or moved here: the others do the same.
  stage.addEventListener('mediacontrol', ({ detail }) => {
    if (detail?.local && detail.video) send({ type: 'media', key: `${me}:media`, video: detail.video, action: detail.action, time: detail.time })
  })

  // The zoom: the latest view, not every step of a pinch.
  let zoom = null, zoomTimer = null
  const sendZoom = () => { zoomTimer = null; if (zoom) send({ type: 'zoom', key: `${me}:zoom`, ...zoom }) }
  stage.addEventListener('zoomchange', ({ detail }) => {
    if (detail.reason === 'remote') return
    const { slideId, scale, x, y } = detail
    // A flight is sent at once, with where it lands; the others fly it themselves.
    if (detail.fly) {
      clearTimeout(zoomTimer)
      zoomTimer = zoom = null
      send({ type: 'zoom', key: `${me}:zoom`, slideId, scale, x, y, fly: true })
      return
    }
    zoom = { slideId, scale, x, y }
    zoomTimer ??= setTimeout(sendZoom, scale > 1 ? DOT_MS : 0)
  })

  return {
    /** A change made in this window: the others apply it too. */
    op(op) { send({ type: 'op', key: `${me}:op`, op }) },
    /** The stroke with this key became saved ink (its op was sent first). */
    strokeDone(detail) { finish(detail) },
    /** A laser trail ended: the others let it retract, like this window. */
    laserDone(detail) { finish(detail) },
    close() { for (const transport of transports) transport.close?.() },
  }
}
