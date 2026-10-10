// Deck-level editing operations on the parsed document model. Every function
// takes the deck from parseSlides, never mutates it, and returns the new
// source (or { source, index } for structural changes). Untouched bytes stay
// identical; callers reparse the result.
import { parseSlides, SLIDE_KEYS, DECK_KEYS } from './parseSlides.js'
import { applySourceEdits, replaceRegion, normalizeBlock, detectNewline, patchYamlMapping, firstYamlKey } from './source.js'
import { openTagsIn, tagsIn, closingTagOf } from './tags.js'

const REGION_RE = /^[a-z][a-z0-9-]*$/

export function findSlide(deck, slideId) {
  const slide = deck.slides.find(slide => slide.id === slideId)
  if (!slide) throw new Error(`No slide "${slideId}"`)
  return slide
}

export function slideSourceText(deck, slideId) {
  const { source } = findSlide(deck, slideId)
  return deck.source.slice(source.start, source.end)
}

function lineEnd(source, offset) {
  const index = source.indexOf('\n', offset)
  return index < 0 ? source.length : index + 1
}

// `delimiterStart` is the start of the `---` line that introduces the slide,
// or null when there is none or when it is the deck config's closing line.
export function slideBounds(deck, slideId) {
  const { source } = findSlide(deck, slideId)
  let delimiterStart = null
  if (source.start > 0) {
    const lineStart = deck.source.lastIndexOf('\n', source.start - 2) + 1
    const line = deck.source.slice(lineStart, source.start)
    if (/^---[ \t]*\r?\n$/.test(line) && deck.configSource?.end !== lineStart) delimiterStart = lineStart
  }
  return { start: source.start, end: source.end, delimiterStart }
}

function edit(deck, edits) { return applySourceEdits(deck.source, edits) }
const expectedText = (deck, range) => deck.source.slice(range.start, range.end)

// Text to put before something appended at `offset` so it starts on its own
// line with one blank line separating it from previous content.
function separatorBefore(source, offset, nl) {
  if (offset === 0) return ''
  const before = source.slice(0, offset)
  if (!before.endsWith('\n')) return nl + nl
  return /\r?\n\r?\n$/.test(before) ? '' : nl
}

function appendBlock(deck, slide, block) {
  const nl = detectNewline(deck.source)
  const at = slide.source.end
  // A legacy meta-only slide needs its `---` line before any body content.
  const pre = slide.bodySource === null && slide.metaSource ? (deck.source.slice(0, at).endsWith('\n') ? '' : nl) + '---' + nl : separatorBefore(deck.source, at, nl)
  const post = at < deck.source.length ? nl : ''
  return edit(deck, [{ start: at, end: at, text: pre + block + post }])
}

export function setRegion(deck, slideId, name, markdown) {
  if (!REGION_RE.test(name)) throw new Error(`Invalid region name "${name}"`)
  const slide = findSlide(deck, slideId)
  const region = slide.regions[name]
  const nl = detectNewline(deck.source)
  if (region?.explicit) return replaceRegion(deck, slideId, name, markdown)
  const content = normalizeBlock(markdown, nl)
  if (!region) return appendBlock(deck, slide, `:::slot ${name}${nl}${content}:::${nl}`)
  // Implicit body: rewrite the first content-bearing range, collapse other
  // content ranges to one blank line, leave whitespace-only ranges alone.
  const ranges = region.ranges.filter(range => range.end > range.start)
  if (!ranges.length) {
    if (slide.bodySource === null) return appendBlock(deck, slide, content)
    const at = slide.bodySource.start
    return edit(deck, [{ start: at, end: at, text: content + (at < slide.source.end ? nl : '') }])
  }
  const hasText = range => deck.source.slice(range.start, range.end).trim()
  const target = ranges.find(hasText) ?? ranges[0]
  const edits = []
  for (const range of ranges) {
    const slice = deck.source.slice(range.start, range.end)
    if (range === target) {
      const lead = slice.match(/^(\r?\n)*/)[0]
      const blank = /\r?\n\r?\n$/.test(slice) ? nl : ''
      const atEnd = range.end === deck.source.length && !slice.endsWith('\n')
      let text
      if (!content) text = lead || (range.end < slide.source.end ? nl : '')
      else text = lead + (atEnd ? content.slice(0, -nl.length) : content + blank)
      edits.push({ ...range, text, expected: slice })
    } else if (hasText(range)) edits.push({ ...range, text: nl, expected: slice })
  }
  return edit(deck, edits)
}

export function removeRegion(deck, slideId, name) {
  const slide = findSlide(deck, slideId)
  const block = slide.blocks.find(block => block.type === 'slot' && block.name === name)
  if (!block) throw new Error(`No explicit region "${name}" on slide "${slideId}"`)
  return removeBlock(deck, block)
}

