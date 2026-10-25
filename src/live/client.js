// Audience interaction for slide components: `import { useRoom } from 'mdeck/live'`.
//
// Relay mode: the server connects the presenter's screen and the phones
// and never needs the deck. Every activity in a deck shares one join link,
// <server>/<code>. The presenter's screen announces the activity on the current
// slide together with what the phone should show (a component's `phone`
// description), the deck's look and the words in its language; the room
// server's answer page shows that. On the slides, `useRoom` follows the
// answers.
import { useCallback, useEffect, useState } from 'preact/hooks'
import { sessionCode } from './code.js'
import { pairToken, pairHeaders } from './pairing.js'
import { keptAnswers, answersAsMessages } from '../core/results.js'
import { devPath } from '../core/devPath.js'
import { t, deckLanguage } from '../core/labels.js'
import { reactionsOf, REACTIONS_ROOM } from '../core/reactions.js'

// The QR code component the built-in poll uses, for your own activities.
export { default as QrCode } from '../components/QrCode.jsx'

let settings = { server: null, code: '000000', reactions: null }

// Called by the runtime with the deck settings.
// `mdeck run --server <address>` and MDECK_SERVER name the server without the
// deck; the dev server passes it in as __MDECK_SERVER__ and it wins.
const givenServer = typeof __MDECK_SERVER__ === 'string' ? __MDECK_SERVER__ : null

export function configureLive(deckConfig = {}) {
  const server = givenServer ?? deckConfig.server
  settings = { server: typeof server === 'string' ? server.replace(/\/+$/, '') : null, code: sessionCode(deckConfig), reactions: reactionsOf(deckConfig) }
  infoRequest = null
  takeKeyFromAddress()
}

/** The deck's session code, the last part of its join link. */
export const liveCode = () => settings.code

const proxyControls = typeof __MDECK_PROXY_CONTROLS__ !== 'undefined' && __MDECK_PROXY_CONTROLS__
const controlBase = () => proxyControls ? new URL(devPath('__mdeck/live'), window.location.origin).href : serverBase()
const controlRoomPath = room => `${controlBase()}/rooms/${encodeURIComponent(`${settings.code}.${room}`)}`
const controlSessionPath = () => `${controlBase()}/rooms/${encodeURIComponent(settings.code)}`

const page = () => new URL(window.location.href)
// Without a `server` setting, the server built into `mdeck run`.
const serverBase = () => settings.server ?? new URL(devPath('__mdeck/live'), window.location.origin).href
const roomPath = room => `${serverBase()}/rooms/${encodeURIComponent(`${settings.code}.${room}`)}`
const sessionPath = () => `${serverBase()}/rooms/${encodeURIComponent(settings.code)}`

// Which rooms keep a live connection: those on the current slide, set by the
// runtime for each deck it shows. Browsers allow only six connections per
// server, shared by all tabs, so a deck must not hold one per activity.
// null means every room is live (Read mode, print, pages without slides).
let activeRooms = null
const activeListeners = new Set()
export function setActiveRooms(rooms) {
  activeRooms = rooms == null ? null : new Set(rooms.map(String))
  for (const listener of activeListeners) listener()
}
function useActive(room) {
  const [, redraw] = useState(0)
  useEffect(() => {
    const listener = () => redraw(n => n + 1)
    activeListeners.add(listener)
    return () => activeListeners.delete(listener)
  }, [])
  return activeRooms == null || activeRooms.has(String(room))
}

