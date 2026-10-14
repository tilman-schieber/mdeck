import { validatePageUrl } from '../core/urls.js'
import { h, render } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { marked } from 'marked'
import { renderCitations, onBibliography } from './citations.js'
import deckFileContent, { language as fileLanguage, languages as deckLanguages } from 'virtual:slides'
import { parseSlides } from '../core/parseSlides'
import { validateDeck } from '../core/validateDeck'
import { loadTheme, setExtensionOverrides, THEME_NAMES, THEME_METAS, PALETTES } from './themeLoader'
import { resolvePalette } from '../extensions/appearance.js'
import { palettesFor } from '../extensions/tokens.js'
import { S, PaletteSwatches } from './chrome.jsx'
import { SlideErrorBoundary } from './SlideErrorBoundary.jsx'
import { createEditorBridge } from './editorBridge.js'
import { ReaderView } from './ReaderView.jsx'
import { configureLive, announce, setLookSource, actAsPresenter, useSteering, setSavedResults } from '../live/client.js'
import { registry } from './registry'
import { followActiveRooms } from '../live/follow.js'
import { createOrder } from './syncOrder.js'
import { fitDeck } from './fit.js'
import { attachInk, watchInk } from './ink/attach.js'
import { roomTransport, followStageRoom, announceStagePosition, onStagePosition } from './ink/room.js'
import { startFollowing } from './follow.js'
import { claimPairing, pairHeaders } from '../live/pairing.js'
import { strokePath } from '../core/ink.js'
import { inkFileName } from 'virtual:deck-ink'
import savedResults from 'virtual:deck-results'
import { roomsIn, roomsOnSlide, findRoomTag, slideTitleFor } from '../live/roomTag.js'
import { expandPollLists } from '../core/pollList.js'
import './reader.css'
import { SlideRenderer, manifests } from '../layouts/renderSlide'
import { setCalloutLabels } from './markedSetup'
import { setDeckLanguage, deckLanguage, stageLabels, t } from '../core/labels.js'
import { textDirection } from '../core/languages.js'
import { Icon } from '../components/Icon.jsx'
import './deck-stage.js'
import { normalMode, hotspotMode } from './hotspots.js'
import { useTalkTimer } from './useTalkTimer.js'
import { devPath } from '../core/devPath.js'
import { setView } from './shared.js'
import { watchSlideControls, pressSlideControl } from './slideControls.js'
import QrCodeTag from '../components/QrCodeTag.jsx'
import { ToolButton, Popover, PanelSection, SlideControls, Connections, tool } from './PresenterChrome.jsx'
import mdeckMark from '../../assets/logo/mark.svg'
import { RehearsalSummary } from './RehearsalSummary.jsx'
import { planFor, scheduleAt, formatClock } from '../core/timing.js'
import { KeyHelp, useKeyHelp, attachKeyHelp } from './KeyHelp.jsx'
import { isHelpKey } from './helpKeys.js'
import { Reactions } from './Reactions.jsx'
import { reactionsOf } from '../core/reactions.js'

const PresenterIcon = ({ name, size = 18 }) => <Icon name={name} size={size} style={{ display: 'block' }} />

// One address parameter selects the view: ?view=deck, reader, presenter, audience or follow.
export function requestedView(url, fallback = 'deck') {
  return url.searchParams.get('view') ?? fallback
}

// Scope controls to this file and presenter session, including separate tabs.
const controlUrl = new URL(window.location.href)
if (requestedView(controlUrl) === 'presenter' && !controlUrl.searchParams.has('session')) {
  // randomUUID only exists on https or localhost, not on an iPad at http://192.168…
  controlUrl.searchParams.set('session', crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''))
  history.replaceState(null, '', controlUrl)
}
const DECK_CHANNEL = `deck-control:${controlUrl.pathname}:${controlUrl.searchParams.get('session') ?? 'default'}`
// An audience window says it is there this often, and counts as gone when
// it has not said so for this long (or says so as it closes).
const SCREEN_SAY_MS = 3000
const SCREEN_GONE_MS = 8000

function withConfigOverrides(deckConfig) {
  const url = new URL(window.location.href)
  const theme = url.searchParams.get('theme')
  const palette = url.searchParams.get('palette')
  const appearance = url.searchParams.get('appearance')
  // The presenter view and previews pass their choices in the address. An
  // empty ?palette= or ?appearance= means the theme's default, whatever the
  // deck sets; a missing one keeps the deck's.
  return {
    ...deckConfig,
    // A file sent to readers carries only the deck's own theme and palette;
    // others named in the address are left out rather than failing.
    ...(theme && THEME_METAS[theme] ? { theme } : {}),
    ...(palette !== null && (!palette || PALETTES[palette]) ? { palette: palette || undefined } : {}),
    ...(appearance !== null ? { appearance: appearance || undefined } : {}),
  }
}

// The presenter's screen tells phones on the deck's answer link which
// activity is on the current slide. Decks without activities never call the
// server.
// The deck's text: the file's, or on the dev server with ?sample=1 the sample
// deck, which the design page's pictures show.
let slidesContent = deckFileContent
// The deck's languages under `mdeck run`, one file each (talk.en.md beside
// talk.de.md); a deck in one language has none and shows no switch. The
// presenter view switches every window, keeping the slide and step: slides
// match by their place in the deck.
const LANGUAGES = Object.keys(deckLanguages)
let deckLang = fileLanguage
function chooseLanguage(lang) {
  if (!LANGUAGES.includes(lang)) return false
  deckLang = lang
  slidesContent = deckLanguages[lang]
  return true
}
// A deck without `lang` is in the language its file name gives.
const withFileLanguage = config => config.lang || !deckLang ? config : { ...config, lang: deckLang }
// A language's name in that language, for the switch's tooltip.
function languageName(lang) {
  try { return new Intl.DisplayNames([lang], { type: 'language' }).of(lang) } catch { return lang }
}
// Asked several times on every slide change (presenter view, the phones'
// announcement, the views connected), so the answer is kept until the text
// changes: finding the tags reads the whole deck, which on an iPad made each
// slide change noticeably slower.
// A deck with reactions (`reactions:`) wants the phones too, between activities.
let activitiesOf = null, activitiesFound = false, reactionsWanted = false
const hasActivities = () => {
  if (activitiesOf !== slidesContent) { activitiesOf = slidesContent; activitiesFound = roomsIn(slidesContent).length > 0 }
  return activitiesFound || reactionsWanted
}
// The heading the phones show for a room, found once per deck.
const titlesByDeck = new WeakMap()
function titleFor(deck, room) {
  let titles = titlesByDeck.get(deck)
  if (!titles) titlesByDeck.set(deck, titles = new Map())
  if (!titles.has(room)) titles.set(room, slideTitleFor(deck, room))
  return titles.get(room)
}
// What the phones show for the activity on a slide: its component's `phone`
// description, from the tag's attributes and the slide's heading.
function activityOn(deck, slide) {
  const room = roomsOnSlide(slide)[0]
  if (!room) return { room: null, activity: null }
  const tag = findRoomTag(slide.content ?? '', room) ?? Object.values(slide.regions ?? {}).map(region => findRoomTag(region.content ?? '', room)).find(Boolean)
  const element = tag && new DOMParser().parseFromString(expandPollLists(tag), 'text/html').body.firstElementChild
  const component = element && registry[element.localName]
  if (typeof component?.phone !== 'function') return { room, activity: null }
  const props = Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value]))
  try { return { room, activity: component.phone(props, { slideTitle: titleFor(deck, room) }) } } catch (error) { console.warn(error); return { room, activity: null } }
}
function announceSlide(deck, index, { initial = false } = {}) {
  if (hasActivities()) announce({ ...activityOn(deck, deck.slides[index]), title: deck.deckConfig?.meta?.title ?? '', initial })
}

// Whether this presenter screen moves the phones along, shown only for decks
// with activities: a failure used to be silent.
const STEERING = {
  'no-code': 'Phones don’t follow: no server key here.',
  'wrong-code': 'Phones don’t follow: key refused.',
  unreachable: 'Phones don’t follow: server not answering.',
  'other-screen': 'Phones follow another screen. Change slide to take them back.',
}

function injectSpeakerNotes(slides) {
  let tag = document.getElementById('speaker-notes')
  if (!tag) {
    tag = document.createElement('script')
    tag.id = 'speaker-notes'
    tag.type = 'application/json'
    document.body.appendChild(tag)
  }
  tag.textContent = JSON.stringify(slides.map(s => s.meta?.notes ?? ''))
}

// URL for the presenter's own iframe and preview pane (uses postMessage)
function buildChildUrl(theme, palette, appearance, slideIndex = null, { draw = false, remote = false } = {}) {
  const url = new URL(window.location.href)
  url.searchParams.delete('v')
  url.searchParams.set('view', 'deck')
  url.searchParams.set('embedded', '1')
  if (draw) url.searchParams.set('draw', '1')
  // A phone's small slide is for looking; it does not start drawing.
  if (remote) url.searchParams.set('remote', '1')
  else url.searchParams.delete('remote')
  if (theme) url.searchParams.set('theme', theme)
  else url.searchParams.delete('theme')
  setLookParams(url, palette, appearance)
  if (slideIndex != null) url.hash = String(slideIndex + 1)
  return url.toString()
}

