import { createServer, build, preview } from 'vite'
import { existsSync, copyFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'fs'
import { chmod, rm, mkdir, writeFile } from 'fs/promises'
import { resolve, dirname, basename, relative, isAbsolute } from 'path'
import { tmpdir } from 'os'
import readline from 'readline/promises'
import preact from '@preact/preset-vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { collectLocalAssetRefs, slidesPlugin } from '../build/slidesPlugin.js'
import { formatDiagnostics } from '../core/validateDeck.js'
import { loadRegistry, manifestsOf, serializeRegistry } from '../extensions/discover.js'
import { BACKUP_DIR } from '../build/editorPlugin.js'
import { createEditorServer, createDesignServer } from '../build/editorServer.js'
import { homePlugin } from '../build/homePlugin.js'
import { checkDeck, bibliographyDiagnostics } from '../build/check.js'
import { livePlugin, startLiveServer } from '../live/server.js'
import { inkPlugin } from '../build/inkPlugin.js'
import { resultsPlugin } from '../build/resultsPlugin.js'
import { createPairing, pairingPlugin } from '../build/pairing.js'
import { isAllowedRequest } from '../build/editorPlugin.js'
import { renderPdf, attachPdf, findChrome } from '../build/pdf.js'
import { installSkill, readSkill, TARGETS } from './skill.js'
import { runPackages } from './themes.js'
import { ManifestError, KINDS } from '../extensions/manifest.js'

import { frameworkRoot } from '../paths.js'
import { parseSlides } from '../core/parseSlides.js'
import { stripNotes as stripNotesFrom, stripActivities as stripActivitiesFrom, shareSlides } from '../core/editDeck.js'
import { parseArgs, parseSlideNumbers, validateServerOrigin } from './args.js'
import { assertDrawings } from '../build/drawings.js'
import { resultsFileFor, normalizeResults, resultsCsv } from '../core/results.js'
import { createRelayAccess } from '../build/relayAccess.js'
import { sessionCode } from '../live/code.js'
import { migrateDeck } from './migrate.js'
import { startTunnel, newTunnelId, loopbackUrl } from '../build/tunnelClient.js'
import { baseConfig } from '../build/config.js'

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const tty = process.stdout.isTTY
const c = tty
  ? { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m' }
  : Object.fromEntries(['reset','bold','dim','green','cyan','yellow','red'].map(k => [k, '']))

const ok  = msg => console.log(`  ${c.green}✓${c.reset}  ${msg}`)
const err = msg => console.error(`  ${c.red}✗${c.reset}  ${msg}`)
const tip = msg => console.log(`  ${c.dim}${msg}${c.reset}`)

const ASPECT_RATIOS = [
  { label: '16:9 (widescreen)', w: 16, h: 9 },
  { label: '16:10 (widescreen)', w: 16, h: 10 },
  { label: '4:3 (classic)', w: 4, h: 3 },
]



function hasFlag(name, short = null) { return !!(parsed.options[name] ?? parsed.options[short]) }
const positionals = () => parsed.positionals
const outputOption = () => parsed.options['--output'] ?? null
const serverOption = () => parsed.options['--server']
const portOption = () => parsed.options['--port'] ?? null
// --slide 3,5-7 for build, send and pdf: only these slides, numbered as written.
function slideOption(input) {
  const given = parsed.options['--slide']
  if (given == null) return null
  try {
    const slides = parseSlideNumbers(given)
    shareSlides(readFileSync(resolve(input), 'utf-8'), { slides })
    return slides
  } catch (error) { err(error.message); process.exit(1) }
}

// Layouts, themes and palettes all come from one registry: built-ins plus the
// extensions/ folder beside the deck. Manifest problems are reported and stop
// the command instead of being skipped silently.
function registryFor(slidesPath) {
  try {
    const registry = loadRegistry(slidesPath)
    for (const warning of registry.warnings) console.warn(`  ${c.yellow}!${c.reset}  ${warning}`)
    return registry
  } catch (error) {
    if (!(error instanceof ManifestError)) throw error
    err(error.message)
    process.exit(1)
  }
}

function parseSelection(input, max) {
  const picks = [...new Set(
    String(input || '')
      .split(',')
      .map(v => parseInt(v.trim(), 10))
      .filter(n => Number.isInteger(n) && n >= 1 && n <= max)
  )]
  return picks
}


async function runNewWizard() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log()
    console.log(`  ${c.bold}Create a new deck${c.reset}`)
    const rawPath = (await rl.question('  Deck file path (default: slides.md): ')).trim() || 'slides.md'
    const outPath = resolve(process.cwd(), rawPath)
    if (existsSync(outPath)) {
      err(`File already exists: ${outPath}`)
      process.exit(1)
    }

    const registry = registryFor(outPath)
    const THEMES = Object.keys(registry.themes)
    const palettes = Object.keys(registry.palettes)
    const describe = record => `${record.id} — ${record.title}${record.description ? ` (${record.description})` : ''}`
    console.log('\n  Theme:')
    THEMES.forEach((name, i) => console.log(`    ${i + 1}) ${describe(registry.themes[name])}`))
    const tIdx = parseInt((await rl.question('  Pick a theme [1]: ')).trim() || '1', 10)
    const theme = THEMES[tIdx - 1] || THEMES[0]

    console.log('\n  Palette:')
    console.log('    0) none')
    palettes.forEach((name, i) => console.log(`    ${i + 1}) ${describe(registry.palettes[name])}`))
    const pRaw = (await rl.question('  Pick a palette [0]: ')).trim() || '0'
    const pIdx = parseInt(pRaw, 10)
    const palette = pIdx > 0 ? (palettes[pIdx - 1] || '') : ''

    const LAYOUT_LIBRARY = Object.values(manifestsOf(registry, 'layout')).map(manifest => ({ key: manifest.id, label: manifest.title, starter: manifest.starter }))
    console.log('\n  Slide layouts (comma-separated numbers):')
    LAYOUT_LIBRARY.forEach((opt, i) => console.log(`    ${i + 1}) ${opt.label}`))
    const defaultLayouts = '1,2,3,4'
    const picks = parseSelection((await rl.question(`  Pick layouts [${defaultLayouts}]: `)).trim() || defaultLayouts, LAYOUT_LIBRARY.length)
    const chosen = (picks.length ? picks : parseSelection(defaultLayouts, LAYOUT_LIBRARY.length))
      .map(i => LAYOUT_LIBRARY[i - 1])

    const title = (await rl.question('  Presentation title [My Talk]: ')).trim() || 'My Talk'
    const author = (await rl.question('  Author [Your Name]: ')).trim() || 'Your Name'
    const org = (await rl.question('  Organization [FHNW]: ')).trim() || 'FHNW'

    console.log('\n  Aspect ratio (uses 1920px width baseline):')
    ASPECT_RATIOS.forEach((opt, i) => console.log(`    ${i + 1}) ${opt.label}`))
    console.log(`    ${ASPECT_RATIOS.length + 1}) Custom`)
    const rIdx = parseInt((await rl.question('  Pick an aspect ratio [1]: ')).trim() || '1', 10)
    let width = 1920
    let ratioW = ASPECT_RATIOS[0].w
    let ratioH = ASPECT_RATIOS[0].h
    if (rIdx >= 1 && rIdx <= ASPECT_RATIOS.length) {
      ratioW = ASPECT_RATIOS[rIdx - 1].w
      ratioH = ASPECT_RATIOS[rIdx - 1].h
    } else if (rIdx === ASPECT_RATIOS.length + 1) {
      const rawW = parseInt((await rl.question('  Ratio width [16]: ')).trim() || '16', 10)
      const rawH = parseInt((await rl.question('  Ratio height [9]: ')).trim() || '9', 10)
      ratioW = Number.isInteger(rawW) && rawW > 0 ? rawW : ratioW
      ratioH = Number.isInteger(rawH) && rawH > 0 ? rawH : ratioH
    }
    const height = Math.round((width * ratioH) / ratioW)

    const lines = [
      '---',
      `theme: ${theme}`,
      ...(palette ? [`palette: ${palette}`] : []),
      'meta:',
      `  title: "${title.replace(/"/g, '\\"')}"`,
      `  author: "${author.replace(/"/g, '\\"')}"`,
      `  organization: "${org.replace(/"/g, '\\"')}"`,
      `  date: "${new Date().toISOString().slice(0, 10)}"`,
      '  logo: ./img/logo.png',
      `width: ${width}`,
      `height: ${height}`,
      '---',
      '',
    ]

    chosen.forEach((opt, i) => {
      lines.push('---\n' + opt.starter)
      lines.push('')
    })

    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, lines.join('\n'), 'utf-8')

    const assetDir = resolve(dirname(outPath), 'img')
    await mkdir(assetDir, { recursive: true })
    await writeFile(resolve(assetDir, '.gitkeep'), '', 'utf-8')

    console.log()
    ok(`Created ${c.cyan}${outPath}${c.reset}`)
    tip(`Added assets folder: ${assetDir}`)
    tip(`Next: mdeck run ${basename(outPath)}\n`)
  } finally {
    rl.close()
  }
}

