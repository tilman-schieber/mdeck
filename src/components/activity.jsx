import { h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import QrCode from './QrCode.jsx'
import { Icon } from './Icon.jsx'
import { t } from '../core/labels.js'
import { keepAnswers } from '../live/client.js'
import { slideHtml } from './inlineText.js'
import 'katex/dist/katex.min.css'

// Parts every activity on a slide shares (<poll>, <question>, <wordcloud>,
// <scale>, <numeric> and <qrcode join />): the deck's join code, the line with
// the number of answers, the live dot, Reset and the presenter's controls.

export const shortLink = url => url.replace(/^https?:\/\//, '')
// An activity shows no join code of its own: the presenter puts it over the
// slide when it is wanted (J), and phones that joined follow along. `qr` (or
// `qr="true"`) still puts the code beside the question.
export const wantsQr = qr => qr != null && !/^(false|no|off|0)$/i.test(String(qr))
// A switch such as `multiple`: on when given, unless it says false.
export const isSet = value => value != null && !/^(false|no|off|0)$/i.test(String(value))

/** An activity's question, Markdown with $…$ maths. */
export const ActivityQuestion = ({ text }) => text ? <p class="poll-question" dangerouslySetInnerHTML={{ __html: slideHtml(text) }} /> : null

/** The join code with the short link, or how to make phones reach the server. */
export function JoinCode({ room, joinUrl, localJoinUrl, known, offline, qr = true, size = 300, label = t('poll.scan'), tryHere = t('poll.tryHere') }) {
  if (!qr || offline || (!known && !joinUrl)) return null
  if (!joinUrl) return <p class="poll-join poll-join--local">{t('poll.unreachable', { command: <code>mdeck run --network</code>, setting: <code>server</code> })} <a href={localJoinUrl} target="_blank" rel="noopener">{tryHere}</a></p>
  return <a class="poll-join" href={joinUrl} target="_blank" rel="noopener" data-room={room}>
    <QrCode url={joinUrl} size={String(size)} />
    <span>{label}</span>
    <span class="poll-link">{shortLink(joinUrl)}</span>
  </a>
}

// What every screen of the talk shares about an activity: whether it still
// takes answers (`closed`; `upTo` is the last answer that counts), whether
// its right answer shows (`revealed`) and whether its results show. The
// activity room's state on the server holds them, so the audience window, an
// iPad, a reloaded presenter view and the phones follow: phones say the
// activity is closed and, once the answer shows, whether theirs was right
// (`solution`, sent only then). Between windows of one browser, and where
// this one may not change the room, the stage event `pollcontrols` carries
// them too (src/runtime/ink/bus.js).
const CONTROLS = ['closed', 'upTo', 'revealed', 'results']
const controlsIn = state => Object.fromEntries(CONTROLS.filter(key => state && typeof state === 'object' && key in state).map(key => [key, state[key]]))

export function useControls(room, live, { results = true, solution = null } = {}) {
  const ref = useRef()
  const [controls, setControls] = useState({ closed: false, upTo: 0, revealed: false, results })
  const kept = JSON.stringify(controlsIn(live.state))
  useEffect(() => { if (kept !== '{}') setControls(now => ({ ...now, ...JSON.parse(kept) })) }, [kept])
  useEffect(() => {
    const stage = ref.current?.closest('deck-stage')
    if (!stage) return
    const follow = event => { if (event.detail?.room === room && !event.detail.local) setControls(now => ({ ...now, ...controlsIn(event.detail.controls) })) }
    stage.addEventListener('pollcontrols', follow)
    return () => stage.removeEventListener('pollcontrols', follow)
  }, [room])
  const change = patch => {
    const next = { ...controls, ...patch }
    setControls(next)
    ref.current?.closest('deck-stage')?.dispatchEvent(new CustomEvent('pollcontrols', { detail: { room, controls: next, local: true } }))
    if (live.canReset) live.setState({ ...next, ...(next.revealed && solution != null ? { solution } : {}) }).catch(() => {})
  }
  // The answers that count: once closed, those that came before.
  const counted = messages => controls.closed ? messages.filter(message => message.n <= controls.upTo) : messages
  // They are kept beside the deck while `mdeck run` runs. Answers of none
  // are kept only after Reset: a room that starts empty, from a server that
  // restarted while this slide was shown, leaves what was kept alone.
  // The right answer goes with them (a <pinpoint>'s circle, measured on its picture).
  const resets = useRef(live.resets)
  const counting = counted(live.messages)
  const solutionKey = solution == null ? '' : JSON.stringify(solution)
  useEffect(() => {
    if (!live.canReset || !live.connected || live.offline || (!counting.length && live.resets === resets.current)) return
    resets.current = live.resets
    keepAnswers(room, counting, { closed: controls.closed, solution })
  }, [room, counting.length, counting.at(-1)?.n, controls.closed, live.canReset, live.connected, live.resets, solutionKey])
  const close = messages => change(controls.closed ? { closed: false } : { closed: true, upTo: Math.max(0, ...messages.map(message => message.n)) })
  // Reset starts over: open, the answer and results as at the start.
  const reset = () => { change({ closed: false, upTo: 0, revealed: false, results }); return live.reset() }
  return { ...controls, ref, change, counted, close, reset }
}

/**
 * The presenter's buttons: close (a lock), show or hide the results (an
 * eye, with `results`), show the right answer (a tick, with `solve`).
 * A record of the talk (`offline`) can still show the answer and results.
 */
export function ActivityControls({ controls, messages, offline = false, results = false, solve = false }) {
  // data-presenter-control: the phone clicker offers them too (runtime/slideControls.js).
  const button = (name, on, label, onClick, icon, iconName) => <button type="button" class={`poll-control poll-${name}${on ? ' is-on' : ''}`} title={label} aria-label={label} aria-pressed={on} data-presenter-control="" data-presenter-icon={iconName} onClick={onClick}>{icon}</button>
  const lock = controls.closed ? 'lock' : 'lock-open', eye = controls.results ? 'eye' : 'eye-off'
  return <>
    {!offline && button('close', controls.closed, t(controls.closed ? 'poll.open' : 'poll.close'), () => controls.close(messages), <Icon name={lock} size={22} />, lock)}
    {results && button('results', !controls.results, t(controls.results ? 'poll.hideResults' : 'poll.showResults'), () => controls.change({ results: !controls.results }), <Icon name={eye} size={24} />, eye)}
    {solve && button('solve', controls.revealed, t(controls.revealed ? 'poll.hideAnswer' : 'poll.showAnswer'), () => controls.change({ revealed: !controls.revealed }), <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>, 'check')}
  </>
}

/**
 * Number of answers, whether the room is live, and Reset for the presenter;
 * `children` go at the end. With `perPhone` (one answer per phone) the
 * count says of how many phones; `closed` says the activity takes no more.
 */
export function ActivityFooter({ count, connected, canReset, reset, offline, present = null, perPhone = false, closed = false, children }) {
  // Without a server this is a record of the talk: no count, dot or buttons.
  if (offline && !count) return <p class="poll-total poll-static">{t('poll.static')}</p>
  // With more answers than phones, some left.
  const of = perPhone && !offline && present > 0 && present >= count ? present : null
  return <p class="poll-total">
    {/* The answers kept in the talk, without a server: no live dot. */}
    {!offline && <span class={`poll-dot${connected ? ' is-live' : ''}`} title={connected ? t('poll.live') : t('poll.offline')} />}
    {of != null ? t('poll.answeredOf', { n: count, of }) : count === 1 ? t('poll.answer') : t('poll.answers', { n: count })}
    {closed && <span class="poll-closed">{t('poll.closed')}</span>}
    <span class="poll-spacer" />
    {canReset && <button class="poll-reset" disabled={count === 0 && !closed} data-presenter-control="" data-presenter-icon="reset" aria-label={t('poll.reset')} onClick={() => reset().catch(() => {})}>{t('poll.reset')}</button>}
    {children}
  </p>
}
