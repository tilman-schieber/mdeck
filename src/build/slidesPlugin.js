import { readFileSync, existsSync, readdirSync } from 'fs'
import { resolve, dirname, basename, sep } from 'path'
import { parseSlides } from '../core/parseSlides.js'
import { validateDeck, formatDiagnostics } from '../core/validateDeck.js'
import { loadRegistry, extensionRoots, manifestsOf } from '../extensions/discover.js'
import { resolvePalette } from '../extensions/appearance.js'
import { embedFonts } from './fonts.js'
import { stripNotes as stripNotesFrom, shareSlides } from '../core/editDeck.js'
import { componentFolders, componentFiles } from './components.js'
import { inkFileFor, normalizeInk, emptyInk } from '../core/ink.js'
import { resultsFileFor, normalizeResults } from '../core/results.js'
import { isOwnWrite } from './ownWrites.js'
import { fileURLToPath } from 'node:url'
import { assertDrawings } from './drawings.js'
import { marked } from 'marked'
import { scanTags, replaceTagsIn, withAttribute } from '../core/tags.js'
import { resolveBibliography, sampleBibliography } from './bibliography.js'

const VIRTUAL_ID = 'virtual:slides'
const RESOLVED_ID = '\0virtual:slides'

const COMPONENTS_ID = 'virtual:deck-components'
const RESOLVED_COMPONENTS_ID = '\0virtual:deck-components'
const EXTENSIONS_ID = 'virtual:mdeck-extensions'
const RESOLVED_EXTENSIONS_ID = '\0virtual:mdeck-extensions'
const INK_ID = 'virtual:deck-ink'
const RESOLVED_INK_ID = '\0virtual:deck-ink'
const SVGS_ID = 'virtual:deck-svgs'
const RESOLVED_SVGS_ID = '\0virtual:deck-svgs'
const BIB_ID = 'virtual:bibliography'
const RESOLVED_BIB_ID = '\0virtual:bibliography'
const RESULTS_ID = 'virtual:deck-results'
const RESOLVED_RESULTS_ID = '\0virtual:deck-results'

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
}

function isLocalAssetRef(ref = '') {
  return ref
    && !/^([a-z]+:)?\/\//i.test(ref)
    && !ref.startsWith('data:')
    && !ref.startsWith('#')
}

function cleanAssetRef(ref) {
  const q = ref.indexOf('?')
  const h = ref.indexOf('#')
  const end = [q, h].filter(i => i !== -1).sort((a, b) => a - b)[0] ?? ref.length
  return ref.slice(0, end)
}

// An SVG picture that uses the theme's colour variables (var(--accent) …) is
// drawn inline by the picture layouts, so it follows the theme and palette.
// Inside an <img> it could not see them.
const themedSvg = file => /\.svg$/i.test(file) && existsSync(file) && /var\(--/.test(readFileSync(file, 'utf8'))

export function themedSvgs(deckFile, source = readFileSync(deckFile, 'utf8')) {
  const svgs = {}
  for (const ref of collectLocalAssetRefs(source)) {
    const file = resolve(dirname(deckFile), ref)
    if (themedSvg(file)) svgs[ref] = { file, markup: readFileSync(file, 'utf8').replace(/^\s*<\?xml[^>]*>\s*/, '').replace(/<!DOCTYPE[^>]*>\s*/i, '') }
  }
  return svgs
}

function toDataUrl(ref, baseDir) {
  if (!isLocalAssetRef(ref)) return null
  const cleanRef = cleanAssetRef(ref)
  const abs = resolve(baseDir, cleanRef)
  if (!existsSync(abs) || themedSvg(abs)) return null
  const ext = cleanRef.toLowerCase().slice(cleanRef.lastIndexOf('.'))
  const mime = MIME_BY_EXT[ext]
  if (!mime) return null
  const b64 = readFileSync(abs).toString('base64')
  return `data:${mime};base64,${b64}`
}

function inlineMarkdownImages(markdown, baseDir) {
  return markdown.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (m, alt, src, title) => {
    const dataUrl = toDataUrl(src, baseDir)
    if (!dataUrl) return m
    return `![${alt}](${dataUrl}${title ? ` "${title}"` : ''})`
  })
}

// The `src` of the named tags, as data: URLs where the file is local.
function inlineTagSources(markdown, baseDir, names) {
  return replaceTagsIn(markdown, tag => {
    if (tag.closing || !names.has(tag.name) || !tag.attrs.src) return
    const dataUrl = toDataUrl(tag.attrs.src, baseDir)
    return dataUrl ? withAttribute(tag, 'src', dataUrl) : undefined
  })
}