async function copyLocalAssets(slidesPath, outDir, { stripNotes = false, stripActivities = false, slides = null } = {}) {
  const absSlides = resolve(slidesPath)
  const deckDir = dirname(absSlides)
  const absOutDir = resolve(outDir)
  const raw = readFileSync(absSlides, 'utf-8')
  let markdown = stripNotes ? stripNotesFrom(raw) : raw
  if (stripActivities || slides) markdown = shareSlides(markdown, { activities: stripActivities, slides }).source

  for (const ref of collectLocalAssetRefs(markdown)) {
    const source = resolve(deckDir, ref)
    const destination = resolve(absOutDir, ref)
    const outputRelativePath = relative(absOutDir, destination)

    // Preserve deck-relative paths, but never let a reference write outside
    // the selected build directory.
    if (outputRelativePath.startsWith('..') || isAbsolute(outputRelativePath)) continue
    if (!existsSync(source)) continue

    await mkdir(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
  }
}

function posixPresenterLauncher(htmlFilename) {
  const page = encodeURIComponent(htmlFilename)
  return [
    '#!/usr/bin/env sh',
    'set -eu',
    '',
    'SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'cd "$SCRIPT_DIR"',
    '',
    'PORT=${1:-8765}',
    'if command -v python3 >/dev/null 2>&1; then',
    '  PYTHON=python3',
    'elif command -v python >/dev/null 2>&1; then',
    '  PYTHON=python',
    'else',
    '  echo "Python 3 is required to start the presenter view." >&2',
    '  exit 1',
    'fi',
    '',
    `URL="http://127.0.0.1:$PORT/${page}?view=presenter"`,
    '"$PYTHON" -m http.server "$PORT" --bind 127.0.0.1 &',
    'SERVER_PID=$!',
    'cleanup() {',
    '  kill "$SERVER_PID" 2>/dev/null || true',
    '}',
    'trap cleanup EXIT INT TERM',
    '',
    'sleep 1',
    'case "$(uname -s)" in',
    '  Darwin) open "$URL" ;;',
    '  Linux)',
    '    if command -v xdg-open >/dev/null 2>&1; then',
    '      xdg-open "$URL"',
    '    else',
    '      echo "Open $URL in a browser."',
    '    fi',
    '    ;;',
    '  *) echo "Open $URL in a browser." ;;',
    'esac',
    '',
    'echo "Presenter server running at $URL"',
    'echo "Press Ctrl+C to stop."',
    'wait "$SERVER_PID"',
    '',
  ].join('\n')
}

function windowsPresenterLauncher(htmlFilename) {
  return [
    '@echo off',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0present.ps1" %*',
    '',
  ].join('\r\n')
}

function powershellPresenterLauncher(htmlFilename) {
  const page = encodeURIComponent(htmlFilename)
  return [
    'param([int]$Port = 8765)',
    '$ErrorActionPreference = "Stop"',
    'Set-Location $PSScriptRoot',
    '',
    '$Py = Get-Command py -ErrorAction SilentlyContinue',
    'if ($Py) {',
    '  $Python = $Py.Source',
    '  $Prefix = @("-3")',
    '} else {',
    '  $Py = Get-Command python -ErrorAction SilentlyContinue',
    '  if (-not $Py) { throw "Python 3 is required to start the presenter view." }',
    '  $Python = $Py.Source',
    '  $Prefix = @()',
    '}',
    '',
    `$Url = "http://127.0.0.1:$Port/${page}?view=presenter"`,
    '$Arguments = $Prefix + @("-m", "http.server", "$Port", "--bind", "127.0.0.1")',
    '$Server = Start-Process -FilePath $Python -ArgumentList $Arguments -PassThru -NoNewWindow',
    'try {',
    '  Start-Sleep -Milliseconds 750',
    '  Start-Process $Url',
    '  Write-Host "Presenter server running at $Url"',
    '  Write-Host "Press Ctrl+C to stop."',
    '  Wait-Process -Id $Server.Id',
    '} finally {',
    '  $Server.Refresh()',
    '  if (-not $Server.HasExited) { Stop-Process -Id $Server.Id -Force }',
    '}',
    '',
  ].join('\n')
}

async function writePresenterLaunchers(outDir, htmlFilename) {
  const shellPath = resolve(outDir, 'present.sh')
  await writeFile(shellPath, posixPresenterLauncher(htmlFilename), 'utf-8')
  await chmod(shellPath, 0o755)
  await writeFile(resolve(outDir, 'present.bat'), windowsPresenterLauncher(htmlFilename), 'utf-8')
  await writeFile(resolve(outDir, 'present.ps1'), powershellPresenterLauncher(htmlFilename), 'utf-8')
}

// ── Help ──────────────────────────────────────────────────────────────────────
const HELP = `
  ${c.bold}mdeck${c.reset} — markdown slide deck

  ${c.dim}Make and present${c.reset}
    ${c.green}mdeck new${c.reset}                                 Make a presentation with guided questions
    ${c.green}mdeck run${c.reset} [slides.md]                     Launch page: present, edit, check and send
      --network              reach the slides from phones and tablets on the same network
      --server [address]     present from an iPad on any network, through your server
                             (the address, or the deck's server setting, or MDECK_SERVER;
                              the key in MDECK_SERVER_KEY)
      --no-open   --port <number>
    ${c.green}mdeck edit${c.reset} [slides.md]                    Edit slides in the browser; saves to the file
    ${c.green}mdeck design${c.reset} [folder | slides.md]         Look at and fine-tune themes and palettes on a sample deck;
                                              saves to the folder's extensions/ (default: this folder)
    ${c.green}mdeck themes${c.reset} search [words]               Themes from mdeck and the theme repository; install <theme>
      install <theme>, remove <theme>       brings its default palette along; for every deck, or add
      update [theme], list                  slides.md or --local for one deck; --force replaces edited files
    ${c.green}mdeck palettes${c.reset} search | install | remove | update | list   The same for palettes

  ${c.dim}Make something to hand out${c.reset}
    ${c.green}mdeck build${c.reset} [slides.md] [-o dir/index.html]   A folder to host
      --reader               reader view, notes removed unless --notes, polls kept as a record unless --no-polls
      --single-file          everything inlined into one file instead
      --launchers            add macOS/Linux and Windows launchers (folders only)
    ${c.green}mdeck send${c.reset} [slides.md] [-o talk.html]     One file to send: the reader view, speaker notes removed,
                                              with a PDF inside
      --notes                keep the speaker notes in the file
      --no-polls             for send, build --reader and pdf: leave out the slides with polls and join codes
      --no-pdf               do not render the PDF inside
      --slide 3,5-7          for build, send and pdf: only these slides (numbered as in the deck,
                             with their drawings; styles from slides left out stay)
    ${c.green}mdeck pdf${c.reset} [slides.md] [-o talk.pdf]       A PDF, one page per slide
      --no-drawings          for build, send and pdf: leave out <slides>.drawings.json
      --no-results           for build, send and pdf: leave out <slides>.results.json (the answers kept in the talk)
    ${c.green}mdeck preview${c.reset} [folder]                    Preview a built folder (default: dist)

  ${c.dim}Check and look things up${c.reset}
    ${c.green}mdeck migrate${c.reset} [slides.md] [--dry-run]   Update settings, local layouts and drawings to API 2.0
    ${c.green}mdeck check${c.reset} [slides.md] [--strict]        Validate source and local assets
      --render               also show every slide in Chrome, all steps revealed: content that
                             does not fit, text cut off or hard to read, errors on the page
    ${c.green}mdeck snapshot${c.reset} [slides.md]                Pictures of slides as PNG files (default: .mdeck-snapshots/)
      --slide <numbers>      only these slides: 3, 3,5 or 2-4
      --sheet                one picture of them all in a grid, each under its number and heading
      --dark | --light       in this appearance instead of the deck's own   -o <folder>
    ${c.green}mdeck results${c.reset} [slides.md] [-o answers.csv]  The answers kept in the talk, as CSV (room, phone, time, answer)
    ${c.green}mdeck list${c.reset} [layouts|themes|palettes] [slides.md] [--json]
                                              List built-in and deck-local layouts, themes and palettes
    ${c.green}mdeck starter${c.reset} <layout> [slides.md]        Print starter Markdown for a layout
    ${c.green}mdeck docs${c.reset} [guide]                        Open the local documentation
      --no-open   --port <number>   --build    Serve without opening, choose port, or build site
    ${c.green}mdeck skill${c.reset} [--print] [--install <assistant>...] [--project]
                                              Slide-writing skill for AI assistants (claude, codex, cursor, copilot, gemini)

  ${c.dim}Serve${c.reset}
    ${c.green}mdeck server${c.reset} [--port 8787] [--host [addr]]   The server for polls and for presenting from an iPad
                                              through it (MDECK_SERVER_KEY); put a web server in front

  Commands that take ${c.bold}slides.md${c.reset} use the one in the current folder when you leave it out.

  ${c.dim}Install the${c.reset} ${c.bold}mdeck${c.reset} ${c.dim}command globally:${c.reset}
    npm link

  ${c.dim}Or run without installing:${c.reset}
    npm start -- slides.md
`

// ── Argument parsing ──────────────────────────────────────────────────────────
const [command, ...argv] = process.argv.slice(2)

if (!command || command === '--help' || command === '-h') {
  console.log(HELP)
  process.exit(0)
}

// Names from before 2.0. They stop with the new name instead of being ignored.
const RENAMED_COMMANDS = { dev: 'mdeck run', present: 'mdeck run', live: 'mdeck server', templates: 'mdeck list layouts', extensions: 'mdeck list' }
const RENAMED_OPTIONS = [
  ['run', '--host', '--network'],
  ['run', '--share', '--server'],
  ['build', '--share', 'mdeck build --reader (a folder) or mdeck send (one file)'],
  ['build', '--self-contained', '--single-file'],
  ['build', '-S', '--single-file'],
  ['build', '--inline-images', '--single-file'],
  ['build', '-I', '--single-file'],
  ['build', '--presenter-launchers', '--launchers'],
  ['build', '--with-notes', 'mdeck send --notes'],
  ['build', '--pdf', 'mdeck pdf'],
  ['build', '--no-pdf', 'mdeck send --no-pdf'],
  ['build', '--no-ink', '--no-drawings'],
  ['pdf', '--no-ink', '--no-drawings'],
  ['send', '--no-ink', '--no-drawings'],
]
for (const [name, was, now] of RENAMED_OPTIONS) {
  if (command === name && argv.some(arg => arg === was || arg.startsWith(was + '='))) { err(`${was} is now ${now}.`); process.exit(1) }
}

if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); process.exit(0) }
let parsed
try {
  parsed = parseArgs(command, argv)
  if (['run', 'server'].includes(command) && Object.hasOwn(process.env, 'MDECK_LIVE_KEY')) throw new Error('MDECK_LIVE_KEY is now MDECK_SERVER_KEY. Rename the environment variable before starting mdeck.')
} catch (error) {
  err(error.message)
  if (Object.hasOwn(RENAMED_COMMANDS, command)) tip(`mdeck ${command} is now ${RENAMED_COMMANDS[command]}.`)
  process.exit(1)
}

