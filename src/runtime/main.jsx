import { validatePageUrl } from '../core/urls.js'
import { h, render } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { marked } from 'marked'
import { renderCitations, onBibliography } from './citations.js'
import deckFileContent from 'virtual:slides'
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
import { claimPairing } from '../live/pairing.js'
import { strokePath } from '../core/ink.js'
import { inkFileName } from 'virtual:deck-ink'
import savedResults from 'virtual:deck-results'
import { roomsIn, roomsOnSlide, findRoomTag, slideTitleFor } from '../live/roomTag.js'
import { expandPollLists } from '../core/pollList.js'
import './reader.css'
import { SlideRenderer, manifests } from '../layouts/renderSlide'
import { setCalloutLabels } from './markedSetup'
import { setDeckLanguage, deckLanguage, stageLabels, t } from '../core/labels.js'
import { Icon } from '../components/Icon.jsx'
import { ConnectedViews } from '../components/ConnectedViews.jsx'
import './deck-stage.js'

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
// Asked several times on every slide change (presenter view, the phones'
// announcement, the views connected), so the answer is kept until the text
// changes: finding the tags reads the whole deck, which on an iPad made each
// slide change noticeably slower.
let activitiesOf = null, activitiesFound = false
const hasActivities = () => {
  if (activitiesOf !== slidesContent) { activitiesOf = slidesContent; activitiesFound = roomsIn(slidesContent).length > 0 }
  return activitiesFound
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
  'no-code': 'Phones do not follow: this browser has no server key. Open the presenter view once with ?serverkey=… (the launch page has a link).',
  'wrong-code': "Phones do not follow: the server does not accept this browser's presenter code.",
  unreachable: 'Phones do not follow: the server does not answer.',
  'other-screen': 'Phones follow another screen, where this presentation was moved on more recently. Change the slide here to take them back.',
}
function SteeringNote() {
  const steering = useSteering()
  if (!hasActivities() || !steering) return null
  return <div role="status" style={{ flexShrink: 0, padding: '6px 10px', borderRadius: '5px', fontSize: '12px', lineHeight: 1.4, border: `1px solid ${steering.ok ? '#2c4a35' : '#5c2b28'}`, color: steering.ok ? '#81c995' : '#f28b82' }}>
    {steering.ok ? 'Phones follow this presentation.' : STEERING[steering.reason]}
  </div>
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
function buildChildUrl(theme, palette, appearance, slideIndex = null, { draw = false } = {}) {
  const url = new URL(window.location.href)
  url.searchParams.delete('v')
  url.searchParams.set('view', 'deck')
  url.searchParams.set('embedded', '1')
  if (draw) url.searchParams.set('draw', '1')
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

function PresenterView({ deckConfig, slides }) {
  const [index, setIndex] = useState(0)
  const [theme, setTheme] = useState(deckConfig.theme ?? 'neue')
  // '' means the theme's own default, for both.
  const [palette, setPalette] = useState(deckConfig.palette ?? '')
  const [appearance, setAppearance] = useState(deckConfig.appearance ?? '')
  const [audienceConnected, setAudienceConnected] = useState(false)
  const [noteSize, setNoteSize] = useState(13)
  const [inking, setInking] = useState(false)
  const presence = usePresence()
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
  const [layout, setLayout] = useState(() => {
    try { const saved = localStorage.getItem('mdeck-presenter-layout'); if (saved) return saved } catch {}
    return matchMedia('(pointer: coarse)').matches ? 'slide' : 'speaker'
  })
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

  const [paletteOpen, setPaletteOpen] = useState(false)
  // The theme row shows unless the presenter folded it, like the ink toolbar,
  // into one round button.
  const [lookFolded, setLookFolded] = useState(() => { try { return localStorage.getItem('mdeck-presenter-look') === 'folded' } catch { return false } })
  function foldLook(folded) {
    setLookFolded(folded)
    setPaletteOpen(false)
    try { localStorage.setItem('mdeck-presenter-look', folded ? 'folded' : 'open') } catch {}
  }
  const [themeModalOpen, setThemeModalOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [timerRunning, setTimerRunning] = useState(false)
  const timerRef = useRef(null)

  const iframeRef = useRef(null)
  const previewRef = useRef(null)
  const audienceRef = useRef(null)
  const bcRef = useRef(null)
  // Positions sent to and taken from audience windows are ordered (syncOrder.js).
  const orderRef = useRef(null)
  orderRef.current ??= createOrder()
  const indexRef = useRef(0)
  const stateRef = useRef({ index: 0, step: -1 })
  const paletteDropRef = useRef(null)
  indexRef.current = index
  // Phones see the look of the slide this view shows, read from its frame.
  useEffect(() => { setLookSource(() => iframeRef.current?.contentDocument) }, [])
  const announcedOnce = useRef(false)
  useEffect(() => {
    announceSlide({ slides, deckConfig }, index, { initial: !announcedOnce.current })
    announcedOnce.current = true
  }, [index])

  const themeMeta = THEME_METAS[theme]
  // The palettes this theme offers, and what the deck shows right now.
  const offered = palettesFor(themeMeta, PALETTES)
  const shown = resolvePalette({ theme: themeMeta, palettes: PALETTES, palette, appearance })
  // A theme that does not offer the chosen palette falls back to its own.
  useEffect(() => { if (palette && !offered.some(p => p.id === palette)) setPalette('') }, [theme])
  const notes = useMemo(() => slides.map(s => s.meta?.notes ?? ''), [slides])
  // Preserve current slide when theme/palette causes an iframe reload
  const iframeSrc = useMemo(() => buildChildUrl(theme, palette, appearance, indexRef.current, { draw: true }), [theme, palette, appearance])
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
        if (data?.deckStateChanged && data.reason === 'init') sendTo(source, 'goTo', indexRef.current + 1)
        return
      }
      if (source !== iframeRef.current?.contentWindow) return
      if (typeof data?.inkMode === 'boolean') { setInking(data.inkMode); return }
      if (!data?.deckStateChanged) return
      const state = data.deckStateChanged
      const i = state.index
      // Theme reloads must not reset the current reveal position.
      if (data.reason === 'init' && stateRef.current.index === i) {
        sendTo(iframeRef.current?.contentWindow, 'setState', stateRef.current)
        return
      }
      stateRef.current = state
      setIndex(i)
      if (data.reason !== 'sync') {
        bcRef.current?.postMessage({ deckControl: { command: 'setState', value: state, order: orderRef.current.stamp() } })
      }
      sendTo(previewRef.current?.contentWindow, 'goTo', i + 1)
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
      const cmd =
        (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') ? 'next' :
        (e.key === 'ArrowLeft'  || e.key === 'PageUp')                    ? 'prev' :
        (e.key === 'Home' || e.key === 'r' || e.key === 'R')              ? 'reset' :
        (e.key === 'd' || e.key === 'D')                                  ? 'ink' : null
      if ((e.key === 'f' || e.key === 'F') && fullscreen?.available()) { e.preventDefault(); fullscreen.toggle(); return }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setDrawerOpen(open => !open); return }
      if (!cmd) return
      e.preventDefault()
      sendTo(iframeRef.current?.contentWindow, cmd, cmd === 'ink' ? 'toggle' : undefined)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Escape to close theme modal
  useEffect(() => {
    if (!themeModalOpen) return
    function handler(e) {
      if (e.key === 'Escape') setThemeModalOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [themeModalOpen])

  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [timerRunning])

  // Close palette dropdown on outside click
  useEffect(() => {
    if (!paletteOpen) return
    function handler(e) {
      if (!paletteDropRef.current?.contains(e.target)) setPaletteOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [paletteOpen])

  // When theme/palette changes, tell the audience to hot-swap its theme without
  // a reload. Phones pick it up with the next announcement.
  useEffect(() => {
    bcRef.current?.postMessage({ deckControl: { command: 'setTheme', theme, palette, appearance } })
  }, [theme, palette, appearance])

  // Nav buttons drive the presenter iframe; audience follows via slideIndexChanged
  function navCommand(cmd) {
    sendTo(iframeRef.current?.contentWindow, cmd)
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

  const note = notes[index] || ''
  const hasNext = index + 1 < slides.length

  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  const pill = { ...S.btn, minWidth: '40px', height: '40px', padding: '0 10px', fontSize: '15px' }

  return (
    <div class={`presenter presenter--${layout}`} style={{ display: 'grid', gridTemplateColumns: slideLayout ? '1fr' : '2fr 1fr', height: '100dvh', background: '#111', overflow: 'hidden', touchAction: 'pan-x pan-y' }}>
      <iframe
        ref={iframeRef}
        title="Presenter deck"
        src={iframeSrc}
        style={{ width: '100%', height: '100%', border: '0' }}
      />
      {slideLayout && (
        <div class="presenter-pill" role="toolbar" aria-label="Presenter" style={{ position: 'fixed', top: 'max(10px, env(safe-area-inset-top))', right: 'max(10px, env(safe-area-inset-right))', zIndex: 20, display: 'flex', gap: '4px', alignItems: 'center', padding: '4px', borderRadius: '12px', background: 'rgba(17,17,17,0.88)', border: '1px solid #2a2a2a', color: '#ccc', fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ padding: '0 8px', color: '#888' }}>{index + 1}/{slides.length}</span>
          <ConnectedViews presence={presence} phones={hasActivities()} style={{ color: '#888', padding: '0 6px' }} />
          <button style={{ ...pill, color: timerRunning ? '#f0f0f0' : '#777' }} title="Start or pause the timer" onClick={() => setTimerRunning(r => !r)}>{clock}</button>
          <button style={pill} title="Previous" aria-label="Previous" onClick={() => navCommand('prev')}><PresenterIcon name="prev" /></button>
          <button style={pill} title="Next" aria-label="Next" onClick={() => navCommand('next')}><PresenterIcon name="next" /></button>
          <button class="presenter-draw" title="Draw on the slide (D)" aria-pressed={inking} style={{ ...pill, ...(inking ? { background: '#e11d48', borderColor: '#e11d48', color: '#fff' } : {}) }} onClick={() => sendTo(iframeRef.current?.contentWindow, 'ink', 'toggle')}><PresenterIcon name="pen" /></button>
          <button class="presenter-notes" title="Notes (N)" aria-pressed={drawerOpen} style={{ ...pill, ...(drawerOpen ? { background: '#2a2a2a', color: '#fff' } : {}) }} onClick={() => setDrawerOpen(open => !open)}>Notes</button>
          {canFullscreen && <button class="presenter-fullscreen" style={pill} title={fullscreenLabel} aria-label={fullscreenLabel} aria-pressed={isFullscreen} onClick={() => fullscreen.toggle()}><PresenterIcon name={fullscreenIcon} /></button>}
          <button style={pill} title="Speaker layout: slide, notes and next slide side by side" onClick={() => chooseLayout('speaker')}><PresenterIcon name="speaker" /></button>
        </div>
      )}
      <aside class="presenter-aside" style={{
        display: slideLayout && !drawerOpen ? 'none' : 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '16px',
        borderLeft: '1px solid #2a2a2a',
        background: '#111',
        color: '#ccc',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: '13px',
        overflow: 'hidden',
        ...(slideLayout ? { position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(380px, 92vw)', zIndex: 19, paddingTop: '64px', boxShadow: '-12px 0 32px rgba(0,0,0,0.5)' } : {}),
      }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontWeight: 600, color: '#f0f0f0', fontSize: '14px' }}>Speaker View</span>
            <ConnectedViews presence={presence} phones={hasActivities()} style={{ color: '#888' }} />
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {!slideLayout && canFullscreen && <button class="presenter-fullscreen" style={{ ...S.btn, padding: '3px 8px' }} title={fullscreenLabel} aria-label={fullscreenLabel} aria-pressed={isFullscreen} onClick={() => fullscreen.toggle()}><PresenterIcon name={fullscreenIcon} /></button>}
            {!slideLayout && <button class="presenter-layout" style={{ ...S.btn, padding: '3px 8px' }} title="Slide only, notes in a drawer (for an iPad)" onClick={() => chooseLayout('slide')}><PresenterIcon name="tablet" /></button>}
            <span style={{ color: '#666', fontVariantNumeric: 'tabular-nums' }}>
              {String(index + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}
            </span>
          </span>
        </div>

        <SteeringNote />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '22px', letterSpacing: '0.05em', color: timerRunning ? '#f0f0f0' : '#555', fontWeight: 300 }}>
            {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button style={S.btn} title={timerRunning ? 'Pause the timer' : 'Start the timer'} aria-label={timerRunning ? 'Pause the timer' : 'Start the timer'} onClick={() => setTimerRunning(r => !r)}>
              <PresenterIcon name={timerRunning ? 'pause' : 'play'} size={16} />
            </button>
            <button style={S.btn} title="Reset the timer" aria-label="Reset the timer" onClick={() => { setTimerRunning(false); setElapsed(0) }}><PresenterIcon name="reset" size={16} /></button>
          </div>
        </div>

        {hasNext && (
          <div style={{ flexShrink: 0 }}>
            <span style={S.label}>Next slide</span>
            <div style={{ aspectRatio: '16/9', borderRadius: '4px', overflow: 'hidden', border: '1px solid #2a2a2a', background: '#000' }}>
              <iframe
                ref={previewRef}
                title="Next slide preview"
                src={previewSrc}
                scrolling="no"
                style={{ width: '100%', height: '100%', border: '0', pointerEvents: 'none' }}
              />
            </div>
          </div>
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
            <span style={{ ...S.label, marginBottom: 0 }}>Notes</span>
            <input
              type="range" min="11" max="22" step="1" value={noteSize}
              onInput={e => setNoteSize(Number(e.currentTarget.value))}
              style={{ width: '80px', accentColor: '#444', cursor: 'pointer', opacity: 0.6 }}
            />
          </div>
          <div class="notes-md" style={{
            flex: 1,
            margin: 0,
            padding: '10px 12px',
            lineHeight: 1.6,
            background: '#0a0a0a',
            border: '1px solid #2a2a2a',
            borderRadius: '5px',
            fontSize: `${noteSize}px`,
            color: note ? '#c8c8c8' : '#3a3a3a',
            fontFamily: 'inherit',
            overflow: 'auto',
          }}
            dangerouslySetInnerHTML={{
              __html: note
                ? marked.parse(renderCitations(note).markdown)
                : '<p>No notes — add a <code>:::notes</code> block to the slide.</p>',
            }}
          />
        </div>

        {!lookFolded && <div class="presenter-look" style={{ flexShrink: 0, display: 'flex', gap: '6px', marginBottom: '8px', alignItems: 'flex-end' }}>
          <label style={{ flex: 1 }}>
            <span style={S.label}>Theme</span>
            <button
              onClick={() => setThemeModalOpen(true)}
              style={{ ...S.select, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', cursor: 'pointer' }}
            >
              <span>{theme}</span>
              <span style={{ opacity: 0.5, flexShrink: 0 }}><PresenterIcon name="grid" size={13} /></span>
            </button>
          </label>
          <label style={{ flex: 1 }}>
            <span style={S.label}>Palette</span>
            <div ref={paletteDropRef} style={{ position: 'relative' }}>
              <button
                class="presenter-palette"
                onClick={() => setPaletteOpen(o => !o)}
                style={{ ...S.select, display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', textAlign: 'left' }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shown.palette?.title ?? ''}</span>
                <PaletteSwatches tokens={shown.palette?.[shown.appearance] ?? {}} />
                <span style={{ opacity: 0.5, flexShrink: 0 }}><PresenterIcon name="dropdown" size={13} /></span>
              </button>
              {paletteOpen && (
                <div style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, right: 0, background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: '5px', zIndex: 100, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.6)' }}>
                  {offered.map(p => (
                    <div
                      key={p.id}
                      class="presenter-palette-option"
                      title={p.description}
                      onClick={() => { setPalette(p.id === themeMeta?.palette ? '' : p.id); setPaletteOpen(false) }}
                      style={{ padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', fontSize: '13px', color: shown.palette?.id === p.id ? '#f0f0f0' : '#aaa', background: shown.palette?.id === p.id ? '#2a2a2a' : 'transparent' }}
                    >
                      <span>{p.title}{p.id === themeMeta?.palette ? <span style={{ color: '#666' }}> · theme default</span> : null}</span>
                      <PaletteSwatches tokens={p[shown.appearance] ?? {}} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </label>
          <label style={{ flexShrink: 0 }}>
            <span style={S.label}>Light or dark</span>
            <div class="presenter-appearance" role="group" aria-label="Light or dark" style={{ display: 'flex', gap: '2px', height: '28px' }}>
              {['light', 'dark'].map(mode => (
                <button
                  key={mode}
                  aria-pressed={shown.appearance === mode}
                  title={mode === 'light' ? 'Light: for bright rooms' : 'Dark: for dark rooms'}
                  aria-label={mode === 'light' ? 'Light' : 'Dark'}
                  onClick={() => setAppearance(mode === (themeMeta?.appearance ?? 'light') ? '' : mode)}
                  style={{ ...S.btn, padding: '3px 7px', ...(shown.appearance === mode ? { background: '#2a2a2a', color: '#f0f0f0', borderColor: '#444' } : {}) }}
                ><PresenterIcon name={mode === 'light' ? 'sun' : 'moon'} size={16} /></button>
              ))}
            </div>
          </label>
          <button class="presenter-look-fold" title="Fold theme and palette" aria-label="Fold theme and palette" onClick={() => foldLook(true)}
            style={{ ...S.btn, padding: 0, width: '28px', height: '28px', flexShrink: 0, background: 'none', borderColor: 'transparent', color: '#888' }}
          ><PresenterIcon name="fold" size={16} /></button>
        </div>}

        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button style={S.btn} onClick={() => navCommand('prev')}><PresenterIcon name="prev" size={15} />Prev</button>
            <button style={S.btn} onClick={() => navCommand('next')}>Next<PresenterIcon name="next" size={15} /></button>
            <button style={S.btn} onClick={() => navCommand('reset')}>Reset</button>
            <button
              class="presenter-draw"
              title="Draw on the slide (D)"
              aria-pressed={inking}
              style={{ ...S.btn, ...(inking ? { background: '#e11d48', borderColor: '#e11d48', color: '#fff' } : {}) }}
              onClick={() => sendTo(iframeRef.current?.contentWindow, 'ink', 'toggle')}
            ><PresenterIcon name="pen" size={15} />Draw</button>
            {lookFolded && <button
              class="presenter-look-unfold"
              title={`Theme and palette: ${themeMeta?.title ?? theme}, ${shown.palette?.title ?? ''}`}
              aria-label="Show theme and palette"
              onClick={() => foldLook(false)}
              style={{ ...S.btn, position: 'relative', padding: 0, width: '32px', height: '32px', borderRadius: '50%' }}
            >
              <PresenterIcon name="look" size={16} />
              <span style={{ position: 'absolute', right: '2px', bottom: '2px', width: '9px', height: '9px', borderRadius: '50%', background: shown.palette?.[shown.appearance]?.['--accent'] ?? '#888', boxShadow: '0 0 0 1.5px #222' }} />
            </button>}
            <button
              style={{
                ...S.btn,
                marginLeft: 'auto',
                color: audienceConnected ? '#444' : '#bbb',
              }}
              onClick={openAudienceWindow}
            >
              {audienceConnected ? 'Reconnect' : 'Audience'}
            </button>
          </div>
          <div style={{ color: '#444', fontSize: '11px', textAlign: 'center' }}>
            Arrow keys · Space · PgUp/PgDn · R to reset
          </div>
        </div>

      </aside>

      {themeModalOpen && (
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
      )}
    </div>
  )
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
    <deck-stage width={deckConfig.width ?? 1920} height={deckConfig.height ?? 1080}>
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
  }
  const parsed = parseSlides(slidesContent)
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
  const deckConfig = withConfigOverrides(parsed.deckConfig)
  setCalloutLabels(deckConfig)
  setDeckLanguage(deckConfig)
  document.documentElement.lang = deckLanguage()
  configureLive(deckConfig)
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
  const inkStorageKey = `mdeck-ink:${inkFileName}:${location.pathname}`

  injectSpeakerNotes(slides)

  if (presenterMode) {
    actAsPresenter()
    followPresence()
    document.body.style.margin = '0'
    const s = document.createElement('style')
    s.textContent = `
      .notes-md p { margin: 0 0 6px; }
      .notes-md p:last-child { margin-bottom: 0; }
      .notes-md ul, .notes-md ol { margin: 0 0 6px; padding-left: 1.4em; }
      .notes-md li { margin-bottom: 2px; }
      .notes-md strong, .notes-md b { color: #f0f0f0; font-weight: 600; }
      .notes-md em, .notes-md i { font-style: italic; color: #bbb; }
      .notes-md code { font-family: ui-monospace, monospace; font-size: 0.9em; background: #222; padding: 1px 4px; border-radius: 3px; }
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
    else if (ctrl.command === 'ink' && drawHere) stage.inking = ctrl.value === 'toggle' ? !stage.inking : !!ctrl.value
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
  // Main slide frames and audience windows both send and follow navigation.
  // Share their position connection with ink; previews stay on local channels.
  if (inkStage && (drawHere || audienceMode)) {
    followStageRoom(inkStage)
    announceStagePosition(inkStage)
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

  if (inkStage && drawHere) {
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