// The palette and light or dark chosen in the presenter view, for its frames
// and the audience window.
function setLookParams(url, palette, appearance) {
  // Always set: empty means the theme's default (see withConfigOverrides).
  url.searchParams.set('palette', palette ?? '')
  url.searchParams.set('appearance', appearance ?? '')
}

// URL for the audience window — view=audience makes it listen on BroadcastChannel
function buildAudienceUrl(theme, palette, appearance, slideIndex = null) {
  const url = new URL(window.location.href)
  url.searchParams.delete('embedded')
  url.searchParams.delete('v')
  url.searchParams.set('view', 'audience')
  if (theme) url.searchParams.set('theme', theme)
  else url.searchParams.delete('theme')
  setLookParams(url, palette, appearance)
  if (slideIndex != null) url.hash = String(slideIndex + 1)
  return url.toString()
}

function sendTo(win, command, value) {
  if (!win || win.closed) return
  win.postMessage({ deckControl: { command, value } }, '*')
}

// Who is connected, as the presenter's main frame hears it from the server.
// Kept from the first message on, since a presenter view opened in a
// background tab runs its effects only once it is shown.
let lastPresence = null
const presenceListeners = new Set()
function followPresence() {
  window.addEventListener('message', ({ data, origin }) => {
    if (origin !== window.location.origin || !data?.presence) return
    lastPresence = data.presence
    for (const listener of presenceListeners) listener(lastPresence)
  })
}
function usePresence() {
  const [presence, setPresence] = useState(lastPresence)
  useEffect(() => {
    presenceListeners.add(setPresence)
    setPresence(lastPresence)
    return () => presenceListeners.delete(setPresence)
  }, [])
  return presence
}

// The launch page of `mdeck run`, when this computer's presenter view was
// served by it; a built deck, `mdeck edit` and a paired iPad have none.
function useLaunchPage() {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    fetch(devPath('__mdeck/home/info'), { cache: 'no-store' }).then(response => { if (response.ok) setUrl(devPath('home.html')) }, () => {})
  }, [])
  return url
}

// The slide number as a field: type a number and press Enter (Go on an
// iPad's keyboard) to jump there. Escape, or leaving it empty, keeps the slide.
function SlideJump({ index, total, onJump, pad = 0, style }) {
  const [draft, setDraftState] = useState(null)
  // Blur follows Enter and Escape before a re-render, so it reads the ref.
  const draftRef = useRef(null)
  const setDraft = value => { draftRef.current = value; setDraftState(value) }
  const shown = draft ?? String(index + 1).padStart(pad, '0')
  function commit() {
    const n = Number.parseInt(draftRef.current ?? '', 10)
    setDraft(null)
    if (Number.isInteger(n) && n - 1 !== index) onJump(Math.max(1, Math.min(total, n)) - 1)
  }
  return (
    <form class="presenter-jump" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', margin: 0, ...style }}
      onSubmit={e => { e.preventDefault(); commit(); e.currentTarget.elements.slide.blur() }}>
      <input
        name="slide" type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint="go" autoComplete="off"
        title="Go to slide: type its number and press Enter" aria-label={`Slide number, 1 to ${total}`}
        value={shown}
        size={Math.max(2, String(total).length)}
        onFocus={e => e.currentTarget.select()}
        onInput={e => setDraft(e.currentTarget.value.replace(/\D/g, ''))}
        onKeyDown={e => {
          if (e.key !== 'Escape') return
          setDraft(null)
          // Typing and Escape can land in one render, which then changes nothing.
          e.currentTarget.value = String(index + 1).padStart(pad, '0')
          e.currentTarget.blur()
        }}
        onBlur={() => { if (draftRef.current !== null) commit() }}
        style={{ ...S.btn, cursor: 'text', padding: '2px 4px', width: `${Math.max(2, String(total).length) + 1.5}ch`, textAlign: 'center', fontVariantNumeric: 'tabular-nums', color: 'inherit' }}
      />
      <span>/ {String(total).padStart(pad, '0')}</span>
    </form>
  )
}

