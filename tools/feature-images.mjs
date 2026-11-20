// Renders the pictures of the features on the docs home page and in the
// README, docs/site/images/features/, from the docs' example deck (a short
// tour of mdeck): drawing.webp (the presenter view on an iPad, with the
// projector showing the same strokes), polls.webp (a poll's live results with
// a phone that voted), citations.webp (citations on a slide and the reference
// list), themes.webp (one slide in every built-in theme), code.webp (live
// Python with its output), reader.webp (the reader view on a laptop and a
// phone), hotspots.webp (the tour's hotspot slide zoomed in on the projector,
// with the presenter view's numbered keys) and languages.webp (one slide of
// the Python example in English, German, Hindi and Farsi); and the theme picker's thumbnails under the example deck,
// docs/site/images/themes/<theme>-thumb.webp. `npm run feature-images`; needs
// a local Chrome, ImageMagick (`magick`) and, for live Python, an internet
// connection.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { launchChrome } from '../src/build/chrome.js'
import { baseConfig } from '../src/build/config.js'
import { livePlugin } from '../src/live/server.js'
import { loadRegistry } from '../src/extensions/discover.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'docs/site/images/features')
const temp = mkdtempSync(resolve(tmpdir(), 'mdeck-features-'))
mkdirSync(out, { recursive: true })

// The tour's slides, by number.
const SLIDE = { draw: 6, poll: 7, cite: 8, references: 9, code: 10 }
const CODE = '271828'
// A copy of the example, with a session code for the live poll and without
// its drawings and kept answers, which the pictures make themselves.
cpSync(resolve(root, 'docs/site/examples'), temp, { recursive: true })
const deck = resolve(temp, 'first-talk.md')
writeFileSync(deck, readFileSync(deck, 'utf8').replace(/^---\n/, `---\nsession:\n  code: ${CODE}\n`))
rmSync(resolve(temp, 'first-talk.drawings.json'))
rmSync(resolve(temp, 'first-talk.results.json'))

// Strokes as a hand would draw them, in the slide's 1920×1080 space.
const jitter = (i, amount) => Math.sin(i * 0.31) * amount + Math.sin(i * 0.11) * amount * 0.6
const pressure = (i, n) => +(0.45 + 0.35 * Math.sin(Math.PI * i / (n - 1))).toFixed(2)
const stroke = (id, tool, color, size, points) => ({ id, tool, color, size, points: points.map(([x, y], i) => [Math.round(x), Math.round(y), pressure(i, points.length)]) })
const line = (x1, y1, x2, y2, n = 24, bend = 18) => Array.from({ length: n }, (_, i) => {
  const t = i / (n - 1)
  return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t - Math.sin(Math.PI * t) * bend]
})

