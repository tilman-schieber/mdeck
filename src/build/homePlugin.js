// Launch page API for `mdeck run`: what the deck contains, what `mdeck check`
// says about it, the state of its server, the answers kept in the talk (to
// save as CSV or JSON), and buttons that start the editor and the guides or
// run a build. Like the editor API it answers loopback
// requests from its own pages only, even when the server is shared on the
// network for phones.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { loadRegistry } from '../extensions/discover.js'
import { parseSlides } from '../core/parseSlides.js'
import { checkDeck } from './check.js'
import { sessionCode } from '../live/code.js'
import { roomsIn } from '../live/roomTag.js'
import { isAllowedRequest, send, readJson } from './editorPlugin.js'
import { findChrome } from './chrome.js'
import { frameworkRoot } from '../paths.js'
import { resultsFileFor, normalizeResults } from '../core/results.js'
import { resultsReport, reportAnswersCsv, reportSummaryCsv, reportJson } from '../core/resultsReport.js'
import { expandedSource } from './include.js'
import { reactionsOf } from '../core/reactions.js'
import { slideTitle } from '../core/outline.js'
import { languageOfFile } from '../core/languages.js'
import { deckLanguages } from './slidesPlugin.js'
import { createResultsFile } from './resultsPlugin.js'
import { createInkFile } from './inkPlugin.js'

// Each output is one ordinary CLI run beside the deck, so the launch page
// builds exactly what the command line would.
export function outputsFor(slidesPath) {
  const abs = resolve(slidesPath), dir = dirname(abs), name = basename(abs).replace(/\.md$/i, '')
  return {
    folder: { title: 'Folder to host', args: ['build', abs, '--reader'], file: resolve(dir, 'dist/index.html') },
    send: { title: 'One file to send', args: ['send', abs, '-o', `${name}.html`], file: resolve(dir, `${name}.html`), chrome: true },
    pdf: { title: 'PDF', args: ['pdf', abs, '-o', `${name}.pdf`], file: resolve(dir, `${name}.pdf`), chrome: true },
  }
}

