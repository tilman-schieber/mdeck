import { h, render } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { marked } from 'marked'
import slidesContent from 'virtual:slides'
import { parseSlides } from '../core/parseSlides'
import { validateDeck } from '../core/validateDeck'
import { loadTheme, setExtensionOverrides, THEME_NAMES, PALETTE_NAMES, THEME_METAS, PALETTES } from './themeLoader'
import { effectiveToken } from '../extensions/appearance.js'
import { S, PaletteSwatches } from './chrome.jsx'
import { SlideErrorBoundary } from './SlideErrorBoundary.jsx'
import { createEditorBridge } from './editorBridge.js'
import { ShareView } from './ShareView.jsx'
import { configureLive, announce, setLookSource, actAsPresenter, useSteering } from '../live/client.js'
import { registry } from './registry'
import { followActiveRooms } from '../live/follow.js'
import { roomsIn, roomsOnSlide, findRoomTag, slideTitleFor } from '../live/roomTag.js'
import './share.css'
import { SlideRenderer, manifests } from '../templates/renderSlide'
import { setCalloutLabels } from './markedSetup'
import { setDeckLanguage, deckLanguage, stageLabels, t } from '../core/labels.js'
import './deck-stage.js'

// One address parameter selects the view. `?view=share` and the shortcut
// `?v=s` mean the same; the letters are d, s, p and a.
const VIEW_ALIASES = { d: 'deck', s: 'share', p: 'presenter', a: 'audience' }
export function requestedView(url, fallback = 'deck') {
  const raw = url.searchParams.get('view') ?? url.searchParams.get('v')
  if (raw == null) return fallback
  return VIEW_ALIASES[raw] ?? raw
}

// Scope controls to this file and presenter session, including separate tabs.
const controlUrl = new URL(window.location.href)
if (requestedView(controlUrl) === 'presenter' && !controlUrl.searchParams.has('session')) {
  // randomUUID only exists on https or localhost, not on an iPad at http://192.168…
  controlUrl.searchParams.set('session', crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''))
  history.replaceState(null, '', controlUrl)
}
const DECK_CHANNEL = `deck-control:${controlUrl.pathname}:${controlUrl.searchParams.get('session') ?? 'default'}`

function withConfigOverrides(deckConfig) {
  const url = new URL(window.location.href)
  const design = url.searchParams.get('design')
  const palette = url.searchParams.get('palette')
  const accent  = url.searchParams.get('accent')
  const accent2 = url.searchParams.get('accent2')
  return {
    ...deckConfig,
    // Use !== null so an explicit ?palette= / ?accent= (empty string) overrides the frontmatter value
    ...(design  !== null ? { design }  : {}),
    ...(palette !== null ? { palette } : {}),
    ...(accent  !== null ? { accent }  : {}),
    ...(accent2 !== null ? { accent2 } : {}),
  }
}

// The presenter's screen tells phones on the deck's answer link which
// activity is on the current slide. Decks without activities never call the
// room server.
const hasActivities = () => roomsIn(slidesContent).length > 0
// What the phones show for the activity on a slide: its component's `phone`
// description, from the tag's attributes and the slide's heading.
function activityOn(deck, slide) {
  const room = roomsOnSlide(slide)[0]
  if (!room) return { room: null, activity: null }
  const tag = findRoomTag(slide.content ?? '', room) ?? Object.values(slide.regions ?? {}).map(region => findRoomTag(region.content ?? '', room)).find(Boolean)
  const element = tag && new DOMParser().parseFromString(tag, 'text/html').body.firstElementChild
  const component = element && registry[element.localName]
  if (typeof component?.phone !== 'function') return { room, activity: null }
  const props = Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value]))
  try { return { room, activity: component.phone(props, { slideTitle: slideTitleFor(deck, room) }) } } catch (error) { console.warn(error); return { room, activity: null } }
}
function announceSlide(deck, index, { initial = false } = {}) {
  if (hasActivities()) announce({ ...activityOn(deck, deck.slides[index]), title: deck.deckConfig?.meta?.title ?? '', initial })
}