// The presenter unlocks a standalone server once with ?serverkey=… in the
// address. The code is kept in this browser, where the presenter view's other
// windows find it, and taken out of the address bar at once, so it never shows
// on a projector.
let givenKey = null
function takeKeyFromAddress() {
  const url = page()
  const given = url.searchParams.get('serverkey')
  if (!given) return
  givenKey = given
  try { localStorage.setItem(`mdeck-server-key:${serverBase()}`, given) } catch {}
  url.searchParams.delete('serverkey')
  try { history.replaceState(history.state, '', url) } catch {}
}
// The server built into `mdeck run` also lets a paired iPad in, and so
// does the server that relays `mdeck run --server`: this page then comes
// from it, so it is the same origin. The token is never sent to another server.
function ownServer() {
  if (!settings.server) return true
  try { return new URL(settings.server).origin === window.location.origin } catch { return false }
}
function presenterKey() {
  // A relayed page always uses its own pairing, even if this origin once
  // stored a master key for a different presentation.
  if (/^\/t\/[^/]+\/$/.test(devPath('')) || proxyControls || (import.meta.env?.DEV && ownServer())) return pairToken()
  let key = givenKey
  try { key = localStorage.getItem(`mdeck-server-key:${serverBase()}`) ?? givenKey } catch {}
  return key ?? (ownServer() ? pairToken() : null)
}
const withKey = (headers = {}) => { const key = presenterKey(); return key ? { ...headers, Authorization: `Bearer ${key}` } : headers }

// Only an answer is kept; after a failure the next call asks again, so a room
// server that starts later is found. `reachable` is false when it did not answer.
// `again` asks once more, unless the answer is a moment old (every slide
// that shows a join link asks at the same time).
let infoRequest = null, infoAskedAt = 0
function serverInfo({ again = false } = {}) {
  if (again && Date.now() - infoAskedAt > 1000) infoRequest = null
  if (!infoRequest) {
    infoAskedAt = Date.now()
    infoRequest = fetch(`${controlBase()}/info?session=${encodeURIComponent(settings.code)}`, { headers: withKey() })
      .then(response => { if (!response.ok) throw new Error(String(response.status)); return response.json() })
      .then(info => ({ ...info, reachable: true }))
      .catch(() => { infoRequest = null; return { reachable: false } })
  }
  return infoRequest
}

// What the server said, asked again whenever the page comes back into view:
// the laptop may have changed networks since, and with it the join link.
function useServerInfo() {
  const [info, setInfo] = useState({})
  useEffect(() => {
    let gone = false
    const ask = options => serverInfo(options).then(next => { if (!gone) setInfo(next) })
    ask()
    const again = () => { if (document.visibilityState !== 'hidden') ask({ again: true }) }
    window.addEventListener('focus', again)
    document.addEventListener('visibilitychange', again)
    return () => { gone = true; window.removeEventListener('focus', again); document.removeEventListener('visibilitychange', again) }
  }, [])
  return info
}

// The join link phones can open: the `server` setting, or `mdeck run --network`'s
// network address. null when only this computer can reach the server;
// `localJoinUrl` then still opens the answer page here, for trying it out.
function joinUrl(info) {
  if (settings.server) return `${settings.server}/${settings.code}`
  return info.network ? new URL(`__mdeck/live/${settings.code}`, info.network).href : null
}
const localJoinUrl = () => `${serverBase()}/${settings.code}`

// The link for following the slides on another device (?view=follow): this
// deck's page, where other devices reach both the page and the stage room
// that carries the presenter's position. That is `mdeck run --network`'s
// network address, or a deck hosted with a `server` setting, whose stage room
// is on that server. null when only this computer could follow; localFollowUrl
// then opens the follow view here, for trying it out.
const relayed = () => /^\/t\/[^/]+\/$/.test(devPath(''))
function followUrl(info) {
  if (relayed()) return null
  if (import.meta.env?.DEV || proxyControls) return info.network ? new URL(`${devPath('')}?view=follow`, info.network).href : null
  return settings.server ? `${window.location.origin}${window.location.pathname}?view=follow` : null
}
const localFollowUrl = () => `${window.location.origin}${devPath('')}?view=follow`
// Until the server has answered or failed, `known` is false and activities
// show no join code, so a quick capture never shows a passing warning.
const reach = info => ({ known: info.reachable != null, offline: info.reachable === false })

