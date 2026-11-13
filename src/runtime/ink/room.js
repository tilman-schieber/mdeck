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
import { retryDelay, compactOutbox, batchSize } from './outbox.js'

// Live ink waits this long to gather a batch; with one request at a time the
// network sets the pace, so a short wait adds little load and little lag.
const BATCH_MS = 25

// A "not allowed" lasts until pairing may have changed: the page is shown
// again or reconnects, or another tab pairs this device (its token appears).
const recheck = new Set()
let watching = false
function watchPairing() {
  if (watching || typeof window === 'undefined') return
  watching = true
  const again = () => { for (const check of recheck) check() }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') again() })
  window.addEventListener('storage', event => { if (event.key?.startsWith('mdeck-pair:')) again() })
  window.addEventListener('online', again)
}

/**
 * An ink bus transport through the stage room; `listen` only when `receive`.
 * `view` counts this window as connected; `onPresence` hears who else is.
 */
export function roomTransport({ receive = false, view = null, onPresence = null } = {}) {
  const room = stageRoom()
  let queue = [], timer = null, allowed = null, listeners = 1, source = null, sending = false, failures = 0
  watchPairing()
  recheck.add(() => { if (allowed === false) { allowed = null; room.forget() } })

  // One request at a time: two in flight could arrive in the other order.
  async function flush() {
    timer = null
    if (!queue.length || sending) return
    sending = true
    try { await deliver() } finally { sending = false }
    // What came in meanwhile has waited already: send it right away, unless
    // the last attempt failed; then wait longer each time.
    if (queue.length) timer ??= setTimeout(flush, retryDelay(failures))
  }

  // The batch goes back to the front, to be sent again after a wait.
  function retry(messages) {
    failures++
    queue = compactOutbox([...messages, ...queue])
  }

  async function deliver() {
    const messages = queue.splice(0, batchSize(queue))
    if (allowed === null) {
      let info
      try { info = await room.info() } catch { return retry(messages) }
      allowed = info.reachable ? !!info.canReset : null
      if (!allowed) { queue = []; return }
    }
    try {
      const response = await fetch(`${room.url}/ink`, { method: 'POST', headers: room.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ messages }) })
      if (response.status === 403) { allowed = false; queue = []; return }
      // A server that is busy or restarting gets them again, as a lost network does.
      if (response.status >= 500 || response.status === 429) return retry(messages)
      failures = 0
      // Too large even alone (one very long stroke for an older server): the
      // others miss it until the saved ink reaches them (attach.js).
      if (response.status === 413) console.warn('mdeck: live ink too large for the stage room; the other screens get it from the saved drawings')
      if (response.ok) listeners = (await response.json()).listeners ?? 1
    } catch {
      // The network failed (an iPad's WLAN): send them again, or the others
      // keep a gap. A repeated segment only writes the same points again.
      retry(messages)
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
      source.addEventListener('open', () => { if (allowed === false) { allowed = null; room.forget() } })
      // Connected again to an empty room: mdeck run restarted. The screens
      // still open say where they are, so that a presenter view opened now
      // takes up the slide on the projector.
      let snapshots = 0
      source.addEventListener('snapshot', event => { if (++snapshots > 1 && !JSON.parse(event.data).state) for (const again of reannounce) again() })
      for (const listener of stateListeners) source.addEventListener('state', event => listener(JSON.parse(event.data).state))
    },
    close() { source?.close() },
  }
}

// Position followers, attached before the transport listens.
const stateListeners = new Set()
// Windows that announce their position, to say it again to a new room.
const reannounce = new Set()

/**
 * Follow navigation from another device in either kind of main slide window.
 * `onLanguage(lang, state)` switches a deck in several languages to the one
 * shown there, at that state, and says whether it did.
 */
export function followStageRoom(stage, { onLanguage } = {}) {
  stateListeners.add(state => {
    if (!state || state.screen === stageRoom().screen || !Number.isInteger(state.index)) return
    // A window that just opened (`at: 0`) moves no other: after a restart of
    // mdeck run the room is empty, and a presenter view opened or reloaded
    // then would take the projector back to the first slide.
    if (!state.at) return
    const position = { index: state.index, step: state.step ?? -1, slideId: state.slideId, ...(typeof state.blank === 'boolean' ? { blank: state.blank } : {}), ...(typeof state.join === 'boolean' ? { join: state.join } : {}), ...('freeze' in state ? { freeze: state.freeze ?? null } : {}) }
    if (state.lang && onLanguage?.(state.lang, position)) return
    const current = stage.state
    if (current?.index === state.index && current?.step === state.step && (position.blank === undefined || current?.blank === position.blank) && (position.join === undefined || current?.join === position.join) && (position.freeze === undefined || JSON.stringify(current?.freeze) === JSON.stringify(position.freeze))) return
    stage.setState(position)
  })
}

/** Hear the position other devices announce (the follow view decides what to do with it). */
export function onStagePosition(listener) {
  stateListeners.add(state => {
    if (!state || state.screen === stageRoom().screen || !Number.isInteger(state.index)) return
    listener({ index: state.index, step: state.step ?? -1, slideId: state.slideId, lang: state.lang, blank: state.blank, join: state.join, freeze: state.freeze ?? null })
  })
}

/**
 * Publish navigation made here; received positions never echo back.
 * `language()` names the language shown, in a deck that has several. Returns
 * a function to call when that changes.
 */
export function announceStagePosition(stage, { language = () => null } = {}) {
  const room = stageRoom()
  let allowed = null, last = null
  watchPairing()
  async function post(event) {
    const { index, step, slideId, blank, join, freeze } = stage.state
    const lang = language() ?? undefined
    const key = `${slideId}:${index}:${step}:${lang}:${blank}:${join}:${JSON.stringify(freeze)}`
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
    fetch(`${room.url}/state`, { method: 'POST', headers: room.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ state: { index, step, slideId, lang, blank, join, freeze, at, screen: room.screen } }) })
      .then(response => { if (response.status === 403) { allowed = false; room.forget() } }, () => {})
  }
  // Asked again when pairing may have changed; a position kept back is then said.
  recheck.add(() => { if (allowed === false) { allowed = null; room.forget(); last = null; post({ detail: { reason: 'reconnect' } }) } })
  stage.addEventListener('statechange', post)
  reannounce.add(() => { last = null; post({ detail: { reason: 'reconnect' } }) })
  post()
  return () => post({ detail: { reason: 'language' } })
}