const PRESENTER_LAYOUTS = ['speaker', 'slide', 'remote']
// A slide's first heading, as plain words, for the phone's "Next:" line.
function slideTitleOf(slide) {
  const texts = [slide?.content ?? '', ...Object.values(slide?.regions ?? {}).map(region => region.content ?? '')]
  for (const text of texts) {
    const heading = text.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').match(/^#{1,3}\s+(.+)$/m)
    if (heading) return heading[1].replace(/[*_`]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim()
  }
  return ''
}
// A touch screen gets the slide alone, a computer the speaker layout. The
// phone remote is chosen, not guessed: its pairing code opens ?layout=remote.
function defaultLayout() {
  return matchMedia('(pointer: coarse)').matches ? 'slide' : 'speaker'
}
// ?layout= in the address (from a pairing code) chooses the layout; the
// device then remembers it like a layout chosen with the buttons.
function requestedLayout() {
  const url = new URL(window.location.href)
  const asked = url.searchParams.get('layout')
  if (!asked) return null
  url.searchParams.delete('layout')
  try { history.replaceState(history.state, '', url) } catch {}
  return PRESENTER_LAYOUTS.includes(asked) ? asked : null
}

function PresenterView({ deckConfig: firstConfig, slides: firstSlides }) {
  const [index, setIndex] = useState(0)
  // Slide changes made here, not a frame that (re)loaded or followed another screen.
  const [moves, setMoves] = useState(0)
  // Whether the frame has said which slide it shows (a reloaded one comes back on its own).
  const [framed, setFramed] = useState(false)
  // The notes, slide count and phones follow the language shown.
  const [lang, setLang] = useState(deckLang)
  const { slides, deckConfig } = useMemo(() => {
    if (!chooseLanguage(lang)) return { slides: firstSlides, deckConfig: firstConfig }
    const parsed = parseSlides(slidesContent)
    return { slides: parsed.slides, deckConfig: { ...firstConfig, ...withFileLanguage(parsed.deckConfig) } }
  }, [lang])
  const [theme, setTheme] = useState(deckConfig.theme ?? 'neue')
  // '' means the theme's own default, for both.
  const [palette, setPalette] = useState(deckConfig.palette ?? '')
  const [appearance, setAppearance] = useState(deckConfig.appearance ?? '')
  const [audienceConnected, setAudienceConnected] = useState(false)
  // Larger notes in the phone remote, whether the address or the device chose it.
  const [noteSize, setNoteSize] = useState(() => {
    let saved = null
    try { saved = localStorage.getItem('mdeck-presenter-layout') } catch {}
    return (new URL(window.location.href).searchParams.get('layout') ?? saved) === 'remote' ? 17 : 13
  })
  const [inking, setInking] = useState(false)
  // Black screen (B): the audience's screens are black, this view veils its slide.
  const [blank, setBlank] = useState(false)
  // The join code over the slide (J), on every screen.
  const [join, setJoin] = useState(false)
  // The phone clicker: the slide's controls, as its frame reports them (slideControls.js).
  const [slideControls, setSlideControls] = useState({ items: [], hotspots: 0, hotspot: null })
  // The overview (O) in this view's slide frame: keys go to it while it is open.
  const [overviewOpen, setOverviewOpen] = useState(false)
  const overviewRef = useRef(false)
  overviewRef.current = overviewOpen
  // The keys that work now, over everything (?).
  const [helpOpen, setHelpOpen] = useKeyHelp()
  // Hotspots: the deck's setting until the presenter switches them (H).
  const deckHotspots = (normalMode(deckConfig.hotspots) ?? 'off') !== 'off'
  const [hotspotsForced, setHotspotsForced] = useState(null)
  const hotspotsOn = hotspotsForced ?? deckHotspots
  const hotspotsRef = useRef(null)
  hotspotsRef.current = hotspotsForced
  const toggleHotspots = () => setHotspotsForced(forced => !(forced ?? deckHotspots))
  // Whether the number keys zoom on the slide shown: a slide may have its own setting.
  const slideHotspots = hotspotMode({ slide: slides[index]?.meta.hotspots, deck: deckConfig.hotspots, forced: hotspotsForced }) !== 'off'
  const presence = usePresence()
  const launchPage = useLaunchPage()
  // Drawing in the slide's frame: this page around it must not pan or bounce either.
  useEffect(() => { document.documentElement.classList.toggle('is-inking', inking) }, [inking])
  // The slide zooms itself (two fingers in its frame); Safari's page zoom
  // would enlarge the bars around it as well.
  useEffect(() => {
    const stop = event => event.preventDefault()
    document.addEventListener('gesturestart', stop, { passive: false })
    return () => document.removeEventListener('gesturestart', stop)
  }, [])
  // 'slide': the slide fills the screen (an iPad); the notes open as a drawer.
  // 'remote': a phone in the hand, with the slide small, the notes and big
  // buttons to go on and back.
  const [layout, setLayout] = useState(() => {
    const asked = requestedLayout()
    if (asked) { try { localStorage.setItem('mdeck-presenter-layout', asked) } catch {} return asked }
    try { const saved = localStorage.getItem('mdeck-presenter-layout'); if (PRESENTER_LAYOUTS.includes(saved)) return saved } catch {}
    return defaultLayout()
  })
  const remoteLayout = layout === 'remote'
  // A phone's screen must not lock in the middle of the talk (where the
  // browser lets a page ask: https or this computer).
  useEffect(() => {
    if (!remoteLayout || !navigator.wakeLock) return
    let lock = null, gone = false
    const ask = () => { if (document.visibilityState === 'visible') navigator.wakeLock.request('screen').then(held => { if (gone) held.release(); else lock = held }, () => {}) }
    ask()
    document.addEventListener('visibilitychange', ask)
    return () => { gone = true; document.removeEventListener('visibilitychange', ask); lock?.release().catch(() => {}) }
  }, [remoteLayout])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const slideLayout = layout === 'slide'
  function chooseLayout(next) {
    setLayout(next)
    setDrawerOpen(false)
    try { localStorage.setItem('mdeck-presenter-layout', next) } catch {}
  }
  const fullscreen = window.mdeckFullscreen
  const canFullscreen = !!fullscreen?.available()
  // The button enters and leaves full screen, and shows which it will do.
  const [isFullscreen, setIsFullscreen] = useState(() => !!fullscreen?.element())
  useEffect(() => fullscreen?.onChange?.(setIsFullscreen), [])
  const fullscreenLabel = isFullscreen ? 'Exit full screen (F)' : 'Full screen (F)'
  const fullscreenIcon = isFullscreen ? 'fullscreen-exit' : 'fullscreen'

  const [themeModalOpen, setThemeModalOpen] = useState(false)
  // The clock, and the slides' times (`time:`) to hold it against. Times a
  // rehearsal saved count at once; the deck file is not read again mid-talk.
  const [savedTimes, setSavedTimes] = useState({})
  const plan = useMemo(() => planFor(slides, deckConfig, savedTimes), [slides, deckConfig, savedTimes])
  const timer = useTalkTimer(`mdeck-timer:${DECK_CHANNEL}`, slides[index]?.id, { rehearse: controlUrl.searchParams.get('rehearse') === '1' })
  const [summary, setSummary] = useState(null)
  const [savedNote, setSavedNote] = useState(null)
  // A reload after the rehearsal must not start another one.
  useEffect(() => {
    if (!controlUrl.searchParams.has('rehearse')) return
    const url = new URL(window.location.href)
    url.searchParams.delete('rehearse')
    history.replaceState(null, '', url)
  }, [])
  function finishRehearsal() {
    timer.pause()
    setSummary(timer.spent())
  }
  const timerRef = useRef(timer)
  timerRef.current = timer
  // Next at the very end of the deck ends a rehearsal.
  const atEndRef = useRef(false)
  const atRehearsalEnd = () => timerRef.current.rehearsing && atEndRef.current
  const finishRehearsalRef = useRef(finishRehearsal)
  finishRehearsalRef.current = finishRehearsal
  const summaryRef = useRef(false)
  summaryRef.current = !!summary

  const iframeRef = useRef(null)
  const toggleOverviewRef = useRef(null)
  const previewRef = useRef(null)
  const audienceRef = useRef(null)
  const bcRef = useRef(null)
  // Positions sent to and taken from audience windows are ordered (syncOrder.js).
  const orderRef = useRef(null)
  orderRef.current ??= createOrder()
  const indexRef = useRef(0)
  const langRef = useRef(lang)
  langRef.current = lang
  const stateRef = useRef({ index: 0, step: -1 })
  indexRef.current = index
  // Phones see the look of the slide this view shows, read from its frame.
  useEffect(() => { setLookSource(() => iframeRef.current?.contentDocument) }, [])
  const announcedOnce = useRef(false)
  useEffect(() => {
    announceSlide({ slides, deckConfig }, index, { initial: !announcedOnce.current })
    announcedOnce.current = true
  }, [index, lang])

  const themeMeta = THEME_METAS[theme]
  // The palettes this theme offers, and what the deck shows right now.
  const offered = palettesFor(themeMeta, PALETTES)
  const shown = resolvePalette({ theme: themeMeta, palettes: PALETTES, palette, appearance })
  // A theme that does not offer the chosen palette falls back to its own.
  useEffect(() => { if (palette && !offered.some(p => p.id === palette)) setPalette('') }, [theme])
  const notes = useMemo(() => slides.map(s => s.meta?.notes ?? ''), [slides])
  // Preserve current slide when theme/palette causes an iframe reload
  const iframeSrc = useMemo(() => buildChildUrl(theme, palette, appearance, indexRef.current, { draw: true, remote: remoteLayout }), [theme, palette, appearance, remoteLayout])
  // previewSrc only recomputes on a change of look; slide changes use postMessage
  const previewSrc = useMemo(
    () => buildChildUrl(theme, palette, appearance, indexRef.current + 1),
    [theme, palette, appearance]
  )

  // BroadcastChannel for audience sync — more reliable than cross-window postMessage
  useEffect(() => {
    bcRef.current = new BroadcastChannel(DECK_CHANNEL)
    bcRef.current.onmessage = ({ data }) => {
      if (data?.audienceReady) bcRef.current?.postMessage({ deckControl: { command: 'setState', value: stateRef.current, order: orderRef.current.current() } })
      // An audience window moved: follow it, unless this view has moved on since.
      if (data?.deckStateChanged && orderRef.current.accept(data.order)) sendTo(iframeRef.current?.contentWindow, 'setState', data.deckStateChanged)
    }
    return () => bcRef.current?.close()
  }, [])

  // When the presenter iframe navigates: update displayed index, sync audience + preview.
  // Skip audience/preview sync on 'init' (iframe load/reload) — the audience already
  // opened at the correct slide, and previewSrc encodes the right hash on reload.
  useEffect(() => {
    function onMessage({ data, source }) {
      if (source === previewRef.current?.contentWindow) {
        // A preview that (re)loaded, such as after the last slide, opens in
        // the deck file's language: it gets the one shown.
        if (data?.deckStateChanged && data.reason === 'init') {
          sendTo(source, 'goTo', indexRef.current + 1)
          if (LANGUAGES.length) sendTo(source, 'setLanguage', langRef.current)
        }
        return
      }
      if (source !== iframeRef.current?.contentWindow) return
      if (typeof data?.inkMode === 'boolean') { setInking(data.inkMode); return }
      // The clicker's slide frame says what can be done on the slide shown.
      if (data?.slideControls) { setSlideControls(data.slideControls); return }
      if (typeof data?.overview === 'boolean') { setOverviewOpen(data.overview); return }
      // ? typed while the slide's frame had the keyboard.
      if (data?.keyHelp === 'toggle') { setHelpOpen(open => !open); return }
      // Another screen (a paired iPad) switched the language; the notes follow.
      if (LANGUAGES.includes(data?.deckLanguage)) { setLang(data.deckLanguage); return }
      if (!data?.deckStateChanged) return
      setFramed(true)
      if (data.reason && data.reason !== 'init' && data.reason !== 'sync') setMoves(n => n + 1)
      const state = data.deckStateChanged
      const i = state.index
      // Theme reloads must not reset the current reveal position.
      // A reloaded frame opens in the deck file's language; after its place
      // is back, it gets the one shown.
      const keepLanguage = () => {
        if (data.reason !== 'init') return
        if (LANGUAGES.length) sendTo(iframeRef.current?.contentWindow, 'setLanguage', langRef.current)
        // A reloaded frame keeps the presenter's hotspots switch too.
        if (hotspotsRef.current != null) sendTo(iframeRef.current?.contentWindow, 'hotspots', hotspotsRef.current)
      }
      if (data.reason === 'init' && stateRef.current.index === i) {
        sendTo(iframeRef.current?.contentWindow, 'setState', stateRef.current)
        keepLanguage()
        return
      }
      stateRef.current = state
      atEndRef.current = !!data.atEnd
      setIndex(i)
      setBlank(!!state.blank)
      setJoin(!!state.join)
      if (data.reason !== 'sync') {
        bcRef.current?.postMessage({ deckControl: { command: 'setState', value: state, order: orderRef.current.stamp() } })
      }
      sendTo(previewRef.current?.contentWindow, 'goTo', i + 1)
      keepLanguage()
    }
    window.addEventListener('message', onMessage)
    // The frame may have started drawing before this listener was there.
    try { if (iframeRef.current?.contentWindow?.document.querySelector('deck-stage')?.inking) setInking(true) } catch {}
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Keyboard nav in the presenter sidebar → drive the iframe only;
  // audience follows automatically via the slideIndexChanged → BroadcastChannel path
  useEffect(() => {
    function onKey(e) {
      if (e.target?.matches?.('input, select, textarea')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (summaryRef.current) return
      if (overviewRef.current && ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'PageDown', 'PageUp', 'Home', 'End', 'Enter', ' ', 'Escape', 'o', 'O'].includes(e.key)) {
        e.preventDefault()
        sendTo(iframeRef.current?.contentWindow, 'overviewKey', e.key)
        return
      }
      if (e.key === 'o' || e.key === 'O') { e.preventDefault(); toggleOverviewRef.current(); return }
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); timerRef.current.toggle(); return }
      const cmd =
        (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') ? 'next' :
        (e.key === 'ArrowLeft'  || e.key === 'PageUp')                    ? 'prev' :
        (e.key === 'Home' || e.key === 'r' || e.key === 'R')              ? 'reset' :
        (e.key === 'd' || e.key === 'D')                                  ? 'ink' : null
      if ((e.key === 'f' || e.key === 'F') && fullscreen?.available()) { e.preventDefault(); fullscreen.toggle(); return }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setDrawerOpen(open => !open); return }
      if ((e.key === 'l' || e.key === 'L') && LANGUAGES.length) { e.preventDefault(); nextLanguage(); return }
      if (e.key === 'h' || e.key === 'H') { e.preventDefault(); toggleHotspots(); return }
      // B, or a clicker's blank button (a full stop).
      if (e.key === 'b' || e.key === 'B' || e.key === '.') { e.preventDefault(); sendTo(iframeRef.current?.contentWindow, 'blank', 'toggle'); return }
      if ((e.key === 'j' || e.key === 'J') && (hasActivities() || reactionsOf(firstConfig))) { e.preventDefault(); sendTo(iframeRef.current?.contentWindow, 'join', 'toggle'); return }
      // Digits zoom to hotspots; Escape zooms out.
      if (/^[0-9]$/.test(e.key) || e.key === 'Escape') { if (e.key !== 'Escape') e.preventDefault(); sendTo(iframeRef.current?.contentWindow, 'hotspotKey', e.key); return }
      if (!cmd) return
      e.preventDefault()
      if (cmd === 'next' && atRehearsalEnd()) { finishRehearsalRef.current(); return }
      sendTo(iframeRef.current?.contentWindow, cmd, cmd === 'ink' ? 'toggle' : undefined)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The presenter's hotspots switch goes to the slide frame.
  const hotspotsOnce = useRef(false)
  useEffect(() => {
    if (!hotspotsOnce.current) { hotspotsOnce.current = true; return }
    sendTo(iframeRef.current?.contentWindow, 'hotspots', hotspotsForced)
  }, [hotspotsForced])

  // Escape to close theme modal
  useEffect(() => {
    if (!themeModalOpen) return
    function handler(e) {
      if (e.key === 'Escape') setThemeModalOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [themeModalOpen])


  // When theme/palette changes, tell the audience to hot-swap its theme without
  // a reload. Phones pick it up with the next announcement.
  useEffect(() => {
    bcRef.current?.postMessage({ deckControl: { command: 'setTheme', theme, palette, appearance } })
  }, [theme, palette, appearance])

  // Another language: every window swaps its slides in place. The address
  // keeps it, for a reload and for windows opened later.
  const langOnce = useRef(false)
  useEffect(() => {
    if (!langOnce.current) { langOnce.current = true; return }
    const url = new URL(window.location.href)
    url.searchParams.set('lang', lang)
    history.replaceState(null, '', url)
    for (const win of [iframeRef.current?.contentWindow, previewRef.current?.contentWindow]) sendTo(win, 'setLanguage', lang)
    bcRef.current?.postMessage({ deckControl: { command: 'setLanguage', value: lang } })
  }, [lang])
  const nextLanguage = () => setLang(current => LANGUAGES[(LANGUAGES.indexOf(current) + 1) % LANGUAGES.length])

  const toggleBlank = () => sendTo(iframeRef.current?.contentWindow, 'blank', 'toggle')
  // In the slide-only layout the notes drawer would cover the grid.
  const toggleOverview = () => { setDrawerOpen(false); sendTo(iframeRef.current?.contentWindow, 'overview', 'toggle') }
  toggleOverviewRef.current = toggleOverview
  const blankLabel = blank ? 'Show the slide again (B)' : 'Black screen for the audience (B)'
  const blankOn = { background: '#f0f0f0', borderColor: '#f0f0f0', color: '#111' }

  // Nav buttons drive the presenter iframe; audience follows via slideIndexChanged
  function navCommand(cmd, value) {
    if (cmd === 'next' && atRehearsalEnd()) return finishRehearsal()
    sendTo(iframeRef.current?.contentWindow, cmd, value)
  }

  function openAudienceWindow() {
    const aw = window.open(
      buildAudienceUrl(theme, palette, appearance, indexRef.current),
      'deck-audience-view'
    )
    if (!aw) return
    audienceRef.current = aw
    setAudienceConnected(true)
  }

  // Whether the phones follow this screen; told only when they do not.
  const steering = useSteering()
  // After a restart of mdeck run: the slide the talk was on, offered until
  // the presenter goes there, says no or changes slide; a frame that reloads
  // or follows another screen does not count (src/build/positionFile.js).
  const [goOn, setGoOn] = useState(null)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    fetch(devPath('__mdeck/position'), { headers: pairHeaders(), cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(kept => { const at = kept?.slideId ? slides.findIndex(slide => slide.id === kept.slideId) : -1; if (at > 0) setGoOn(at) }, () => {})
  }, [])
  useEffect(() => { if (moves) setGoOn(null) }, [moves])
  const note = notes[index] || ''
  const hasNext = index + 1 < slides.length

  const clock = formatClock(Math.floor(timer.totalElapsed)).padStart(5, '0')
  // With times in the deck: what is left of this slide, and how the talk
  // stands against the plan (behind when positive).
  const timed = plan.total > 0
  const { planned, slideLeft, delta } = scheduleAt(plan, index, timer)
  const slideColor = !planned ? '#888' : slideLeft <= 0 ? '#f28b82' : slideLeft <= 15 ? '#f5a524' : '#ccc'
  const slideText = !planned ? 'no time' : slideLeft > 0 ? `${formatClock(slideLeft)} left` : `+${formatClock(-slideLeft)} over`
  const deltaText = Math.abs(delta) < 30 ? 'on time' : delta > 0 ? `${formatClock(delta)} behind` : `${formatClock(-delta)} ahead`
  const deltaColor = Math.abs(delta) < 30 ? '#888' : delta > 0 ? '#f28b82' : '#81c995'
  const pill = { ...S.btn, minWidth: '40px', height: '40px', padding: '0 10px', fontSize: '15px' }
  const notesHtml = note
    ? marked.parse(renderCitations(note).markdown)
    : '<p>No notes — add a <code>:::notes</code> block to the slide.</p>'
  const notesDir = textDirection(deckConfig.lang) === 'rtl' ? 'rtl' : undefined

  // Reactions from the phones float up here, never on the projector.
  const reacting = !!reactionsOf(deckConfig)
  const summaryPanel = summary && <RehearsalSummary
    slides={slides}
    plan={plan}
    spent={summary}
    onClose={() => { setSummary(null); timer.toggle() }}
    onDiscard={() => { setSummary(null); timer.endRehearsal() }}
    onSaved={(times, changed) => {
      setSummary(null)
      timer.endRehearsal()
      setSavedTimes(saved => ({ ...saved, ...Object.fromEntries(Object.entries(times).map(([id, t]) => [id, t ?? undefined])) }))
      setSavedNote(`Saved the times of ${changed} slide${changed === 1 ? '' : 's'} into the deck.`)
      setTimeout(() => setSavedNote(null), 6000)
    }}
  />

  // The theme picker, from the settings.
  const themeModal = (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setThemeModalOpen(false)}
        >
          <div
            style={{ background: '#161616', border: '1px solid #2a2a2a', borderRadius: '12px', padding: '24px', width: 'min(90vw, 1000px)', maxHeight: '85vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}
            onClick={e => e.stopPropagation()}
          >
            <span style={S.label}>Choose Theme</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
              {THEME_NAMES.map(n => (
                <div
                  key={n}
                  onClick={() => { setTheme(n); setThemeModalOpen(false) }}
                  style={{ cursor: 'pointer', borderRadius: '8px', overflow: 'hidden', border: `2px solid ${n === theme ? '#60a5fa' : '#2a2a2a'}`, background: '#111' }}
                >
                  <div style={{ aspectRatio: '16/9', overflow: 'hidden' }}>
                    <iframe
                      src={buildChildUrl(n, palette, appearance, index)}
                      scrolling="no"
                      style={{ width: '100%', height: '100%', border: 0, pointerEvents: 'none', display: 'block' }}
                    />
                  </div>
                  <div style={{ padding: '8px 10px', fontSize: '14px', fontFamily: 'inherit', color: n === theme ? '#f0f0f0' : '#aaa', background: n === theme ? '#1c2a3a' : 'transparent' }}>
                    {n}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
  )
  // The controls, the same in every layout (PresenterChrome.jsx); the layouts
  // differ in where they put them.
  const frame = () => iframeRef.current?.contentWindow
  const problem = hasActivities() && steering && !steering.ok ? STEERING[steering.reason] : null
  const slideBar = big => <SlideControls controls={slideControls} press={i => sendTo(frame(), 'slideControl', i)} zoom={key => sendTo(frame(), 'hotspotKey', key)} big={big} />
  // The audience window, one click away (not on a phone: it would open there).
  const audienceButton = <ToolButton class="presenter-audience" icon="projector" label={audienceConnected ? 'Open the audience window again' : 'Open the audience window, for the projector'} onClick={openAudienceWindow} />
  const connections = <Connections presence={presence} phones={hasActivities()} problem={problem} />
  const timerChip = <button class="presenter-clock" title={timer.running ? 'Pause the timer (T)' : 'Start the timer (T)'} aria-pressed={timer.running} onClick={timer.toggle}
    style={{ ...tool, gap: '8px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: timer.running ? '#f0f0f0' : '#777' }}>
    <Icon name={timer.running ? 'pause' : 'play'} size={14} style={{ display: 'block' }} />{clock}
    {timed && !remoteLayout && <span class="presenter-slide-time" style={{ color: slideColor, fontSize: '12px' }}>{slideText}</span>}
  </button>
  const finishButton = timer.rehearsing && <button class="presenter-rehearsing" style={{ ...tool, color: '#f28b82' }} title="Finish the rehearsal" onClick={finishRehearsal}>● Finish</button>
  const nav = <>
    <ToolButton icon="prev" label="Previous (←)" onClick={() => navCommand('prev')} />
    <ToolButton icon="next" label="Next (→, Space)" onClick={() => navCommand('next')} />
  </>
  const drawButton = <ToolButton class="presenter-draw" icon="pen" label="Draw on the slide (D)" pressed={inking} style={inking ? { background: '#e11d48', borderColor: '#e11d48', color: '#fff' } : undefined} onClick={() => sendTo(frame(), 'ink', 'toggle')} />
  const blankButton = <ToolButton class="presenter-blank" icon="blank" label={blankLabel} pressed={blank} onClick={toggleBlank} />
  // Only where phones join: decks with activities or reactions.
  const joinButton = (hasActivities() || reacting) && <ToolButton class="presenter-join" icon="join" label={join ? 'Hide the join code (J)' : 'Show the join code on the slide (J)'} pressed={join} onClick={() => sendTo(frame(), 'join', 'toggle')} />
  const overviewButton = <ToolButton class="presenter-overview" icon="overview" label="All slides (O)" pressed={overviewOpen} onClick={toggleOverview} />
  const hotspotsButton = <ToolButton class="presenter-hotspots" icon="hotspots" label={hotspotsOn ? 'Hotspots on: 1–9 zoom in (H)' : 'Hotspots off (H)'} pressed={hotspotsOn} onClick={toggleHotspots} />
  const fullscreenButton = canFullscreen && <ToolButton class="presenter-fullscreen" icon={fullscreenIcon} label={fullscreenLabel} pressed={isFullscreen} onClick={() => fullscreen.toggle()} />
  const separator = <span aria-hidden="true" style={{ width: '1px', alignSelf: 'stretch', margin: '6px 4px', background: '#2a2a2a' }} />
  const LAYOUTS = [['speaker', 'speaker', 'Speaker', 'Slide, notes and next slide side by side (a computer)'], ['slide', 'tablet', 'Slide only', 'The slide fills the screen, notes in a drawer (an iPad)'], ['remote', 'phone', 'Clicker', 'Notes, time and big buttons (a phone)']]
  const settings = <Popover class="presenter-settings" label="Settings" trigger={<Icon name="settings" size={18} style={{ display: 'block' }} />}>
    <PanelSection title="Layout">
      <span role="group" aria-label="Layout" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {LAYOUTS.map(([id, icon, name, hint]) => <button key={id} type="button" class={`presenter-layout presenter-layout--${id}`} title={hint} aria-pressed={layout === id} onClick={() => chooseLayout(id)}
          style={{ ...S.btn, ...(layout === id ? { background: '#2a2a2a', color: '#fff', borderColor: '#444' } : {}) }}><Icon name={icon} size={16} />{name}</button>)}
      </span>
    </PanelSection>
    {remoteLayout && <PanelSection title="During the talk">
      <span style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>{overviewButton}{hotspotsButton}{fullscreenButton}</span>
    </PanelSection>}
    <PanelSection title="Look" class="presenter-look">
      <span style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setThemeModalOpen(true)} style={{ ...S.btn }} title="Choose the theme"><Icon name="grid" size={14} />{themeMeta?.title ?? theme}</button>
        <span class="presenter-appearance" role="group" aria-label="Light or dark" style={{ display: 'flex', gap: '2px' }}>
          {['light', 'dark'].map(mode => <button key={mode} type="button" aria-pressed={shown.appearance === mode} title={mode === 'light' ? 'Light: for bright rooms' : 'Dark: for dark rooms'} aria-label={mode === 'light' ? 'Light' : 'Dark'}
            onClick={() => setAppearance(mode === (themeMeta?.appearance ?? 'light') ? '' : mode)}
            style={{ ...S.btn, padding: '5px 8px', ...(shown.appearance === mode ? { background: '#2a2a2a', color: '#f0f0f0', borderColor: '#444' } : {}) }}><Icon name={mode === 'light' ? 'sun' : 'moon'} size={16} /></button>)}
        </span>
      </span>
      <span class="presenter-palette" role="group" aria-label="Palette" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {offered.map(p => <button key={p.id} type="button" class="presenter-palette-option" title={p.description} aria-pressed={shown.palette?.id === p.id}
          onClick={() => setPalette(p.id === themeMeta?.palette ? '' : p.id)}
          style={{ ...S.btn, justifyContent: 'flex-start', gap: '8px', border: 'none', background: shown.palette?.id === p.id ? '#2a2a2a' : 'transparent', color: shown.palette?.id === p.id ? '#f0f0f0' : '#aaa' }}>
          <PaletteSwatches tokens={p[shown.appearance] ?? {}} /><span>{p.title}{p.id === themeMeta?.palette ? <span style={{ color: '#666' }}> · theme default</span> : null}</span>
        </button>)}
      </span>
      {LANGUAGES.length > 0 && <span class="presenter-language" role="group" aria-label="Language" style={{ display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
        {LANGUAGES.map(code => <button key={code} type="button" aria-pressed={lang === code} title={`${languageName(code)} (L switches)`} onClick={() => setLang(code)}
          style={{ ...S.btn, padding: '5px 9px', ...(lang === code ? { background: '#2a2a2a', color: '#f0f0f0', borderColor: '#444' } : {}) }}>{code.toUpperCase()}</button>)}
      </span>}
    </PanelSection>
    <PanelSection title="Timer">
      <span style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <button type="button" class="presenter-timer-reset" style={S.btn} onClick={timer.reset}><Icon name="reset" size={16} />Reset the timer</button>
        {!timer.rehearsing && <button type="button" class="presenter-rehearse" style={S.btn} title="Time each slide, then save the times into the deck" onClick={timer.startRehearsal}><Icon name="rehearse" size={16} />Rehearse</button>}
      </span>
    </PanelSection>
    <label class="presenter-note-size" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span>Size of the notes</span>
      <span aria-hidden="true" style={{ marginInlineStart: 'auto', fontSize: '11px', color: '#888' }}>A</span>
      <input type="range" min="11" max="26" step="1" value={noteSize} aria-label="Size of the notes" onInput={e => setNoteSize(Number(e.currentTarget.value))} style={{ width: '96px', accentColor: '#888', cursor: 'pointer' }} />
      <span aria-hidden="true" style={{ fontSize: '17px', color: '#888' }}>A</span>
    </label>
    {launchPage && <a class="presenter-home" href={launchPage} style={{ ...S.btn, alignSelf: 'flex-start', boxSizing: 'border-box', textDecoration: 'none' }}><Icon name="home" size={16} />Back to the launch page</a>}
  </Popover>
  const notesBox = <div class="notes-md" dir={notesDir} style={{ flex: 1, minHeight: 0, overflow: 'auto', margin: 0, padding: '12px 14px', lineHeight: 1.55, background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: `${noteSize}px`, color: note ? '#c8c8c8' : '#3a3a3a' }}
    dangerouslySetInnerHTML={{ __html: notesHtml }} />
  const nextTitle = hasNext ? `Next: ${slideTitleOf(slides[index + 1]) || `slide ${index + 2}`}` : 'Last slide'
  const schedule = timed && <div class="presenter-schedule" style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
    <span>Slide <span class="presenter-slide-time" style={{ color: slideColor }}>{slideText}</span>{planned ? <span style={{ color: '#555' }}> of {formatClock(planned)}</span> : null}</span>
    <span><span class="presenter-delta" style={{ color: deltaColor }}>{deltaText}</span><span style={{ color: '#555' }}> · of {formatClock(plan.total)}</span></span>
  </div>
  const rehearsing = timer.rehearsing && <div class="presenter-rehearsing" role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, padding: '6px 10px', borderRadius: '8px', border: '1px solid #5c2b28', color: '#f28b82' }}>
    <span>● Rehearsing{timer.running ? '' : ' (paused)'}: this slide {formatClock(Math.floor(timer.slideElapsed))}</span>
    <button style={{ ...S.btn, padding: '2px 10px' }} onClick={finishRehearsal}>Finish</button>
  </div>
  const blankNote = blank && <div class="presenter-blank-note" role="status" style={{ position: 'fixed', left: layout === 'speaker' ? 'calc(100% / 3)' : '50%', bottom: remoteLayout ? '110px' : '76px', transform: 'translateX(-50%)', zIndex: 18, display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', borderRadius: '999px', background: 'rgba(17,17,17,0.92)', border: '1px solid #3a3a3a', color: '#f0f0f0', fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: '14px', pointerEvents: 'none' }}>
    <PresenterIcon name="blank" size={16} />The audience sees a black screen
  </div>
  const goOnNote = goOn != null && framed && index !== goOn && <div class="presenter-go-on" role="status" style={{ position: 'fixed', left: layout === 'speaker' ? 'calc(100% / 3)' : '50%', bottom: remoteLayout ? '110px' : '76px', transform: 'translateX(-50%)', zIndex: 18, display: 'flex', alignItems: 'center', gap: '10px', maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box', padding: '6px 6px 6px 14px', borderRadius: '999px', background: 'rgba(17,17,17,0.94)', border: '1px solid #3a3a3a', color: '#f0f0f0', fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: '14px' }}>
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Last time: slide {goOn + 1}{slideTitleOf(slides[goOn]) ? `, ${slideTitleOf(slides[goOn])}` : ''}</span>
    <button type="button" class="presenter-go-on-yes" style={{ ...S.btn, padding: '4px 12px', borderRadius: '999px', background: '#f0f0f0', borderColor: '#f0f0f0', color: '#111', whiteSpace: 'nowrap' }} onClick={() => { navCommand('goTo', goOn); setGoOn(null) }}>Go on there</button>
    <button type="button" class="presenter-go-on-no" aria-label="Start from the first slide" title="Start from the first slide" style={{ ...S.btn, padding: '4px 9px', borderRadius: '999px' }} onClick={() => setGoOn(null)}>✕</button>
  </div>
  const font = { fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: '13px', color: '#ccc' }
  const extras = <>
    {blankNote}
    {goOnNote}
    {reacting && <Reactions style={remoteLayout ? { left: '16px', bottom: '100px' } : undefined} />}
    {helpOpen && <KeyHelp
      context={{ view: 'presenter', blank, join: hasActivities() || reacting, joinShown: join, overview: overviewOpen, hotspots: slideHotspots, hotspotSwitch: hotspotsOn, inking, fullscreen: canFullscreen, drawer: slideLayout, languages: LANGUAGES.length > 0 }}
      onClose={() => setHelpOpen(false)}
    />}
    {summaryPanel}
    {themeModalOpen && themeModal}
  </>

  // A phone in the hand: the slide small at the top, what can be done on it,
  // the notes, and the buttons to go on and back where the thumb is.
  if (remoteLayout) {
    const big = { ...S.btn, height: '72px', fontSize: '18px', fontWeight: 600, borderRadius: '14px' }
    return (
      <div class="presenter presenter--remote" style={{ ...font, fontSize: '14px', display: 'flex', flexDirection: 'column', gap: '10px', height: '100dvh', boxSizing: 'border-box', padding: 'max(10px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left))', background: '#111', overflow: 'hidden', touchAction: 'manipulation' }}>
        <div class="presenter-remote-bar" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          <SlideJump index={index} total={slides.length} onJump={i => navCommand('goTo', i)} style={{ color: '#888', whiteSpace: 'nowrap' }} />
          <span style={{ flex: 1 }} />
          {finishButton}{timerChip}{joinButton}{blankButton}{connections}{settings}
        </div>
        <div style={{ position: 'relative', flexShrink: 0, width: '100%', maxHeight: '32dvh', aspectRatio: '16/9', margin: '0 auto', borderRadius: '8px', overflow: 'hidden', border: '1px solid #2a2a2a', background: '#000' }}>
          <iframe ref={iframeRef} title="Presenter deck" src={iframeSrc} style={{ width: '100%', height: '100%', border: '0', display: 'block' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexShrink: 0, fontSize: '13px', color: '#888', fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nextTitle}</span>
          {timed && <span style={{ flexShrink: 0 }}><span class="presenter-slide-time" style={{ color: slideColor }}>{slideText}</span> · <span class="presenter-delta" style={{ color: deltaColor }}>{deltaText}</span></span>}
        </div>
        {savedNote && <div role="status" style={{ flexShrink: 0, color: '#81c995' }}>{savedNote}</div>}
        {slideBar(true)}
        {notesBox}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px', flexShrink: 0 }}>
          <button class="presenter-remote-prev" style={big} aria-label="Previous" onClick={() => navCommand('prev')}><PresenterIcon name="prev" size={28} /></button>
          <button class="presenter-remote-next" style={{ ...big, background: '#f0f0f0', borderColor: '#f0f0f0', color: '#111' }} aria-label="Next" onClick={() => navCommand('next')}>Next<PresenterIcon name="next" size={28} /></button>
        </div>
        {extras}
      </div>
    )
  }

  // The next slide and the notes: the speaker layout's column, the iPad's drawer.
  const aside = <aside class="presenter-aside" style={{
    ...font, display: slideLayout && !drawerOpen ? 'none' : 'flex', flexDirection: 'column', gap: '12px', padding: '14px', boxSizing: 'border-box',
    borderLeft: '1px solid #2a2a2a', background: '#111', overflow: 'hidden', minHeight: 0,
    ...(slideLayout ? { position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(400px, 92vw)', zIndex: 19, paddingTop: '68px', boxShadow: '-12px 0 32px rgba(0,0,0,0.5)' } : {}),
  }}>
    {!slideLayout && <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
      <SlideJump index={index} total={slides.length} pad={2} onJump={i => navCommand('goTo', i)} style={{ color: '#888', fontVariantNumeric: 'tabular-nums' }} />
      <span style={{ flex: 1 }} />
      {finishButton}{timerChip}{audienceButton}{connections}{settings}
    </div>}
    {slideLayout && <span style={{ display: 'none' }}><SlideJump index={index} total={slides.length} pad={2} onJump={i => navCommand('goTo', i)} /></span>}
    {schedule}
    {rehearsing}
    {savedNote && <div role="status" style={{ flexShrink: 0, color: '#81c995' }}>{savedNote}</div>}
    {hasNext ? <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0 }}>
      <div style={{ width: '46%', flexShrink: 0, aspectRatio: '16/9', borderRadius: '6px', overflow: 'hidden', border: '1px solid #2a2a2a', background: '#000' }}>
        <iframe ref={previewRef} title="Next slide preview" src={previewSrc} scrolling="no" style={{ width: '100%', height: '100%', border: '0', pointerEvents: 'none' }} />
      </div>
      <span style={{ color: '#888', lineHeight: 1.4 }}>{nextTitle}</span>
    </div> : <span style={{ color: '#666', flexShrink: 0 }}>Last slide</span>}
    {notesBox}
  </aside>

  // The iPad: the slide fills the screen, one slim bar on top.
  if (slideLayout) return (
    <div class="presenter presenter--slide" style={{ height: '100dvh', background: '#111', overflow: 'hidden', touchAction: 'pan-x pan-y' }}>
      <iframe ref={iframeRef} title="Presenter deck" src={iframeSrc} style={{ width: '100%', height: '100%', border: '0', display: 'block' }} />
      <div class="presenter-pill" role="toolbar" aria-label="Presenter" style={{ ...font, position: 'fixed', top: 'max(10px, env(safe-area-inset-top))', right: 'max(10px, env(safe-area-inset-right))', zIndex: 20, display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 'calc(100vw - 20px)', padding: '4px', borderRadius: '14px', background: 'rgba(17,17,17,0.9)', border: '1px solid #2a2a2a', fontVariantNumeric: 'tabular-nums' }}>
        <SlideJump index={index} total={slides.length} onJump={i => navCommand('goTo', i)} style={{ padding: '0 4px', color: '#888' }} />
        {finishButton}{timerChip}
        {separator}{nav}
        {separator}{drawButton}{blankButton}{joinButton}{overviewButton}{hotspotsButton}
        {(slideControls.items.length > 0 || slideControls.hotspots > 0) && <>{separator}{slideBar(false)}</>}
        {separator}
        <ToolButton class="presenter-notes" icon="file-text" label="Notes and the next slide (N)" pressed={drawerOpen} onClick={() => setDrawerOpen(open => !open)} />
        {fullscreenButton}{audienceButton}{connections}{settings}
      </div>
      {aside}
      {extras}
    </div>
  )

  // A computer: the slide with its toolbar, the time, next slide and notes beside it.
  return (
    <div class="presenter presenter--speaker" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', height: '100dvh', background: '#111', overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <iframe ref={iframeRef} title="Presenter deck" src={iframeSrc} style={{ flex: 1, minHeight: 0, width: '100%', border: '0', display: 'block' }} />
        <div class="presenter-toolbar" role="toolbar" aria-label="Presenter" style={{ ...font, display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', padding: '8px 12px', borderTop: '1px solid #2a2a2a', background: '#111' }}>
          {nav}
          {separator}{drawButton}{blankButton}{joinButton}{overviewButton}{hotspotsButton}{fullscreenButton}
          {(slideControls.items.length > 0 || slideControls.hotspots > 0) && <>{separator}<span style={{ ...S.label, marginBottom: 0, marginInlineEnd: '4px' }}>This slide</span>{slideBar(false)}</>}
          <span style={{ flex: 1 }} />
          <ToolButton class="presenter-help" icon="guides" label="All keys (?)" onClick={() => setHelpOpen(open => !open)} />
        </div>
      </div>
      {aside}
      {extras}
    </div>
  )
}

// The join code over the slide (J in the presenter view): the room scans it
// from the projector, a phone following the talk shows it too. A click on it,
// or the next step, hides it again where the screen is not only watching.
function JoinOverlay({ stage }) {
  const [on, setOn] = useState(stage.join)
  useEffect(() => {
    const follow = () => setOn(stage.join)
    stage.addEventListener('joinchange', follow)
    return () => stage.removeEventListener('joinchange', follow)
  }, [])
  if (!on) return null
  const size = Math.round(Math.min(window.innerHeight * 0.55, window.innerWidth * 0.5, 520))
  return <div class="join-overlay export-hidden" role="dialog" aria-label={t('join.scan')}
    onClick={() => { if (!stage.hasAttribute('data-watching')) stage.setJoin(false, 'click') }}
    style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.72)' }}>
    <div style={{ background: '#fff', color: '#111', borderRadius: '18px', padding: '24px 32px', '--qr-ink': '#000', '--qr-bg': '#fff', '--ink': '#111', '--muted': '#555' }}>
      <QrCodeTag join size={String(size)} />
    </div>
  </div>
}

// Renders (or re-renders) the deck stage. Slides are keyed by id so an edit to
// one slide leaves the others and the stage's position untouched.
let unfit = null
let followDeck = null
function mountDeck({ deck, deckConfig, selection = null, editor = false }) {
  const { slides } = deck
  injectSpeakerNotes(slides)
  const seen = new Map()
  const app = (
    <deck-stage width={deckConfig.width ?? 1920} height={deckConfig.height ?? 1080} data-hotspots={String(deckConfig.hotspots ?? 'off')}>
      {slides.map((slide, i) => {
        const count = (seen.get(slide.id) ?? 0) + 1
        seen.set(slide.id, count)
        const key = count > 1 ? `${slide.id}#${i}` : slide.id
        const props = { id: slide.id, regions: slide.regions, meta: slide.meta, content: slide.content, deckConfig, index: i, total: slides.length }
        if (!editor) return <SlideRenderer key={key} {...props} />
        return <SlideErrorBoundary key={key} id={slide.id} source={deck.source.slice(slide.source.start, slide.source.end)}><SlideRenderer {...props} /></SlideErrorBoundary>
      })}
    </deck-stage>
  )
  render(app, document.body)
  document.querySelector('deck-stage')?.setLabels(stageLabels())
  const stage = document.querySelector('deck-stage')
  if (stage) stage.inkRenderer = strokePath
  followDeck?.()
  followDeck = followActiveRooms(document.querySelector('deck-stage'), slides)
  // Code taller than its place scrolls; too-full slides are reported (fit.js).
  unfit?.()
  unfit = fitDeck(document.querySelector('deck-stage'))
  if (!selection) return
  // The stage re-collects its slides asynchronously after structural changes.
  setTimeout(() => {
    const stage = document.querySelector('deck-stage')
    if (stage && stage.index !== selection.index) stage.setState({ index: selection.index, slideId: selection.slideId, step: -1 })
  }, 0)
}

