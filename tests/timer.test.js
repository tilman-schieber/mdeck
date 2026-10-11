import test from 'node:test'
import assert from 'node:assert/strict'
import { newTimer, timeLeft, encodeTimer, decodeTimer, startTimer, pauseTimer, resetTimer, setDuration, addTime, formatTime, followTimer, untilNextSecond, timerSounds, quietTimer, testSound } from '../src/runtime/timer.js'

test('a timer counts down while running and keeps its time while paused', () => {
  let timer = startTimer(newTimer(3), 1000)
  assert.equal(timeLeft(timer, 1000), 180000)
  assert.equal(timeLeft(timer, 61000), 120000)
  timer = pauseTimer(timer, 61000)
  assert.equal(timeLeft(timer, 999999), 120000)
  timer = startTimer(timer, 100000)
  assert.equal(timeLeft(timer, 220000), 0, 'never below zero')
  assert.equal(timeLeft(resetTimer(timer), 0), 180000)
})

test('windows pass on the time left, so their clocks need not agree', () => {
  const ipad = startTimer(newTimer(5), 1_000_000)
  const sent = encodeTimer({ ...ipad, visible: true, position: 'center' }, 1_030_000)
  assert.deepEqual(sent, { running: true, remaining: 270000, duration: 300000, visible: true, position: 'center', sound: null, volume: 0.8, quiet: false, test: 0 })
  // The laptop's clock is far off; it counts from when the message arrived.
  const laptop = decodeTimer(sent, 5_000)
  assert.equal(timeLeft(laptop, 65_000), 210000)
  assert.equal(decodeTimer({ remaining: -5, position: 'nowhere', running: true }).position, 'top-right')
  assert.equal(decodeTimer({ remaining: -5, running: true }).running, false, 'an ended timer does not run')
  assert.equal(decodeTimer(null), null)
})

test('the length changes and time is added, also while running', () => {
  let timer = setDuration(newTimer(5), 10)
  assert.equal(timeLeft(timer), 600000)
  timer = startTimer(timer, 0)
  timer = addTime(timer, 1, 60000)
  assert.equal(timeLeft(timer, 60000), 600000)
  timer = setDuration(timer, 2, 60000)
  assert.equal(timeLeft(timer, 60000), 120000, 'a running timer starts again with the new length')
  assert.equal(timeLeft(addTime(pauseTimer(timer, 60000), -5), 0), 0)
})

test('times show as minutes and seconds, rounded up', () => {
  assert.equal(formatTime(180000), '3:00')
  assert.equal(formatTime(179001), '3:00')
  assert.equal(formatTime(59000), '0:59')
  assert.equal(formatTime(1), '0:01')
  assert.equal(formatTime(0), '0:00')
  assert.equal(formatTime(30 * 60000), '30:00')
  assert.equal(formatTime(3723000), '1:02:03')
})

test('a repetition that arrives a little late does not move the countdown; a real change does', () => {
  const shown = startTimer(newTimer(5), 0)
  const late = decodeTimer(encodeTimer(shown, 3000), 3180)
  assert.equal(followTimer(shown, late), shown, 'only the delay differs: the countdown runs on')
  const more = decodeTimer(encodeTimer(addTime(shown, 1, 3000), 3000), 3100)
  assert.equal(followTimer(shown, more), more, 'a minute more counts')
  const paused = decodeTimer(encodeTimer(pauseTimer(shown, 3000), 3000), 3100)
  assert.equal(followTimer(shown, paused), paused)
  const hidden = decodeTimer({ ...encodeTimer(shown, 3000), visible: false }, 3100)
  assert.equal(followTimer({ ...shown, visible: true }, hidden), hidden)
  assert.equal(followTimer(null, late), late)
})

test('the next redraw comes when the second shown changes', () => {
  const timer = startTimer(newTimer(1), 0)
  assert.equal(untilNextSecond(timer, 0), 1005)
  assert.equal(untilNextSecond(timer, 250), 755)
  assert.equal(untilNextSecond(timer, 60000), null)
})

test('the deck names its sounds, or lists files named after themselves', () => {
  assert.deepEqual(timerSounds({ timer: { sounds: { Gong: './sounds/gong.mp3', Pause: ' ./sounds/pause.m4a ' } } }), [{ name: 'Gong', src: './sounds/gong.mp3' }, { name: 'Pause', src: './sounds/pause.m4a' }])
  assert.deepEqual(timerSounds({ timer: { sounds: ['./sounds/glocke.wav', 7, ''] } }), [{ name: 'glocke', src: './sounds/glocke.wav' }])
  assert.deepEqual(timerSounds({}), [])
  assert.deepEqual(timerSounds({ timer: { sounds: 'gong.mp3' } }), [])
})

test('the end sound travels with the timer; starting again makes it sound again', () => {
  const timer = { ...newTimer(1, { sound: './sounds/gong.mp3' }), volume: 0.5 }
  const passed = decodeTimer(encodeTimer(quietTimer(timer)))
  assert.equal(passed.sound, './sounds/gong.mp3')
  assert.equal(passed.volume, 0.5)
  assert.equal(passed.quiet, true)
  assert.equal(startTimer(passed).quiet, false)
  assert.equal(resetTimer(passed).quiet, false)
  assert.equal(decodeTimer({ ...encodeTimer(timer), volume: 7, sound: '' }).volume, 1)
  assert.equal(decodeTimer({ ...encodeTimer(timer), sound: '' }).sound, null)
  const tried = testSound(timer)
  assert.equal(tried.test, 1)
  assert.notEqual(followTimer(startTimer(timer, 0), startTimer(tried, 0)), startTimer(timer, 0), 'trying the sound is a change, not a repetition')
})
