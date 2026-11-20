import { h } from 'preact'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import { render } from 'preact'
import { marked, Parser } from 'marked'
import { registry } from '../runtime/registry'
import { scanTags, closeTags } from '../core/tags.js'
import { expandPollLists } from '../core/pollList.js'
import { expandDataTags } from '../core/dataTag.js'
import { textDirection } from '../core/languages.js'
import { sourceLines, fenceState } from '../core/source.js'
import { InkLayer } from '../runtime/ink/InkLayer.jsx'
import themedSvgs from 'virtual:deck-svgs'
import { renderCitations, citationsHtml as referencesOf, bibliographyOf } from '../runtime/citations.js'

// ─── Content extraction ────────────────────────────────────────────────────

const FN_DEF_RE = /^\[\^([^\]\n]+)\]:\s+([^\n]+)/gm
const FN_REF_RE = /\[\^([^\]\n]+)\]/g

// `change(text, lineStart)` applied to the prose of `markdown` only: fenced
// code blocks and `inline code` keep what is written in them.
function inProse(markdown, change) {
  let fence = null
  return sourceLines(markdown).map(line => {
    const raw = markdown.slice(line.start, line.end)
    const before = fence
    fence = fenceState(line.text, fence)
    if (before || fence) return raw
    return raw.split(/((`+)[^`]*?\2)/).map((part, i) => i % 3 === 0 ? change(part, i === 0) : i % 3 === 1 ? part : '').join('')
  }).join('')
}

function preprocessFootnotes(markdown) {
  const defs = {}
  const stripped = inProse(markdown, (text, lineStart) => lineStart ? text.replace(FN_DEF_RE, (_, label, note) => {
    defs[label] = note.trim()
    return ''
  }) : text)

  let counter = 0
  const labelToNum = {}
  const processed = inProse(stripped, text => text.replace(FN_REF_RE, (_, label) => {
    if (labelToNum[label] === undefined) labelToNum[label] = ++counter
    return `<sup>${labelToNum[label]}</sup>`
  }))

  if (counter === 0) return { processed: markdown, footnotesHtml: '' }

  const items = Object.keys(labelToNum)
    .map(label => `<li>${marked.parseInline(defs[label] ?? label)}</li>`)
    .join('')

  return { processed, footnotesHtml: `<ol>${items}</ol>` }
}

// The deck's words for the audience (`slide.chapter` …), for layouts that show any.
export { t } from '../core/labels.js'

export function extractContent(markdown, { headingLevels = [], paragraph = false } = {}) {
  // marked's preprocess hook (src/runtime/markedSetup.js) does not run for
  // marked.lexer, so the lists of polls become their options here, and the
  // CSV of a <data> tag its data-csv.
  const processed = expandDataTags(expandPollLists(markdown))
  const footnotesHtml = ''
  const tokens = marked.lexer(processed)
  const headings = {}
  const paragraphs = []
  const remaining = []

  for (const token of tokens) {
    if (token.type === 'heading' && headingLevels.includes(token.depth) && headings[token.depth] == null) {
      headings[token.depth] = Parser.parseInline(token.tokens)
    } else if (token.type === 'paragraph' && paragraph && paragraphs.length === 0 && !headings[2]) {
      paragraphs.push(Parser.parseInline(token.tokens))
    } else remaining.push(token)
  }

  const fullHtml = marked.parse(processed)
  const bodyHtml = marked.parser(Object.assign(remaining, { links: tokens.links }))
  return { headings, paragraphs, bodyHtml, fullHtml, footnotesHtml }
}

// ─── Pictures ─────────────────────────────────────────────────────────────

