// Themes and palettes on the sample deck (src/editor/sampleDeck.js), in a
// real browser: the check behind `npm run test:themes` and `mdeck themes
// build --check`, and the preview pictures of the theme repository. Each
// look is checked light and dark on every slide, and fails when content does
// not fit, text is cut off at the slide's edge, text is hard to read on what
// is behind it, or the page reports an error. Needs Chrome (MDECK_CHROME).
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { launchChrome } from './chrome.js'
import { frameworkRoot } from '../paths.js'
import { sampleDeck, SAMPLE_PICTURE, SAMPLE_REFERENCES, SAMPLE_REFERENCES_FILE } from '../editor/sampleDeck.js'
import { loadRegistry } from '../extensions/discover.js'

// Runs in the page before the deck: keeps what the page reports.
export const RECORDER = `window.__report = [];
for (const level of ['warn', 'error']) { const original = console[level]; console[level] = (...args) => { window.__report.push(level + ': ' + args.map(String).join(' ')); original.apply(console, args) } }
addEventListener('error', event => window.__report.push('error: ' + event.message))
addEventListener('unhandledrejection', event => window.__report.push('error: ' + (event.reason?.message ?? event.reason)))`

// Runs in the page for the slide on screen: what is cut off or hard to read.
export const MEASURE = `(() => {
  const slide = document.querySelector('deck-stage').querySelectorAll(':scope > section:not([data-extra-page])')[window.__index]
  const problems = []
  const frame = slide.getBoundingClientRect()
  const scale = frame.width / slide.offsetWidth
  const body = slide.querySelector('.slide-body')
  if (body && body.scrollHeight > body.clientHeight + 2) problems.push('the content is ' + Math.round(body.scrollHeight - body.clientHeight) + 'px taller than its place')
  const parse = value => { const m = value.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a } }
  const lum = ({ r, g, b }) => { const c = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b) }
  const ratio = (x, y) => { const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05) }
  // The colour behind an element, when it is a plain colour; null behind a
  // picture or a gradient, where it cannot be told.
  // The slide's own ::before and ::after fields (duet's chapter colour field),
  // as rectangles in slide coordinates.
  const fields = ['::before', '::after'].map(pseudo => getComputedStyle(slide, pseudo)).filter(drawn => drawn.content !== 'none' && drawn.position === 'absolute'
    && (drawn.backgroundImage !== 'none' || (parse(drawn.backgroundColor)?.a ?? 0) > 0.05))
    .map(drawn => { const left = parseFloat(drawn.left) || 0, top = parseFloat(drawn.top) || 0; return { left, top, right: left + (parseFloat(drawn.width) || slide.offsetWidth), bottom: top + (parseFloat(drawn.height) || slide.offsetHeight) } })
  const behind = (element, box) => {
    if (element.closest('.slide--full-bleed-image')) return null
    const x = (box.left + box.width / 2 - frame.left) / scale, y = (box.top + box.height / 2 - frame.top) / scale
    if (fields.some(field => x >= field.left && x <= field.right && y >= field.top && y <= field.bottom)) return null
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node)
      // A field drawn by ::before or ::after (duet's chapter) is behind it too.
      for (const pseudo of ['::before', '::after']) {
        const drawn = getComputedStyle(node, pseudo)
        const painted = drawn.backgroundImage !== 'none' || (parse(drawn.backgroundColor)?.a ?? 0) > 0.05
        const area = (parseFloat(drawn.width) || 0) * (parseFloat(drawn.height) || 0)
        if (node !== slide && drawn.content !== 'none' && painted && area >= 0.25 * node.offsetWidth * node.offsetHeight) return null
      }
      if (style.backgroundImage !== 'none' && !(node === slide && /radial-gradient/.test(style.backgroundImage) && !/linear/.test(style.backgroundImage))) return null
      const colour = parse(style.backgroundColor)
      if (colour && colour.a >= 0.95) return colour
      if (colour && colour.a > 0.05) return null
      if (node === slide) return colour
    }
    return null
  }
  const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const element = text.parentElement
    if (!text.textContent.trim() || seen.has(element) || element.closest('.slide-ink, .katex-mathml, [aria-hidden="true"], .slide--full-bleed-image .slide-bg')) continue
    seen.add(element)
    const style = getComputedStyle(element)
    if (style.visibility === 'hidden' || Number(style.opacity) === 0 || element.closest('[data-step]:not([data-step-visible])')) continue
    // A range over a text node measures nothing right inside an SVG (a
    // chart's labels): there, the <text> element's own box is the text's.
    const range = document.createRange()
    range.selectNodeContents(text)
    const box = element.closest('svg') ? element.getBoundingClientRect() : range.getBoundingClientRect()
    if (!box.width || !box.height) continue
    const words = text.textContent.trim().slice(0, 40)
    // Text in a box that scrolls (a component's long list) is meant to be out of view.
    const scrolls = node => { for (; node && node !== slide; node = node.parentElement) if (/auto|scroll/.test(getComputedStyle(node).overflowY + getComputedStyle(node).overflowX)) return true; return false }
    if (!scrolls(element) && (box.left < frame.left - 2 * scale || box.right > frame.right + 2 * scale || box.top < frame.top - 2 * scale || box.bottom > frame.bottom + 2 * scale)) problems.push('"' + words + '" is cut off at the edge')
    const colour = parse(style.color), back = behind(element, box)
    if (!colour || !back || colour.a < 0.5 || element.closest('.code-block, .katex')) continue
    const large = parseFloat(style.fontSize) / scale >= 40 || (parseFloat(style.fontSize) / scale >= 30 && Number(style.fontWeight) >= 600)
    const value = ratio(colour, back)
    if (value < (large ? 2.6 : 3.4)) problems.push('"' + words + '" has a contrast of ' + value.toFixed(1) + ':1')
  }
  return problems
})()`

