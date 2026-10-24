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
import { languageOfFile, languageFiles } from '../core/languages.js'
import { expandDeck, withoutSettings } from './include.js'
import { dataTagsIn } from '../core/dataTag.js'

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
const DATA_ID = 'virtual:deck-data'
const RESOLVED_DATA_ID = '\0virtual:deck-data'

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

// A link that names a file beside the deck (`./handout.pdf`), not a page of
// the site, an address or an anchor.
const isFileLink = ref => isLocalAssetRef(ref) && !/^[a-z][a-z0-9+.-]*:/i.test(ref) && !ref.startsWith('?') && /\.[a-z0-9]{1,5}$/i.test(cleanAssetRef(ref))

// The attributes that name local files, and each one's refs changed by
// `map(ref)`: `src` and `poster` are one ref, `srcset` lists them with
// sizes, `style` holds them in url(…), `href` is a link, counted when it
// names a file. Applies to pictures and media, `style` to any tag.
const REF_ATTRS = ['src', 'poster', 'srcset', 'style', 'href']
function mapAttributeRefs(tag, name, map) {
  const value = tag.attrs[name]
  if (value == null) return value
  if (name === 'style') return value.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, quote, ref) => `url(${quote}${map(ref.trim())}${quote})`)
  if (name === 'href') return tag.name === 'a' && isFileLink(value) ? map(value) : value
  if (!(PICTURE_TAGS.has(tag.name) || MEDIA_TAGS.has(tag.name))) return value
  if (name === 'srcset') return value.split(',').map(part => part.replace(/^(\s*)(\S+)/, (m, space, ref) => space + map(ref))).join(',')
  return map(value)
}
// The refs a tag's attributes name, as written.
function attributeRefs(tag) {
  const refs = []
  for (const name of REF_ATTRS) mapAttributeRefs(tag, name, ref => { refs.push(ref); return ref })
  return refs
}
// The tag with each ref in its attributes (`names`) changed by `map(ref)`,
// or undefined when none changed.
function withMappedRefs(tag, map, names = REF_ATTRS) {
  let raw = tag.raw, changed = false
  // From the last attribute to the first, so earlier spans stay where they are.
  for (const name of names.filter(name => tag.attrs[name] != null).sort((a, b) => tag.spans[b][0] - tag.spans[a][0])) {
    const next = mapAttributeRefs(tag, name, map)
    if (next === tag.attrs[name]) continue
    const [from, to] = tag.spans[name]
    raw = raw.slice(0, from) + next + raw.slice(to)
    changed = true
  }
  return changed ? raw : undefined
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

// The data files the deck's <data src="…"> tags name, beside the deck:
// { ref: { file, text } } for those that exist. Builds carry their text, so
// a file sent to readers and the PDF show the data without the file.
export function dataFiles(deckFile, source = readFileSync(deckFile, 'utf8')) {
  const files = {}
  for (const slide of parseSlides(source).slides) {
    for (const text of [slide.content ?? '', ...Object.values(slide.regions ?? {}).map(region => region.content ?? '')]) {
      for (const { attrs } of dataTagsIn(text)) {
        const ref = cleanAssetRef(String(attrs.src ?? '').trim())
        if (!ref || !isLocalAssetRef(ref) || files[ref]) continue
        const file = resolve(dirname(deckFile), ref)
        if (existsSync(file)) files[ref] = { file, text: readFileSync(file, 'utf8') }
      }
    }
  }
  return files
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

// The local files tags name (`src`, `poster`, `srcset`, url(…) in `style`),
// as data: URLs; `media` says whether video and audio are embedded too.
// Links to files stay links: a file cannot be sent inside a link.
function inlineTagSources(markdown, baseDir, { media }) {
  return replaceTagsIn(markdown, tag => {
    if (tag.closing) return
    return withMappedRefs(tag, ref => {
      const dataUrl = toDataUrl(ref, baseDir)
      if (!dataUrl || (!media && /^data:(video|audio)/.test(dataUrl))) return ref
      return dataUrl
    }, REF_ATTRS.filter(name => name !== 'href'))
  })
}

// <pinpoint src="…"> shows its picture like an <img>.
const PICTURE_TAGS = new Set(['img', 'pinpoint'])
const MEDIA_TAGS = new Set(['video', 'audio', 'source', 'videoplayer'])

function inlineYamlImageFields(markdown, baseDir) {
  return markdown.replace(/^(\s*)(image|logo|logo-dark):\s*(["']?)([^"'\n]+)\3\s*$/gm, (m, indent, key, quote, value) => {
    const dataUrl = toDataUrl(value.trim(), baseDir)
    if (!dataUrl) return m
    const q = quote || '"'
    return `${indent}${key}: ${q}${dataUrl}${q}`
  })
}

// The line where `ref` is first written as a whole path (img/g.svg is not
// the end of ./img/g.svg), or 1: for messages about the file.
export function lineNaming(source, ref) {
  const at = source.search(new RegExp(String.raw`(?<![\w./-])${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  return at < 0 ? 1 : source.slice(0, at).split('\n').length
}

export function collectLocalAssetRefs(markdown) {
  const refs = new Set()
  const add = ref => {
    const clean = cleanAssetRef(String(ref || '').trim())
    if (isLocalAssetRef(clean)) refs.add(clean)
  }

  const deck = parseSlides(markdown)
  add(deck.deckConfig.meta?.logo)
  add(deck.deckConfig.meta?.['logo-dark'])
  for (const slide of deck.slides) {
    add(slide.meta.image)
    add(slide.meta.logo)
    add(slide.meta.props?.image)
    const bodies = [...Object.values(slide.regions).map(r => r.content), slide.meta.notes ?? '']
    for (const body of bodies) {
      if (typeof body !== 'string') continue
      marked.walkTokens(marked.lexer(body), token => {
        if (token.type === 'image') add(token.href)
        if (token.type === 'link' && isFileLink(token.href)) add(token.href)
        if (token.type === 'html') {
          for (const tag of scanTags(token.text)) {
            for (const ref of attributeRefs(tag)) add(ref)
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

// The local files a part of a deck names, each changed by `map(ref)` (the new
// ref, or null to keep it): Markdown pictures (also those in a tag's
// attributes, such as a poll's options) and links to files, the `src`,
// `poster`, `srcset` and `style` of pictures and media, the `src` of <data>,
// and `image:`, `logo:` and `logo-dark:` settings. For an included file (include.js), whose
// paths are written from its own folder. Paths from the root (/…) stay.
export function rewriteAssetRefs(markdown, map) {
  const swap = ref => (isLocalAssetRef(ref) && !ref.startsWith('/') ? map(ref) ?? ref : ref)
  return outsideCodeFences(markdown, text => {
    let out = text.replace(/(!\[[^\]]*\]\()([^)\s]+)/g, (m, head, ref) => head + swap(ref))
    out = out.replace(/(^|[^!])(\[[^\]]*\]\()([^)\s]+)/g, (m, before, head, ref) => before + head + (isFileLink(ref) ? swap(ref) : ref))
    out = replaceTagsIn(out, tag => {
      if (tag.closing) return
      if (tag.name === 'data') {
        if (!tag.attrs.src) return
        const next = swap(tag.attrs.src)
        return next === tag.attrs.src ? undefined : withAttribute(tag, 'src', next)
      }
      return withMappedRefs(tag, swap)
    })
    return out.replace(/^(\s*)(image|logo|logo-dark):\s*(["']?)([^"'\n]+)\3\s*$/gm, (m, indent, key, quote, value) => {
      const next = swap(value.trim())
      return next === value.trim() ? m : `${indent}${key}: ${quote || '"'}${next}${quote || '"'}`
    })
  })
}

export function maybeInlineAssets(markdown, abs, { inlineImages, inlineMedia }) {
  if (!inlineImages && !inlineMedia) return markdown
  const baseDir = dirname(abs)
  return outsideCodeFences(markdown, text => {
    let out = text
    if (inlineImages) out = inlineMarkdownImages(out, baseDir)
    if (inlineImages) out = inlineYamlImageFields(out, baseDir)
    out = inlineTagSources(out, baseDir, { media: inlineMedia })
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
  // Dataviews are small and any <data> tag may name one: all come along.
  const dataviews = Object.values(registry.dataviews ?? {}).map((d, i) => {
    imports.push(`import D${i} from ${JSON.stringify(d.files.view)}`, ...d.files.styles.map(s => `import ${JSON.stringify(s)}`))
    return `${JSON.stringify(d.id)}: { manifest: ${JSON.stringify(d.manifest)}, render: D${i} }`
  })
  return `${imports.join('\n')}\nexport const layouts = {\n${layouts.join(',\n')}\n}\nexport const themes = {\n${themes.join(',\n')}\n}\nexport const palettes = {\n${palettes.join(',\n')}\n}\nexport const dataviews = {\n${dataviews.join(',\n')}\n}\n`
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

// The same deck in its other languages (talk.en.md beside talk.de.md), for
// the presenter view's language switch: `[{ lang, file }]`, or none.
export function deckLanguages(abs) {
  try { return languageFiles(basename(abs), readdirSync(dirname(abs))).map(({ lang, file }) => ({ lang, file: resolve(dirname(abs), file) })) } catch { return [] }
}

// `editor` keeps the page alive while `mdeck edit` rewrites the deck: deck
// changes only invalidate the module, validation errors are warnings, and
// extension changes are announced instead of forcing a reload. `source` is
// the deck's text where there is no file (`mdeck design`, on the sample deck);
// `slidesPath` then only says where its folder is. `languages` also brings
// the deck's other languages along, for `mdeck run`; a built file has one.
export function slidesPlugin(slidesPath, { languages = false, inlineImages = false, inlineMedia = false, editor = false, stripNotes = false, stripActivities = false, slides = null, ink = true, results = true, embedFonts: embedThemeFonts = false, deckLook = false, source: given = null } = {}) {
  const abs = resolve(slidesPath)
  // The deck as shown: other files it includes in place (include.js).
  const readRaw = () => given ?? readFileSync(abs, 'utf-8')
  const expand = (file, source) => given === null ? expandDeck(file, { source }) : { source, files: [], diagnostics: [] }
  const readDeck = () => expand(abs, readRaw()).source
  // The files the deck and its other languages include, from the last load;
  // the dev server may serve their folders, for their pictures.
  let included = [], devServer = null
  const allowIncluded = () => {
    const allow = devServer?.config.server.fs.allow
    if (allow) for (const dir of included.map(file => dirname(file))) if (!allow.includes(dir)) allow.push(dir)
  }
  const watchDeck = context => { if (given === null) context.addWatchFile(abs) }
  const sourceFor = raw => {
    const shared = stripNotes ? stripNotesFrom(raw) : raw
    return stripActivities || slides ? shareSlides(shared, { activities: stripActivities, slides }).source : shared
  }
  const inkPath = inkFileFor(abs)
  // The language the file name gives, for a deck that sets no `lang`.
  const fileLanguage = given === null ? languageOfFile(basename(abs))?.lang ?? null : null
  const otherLanguages = () => languages && given === null ? deckLanguages(abs).filter(({ file }) => file !== abs) : []
  let languageWatch = []
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
  const ALL_IDS = [RESOLVED_ID, RESOLVED_COMPONENTS_ID, RESOLVED_EXTENSIONS_ID, RESOLVED_INK_ID, RESOLVED_SVGS_ID, RESOLVED_BIB_ID, RESOLVED_DATA_ID]
  const SOURCE_IDS = [RESOLVED_ID, RESOLVED_INK_ID, RESOLVED_SVGS_ID, RESOLVED_BIB_ID, RESOLVED_DATA_ID]
  // The data files of <data src="…">, from the last load.
  let dataPaths = []
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
      devServer = server
      server.watcher.add([abs, inkPath, ...watchDirs()])
      const refresh = file => {
        if (isWatched(file)) reload(server, ALL_IDS, resolve(file))
        else if (resolve(file) === inkPath && !(() => { try { return isOwnWrite(inkPath, readFileSync(inkPath, 'utf-8')) } catch { return false } })()) reload(server, [RESOLVED_INK_ID], inkPath)
      }
      for (const event of ['add', 'unlink', 'addDir', 'unlinkDir']) server.watcher.on(event, refresh)
    },
    resolveId(id) {
      if (id === 'mdeck/template-api') throw new Error('mdeck/template-api is now mdeck/layout; change the import')
      if (id === 'mdeck/layout') return fileURLToPath(new URL('../layouts/layoutApi.jsx', import.meta.url))
      if (id === 'mdeck/live') return fileURLToPath(new URL('../live/client.js', import.meta.url))
      if (id === 'mdeck/dataview') return fileURLToPath(new URL('../dataviews/api.js', import.meta.url))
      if (id === VIRTUAL_ID) return RESOLVED_ID
      if (id === COMPONENTS_ID) return RESOLVED_COMPONENTS_ID
      if (id === EXTENSIONS_ID) return RESOLVED_EXTENSIONS_ID
      if (id === INK_ID) return RESOLVED_INK_ID
      if (id === SVGS_ID) return RESOLVED_SVGS_ID
      if (id === BIB_ID) return RESOLVED_BIB_ID
      if (id === RESULTS_ID) return RESOLVED_RESULTS_ID
      if (id === DATA_ID) return RESOLVED_DATA_ID
    },
    load(id) {
      if (id === RESOLVED_ID) {
        watchDeck(this)
        const raw = readRaw()
        const registry = loadRegistry(abs)
        for (const warning of registry.warnings) this.warn(warning)
        const manifests = { layouts: manifestsOf(registry, 'layout'), themes: manifestsOf(registry, 'theme'), palettes: manifestsOf(registry, 'palette') }
        // Each file is checked as it is written, so that messages name its lines.
        const expansion = expand(abs, raw)
        const diagnostics = [...validateDeck(parseSlides(raw), manifests), ...expansion.diagnostics]
        for (const file of expansion.files) {
          const text = readFileSync(file, 'utf-8')
          diagnostics.push(...withoutSettings(text, validateDeck(parseSlides(text), manifests)).map(d => ({ ...d, file })))
        }
        const errors = diagnostics.filter(d => d.severity === 'error')
        if (errors.length && !editor) throw new Error(formatDiagnostics(errors, abs))
        if (diagnostics.length) this.warn(formatDiagnostics(diagnostics, abs))
        const source = maybeInlineAssets(sourceFor(expansion.source), abs, { inlineImages, inlineMedia })
        // The other languages are read as they are: `mdeck check` checks each file.
        const others = otherLanguages()
        languageWatch = others.map(({ file }) => file)
        for (const file of languageWatch) this.addWatchFile(file)
        const otherSources = others.map(({ lang, file }) => ({ lang, file, ...expand(file, readFileSync(file, 'utf-8')) }))
        included = [...new Set([...expansion.files, ...otherSources.flatMap(other => other.files)])]
        for (const file of included) this.addWatchFile(file)
        allowIncluded()
        for (const { file } of others) {
          const found = validateDeck(parseSlides(readFileSync(file, 'utf-8')), manifests)
          if (found.length) this.warn(formatDiagnostics(found, file))
        }
        const translations = others.length && fileLanguage
          ? { [fileLanguage]: source, ...Object.fromEntries(otherSources.map(({ lang, file, source: text }) => [lang, maybeInlineAssets(sourceFor(text), file, { inlineImages, inlineMedia })])) }
          : {}
        return `export default ${JSON.stringify(source)}\nexport const language = ${JSON.stringify(fileLanguage)}\nexport const languages = ${JSON.stringify(translations)}`
      }
      // The deck's saved ink (<deck>.drawings.json), scaled to its design size.
      // Builds bundle it, so the reader view and PDFs show it too.
      if (id === RESOLVED_INK_ID) {
        if (ink) assertDrawings(abs)
        // Only an existing file: Vite treats a missing watch file as a missing
        // import. The dev server's watcher notices the file once it appears.
        if (existsSync(inkPath)) this.addWatchFile(inkPath)
        let size = {}
        try { const config = parseSlides(readRaw()).deckConfig ?? {}; size = { width: config.width ?? 1920, height: config.height ?? 1080 } } catch {}
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
      // The data files of <data src="…">, as text; a change to one redraws its slides.
      if (id === RESOLVED_DATA_ID) {
        watchDeck(this)
        const sources = [sourceFor(readDeck()), ...otherLanguages().map(({ file }) => expand(file, readFileSync(file, 'utf-8')).source)]
        const files = Object.assign({}, ...sources.map(text => dataFiles(abs, text)))
        dataPaths = Object.values(files).map(({ file }) => file)
        for (const file of dataPaths) this.addWatchFile(file)
        return `export default ${JSON.stringify(Object.fromEntries(Object.entries(files).map(([ref, { text }]) => [ref, text])))}`
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
        try { config = parseSlides(readRaw()).deckConfig ?? {} } catch {}
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
      try { config = parseSlides(readRaw()).deckConfig ?? {} } catch {}
      const lang = config.lang ?? fileLanguage
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
      // An included file counts as the deck (saved times are written into it too).
      const deckFile = changed === abs || included.includes(changed)
      const own = (changed === inkPath || deckFile) && (() => { try { return isOwnWrite(changed, readFileSync(changed, 'utf-8')) } catch { return false } })()
      if (own) {
        invalidate(server, deckFile ? SOURCE_IDS : [RESOLVED_INK_ID])
        return deckFile ? bibUpdate(server) : []
      }
      if (changed === inkPath) {
        reload(server, [RESOLVED_INK_ID], changed)
        return []
      }
      if (languageWatch.includes(changed)) {
        invalidate(server, [RESOLVED_ID])
        if (!editor) server.ws.send({ type: 'full-reload' })
        return []
      }
      // A data file changed: its slides show the new data.
      if (dataPaths.includes(changed)) {
        invalidate(server, [RESOLVED_DATA_ID])
        const mod = server.moduleGraph.getModuleById(RESOLVED_DATA_ID)
        if (editor) return mod ? [mod] : []
        server.ws.send({ type: 'full-reload' })
        return []
      }
      if (bibFiles.includes(changed)) {
        invalidate(server, [RESOLVED_BIB_ID])
        if (editor) return bibUpdate(server)
        server.ws.send({ type: 'full-reload' })
        return []
      }
      if (included.includes(changed)) {
        invalidate(server, SOURCE_IDS)
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