// The answers kept in the talk (<deck>.results.json), set by the runtime: a
// build shows them where no room server answers, instead of no answers.
let savedRooms = {}
export function setSavedResults(results) { savedRooms = results?.rooms ?? {} }

// While `mdeck run` runs, the presenter's screens keep each activity's
// answers in that file (src/build/resultsPlugin.js), a moment after the last
// one came in. Elsewhere there is nothing to keep them in.
const keeping = new Map()
export function keepAnswers(room, messages, { closed = false, solution = null } = {}) {
  if (!import.meta.env?.DEV) return
  clearTimeout(keeping.get(room))
  keeping.set(room, setTimeout(() => {
    keeping.delete(room)
    fetch(devPath('__mdeck/results'), { method: 'POST', headers: pairHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ room, closed, answers: keptAnswers(messages), ...(solution != null ? { solution } : {}) }) }).catch(() => {})
  }, 800))
}

// The phones that can answer: followers (?view=follow) count as phones in
// the presence, but watch the slides instead of the answer page.
const answering = presence => presence.phones - (presence.followers ?? 0)

/**
 * Follow a room's answers on a slide.
 *   messages  every answer so far: { n, at, from, data: { value } }
 *   joinUrl   the deck's join link for the QR code, or null if phones cannot
 *             reach the server; localJoinUrl works on this computer
 *   canReset / reset()  presenter only
 *   state     the room's state, which only the presenter sets (setState):
 *             an activity's controls, such as closed or revealed
 *   present   how many phones that can answer are connected to the deck,
 *             or null before the server said
 *   resets    how often the room was reset since this slide opened
 *   connected false until the live stream is open
 *   offline   no room server answered: a PDF, a file sent to readers or a
 *             build hosted without one. Activities then show their question
 *             as a record of the talk, without a join code, and `messages`
 *             are the answers kept in the talk, if any.
 * Off the current slide the room keeps its last messages but disconnects.
 */
export function useRoom(room) {
  const live = useActive(room)
  const [messages, setMessages] = useState([])
  const [connected, setConnected] = useState(false)
  const [state, setRoomState] = useState(null)
  const [present, setPresent] = useState(null)
  const [resets, setResets] = useState(0)
  const info = useServerInfo()

  useEffect(() => {
    if (!live || !room || typeof EventSource === 'undefined') return
    const source = new EventSource(`${roomPath(room)}/events?presence=1`)
    source.addEventListener('open', () => setConnected(true))
    source.addEventListener('error', () => setConnected(false))
    source.addEventListener('snapshot', event => {
      const snapshot = JSON.parse(event.data)
      setMessages(snapshot.messages)
      setRoomState(snapshot.state ?? null)
      if (snapshot.presence) setPresent(answering(snapshot.presence))
    })
    source.addEventListener('state', event => setRoomState(JSON.parse(event.data).state ?? null))
    source.addEventListener('presence', event => setPresent(answering(JSON.parse(event.data))))
    source.addEventListener('message', event => { const message = JSON.parse(event.data); setMessages(list => list.some(m => m.n === message.n) ? list : [...list, message]) })
    source.addEventListener('reset', () => { setMessages([]); setResets(n => n + 1) })
    return () => { source.close(); setConnected(false) }
  }, [room, live])

  const reset = useCallback(async () => {
    const response = await fetch(`${controlRoomPath(room)}/reset`, { method: 'POST', headers: withKey({ 'Content-Type': 'application/json' }), body: '{}' })
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Could not reset')
  }, [room])

  // Ordered like the session's state: the latest change of any screen wins.
  const setState = useCallback(async next => {
    const response = await fetch(`${controlRoomPath(room)}/state`, { method: 'POST', headers: withKey({ 'Content-Type': 'application/json' }), body: JSON.stringify({ state: { ...next, at: Date.now(), screen: SCREEN } }) })
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Could not change the room')
  }, [room])

  const kept = info.reachable === false ? savedRooms[room] : null
  return { messages: kept ? answersAsMessages(kept.answers) : messages, reset, state, setState, present, resets, connected, canReset: !!info.canReset, joinUrl: joinUrl(info), localJoinUrl: localJoinUrl(), code: settings.code, ...reach(info) }
}

