import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import preact from '@preact/preset-vite'
import { slidesPlugin } from '../src/build/slidesPlugin.js'
import { parseSlides } from '../src/core/parseSlides.js'
import { marked } from 'marked'
import { createServer as createHttpServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

// Own Vite cache per test file: files run in parallel and would otherwise
// rebuild the shared node_modules/.vite cache at the same time.
const server = await createServer({ configFile: false, plugins: [preact(), slidesPlugin('examples/custom-layouts/slides.md')], server: { middlewareMode: true, hmr: { server: createHttpServer() } }, optimizeDeps: { noDiscovery: true, include: [] }, cacheDir: mkdtempSync(resolve(tmpdir(), 'mdeck-vite-cache-')), appType: 'custom' })
after(() => server.close())
const { setCalloutLabels } = await server.ssrLoadModule('/src/runtime/markedSetup.js')
const { setDeckLanguage } = await server.ssrLoadModule('/src/core/labels.js')
const { SlideRenderer, manifests } = await server.ssrLoadModule('/src/layouts/renderSlide.jsx')

function htmlFragments(node) {
  if (!node || typeof node !== 'object') return ''
  if (Array.isArray(node)) return node.map(htmlFragments).join('\n')
  // Components with hooks cannot be called outside a render; they add no slide HTML.
  if (typeof node.type === 'function' && !['HtmlContent', 'InkLayer', 'PageSteps', 'ExtraPages'].includes(node.type.name)) return htmlFragments(node.type(node.props))
  return [node.props?.html, node.props?.dangerouslySetInnerHTML?.__html, htmlFragments(node.props?.children)].filter(Boolean).join('\n')
}

test('image-text retains lists, tables, code, components and repeated headings', () => {
  const node = SlideRenderer({ meta: { layout: 'image-text' }, content: '# Title\n\n# Second heading\n\n- List item\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1\n```\n\n<qrcode value="test" />', deckConfig: {}, index: 0 })
  const html = htmlFragments(node)
  for (const text of ['Title', 'Second heading', 'List item', '<table>', '<codeblock', '<qrcode']) assert.ok(html.includes(text), text)
})

test('split supports named regions without losing the shared heading', () => {
  const slide = parseSlides(':::meta\nlayout: split\nid: split-test\n:::\n# Shared\n:::slot left\n**Left**\n:::\n:::slot right\nRight\n:::').slides[0]
  const node = SlideRenderer({ ...slide, deckConfig: {}, index: 0 })
  assert.equal(node.type(node.props).props['data-slide-id'], 'split-test')
  for (const text of ['Shared', 'Left', 'Right']) assert.ok(htmlFragments(node).includes(text))
})

test('nested directives render correctly and preserve code delimiters', () => {
  const html = marked.parse(':::columns\n:::tip\nNested\n:::\n+++\n```text\n+++\n```\n:::')
  assert.equal((html.match(/class="column"/g) ?? []).length, 2)
  assert.match(html, /callout-tip/)
  assert.match(html, /<codeblock[^>]*>\+\+\+/)
})

test('deck-local layouts load through the real plugin and share the frame', () => {
  assert.equal(Object.keys(manifests).length, 8)
  assert.equal(manifests.comparison.title, 'Side-by-side comparison')
  const slide = parseSlides(':::meta\nlayout: comparison\nid: local\n:::\n# Shared\n:::slot left\nLeft[^a]\n:::\n:::slot right\nRight[^b]\n\n[^a]: First source\n[^b]: Second source\n:::').slides[0]
  const node = SlideRenderer({ ...slide, deckConfig: {}, index: 0 })
  const frame = node.type(node.props)
  assert.equal(frame.props.class, 'slide slide--comparison')
  assert.equal(frame.props['data-slide-id'], 'local')
  const html = htmlFragments(node)
  for (const text of ['Shared', 'Left<sup>1</sup>', 'Right<sup>2</sup>', 'First source', 'Second source']) assert.ok(html.includes(text), text)
})

test('lecture callouts are labelled in the deck language, and a written title wins', () => {
  assert.match(marked.parse('::: theorem\nStatement\n:::'), /class="callout callout-theorem"><div class="callout-title">Theorem</)
  setCalloutLabels({ lang: 'de' })
  try {
    assert.match(marked.parse('::: proof\nTrivial.\n:::'), /callout-title">Beweis</)
    assert.match(marked.parse('::: theorem Satz 2.4 (Lagrange)\nStatement\n:::'), /callout-title">Satz 2\.4 \(Lagrange\)</)
  } finally { setCalloutLabels() }
})

test("a chapter slide's label is in the deck's language, and a regional code uses it too", () => {
  // The label is plain text in the layout's markup, not HTML from Markdown.
  const texts = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(texts).join(' ') : !node || typeof node !== 'object' ? ''
    : typeof node.type === 'function' && !['HtmlContent', 'InkLayer', 'PageSteps', 'ExtraPages'].includes(node.type.name) ? texts(node.type(node.props)) : texts(node.props?.children)
  const chapter = () => texts(SlideRenderer({ meta: { layout: 'chapter', number: 2 }, content: '# Methods', deckConfig: {}, index: 0 }))
  setDeckLanguage({ lang: 'de-CH' })
  setCalloutLabels({ lang: 'de-CH' })
  try {
    assert.ok(chapter().includes('Kapitel'))
    assert.match(marked.parse('::: tip\nx\n:::'), /callout-title">Tipp</)
  } finally { setDeckLanguage(); setCalloutLabels() }
  assert.ok(chapter().includes('Chapter'))
})

test('a paragraph of only pictures is marked, a sentence with a picture is not', () => {
  assert.match(marked.parse('![A](a.jpg) ![B](b.jpg)'), /<p class="pictures"><img[^>]*> <img/)
  assert.match(marked.parse('![Logo](logo.png)'), /<p class="pictures">/)
  assert.doesNotMatch(marked.parse('Press ![stop](stop.png) to stop.'), /pictures/)
  assert.doesNotMatch(marked.parse('Just words.'), /pictures/)
})

test('citations are put in place, a slide lists the works it cites, and unknown keys are marked', async () => {
  const { renderCitations, citationsHtml } = await server.ssrLoadModule('/src/runtime/citations.js')
  const bib = { ids: ['smith2020', 'jones2019'], clusters: { '[@smith2020, p. 4]': '(Smith, 2020, p. 4)' }, singles: { smith2020: '(Smith, 2020)', jones2019: '(Jones, 2019)' }, entries: { smith2020: '<div class="csl-entry">Smith 2020</div>' }, order: ['smith2020'] }
  const { markdown, ids } = renderCitations('As [@smith2020, p. 4] and [@jones2019; @nobody] say.', bib)
  assert.match(markdown, /<cite class="citation" data-cites="smith2020">\(Smith, 2020, p\. 4\)<\/cite>/)
  assert.match(markdown, /\(Jones, 2019\); <span class="citation-key citation-key--missing"[^>]*>@nobody\?<\/span>/)
  assert.deepEqual(ids, ['smith2020'])
  assert.equal(citationsHtml(ids, bib), '<div class="csl-bib-body"><div class="csl-entry">Smith 2020</div></div>')
  // This deck has no bibliography: the key stays visible, marked.
  const html = htmlFragments(SlideRenderer({ meta: {}, content: '# Title\n\nSee [@smith2020].[^a]\n\n[^a]: A note', deckConfig: {}, index: 0 }))
  assert.match(html, /@smith2020\?/)
  assert.match(html, /A note/)
})

test('a code block in one region leaves the next region prose, and stays code itself', async () => {
  const { prepareSlide } = await server.ssrLoadModule('/src/layouts/layoutApi.jsx')
  const slide = parseSlides(':::meta\nlayout: split\n:::\n# Notes\n:::slot left\n```markdown\nA claim[^1].\n```\n:::\n:::slot right\nA claim[^1].\n\n[^1]: The source.\n:::').slides[0]
  const { regions, footnotesHtml } = prepareSlide({ ...slide, deckConfig: {} })
  assert.match(regions.left.content, /A claim\[\^1\]\./, 'the code shows what is written')
  assert.doesNotMatch(regions.right.content, /\[\^1\]/, 'the prose beside it gets its footnote')
  assert.match(footnotesHtml, /The source/)
})

test('a list item that begins in bold is marked as a lead item; bold later in it is not', () => {
  const html = marked.parse('- **Title** and its text\n- some **bold** text\n\n1. **One**\n')
  assert.match(html, /<li class="lead"><strong>Title<\/strong> and its text<\/li>/)
  assert.match(html, /<li>some <strong>bold<\/strong> text<\/li>/)
  assert.match(html, /<ol>\n<li class="lead"><strong>One<\/strong><\/li>/)
})
