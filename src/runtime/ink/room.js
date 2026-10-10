// The talk across devices, through the deck's stage room on the server
// (built into `mdeck run`, or `mdeck server`): an iPad draws and steers, the
// laptop's audience window on the projector follows, and navigation on the
// laptop reaches the iPad too.
//
// Main slide frames and audience windows share one connection for ink and
// position. Next-slide previews do not connect, since browsers allow few
// connections per server.
import { stageRoom } from '../../live/client.js'
import { presenceQuery } from '../../live/presence.js'

// Live ink waits this long to gather a batch; with one request at a time the
// network sets the pace, so a short wait adds little load and little lag.
const BATCH_MS = 25

/**
 * An ink bus transport through the stage room; `listen` only when `receive`.
 * `view` counts this window as connected; `onPresence` hears who else is.
 */
export function roomTransport({ receive = false, view = null, onPresence = null } = {}) {
  const room = stageRoom()
  let queue = [], timer = null, allowed = null, listeners = 1, source = null, sending = false

  // One request at a time: two in flight could arrive in the other order.
  async function flush() {
    timer = null
    if (!queue.length || sending) return
    sending = true
    try { await deliver() } finally { sending = false }
    // What came in meanwhile has waited already: send it right away.
    if (queue.length) timer ??= setTimeout(flush, 0)
  }

  async function deliver() {
    const messages = queue.splice(0, 100)
    if (allowed === null) {
      const info = await room.info()
      allowed = info.reachable ? !!info.canReset : null
      if (!allowed) { queue = []; return }
    }
    try {
      const response = await fetch(`${room.url}/ink`, { method: 'POST', headers: room.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ messages }) })
      if (response.status === 403) { allowed = false; queue = []; return }
      if (response.ok) listeners = (await response.json()).listeners ?? 1
    } catch {
      // The network failed (an iPad's WLAN): send them again, or the others
      // keep a gap. A repeated segment only writes the same points again.
      queue.unshift(...messages)
    }
  }

  return {
    send(message) {
      if (allowed === false) return
      // Nobody on another device watches: strokes in progress can stay here.
      // Strokes in progress, the laser's dot and the zoom only matter to
      // someone watching.
      const live = message.type === 'segment' || message.type === 'dot' || message.type === 'zoom'
      if (live && listeners === 0) return
      queue.push(message)
      timer ??= setTimeout(flush, live ? BATCH_MS : 0)
    },
    listen(handler) {
      if (!receive || typeof EventSource === 'undefined') return
      source = new EventSource(`${room.url}/events?${presenceQuery({ view, listen: !!onPresence })}`)
      source.addEventListener('snapshot', event => {
        const snapshot = JSON.parse(event.data)
        for (const message of snapshot.ink ?? []) handler(message)
        if (snapshot.presence) onPresence?.(snapshot.presence)
      })
      if (onPresence) source.addEventListener('presence', event => onPresence(JSON.parse(event.data)))
      source.addEventListener('ink', event => { for (const message of JSON.parse(event.data).messages) handler(message) })
      for (const listener of stateListeners) source.addEventListener('snapshot', event => listener(JSON.parse(event.data).state))
      for (const listener of stateListeners) source.addEventListener('state', event => listener(JSON.parse(event.data).state))
    },
    close() { source?.close() },
  }
}

// Position followers, attached before the transport listens.
const stateListeners = new Set()

/** Follow navigation from another device in either kind of main slide window. */
export function followStageRoom(stage) {
  stateListeners.add(state => {
    if (!state || state.screen === stageRoom().screen || !Number.isInteger(state.index)) return
    const current = stage.state
    if (current?.index === state.index && current?.step === state.step) return
    stage.setState({ index: state.index, step: state.step ?? -1, slideId: state.slideId })
  })
}

/** Hear the position other devices announce (the follow view decides what to do with it). */
export function onStagePosition(listener) {
  stateListeners.add(state => {
    if (!state || state.screen === stageRoom().screen || !Number.isInteger(state.index)) return
    listener({ index: state.index, step: state.step ?? -1, slideId: state.slideId })
  })
}

/** Publish navigation made here; received positions never echo back. */
export function announceStagePosition(stage) {
  const room = stageRoom()
  let allowed = null, last = null
  async function post(event) {
    const { index, step, slideId } = stage.state
    const key = `${slideId}:${index}:${step}`
    if (event?.detail.reason === 'sync') { last = key; return }
    if (key === last || allowed === false) return
    // Opening a window must not move the projector; only changes count.
    const at = !event || event.detail.reason === 'init' ? 0 : Date.now()
    last = key
    if (allowed === null) {
      const info = await room.info()
      allowed = info.reachable && !!info.canReset
      if (!allowed) return
    }
    fetch(`${room.url}/state`, { method: 'POST', headers: room.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ state: { index, step, slideId, at, screen: room.screen } }) }).catch(() => {})
  }
  stage.addEventListener('statechange', post)
  post()
}