export function runCli(args, cwd) {
  return new Promise(done => {
    const child = spawn(process.execPath, [resolve(frameworkRoot, 'bin/mdeck.js'), ...args], { cwd, env: { ...process.env, FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    child.on('error', error => done({ code: 1, output: error.message }))
    child.on('close', code => done({ code, output: output.replace(/\x1b\[[0-9;]*m/g, '').trim() }))
  })
}

function reveal(file) {
  const [command, args] = process.platform === 'darwin' ? ['open', ['-R', file]]
    : process.platform === 'win32' ? ['explorer', [`/select,${file}`]]
    : ['xdg-open', [dirname(file)]]
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}

// The server named in the `server` setting: whether it answers, whether it
// accepts the key (MDECK_SERVER_KEY, as given to the server), and which mdeck
// it runs (servers before 3.12 do not say).
const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version
// Whether mdeck `a` is older than `b`, by major and minor: a server that
// lacks a feature of this mdeck (reactions came with 3.12) is older.
export function olderVersion(a, b) {
  const [am, an] = String(a).split('.').map(Number), [bm, bn] = String(b).split('.').map(Number)
  return am < bm || (am === bm && an < bn)
}
// A reachable server that runs an older mdeck than this computer, or does not say.
const withVersion = status => status.reachable ? { ...status, version: VERSION, serverOutdated: !status.serverVersion || olderVersion(status.serverVersion, VERSION) } : status

export async function liveStatus(live, { key = null, fetch: get = fetch, timeoutMs = 2500 } = {}) {
  const started = Date.now()
  try {
    const response = await get(`${live.server.replace(/\/+$/, '')}/info`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return { reachable: false, error: `It answered with status ${response.status}` }
    const body = await response.json()
    return { reachable: true, ms: Date.now() - started, keyAccepted: key ? !!body.canReset : null, serverVersion: typeof body.version === 'string' ? body.version : null }
  } catch (error) {
    return { reachable: false, error: error.name === 'TimeoutError' ? `No answer within ${timeoutMs / 1000} s` : error.cause?.code ?? error.message }
  }
}

// `urls()` returns the server's addresses; `services` start the editor and the
// guides; `fetch` reaches the server. All are injected so tests can run
// without a browser or network. `resultsFile` and `inkFile` are the ones the
// running server writes (resultsPlugin, inkPlugin), so that answers and
// drawings dropped here are not written back from memory; `positionFile`,
// the slide the talk was on, is the stage room's (src/live/server.js).
export function homeMiddleware(slidesPath, { urls = () => ({ local: [], network: [] }), services = {}, pairing = null, relay = null, server: serverAddress = null, run = runCli, open = reveal, serverKey = process.env.MDECK_SERVER_KEY || null, fetch: get = fetch, resultsFile = null, inkFile = null, positionFile = null } = {}) {
  const abs = resolve(slidesPath)
  const outputs = outputsFor(abs)
  const jobs = {}
  const started = {}, serviceUrls = {}
  const kept = () => resultsFile ??= createResultsFile(abs)
  const ink = () => inkFile ??= createInkFile(abs)

  async function info(request) {
    const source = readFileSync(abs, 'utf8')
    let registry = null, registryError = null
    try { registry = loadRegistry(abs) } catch (error) { registryError = error.message }
    const { deck, diagnostics } = registry ? checkDeck(abs, registry, source) : { deck: parseSlides(source), diagnostics: [] }
    const config = deck.deckConfig ?? {}
    const { local: serverLocal = [], network = [] } = urls() ?? {}
    // The address this page was opened with, such as a local proxy's name.
    const local = request?.headers?.host ? [`http://${request.headers.host}/`, ...serverLocal] : serverLocal
    return {
      file: abs,
      name: basename(abs),
      modified: statSync(abs).mtime.toISOString(),
      title: config.meta?.title ?? basename(abs).replace(/\.md$/i, ''),
      author: config.meta?.author ?? null,
      slides: deck.slides.length,
      width: config.width ?? 1920,
      height: config.height ?? 1080,
      notes: deck.slides.filter(slide => slide.meta.notes).length,
      theme: config.theme ?? 'neue',
      palette: config.palette ?? null,
      // The same deck in other languages (talk.en.md beside talk.de.md).
      languages: deckLanguages(abs).map(({ lang, file }) => ({ lang, file: basename(file), current: file === abs })),
      diagnostics: [...(registry?.warnings ?? []).map(message => ({ severity: 'warning', code: 'extension', message })), ...(registryError ? [{ severity: 'error', code: 'extension', message: registryError }] : []), ...diagnostics],
      // Polls in included slides count too: the deck as shown.
      live: await live(config, deck.source ?? source, { local, network }),
      presence: presenceUrl(config),
      // Presenting from an iPad needs an address it can reach (`--host`).
      pairing: pairing ? { available: !!relay || !!network[0], devices: pairing.devices } : null,
      relay: relay ? { url: relay.url, state: relay.state, reason: relay.reason } : null,
      chrome: !!findChrome(),
      results: answers()?.map(({ answers: _, ...question }) => question) ?? null,
      drawings: drawings(),
      resume: resume(),
      services: Object.fromEntries(Object.keys(services).map(key => [key, serviceUrls[key] ?? null])),
      outputs: Object.fromEntries(Object.entries(outputs).map(([key, output]) => [key, {
        title: output.title,
        file: output.file,
        exists: existsSync(output.file),
        needsChrome: !!output.chrome,
        ...(jobs[key] ?? { status: 'idle' }),
      }])),
    }
  }

  // Where the launch page asks who is connected: the deck's stage room, on
  // the deck's own server, or here when this server passes the rooms on
  // (with MDECK_SERVER_KEY) or keeps them itself. Relative to the page.
  function presenceUrl(config) {
    const address = serverAddress ?? config.server
    const room = `rooms/${encodeURIComponent(`${sessionCode(config)}.stage`)}/presence`
    return typeof address === 'string' && !serverKey ? `${address.replace(/\/+$/, '')}/${room}` : `__mdeck/live/${room}`
  }

  // Decks with activities or reactions, or with a server of their own, get this
  // section: the server and its health, the join link phones open and,
  // for a server of their own, the presenter code.
  async function live(config, source, { local, network }) {
    const address = serverAddress ?? config.server
    const settings = { server: address }
    const own = typeof address === 'string'
    if (!own && roomsIn(source).length === 0 && !reactionsOf(config)) return null
    const code = sessionCode(config)
    const builtIn = base => new URL(`__mdeck/live/${code}`, base).href
    const joinUrl = own ? `${settings.server.replace(/\/+$/, '')}/${code}` : network[0] ? builtIn(network[0]) : null
    return {
      server: own ? settings.server : null,
      code,
      ...(own ? withVersion(await liveStatus(settings, { key: serverKey, fetch: get })) : { reachable: true }),
      key: own ? serverKey : null,
      joinUrl,
      localJoinUrl: joinUrl ?? (local[0] ? builtIn(local[0]) : null),
    }
  }

  // The answers kept in the talk (<deck>.results.json), read against the
  // deck as shown; null while none are kept.
  function answers() {
    const file = resultsFileFor(abs)
    if (!existsSync(file)) return null
    let results
    try { results = normalizeResults(JSON.parse(readFileSync(file, 'utf8'))) } catch { return null }
    if (!Object.keys(results.rooms).length) return null
    let deck
    try { deck = parseSlides(expandedSource(abs)) } catch { deck = parseSlides(readFileSync(abs, 'utf8')) }
    return resultsReport(results, deck)
  }

  // The slides drawn on (<deck>.drawings.json), in the deck's order, then
  // drawings of slides the deck no longer has; null while there are none.
  function drawings() {
    let slides
    try { slides = ink().read().ink.slides } catch { return null }
    if (!Object.keys(slides).length) return null
    let deck
    try { deck = parseSlides(expandedSource(abs)) } catch { deck = parseSlides(readFileSync(abs, 'utf8')) }
    const shown = deck.slides.flatMap((slide, index) => slides[slide.id] ? [{ id: slide.id, slide: index + 1, title: slideTitle(slide, index, null), strokes: slides[slide.id].length }] : [])
    const known = new Set(shown.map(entry => entry.id))
    const gone = Object.entries(slides).filter(([id]) => !known.has(id)).map(([id, strokes]) => ({ id, slide: null, title: null, strokes: strokes.length }))
    return [...shown, ...gone]
  }

  // The slide the talk was on (<deck>.position.json), which the presenter
  // view offers to go on from, with its number and title; null for the first.
  function resume() {
    const kept = positionFile?.resume()
    if (!kept) return null
    let deck
    try { deck = parseSlides(expandedSource(abs)) } catch { return null }
    return { slide: kept.index + 1, title: slideTitle(deck.slides[kept.index], kept.index, null) }
  }

  // GET /results?format=csv|summary|json: the answers as a file to save.
  function download(request, response) {
    const format = new URL(request.url, 'http://localhost').searchParams.get('format') ?? 'csv'
    const report = answers()
    if (!report) return send(response, 404, { error: 'No answers kept yet' })
    const name = basename(abs).replace(/\.md$/i, '')
    const [text, type, file] = format === 'json'
      ? [reportJson(report, { title: parseSlides(readFileSync(abs, 'utf8')).deckConfig?.meta?.title ?? name }), 'application/json', `${name}-answers.json`]
      : format === 'summary' ? [reportSummaryCsv(report), 'text/csv', `${name}-summary.csv`]
      : [reportAnswersCsv(report), 'text/csv', `${name}-answers.csv`]
    // A byte order mark, so that Excel reads the words as UTF-8.
    const body = type === 'text/csv' ? `\uFEFF${text}` : text
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Content-Disposition': `attachment; filename="${file}"`, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    response.end(body)
  }

  // Each service starts once; a failed start can be retried.
  async function start(key) {
    started[key] ??= services[key]().then(service => { serviceUrls[key] = service.url; return service }, error => { delete started[key]; throw error })
    return (await started[key]).url
  }

  // The one-time address an iPad opens to present from: the presenter view,
  // with a one-time pairing offer; the server's master key stays here.
  // `layout: 'remote'` opens it as the phone clicker instead.
  function pairUrl(layout = 'slide') {
    const network = relay?.url ?? urls()?.network?.[0]
    if (!pairing || !network) throw Object.assign(new Error('Start mdeck run with --network or --server so an iPad can reach it'), { status: 409 })
    const url = new URL(network)
    url.searchParams.set('view', 'presenter')
    url.searchParams.set('layout', layout === 'remote' ? 'remote' : 'slide')
    url.searchParams.set('pair', pairing.offer())
    return url.href
  }

  async function act({ action, output, layout, room, slide } = {}) {
    if (Object.hasOwn(services, action)) return { url: await start(action) }
    if (action === 'pair') return { url: pairUrl(layout) }
    if (action === 'unpair') { pairing?.revoke(); return { ok: true } }
    if (action === 'build') {
      if (!Object.hasOwn(outputs, output)) throw Object.assign(new Error(`Unknown output: ${output}`), { status: 400 })
      if (jobs[output]?.status === 'running') throw Object.assign(new Error('That build is already running'), { status: 409 })
      jobs[output] = { status: 'running', startedAt: new Date().toISOString() }
      const { code, output: log } = await run(outputs[output].args, dirname(abs))
      jobs[output] = { status: code === 0 ? 'done' : 'failed', log, finishedAt: new Date().toISOString() }
      return jobs[output]
    }
    // Dropping kept answers (one question's `room`, or all) and drawings
    // (one `slide`, or all).
    if (action === 'drop-answers') { kept().drop(typeof room === 'string' ? room : null); return { ok: true } }
    if (action === 'drop-position') { positionFile?.drop(); return { ok: true } }
    if (action === 'drop-drawings') { ink().drop(typeof slide === 'string' ? slide : null); return { ok: true } }
    if (action === 'reveal') {
      const target = outputs[output]?.file ?? (output === 'deck' ? abs : null)
      if (!target || !existsSync(target)) throw Object.assign(new Error('Nothing to show yet'), { status: 404 })
      open(target)
      return { ok: true }
    }
    throw Object.assign(new Error(`Unknown action: ${action}`), { status: 400 })
  }

  return async (request, response, next) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (!['/info', '/action', '/results'].includes(pathname)) return next()
    if (!isAllowedRequest(request)) return send(response, 403, { error: 'The launch page only answers on this computer' })
    try {
      if (pathname === '/results' && request.method === 'GET') return download(request, response)
      if (pathname === '/info' && request.method === 'GET') return send(response, 200, await info(request))
      if (pathname === '/action' && request.method === 'POST') return send(response, 200, await act(await readJson(request)))
      response.setHeader('Allow', pathname === '/action' ? 'POST' : 'GET')
      return send(response, 405, { error: 'Method not allowed' })
    } catch (error) {
      return send(response, error.status ?? 500, { error: error.message })
    }
  }
}

export function homePlugin(slidesPath, { services, pairing, relay = null, server: serverAddress = null, resultsFile = null, inkFile = null, positionFile = null } = {}) {
  return {
    name: 'vite-plugin-mdeck-home',
    configureServer(server) {
      // The bare address is the launch page; the slides are at ?view=deck.
      // Only a plain page visit is redirected: every view, preview and editor
      // frame carries a query.
      const base = server.config.base
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' || ![base, `${base}index.html`].includes(request.url) || !/text\/html/.test(request.headers.accept ?? '')) return next()
        response.writeHead(302, { Location: `${base}home.html` })
        response.end()
      })
      server.middlewares.use('/__mdeck/home', homeMiddleware(slidesPath, { urls: () => server.resolvedUrls, services, pairing, relay, server: serverAddress, resultsFile, inkFile, positionFile }))
    },
  }
}