const PICTURE_TAGS = new Set(['img'])
const MEDIA_TAGS = new Set(['video', 'audio', 'source', 'videoplayer'])
const inlineHtmlImgSources = (markdown, baseDir) => inlineTagSources(markdown, baseDir, PICTURE_TAGS)
const inlineHtmlMediaSources = (markdown, baseDir) => inlineTagSources(markdown, baseDir, MEDIA_TAGS)

function inlineYamlImageFields(markdown, baseDir) {
  return markdown.replace(/^(\s*)(image|logo):\s*(["']?)([^"'\n]+)\3\s*$/gm, (m, indent, key, quote, value) => {
    const dataUrl = toDataUrl(value.trim(), baseDir)
    if (!dataUrl) return m
    const q = quote || '"'
    return `${indent}${key}: ${q}${dataUrl}${q}`
  })
}

export function collectLocalAssetRefs(markdown) {
  const refs = new Set()
  const add = ref => {
    const clean = cleanAssetRef(String(ref || '').trim())
    if (isLocalAssetRef(clean)) refs.add(clean)
  }

  const deck = parseSlides(markdown)
  add(deck.deckConfig.meta?.logo)
  for (const slide of deck.slides) {
    add(slide.meta.image)
    add(slide.meta.logo)
    add(slide.meta.props?.image)
    const bodies = [...Object.values(slide.regions).map(r => r.content), slide.meta.notes ?? '']
    for (const body of bodies) {
      if (typeof body !== 'string') continue
      marked.walkTokens(marked.lexer(body), token => {
        if (token.type === 'image') add(token.href)
        if (token.type === 'html') {
          for (const tag of scanTags(token.text)) {
            if (PICTURE_TAGS.has(tag.name) || MEDIA_TAGS.has(tag.name)) add(tag.attrs.src)
            // Markdown pictures in a tag's attributes, such as a poll's options.
            for (const value of Object.values(tag.attrs)) for (const match of value.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) add(match[1])
          }
        }
      })
    }
  }

  return [...refs]
}

// Applies fn to the text outside fenced code blocks, so a path shown in a code
// example stays text instead of becoming an embedded file.
function outsideCodeFences(markdown, fn) {
  const lines = markdown.split('\n')
  let out = '', text = '', fence = null
  for (const [i, line] of lines.entries()) {
    const chunk = line + (i < lines.length - 1 ? '\n' : '')
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1]
    if (fence) {
      out += chunk
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length).trim()) fence = null
    } else if (marker) {
      out += fn(text) + chunk
      text = ''
      fence = marker
    } else text += chunk
  }
  return out + fn(text)
}

export function maybeInlineAssets(markdown, abs, { inlineImages, inlineMedia }) {
  if (!inlineImages && !inlineMedia) return markdown
  const baseDir = dirname(abs)
  return outsideCodeFences(markdown, text => {
    let out = text
    if (inlineImages) out = inlineMarkdownImages(out, baseDir)
    if (inlineImages) out = inlineHtmlImgSources(out, baseDir)
    if (inlineImages) out = inlineYamlImageFields(out, baseDir)
    if (inlineMedia) out = inlineHtmlMediaSources(out, baseDir)
    return out
  })
}

// ─── Extension registry module ────────────────────────────────────────────
// Layouts, themes and palettes are discovered in Node and handed to the
// browser as one generated module. Layout code and styles are imported
// eagerly; theme stylesheets stay lazy so only the chosen theme is loaded.
// Layout JSX is trusted code, not sandboxed data.

export function generateExtensionsModule(registry) {
  const imports = []
  const layouts = Object.values(registry.layouts).map((t, i) => {
    imports.push(`import L${i} from ${JSON.stringify(t.files.layout)}`, ...t.files.styles.map(s => `import ${JSON.stringify(s)}`))
    return `${JSON.stringify(t.id)}: { manifest: ${JSON.stringify(t.manifest)}, render: L${i} }`
  })
  const themes = Object.values(registry.themes).map(t => {
    const loads = t.files.styles.map(s => `import(${JSON.stringify(s + '?inline')})`)
    return `${JSON.stringify(t.id)}: { manifest: ${JSON.stringify(t.manifest)}, load: () => Promise.all([${loads.join(', ')}]).then(mods => mods.map(m => m.default).join('\\n')) }`
  })
  const palettes = Object.values(registry.palettes).map(p => `${JSON.stringify(p.id)}: { manifest: ${JSON.stringify(p.manifest)} }`)
  return `${imports.join('\n')}\nexport const layouts = {\n${layouts.join(',\n')}\n}\nexport const themes = {\n${themes.join(',\n')}\n}\nexport const palettes = {\n${palettes.join(',\n')}\n}\n`
}

