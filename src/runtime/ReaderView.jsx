import { readerLink } from '../core/urls.js'
import { h } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { marked } from 'marked'
import { renderCitations } from './citations.js'
import { deckOutline } from '../core/outline.js'
import { manifests, SlideRenderer, SlideExtraPages } from '../layouts/renderSlide'
import { StageRoom } from './ink/Room.jsx'
import { loadTheme, THEME_METAS } from './themeLoader'
import './reader.css'
import { t, stageLabels } from '../core/labels.js'
import { followActiveRooms } from '../live/follow.js'
import { Icon } from '../components/Icon.jsx'
import { currentInk, onInkChange, showExtras } from './ink/store.js'
import { fitDeck, fitSlide } from './fit.js'
import { languageName } from '../core/languages.js'

// The reader view for decks sent around by email: outline, the slides at a
// comfortable size or stacked for reading, light or dark, the drawings shown
// or hidden, PDF and a way back into the full-screen deck. The theme and palette stay the sender's: a sent
// file carries only those, with their fonts.

const lookKey = deckConfig => `mdeck-reader-look:${deckConfig.meta?.title ?? location.pathname}`

// The reader's choices: light or dark ('' for the deck's own), and whether
// the drawings show.
function restoreLook(deckConfig) {
  let stored = null
  try { stored = JSON.parse(localStorage.getItem(lookKey(deckConfig)) ?? 'null') } catch {}
  return { appearance: ['light', 'dark'].includes(stored?.appearance) ? stored.appearance : '', drawings: stored?.drawings !== false }
}

const hasInk = () => Object.values(currentInk()?.slides ?? {}).some(strokes => strokes?.length) || Object.keys(currentInk()?.pages ?? {}).length > 0

// Every button carries an icon so the bar reads at a glance.
const ReaderIcon = ({ name }) => <Icon name={name} class="reader-icon" />

function pdfLink() {
  return document.querySelector('link[rel="alternate"][type="application/pdf"]')?.getAttribute('href') ?? null
}

function initialIndex(slides) {
  const hash = decodeURIComponent(location.hash.slice(1))
  const byId = slides.findIndex(slide => slide.id === hash)
  if (byId >= 0) return byId
  const n = parseInt(hash, 10)
  return Number.isInteger(n) && n >= 1 && n <= slides.length ? n - 1 : 0
}

// What was written around a slide or on blank pages after it follows it (ink/Room.jsx).
function ReadPage({ slide, index, total, deckConfig, width, height, scale, showNotes }) {
  const notes = slide.meta.notes ?? ''
  return <article class="reader-page" id={`reader-page-${index}`}>
    <div class="reader-page-frame" style={{ aspectRatio: `${width} / ${height}` }}>
      <div class="reader-page-scale" style={{ width: `${width}px`, height: `${height}px`, transform: `scale(${scale})` }}>
        <SlideRenderer id={slide.id} regions={slide.regions} meta={slide.meta} content={slide.content} deckConfig={deckConfig} index={index} total={total} />
      </div>
    </div>
    <SlideExtraPages id={slide.id} regions={slide.regions} meta={slide.meta} content={slide.content} deckConfig={deckConfig} index={index} total={total}
      wrap={(page, key) => <div key={key} class="reader-page-frame reader-page-extra" style={{ aspectRatio: `${width} / ${height}` }}>
        <div class="reader-page-scale" style={{ width: `${width}px`, height: `${height}px`, transform: `scale(${scale})` }}>{page}</div>
      </div>} />
    {showNotes && notes && <div class="reader-page-notes" dangerouslySetInnerHTML={{ __html: marked.parse(renderCitations(notes).markdown) }} />}
  </article>
}