function blockRemoval(deck, block) {
  let { start } = block.source
  const { end } = block.source
  // Take one preceding blank line with the block.
  const before = deck.source.slice(0, start)
  const blank = before.match(/\r?\n(\r?\n)$/)
  if (blank) start -= blank[1].length
  return { start, end, text: '', expected: deck.source.slice(start, end) }
}

function removeBlock(deck, block) {
  return edit(deck, [blockRemoval(deck, block)])
}

function metaForm(deck, slide) {
  if (!slide.metaSource) return 'none'
  return slide.metaSource.start === slide.source.start ? 'legacy' : 'explicit'
}

export function setSlideMeta(deck, slideId, patch) {
  const slide = findSlide(deck, slideId)
  const nl = detectNewline(deck.source)
  const form = metaForm(deck, slide)
  const block = yamlText => `:::meta${nl}${yamlText}:::${nl}`
  if (form === 'none') {
    const yamlText = patchYamlMapping('', patch, { newline: nl })
    if (!yamlText) return deck.source
    return edit(deck, [{ start: slide.source.start, end: slide.source.start, text: block(yamlText) }])
  }
  const range = slide.metaSource
  const current = expectedText(deck, range)
  if (form === 'explicit') {
    const yamlText = patchYamlMapping(current, patch, { newline: nl })
    if (yamlText) return edit(deck, [{ ...range, text: yamlText, expected: current }])
    return edit(deck, [{ start: slide.source.start, end: lineEnd(deck.source, range.end), text: '' }])
  }
  // Legacy `---` metadata: keep its form while a slide key leads, otherwise
  // convert it into an explicit :::meta block (consuming the inner `---`).
  const yamlText = patchYamlMapping(current, patch, { newline: nl, leadKeys: SLIDE_KEYS })
  const end = slide.bodySource ? slide.bodySource.start : range.end
  if (!yamlText) return slide.bodySource ? edit(deck, [{ start: range.start, end, text: '' }]) : removeSlide(deck, slideId).source
  if (SLIDE_KEYS.has(firstYamlKey(yamlText))) return edit(deck, [{ ...range, text: yamlText, expected: current }])
  return edit(deck, [{ start: range.start, end, text: block(yamlText) }])
}

export function notesSource(deck, slideId) {
  const slide = findSlide(deck, slideId)
  return slide.blocks.some(block => block.type === 'notes') ? 'block' : null
}

export function setSlideNotes(deck, slideId, markdown) {
  const slide = findSlide(deck, slideId)
  const nl = detectNewline(deck.source)
  const content = normalizeBlock(markdown, nl)
  const block = slide.blocks.find(block => block.type === 'notes')
  if (block) {
    if (!content) return removeBlock(deck, block)
    return edit(deck, [{ ...block.bodySource, text: content, expected: expectedText(deck, block.bodySource) }])
  }
  if (!content) return deck.source
  return appendBlock(deck, slide, `:::notes${nl}${content}:::${nl}`)
}

export function setDeckConfig(deck, patch) {
  const nl = detectNewline(deck.source)
  const range = deck.configSource
  if (!range) {
    const yamlText = patchYamlMapping('', patch, { newline: nl, leadKeys: DECK_KEYS })
    if (!yamlText) return deck.source
    const at = deck.source.startsWith('﻿') ? 1 : 0
    return edit(deck, [{ start: at, end: at, text: `---${nl}${yamlText}---${nl}${nl}` }])
  }
  const current = expectedText(deck, range)
  const yamlText = patchYamlMapping(current, patch, { newline: nl, leadKeys: DECK_KEYS })
  if (yamlText) return edit(deck, [{ ...range, text: yamlText, expected: current }])
  const open = deck.source.lastIndexOf('---', range.start)
  let end = lineEnd(deck.source, range.end)
  const blank = deck.source.slice(end).match(/^\r?\n/)
  if (blank) end += blank[0].length
  return edit(deck, [{ start: open, end, text: '' }])
}

export function insertSlide(deck, index, markdown) {
  const nl = detectNewline(deck.source)
  const text = normalizeBlock(markdown, nl)
  const count = deck.slides.length
  index = Math.max(0, Math.min(count, index))
  if (index < count) {
    const at = deck.slides[index].source.start
    return { source: edit(deck, [{ start: at, end: at, text: `${text}${nl}---${nl}` }]), index }
  }
  const at = count ? deck.slides[count - 1].source.end : deck.source.length
  const pre = at > 0 && !deck.source.slice(0, at).endsWith('\n') ? nl : ''
  return { source: edit(deck, [{ start: at, end: at, text: `${pre}---${nl}${text}` }]), index }
}

export function removeSlide(deck, slideId) {
  const bounds = slideBounds(deck, slideId)
  const index = deck.slides.findIndex(slide => slide.id === slideId)
  const next = deck.slides[index + 1]
  const range = bounds.delimiterStart != null
    ? { start: bounds.delimiterStart, end: bounds.end }
    : { start: bounds.start, end: next ? next.source.start : deck.source.length }
  const source = edit(deck, [{ ...range, text: '', expected: expectedText(deck, range) }])
  return { source, index: Math.min(index, deck.slides.length - 2) }
}

