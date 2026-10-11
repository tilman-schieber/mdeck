// The talk's countdown as the room sees it: big digits over the slides of a
// deck or audience window, in a corner or in the middle, while the presenter
// shows it (set in the presenter view, carried by the ink bus as `talktimer`
// events; src/runtime/timer.js). The last minute turns amber, the end red.
import { h, render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
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

function TalkTimer({ stage }) {
  const [timer, setTimer] = useState(null)
  useEffect(() => {
    // A repetition from the window that set it only moves the countdown if it really changed.
    const follow = event => { const next = decodeTimer(event.detail?.timer); if (next) setTimer(current => followTimer(current, next)) }
    stage.addEventListener('talktimer', follow)
    return () => stage.removeEventListener('talktimer', follow)
  }, [stage])
  useTimerTick(timer?.visible ? timer : null)
  if (!timer?.visible) return null
  const left = timeLeft(timer)
  return <div class={`talk-timer talk-timer--${timer.position}`} role="timer" aria-live="off"
    data-ending={left > 0 && left <= 60000 ? '' : undefined} data-done={left === 0 ? '' : undefined}>{formatTime(left)}</div>
}

/** Shows the countdown over this window's slides whenever the presenter shows it. */
export function mountTalkTimer(stage) {
  const host = document.createElement('div')
  host.className = 'talk-timer-host export-hidden'
  document.body.appendChild(host)
  render(<TalkTimer stage={stage} />, host)
}