// `languages` are the deck's (none for a deck in one language), `language`
// the one that shows; `onLanguage(code, { index, mode })` asks for another,
// which arrives as a new view starting in `mode` on the address's slide.
export function ReaderView({ deck, deckConfig, mode: startMode = 'slides', languages = [], language = null, onLanguage }) {
  const { slides } = deck
  const width = deckConfig.width ?? 1920, height = deckConfig.height ?? 1080
  const [appearance, setAppearance] = useState(() => restoreLook(deckConfig).appearance)
  // Drawings come with the file; a reader may hide them, also for printing.
  const [drawings, setDrawings] = useState(() => restoreLook(deckConfig).drawings)
  const [inked, setInked] = useState(hasInk)
  const [mode, setMode] = useState(startMode)
  const [index, setIndex] = useState(() => initialIndex(slides))
  const [navOpen, setNavOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [readScale, setReadScale] = useState(0.5)
  const stageRef = useRef(null)
  const readRef = useRef(null)
  const outline = useMemo(() => deckOutline(deck, manifests, { slideName: n => t('reader.slide', { n }) }), [deck])
  const ownAppearance = deckConfig.appearance ?? THEME_METAS[deckConfig.theme ?? 'neue']?.appearance ?? 'light'
  const shown = appearance || ownAppearance
  const toggleAllowed = deckConfig.reader?.themes !== false
  const pdf = useMemo(pdfLink, [])
  // Notes stay private unless the deck opts in; a file may carry them for the presenter.
  const showNotes = deckConfig.reader?.notes === true && slides.some(slide => slide.meta.notes)

  useEffect(() => {
    loadTheme({ ...deckConfig, appearance: shown }).catch(error => console.warn(error.message))
  }, [appearance])
  useEffect(() => {
    try { localStorage.setItem(lookKey(deckConfig), JSON.stringify({ appearance, drawings })) } catch {}
  }, [appearance, drawings])
  useEffect(() => onInkChange(() => setInked(hasInk())), [])
  // Without the drawings, no room to write either (ink/Room.jsx).
  useEffect(() => { showExtras(drawings) }, [drawings])
  // Another language of a deck read as pages opens on the page that showed.
  useEffect(() => { if (startMode === 'read') document.getElementById(`reader-page-${index}`)?.scrollIntoView({ block: 'start' }) }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    stage.setLabels(stageLabels())
    const stopFollowing = followActiveRooms(stage, slides)
    // Code taller than its place scrolls here as it does in the deck (fit.js).
    const unfit = fitDeck(stage, { report: false })
    const onChange = event => setIndex(event.detail.index)
    stage.addEventListener('slidechange', onChange)
    return () => { stage.removeEventListener('slidechange', onChange); stopFollowing(); unfit() }
  }, [mode])

  // Read mode shows every slide finished: all steps revealed, as in print,
  // and every page's code fitted to its place.
  useEffect(() => {
    if (mode !== 'read' || !readRef.current) return
    readRef.current.querySelectorAll('[data-step]').forEach(step => step.setAttribute('data-step-visible', ''))
    const fitPages = () => readRef.current?.querySelectorAll('.reader-page-scale > .slide').forEach(slide => fitSlide(slide))
    fitPages()
    document.fonts?.ready.then(fitPages)
  }, [mode])

  useEffect(() => {
    if (mode !== 'read' || !readRef.current) return
    const measure = () => { const page = readRef.current?.querySelector('.reader-page'); if (page) setReadScale(page.clientWidth / width) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(readRef.current)
    return () => observer.disconnect()
  }, [mode, width])

  useEffect(() => {
    if (mode !== 'read') return
    const container = readRef.current
    if (!container) return
    const pages = [...container.querySelectorAll('.reader-page')]
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (visible) setIndex(pages.indexOf(visible.target))
    }, { root: container, threshold: [0.5] })
    pages.forEach(page => observer.observe(page))
    return () => observer.disconnect()
  }, [mode, readScale])

  const goTo = target => {
    const i = Math.max(0, Math.min(slides.length - 1, target))
    setIndex(i)
    setNavOpen(false)
    if (mode === 'slides') stageRef.current?.goTo(i)
    else document.getElementById(`reader-page-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    history.replaceState(null, '', `#${encodeURIComponent(slides[i]?.id ?? String(i + 1))}`)
  }

  const switchMode = next => {
    setMode(next)
    if (next === 'read') setTimeout(() => document.getElementById(`reader-page-${index}`)?.scrollIntoView({ block: 'start' }), 50)
  }

  const copyLink = async () => {
    const url = readerLink(location.href, slides[index]?.id ?? String(index + 1))
    try { await navigator.clipboard.writeText(url.toString()); setToast(t('reader.linkCopied')) } catch { setToast(url.toString()) }
    setTimeout(() => setToast(''), 1800)
  }

  const savePdf = () => {
    if (mode !== 'slides') switchMode('slides')
    setTimeout(() => window.print(), 150)
  }

  const meta = deckConfig.meta ?? {}
  const metaLine = [meta.author, meta.organization, meta.date].filter(Boolean).join(' · ')
  const other = shown === 'dark' ? 'light' : 'dark'

  return <div class={`reader-view${drawings ? '' : ' is-ink-hidden'}`}>
    <header class="reader-top">
      <button class="reader-btn reader-nav-toggle" onClick={() => setNavOpen(open => !open)} aria-label={t('reader.outline')}><ReaderIcon name="menu" /></button>
      <h1>{meta.title ?? t('reader.untitled')}</h1>
      {metaLine && <span class="reader-meta">{metaLine}</span>}
      <span class="reader-spacer" />
      <span class="reader-count">{index + 1} / {slides.length}</span>
      <button class={`reader-btn${mode === 'slides' ? ' is-active' : ''}`} onClick={() => switchMode('slides')}><ReaderIcon name="slides" /><span class="label-text">{t('reader.slides')}</span></button>
      <button class={`reader-btn${mode === 'read' ? ' is-active' : ''}`} onClick={() => switchMode('read')}><ReaderIcon name="read" /><span class="label-text">{t('reader.read')}</span></button>
      {languages.length > 1 && <select class="reader-btn reader-language" aria-label={t('reader.language')} title={t('reader.language')} value={language} onChange={event => onLanguage?.(event.currentTarget.value, { index, mode })}>
        {languages.map(code => <option key={code} value={code} lang={code}>{languageName(code)}</option>)}
      </select>}
      {toggleAllowed && <button class="reader-btn" onClick={() => setAppearance(other === ownAppearance ? '' : other)} title={t('reader.appearance')}><ReaderIcon name={other === 'dark' ? 'moon' : 'sun'} /><span class="label-text">{t(other === 'dark' ? 'reader.dark' : 'reader.light')}</span></button>}
      {inked && <button class="reader-btn" onClick={() => setDrawings(on => !on)} aria-pressed={drawings} title={t(drawings ? 'reader.hideDrawings' : 'reader.showDrawings')}><ReaderIcon name={drawings ? 'eye' : 'eye-off'} /><span class="label-text">{t('reader.drawings')}</span></button>}
      {pdf
        ? <a class="reader-btn" href={pdf} download={`${(meta.title ?? 'slides').replace(/[^\w.-]+/g, '-')}.pdf`}><ReaderIcon name="download" /><span class="label-text">{t('reader.downloadPdf')}</span></a>
        : <button class="reader-btn" onClick={savePdf} title={t('reader.savePdfHint')}><ReaderIcon name="download" /><span class="label-text">{t('reader.savePdf')}</span></button>}
      <a class="reader-btn" href={`?view=deck${languages.length > 1 && language ? `&lang=${encodeURIComponent(language)}` : ''}#${encodeURIComponent(slides[index]?.id ?? String(index + 1))}`}><ReaderIcon name="present" /><span class="label-text">{t('reader.present')}</span></a>
    </header>
    <div class="reader-main">
      <nav class={`reader-nav${navOpen ? ' is-open' : ''}`} aria-label={t('reader.slides')}>
        <ol>
          {outline.map(item => <li key={item.index} class={`${item.index === index ? 'is-current' : ''}${item.chapter ? ' is-chapter' : ''}`} onClick={() => goTo(item.index)}>
            <span class="reader-num">{String(item.index + 1).padStart(2, '0')}</span>
            <span class="reader-title">{item.chapter && item.part && <span class="reader-part">{item.part}</span>}{item.title}</span>
          </li>)}
        </ol>
      </nav>
      <section class="reader-content">
        {mode === 'slides'
          ? <>
            <div class="reader-stage-wrap">
              <deck-stage ref={stageRef} width={width} height={height}>
                <StageRoom key="#room" />
                {slides.map((slide, i) => [<SlideRenderer key={slide.id} id={slide.id} regions={slide.regions} meta={slide.meta} content={slide.content} deckConfig={deckConfig} index={i} total={slides.length} />,
                  <SlideExtraPages key={`${slide.id}#extra`} id={slide.id} regions={slide.regions} meta={slide.meta} content={slide.content} deckConfig={deckConfig} index={i} total={slides.length} />])}
              </deck-stage>
            </div>
            <div class="reader-bottom">
              <button class="reader-btn" onClick={() => stageRef.current?.prev('click')}><ReaderIcon name="prev" />{t('reader.previous')}</button>
              <button class="reader-btn" onClick={() => stageRef.current?.next('click')}>{t('reader.next')}<ReaderIcon name="next" /></button>
              <span class="reader-spacer" />
              <button class="reader-btn" onClick={copyLink}><ReaderIcon name="link" />{t('reader.copyLink')}</button>
            </div>
          </>
          : <div class="reader-read" ref={readRef} data-deck-static>
            {slides.map((slide, i) => <ReadPage key={slide.id} slide={slide} index={i} total={slides.length} deckConfig={deckConfig} width={width} height={height} scale={readScale} showNotes={showNotes} />)}
          </div>}
      </section>
    </div>
    {toast && <div class="reader-toast">{toast}</div>}
  </div>
}