export function moveSlide(deck, slideId, toIndex) {
  const text = slideSourceText(deck, slideId)
  const removed = removeSlide(deck, slideId)
  return insertSlide(parseSlides(removed.source), toIndex, text)
}

export function replaceSlideSource(deck, slideId, text) {
  const slide = findSlide(deck, slideId)
  const nl = detectNewline(deck.source)
  const current = slideSourceText(deck, slideId)
  const trailing = current.match(/(\r?\n)*$/)[0]
  const body = text.replace(/\r?\n/g, nl).replace(/[\r\n]*$/, '')
  return edit(deck, [{ ...slide.source, text: body + (body ? trailing : ''), expected: current }])
}

// Removes every speaker notes block for shared builds.
export function stripNotes(source) {
  const deck = parseSlides(source)
  const edits = deck.slides.flatMap(slide => slide.blocks
    .filter(block => block.type === 'notes')
    .map(block => blockRemoval(deck, block)))
  return edit(deck, edits)
}

// The live activities, and the code to join them (<qrcode join />): a slide
// with one of them is left out of shared builds. <qrcode follow /> and other
// QR codes stay.
const ACTIVITIES = new Set(['poll', 'question', 'wordcloud', 'scale', 'numeric'])
const joins = tag => tag.name === 'qrcode' && 'join' in tag.attrs && !/^\{?(false|no|off|0)\}?$/i.test(tag.attrs.join.trim())
export function hasActivity(slide) {
  return [slide.content ?? '', ...Object.values(slide.regions ?? {}).map(region => region.content ?? '')]
    .some(text => openTagsIn(text).some(tag => ACTIVITIES.has(tag.name) || joins(tag)))
}

// Removes every slide with a live activity (<poll>, <question>, <wordcloud>,
// <scale>, <numeric>) for shared builds: a reader cannot vote, and the results belong to
// the talk. Returns { source, ids, removed }: `ids` maps each kept slide's id
// to its id afterwards (an automatic `slide-N` moves up), `removed` the ids
// that are gone, so saved drawings can follow their slides.
export function stripActivities(source) {
  return shareSlides(source, { activities: true })
}

// The slides a shared build keeps: those numbered in `slides` (1-based, as
// written; null for all) and, with `activities`, none with a live activity.
// A deck of nothing but activities keeps them rather than becoming empty. A
// <style> on a slide left out styles the whole deck, so it moves to the
// first kept slide. Returns { source, ids, removed } as stripActivities.
export function shareSlides(source, { activities = false, slides = null } = {}) {
  const deck = parseSlides(source)
  const same = () => ({ source, ids: Object.fromEntries(deck.slides.map(slide => [slide.id, slide.id])), removed: [] })
  if (slides) {
    const beyond = slides.filter(n => n > deck.slides.length)
    if (beyond.length) throw new Error(`The deck has ${deck.slides.length} slides; there is no slide ${beyond.join(', ')}`)
  }
  let chosen = deck.slides.filter((slide, i) => !slides || slides.includes(i + 1))
  if (activities && !chosen.every(hasActivity)) chosen = chosen.filter(slide => !hasActivity(slide))
  const dropped = deck.slides.filter(slide => !chosen.includes(slide))
  if (!dropped.length) return same()
  const ranges = dropped.map(slide => {
    const bounds = slideBounds(deck, slide.id)
    const next = deck.slides[deck.slides.indexOf(slide) + 1]
    return bounds.delimiterStart != null
      ? { start: bounds.delimiterStart, end: bounds.end }
      : { start: bounds.start, end: next ? next.source.start : deck.source.length }
  }).sort((a, b) => a.start - b.start)
  // Neighbouring slides can share a delimiter: join ranges that touch.
  const merged = []
  for (const range of ranges) {
    const last = merged.at(-1)
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  let next = edit(deck, merged.map(range => ({ ...range, text: '', expected: expectedText(deck, range) })))
  const styles = dropped.flatMap(slide => styleBlocks(deck.source.slice(slide.source.start, slide.source.end)))
  if (styles.length) {
    const kept = parseSlides(next)
    const nl = detectNewline(next)
    next = appendBlock(kept, kept.slides[0], styles.join(nl) + nl)
  }
  const after = parseSlides(next).slides
  return { source: next, ids: Object.fromEntries(chosen.map((slide, i) => [slide.id, after[i]?.id ?? slide.id])), removed: dropped.map(slide => slide.id) }
}

// The <style> elements in a slide's text, found as the slide finds them (not in code).
function styleBlocks(text) {
  const tags = tagsIn(text)
  return tags.flatMap((tag, at) => {
    if (tag.name !== 'style' || tag.closing || tag.start == null) return []
    const close = closingTagOf(tags, at)
    return close?.end != null ? [text.slice(tag.start, close.end)] : []
  })
}