// Builds the sample deck with `extensions` ({ id: folder }) beside it into
// `outDir`, as a folder to host. Installed user extensions are left out, so
// the result depends only on what is given. Returns the registry it used.
export function buildSampleDeck({ extensions = {}, outDir }) {
  const temp = mkdtempSync(resolve(tmpdir(), 'mdeck-sample-'))
  try {
    writeFileSync(resolve(temp, 'slides.md'), sampleDeck())
    writeFileSync(resolve(temp, 'picture.svg'), SAMPLE_PICTURE)
    writeFileSync(resolve(temp, SAMPLE_REFERENCES_FILE), SAMPLE_REFERENCES)
    // Keyed by id, or by "kind:id" to keep a theme and a palette of one name apart.
    for (const [key, dir] of Object.entries(extensions)) cpSync(dir, resolve(temp, 'extensions', ...key.split(':').map((part, i, all) => all.length > 1 && i === 0 ? `${part}s` : part)), { recursive: true })
    mkdirSync(resolve(temp, 'home'))
    execFileSync(process.execPath, [resolve(frameworkRoot, 'bin/mdeck.js'), 'build', resolve(temp, 'slides.md'), '-o', resolve(outDir, 'index.html')],
      { cwd: temp, stdio: 'pipe', env: { ...process.env, MDECK_HOME: resolve(temp, 'home') } })
    return loadRegistry(resolve(temp, 'slides.md'), { userRoot: null })
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

// The sample deck built with `extensions`, opened in Chrome for `use({ open })`.
export async function withSampleDeck({ extensions = {} } = {}, use) {
  const temp = mkdtempSync(resolve(tmpdir(), 'mdeck-sample-'))
  try {
    buildSampleDeck({ extensions, outDir: resolve(temp, 'out') })
    const browser = await launchChrome({ dir: resolve(temp, 'out') })
    try {
      // A page with the deck in a look, recording what it reports.
      const open = async ({ theme, palette = '', appearance = '' }) => {
        const page = await browser.open('about:blank')
        await page.send('Page.enable')
        await page.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER })
        await page.send('Page.navigate', { url: `${browser.origin}/index.html?embedded=1&theme=${theme}&palette=${palette}&appearance=${appearance}#1` })
        await page.waitFor("location.href.includes('index.html')")
        await page.waitForDeck()
        return page
      }
      return await use({ open })
    } finally { await browser.close() }
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

export const settle = page => page.evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 60))))')

// Every slide of each look ({ theme, palette }), light and dark; returns the
// problems found, one line each.
export function checkLooks(looks, { extensions = {} } = {}) {
  return withSampleDeck({ extensions }, async ({ open }) => {
    const failures = []
    for (const { theme, palette = '' } of looks) {
      for (const appearance of ['light', 'dark']) {
        const label = `${theme}${palette ? ` with ${palette}` : ''} (${appearance})`
        const page = await open({ theme, palette, appearance })
        await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
        const count = await page.evaluate("document.querySelector('deck-stage').length")
        for (let index = 0; index < count; index++) {
          await page.evaluate(`window.__index = ${index}; document.querySelector('deck-stage').goTo(${index})`)
          // Two frames: the stage shows the slide, then fit.js measures it.
          await settle(page)
          for (const problem of await page.evaluate(MEASURE)) failures.push(`${label}, slide ${index + 1}: ${problem}`)
        }
        for (const line of await page.evaluate('window.__report')) failures.push(`${label}: ${line}`)
        await page.close()
      }
    }
    return failures
  })
}

// The size of a theme's icon in lists, in CSS pixels; drawn at twice that
// for sharp screens.
export const ICON = { width: 96, height: 54, scale: 2 }

// Pictures of looks on the sample deck, as WebP: { file, theme, palette,
// slide, icon } each, slide counting from 1. `icon`, if given, is a second
// file with the same slide at icon size: small enough for a list, and still
// showing the theme's type, colours and shapes.
export function renderPreviews(shots, { extensions = {}, width = 960, height = 540 } = {}) {
  return withSampleDeck({ extensions }, async ({ open }) => {
    for (const { file, theme, palette = '', slide = 1, icon = null } of shots) {
      const page = await open({ theme, palette })
      if (slide > 1) { await page.evaluate(`document.querySelector('deck-stage').goTo(${slide - 1})`); await settle(page) }
      mkdirSync(resolve(file, '..'), { recursive: true })
      writeFileSync(file, await page.screenshot({ width, height, format: 'webp' }))
      if (icon) {
        mkdirSync(resolve(icon, '..'), { recursive: true })
        writeFileSync(icon, await page.screenshot({ ...ICON, format: 'webp' }))
      }
      await page.close()
    }
  })
}