// With --server the dev server serves under /t/<id>/, but its own addresses are
// mounted at /__mdeck/…: map the first onto the second before anything else.
function stripRelayBase(base) {
  return {
    name: 'mdeck-relay-base',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url.startsWith(`${base}__mdeck/`)) request.url = `/${request.url.slice(base.length)}`
        next()
      })
    },
  }
}

// The slides file: the first argument that is not an option, or slides.md in
// the current folder.
function requireInput(cmd) {
  const input = positionals()[0] ?? (existsSync('slides.md') ? 'slides.md' : null)
  if (!input) {
    err('No slides file specified.')
    tip(`Usage: mdeck ${cmd} <slides.md>   (or run it in a folder that has a slides.md)`)
    process.exit(1)
  }
  if (!existsSync(input)) {
    err(`File not found: ${input}`)
    process.exit(1)
  }
  return input
}

// ── new ───────────────────────────────────────────────────────────────────────
if (command === 'new') {
  await runNewWizard()

} else if (command === 'docs') {
  try {
    const options = { page: (positionals()[0] ?? 'index').replace(/\.html$/, ''), open: !hasFlag('--no-open'), port: portOption() ?? 4174 }
    const buildOnly = hasFlag('--build')
    const { pageFor } = await import('../../docs/site/pages.js')
    if (!pageFor(options.page)) throw new Error(`No guide named "${options.page}". Try mdeck docs getting-started.`)
    if (buildOnly) {
      const { buildDocs } = await import('../../docs/site/build.js')
      ok(`Documentation built: ${await buildDocs()}`)
    } else {
      tip('Preparing the guides and slide examples…')
      const { startDocs } = await import('../../docs/site/server.js')
      const docs = await startDocs(options)
      ok(`Documentation: ${docs.url}`)
      tip('Press Ctrl+C to close the documentation server.')
      const stop = async () => { await docs.close(); process.exit(0) }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    }
  } catch (error) { err(error.message); process.exitCode = 1 }

} else if (command === 'migrate') {
  try {
    const changes = migrateDeck(requireInput('migrate'), { dryRun: hasFlag('--dry-run') })
    for (const change of changes) ok(`${hasFlag('--dry-run') ? 'Would update' : 'Updated'} ${relative(process.cwd(), change.file)}${change.to ? ` → ${basename(change.to)}` : ''}`)
    if (!changes.length) ok('Already uses API 2.0.')
    else if (hasFlag('--dry-run')) tip('No files changed. Run without --dry-run to apply these changes.')
  } catch (error) { err(error.message); process.exitCode = 1 }

} else if (command === 'results') {
  const input = requireInput('results')
  const file = resultsFileFor(resolve(input))
  if (!existsSync(file)) { err(`No answers kept for ${basename(input)} yet: ${basename(file)} appears beside it once people answer during mdeck run.`); process.exit(1) }
  let csv
  try { csv = resultsCsv(normalizeResults(JSON.parse(readFileSync(file, 'utf8')))) } catch (error) { err(`${basename(file)}: ${error.message}`); process.exit(1) }
  const out = outputOption()
  if (out) { writeFileSync(out, csv); ok(`Saved ${relative(process.cwd(), resolve(out))}`) }
  else process.stdout.write(csv)
} else if (command === 'check') {
  const input = requireInput('check')
  const registry = registryFor(input)
  const { diagnostics } = checkDeck(input, registry)
  diagnostics.push(...await bibliographyDiagnostics(input))
  if (hasFlag('--render') && !diagnostics.some(d => d.severity === 'error')) {
    tip('Building the deck and looking at every slide in Chrome…')
    try {
      const { renderCheck } = await import('../build/renderCheck.js')
      diagnostics.push(...await renderCheck(input))
    } catch (error) { diagnostics.push({ severity: 'error', code: 'render', message: error.message, line: 1 }) }
  }
  if (diagnostics.length) console.log(formatDiagnostics(diagnostics, input))
  const warned = diagnostics.length || registry.warnings.length
  if (diagnostics.some(d => d.severity === 'error') || (warned && hasFlag('--strict'))) process.exitCode = 1
  else ok(`Checked ${input}${warned ? ' (with warnings)' : ''}`)

} else if (command === 'snapshot') {
  const input = requireInput('snapshot')
  try {
    const slides = parseSlideNumbers(parsed.options['--slide'] ?? '')
    const outDir = resolve(outputOption() ?? resolve(dirname(resolve(input)), '.mdeck-snapshots'))
    const appearance = hasFlag('--dark') ? 'dark' : hasFlag('--light') ? 'light' : ''
    const { snapshot } = await import('../build/renderCheck.js')
    for (const file of await snapshot(input, { slides, outDir, appearance, sheet: hasFlag('--sheet') })) console.log(relative(process.cwd(), file))
  } catch (error) { err(error.message); process.exitCode = 1 }

} else if (command === 'list') {
  const KIND_WORDS = { layouts: 'layout', themes: 'theme', palettes: 'palette' }
  const [first, ...others] = positionals()
  const word = Object.hasOwn(KIND_WORDS, first) ? first : null
  if (first && !word && !/\.md$/i.test(first)) { err(`Unknown kind: ${first}`); tip('Use layouts, themes or palettes.'); process.exit(1) }
  const file = (word ? others[0] : first) ?? 'slides.md'
  const registry = registryFor(file)
  if (hasFlag('--json')) {
    console.log(JSON.stringify(word ? manifestsOf(registry, KIND_WORDS[word]) : serializeRegistry(registry, { relativeTo: process.cwd() }), null, 2))
  } else for (const kind of KINDS) {
    if (word && KIND_WORDS[word] !== kind) continue
    console.log(`\n  ${c.bold}${kind}s${c.reset}`)
    for (const record of Object.values(registry[`${kind}s`])) {
      console.log(`    ${c.cyan}${record.id}${c.reset} — ${record.title} ${c.dim}(${record.source})${record.description ? ' ' + record.description : ''}${c.reset}`)
      // What a theme suits, from its guide; --json has the whole guide.
      if (record.manifest?.guide?.suits) console.log(`      ${c.dim}Suits: ${record.manifest.guide.suits.join(' · ')}${c.reset}`)
    }
  }

} else if (command === 'starter') {
  const [name, file = 'slides.md'] = positionals()
  if (!name) { err('Name a layout.'); tip('Usage: mdeck starter <layout> [slides.md]; mdeck list layouts shows the names.'); process.exit(1) }
  const layouts = manifestsOf(registryFor(file), 'layout')
  if (!Object.hasOwn(layouts, name)) { err(`Unknown layout: ${name}`); process.exitCode = 1 }
  else process.stdout.write(layouts[name].starter)

// ── run ───────────────────────────────────────────────────────────────────────
} else if (command === 'run') {
  const input = requireInput(command)
  const abs = resolve(input)
  try { assertDrawings(abs) } catch (error) { err(error.message); process.exit(1) }
  const port = portOption()
  const exposed = hasFlag('--network')
  const pairing = createPairing()

  // --server: the server relays an iPad's requests to this computer
  // (src/build/tunnelClient.js). The dev server then serves under /t/<id>/, the
  // address the iPad uses on the server, and its own addresses follow it. The
  // address is the flag's value, else the deck's server setting, else MDECK_SERVER.
  let relay = null
  const serverFlag = serverOption()
  if (serverFlag !== undefined) {
    const inDeck = parseSlides(readFileSync(abs, 'utf8')).deckConfig?.server
    const address = serverFlag ?? (typeof inDeck === 'string' ? inDeck : null) ?? process.env.MDECK_SERVER ?? null
    const key = process.env.MDECK_SERVER_KEY
    if (!address) { err('--server needs the address of your server.'); tip('Give it as  --server https://…, add  server: https://…  to the deck, or set MDECK_SERVER.'); process.exit(1) }
    try { validateServerOrigin(address) } catch (error) { err(error.message); process.exit(1) }
    if (!key) { err('--server needs the key of the server.'); tip('Start it as  MDECK_SERVER_KEY=<key> mdeck run <slides.md> --server'); process.exit(1) }
    const id = newTunnelId()
    relay = { server: address, key, id, base: `/t/${id}/`, url: `${address.replace(/\/+$/, '')}/t/${id}/`, state: 'connecting', reason: null }
  }
  const upstream = relay?.server ?? (() => {
    const address = parseSlides(readFileSync(abs, 'utf8')).deckConfig.server
    return typeof address === 'string' ? address : null
  })
  const base = baseConfig(abs, { server: relay?.server ?? null, proxyControls: !!process.env.MDECK_SERVER_KEY })
  const mountBase = relay?.base ?? '/'
  // The launch page starts these on first use, inside this process.
  const services = {
    async editor() {
      const editor = await createEditorServer(abs, { port: (port ?? 5173) + 10 })
      await editor.listen()
      return { url: new URL('editor.html', editor.resolvedUrls.local[0]).href }
    },
    async docs() {
      const { startDocs } = await import('../../docs/site/server.js')
      return startDocs({ open: false })
    },
  }
  const server = await createServer({
    ...base,
    // A paired iPad may save ink and steer the rooms, like this computer.
    ...(relay ? { base: relay.base } : {}),
    plugins: [...(relay ? [stripRelayBase(relay.base)] : []), ...base.plugins, homePlugin(abs, { services, pairing, relay, server: relay?.server ?? null }), pairingPlugin(pairing), livePlugin({ pairing, upstream, key: process.env.MDECK_SERVER_KEY, session: () => sessionCode(parseSlides(readFileSync(abs, 'utf8')).deckConfig) }), inkPlugin(abs, { authorize: request => isAllowedRequest(request) || pairing.allows(request) }), resultsPlugin(abs, { authorize: request => isAllowedRequest(request) || pairing.allows(request) })],
    publicDir: dirname(abs),
    server: {
      ...base.server,
      ...(port ? { port, strictPort: true } : {}),
      host: exposed ? true : base.server.host,
      open: hasFlag('--no-open') ? false : `${mountBase}home.html`,
    },
  })
  await server.listen()
  const local = server.resolvedUrls.local[0]
  let tunnel = null
  if (relay) {
    let warned = false
    tunnel = startTunnel({
      // On the loopback address the dev server listens on: `localhost` may
      // resolve to the other one (IPv4 or IPv6), as in containers.
      server: relay.server, key: relay.key, id: relay.id, target: loopbackUrl(local, server.httpServer?.address()), base: relay.base,
      allow: createRelayAccess(server, abs),
      session: () => sessionCode(parseSlides(readFileSync(abs, 'utf8')).deckConfig),
      tokens: () => pairing.tokens(),
      log: message => { if (!message.startsWith('tunnel:')) tip(message) },
      onState(state, reason) {
        const before = relay.state
        relay.state = state
        relay.reason = reason ?? null
        if (state === 'up') { warned = false; ok(`Connected to ${c.cyan}${relay.server}${c.reset}`) }
        else if (state === 'refused') err(`Connecting to the server failed: ${reason}`)
        else if (state === 'down' && !warned) { warned = true; tip(before === 'up' ? 'Lost the connection to the server; reconnecting…' : `Cannot reach ${relay.server}; trying again until it answers.`) }
      },
    })
    pairing.onChange(() => tunnel.push())
    server.watcher.on('change', file => { if (resolve(file) === abs) tunnel.push() })
    const stop = () => { tunnel.stop(); process.exit(0) }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  }
  console.log()
  ok(`Launch page: ${c.cyan}${new URL('home.html', local).href}${c.reset}`)
  tip(`Presenter:   ${new URL('?view=presenter', local).href}`)
  tip(`Audience:    ${new URL('?view=audience', local).href}`)
  // Phones in the room follow the talk (the reader view would show slides ahead).
  if (exposed) for (const url of server.resolvedUrls.network) tip(`Follow:      ${new URL('?view=follow', url).href}`)
  console.log()
  if (relay) tip(`iPad:        choose "Show pairing code" on the launch page; it opens ${relay.url}`)
  ok(`Watching ${c.cyan}${abs}${c.reset}`)
  tip('Edit and save to reload.\n')

// ── server ────────────────────────────────────────────────────────────────────
} else if (command === 'server') {
  const port = portOption() ?? 8787
  const host = parsed.options['--host'] === null ? '0.0.0.0' : parsed.options['--host'] ?? '127.0.0.1'
  const key = process.env.MDECK_SERVER_KEY || null
  try {
    const server = await startLiveServer({ port, host, key })
    ok(`Server: ${c.cyan}${server.url}${c.reset}`)
    tip('Point decks at it with  server: https://your.host  behind a web server that passes WebSocket connections on.')
    tip(key ? 'Presenters reset rooms after opening the deck once with ?serverkey=<MDECK_SERVER_KEY>, and mdeck run --server can present through it.' : 'Set MDECK_SERVER_KEY to let presenters reset rooms and to allow mdeck run --server.')
    tip('Rooms live in memory only. Press Ctrl+C to stop.\n')
    const stop = async () => { await server.close(); process.exit(0) }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  } catch (error) { err(error.message); process.exitCode = 1 }

// ── edit ──────────────────────────────────────────────────────────────────────
} else if (command === 'edit') {
  const input = requireInput('edit')
  const abs = resolve(input)
  registryFor(input)
  const port = portOption()
  const server = await createEditorServer(abs, { port: port ?? 5173, strictPort: !!port, open: !hasFlag('--no-open') })
  await server.listen()
  server.printUrls()
  console.log()
  ok(`Editing ${c.cyan}${abs}${c.reset}`)
  tip(`Changes are saved to the file as you type. Before the first change, a copy goes to ${BACKUP_DIR}/ beside it.\n`)

// ── themes ────────────────────────────────────────────────────────────────────
} else if (command === 'themes' || command === 'palettes') {
  await runPackages({ kind: command.slice(0, -1), positionals: positionals(), flag: name => hasFlag(name), output: outputOption, ui: { ok, err, tip, c } })

// ── design ────────────────────────────────────────────────────────────────────
// The design page: with a deck, beside its editor; with a folder (or nothing),
// on the sample deck alone, saving into that folder's extensions/.
} else if (command === 'design') {
  const input = positionals()[0] ?? '.'
  if (!existsSync(input)) { err(`Not found: ${input}`); process.exit(1) }
  const withDeck = /\.md$/i.test(input) && !statSync(input).isDirectory()
  if (!withDeck && !statSync(input).isDirectory()) { err(`${input} is neither a folder nor a slides file`); process.exit(1) }
  const abs = resolve(input)
  registryFor(withDeck ? abs : resolve(abs, 'design.md'))
  const port = portOption()
  const options = { port: port ?? 5173, strictPort: !!port, open: hasFlag('--no-open') ? false : '/design.html' }
  const server = withDeck ? await createEditorServer(abs, options) : await createDesignServer(abs, options)
  await server.listen()
  console.log(`\n  ${c.green}➜${c.reset}  Design: ${c.cyan}${new URL('design.html', server.resolvedUrls.local[0]).href}${c.reset}\n`)
  ok(withDeck ? `Designing for ${c.cyan}${abs}${c.reset}` : `Designing in ${c.cyan}${abs}${c.reset}, on a sample deck`)
  tip(`Themes and palettes are saved as you type, in ${resolve(withDeck ? dirname(abs) : abs, 'extensions')}/. Decks in ${withDeck ? 'that' : 'this'} folder find them.\n`)

// ── build and send ────────────────────────────────────────────────────────────
} else if (command === 'build' || command === 'send') {
  const input = requireInput(command)
  const sending = command === 'send'
  // build: a folder to host, or one file with --single-file. send: one file for
  // readers, in the reader view, without speaker notes unless asked, with a PDF.
  const selfContained = sending || hasFlag('--single-file')
  const launchers = !sending && hasFlag('--launchers')
  const reader = sending || hasFlag('--reader')
  const stripNotes = reader && !hasFlag('--notes')
  // Polls show as a record of the talk; --no-polls leaves their slides and join codes out.
  const stripActivities = reader && hasFlag('--no-polls')
  const wantPdf = sending && !hasFlag('--no-pdf')
  const slides = slideOption(input)

  if (!hasFlag('--no-drawings')) { try { assertDrawings(input) } catch (error) { err(error.message); process.exit(1) } }
  const given = outputOption()
  const outputPath = given ? resolve(process.cwd(), given) : sending ? resolve(process.cwd(), basename(input).replace(/\.md$/i, '') + '.html') : null

  const tempDir = outputPath ? mkdtempSync(resolve(tmpdir(), 'mdeck-')) : null
  const outDir = tempDir ?? resolve(process.cwd(), 'dist')
  const finalOutDir = outputPath ? dirname(outputPath) : outDir
  const htmlFilename = outputPath ? basename(outputPath) : 'index.html'

  try {
    await build({
      ...baseConfig(input, { selfContained, defaultView: reader ? 'reader' : 'deck' }),
      plugins: [preact(), slidesPlugin(resolve(input), { inlineImages: selfContained, inlineMedia: selfContained, embedFonts: selfContained, stripNotes, stripActivities, slides, ink: !hasFlag('--no-drawings'), results: !hasFlag('--no-results'), deckLook: reader }), viteSingleFile()],
      build: {
        outDir,
        emptyOutDir: !tempDir,
        target: 'esnext',
        assetsInlineLimit: 100 * 1024 * 1024,
      },
    })
  } catch (error) {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
    // The deck's own problems arrive as one error whose text lists them.
    err((error.errors?.[0]?.message ?? error.message).replace(/^\[[^\]]+\]\s*/, '').replace(/^Error: /, ''))
    process.exit(1)
  }

  await mkdir(finalOutDir, { recursive: true })

  if (!selfContained) {
    await copyLocalAssets(input, finalOutDir, { stripNotes, stripActivities, slides })
    if (launchers) await writePresenterLaunchers(finalOutDir, htmlFilename)
  }

  let htmlFile = resolve(outDir, 'index.html')
  if (outputPath && tempDir) {
    copyFileSync(resolve(tempDir, 'index.html'), outputPath)
    await rm(tempDir, { recursive: true })
    htmlFile = outputPath
  }
  if (wantPdf) {
    const pdfDir = mkdtempSync(resolve(tmpdir(), 'mdeck-send-pdf-'))
    const pdfFile = resolve(pdfDir, 'slides.pdf')
    try {
      await renderPdf({ htmlFile, output: pdfFile })
      attachPdf(htmlFile, pdfFile, { embed: true })
      await rm(pdfFile)
      ok(`PDF: ${c.cyan}embedded in ${htmlFile}${c.reset}`)
    } catch (error) {
      console.warn(`  ${c.yellow}!${c.reset}  PDF not rendered: ${error.message}`)
      tip('The reader view will offer the browser\'s "Save as PDF" dialog instead.')
    } finally { await rm(pdfDir, { recursive: true, force: true }) }
  }
  if (stripNotes) tip('Speaker notes were removed from this file (use --notes to keep them).')
  if (stripActivities && stripActivitiesFrom(readFileSync(resolve(input), 'utf-8')).removed.length) tip('Slides with polls were left out (--no-polls).')
  if (slides) tip(`Only slides ${parsed.options['--slide']} (--slide).`)
  ok(`${sending ? 'Made' : 'Built'}: ${c.cyan}${htmlFile}${c.reset}${reader ? ' — opens in the reader view' : ''}${selfContained ? ' (single file)' : ' + local assets'}\n`)