/**
 * Reactions sent from the phones, for the presenter's screen:
 * `onReaction({ value, at, n })` for each one as it arrives. Returns a
 * function that stops listening. Nothing happens without a room server.
 */
export function listenToReactions(onReaction) {
  if (typeof EventSource === 'undefined') return () => {}
  const source = new EventSource(`${roomPath(REACTIONS_ROOM)}/events`)
  source.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const value = message.data?.value
    if (typeof value === 'string' && settings.reactions?.includes(value)) onReaction({ value, at: message.at, n: message.n })
  })
  return () => source.close()
}

/** The deck's join link alone, for a slide that only invites people in (<qrcode join />). */
export function useJoinLink() {
  const info = useServerInfo()
  return { joinUrl: joinUrl(info), localJoinUrl: localJoinUrl(), code: settings.code, ...reach(info) }
}

/** The link for following the slides, for a slide that shows it (<qrcode follow />). */
export function useFollowLink() {
  const info = useServerInfo()
  return { joinUrl: followUrl(info), localJoinUrl: localFollowUrl(), code: settings.code, ...reach(info) }
}

/** The latest answer of each device, e.g. to count votes that can be changed. */
export function latestByDevice(messages) {
  const latest = new Map()
  for (const message of messages) latest.set(message.from ?? `#${message.n}`, message)
  return [...latest.values()]
}

// ── The presenter's screen ──────────────────────────────────────────────────

// The deck's look as the answer page needs it: theme variables, font
// stylesheets and the style of a slide heading, read from the page that shows
// the slides (the presenter's current-slide frame, or the deck itself).
const LOOK_TOKENS = ['--bg', '--ink', '--ink-soft', '--muted', '--rule', '--surface', '--accent', '--accent-2', '--accent-3', '--on-accent', '--font-body', '--font-display']
let lookSource = () => document
export function setLookSource(source) { lookSource = source }
export function captureLook(doc = lookSource()) {
  if (!doc?.documentElement) return null
  const style = getComputedStyle(doc.documentElement)
  const tokens = Object.fromEntries(LOOK_TOKENS.map(name => [name, style.getPropertyValue(name).trim()]).filter(([, value]) => value))
  const fonts = [...doc.querySelectorAll('link[data-deck-theme-font]')].map(link => link.href)
  // A frame that has not loaded its slides yet has no theme: send nothing, so
  // phones keep the look they have.
  if (!tokens['--bg'] && !tokens['--font-body']) return null
  const h1 = doc.querySelector('.slide-body h1')
  const hs = h1 && doc.defaultView.getComputedStyle(h1)
  // Letter spacing relative to the font size, so a slide heading's spacing
  // fits the much smaller heading on a phone.
  const spacing = hs && (hs.letterSpacing === 'normal' ? 'normal' : `${(parseFloat(hs.letterSpacing) / parseFloat(hs.fontSize)).toFixed(3)}em`)
  const heading = hs ? { family: hs.fontFamily, weight: hs.fontWeight, spacing, transform: hs.textTransform } : null
  return { tokens, fonts, heading }
}

// The words the answer page shows, in the deck's language.
const phoneWords = () => ({
  waiting: t('respond.waiting'), pick: t('poll.pick'), thanks: t('poll.thanks'), send: t('respond.send'), sent: t('respond.sent'), follow: t('follow.open'), react: t('respond.react'),
  pickSeveral: t('poll.pickSeveral'), thanksSeveral: t('poll.thanksSeveral'), several: t('poll.several'),
  closed: t('respond.closed'), right: t('respond.right'), wrong: t('respond.wrong'), solution: t('respond.solution'),
  number: t('numeric.placeholder'), invalid: t('numeric.invalid'), numberSent: t('numeric.sent'),
  pinPick: t('pinpoint.pick'), pinConfirm: t('pinpoint.confirm'), pinSent: t('pinpoint.sent'), pinLoading: t('pinpoint.loading'), pinWrong: t('pinpoint.wrong'), pinSolution: t('pinpoint.solution'),
})