// An SVG picture that uses the theme's colour variables is drawn inline, so it
// follows the theme, palette and light or dark. The build lists them by the
// path the deck uses; an SVG data URL carries its drawing itself.
export const themedSvg = src => themedSvgs[src] ?? themedSvgs[String(src ?? '').split(/[?#]/)[0]] ?? themedDataSvg(src)

function themedDataSvg(src) {
  const match = /^data:image\/svg\+xml(;base64)?,(.*)$/s.exec(String(src ?? ''))
  if (!match) return null
  let markup
  try { markup = match[1] ? atob(match[2]) : decodeURIComponent(match[2]) } catch { return null }
  return /var\(--/.test(markup) && /^\s*<svg\b/.test(markup) ? markup : null
}

// Pictures in slide text keep the drawing's own size, like an <img>.
export function inlineThemedPictures(html) {
  if (!html || !html.includes('<img')) return html
  let out = ''
  let last = 0
  for (const tag of scanTags(html)) {
    const markup = tag.name === 'img' && !tag.closing && themedSvg(tag.attrs.src)
    if (!markup) continue
    const alt = (tag.attrs.alt ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    out += html.slice(last, tag.index) + `<span class="themed-picture themed-picture--inline" role="img" aria-label="${alt}">${markup}</span>`
    last = tag.end
  }
  return out + html.slice(last)
}

// A drawing in the page more than once (on two slides, or in a slide shown
// twice) would repeat its ids, and url(#…) and href="#…" find the first copy,
// which may be on a hidden slide: each copy gets ids of its own.
let drawingCopies = 0
export function ownIds(svg) {
  const named = svg.querySelectorAll('[id]')
  if (!named.length || svg.hasAttribute('data-own-ids')) return
  const suffix = `--${++drawingCopies}`
  const renamed = new Map([...named].map(element => [element.id, element.id + suffix]))
  for (const element of named) element.id = renamed.get(element.id)
  const swap = text => text.replace(/url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g, (match, quote, id) => renamed.has(id) ? `url(#${renamed.get(id)})` : match)
  for (const element of svg.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const local = attribute.value.startsWith('#') && renamed.get(attribute.value.slice(1))
      if (attribute.localName === 'href' && local) attribute.value = '#' + local
      else if (attribute.value.includes('url(')) attribute.value = swap(attribute.value)
    }
    if (element.localName === 'style') element.textContent = swap(element.textContent)
  }
  svg.setAttribute('data-own-ids', '')
}

// A picture from the slide's settings; `fit: cover` fills its box like a
// photo, otherwise the drawing fits inside.
export function Picture({ src, alt, fit, position, class: className, ...attributes }) {
  const ref = useRef()
  const markup = themedSvg(src)
  useEffect(() => { const svg = ref.current?.querySelector(':scope > svg'); if (svg) ownIds(svg) }, [markup])
  if (!markup) return <img class={className} src={src} alt={alt} style={{ objectFit: fit, objectPosition: position }} {...attributes} />
  const aspect = fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'
  // The box sets the size; the drawing scales inside it.
  const html = markup.replace(/<svg\b[^>]*>/, tag => tag.replace(/\s(width|height|preserveAspectRatio)="[^"]*"/g, '').replace('<svg', `<svg preserveAspectRatio="${aspect}"`))
  return <div ref={ref} class={['themed-picture', className].filter(Boolean).join(' ')} role="img" aria-label={alt} dangerouslySetInnerHTML={{ __html: html }} {...attributes} />
}

// ─── Hydration for inline components ──────────────────────────────────────

// Components may be written `<poll … />`, which a browser takes for an open
// tag, putting what follows inside the component, where it is lost.
const COMPONENT_TAGS = new Set(Object.keys(registry))

export function HtmlContent({ html, class: className, ...attributes }) {
  const ref = useRef()

  // Mounted as the page is drawn, not after: a plain effect still waiting
  // when the slide is drawn again (two language switches in quick
  // succession) runs inside that drawing, and its render() of the components
  // broke it half way, leaving the slide in the language before.
  useLayoutEffect(() => {
    if (!ref.current) return
    ref.current.querySelectorAll('.themed-picture > svg').forEach(ownIds)
    const mounted = []
    for (const [name, Component] of Object.entries(registry)) {
      for (const el of [...ref.current.querySelectorAll(name)]) {
        // A component may leave an element to HTML, as <data> does a <data value="…">.
        if (Component.leavesToHtml?.(el)) continue
        const props = Object.fromEntries([...el.attributes].map(a => [a.name, a.value]))
        const children = el.textContent
        const wrapper = document.createElement('div')
        el.replaceWith(wrapper)
        render(h(Component, { ...props, children }), wrapper)
        mounted.push(wrapper)
      }
    }
    return () => mounted.forEach(wrapper => render(null, wrapper))
  }, [html])

  return <div class={className} {...attributes} ref={ref} dangerouslySetInnerHTML={{ __html: closeTags(inlineThemedPictures(html), COMPONENT_TAGS) }} />
}

// ─── Header / footer / footnotes rails ────────────────────────────────────

function SlideHeader({ deckConfig, right, logo, logoDark, isTitle = false }) {
  const org = deckConfig.meta?.organization ?? ''

  // show.organization: 'title' (default) | 'all' | 'none'
  const instSetting = deckConfig.show?.organization ?? 'title'
  const showOrg = instSetting === 'all' || (instSetting === 'title' && isTitle)
  // The logo stands on the title slide, and on every slide with 'all'.
  const showLogo = Boolean(logo) && (isTitle || instSetting === 'all')

  // show.sections: 'all' (default) | 'none'
  const showSection = (deckConfig.show?.sections ?? 'all') !== 'none'

  return (
    <div class="slide-header">
      <span class="brand">{showOrg ? org : ''}</span>
      {/* With a logo for dark slides, both are there and the appearance shows one (base.css). */}
      {showLogo && <img class={`slide-logo${logoDark ? ' slide-logo--light' : ''}`} src={logo} alt="" />}
      {showLogo && logoDark && <img class="slide-logo slide-logo--dark" src={logoDark} alt="" />}
      {showSection && right != null && <span>{right}</span>}
    </div>
  )
}

function SlideFooter({ deckConfig, left, right, isTitle = false }) {
  const { author, date } = deckConfig.meta ?? {}
  const authorStr = [author, date].filter(Boolean).join(' · ')

  // show.author (the author and date line): 'title' (default) | 'all' | 'none'
  const adSetting = deckConfig.show?.author ?? 'title'
  const showAuthor = adSetting === 'all' || (adSetting === 'title' && isTitle)

  // show.numbers: 'slides' (default = all-except-title) | 'all' | 'none'
  const pnSetting = deckConfig.show?.numbers ?? 'slides'
  const showRight = pnSetting === 'all' || (pnSetting === 'slides' && !isTitle)

  const leftContent = left ?? (showAuthor ? authorStr : '')
  const footerClass = leftContent ? 'slide-footer' : 'slide-footer slide-footer--no-meta'

  return (
    <div class={footerClass}>
      <span>{leftContent}</span>
      {right != null && showRight && <span>{right}</span>}
    </div>
  )
}

function SlideFootnotes({ html }) {
  if (!html) return null
  return <div class="slide-footnotes" dangerouslySetInnerHTML={{ __html: html }} />
}

// The full references of the works this slide cites (show.citations: false hides them).
function SlideCitations({ html }) {
  if (!html) return null
  return <div class="slide-citations" dangerouslySetInnerHTML={{ __html: html }} />
}

function slideNum(index) {
  return String(index + 1).padStart(2, '0')
}


export function prepareSlide(slide) {
  const position = region => region.source?.start ?? region.ranges?.[0]?.start ?? 0
  const entries = Object.entries(slide.regions ?? { body: { name: 'body', content: slide.content } })
    .sort((a, b) => position(a[1]) - position(b[1]))
  // The regions are scanned as one text, so numbered citations and footnotes
  // run on across them. The separator stands on a line of its own: joined
  // mid-line, a region's closing ``` fence read as an opening one, and the
  // next region as code.
  let separator = '\n\u0000mdeck-region\u0000\n'
  while (entries.some(([, r]) => r.content.includes(separator.trim()))) separator = separator.replace('\u0000\n', '\u0000\u0000\n')
  const bib = bibliographyOf(slide.deckConfig)
  const cited = renderCitations(entries.map(([, r]) => r.content).join(separator), bib)
  const { processed, footnotesHtml } = preprocessFootnotes(cited.markdown)
  const pieces = processed.split(separator)
  const regions = Object.fromEntries(entries.map(([name, region], i) => [name, { ...region, content: pieces[i] }]))
  const citationsHtml = slide.deckConfig?.show?.citations === false ? '' : referencesOf(cited.ids, bib)
  return { ...slide, regions, content: regions.body?.content ?? '', footnotesHtml, citationsHtml }
}

export function MarkdownRegion({ region, content, class: className, ...attributes }) {
  const name = typeof region === 'object' ? region.name : undefined
  const markdown = content ?? (typeof region === 'string' ? region : region?.content) ?? ''
  return <HtmlContent class={className} data-region={name} {...attributes} html={marked.parse(markdown)} />
}

// Layouts supply body content; every layout receives the same outer frame.
// `pages`: the slide's blank pages, above everything (runtime/ink/Room.jsx).
export function SlideFrame({ meta = {}, props = {}, deckConfig = {}, index = 0, id, manifest, footnotesHtml, citationsHtml, pages, children }) {
  const layout = manifest.id === 'generic' ? meta.layout : manifest.id
  const frame = manifest.frame ?? 'standard'
  const title = frame === 'title'
  const image = props.image
  const classes = ['slide', layout && 'slide--' + String(layout).replace(/[^a-zA-Z0-9_-]/g, '-'),
    image && ['title', 'chapter'].includes(layout) && 'has-image',
    layout === 'full-bleed-image' && props.overlay && 'has-overlay'].filter(Boolean).join(' ')
  // A deck in Farsi, Arabic or Hebrew runs from right to left; mdeck's own
  // controls around the slides keep their direction.
  const dir = textDirection(deckConfig.lang) === 'rtl' ? 'rtl' : undefined
  // Its own hotspots setting, if any (runtime/hotspots.js).
  const hotspots = meta.hotspots == null ? undefined : String(meta.hotspots)
  return <section class={classes} dir={dir} data-slide-id={id} data-label={`${slideNum(index)} ${manifest.title}`} data-hotspots={hotspots}>
    {frame !== 'none' && <SlideHeader deckConfig={deckConfig} logo={deckConfig.meta?.logo} logoDark={deckConfig.meta?.['logo-dark']} isTitle={title} right={frame === 'chapter' ? meta.part ?? '' : meta.section ?? ''} />}
    {children}
    <SlideFootnotes html={footnotesHtml} />
    <SlideCitations html={citationsHtml} />
    {frame !== 'none' && <SlideFooter deckConfig={deckConfig} right={slideNum(index)} isTitle={title} />}
    <InkLayer slideId={id} />
    {pages}
  </section>
}
