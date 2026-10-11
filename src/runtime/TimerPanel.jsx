// The presenter's controls for the talk's countdown (src/runtime/timer.js):
// its length, start and pause, more time, whether the room sees it and where.
// The presenter view passes every change to its slide frame, which tells
// the audience window, a paired iPad and phones following the talk.
import { h } from 'preact'
import { useState } from 'preact/hooks'
import { Icon } from '../components/Icon.jsx'
import { S } from './chrome.jsx'
import { useTimerTick } from './TimerOverlay.jsx'
import { TIMER_PRESETS, addTime, formatTime, pauseTimer, resetTimer, setDuration, startTimer, timeLeft } from './timer.js'

export { useTimerTick }

// In the order they sit on the screen.
const PLACES = { 'top-left': ['↖', 'Top left'], 'top-right': ['↗', 'Top right'], 'bottom-left': ['↙', 'Bottom left'], 'bottom-right': ['↘', 'Bottom right'], center: ['◉', 'Big, in the middle'] }


/** `onChange(change)`: `change` turns the latest timer into the next. */
export function TimerPanel({ timer, onChange, style }) {
  useTimerTick(timer)
  const left = timeLeft(timer)
  const [custom, setCustom] = useState('')
  const on = active => active ? { background: '#2d3b4a', borderColor: '#4a6a8a', color: '#fff' } : {}
  const small = { ...S.btn, padding: '4px 8px', minWidth: '34px' }
  const useCustom = () => { const minutes = Number(String(custom).replace(',', '.')); if (minutes > 0) { onChange(t => setDuration(t, minutes)); setCustom('') } }
  return <div class="presenter-timer" style={{ display: 'flex', flexDirection: 'column', gap: '8px', ...style }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
      <span class="presenter-timer-time" style={{ fontVariantNumeric: 'tabular-nums', fontSize: '26px', fontWeight: 400, color: left === 0 ? '#ff6b6b' : left <= 60000 ? '#ffcc4d' : timer.running ? '#f0f0f0' : '#888' }}>{formatTime(left)}</span>
      <span style={{ display: 'flex', gap: '4px' }}>
        <button class="presenter-timer-start" style={small} title={timer.running ? 'Pause the countdown' : 'Start the countdown'} aria-label={timer.running ? 'Pause the countdown' : 'Start the countdown'} onClick={() => onChange(t => t.running ? pauseTimer(t) : startTimer(t))}><Icon name={timer.running ? 'pause' : 'play'} size={16} /></button>
        <button style={small} title="One more minute" onClick={() => onChange(t => addTime(t, 1))}>+1′</button>
        <button style={small} title="Back to the full length" aria-label="Reset the countdown" onClick={() => onChange(t => resetTimer(t))}><Icon name="reset" size={16} /></button>
        <button class="presenter-timer-show" style={{ ...small, ...on(timer.visible) }} title={timer.visible ? 'Hide the countdown from the room' : 'Show the countdown to the room'} aria-pressed={timer.visible} onClick={() => onChange(t => ({ ...t, visible: !t.visible }))}><Icon name={timer.visible ? 'eye' : 'eye-off'} size={16} /></button>
      </span>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
      {TIMER_PRESETS.map(minutes => <button style={{ ...small, ...on(timer.duration === minutes * 60000) }} title={`${minutes} minutes`} onClick={() => onChange(t => setDuration(t, minutes))}>{minutes}′</button>)}
      <input type="text" inputmode="decimal" placeholder="min" aria-label="Minutes" value={custom} onInput={event => setCustom(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') useCustom() }} onBlur={useCustom}
        style={{ ...S.select, width: '52px', padding: '4px 6px' }} />
    </div>
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }} role="group" aria-label="Where the room sees the countdown">
      {Object.keys(PLACES).map(place => <button class="presenter-timer-place" data-place={place} style={{ ...small, ...on(timer.position === place) }} title={PLACES[place][1]} aria-pressed={timer.position === place} onClick={() => onChange(t => ({ ...t, position: place }))}>{PLACES[place][0]}</button>)}
    </div>
  </div>
}