// ── skill ─────────────────────────────────────────────────────────────────────
} else if (command === 'skill') {
  const installIndex = parsed.options['--install'] ? 0 : -1
  if (hasFlag('--print') || installIndex < 0) {
    if (installIndex < 0 && !hasFlag('--print')) {
      console.log(`\n  The write-slides skill drafts a complete deck for an AI coding assistant.\n`)
      for (const [key, spec] of Object.entries(TARGETS)) console.log(`    ${c.cyan}${key.padEnd(8)}${c.reset} ${spec.title.padEnd(16)} ${c.dim}${spec.scope === 'home' ? `~/${spec.path}  (or --project)` : spec.projectPath}${c.reset}`)
      console.log(`\n  ${c.dim}mdeck skill --install claude codex     install for one or more assistants\n  mdeck skill --print                     print the skill for any other tool${c.reset}\n`)
    } else process.stdout.write(readSkill().text)
  } else {
    const targets = parsed.options['--install']
    if (!targets.length) { err(`Name at least one assistant: ${Object.keys(TARGETS).join(', ')}`); process.exit(1) }
    for (const target of targets) {
      try { const result = installSkill(target, { project: hasFlag('--project') }); ok(`${result.title}: ${c.cyan}${result.file}${c.reset}`) } catch (error) { err(error.message); process.exitCode = 1 }
    }
  }

// ── pdf ───────────────────────────────────────────────────────────────────────
} else if (command === 'pdf') {
  const input = requireInput('pdf')
  const pdfFile = resolve(process.cwd(), outputOption() ?? basename(input).replace(/\.md$/i, '') + '.pdf')
  if (!hasFlag('--no-drawings')) { try { assertDrawings(input) } catch (error) { err(error.message); process.exit(1) } }
  if (!findChrome()) { err('No Chrome or Chromium found. Set MDECK_CHROME to its executable path.'); process.exit(1) }
  const slides = slideOption(input)
  const tempDir = mkdtempSync(resolve(tmpdir(), 'mdeck-pdf-'))
  try {
    await build({
      ...baseConfig(input, { selfContained: true }),
      plugins: [preact(), slidesPlugin(resolve(input), { inlineImages: true, inlineMedia: true, embedFonts: true, stripActivities: hasFlag('--no-polls'), slides, ink: !hasFlag('--no-drawings'), results: !hasFlag('--no-results'), deckLook: true }), viteSingleFile()],
      build: { outDir: tempDir, emptyOutDir: true, target: 'esnext', assetsInlineLimit: 100 * 1024 * 1024 },
      logLevel: 'warn',
    })
    await mkdir(dirname(pdfFile), { recursive: true })
    await renderPdf({ htmlFile: resolve(tempDir, 'index.html'), output: pdfFile })
    ok(`PDF: ${c.cyan}${pdfFile}${c.reset}\n`)
  } catch (error) { err(error.message); process.exitCode = 1 } finally { await rm(tempDir, { recursive: true, force: true }) }

// ── preview ───────────────────────────────────────────────────────────────────
} else if (command === 'preview') {
  const folder = resolve(process.cwd(), positionals()[0] ?? 'dist')
  if (!existsSync(resolve(folder, 'index.html'))) { err(`No built presentation in ${folder}. Make one with mdeck build.`); process.exit(1) }
  const server = await preview({
    configFile: false,
    root: frameworkRoot,
    build: { outDir: folder },
    preview: { open: !hasFlag('--no-open'), ...(portOption() ? { port: portOption(), strictPort: true } : {}) },
  })
  server.printUrls()

} else {
  err(`Unknown command: "${command}"`)
  if (Object.hasOwn(RENAMED_COMMANDS, command)) tip(`mdeck ${command} is now ${RENAMED_COMMANDS[command]}.`)
  tip('Run mdeck --help for usage.\n')
  process.exit(1)
}