// A file for readers carries only the deck's own theme and the palette it
// shows: the reader view offers light and dark, nothing else, and only that
// theme's fonts travel with the file.
export function deckLookOnly(registry, deckConfig = {}) {
  const theme = registry.themes[deckConfig.theme ?? 'neue']
  if (!theme) return registry
  const palettes = Object.fromEntries(Object.entries(registry.palettes).map(([id, record]) => [id, record.manifest]))
  const { palette } = resolvePalette({ theme: theme.manifest, palettes, palette: deckConfig.palette })
  return { ...registry, themes: { [theme.id]: theme }, palettes: palette ? { [palette.id]: registry.palettes[palette.id] } : {} }
}

// `editor` keeps the page alive while `mdeck edit` rewrites the deck: deck
// changes only invalidate the module, validation errors are warnings, and
// extension changes are announced instead of forcing a reload. `source` is
// the deck's text where there is no file (`mdeck design`, on the sample deck);
// `slidesPath` then only says where its folder is.
export function slidesPlugin(slidesPath, { inlineImages = false, inlineMedia = false, editor = false, stripNotes = false, stripActivities = false, slides = null, ink = true, results = true, embedFonts: embedThemeFonts = false, deckLook = false, source: given = null } = {}) {
  const abs = resolve(slidesPath)
  const readDeck = () => given ?? readFileSync(abs, 'utf-8')
  const watchDeck = context => { if (given === null) context.addWatchFile(abs) }
  const sourceFor = raw => {
    const shared = stripNotes ? stripNotesFrom(raw) : raw
    return stripActivities || slides ? shareSlides(shared, { activities: stripActivities, slides }).source : shared
  }
  const inkPath = inkFileFor(abs)
  const resultsPath = resultsFileFor(abs)
  const extensionDirs = extensionRoots(abs).map(root => root.dir)
  let componentDirs = componentFolders(abs, readDeck()).map(folder => folder.dir)
  const watchDirs = () => [...extensionDirs, ...componentDirs]
  const isWatched = file => watchDirs().some(dir => resolve(file).startsWith(dir + sep))
  // A changed `components:` list takes effect without restarting the server.
  const followComponentFolders = server => {
    const next = componentFolders(abs, readDeck()).map(folder => folder.dir)
    if (next.join('\n') === componentDirs.join('\n')) return false
    componentDirs = next
    server.watcher.add(next)
    const allow = server.config.server.fs.allow
    for (const dir of next) if (!allow.includes(dir)) allow.push(dir)
    return true
  }
  const ALL_IDS = [RESOLVED_ID, RESOLVED_COMPONENTS_ID, RESOLVED_EXTENSIONS_ID, RESOLVED_INK_ID, RESOLVED_SVGS_ID, RESOLVED_BIB_ID]
  const SOURCE_IDS = [RESOLVED_ID, RESOLVED_INK_ID, RESOLVED_SVGS_ID, RESOLVED_BIB_ID]
  // The reference files (and .csl style) the deck names, from the last load.
  let bibFiles = []
  // The dev and edit servers also show the sample deck (?sample=1, the
  // design page), with its references from memory; builds never do.
  let serving = false
  // The editor keeps its page: the formatted references arrive as a hot update.
  const bibUpdate = server => {
    const mod = server.moduleGraph.getModuleById(RESOLVED_BIB_ID)
    return editor && mod ? [mod] : []
  }
  const invalidate = (server, ids) => {
    for (const id of ids) {
      const mod = server.moduleGraph.getModuleById(id)
      if (mod) server.moduleGraph.invalidateModule(mod)
    }
  }
  const reload = (server, ids, file) => {
    invalidate(server, ids)
    if (!editor) server.ws.send({ type: 'full-reload' })
    else if (file) server.ws.send('mdeck:extensions-changed', { file })
  }

  return {
    name: 'vite-plugin-slides',
    configResolved(config) { serving = config.command === 'serve' },
    configureServer(server) {
      server.watcher.add([abs, inkPath, ...watchDirs()])
      const refresh = file => {
        if (isWatched(file)) reload(server, ALL_IDS, resolve(file))
        else if (resolve(file) === inkPath && !(() => { try { return isOwnWrite(inkPath, readFileSync(inkPath, 'utf-8')) } catch { return false } })()) reload(server, [RESOLVED_INK_ID], inkPath)
      }
      for (const event of ['add', 'unlink', 'addDir', 'unlinkDir']) server.watcher.on(event, refresh)
    },
    resolveId(id) {
      if (id === 'mdeck/template-api') throw new Error('mdeck/template-api is now mdeck/layout. Run mdeck migrate to update local imports.')
      if (id === 'mdeck/layout') return fileURLToPath(new URL('../layouts/layoutApi.jsx', import.meta.url))
      if (id === 'mdeck/live') return fileURLToPath(new URL('../live/client.js', import.meta.url))
      if (id === VIRTUAL_ID) return RESOLVED_ID
      if (id === COMPONENTS_ID) return RESOLVED_COMPONENTS_ID
      if (id === EXTENSIONS_ID) return RESOLVED_EXTENSIONS_ID
      if (id === INK_ID) return RESOLVED_INK_ID
      if (id === SVGS_ID) return RESOLVED_SVGS_ID
      if (id === BIB_ID) return RESOLVED_BIB_ID
      if (id === RESULTS_ID) return RESOLVED_RESULTS_ID
    },
    load(id) {
      if (id === RESOLVED_ID) {
        watchDeck(this)
        const raw = readDeck()
        const registry = loadRegistry(abs)
        for (const warning of registry.warnings) this.warn(warning)
        const diagnostics = validateDeck(parseSlides(raw), {
          layouts: manifestsOf(registry, 'layout'), themes: manifestsOf(registry, 'theme'), palettes: manifestsOf(registry, 'palette'),
        })
        const errors = diagnostics.filter(d => d.severity === 'error')
        if (errors.length && !editor) throw new Error(formatDiagnostics(errors, abs))
        if (diagnostics.length) this.warn(formatDiagnostics(diagnostics, abs))
        const source = maybeInlineAssets(sourceFor(raw), abs, { inlineImages, inlineMedia })
        return `export default ${JSON.stringify(source)}`
      }
      // The deck's saved ink (<deck>.drawings.json), scaled to its design size.
      // Builds bundle it, so the reader view and PDFs show it too.
      if (id === RESOLVED_INK_ID) {
        if (ink) assertDrawings(abs)
        // Only an existing file: Vite treats a missing watch file as a missing
        // import. The dev server's watcher notices the file once it appears.
        if (existsSync(inkPath)) this.addWatchFile(inkPath)
        let size = {}
        try { const config = parseSlides(readDeck()).deckConfig ?? {}; size = { width: config.width ?? 1920, height: config.height ?? 1080 } } catch {}
        let data = emptyInk(size)
        if (ink && existsSync(inkPath)) {
          try { data = normalizeInk(JSON.parse(readFileSync(inkPath, 'utf-8')), size) } catch (error) { this.warn(`${inkPath}: ${error.message}; showing no ink`) }
        }
        // Without the activity slides or those not chosen, drawings follow their slides to their new ids.
        if (stripActivities || slides) {
          try {
            const { ids, removed } = shareSlides(readDeck(), { activities: stripActivities, slides })
            const gone = new Set(removed)
            data = { ...data, slides: Object.fromEntries(Object.entries(data.slides).filter(([id]) => !gone.has(id)).map(([id, strokes]) => [ids[id] ?? id, strokes])) }
          } catch {}
        }
        return `export default ${JSON.stringify(data)}\nexport const inkFileName = ${JSON.stringify(basename(inkPath))}`
      }
      // The answers kept in the talk (<deck>.results.json): builds show them
      // where no room server is (src/live/client.js). `mdeck run` shows the
      // live answers, and writes the file, so it does not read it here.
      if (id === RESOLVED_RESULTS_ID) {
        let data = normalizeResults({})
        if (results && !serving && existsSync(resultsPath)) {
          try { data = normalizeResults(JSON.parse(readFileSync(resultsPath, 'utf-8'))) } catch (error) { this.warn(`${resultsPath}: ${error.message}; showing no results`) }
        }
        return `export default ${JSON.stringify(data)}`
      }
      if (id === RESOLVED_SVGS_ID) {
        watchDeck(this)
        const svgs = themedSvgs(abs, sourceFor(readDeck()))
        for (const { file } of Object.values(svgs)) this.addWatchFile(file)
        return `export default ${JSON.stringify(Object.fromEntries(Object.entries(svgs).map(([ref, { markup }]) => [ref, markup])))}`
      }
      // The deck's citations and references, formatted with citeproc here so
      // that none of it travels in the deck (bibliography.js).
      if (id === RESOLVED_BIB_ID) {
        watchDeck(this)
        const data = bibliography => bibliography && { ids: bibliography.ids, clusters: bibliography.clusters, singles: bibliography.singles, entries: bibliography.entries, order: bibliography.order }
        return Promise.all([resolveBibliography(abs, sourceFor(readDeck()), { sample: serving }), serving ? sampleBibliography() : null]).then(([bibliography, sample]) => {
          bibFiles = bibliography ? [...bibliography.files, bibliography.style].filter(Boolean) : []
          for (const file of bibFiles) if (existsSync(file)) this.addWatchFile(file)
          if (bibliography?.diagnostics.length) this.warn(bibliography.diagnostics.map(d => d.message).join('\n'))
          return `export default ${JSON.stringify(data(bibliography))}\nexport const sample = ${JSON.stringify(data(sample))}`
        })
      }
      if (id === RESOLVED_EXTENSIONS_ID) {
        const registry = loadRegistry(abs)
        for (const record of registry.records) this.addWatchFile(record.file)
        if (!deckLook) return generateExtensionsModule(registry)
        let config = {}
        try { config = parseSlides(readDeck()).deckConfig ?? {} } catch {}
        return generateExtensionsModule(deckLookOnly(registry, config))
      }
      if (id === RESOLVED_COMPONENTS_ID) {
        const files = componentFiles(abs, componentFolders(abs, readDeck()))
        const imports = files
          .map((f, i) => `import C${i} from ${JSON.stringify(f.file)}`)
          .join('\n')
        const entries = files
          .map((f, i) => `  ${JSON.stringify(f.tag)}: C${i},`)
          .join('\n')
        return `${imports}\nexport default {\n${entries}\n}\n`
      }
    },
    // The deck page carries the deck's language before any script runs, for
    // screen readers, hyphenation and search engines.
    // A single-file build also carries the theme's fonts (fonts.js).
    async transformIndexHtml(html, context) {
      if (!/(^|[\/])index\.html$/.test(context.filename ?? context.path ?? '')) return html
      let config = {}
      try { config = parseSlides(readDeck()).deckConfig ?? {} } catch {}
      const lang = config.lang
      if (typeof lang === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang)) html = html.replace(/<html lang="[^"]*"/, `<html lang="${lang}"`)
      if (embedThemeFonts) {
        const theme = loadRegistry(abs).themes[config.theme ?? 'neue']?.manifest
        const { css, warnings } = await embedFonts(theme?.fonts ?? [])
        for (const warning of warnings) console.warn(`  ! ${warning}`)
        if (css) html = html.replace('</head>', `<style data-mdeck-fonts>\n${css}\n</style>\n</head>`)
      }
      return html
    },
    handleHotUpdate({ file, server }) {
      const changed = resolve(file)
      if (isWatched(changed)) {
        reload(server, ALL_IDS, changed)
        return []
      }
      // mdeck's own writes (saved ink, a new slide id) must not reload the
      // windows mid-talk: the pages refresh their ink on `mdeck:ink` instead.
      // The results file is written during the talk and read only by builds.
      if (changed === resultsPath) return []
      const own = [inkPath, abs].includes(changed) && (() => { try { return isOwnWrite(changed, readFileSync(changed, 'utf-8')) } catch { return false } })()
      if (own) {
        invalidate(server, changed === abs ? SOURCE_IDS : [RESOLVED_INK_ID])
        return changed === abs ? bibUpdate(server) : []
      }
      if (changed === inkPath) {
        reload(server, [RESOLVED_INK_ID], changed)
        return []
      }
      if (bibFiles.includes(changed)) {
        invalidate(server, [RESOLVED_BIB_ID])
        if (editor) return bibUpdate(server)
        server.ws.send({ type: 'full-reload' })
        return []
      }
      if (changed === abs) {
        if (followComponentFolders(server)) {
          reload(server, ALL_IDS, changed)
          return []
        }
        // The deck sets the ink's design size and which SVGs are inlined.
        invalidate(server, SOURCE_IDS)
        if (editor) return bibUpdate(server)
        server.ws.send({ type: 'full-reload' })
      }
    },
  }
}
