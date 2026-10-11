import yaml from 'js-yaml'
import { sourceLines, fenceState, scanDirectives, diagnostic } from './source.js'
export { sourceLines, fenceState } from './source.js'

export const DECK_KEYS = new Set('theme palette appearance params meta width height show lang labels callouts reader components server session bibliography csl nocite hotspots timer'.split(' '))
export const SLIDE_KEYS = new Set('layout id title section number part description label image alt overlay eyebrow attribution props hotspots'.split(' '))

// Names from before 2.0. They are still recognised, so that an old deck gets a
// message naming the new setting (see validateDeck) instead of being read as
// a slide, but nothing uses them.
export const RENAMED_DECK_KEYS = {
  design: 'theme',
  institution: 'show.organization',
  authorDate: 'show.author',
  pageNumbers: 'show.numbers',
  sections: 'show.sections',
  share: 'reader',
  live: 'server and session',
}
const ANY_DECK_KEYS = new Set([...DECK_KEYS, ...Object.keys(RENAMED_DECK_KEYS)])

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function segmentsOf(source) {
  const segments = []
  let start = 0
  let fence = null
  let depth = 0
  for (const line of sourceLines(source)) {
    const before = fence
    fence = fenceState(line.text, fence)
    if (before || fence) continue
    if (/^:::\s*[\w-]+/.test(line.text)) depth++
    else if (/^:::\s*$/.test(line.text)) depth = Math.max(0, depth - 1)
    if (!depth && /^---[ \t]*$/.test(line.text)) {
      segments.push({ start, end: line.start, delimiterEnd: line.end })
      start = line.end
    }
  }
  segments.push({ start, end: source.length, delimiterEnd: source.length })
  return segments.filter(s => source.slice(s.start, s.end).trim())
}

// The first block is the deck's settings when its first key is only a deck
// key. A key both may have (hotspots) leaves it to the others: a slide's own
// key makes it the first slide's, otherwise it is the deck's.
function isDeckBlock(text) {
  const keys = sourceLines(text).map(line => line.text.match(/^([\w-]+):/)?.[1]).filter(Boolean)
  const deckOnly = key => ANY_DECK_KEYS.has(key) && !SLIDE_KEYS.has(key)
  if (!keys.length || deckOnly(keys[0])) return !!keys.length
  if (!ANY_DECK_KEYS.has(keys[0])) return false
  if (keys.some(deckOnly)) return true
  return !keys.some(key => SLIDE_KEYS.has(key) && !ANY_DECK_KEYS.has(key))
}