// ── Pictures for the phones (<pinpoint>) ────────────────────────────────────

// Phones never load the deck, so the presenter's screen sends them the
// picture of the activity on screen through the room server: drawn smaller,
// as WebP or JPEG (never SVG), on the deck's background where it is
// transparent. The server holds one picture per session, while it is on screen. A
// picture from another site that may not be drawn is linked as it is, on https.
const PICTURE_SIDE = 1000, PICTURE_BYTES = 190 * 1024
// Each picture once, by its address: { blob, width, height, version } or { url, width, height }.
const pictures = new Map()
// The version the server holds, as it last said.
let heldPicture = null

// The <pinpoint> picture on the current slide, once it has loaded.
async function loadedPicture(room) {
  for (let tries = 0; tries < 30; tries++) {
    const img = lookSource()?.querySelector?.(`img[data-pinpoint="${CSS.escape(room)}"]`)
    if (img?.complete && img.naturalWidth) return img
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  return null
}

async function preparePicture(img) {
  const width = img.naturalWidth, height = img.naturalHeight
  const scale = Math.min(1, PICTURE_SIDE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  // A colour the canvas cannot read leaves the white.
  context.fillStyle = '#fff'
  context.fillStyle = lastLook?.tokens?.['--bg'] || '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(img, 0, 0, canvas.width, canvas.height)
  try {
    // Safari draws no WebP and gives a PNG instead: JPEG then.
    for (const [type, quality] of [['image/webp', 0.9], ['image/jpeg', 0.9], ['image/jpeg', 0.75], ['image/jpeg', 0.6]]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, type, quality))
      if (blob?.type === type && blob.size <= PICTURE_BYTES) return { blob, width, height }
    }
  } catch {}
  // A picture from a site that does not allow drawing it.
  const url = img.currentSrc || img.src
  return /^https:\/\//.test(url) ? { url, width, height } : null
}

// The activity as the phones get it: a <pinpoint> with its picture's link
// and shape, once the server holds it; without, the phones wait for it.
async function withPicture({ room, activity }) {
  if (activity?.type !== 'pin' || !room) return activity
  const img = await loadedPicture(room)
  if (!img) return activity
  const address = img.currentSrc || img.src
  if (!pictures.has(address)) pictures.set(address, preparePicture(img).catch(() => null))
  const picture = await pictures.get(address)
  if (!picture) return activity
  const ratio = picture.height / picture.width
  if (picture.url) return { ...activity, image: { url: picture.url, ratio } }
  if (!picture.version || picture.version !== heldPicture) {
    const response = await fetch(`${controlSessionPath()}/image`, { method: 'POST', headers: withKey({ 'Content-Type': picture.blob.type }), body: picture.blob })
    if (!response.ok) {
      // A server from before <pinpoint> does not know the route.
      if (response.status === 404) console.warn('mdeck: the room server cannot take pictures for <pinpoint>; update it to this version of mdeck')
      return activity
    }
    picture.version = heldPicture = (await response.json()).version
  }
  return { ...activity, image: { url: `rooms/${encodeURIComponent(settings.code)}/image?v=${picture.version}`, ratio } }
}

// The presenter's screen announces the activity on the current slide and
// repeats it every few seconds, so phones that join late and a server
// that restarted catch up; the server passes on only changes. Only the
// presenter may: `steering` says whether this screen reaches the phones.
const REPEAT_MS = 4000
// This window, so the server can tell its repeats from new changes.
const SCREEN = Math.random().toString(36).slice(2, 10)
let current = { room: null, activity: null, title: '', at: 0, screen: SCREEN }, repeat = null
let steering = null
let lastLook = null
const steeringListeners = new Set()
function report(next) {
  if (steering && steering.ok === next.ok && steering.reason === next.reason) return
  steering = next
  for (const listener of steeringListeners) listener(next)
}