const magick = (...args) => execFileSync('magick', args.flat())
const build = name => execFileSync(process.execPath, [resolve(root, 'bin/mdeck.js'), 'build', deck, '-o', resolve(temp, name)], { cwd: root, stdio: 'pipe' })
const t = name => resolve(temp, name)
const webp = (file, ...args) => magick(...args, '-quality', '86', resolve(out, file))
// A screenshot in a device: a dark bezel with rounded corners and a soft shadow.
const device = (file, { width, bezel, radius }) => {
  const framed = file.replace(/\.png$/, '-device.png')
  magick(file, '-resize', `${width}x`, '-bordercolor', '#16171a', '-border', `${bezel}`, framed)
  const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', framed]).toString().split(' ').map(Number)
  magick(framed, '-alpha', 'set',
    '(', '-size', `${w}x${h}`, 'xc:black', '-fill', 'white', '-draw', `roundrectangle 0,0 ${w - 1},${h - 1} ${radius},${radius}`, ')',
    '-compose', 'CopyOpacity', '-composite', '-compose', 'Over',
    '(', '+clone', '-background', '#0007', '-shadow', '40x16+0+12', ')', '+swap', '-background', 'none', '-layers', 'merge', '+repage', framed)
  return framed
}
// Pictures side by side or on a canvas, on a light background.
const BACKGROUND = '#e9ecef'
let browser, dev, tour
try {
  build('plain.html')
  browser = await launchChrome({ dir: temp })
  const until = async (page, expression, attempts = 200) => { if (!await page.waitFor(expression, { attempts, interval: 50 })) throw new Error(`Condition did not become true: ${expression}`) }
  const shot = async (page, file, size) => { writeFileSync(file, await page.screenshot(size)); return file }
  const slide = async (file, query, size = { width: 1600, height: 900 }, page = 'plain.html') => {
    const tab = await browser.open(`${page}?embedded=1&${query}`)
    await tab.waitForDeck()
    await delay(400)
    await shot(tab, file, size)
    await tab.close()
    return file
  }

  // Themes: the chart slide in every built-in theme, in its own palette.
  const themes = ['neue', 'plain', 'work', 'academic', 'minimal', 'glass'].filter(id => loadRegistry(deck).themes[id])
  const frames = []
  for (const theme of themes) frames.push(await slide(t(`theme-${theme}.png`), `theme=${theme}&palette=&appearance=#${SLIDE.draw}`, { width: 1280, height: 720 }))
  const tile = file => ['(', file, '-resize', '600x', '-bordercolor', BACKGROUND, '-border', '10', ')']
  webp('themes.webp', '(', ...frames.slice(0, 3).flatMap(tile), '+append', ')', '(', ...frames.slice(3).flatMap(tile), '+append', ')', '-append', '-bordercolor', BACKGROUND, '-border', '10')
  console.log('wrote themes.webp')

  // Citations: a slide that cites, and the reference list.
  const cites = await slide(t('cites.png'), `theme=academic&palette=&appearance=#${SLIDE.cite}`, { width: 1280, height: 720 })
  const refs = await slide(t('refs.png'), `theme=academic&palette=&appearance=#${SLIDE.references}`, { width: 1280, height: 720 })
  const card = file => device(file, { width: 1120, bezel: 0, radius: 10 })
  webp('citations.webp', '-size', '1800x1000', `xc:${BACKGROUND}`, card(refs), '-geometry', '+640+30', '-composite', card(cites), '-geometry', '+30+330', '-composite')
  console.log('wrote citations.webp')

  // Drawing: the presenter view on an iPad with the pen out, in front of
  // the projector, which shows the same strokes: the tour's ring and arrow,
  // a highlight on "laser", "iPad" underlined and a tick after the last point,
  // placed where those words are in the plain theme.
  const probe = await browser.open(`plain.html?embedded=1&theme=plain&palette=&appearance=#${SLIDE.draw}`)
  await probe.waitForDeck()
  await probe.screenshot({ width: 1920, height: 1080 })
  await delay(400)
  const words = JSON.parse(await probe.evaluate(`JSON.stringify((() => {
    const items = [...document.querySelectorAll('[data-deck-active] li')]
    const box = (item, word) => {
      const node = [...item.childNodes].find(n => n.nodeType === 3 && n.textContent.includes(word)) ?? item.firstChild
      const range = document.createRange(), at = node.textContent.indexOf(word)
      range.setStart(node, Math.max(at, 0)); range.setEnd(node, at < 0 ? node.textContent.length : at + word.length)
      const r = range.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    }
    return { laser: box(items[0], 'laser'), ipad: box(items[1], 'iPad'), last: box(items[2], 'PDF') }
  })())`))
  await probe.close()
  const own = JSON.parse(readFileSync(resolve(root, 'docs/site/examples/first-talk.drawings.json'), 'utf8')).slides.draw
  const middle = box => (box.top + box.bottom) / 2
  writeFileSync(t('first-talk.drawings.json'), JSON.stringify({ version: 1, width: 1920, height: 1080, slides: { draw: [
    stroke('laser', 'highlighter', '#facc15', 30, line(words.laser.left - 6, middle(words.laser) + 2, words.laser.right + 6, middle(words.laser), 16, 2)),
    ...own,
    stroke('ipad', 'pen', '#2563eb', 6, line(words.ipad.left - 4, words.ipad.bottom + 6, words.ipad.right + 6, words.ipad.bottom + 4, 16, -3)),
    stroke('tick', 'pen', '#16a34a', 7, [[0, 0], [10, 10], [20, 22], [34, 8], [50, -10], [67, -28]].map(([x, y]) => [words.last.right + 30 + x, middle(words.last) + y])),
  ] } }))
  build('deck.html')
  const ipad = await browser.open(`deck.html?view=presenter&theme=plain&palette=&appearance=#${SLIDE.draw}`)
  await until(ipad, "document.readyState === 'complete' && location.href.startsWith('http')")
  await ipad.evaluate("localStorage.setItem('mdeck-presenter-layout', 'slide'); setTimeout(() => location.reload(), 50); true")
  await delay(500)
  await until(ipad, "!!document.querySelector('iframe')?.contentDocument?.querySelector('deck-stage')")
  await ipad.screenshot({ width: 1366, height: 1024 })
  await delay(1500)
  const frame = "document.querySelector('iframe').contentDocument"
  // The reload starts on the first slide; go to the chart.
  // Next also reveals points one at a time, so click until the chart shows.
  for (let i = 0; i < 30 && await ipad.evaluate(`${frame}.querySelector('deck-stage').index`) < SLIDE.draw - 1; i++) {
    await ipad.evaluate("document.querySelector('button[aria-label=Next]').click(); true")
    await delay(150)
  }
  await until(ipad, `${frame}.querySelector('deck-stage')?.index === ${SLIDE.draw - 1}`)
  await ipad.evaluate("[...document.querySelectorAll('button')].find(b => /draw/i.test(b.textContent + b.title + (b.getAttribute('aria-label') ?? '')))?.click()")
  await delay(500)
  await ipad.evaluate(`${frame}.querySelector('.ink-expand')?.click()`)
  await delay(300)
  await ipad.evaluate(`${frame}.querySelector('.ink-btn[title=Pen]')?.click()`)
  await delay(800)
  const tablet = device(await shot(ipad, t('ipad.png'), { width: 1366, height: 1024 }), { width: 700, bezel: 22, radius: 40 })
  const projector = device(await slide(t('projector.png'), `theme=plain&palette=&appearance=#${SLIDE.draw}`, { width: 1600, height: 900 }, 'deck.html'), { width: 1180, bezel: 14, radius: 12 })
  webp('drawing.webp', '-size', '1800x1080', `xc:${BACKGROUND}`, projector, '-geometry', '+30+20', '-composite', tablet, '-geometry', '+990+450', '-composite')
  console.log('wrote drawing.webp')

  // Polls: the slide with live results as phones vote, and one of the phones.
  const config = baseConfig(deck)
  dev = await createServer({ ...config, plugins: [...config.plugins, livePlugin()], server: { ...config.server, port: 0, host: '127.0.0.1' }, logLevel: 'silent' })
  await dev.listen()
  const base = dev.resolvedUrls.local[0]
  // As with mdeck run --network, so the slide shows its QR code; the address
  // is only printed.
  dev.resolvedUrls.network = ['http://10.0.0.12:5173/']
  const screen = await browser.open(new URL(`?view=deck&theme=neue&palette=&appearance=#${SLIDE.poll}`, base).href)
  await until(screen, "!!document.querySelector('[data-deck-active] .poll-dot.is-live')", 600)
  const phone = await browser.open(new URL(`__mdeck/live/${CODE}`, base).href)
  await until(phone, "document.querySelectorAll('.answer-options button').length === 4")
  await phone.evaluate("document.querySelectorAll('.answer-options button')[1].click()")
  const votes = { 'Drawing on slides': 11, 'Polls from phones': 9, 'Citations': 5, 'A new theme': 7 }
  let n = 0
  for (const [value, count] of Object.entries(votes)) for (let i = value === 'Polls from phones' ? 1 : 0; i < count; i++) {
    await fetch(new URL(`__mdeck/live/rooms/${CODE}.first`, base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: `phone-${++n}`, data: { value } }) })
    await delay(40)
  }
  await until(screen, "[...document.querySelectorAll('[data-deck-active] .poll-count')].map(e => e.textContent).join() === '11,9,5,7'")
  await delay(800)
  const results = device(await shot(screen, t('poll-screen.png'), { width: 1600, height: 900 }), { width: 1300, bezel: 14, radius: 12 })
  await until(phone, "document.querySelector('.answer-status')?.textContent.includes('Polls from phones')")
  const handset = device(await shot(phone, t('poll-phone.png'), { width: 390, height: 780, scale: 2 }), { width: 330, bezel: 14, radius: 44 })
  webp('polls.webp', '-size', '1800x1000', `xc:${BACKGROUND}`, results, '-geometry', '+30+30', '-composite', handset, '-geometry', '+1380+250', '-composite')
  console.log('wrote polls.webp')

  // Live code: the code slide after Run, with its output.
  const code = await browser.open(`plain.html?embedded=1&theme=neue&palette=&appearance=#${SLIDE.code}`)
  await code.waitForDeck()
  await code.screenshot({ width: 1600, height: 900 })
  await code.evaluate("document.querySelector('[data-deck-active] .code-btn--run').click()")
  // Python's runtime downloads the first time.
  await until(code, "/Drawing, Polls, Citations, Themes/.test(document.querySelector('[data-deck-active] .code-output')?.textContent ?? '')", 1200)
  await delay(500)
  webp('code.webp', device(await shot(code, t('code.png'), { width: 1600, height: 900 }), { width: 1600, bezel: 14, radius: 12 }), '-bordercolor', BACKGROUND, '-border', '30', '-background', BACKGROUND, '-flatten')
  console.log('wrote code.webp')

  // Sending: the reader view on a laptop, and Read mode on a phone.
  const reader = await browser.open('plain.html?view=reader&theme=neue&palette=&appearance=#1')
  await until(reader, "!!document.querySelector('.reader-view')")
  await delay(1500)
  const laptop = device(await shot(reader, t('reader.png'), { width: 1440, height: 900 }), { width: 1300, bezel: 14, radius: 12 })
  const read = await browser.open(`plain.html?view=reader&theme=neue&palette=&appearance=#${SLIDE.cite}`)
  await until(read, "!!document.querySelector('.reader-view')")
  await delay(1500)
  const mobile = device(await shot(read, t('read.png'), { width: 390, height: 780, scale: 2 }), { width: 330, bezel: 14, radius: 44 })
  webp('reader.webp', '-size', '1800x1000', `xc:${BACKGROUND}`, laptop, '-geometry', '+30+40', '-composite', mobile, '-geometry', '+1380+230', '-composite')
  console.log('wrote reader.webp')

  // Hotspots: the presenter view at the tour's hotspot slide with its keys,
  // in front of the projector zoomed in on the table.
  cpSync(resolve(root, 'examples/showcase'), t('tour'), { recursive: true })
  const tourConfig = baseConfig(t('tour/slides.en.md'))
  tour = await createServer({ ...tourConfig, plugins: [...tourConfig.plugins, livePlugin()], server: { ...tourConfig.server, port: 0, host: '127.0.0.1' }, logLevel: 'silent' })
  await tour.listen()
  const tourBase = tour.resolvedUrls.local[0]
  const presenter = await browser.open(new URL('?view=presenter&theme=neue&palette=&appearance=', tourBase).href)
  await until(presenter, "!!document.querySelector('iframe')?.contentDocument?.querySelector('deck-stage')", 600)
  await presenter.screenshot({ width: 1440, height: 900 })
  await delay(1500)
  const stage = "document.querySelector('iframe').contentDocument.querySelector('deck-stage')"
  const hotspotSlide = await presenter.evaluate(`[...${stage}.querySelectorAll(':scope > section:not([data-extra-page])')].findIndex(s => s.dataset.slideId === 'zoom-in-on-a-part')`)
  for (let i = 0; i < 60 && await presenter.evaluate(`${stage}.index`) < hotspotSlide; i++) {
    await presenter.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Next').click(); true")
    await delay(150)
  }
  await until(presenter, `${stage}.index === ${hotspotSlide} && ${stage}.shadowRoot.querySelectorAll('.hotspot').length === 3`)
  await delay(800)
  const keys = device(await shot(presenter, t('presenter.png'), { width: 1440, height: 900 }), { width: 880, bezel: 14, radius: 12 })
  const audience = await browser.open(new URL('?view=deck&embedded=1&theme=neue&palette=&appearance=#zoom-in-on-a-part', tourBase).href)
  await audience.waitForDeck()
  await audience.screenshot({ width: 1600, height: 900 })
  await delay(1500)
  await audience.evaluate("document.querySelector('deck-stage').zoomToHotspot(2); true")
  await delay(1500)
  await audience.evaluate("document.querySelector('deck-stage').shadowRoot.querySelector('.zoom-reset')?.style.setProperty('display', 'none'); true")
  const zoomed = device(await shot(audience, t('zoomed.png'), { width: 1600, height: 900 }), { width: 1180, bezel: 14, radius: 12 })
  webp('hotspots.webp', '-size', '1800x1080', `xc:${BACKGROUND}`, zoomed, '-geometry', '+30+20', '-composite', keys, '-geometry', '+830+450', '-composite')
  console.log('wrote hotspots.webp')

  // Languages: the Python example's first code slide in each of its languages.
  const languages = ['en', 'de', 'hi', 'fa']
  const spoken = []
  for (const lang of languages) {
    execFileSync(process.execPath, [resolve(root, 'bin/mdeck.js'), 'build', resolve(root, `examples/python/slides.${lang}.md`), '-o', t(`python-${lang}.html`)], { cwd: root, stdio: 'pipe' })
    spoken.push(await slide(t(`python-${lang}.png`), 'appearance=#4', { width: 1280, height: 720 }, `python-${lang}.html`))
  }
  const pair = files => ['(', ...files.flatMap(file => ['(', file, '-resize', '880x', '-bordercolor', BACKGROUND, '-border', '10', ')']), '+append', ')']
  webp('languages.webp', ...pair(spoken.slice(0, 2)), ...pair(spoken.slice(2)), '-append', '-bordercolor', BACKGROUND, '-border', '10')
  console.log('wrote languages.webp')

  // The theme picker under the docs' example deck: its chart slide in each
  // built-in theme, small.
  const example = resolve(root, 'docs/site/examples/first-talk.md')
  execFileSync(process.execPath, [resolve(root, 'bin/mdeck.js'), 'build', example, '-o', t('example.html')], { cwd: root, stdio: 'pipe' })
  for (const theme of Object.keys(loadRegistry(example).themes)) {
    const thumb = await slide(t(`thumb-${theme}.png`), `theme=${theme}&palette=&appearance=#${SLIDE.draw}`, { width: 1280, height: 720 }, 'example.html')
    magick(thumb, '-resize', '320x180', '-quality', '84', resolve(root, `docs/site/images/themes/${theme}-thumb.webp`))
  }
  console.log('wrote the theme thumbnails')
} finally {
  await browser?.close()
  await dev?.close()
  await tour?.close()
  rmSync(temp, { recursive: true, force: true })
}