// Whether this presenter screen moves the phones along, shown only for decks
// with activities: a failure used to be silent.
const STEERING = {
  'no-code': 'Phones do not follow: this browser has no presenter code. Open the presenter view once with ?livekey=… (the launch page has a link).',
  'wrong-code': "Phones do not follow: the room server does not accept this browser's presenter code.",
  unreachable: 'Phones do not follow: the room server does not answer.',
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
  tag.textContent = JSON.stringify(slides.map(s => s.meta?.notes ?? s.meta?.note ?? ''))
}

// URL for the presenter's own iframe and preview pane (uses postMessage)
function buildChildUrl(design, palette, accent, accent2, slideIndex = null) {
  const url = new URL(window.location.href)
  url.searchParams.delete('v')
  url.searchParams.set('view', 'deck')
  url.searchParams.set('embedded', '1')
  if (design) url.searchParams.set('design', design)
  else url.searchParams.delete('design')
  // Always set these params so an explicit "none" selection overrides the deck's frontmatter
  url.searchParams.set('palette', palette ?? '')
  url.searchParams.set('accent', accent ?? '')
  url.searchParams.set('accent2', accent2 ?? '')
  if (slideIndex != null) url.hash = String(slideIndex + 1)
  return url.toString()
}

// URL for the audience window — view=audience makes it listen on BroadcastChannel
function buildAudienceUrl(design, palette, accent, accent2, slideIndex = null) {
  const url = new URL(window.location.href)
  url.searchParams.delete('embedded')
  url.searchParams.delete('v')
  url.searchParams.set('view', 'audience')
  if (design) url.searchParams.set('design', design)
  else url.searchParams.delete('design')
  url.searchParams.set('palette', palette ?? '')
  url.searchParams.set('accent', accent ?? '')
  url.searchParams.set('accent2', accent2 ?? '')
  if (slideIndex != null) url.hash = String(slideIndex + 1)
  return url.toString()
}

function sendTo(win, command, value) {
  if (!win || win.closed) return
  win.postMessage({ deckControl: { command, value } }, '*')
}

