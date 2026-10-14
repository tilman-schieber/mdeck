import { h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import mark from '../../assets/logo/mark.svg'
import { Icon } from '../components/Icon.jsx'
import { ConnectedViews } from '../components/ConnectedViews.jsx'
import { devicesText } from '../live/presence.js'
import { devPath } from '../core/devPath.js'

// Where the dev server serves from: / normally, /t/<id>/ with `mdeck run --server`.
const BASE = devPath('')

// The launch page `mdeck run` opens: every way to show, edit, share and check
// the deck from one place. Data and actions come from /__mdeck/home.

async function api(path, body) {
  const response = await fetch(devPath('__mdeck/home') + path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
  return data
}

const HomeIcon = ({ name, size = 18 }) => <Icon name={name} size={size} class="home-icon" />

function ago(iso) {
  if (!iso) return ''
  const seconds = Math.round((Date.now() - new Date(iso)) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(iso).toLocaleDateString()
}

// Who is connected, asked of the deck's room server every few seconds; null
// until it answers. Asking holds no connection: browsers allow six per
// server, which the open deck windows need.
const PRESENCE_MS = 3000
function usePresence(url) {
  const [presence, setPresence] = useState(null)
  useEffect(() => {
    if (!url) return
    const ask = () => fetch(new URL(url, new URL(BASE, location.href)), { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null).catch(() => null).then(setPresence)
    ask()
    const timer = setInterval(ask, PRESENCE_MS)
    return () => clearInterval(timer)
  }, [url])
  return presence
}

function ViewTile({ icon, title, text, href, open }) {
  return <a class="home-tile" href={href} target="_blank" rel="noopener">
    <span class="home-tile-icon"><HomeIcon name={icon} size={22} /></span>
    <span class="home-tile-body"><strong>{title}{open && <span class="home-open">Open on {open}</span>}</strong><span>{text}</span></span>
    <HomeIcon name="external" size={16} />
  </a>
}

// Opens the tab during the click so pop-up blockers allow it, then points it
// at the service (and `page` within it) once the server has started.
async function openService(action, page = '') {
  const tab = window.open('about:blank', '_blank')
  try {
    const { url } = await api('/action', { action })
    const target = new URL(page, url)
    // The editors link back here.
    if (action === 'editor') target.searchParams.set('home', location.href.split('#')[0])
    if (tab) tab.location = target.href
    else window.open(target.href, '_blank')
  } catch (error) {
    tab?.close()
    throw error
  }
}

// `page` opens another page of the same service, such as the editor's
// design page.
function ServiceTile({ icon, title, text, action, page = '', url, onError, onStarted }) {
  const [starting, setStarting] = useState(false)
  const launch = async () => {
    setStarting(true)
    try { await openService(action, page); onStarted() } catch (error) { onError(error.message) } finally { setStarting(false) }
  }
  const shown = url && new URL(page, url).href
  return <button class="home-tile" onClick={launch} disabled={starting}>
    <span class="home-tile-icon"><HomeIcon name={icon} size={22} /></span>
    <span class="home-tile-body"><strong>{title}</strong><span>{starting ? 'Starting…' : shown ? shown.replace(/^https?:\/\//, '') : text}</span></span>
    <HomeIcon name="external" size={16} />
  </button>
}

// A small live copy of the deck. The embedded deck hides its controls, takes
// next/previous commands from this page and reports its slide back; a click
// opens an audience window at that slide.
function Preview({ info }) {
  const frame = useRef(null)
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const follow = event => {
      if (event.source === frame.current?.contentWindow && Number.isInteger(event.data?.slideIndexChanged)) setIndex(event.data.slideIndexChanged)
    }
    window.addEventListener('message', follow)
    return () => window.removeEventListener('message', follow)
  }, [])
  const control = command => frame.current?.contentWindow?.postMessage({ deckControl: { command } }, window.location.origin)
  const audienceUrl = `${BASE}?view=audience&session=${SESSION}#${index + 1}`
  return <section class="home-section">
    <h2>Preview</h2>
    <div class="home-preview" style={{ aspectRatio: `${info.width} / ${info.height}` }}>
      <iframe ref={frame} src={`${BASE}?view=deck&embedded=1`} title="Deck preview" tabIndex={-1} />
      <a class="home-preview-open" href={audienceUrl} target="_blank" rel="noopener" aria-label="Open the audience window" />
    </div>
    <div class="home-preview-bar">
      <button class="home-btn home-btn--small" onClick={() => control('prev')} aria-label="Previous"><HomeIcon name="prev" size={14} /></button>
      <button class="home-btn home-btn--small" onClick={() => control('next')} aria-label="Next"><HomeIcon name="next" size={14} /></button>
      <span class="home-preview-count">{index + 1} / {info.slides}</span>
    </div>
  </section>
}

const OUTPUT_TEXT = {
  folder: { icon: 'folder', text: 'dist/ with the page, pictures and videos, for a web server or a USB stick.' },
  send: { icon: 'file-code', text: 'A single HTML file without speaker notes that opens in the reader, with the PDF inside.' },
  pdf: { icon: 'file-text', text: 'One page per slide, with interactive slides shown finished.' },
}

function OutputRow({ id, output, chrome, onChange, onError }) {
  const running = output.status === 'running'
  const build = async () => {
    onChange(id, { ...output, status: 'running' })
    try { onChange(id, { ...output, ...(await api('/action', { action: 'build', output: id })), exists: true }) }
    catch (error) { onError(error.message); onChange(id, { ...output, status: 'failed' }) }
  }
  const reveal = () => api('/action', { action: 'reveal', output: id }).catch(error => onError(error.message))
  const blocked = output.needsChrome && !chrome
  const status = running ? 'Building…'
    : output.status === 'failed' ? 'Failed'
    : output.status === 'done' ? `Built ${ago(output.finishedAt)}`
    : output.exists ? 'Built earlier' : 'Not built yet'
  return <li class="home-output">
    <span class="home-tile-icon"><HomeIcon name={OUTPUT_TEXT[id].icon} size={20} /></span>
    <div class="home-output-body">
      <strong>{output.title}</strong>
      <span>{OUTPUT_TEXT[id].text}</span>
      <code title={output.file}>{output.file}</code>
      {output.status === 'failed' && output.log && <details><summary>What went wrong</summary><pre>{output.log}</pre></details>}
      {blocked && <span class="home-note">Needs Chrome or Chromium. Set MDECK_CHROME to its path if it is installed somewhere unusual.</span>}
    </div>
    <div class="home-output-actions">
      <span class={`home-status home-status--${running ? 'running' : output.status === 'failed' ? 'failed' : output.exists ? 'done' : 'idle'}`}>{status}</span>
      <button class="home-btn home-btn--primary" onClick={build} disabled={running || blocked}>{output.exists ? 'Build again' : 'Build'}</button>
      <button class="home-btn" onClick={reveal} disabled={!output.exists || running} title="Show in your file manager"><HomeIcon name="folder-open" size={15} />Show</button>
    </div>
  </li>
}

function Diagnostics({ diagnostics, name }) {
  if (!diagnostics.length) return <p class="home-ok"><HomeIcon name="check" /> No problems found in {name}.</p>
  return <ul class="home-diagnostics">
    {diagnostics.map((d, i) => <li key={i} class={`home-diagnostic home-diagnostic--${d.severity}`}>
      <span class="home-badge">{d.severity}</span>
      <span>{d.message}</span>
      {d.line > 1 && <span class="home-line">line {d.line}</span>}
    </li>)}
  </ul>
}


// One session pairs the presenter view with the audience window, so both
// links on this page drive each other.
const SESSION = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)

// Drops kept answers or drawings, without asking.
async function drop(body, onDone, onError) {
  try { await api('/action', body); onDone() } catch (error) { onError(error.message) }
}

const DropButton = ({ label, onClick }) => <button class="home-btn home-btn--small" onClick={onClick} title={label} aria-label={label}><HomeIcon name="trash" size={13} />Drop</button>

// The answers kept in the talk: each question with how it came out, and
// the files to save them as (the same as `mdeck results`).
function Answers({ results, file, onRefresh, onError }) {
  const href = format => `${devPath('__mdeck/home/results')}?format=${format}`
  return <section class="home-section home-section--wide home-answers">
    <div class="home-section-head">
      <h2>Answers from the talk</h2>
      <div class="home-head-actions">
        <button class="home-btn home-btn--small" onClick={onRefresh}>Refresh</button>
        <button class="home-btn home-btn--small" onClick={() => drop({ action: 'drop-answers' }, onRefresh, onError)}><HomeIcon name="trash" size={13} />Drop all</button>
      </div>
    </div>
    <ul class="home-outputs">
      {results.map(question => {
        const { counts = [], voted, phones, average } = question.summary
        const top = counts.slice(0, 3).map(row => `${row.answer} ${row.count}`).join(' · ')
        return <li class="home-output" key={question.room}>
          <div class="home-output-body">
            <strong>{question.slide ? `Slide ${question.slide}: ` : ''}{question.question || question.room}</strong>
            <span>{phones === 1 ? '1 phone' : `${phones} phones`}{voted != null && voted !== phones ? `, ${voted} counted` : ''}{question.closed ? ', closed' : ''}{average != null ? ` · average ${average}` : ''}{top ? ` · ${top}` : ''}</span>
          </div>
          <DropButton label={`Drop the answers to ${question.question || question.room}`} onClick={() => drop({ action: 'drop-answers', room: question.room }, onRefresh, onError)} />
        </li>
      })}
    </ul>
    <div class="home-answer-files">
      <a class="home-btn home-btn--primary" href={href('csv')} download><HomeIcon name="download" size={15} />Answers (CSV)</a>
      <a class="home-btn" href={href('summary')} download><HomeIcon name="download" size={15} />Summary (CSV)</a>
      <a class="home-btn" href={href('json')} download><HomeIcon name="download" size={15} />Everything (JSON)</a>
    </div>
    <p class="home-hint">Kept in <code>{file}</code> beside the deck while <code>mdeck run</code> runs; phones are numbered per question, never named. A poll that is still open keeps its answers again with the next one that comes in.</p>
  </section>
}

// The drawings kept with the deck, slide by slide; builds, PDFs and files
// sent to readers show them.
function Drawings({ drawings, file, onRefresh, onError }) {
  const strokes = n => n === 1 ? '1 stroke' : `${n} strokes`
  return <section class="home-section home-section--wide home-answers">
    <div class="home-section-head">
      <h2>Drawings</h2>
      <button class="home-btn home-btn--small" onClick={() => drop({ action: 'drop-drawings' }, onRefresh, onError)}><HomeIcon name="trash" size={13} />Drop all</button>
    </div>
    <ul class="home-outputs">
      {drawings.map(entry => <li class="home-output" key={entry.id}>
        <span class="home-tile-icon"><HomeIcon name="pen" size={18} /></span>
        <div class="home-output-body">
          <strong>{entry.slide ? `Slide ${entry.slide}: ${entry.title}` : entry.id}</strong>
          <span>{strokes(entry.strokes)}{entry.slide ? '' : ' · on a slide the deck no longer has'}</span>
        </div>
        <DropButton label={`Drop the drawings on ${entry.slide ? `slide ${entry.slide}` : entry.id}`} onClick={() => drop({ action: 'drop-drawings', slide: entry.id }, onRefresh, onError)} />
      </li>)}
    </ul>
    <p class="home-hint">Kept in <code>{file}</code> beside the deck; builds show them. Dropped drawings clear from the open windows at once.</p>
  </section>
}

// For decks with a `server` setting: the server's health, the viewers' link
// and the key (MDECK_SERVER_KEY) that lets a browser steer phones and reset
// polls.

export function Home() {
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')

  const load = () => api('/info').then(data => { setInfo(data); setLoadError('') }).catch(e => setLoadError(e.message))
  useEffect(() => {
    load()
    const icon = document.querySelector('link[rel=icon]') ?? document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }))
    icon.href = mark
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [])
  useEffect(() => { if (info) document.title = `${info.title} · mdeck` }, [info?.title])
  // The connection to the server comes up a moment after the page; look again until it does.
  const sharing = info?.relay && info.relay.state !== 'up' && info.relay.state !== 'refused'
  useEffect(() => {
    if (!sharing) return
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [sharing])

  const presence = usePresence(info?.presence)

  if (!info) return <main class="home home--empty">
    <img src={mark} alt="" width="48" height="48" />
    <p>{loadError ? `The launch page could not load: ${loadError}` : 'Loading…'}</p>
    {loadError && <p><a href={`${BASE}?view=audience`}>Open the audience window</a></p>}
  </main>

  const errors = info.diagnostics.filter(d => d.severity === 'error').length
  const warnings = info.diagnostics.length - errors
  const setOutput = (id, output) => setInfo(current => ({ ...current, outputs: { ...current.outputs, [id]: output } }))
  // With the server key, every screen opened here may move the phones along.
  const code = info.live?.key ? `&serverkey=${encodeURIComponent(info.live.key)}` : ''
  const openOn = view => { const views = presence?.views.filter(entry => entry.view === view) ?? []; return views.length ? devicesText(views) : null }
  const meta = [`${info.slides} slide${info.slides === 1 ? '' : 's'}`, info.notes ? `${info.notes} with notes` : 'no speaker notes', `theme ${info.theme}${info.palette ? ` · ${info.palette}` : ''}`, `saved ${ago(info.modified)}`]

  return <main class="home">
    <header class="home-header">
      <img class="home-mark" src={mark} alt="mdeck" width="26" height="26" />
      <div class="home-heading">
        <h1>{info.title}</h1>
        <p class="home-meta">{meta.join(' · ')}</p>
        {info.languages?.length > 0 && <p class="home-meta home-languages" title="L in the presenter view switches the language">
          {info.languages.length} languages: {info.languages.map((language, i) => <span key={language.lang}>{i ? ' · ' : ''}<span class={language.current ? 'is-current' : ''} title={language.file}>{language.lang}</span></span>)}
        </p>}
        <p class="home-file"><code>{info.file}</code> <button class="home-link" onClick={() => api('/action', { action: 'reveal', output: 'deck' }).catch(e => setError(e.message))}>Show</button></p>
      </div>
      {/* mdeck run --server: whether the connection to the server is up. */}
      {info.relay && <span class={`home-health home-relay${info.relay.state === 'up' ? '' : info.relay.state === 'refused' ? ' is-bad' : ' is-warn'}`} title={info.relay.reason ?? info.relay.url}>
        <HomeIcon name={info.relay.state === 'up' ? 'check' : 'alert'} />
        {info.relay.state === 'up' ? 'Connected to your server' : info.relay.state === 'refused' ? 'Server refused the connection' : info.relay.state === 'down' ? 'Reconnecting to your server…' : 'Connecting to your server…'}
      </span>}
      <a class={`home-health${errors ? ' is-bad' : warnings ? ' is-warn' : ''}`} href="#check">
        <HomeIcon name={errors || warnings ? 'alert' : 'check'} />
        {errors ? `${errors} error${errors === 1 ? '' : 's'}` : warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : 'All good'}
      </a>
    </header>

    {error && <div class="home-error" role="alert"><span>{error}</span><button class="home-link" onClick={() => setError('')}>Dismiss</button></div>}

    <div class="home-grid">
      <Preview info={info} />

      <section class="home-section">
        <div class="home-section-head">
          <h2>Present</h2>
          <ConnectedViews presence={presence} phones={!!info.live} />
        </div>
        <div class="home-tiles">
          <ViewTile icon="presenter" title="Presenter view" text="Present and draw, with notes, timer and next slide. Pair an iPad or a phone clicker from it." href={`${BASE}?view=presenter&session=${SESSION}${code}`} open={openOn('presenter')} />
          <ViewTile icon="rehearse" title="Rehearse" text="Go through the talk as if giving it: each slide is timed, and the times can be saved into the deck." href={`${BASE}?view=presenter&rehearse=1&session=${SESSION}${code}`} />
          <ViewTile icon="projector" title="Audience window" text="Slides for the projector, without notes. Navigation stays in sync with the presenter." href={`${BASE}?view=audience&session=${SESSION}${code}`} open={openOn('audience')} />
          <ViewTile icon="reader" title="Reader view" text="Outline, reading mode and look picker, as people you send it to see it." href={`${BASE}?view=reader`} />
        </div>
        {/* Where the talk was: the presenter view offers to go on there. */}
        {info.resume && <p class="home-meta home-resume">
          Last time: slide {info.resume.slide}{info.resume.title ? `, ${info.resume.title}` : ''}. The presenter view offers to go on there. <button class="home-link" onClick={() => api('/action', { action: 'drop-position' }).then(load).catch(e => setError(e.message))}>Forget</button>
        </p>}
      </section>

      <section class="home-section home-section--wide">
        <h2>Write and learn</h2>
        <div class="home-tiles">
          <ServiceTile icon="editor" title="Visual editor" text="Forms and a live preview; saves into the file and keeps a backup." action="editor" url={info.services.editor} onError={setError} onStarted={load} />
          <ServiceTile icon="look" title="Theme editor" text="Try and fine-tune themes and palettes on a sample deck; install more." action="editor" page="design.html" url={info.services.editor} onError={setError} onStarted={load} />
          <ServiceTile icon="guides" title="Guides" text="How to write slides, layouts, presenting, sharing and more." action="docs" url={info.services.docs} onError={setError} onStarted={load} />
        </div>
      </section>


      {info.results?.length > 0 && <Answers results={info.results} file={info.name.replace(/\.md$/i, '') + '.results.json'} onRefresh={load} onError={setError} />}
      {info.drawings?.length > 0 && <Drawings drawings={info.drawings} file={info.name.replace(/\.md$/i, '') + '.drawings.json'} onRefresh={load} onError={setError} />}


      <section class="home-section home-section--wide">
        <h2>Share</h2>
        <ul class="home-outputs">
          {Object.entries(info.outputs).map(([id, output]) => <OutputRow key={id} id={id} output={output} chrome={info.chrome} onChange={setOutput} onError={setError} />)}
        </ul>
      </section>

      <section class="home-section home-section--wide" id="check">
        <div class="home-section-head">
          <h2>Check</h2>
          <button class="home-btn home-btn--small" onClick={load}>Check again</button>
        </div>
        <Diagnostics diagnostics={info.diagnostics} name={info.name} />
      </section>
    </div>
  </main>
}
