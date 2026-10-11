// The talk's countdown, shown big in the audience window when the presenter
// wants it (TimerOverlay.jsx) and set in the presenter view. Windows tell each
// other the time left, not a clock time, so an iPad and a laptop whose clocks
// differ still agree: each one counts down from when the message arrived.
//
// A timer here: { running, endsAt, remaining, duration, visible, position },
// `endsAt` (this window's clock) only while running, `remaining` while not.
// On the wire: { running, remaining, duration, visible, position }.

export const TIMER_POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'center']
export const TIMER_PRESETS = [1, 3, 5, 10, 15, 30]

const MINUTE = 60000

export function newTimer(minutes = 5) {
  const duration = Math.round(minutes * MINUTE)
  return { running: false, endsAt: null, remaining: duration, duration, visible: false, position: 'top-right' }
}

/** Milliseconds left at `now`, never below zero. */
export function timeLeft(timer, now = Date.now()) {
  if (!timer) return 0
  return Math.max(0, timer.running ? timer.endsAt - now : timer.remaining)
}

/** What another window needs to show the same timer. */
export function encodeTimer(timer, now = Date.now()) {
  return { running: !!timer.running && timeLeft(timer, now) > 0, remaining: timeLeft(timer, now), duration: timer.duration, visible: !!timer.visible, position: timer.position }
}

/** A timer from another window's message, counted from `now`. */
export function decodeTimer(message, now = Date.now()) {
  if (!message || typeof message !== 'object') return null
  const number = value => Number.isFinite(value) && value >= 0 ? value : 0
  const remaining = number(message.remaining), duration = number(message.duration) || remaining
  const running = !!message.running && remaining > 0
  const position = TIMER_POSITIONS.includes(message.position) ? message.position : 'top-right'
  return { running, endsAt: running ? now + remaining : null, remaining, duration, visible: !!message.visible, position }
}

// A message tells the time left when it was sent; it arrives a little later.
// A repetition that differs only by that delay must not move the countdown,
// or it would jump back a bit every few seconds.
const DRIFT_MS = 1500

/** The timer a window shows after a message: `incoming`, unless it only repeats `current`. */
export function followTimer(current, incoming) {
  if (!current || !incoming) return incoming ?? current
  const same = current.running && incoming.running && current.duration === incoming.duration
    && current.visible === incoming.visible && current.position === incoming.position
    && Math.abs(current.endsAt - incoming.endsAt) < DRIFT_MS
  return same ? current : incoming
}

/** Milliseconds until the time shown changes (seconds round up). */
export function untilNextSecond(timer, now = Date.now()) {
  const left = timeLeft(timer, now)
  return left <= 0 ? null : (left % 1000 || 1000) + 5
}

export const startTimer = (timer, now = Date.now()) => {
  const left = timeLeft(timer, now) || timer.duration
  return { ...timer, running: true, endsAt: now + left, remaining: left }
}
export const pauseTimer = (timer, now = Date.now()) => ({ ...timer, running: false, endsAt: null, remaining: timeLeft(timer, now) })
export const resetTimer = timer => ({ ...timer, running: false, endsAt: null, remaining: timer.duration })
/** A new length; a running timer starts again with it. */
export function setDuration(timer, minutes, now = Date.now()) {
  const duration = Math.max(1000, Math.round(minutes * MINUTE))
  return timer.running ? { ...timer, duration, remaining: duration, endsAt: now + duration } : { ...timer, duration, remaining: duration, endsAt: null }
}
/** More (or with a negative number less) time, also while running. */
export function addTime(timer, minutes, now = Date.now()) {
  const left = Math.max(0, timeLeft(timer, now) + minutes * MINUTE)
  return timer.running ? { ...timer, endsAt: now + left, remaining: left } : { ...timer, remaining: left }
}

/** 4:05, 12:00 or 1:02:03; seconds round up, so 0:00 shows only at the end. */
export function formatTime(ms) {
  const total = Math.ceil(Math.max(0, ms) / 1000)
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60
  const two = n => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(s)}` : `${Math.floor(total / 60)}:${two(s)}`
}