function PresenterView({ deckConfig, slides }) {
  const [index, setIndex] = useState(0)
  const [design, setDesign] = useState(deckConfig.design ?? 'neue')
  const [palette, setPalette] = useState(PALETTE_NAMES.includes(deckConfig.palette) ? deckConfig.palette : '')
  const [accent, setAccent] = useState(deckConfig.accent ?? '')
  const [accent2, setAccent2] = useState(deckConfig.accent2 ?? '')
  const [audienceConnected, setAudienceConnected] = useState(false)
  const [noteSize, setNoteSize] = useState(13)

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [designOpen, setDesignOpen] = useState(false)
  const [themeModalOpen, setThemeModalOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [timerRunning, setTimerRunning] = useState(false)
  const timerRef = useRef(null)

  const iframeRef = useRef(null)
  const previewRef = useRef(null)
  const audienceRef = useRef(null)
  const bcRef = useRef(null)
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

  const themeMeta = THEME_METAS[design]
  const usesAccent2 = themeMeta?.accent2 ?? false
  const appearance = { theme: themeMeta, palette: PALETTES[palette], params: deckConfig.params, accent, accent2 }
  const effectiveAccent  = effectiveToken('--accent', appearance) || '#888888'
  const effectiveAccent2 = effectiveToken('--accent-2', appearance) || '#888888'
  const notes = useMemo(() => slides.map(s => s.meta?.notes ?? s.meta?.note ?? ''), [slides])
  // Preserve current slide when design/palette causes an iframe reload
  const iframeSrc = useMemo(() => buildChildUrl(design, palette, accent, accent2, indexRef.current), [design, palette, accent, accent2])
  // previewSrc only recomputes on design/palette/accent change; slide changes use postMessage
  const previewSrc = useMemo(
    () => buildChildUrl(design, palette, accent, accent2, indexRef.current + 1),
    [design, palette, accent, accent2]
  )

  // BroadcastChannel for audience sync — more reliable than cross-window postMessage
  useEffect(() => {
    bcRef.current = new BroadcastChannel(DECK_CHANNEL)
    bcRef.current.onmessage = ({ data }) => {
      if (data?.audienceReady) bcRef.current?.postMessage({ deckControl: { command: 'setState', value: stateRef.current } })
    }
    return () => bcRef.current?.close()
  }, [])

  // When the presenter iframe navigates: update displayed index, sync audience + preview.
  // Skip audience/preview sync on 'init' (iframe load/reload) — the audience already
  // opened at the correct slide, and previewSrc encodes the right hash on reload.
  useEffect(() => {
    function onMessage({ data, source }) {
      if (source !== iframeRef.current?.contentWindow) return
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
        bcRef.current?.postMessage({ deckControl: { command: 'setState', value: state } })
        sendTo(previewRef.current?.contentWindow, 'goTo', i + 1)
      }
    }
    window.addEventListener('message', onMessage)
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
        (e.key === 'Home' || e.key === 'r' || e.key === 'R')              ? 'reset' : null
      if (!cmd) return
      e.preventDefault()
      sendTo(iframeRef.current?.contentWindow, cmd)
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

  // When design/palette changes, tell the audience to hot-swap its theme without
  // a reload. Phones pick it up with the next announcement.
  useEffect(() => {
    bcRef.current?.postMessage({ deckControl: { command: 'setTheme', design, palette, accent, accent2 } })
  }, [design, palette, accent, accent2])

  // Nav buttons drive the presenter iframe; audience follows via slideIndexChanged
  function navCommand(cmd) {
    sendTo(iframeRef.current?.contentWindow, cmd)
  }

  function openAudienceWindow() {
    const aw = window.open(
      buildAudienceUrl(design, palette, accent, accent2, indexRef.current),
      'deck-audience-view'
    )
    if (!aw) return
    audienceRef.current = aw
    setAudienceConnected(true)
  }

  const note = notes[index] || ''
  const hasNext = index + 1 < slides.length

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', height: '100vh', background: '#111', overflow: 'hidden' }}>
      <iframe
        ref={iframeRef}
        title="Presenter deck"
        src={iframeSrc}
        style={{ width: '100%', height: '100%', border: '0' }}
      />
      <aside style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '16px',
        borderLeft: '1px solid #2a2a2a',
        background: '#111',
        color: '#ccc',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: '13px',
        overflow: 'hidden',
      }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontWeight: 600, color: '#f0f0f0', fontSize: '14px' }}>Speaker View</span>
          <span style={{ color: '#666', fontVariantNumeric: 'tabular-nums' }}>
            {String(index + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}
          </span>
        </div>

        <SteeringNote />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '22px', letterSpacing: '0.05em', color: timerRunning ? '#f0f0f0' : '#555', fontWeight: 300 }}>
            {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button style={S.btn} onClick={() => setTimerRunning(r => !r)}>
              {timerRunning ? '⏸' : '▶'}
            </button>
            <button style={S.btn} onClick={() => { setTimerRunning(false); setElapsed(0) }}>↺</button>
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
                ? marked.parse(note)
                : '<p>No notes — add <code>note:</code> in the slide frontmatter.</p>',
            }}
          />
        </div>

        <div style={{ flexShrink: 0 }}>
          <button
            onClick={() => setDesignOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', padding: '2px 0 6px', cursor: 'pointer', color: '#555', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', width: '100%' }}
          >
            <span style={{ fontSize: '8px', opacity: 0.7 }}>{designOpen ? '▼' : '▶'}</span>
            Theme & Palette
          </button>
          {designOpen && (
            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
              <label style={{ flex: 1 }}>
                <span style={S.label}>Theme</span>
                <button
                  onClick={() => setThemeModalOpen(true)}
                  style={{ ...S.select, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', cursor: 'pointer' }}
                >
                  <span>{design}</span>
                  <span style={{ opacity: 0.35, fontSize: '8px', flexShrink: 0 }}>▤</span>
                </button>
              </label>
              <label style={{ flex: 1 }}>
                <span style={S.label}>Palette</span>
                <div ref={paletteDropRef} style={{ position: 'relative' }}>
                  <button
                    onClick={() => setPaletteOpen(o => !o)}
                    style={{ ...S.select, display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{palette || 'none'}</span>
                    {palette && <PaletteSwatches tokens={PALETTES[palette]?.tokens ?? {}} />}
                    <span style={{ opacity: 0.35, fontSize: '8px', flexShrink: 0 }}>▼</span>
                  </button>
                  {paletteOpen && (
                    <div style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, right: 0, background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: '5px', zIndex: 100, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.6)' }}>
                      <div
                        onClick={() => { setPalette(''); setAccent(''); setPaletteOpen(false) }}
                        style={{ padding: '6px 8px', cursor: 'pointer', fontSize: '13px', color: palette ? '#555' : '#ccc' }}
                      >
                        none
                      </div>
                      {PALETTE_NAMES.map(n => (
                        <div
                          key={n}
                          onClick={() => { setPalette(n); setAccent(''); setPaletteOpen(false) }}
                          style={{ padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', fontSize: '13px', color: palette === n ? '#f0f0f0' : '#aaa', background: palette === n ? '#2a2a2a' : 'transparent' }}
                        >
                          <span>{n}</span>
                          <PaletteSwatches tokens={PALETTES[n]?.tokens ?? {}} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </label>
              <label style={{ flexShrink: 0 }}>
                <span style={S.label}>Accent</span>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center', height: '28px' }}>
                  <input
                    type="color"
                    value={effectiveAccent}
                    onInput={e => setAccent(e.currentTarget.value)}
                    style={{ width: '28px', height: '28px', padding: '2px', border: '1px solid #2e2e2e', borderRadius: '5px', background: '#1e1e1e', cursor: 'pointer', opacity: accent ? 1 : 0.6 }}
                  />
                  {accent && (
                    <button onClick={() => setAccent('')} style={{ ...S.btn, padding: '3px 7px', fontSize: '14px', lineHeight: 1 }}>×</button>
                  )}
                </div>
              </label>
              {usesAccent2 && (
                <label style={{ flexShrink: 0 }}>
                  <span style={S.label}>Accent 2</span>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center', height: '28px' }}>
                    <input
                      type="color"
                      value={effectiveAccent2}
                      onInput={e => setAccent2(e.currentTarget.value)}
                      style={{ width: '28px', height: '28px', padding: '2px', border: '1px solid #2e2e2e', borderRadius: '5px', background: '#1e1e1e', cursor: 'pointer', opacity: accent2 ? 1 : 0.6 }}
                    />
                    {accent2 && (
                      <button onClick={() => setAccent2('')} style={{ ...S.btn, padding: '3px 7px', fontSize: '14px', lineHeight: 1 }}>×</button>
                    )}
                  </div>
                </label>
              )}
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button style={S.btn} onClick={() => navCommand('prev')}>← Prev</button>
            <button style={S.btn} onClick={() => navCommand('next')}>Next →</button>
            <button style={S.btn} onClick={() => navCommand('reset')}>Reset</button>
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
                  onClick={() => { setDesign(n); setAccent2(''); setThemeModalOpen(false) }}
                  style={{ cursor: 'pointer', borderRadius: '8px', overflow: 'hidden', border: `2px solid ${n === design ? '#60a5fa' : '#2a2a2a'}`, background: '#111' }}
                >
                  <div style={{ aspectRatio: '16/9', overflow: 'hidden' }}>
                    <iframe
                      src={buildChildUrl(n, palette, accent, accent2, index)}
                      scrolling="no"
                      style={{ width: '100%', height: '100%', border: 0, pointerEvents: 'none', display: 'block' }}
                    />
                  </div>
                  <div style={{ padding: '8px 10px', fontSize: '14px', fontFamily: 'inherit', color: n === design ? '#f0f0f0' : '#aaa', background: n === design ? '#1c2a3a' : 'transparent' }}>
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
  followDeck?.()
  followDeck = followActiveRooms(document.querySelector('deck-stage'), slides)
  if (!selection) return
  // The stage re-collects its slides asynchronously after structural changes.
  setTimeout(() => {
    const stage = document.querySelector('deck-stage')
    if (stage && stage.index !== selection.index) stage.setState({ index: selection.index, slideId: selection.slideId, step: -1 })
  }, 0)
}

async function init() {
  const parsed = parseSlides(slidesContent)
  const url = new URL(window.location.href)
  const editorMode = url.searchParams.get('editor') === '1'
  // One switch selects the view: deck, share, presenter or audience.
  const defaultView = typeof __MDECK_DEFAULT_VIEW__ !== 'undefined' ? __MDECK_DEFAULT_VIEW__ : 'deck'
  const view = requestedView(url, defaultView)
  const errors = validateDeck(parsed, { templates: manifests }).filter(d => d.severity === 'error')
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
  const { slides } = parsed
  const presenterMode = view === 'presenter'
  const audienceMode  = view === 'audience'
  const embedded = url.searchParams.get('embedded') === '1'
  const shareMode = view === 'share' && !editorMode && !embedded

  injectSpeakerNotes(slides)

  if (presenterMode) {
    actAsPresenter()
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
  }

  // Editor preview: the editor pushes whole sources; render best effort and
  // report back. Bad decks never blank the preview here.
  if (editorMode) {
    const post = message => window.parent.postMessage(message, window.location.origin)
    const bridge = createEditorBridge({
      parse: parseSlides, validate: deck => validateDeck(deck, { templates: manifests }), loadTheme, setExtensionOverrides,
      setCalloutLabels: config => { setCalloutLabels(config); setDeckLanguage(config); document.documentElement.lang = deckLanguage() },
      applyOverrides: withConfigOverrides, mount: context => mountDeck({ ...context, editor: true }), post,
    })
    window.addEventListener('message', event => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return
      if (!bridge.handleMessage(event.data)) handleDeckControl(event.data?.deckControl)
    })
    await bridge.render(slidesContent)
    post({ deckEditorReady: true })
    return
  }

  if (shareMode) {
    document.body.style.margin = '0'
    await loadTheme(deckConfig)
    render(<ShareView deck={parsed} deckConfig={deckConfig} />, document.body)
    return
  }

  await loadTheme(deckConfig)
  mountDeck({ deck: parsed, deckConfig })
  if (!embedded && !audienceMode) {
    // A quiet way into the reader view for anyone who opened the file directly.
    const entry = document.createElement('a')
    entry.className = 'share-entry'
    entry.href = '?view=share'
    entry.textContent = t('deck.overview')
    document.body.appendChild(entry)
  }

  // A full deck or audience window is a presenter's screen; previews are embedded.
  if (!embedded) {
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
    bc.onmessage = ({ data }) => {
      const ctrl = data?.deckControl
      if (!ctrl) return
      if (ctrl.command === 'setTheme') {
        loadTheme({ design: ctrl.design, palette: ctrl.palette, accent: ctrl.accent, accent2: ctrl.accent2 })
      } else {
        handleDeckControl(ctrl)
      }
    }
    document.querySelector('deck-stage')?.addEventListener('slidechange', event => {
      if (event.detail.reason === 'init') bc.postMessage({ audienceReady: true })
    })
    bc.postMessage({ audienceReady: true })
  }
}

init()