export function looksLikeMeta(text, keys, { frontmatter = false } = {}) {
  const first = sourceLines(text).find(line => line.text.trim() && !/^\s*#/.test(line.text))
  const key = first?.text.match(/^([\w-]+):/)
  return !!key && keys.has(key[1]) && (frontmatter || !/^\s*#{1,6}\s/.test(text))
}

function extractBody(source, body, diagnostics) {
  const raw = body ? source.slice(body.start, body.end) : ''
  const offset = body?.start ?? 0
  const scan = scanDirectives(raw)
  diagnostics.push(...scan.diagnostics.map(d => diagnostic(source, d.code, d.message, offset + d.offset)))
  const regions = Object.create(null)
  const notes = []
  const blocks = []
  const bodyParts = []
  let cursor = 0
  for (const node of scan.nodes) {
    if (node.end == null || !['slot', 'notes', 'meta'].includes(node.name)) continue
    if (node.start > cursor) bodyParts.push({ start: offset + cursor, end: offset + node.start })
    const range = { start: offset + node.bodyStart, end: offset + node.bodyEnd }
    const block = { type: node.name, name: node.argument, source: { start: offset + node.start, end: offset + node.end }, bodySource: range }
    blocks.push(block)
    const value = source.slice(range.start, range.end)
    if (node.name === 'notes') notes.push(value.trim())
    if (node.name === 'meta') diagnostics.push(diagnostic(source, 'misplaced-meta', ':::meta must be the first block of a slide', offset + node.start))
    if (node.name === 'slot') {
      const name = node.argument
      if (!/^[a-z][a-z0-9-]*$/.test(name)) diagnostics.push(diagnostic(source, 'invalid-region', 'Region names must use lowercase letters, digits and hyphens', offset + node.start))
      else if (regions[name]) diagnostics.push(diagnostic(source, 'duplicate-region', `Duplicate region "${name}"`, offset + node.start))
      else regions[name] = { name, content: value.trim(), raw: value, source: range, explicit: true }
      const checkChildren = children => {
        for (const child of children) {
          if (['slot', 'notes', 'meta'].includes(child.name)) diagnostics.push(diagnostic(source, 'nested-region', 'Slots, notes and metadata must be top-level slide blocks', offset + child.start))
          checkChildren(child.children)
        }
      }
      checkChildren(node.children)
    }
    cursor = node.end
  }
  if (cursor < raw.length) bodyParts.push({ start: offset + cursor, end: offset + raw.length })
  const content = bodyParts.map(range => source.slice(range.start, range.end)).join('').trim()
  // Unassigned content is always available as the default body region.
  if (!regions.body) regions.body = { name: 'body', content, explicit: false, ranges: bodyParts }
  else if (content) diagnostics.push(diagnostic(source, 'ambiguous-body', 'An explicit body slot cannot be combined with unassigned slide content', offset))
  return { content, notes: notes.join('\n\n'), regions, blocks }
}

export function parseSlides(source) {
  const segments = segmentsOf(source)
  const diagnostics = []
  const text = segment => source.slice(segment.start, segment.end).trim()
  const readMeta = segment => {
    try {
      const value = yaml.load(source.slice(segment.start, segment.end))
      if (!isPlainObject(value)) throw new Error('Metadata must be a YAML mapping')
      return value
    } catch (error) {
      const offset = segment.start + (error.mark?.position ?? 0)
      diagnostics.push(diagnostic(source, 'invalid-yaml', error.reason ?? error.message, offset))
      return {}
    }
  }
  let deckConfig = {}
  let configSource = null
  let i = 0
  if (segments[0] && /^\s*---[ \t]*\r?\n/.test(source) && looksLikeMeta(text(segments[0]), ANY_DECK_KEYS, { frontmatter: true }) && isDeckBlock(text(segments[0]))) {
    deckConfig = readMeta(segments[0])
    configSource = { start: segments[0].start, end: segments[0].end }
    i++
  }
  const slides = []
  while (i < segments.length) {
    const segment = segments[i++]
    let meta = {}
    let body = segment
    let metaSource = null
    const explicit = scanDirectives(source.slice(segment.start, segment.end)).nodes[0]
    if (explicit?.name === 'meta' && explicit.end != null && !source.slice(segment.start, segment.start + explicit.start).trim()) {
      metaSource = { start: segment.start + explicit.bodyStart, end: segment.start + explicit.bodyEnd }
      meta = readMeta(metaSource)
      body = { start: segment.start + explicit.end, end: segment.end }
    } else if (looksLikeMeta(text(segment), SLIDE_KEYS)) {
      meta = readMeta(segment)
      metaSource = { start: segment.start, end: segment.end }
      body = segments[i]
      if (body && !looksLikeMeta(text(body), SLIDE_KEYS) && !/^:::meta\b/.test(text(body))) i++
      else body = null
    }
    const { content, notes, regions, blocks } = extractBody(source, body, diagnostics)
    const authoredMeta = { ...meta }
    // Speaker notes come only from body blocks. Keep the YAML snapshot for
    // source editing and validation, separate from the resolved block notes.
    delete meta.notes
    if (notes) meta.notes = notes
    slides.push({ id: meta.id ?? `slide-${slides.length + 1}`, meta, authoredMeta, content, regions, blocks,
      source: { start: segment.start, end: body?.end ?? segment.end },
      metaSource, bodySource: body ? { start: body.start, end: body.end } : null })
  }
  let currentSection = null
  for (const slide of slides) {
    if (slide.meta.layout === 'chapter' && slide.meta.part) currentSection = slide.meta.part
    else if (Object.hasOwn(slide.meta, 'section')) currentSection = slide.meta.section
    else if (currentSection) slide.meta.section = currentSection
  }
  return { source, configSource, deckConfig, slides, diagnostics }
}