// A presenter view outranks other deck windows in the same browser: while it
// runs, they stay quiet, so two screens on different slides or looks do not
// make the phones flip between them.
let role = 'screen'
export function actAsPresenter() { role = 'presenter' }
const presenterMark = () => `mdeck-live-presenter:${settings.code}`
function outranked() {
  try {
    if (role === 'presenter') { localStorage.setItem(presenterMark(), String(Date.now())); return false }
    return Date.now() - Number(localStorage.getItem(presenterMark()) ?? 0) < REPEAT_MS * 2.5
  } catch { return false }
}

async function sendCurrent() {
  if (outranked()) return
  const info = await serverInfo()
  if (!info.reachable) return report({ ok: false, reason: 'unreachable' })
  if (!info.canReset) return report({ ok: false, reason: presenterKey() ? 'wrong-code' : 'no-code' })
  const look = captureLook()
  if (look) lastLook = look
  // Phones that answer can also follow the slides, where that works.
  const follow = followUrl(info)
  // The reactions the phones offer, whatever is on the slide.
  const reactions = settings.reactions ? { reactions: settings.reactions } : {}
  const announced = current
  try {
    const activity = await withPicture(announced)
    // The slide changed meanwhile: its own announcement goes out instead.
    if (announced !== current) return
    const state = { ...announced, activity, look: lastLook, lang: deckLanguage(), labels: phoneWords(), ...reactions, ...(follow ? { follow } : {}) }
    const response = await fetch(`${controlSessionPath()}/state`, { method: 'POST', headers: withKey({ 'Content-Type': 'application/json' }), body: JSON.stringify({ state }) })
    const body = response.ok ? await response.json().catch(() => ({})) : {}
    if (response.ok && !body.ignored) heldPicture = body.image ?? null
    report(!response.ok ? { ok: false, reason: response.status === 403 ? 'wrong-code' : 'unreachable' } : body.ignored && !body.same ? { ok: false, reason: 'other-screen' } : { ok: true })
  } catch { report({ ok: false, reason: 'unreachable' }) }
}

/**
 * The activity on the current slide: { room, activity, title }, where
 * `activity` is what the phones show ({ type: 'choice' | 'text' | 'scale', … }),
 * or nothing between activities.
 */
export function announce({ room = null, activity = null, title = '', initial = false } = {}) {
  // `at` marks this change; the server keeps the latest change of all
  // screens. A screen that just opened says 0, so opening a tab to look at
  // the deck does not take the phones away from the presenter.
  current = { room, activity, title, at: initial ? 0 : Date.now(), screen: SCREEN }
  sendCurrent()
  repeat ??= setInterval(sendCurrent, REPEAT_MS)
}

/**
 * The deck's stage room, which carries the presenter's position and live ink
 * to screens on other devices (src/runtime/ink/room.js).
 */
// The stage room's own `info`: with a standalone server behind `mdeck run`,
// the stage room stays on `mdeck run` (src/live/server.js), so it asks there.
let stageRequest = null
function stageInfo() {
  if (!proxyControls) return serverInfo()
  stageRequest ??= fetch(`${controlBase()}/info?session=${encodeURIComponent(settings.code)}&stage=1`, { headers: withKey() })
    .then(response => { if (!response.ok) throw new Error(String(response.status)); return response.json() })
    .then(info => ({ ...info, reachable: true }))
    .catch(() => { stageRequest = null; return { reachable: false } })
  return stageRequest
}

export function stageRoom() {
  return { url: `${controlSessionPath()}.stage`, headers: withKey, info: stageInfo, screen: SCREEN }
}

/** For the presenter view: null before the first announcement, else { ok, reason }. */
export function useSteering() {
  const [state, setState] = useState(steering)
  useEffect(() => {
    steeringListeners.add(setState)
    setState(steering)
    return () => steeringListeners.delete(setState)
  }, [])
  return state
}
