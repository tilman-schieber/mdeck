// The talk's countdown, shown big in the audience window when the presenter
// wants it (TimerOverlay.jsx) and set in the presenter view. Windows tell each
// other the time left, not a clock time, so an iPad and a laptop whose clocks
// differ still agree: each one counts down from when the message arrived.
//
// A timer here: { running, endsAt, remaining, duration, visible, position,
// sound, volume, quiet, test }, `endsAt` (this window's clock) only while
// running, `remaining` while not. `sound` is the file played when it ends
// (one of the deck's `timer.sounds`, or null), `quiet` stops that sound,
// and a new `test` number plays it once to try it out.
// On the wire: the same without `endsAt`.

export const TIMER_POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'center']
export const TIMER_PRESETS = [1, 3, 5, 10, 15, 30]

const MINUTE = 60000

export function newTimer(minutes = 5, { sound = null } = {}) {
  const duration = Math.round(minutes * MINUTE)
  return { running: false, endsAt: null, remaining: duration, duration, visible: false, position: 'top-right', sound, volume: 0.8, quiet: false, test: 0 }
}

/**
 * The sounds a deck offers for the end of its countdown, from its settings:
 * `timer: { sounds: { Gong: ./sounds/gong.mp3, Pause: ./sounds/pause.mp3 } }`,
 * or a list of files named after themselves. [{ name, src }]
 */
export function timerSounds(deckConfig = {}) {
  const sounds = deckConfig?.timer?.sounds
  const named = Array.isArray(sounds)
    ? sounds.filter(src => typeof src === 'string' && src.trim()).map(src => [src.split('/').pop().replace(/\.[^.]+$/, ''), src])
    : sounds && typeof sounds === 'object' ? Object.entries(sounds).filter(([, src]) => typeof src === 'string' && src.trim()) : []
  return named.map(([name, src]) => ({ name: String(name), src: src.trim() }))
}

/** Milliseconds left at `now`, never below zero. */
export function timeLeft(timer, now = Date.now()) {
  if (!timer) return 0
  return Math.max(0, timer.running ? timer.endsAt - now : timer.remaining)
}

/** What another window needs to show the same timer. */
export function encodeTimer(timer, now = Date.now()) {
  return { running: !!timer.running && timeLeft(timer, now) > 0, remaining: timeLeft(timer, now), duration: timer.duration, visible: !!timer.visible, position: timer.position, sound: timer.sound ?? null, volume: timer.volume ?? 0.8, quiet: !!timer.quiet, test: timer.test || 0 }
}

/** A timer from another window's message, counted from `now`. */
export function decodeTimer(message, now = Date.now()) {
  if (!message || typeof message !== 'object') return null
  const number = value => Number.isFinite(value) && value >= 0 ? value : 0
  const remaining = number(message.remaining), duration = number(message.duration) || remaining
  const running = !!message.running && remaining > 0
  const position = TIMER_POSITIONS.includes(message.position) ? message.position : 'top-right'
  const volume = Number.isFinite(message.volume) ? Math.min(1, Math.max(0, message.volume)) : 0.8
  const sound = typeof message.sound === 'string' && message.sound ? message.sound : null
  return { running, endsAt: running ? now + remaining : null, remaining, duration, visible: !!message.visible, position, sound, volume, quiet: !!message.quiet, test: number(message.test) }
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
    && current.sound === incoming.sound && current.volume === incoming.volume
    && current.quiet === incoming.quiet && current.test === incoming.test
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
  return { ...timer, running: true, endsAt: now + left, remaining: left, quiet: false }
}
export const pauseTimer = (timer, now = Date.now()) => ({ ...timer, running: false, endsAt: null, remaining: timeLeft(timer, now) })
export const resetTimer = timer => ({ ...timer, running: false, endsAt: null, remaining: timer.duration, quiet: false })
/** A new length; a running timer starts again with it. */
export function setDuration(timer, minutes, now = Date.now()) {
  const duration = Math.max(1000, Math.round(minutes * MINUTE))
  return timer.running ? { ...timer, duration, remaining: duration, endsAt: now + duration, quiet: false } : { ...timer, duration, remaining: duration, endsAt: null, quiet: false }
}
/** More (or with a negative number less) time, also while running. */
export function addTime(timer, minutes, now = Date.now()) {
  const left = Math.max(0, timeLeft(timer, now) + minutes * MINUTE)
  return timer.running ? { ...timer, endsAt: now + left, remaining: left } : { ...timer, remaining: left }
}

/** Stops the sound of an ended countdown. */
export const quietTimer = timer => ({ ...timer, quiet: true })
/** Plays the chosen sound once, to try it before the talk. */
export const testSound = timer => ({ ...timer, test: (timer.test || 0) + 1 })

/** 4:05, 12:00 or 1:02:03; seconds round up, so 0:00 shows only at the end. */
export function formatTime(ms) {
  const total = Math.ceil(Math.max(0, ms) / 1000)
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60
  const two = n => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(s)}` : `${Math.floor(total / 60)}:${two(s)}`
}
