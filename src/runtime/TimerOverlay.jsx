// The talk's countdown as the room sees it: big digits over the slides of a
// deck or audience window, in a corner or in the middle, while the presenter
// shows it (set in the presenter view, carried by the ink bus as `talktimer`
// events; src/runtime/timer.js). The last minute turns amber, the end red.
// At the end it plays the chosen sound, in the one window that has the
// room's sound (`plays`): the audience window, else the presenter's frame.
import { h, render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { t } from '../core/labels.js'
import { decodeTimer, followTimer, formatTime, timeLeft, untilNextSecond } from './timer.js'
import './timer-overlay.css'

/** Re-renders a running timer exactly when the second shown changes, so the seconds tick evenly. */
export function useTimerTick(timer) {
  const [, tick] = useState(0)
  useEffect(() => {
    const wait = timer?.running ? untilNextSecond(timer) : null
    if (wait == null) return
    const id = setTimeout(() => tick(n => n + 1), wait)
    return () => clearTimeout(id)
  })
}

// The end sound: played once when the countdown reaches zero here (or another
// screen says it did), not in a window that opened after the end; stopped by
// "quiet", a new start or a reset; a new `test` number plays it once. A
// browser lets a page play sound only after a click in it, so the window
// offers one (`offer`).
function useEndSound(timer, plays) {
  const audioRef = useRef(null), rung = useRef(false), sawRunning = useRef(false), lastTest = useRef(null)
  const [offer, setOffer] = useState(false)
  const audio = () => {
    if (!timer?.sound) return null
    let element = audioRef.current
    if (!element || element.dataset.src !== timer.sound) {
      element?.pause()
      element = new Audio(timer.sound)
      element.dataset.src = timer.sound
      element.preload = 'auto'
      audioRef.current = element
    }
    element.volume = timer.volume ?? 0.8
    return element
  }
  const stop = () => { const element = audioRef.current; if (element && !element.paused) { element.pause(); element.currentTime = 0 } }
  const play = () => {
    if (!plays()) return
    const element = audio()
    if (!element) return
    element.currentTime = 0
    element.play().then(() => setOffer(false)).catch(error => { if (error?.name === 'NotAllowedError') setOffer(true) })
  }
  useEffect(() => {
    if (!timer) return
    if (!timer.sound || timer.quiet) { stop(); return }
    if (audioRef.current) audioRef.current.volume = timer.volume ?? 0.8
    const left = timeLeft(timer)
    if (left > 0) {
      rung.current = false
      stop()
      if (!timer.running) return
      sawRunning.current = true
      const id = setTimeout(() => { if (!rung.current) { rung.current = true; play() } }, left)
      return () => clearTimeout(id)
    }
    if (sawRunning.current && !rung.current) { rung.current = true; play() }
  }, [timer])
  useEffect(() => {
    if (!timer) return
    if (lastTest.current !== null && timer.test !== lastTest.current) play()
    lastTest.current = timer.test
  }, [timer?.test])
  // A click here lets the page play sound; it also plays an end sound that was held back.
  const allow = () => {
    setOffer(false)
    const element = audio()
    if (!element) return
    if (timer && !timer.quiet && timeLeft(timer) === 0 && sawRunning.current) { play(); return }
    element.muted = true
    element.play().then(() => { element.pause(); element.currentTime = 0; element.muted = false }).catch(() => { element.muted = false })
  }
  const blocked = !!timer?.sound && plays() && (offer || navigator.userActivation?.hasBeenActive === false)
  return { blocked, allow }
}

function TalkTimer({ stage, plays }) {
  const [timer, setTimer] = useState(null)
  useEffect(() => {
    // A repetition from the window that set it only moves the countdown if it really changed.
    const follow = event => { const next = decodeTimer(event.detail?.timer); if (next) setTimer(current => followTimer(current, next)) }
    stage.addEventListener('talktimer', follow)
    return () => stage.removeEventListener('talktimer', follow)
  }, [stage])
  useTimerTick(timer?.visible ? timer : null)
  const [, activated] = useState(0)
  // Any click or key in this window lets it play sound: the offer goes.
  useEffect(() => {
    const done = () => activated(n => n + 1)
    window.addEventListener('pointerdown', done, { once: true, capture: true })
    window.addEventListener('keydown', done, { once: true, capture: true })
    return () => { window.removeEventListener('pointerdown', done, true); window.removeEventListener('keydown', done, true) }
  }, [])
  const sound = useEndSound(timer, plays)
  const left = timer ? timeLeft(timer) : 0
  return <>
    {timer?.visible && <div class={`talk-timer talk-timer--${timer.position}`} role="timer" aria-live="off"
      data-ending={left > 0 && left <= 60000 ? '' : undefined} data-done={left === 0 ? '' : undefined}>{formatTime(left)}</div>}
    {sound.blocked && <button type="button" class="talk-timer-sound" onClick={() => { sound.allow(); activated(n => n + 1) }}>{t('video.sound')}</button>}
  </>
}

/**
 * Shows the countdown over this window's slides whenever the presenter shows
 * it; `plays()` says whether this window plays its end sound.
 */
export function mountTalkTimer(stage, { plays = () => false } = {}) {
  const host = document.createElement('div')
  host.className = 'talk-timer-host export-hidden'
  document.body.appendChild(host)
  render(<TalkTimer stage={stage} plays={plays} />, host)
}