async function init() {
  // An iPad that opened the launch page's QR code pairs first.
  await claimPairing()
  const url = new URL(window.location.href)
  if (import.meta.env.DEV && url.searchParams.get('sample') === '1') {
    const { sampleDeck, sampleDataUrl } = await import('../editor/sampleDeck.js')
    slidesContent = sampleDeck(sampleDataUrl())
  } else chooseLanguage(url.searchParams.get('lang'))
  let parsed = parseSlides(slidesContent)
  const editorMode = url.searchParams.get('editor') === '1'
  // One switch selects the view: deck, reader, presenter or audience.
  const defaultView = typeof __MDECK_DEFAULT_VIEW__ !== 'undefined' ? __MDECK_DEFAULT_VIEW__ : 'deck'
  const view = requestedView(url, defaultView)
  const errors = validateDeck(parsed, { layouts: manifests }).filter(d => d.severity === 'error')
  if (errors.length && !editorMode) {
    document.body.textContent = errors.map(d => `Line ${d.line}: ${d.message}`).join('\n')
    document.body.style.whiteSpace = 'pre-wrap'
    return
  }
  const deckConfig = withConfigOverrides(withFileLanguage(parsed.deckConfig))
  setCalloutLabels(deckConfig)
  setDeckLanguage(deckConfig)
  document.documentElement.lang = deckLanguage()
  configureLive(deckConfig)
  reactionsWanted = !!reactionsOf(deckConfig)
  setSavedResults(savedResults)
  const { slides } = parsed
  const presenterMode = view === 'presenter'
  const audienceMode  = view === 'audience'
  // A phone or laptop in the room following the talk: shows, never sends.
  const followMode = view === 'follow'
  const embedded = url.searchParams.get('embedded') === '1'
  const readerMode = view === 'reader' && !editorMode && !embedded
  // The deck window and the presenter's main frame draw; the audience window
  // and the next-slide preview show what is drawn.
  const drawHere = !audienceMode && !followMode && (!embedded || url.searchParams.get('draw') === '1')
  // What deck components learn from useView() (component.js).
  setView(audienceMode ? 'audience' : followMode ? 'follow' : readerMode ? 'reader' : embedded ? (drawHere && !editorMode ? 'presenter' : 'preview') : 'deck')
  const inkStorageKey = `mdeck-ink:${inkFileName}:${location.pathname}`

  injectSpeakerNotes(slides)

  if (presenterMode) {
    actAsPresenter()
    // A tool of mdeck's, like the launch page: its mark in the tab.
    const icon = document.querySelector('link[rel=icon]') ?? document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }))
    icon.href = mdeckMark
    followPresence()
    document.body.style.margin = '0'
    const s = document.createElement('style')
    s.textContent = `
      .notes-md p { margin: 0 0 6px; }
      .notes-md p:last-child { margin-bottom: 0; }
      .notes-md ul, .notes-md ol { margin: 0 0 6px; padding-inline-start: 1.4em; }
      .notes-md li { margin-bottom: 2px; }
      .notes-md strong, .notes-md b { color: #f0f0f0; font-weight: 600; }
      .notes-md em, .notes-md i { font-style: italic; color: #bbb; }
      .notes-md code { direction: ltr; unicode-bidi: isolate; font-family: ui-monospace, monospace; font-size: 0.9em; background: #222; padding: 1px 4px; border-radius: 3px; }
      .notes-md a { color: #aaa; }
    `
    document.head.appendChild(s)
    render(<PresenterView deckConfig={deckConfig} slides={slides} />, document.body)
    return
  }

  function handleDeckControl(ctrl) {
    if (!ctrl) return
    const stage = document.querySelector('deck-stage')
    if (!stage) return
    if (ctrl.command === 'next') stage.next()
    else if (ctrl.command === 'prev') stage.prev()
    else if (ctrl.command === 'reset') stage.reset()
    else if (ctrl.command === 'goTo' && Number.isInteger(ctrl.value)) stage.goTo(ctrl.value)
    else if (ctrl.command === 'setState') stage.setState(ctrl.value)
    else if (ctrl.command === 'setLanguage') switchLanguage(ctrl.value)
    else if (ctrl.command === 'ink' && drawHere) stage.inking = ctrl.value === 'toggle' ? !stage.inking : !!ctrl.value
    // Digits and Escape typed in the presenter view, and its hotspots switch.
    else if (ctrl.command === 'hotspotKey' && typeof ctrl.value === 'string') stage.hotspotKey(ctrl.value)
    else if (ctrl.command === 'hotspots') stage.hotspotsForced = ctrl.value
    // The phone clicker pressed one of the slide's controls.
    else if (ctrl.command === 'slideControl' && Number.isInteger(ctrl.value)) pressSlideControl(stage, ctrl.value)
    // B in the presenter view: the screens the audience sees go black.
    // O in the presenter view: the overview opens in its own slide frame.
    else if (ctrl.command === 'overview') stage.overview = ctrl.value === 'toggle' ? !stage.overview : !!ctrl.value
    else if (ctrl.command === 'overviewKey' && typeof ctrl.value === 'string') stage.overviewKey(ctrl.value)
    else if (ctrl.command === 'blank') stage.setBlank(ctrl.value === 'toggle' ? !stage.blank : !!ctrl.value, 'keyboard')
    else if (ctrl.command === 'join') stage.setJoin(ctrl.value === 'toggle' ? !stage.join : !!ctrl.value, 'keyboard')
  }

  // The same slide and step in another language, its words and mdeck's own;
  // or `state`, where the screen that switched is: that screen tells the
  // others, not the ones that follow it. Says whether it switched.
  let announceLanguage = null
  function switchLanguage(lang, { state = document.querySelector('deck-stage')?.state, announce = true } = {}) {
    if (lang === deckLang || !chooseLanguage(lang)) return false
    const stage = document.querySelector('deck-stage')
    parsed = parseSlides(slidesContent)
    const config = withConfigOverrides(withFileLanguage(parsed.deckConfig))
    setCalloutLabels(config)
    setDeckLanguage(config)
    document.documentElement.lang = deckLanguage()
    // Explicit slide ids may differ between the files; the place does not.
    mountDeck({ deck: parsed, deckConfig: config })
    if (state) setTimeout(() => document.querySelector('deck-stage')?.setState({ ...state, slideId: undefined }), 0)
    if (!embedded && !followMode && stage) announceSlide(parsed, stage.index)
    if (announce) announceLanguage?.()
    if (embedded) window.parent.postMessage({ deckLanguage: lang }, window.location.origin)
    return true
  }

  // Editor preview: the editor pushes whole sources; render best effort and
  // report back. Bad decks never blank the preview here.
  if (editorMode) {
    const post = message => window.parent.postMessage(message, window.location.origin)
    const bridge = createEditorBridge({
      parse: parseSlides, validate: deck => validateDeck(deck, { layouts: manifests }), loadTheme, setExtensionOverrides,
      setCalloutLabels: config => { setCalloutLabels(config); setDeckLanguage(config); document.documentElement.lang = deckLanguage() },
      applyOverrides: withConfigOverrides, mount: context => mountDeck({ ...context, editor: true }), post,
    })
    window.addEventListener('message', event => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return
      if (!bridge.handleMessage(event.data)) handleDeckControl(event.data?.deckControl)
    })
    // Saving the deck or its reference file reformats the citations.
    onBibliography(() => bridge.refresh())
    await bridge.render(slidesContent)
    post({ deckEditorReady: true })
    return
  }

  if (readerMode) {
    document.body.style.margin = '0'
    await loadTheme(deckConfig)
    render(<ReaderView deck={parsed} deckConfig={deckConfig} />, document.body)
    return
  }

  await loadTheme(deckConfig)
  mountDeck({ deck: parsed, deckConfig })
  if (!embedded && !audienceMode && !followMode) {
    // A quiet way into the reader view for anyone who opened the file directly.
    const entry = document.createElement('a')
    entry.className = 'reader-entry'
    entry.href = '?view=reader'
    entry.textContent = t('deck.overview')
    document.body.appendChild(entry)
  }

  // Drawing (D) in the full-screen deck and the presenter's main frame.
  const inkStage = document.querySelector('deck-stage')
  // The join code over the slide, on every screen but the next-slide preview;
  // J shows it in a deck phones join.
  if (inkStage && (hasActivities() || reactionsOf(deckConfig))) inkStage.setAttribute('data-joinable', '')
  if (inkStage && !(embedded && !drawHere)) {
    const host = document.createElement('div')
    host.className = 'join-overlay-host'
    document.body.appendChild(host)
    render(<JoinOverlay stage={inkStage} />, host)
  }
  // Main slide frames and audience windows both send and follow navigation.
  // Share their position connection with ink; previews stay on local channels.
  if (inkStage && (drawHere || audienceMode)) {
    followStageRoom(inkStage, { onLanguage: (lang, state) => switchLanguage(lang, { state, announce: false }) })
    announceLanguage = announceStagePosition(inkStage, { language: () => LANGUAGES.length ? deckLang : null })
  }
  // Whether another screen shows the deck, so that a video played in the
  // presenter view is silent there and its sound comes from that screen
  // (components/VideoPlayer.jsx). The server says who is connected; an
  // audience window also says so to the windows of its own browser, for a
  // deck opened without a server (a built folder).
  const screens = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`mdeck-screens:${inkStorageKey}`) : null
  let watchedOnServer = false, audienceHere = 0
  const markWatched = () => inkStage?.toggleAttribute('data-others-watching', watchedOnServer || Date.now() - audienceHere < SCREEN_GONE_MS)
  if (screens && audienceMode) {
    const say = message => screens.postMessage(message)
    say('audience')
    setInterval(() => say('audience'), SCREEN_SAY_MS)
    window.addEventListener('pagehide', () => say('gone'))
  } else if (screens && embedded && drawHere) {
    screens.onmessage = ({ data }) => { audienceHere = data === 'audience' ? Date.now() : 0; markWatched() }
    setInterval(markWatched, SCREEN_SAY_MS)
  }

  // The presenter's slide shows the hotspots' keys; no screen the audience sees does.
  // A black screen only veils it.
  // The phone remote's small slide only shows: no keys, no drawing.
  const remoteFrame = embedded && url.searchParams.get('remote') === '1'
  if (inkStage && embedded && drawHere) {
    if (!remoteFrame) inkStage.setAttribute('data-hotspot-badges', '')
    inkStage.setAttribute('data-presenter', '')
    // The presenter view routes the keys to the overview while it is open.
    inkStage.addEventListener('overviewchange', event => window.parent.postMessage({ overview: event.detail.open }, window.location.origin))
    // A frame that reloaded (another theme) has none open.
    window.parent.postMessage({ overview: false }, window.location.origin)
  }
  // ? lists the keys that work now: in a deck window over the slide; in the
  // presenter's slide frame it goes to the presenter view, which shows them.
  if (inkStage && !embedded && !audienceMode && !followMode) attachKeyHelp(inkStage, { canDraw: drawHere })
  else if (embedded && drawHere) {
    window.addEventListener('keydown', event => {
      if (!isHelpKey(event) || event.target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return
      event.preventDefault()
      window.parent.postMessage({ keyHelp: 'toggle' }, window.location.origin)
    })
  }
  // The presenter view shows the slide's own controls in its toolbar, the
  // clicker as big buttons (slideControls.js).
  if (inkStage && embedded && drawHere) watchSlideControls(inkStage, controls => window.parent.postMessage({ slideControls: controls }, window.location.origin))
  if (inkStage && remoteFrame) {
    watchInk(inkStage, { storageKey: inkStorageKey, transports: [roomTransport({ receive: true, view: 'presenter', onPresence: presence => {
      watchedOnServer = (presence?.views ?? []).some(entry => entry.view === 'audience' || entry.view === 'deck')
      markWatched()
      window.parent.postMessage({ presence }, window.location.origin)
    } })] })
  } else if (inkStage && drawHere) {
    attachInk(inkStage, {
      storageKey: inkStorageKey,
      // The presenter's main frame tells the presenter view who is connected.
      transports: [roomTransport({ receive: true, view: embedded ? 'presenter' : 'deck', onPresence: embedded ? presence => {
        watchedOnServer = (presence?.views ?? []).some(entry => entry.view === 'audience' || entry.view === 'deck')
        markWatched()
        window.parent.postMessage({ presence }, window.location.origin)
      } : null })],
      onMode: inking => { if (embedded) window.parent.postMessage({ inkMode: inking }, window.location.origin) },
    })
    // Drawing turns itself on, with the laser and the toolbar folded into
    // its corner button, where it is wanted: in the presenter view on a
    // touch screen (an iPad), and in a deck window as soon as a pen touches
    // it. A phone or tablet only browsing the deck keeps its taps. D or the
    // close button turns it off.
    const startDrawing = () => { inkStage._inkCollapsed = true; inkStage.inking = true }
    if (embedded && matchMedia('(pointer: coarse)').matches) startDrawing()
    else if (!embedded) {
      const onPen = event => {
        if (event.pointerType !== 'pen') return
        window.removeEventListener('pointerdown', onPen, true)
        if (!inkStage.inking) startDrawing()
      }
      window.addEventListener('pointerdown', onPen, true)
    }
  } else if (inkStage && followMode) {
    // The presenter's slide and ink, read from the stage room; counted as a phone.
    inkStage.setAttribute('data-follower', '')
    inkStage.setAttribute('data-watching', '')
    onStagePosition(position => {
      if (position.lang) switchLanguage(position.lang, { announce: false })
      if (typeof position.blank === 'boolean') inkStage.setBlank(position.blank, 'sync')
      if (typeof position.join === 'boolean') inkStage.setJoin(position.join, 'sync')
    })
    startFollowing(inkStage, { onStagePosition, words: { live: t('follow.live'), back: t('follow.back'), waiting: t('follow.waiting') } })
    watchInk(inkStage, { storageKey: inkStorageKey, transports: [roomTransport({ receive: true, view: 'phone' })] })
  } else if (inkStage && audienceMode) {
    // The audience window shows the presenter's zoom and a poll's answer, without their controls.
    inkStage.setAttribute('data-follower', '')
    watchInk(inkStage, { storageKey: inkStorageKey, transports: [roomTransport({ receive: true, view: 'audience' })] })
  } else if (inkStage) watchInk(inkStage, { storageKey: inkStorageKey })

  // A full deck or audience window is a presenter's screen; previews are
  // embedded, and a follower only watches.
  if (!embedded && !followMode) {
    const stage = document.querySelector('deck-stage')
    stage?.addEventListener('slidechange', event => announceSlide(parsed, event.detail.index, { initial: event.detail.reason === 'init' }))
    if (stage) announceSlide(parsed, stage.index, { initial: true })
  }

  // Embedded iframes (presenter view + preview pane) receive commands via postMessage
  window.addEventListener('message', event => {
    if (event.source === window.parent && event.origin === window.location.origin) handleDeckControl(event.data?.deckControl)
  })

  // Audience window receives commands via BroadcastChannel — reliable same-origin sync
  // that doesn't depend on keeping a live cross-window reference
  if (audienceMode) {
    const bc = new BroadcastChannel(DECK_CHANNEL)
    const order = createOrder()
    bc.onmessage = ({ data }) => {
      const ctrl = data?.deckControl
      if (!ctrl) return
      // A position older than this window's own last change is ignored.
      if (ctrl.command === 'setState' && !order.accept(ctrl.order)) return
      if (ctrl.command === 'setTheme') {
        loadTheme({ theme: ctrl.theme, palette: ctrl.palette || undefined, appearance: ctrl.appearance || undefined })
      } else {
        handleDeckControl(ctrl)
      }
    }
    document.querySelector('deck-stage')?.addEventListener('slidechange', event => {
      if (event.detail.reason === 'init') bc.postMessage({ audienceReady: true })
    })
    document.querySelector('deck-stage')?.addEventListener('statechange', event => {
      if (!['init', 'sync'].includes(event.detail.reason)) bc.postMessage({ deckStateChanged: event.detail, order: order.stamp() })
    })
    bc.postMessage({ audienceReady: true })
  }
}

const urlProblem = validatePageUrl(new URL(location.href))
if (urlProblem) {
  const message = document.createElement('p')
  message.textContent = urlProblem.message
  const panel = document.createElement('main')
  panel.style.cssText = 'font:16px/1.5 system-ui;max-width:48rem;margin:3rem auto;padding:2rem'
  panel.setAttribute('role', 'alert')
  panel.append(message)
  if (urlProblem.corrected) {
    const link = document.createElement('a')
    link.href = urlProblem.corrected
    link.textContent = 'Open updated address'
    panel.append(link)
  }
  document.body.replaceChildren(panel)
} else init()
