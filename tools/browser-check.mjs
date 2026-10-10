// Real-browser regression check, driven over the DevTools protocol by the same
// helper that renders PDFs. Uses a local Chrome; set MDECK_CHROME to override.
//   npm run test:browser
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { launchChrome } from '../src/build/chrome.js'
import { baseConfig } from '../src/build/config.js'
import { homePlugin } from '../src/build/homePlugin.js'
import { livePlugin } from '../src/live/server.js'
import { sessionCode } from '../src/live/code.js'
import { parseSlides } from '../src/core/parseSlides.js'
import { inkPlugin } from '../src/build/inkPlugin.js'
import { resultsPlugin } from '../src/build/resultsPlugin.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temp = mkdtempSync(resolve(tmpdir(), 'mdeck-browser-check-'))
let browser, dev, pollDev, inkDev, stageDev, videoDev, tablet2
try {
  execFileSync(process.execPath, ['bin/mdeck.js', 'build', 'examples/custom-layouts/slides.md', '-o', resolve(temp, 'deck.html')], { cwd: root, stdio: 'pipe' })
  browser = await launchChrome({ dir: temp, timeout: 45000 })
  const open = path => browser.open(path)
  async function until(page, expression) {
    if (!await page.waitFor(expression, { attempts: 150, interval: 50 })) throw new Error(`Condition did not become true: ${expression}`)
  }
  // Drawing starts with the laser; strokes need the pen. `doc` is the
  // document with the stage (the presenter view's frame).
  async function choosePen(page, doc = 'document') {
    // A touch screen starts with the toolbar folded.
    await page.evaluate(`${doc}.querySelector('.ink-expand')?.click()`)
    await until(page, `!!${doc}.querySelector('.ink-btn[title=Pen]')`)
    assert.equal(await page.evaluate(`${doc}.querySelector('deck-stage').inkTool.tool`), 'laser', 'drawing starts with the laser')
    await page.evaluate(`${doc}.querySelector('.ink-btn[title=Pen]').click()`)
    await until(page, `${doc}.querySelector('deck-stage').inkTool.tool === 'pen'`)
  }

  // A hosted reader keeps media separate and removes the notes themselves.
  const hostedDeck = resolve(temp, 'hosted.md')
  writeFileSync(hostedDeck, '---\ntheme: neue\n---\n\n---\nid: first\n---\n# Hosted\n\n![Photo](./reader-photo.svg)\n\n:::notes\nPRIVATE_READER_NOTES\n![Private](./private-notes.svg)\n:::\n')
  writeFileSync(resolve(temp, 'reader-photo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')
  writeFileSync(resolve(temp, 'private-notes.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><text fill="var(--accent)">PRIVATE_NOTES_SVG_CONTENT</text></svg>')
  writeFileSync(resolve(temp, 'hosted.ink.json'), '{}')
  const hosted = resolve(temp, 'hosted/index.html')
  execFileSync(process.execPath, ['bin/mdeck.js', 'build', hostedDeck, '--reader', '--no-drawings', '-o', hosted], { cwd: root, stdio: 'pipe' })
  assert.ok(!readFileSync(hosted, 'utf8').includes('PRIVATE_READER_NOTES'))
  assert.ok(!readFileSync(hosted, 'utf8').includes('PRIVATE_NOTES_SVG_CONTENT'), 'notes-only themed SVG markup is not bundled into public output')
  assert.ok(existsSync(resolve(temp, 'hosted/reader-photo.svg')))
  assert.equal(existsSync(resolve(temp, 'hosted/private-notes.svg')), false, 'notes-only media is not copied into public output')
  const reader = await open('hosted/index.html')
  await until(reader, "!!document.querySelector('.reader-view')")
  await reader.evaluate("Object.defineProperty(navigator.clipboard, 'writeText', { value: async text => { window.__copied = text } }); [...document.querySelectorAll('.reader-bottom button')].find(b => b.textContent.includes('Copy')).click()")
  await until(reader, '!!window.__copied')
  const copied = await reader.evaluate('window.__copied')
  assert.equal(new URL(copied).searchParams.get('view'), 'reader')
  assert.equal(new URL(copied).hash, '#first')
  const reopened = await open(copied)
  await until(reopened, "!!document.querySelector('.reader-view')")
  const oldAddress = await open('hosted/index.html?v=s&design=neue')
  await until(oldAddress, "!!document.querySelector('[role=alert] a')")
  assert.equal(await oldAddress.evaluate("new URL(document.querySelector('[role=alert] a').href).searchParams.get('view')"), 'reader')
  execFileSync(process.execPath, ['bin/mdeck.js', 'build', hostedDeck, '--reader', '--notes', '--no-drawings', '-o', resolve(temp, 'with-notes.html')], { cwd: root, stdio: 'pipe' })
  assert.ok(readFileSync(resolve(temp, 'with-notes.html'), 'utf8').includes('PRIVATE_READER_NOTES'))
  assert.ok(readFileSync(resolve(temp, 'with-notes.html'), 'utf8').includes('PRIVATE_NOTES_SVG_CONTENT'), '--notes preserves themed SVGs referenced by the notes')

  // Saved ink from <deck>.drawings.json is bundled and drawn in the deck and in Read mode.
  const inkDeck = resolve(temp, 'ink.md')
  writeFileSync(inkDeck, '---\ntheme: neue\n---\n\n---\nid: marked\n---\n# Marked up\n\n---\n# Second\n')
  writeFileSync(resolve(temp, 'ink.drawings.json'), JSON.stringify({ version: 1, width: 1920, height: 1080, slides: { marked: [{ id: 'check:1', tool: 'pen', color: '#e11d48', size: 8, points: [[200, 300, 0.4], [600, 320, 0.8], [900, 280, 0.6]] }] } }))
  execFileSync(process.execPath, ['bin/mdeck.js', 'build', inkDeck, '-o', resolve(temp, 'ink.html')], { cwd: root, stdio: 'pipe' })
  const inked = await open('ink.html?view=deck')
  await until(inked, "document.querySelectorAll('.slide-ink path').length === 1")
  // Drawing: D starts ink mode, a pen stroke becomes saved ink on the same
  // slide, and undo takes it back.
  await inked.evaluate("document.querySelector('deck-stage').inking = true")
  await until(inked, "!!document.querySelector('.ink-toolbar')")
  await choosePen(inked)
  const rect = await inked.evaluate("(() => { const r = document.querySelector('deck-stage').getBoundingClientRect(); return [r.left, r.top, r.width, r.height] })()")
  const at = f => [rect[0] + rect[2] * f[0], rect[1] + rect[3] * f[1]]
  const pen = { button: 'left', pointerType: 'pen', force: 0.6 }
  await inked.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at([0.2, 0.6])[0], y: at([0.2, 0.6])[1], clickCount: 1, buttons: 1, ...pen })
  for (let i = 1; i <= 10; i++) { const [x, y] = at([0.2 + 0.07 * i, 0.6]); await inked.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 1, ...pen }) }
  await inked.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at([0.9, 0.6])[0], y: at([0.9, 0.6])[1], clickCount: 1, buttons: 0, ...pen })
  await until(inked, "document.querySelectorAll('.slide-ink path').length === 2")
  assert.equal(await inked.evaluate("document.querySelector('deck-stage').index"), 0, 'drawing does not change slides')
  await inked.evaluate("document.querySelector('.ink-btn[title=Undo]').click()")
  await until(inked, "document.querySelectorAll('.slide-ink path').length === 1")
  const inkRead = await open('ink.html?view=reader')
  await until(inkRead, "[...document.querySelectorAll('.reader-btn')].some(b => b.textContent.includes('Read'))")
  await inkRead.evaluate("[...document.querySelectorAll('.reader-btn')].find(b => b.textContent.includes('Read')).click()")
  await until(inkRead, "document.querySelectorAll('.reader-read .slide-ink path').length === 1")

  // Drawing in the presenter view: Draw turns on the main frame's ink mode,
  // and the audience window shows the stroke while it is drawn and after.
  const inkPresenter = await open('ink.html?view=presenter')
  const inkFrame = "document.querySelector('iframe')?.contentWindow?.document"
  await until(inkPresenter, `${inkFrame}?.querySelectorAll('.slide-ink path').length === 1`)
  await delay(200)
  const inkSession = await inkPresenter.evaluate("new URL(location.href).searchParams.get('session')")
  const inkAudience = await open('ink.html?view=audience&session=' + inkSession)
  await until(inkAudience, "document.querySelectorAll('.slide-ink path').length === 1")
  await inkPresenter.evaluate("document.querySelector('.presenter-draw').click()")
  await until(inkPresenter, "document.querySelector('.presenter-draw').getAttribute('aria-pressed') === 'true'")
  await choosePen(inkPresenter, inkFrame)
  const frameBox = await inkPresenter.evaluate(`(() => { const f = document.querySelector('iframe').getBoundingClientRect(), r = ${inkFrame}.querySelector('deck-stage').getBoundingClientRect(); return [f.left + r.left, f.top + r.top, r.width, r.height] })()`)
  const inFrame = ([fx, fy]) => ({ x: frameBox[0] + frameBox[2] * fx, y: frameBox[1] + frameBox[3] * fy })
  await inkPresenter.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...inFrame([0.2, 0.3]), clickCount: 1, buttons: 1, ...pen })
  for (let i = 1; i <= 6; i++) await inkPresenter.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...inFrame([0.2 + 0.05 * i, 0.3]), buttons: 1, ...pen })
  await until(inkAudience, "document.querySelector('deck-stage').shadowRoot.querySelectorAll('.ink-live path').length === 1")
  await inkPresenter.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...inFrame([0.5, 0.3]), clickCount: 1, buttons: 0, ...pen })
  await until(inkAudience, "document.querySelectorAll('.slide-ink path').length === 2 && document.querySelector('deck-stage').shadowRoot.querySelectorAll('.ink-live path').length === 0")

  // On a touch screen (an iPad): a deck window does not draw until asked, and
  // a tap on the right or left third moves the slides. While drawing, fingers
  // still operate the deck (a swipe moves the slides, a tap selects a stroke)
  // and draw only when switched on; the presenter view opens with the slide
  // filling the screen and drawing on.
  const tablet = await open('ink.html?view=deck')
  await tablet.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await until(tablet, "document.querySelectorAll('.slide-ink path').length === 2")
  assert.equal(await tablet.evaluate("document.querySelector('deck-stage').inking"), false, 'a touch screen deck window does not start drawing')
  {
    const width = await tablet.evaluate('innerWidth')
    const tap = async x => { await tablet.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: 300, radiusX: 4, radiusY: 4, force: 0.5, id: 1 }] }); await tablet.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
    await tap(width - 40)
    await until(tablet, "document.querySelector('deck-stage').index === 1")
    await tap(40)
    await until(tablet, "document.querySelector('deck-stage').index === 0")
    // The pencil touching the deck turns drawing on, without moving the slides.
    const middle = { x: width / 2, y: 300, clickCount: 1, ...pen }
    await tablet.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...middle, buttons: 1 })
    await tablet.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...middle, buttons: 0 })
    await until(tablet, "document.querySelector('deck-stage').inking === true")
    assert.equal(await tablet.evaluate("document.querySelector('deck-stage').index"), 0, 'the first pencil touch does not change slides')
  }
  await until(tablet, "!!document.querySelector('.ink-toolbar')")
  await choosePen(tablet)
  const tabletStage = "document.querySelector('deck-stage')"
  const finger = (type, x, y) => tablet.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 4, radiusY: 4, force: 0.5, id: 1 }] })
  const fingerStroke = async () => {
    await finger('touchStart', 300, 300)
    for (let i = 1; i < 8; i++) await finger('touchMove', 300 + i * 30, 300 + i * 8)
    await finger('touchEnd')
  }
  await fingerStroke()
  await delay(200)
  assert.equal(await tablet.evaluate("document.querySelectorAll('.slide-ink path').length"), 2, 'a finger does not draw')
  assert.equal(await tablet.evaluate(`${tabletStage}.index`), 0, 'a finger stroke does not change slides')
  const swipe = async (from, to) => {
    await finger('touchStart', from, 300)
    for (let i = 1; i <= 4; i++) await finger('touchMove', from + (to - from) * i / 4, 300)
    await finger('touchEnd'); await delay(100)
  }
  await swipe(500, 300)
  await until(tablet, `${tabletStage}.index === 1`)
  await swipe(300, 500)
  await until(tablet, `${tabletStage}.index === 0`)
  assert.equal(await tablet.evaluate(`${tabletStage}.inking`), true, 'swiping through slides keeps drawing on')
  const width = await tablet.evaluate('innerWidth')
  await finger('touchStart', width - 40, 420); await finger('touchEnd'); await delay(200)
  assert.equal(await tablet.evaluate(`${tabletStage}.index`), 0, 'a tap while drawing does not change slides')
  await tablet.evaluate(`${tabletStage}.inkFinger = true`)
  await fingerStroke()
  await until(tablet, "document.querySelectorAll('.slide-ink path').length === 3")
  assert.equal(await tablet.evaluate(`${tabletStage}.index`), 0, 'a drawing finger does not change slides')
  await tablet.evaluate(`${tabletStage}.inkFinger = false`)

  // Select and move: a pen lasso around the finger's stroke selects it,
  // dragging moves it, undo puts it back.
  const pathBox = "(() => { const b = [...document.querySelectorAll('.slide-ink path')].at(-1).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top)] })()"
  const before = await tablet.evaluate(pathBox)
  const tabletPen = async (type, x, y) => tablet.send('Input.dispatchMouseEvent', { type, x, y, clickCount: 1, buttons: type === 'mouseReleased' ? 0 : 1, ...pen })

  // Holding the pen still at the end straightens a wobbly stroke.
  const lastPathHeight = "Math.round([...document.querySelectorAll('.slide-ink path')].at(-1).getBoundingClientRect().height)"
  await tabletPen('mousePressed', 300, 120)
  for (let i = 1; i <= 12; i++) await tabletPen('mouseMoved', 300 + i * 20, 120 + (i % 2 ? 30 : -30))
  await delay(800)
  // Released 3.6° below horizontal: the line snaps to 0°, a 15° step.
  await tabletPen('mouseReleased', 540, 135)
  await until(tablet, "document.querySelectorAll('.slide-ink path').length === 4")
  assert.ok(await tablet.evaluate(lastPathHeight) < 10, 'the held stroke became a straight, horizontal line')
  // A finger's tap selects the straight line; the pen moves one of its ends.
  const lastPathBox = "(() => { const b = [...document.querySelectorAll('.slide-ink path')].at(-1).getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round) })()"
  await finger('touchStart', 420, 120); await finger('touchEnd'); await delay(200)
  await until(tablet, "!!document.querySelector('.ink-btn[title^=\"Delete selection\"]') && document.querySelector('deck-stage').shadowRoot.querySelectorAll('.ink-handle').length === 2")
  const [, , right] = await tablet.evaluate(lastPathBox)
  await tabletPen('mousePressed', right - 4, 120)
  for (let i = 1; i <= 6; i++) await tabletPen('mouseMoved', right - 4, 120 + i * 25)
  await tabletPen('mouseReleased', right - 4, 270)
  await until(tablet, `(${lastPathBox})[3] > 250`)
  assert.equal(await tablet.evaluate("document.querySelectorAll('.slide-ink path').length"), 4, 'moving an end point draws nothing new')
  await tablet.evaluate("document.querySelector('.ink-btn[title=Undo]').click()")
  await until(tablet, `(${lastPathBox})[3] < 200`)
  await tablet.evaluate("document.querySelector('.ink-btn[title=Undo]').click()")
  await until(tablet, "document.querySelectorAll('.slide-ink path').length === 3")
  await tablet.evaluate("document.querySelector('.ink-btn[title=\"Select and move\"]').click()")
  await until(tablet, `${tabletStage}.inkTool.tool === 'select'`)
  const lasso = [[270, 260], [560, 260], [560, 380], [270, 380], [270, 262]]
  await tabletPen('mousePressed', ...lasso[0])
  for (const [x, y] of lasso.slice(1)) await tabletPen('mouseMoved', x, y)
  await tabletPen('mouseReleased', ...lasso.at(-1))
  await until(tablet, "!!document.querySelector('.ink-btn[title^=\"Delete selection\"]')")
  await tabletPen('mousePressed', 400, 330)
  for (let i = 1; i <= 5; i++) await tabletPen('mouseMoved', 400, 330 + i * 20)
  await tabletPen('mouseReleased', 400, 430)
  await until(tablet, `(${pathBox})[1] >= ${before[1] + 90}`)
  await tablet.evaluate("document.querySelector('.ink-btn[title=Undo]').click()")
  await until(tablet, `(${pathBox})[1] === ${before[1]}`)

  // The laser: a trail on its own layer that stays while the pen is down and
  // retracts once it is lifted, never saved. Frames only run in the visible tab.
  await tablet.send('Page.bringToFront')
  await tablet.evaluate("document.querySelector('.ink-btn[title=\"Laser pointer\"]').click()")
  await until(tablet, `${tabletStage}.inkTool.tool === 'laser'`)
  const laserPixels = `(() => { const c = ${tabletStage}.shadowRoot.querySelector('.ink-laser'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n })()`
  await tabletPen('mousePressed', 300, 200)
  for (let i = 1; i <= 8; i++) await tabletPen('mouseMoved', 300 + i * 30, 200)
  await until(tablet, `${laserPixels} > 0`)
  await delay(1600)
  assert.ok(await tablet.evaluate(`${laserPixels} > 0`), 'the laser trail stays while the pen is down')
  await tabletPen('mouseReleased', 540, 200)
  await until(tablet, `${laserPixels} === 0`)
  assert.equal(await tablet.evaluate("document.querySelectorAll('.slide-ink path').length"), 3, 'the laser is not saved')

  // Zoom: two fingers enlarge the slide itself, not the toolbar; one finger
  // moves the zoomed slide; the audience window shows the same part; the
  // reset button shows the whole slide again.
  const toolbarWidth = "Math.round(document.querySelector('.ink-toolbar').getBoundingClientRect().width)"
  const barBefore = await tablet.evaluate(toolbarWidth)
  const touches = (type, points) => tablet.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 0.5 })) })
  await touches('touchStart', [[300, 220], [400, 220]])
  for (let i = 1; i <= 6; i++) await touches('touchMove', [[300 - i * 15, 220], [400 + i * 15, 220]])
  await touches('touchEnd', [])
  await until(tablet, `${tabletStage}.zoom.scale > 1.8`)
  assert.equal(await tablet.evaluate(toolbarWidth), barBefore, 'the toolbar keeps its size')
  assert.equal(await tablet.evaluate(`${tabletStage}.index`), 0, 'a pinch does not change slides')
  await until(inkAudience, `document.querySelector('deck-stage').zoom.scale > 1.8`)
  const zoomX = await tablet.evaluate(`${tabletStage}.zoom.x`)
  await finger('touchStart', 400, 220)
  for (let i = 1; i <= 5; i++) await finger('touchMove', 400 - i * 20, 220)
  await finger('touchEnd')
  await until(tablet, `${tabletStage}.zoom.x > ${zoomX + 10}`)
  assert.equal(await tablet.evaluate(`${tabletStage}.index`), 0, 'moving a zoomed slide does not change slides')
  await tablet.evaluate(`${tabletStage}.shadowRoot.querySelector('.zoom-reset').click()`)
  await until(tablet, `${tabletStage}.zoom.scale === 1`)
  await until(inkAudience, `document.querySelector('deck-stage').zoom.scale === 1`)

  // The toolbar folds into one button in the corner; the pen keeps drawing.
  await tablet.evaluate("document.querySelector('.ink-btn[title=\"Fold the toolbar\"]').click()")
  await until(tablet, "document.querySelectorAll('.ink-toolbar button').length === 1 && document.querySelector('.ink-toolbar.is-collapsed')")
  await tablet.evaluate("document.querySelector('.ink-expand').click()")
  await until(tablet, "!!document.querySelector('.ink-btn[title=\"Fold the toolbar\"]')")
  const tabletPresenter = await open('about:blank')
  await tabletPresenter.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await tabletPresenter.send('Page.navigate', { url: new URL('ink.html?view=presenter', await tablet.evaluate('location.href')).href })
  await until(tabletPresenter, "!!document.querySelector('.presenter--slide .presenter-pill') && getComputedStyle(document.querySelector('.presenter-aside')).display === 'none'")
  // In the presenter view on a touch screen drawing is on from the start: the laser, the toolbar folded.
  const tabletFrame = "document.querySelector('iframe')?.contentWindow?.document"
  await until(tabletPresenter, `${tabletFrame}?.querySelector('deck-stage')?.inking === true && !!${tabletFrame}.querySelector('.ink-toolbar.is-collapsed')`)
  assert.equal(await tabletPresenter.evaluate(`${tabletFrame}.querySelector('deck-stage').inkTool.tool`), 'laser')
  await until(tabletPresenter, "document.querySelector('.presenter-draw').getAttribute('aria-pressed') === 'true'")
  await tabletPresenter.evaluate("document.querySelector('.presenter-notes').click()")
  await until(tabletPresenter, "getComputedStyle(document.querySelector('.presenter-aside')).display === 'flex'")

  const presenter = await open('deck.html?view=presenter')
  const stage = "document.querySelector('iframe')?.contentWindow?.document.querySelector('deck-stage')"
  await until(presenter, `${stage}?.length === 2`)
  // Let Preact install the presenter's event listeners.
  await delay(200)
  const session = await presenter.evaluate("new URL(location.href).searchParams.get('session')")
  assert.ok(session)
  const audience = await open('deck.html?view=audience&session=' + session)
  const other = await open('deck.html?view=audience&session=another-session')
  const audienceStage = "document.querySelector('deck-stage')"
  await until(audience, `${audienceStage}?.length === 2`)
  await until(other, `${audienceStage}?.length === 2`)
  assert.equal(await audience.evaluate("document.querySelector('.slide--comparison [data-region=left]')?.textContent.includes('Directory bundle')"), true)
  await presenter.evaluate(`${stage}.goTo(1); ${stage}.next()`)
  await until(audience, `${audienceStage}.state.index === 1 && ${audienceStage}.state.step === 0`)
  assert.equal(await audience.evaluate("document.querySelectorAll('[data-step-visible]').length"), 1)
  assert.equal(await other.evaluate(`${audienceStage}.state.index`), 0)
  await presenter.evaluate(`${stage}.prev()`)
  await until(audience, `${audienceStage}.state.step === -1`)
  await presenter.evaluate(`${stage}.reset()`)
  await until(audience, `${audienceStage}.state.index === 0`)
  await audience.evaluate(`${audienceStage}.goTo(1); ${audienceStage}.next()`)
  await until(presenter, `${stage}.state.index === 1 && ${stage}.state.step === 0`)
  await audience.evaluate(`${audienceStage}.prev()`)
  await until(presenter, `${stage}.state.step === -1`)
  // Both directions, quickly and many times: a message that arrives late
  // must never take a window back (src/runtime/syncOrder.js). One round
  // alone missed such a race most of the time.
  const position = async page => JSON.stringify(await page.evaluate(`${page === presenter ? stage : audienceStage}.state`))
  for (let round = 0; round < 15; round++) {
    for (const [from, act, to, expected] of [
      [presenter, `${stage}.goTo(1); ${stage}.next()`, audience, `${audienceStage}.state.index === 1 && ${audienceStage}.state.step === 0`],
      [presenter, `${stage}.reset()`, audience, `${audienceStage}.state.index === 0`],
      [audience, `${audienceStage}.goTo(1); ${audienceStage}.next()`, presenter, `${stage}.state.index === 1 && ${stage}.state.step === 0`],
      [audience, `${audienceStage}.prev()`, presenter, `${stage}.state.step === -1`],
      [audience, `${audienceStage}.reset()`, presenter, `${stage}.state.index === 0`],
    ]) {
      await from.evaluate(act)
      if (!await to.waitFor(expected, { attempts: 150, interval: 50 })) throw new Error(`Round ${round + 1}: after ${act} on one side the other did not follow; presenter ${await position(presenter)}, audience ${await position(audience)}`)
    }
  }
  // Back to where the checks below start: the second slide, nothing revealed.
  await presenter.evaluate(`${stage}.goTo(1)`)
  await until(audience, `${audienceStage}.state.index === 1 && ${audienceStage}.state.step === -1`)
  await presenter.evaluate(`${stage}.next()`)
  await until(audience, `${audienceStage}.state.step === 0`)
  assert.equal(await other.evaluate(`${audienceStage}.state.index`), 0, 'audience navigation stays in its presenter session')

  // Saving in dev: the first stroke gives the slide an id from its heading and
  // writes <deck>.drawings.json, without reloading the open windows.
  const saveDeck = resolve(temp, 'save.md')
  writeFileSync(saveDeck, '---\ntheme: neue\n---\n\n---\n# The important part\n\n---\n# Second\n')
  const saveConfig = baseConfig(saveDeck)
  inkDev = await createServer({ ...saveConfig, plugins: [...saveConfig.plugins, livePlugin(), inkPlugin(saveDeck)], server: { ...saveConfig.server, port: 0, host: '127.0.0.1' }, logLevel: 'silent' })
  await inkDev.listen()
  const drawing = await open(new URL('?view=deck', inkDev.resolvedUrls.local[0]).href)
  await until(drawing, "document.querySelector('deck-stage')?.length === 2")
  await delay(500)
  await drawing.evaluate('window.__sameDocument = true; document.querySelector("deck-stage").inking = true')
  await choosePen(drawing)
  const box = await drawing.evaluate("(() => { const r = document.querySelector('deck-stage').getBoundingClientRect(); return [r.left, r.top, r.width, r.height] })()")
  const on = ([fx, fy]) => ({ x: box[0] + box[2] * fx, y: box[1] + box[3] * fy })
  await drawing.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...on([0.2, 0.5]), clickCount: 1, buttons: 1, ...pen })
  for (let i = 1; i <= 10; i++) await drawing.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...on([0.2 + 0.05 * i, 0.5]), buttons: 1, ...pen })
  await drawing.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...on([0.7, 0.5]), clickCount: 1, buttons: 0, ...pen })
  await until(drawing, "document.querySelector('[data-deck-active]')?.dataset.slideId === 'the-important-part'")
  await delay(800)
  assert.match(readFileSync(saveDeck, 'utf8'), /id: the-important-part/)
  assert.ok(existsSync(resolve(temp, 'save.drawings.json')), 'the ink file is written')
  assert.equal(await drawing.evaluate('window.__sameDocument === true'), true, 'saving does not reload the page')
  await drawing.evaluate('location.reload()')
  await until(drawing, "document.querySelectorAll('[data-deck-active] .slide-ink path').length === 1")

  // Following on another device (?view=follow): it goes with the presenter,
  // never past what the presenter has shown, pages back on its own and comes
  // back with "Back to live".
  const followStage = "document.querySelector('deck-stage')"
  const follower = await open(new URL('?view=follow', inkDev.resolvedUrls.local[0]).href)
  await until(follower, `${followStage}?.length === 2`)
  await drawing.evaluate(`${followStage}.goTo(0)`)
  await until(follower, `${followStage}.state.index === 0 && document.querySelector('.follow-bar')?.textContent === 'Live'`)
  await follower.evaluate(`${followStage}.next('keyboard')`)
  await delay(300)
  assert.equal(await follower.evaluate(`${followStage}.state.index`), 0, 'a follower cannot go past the presenter')
  await drawing.evaluate(`${followStage}.goTo(1)`)
  await until(follower, `${followStage}.state.index === 1`)
  await follower.evaluate(`${followStage}.prev('keyboard')`)
  await until(follower, `${followStage}.state.index === 0 && !!document.querySelector('button.follow-bar')`)
  await follower.evaluate("document.querySelector('button.follow-bar').click()")
  await until(follower, `${followStage}.state.index === 1 && document.querySelector('.follow-bar').textContent === 'Live'`)

  // Two devices through the stage room: a presenter view in another browser
  // (the iPad) moves and draws; this browser's audience window follows.
  tablet2 = await launchChrome({ dir: temp, timeout: 45000 })
  const inkBase = inkDev.resolvedUrls.local[0]
  const projector2 = await open(new URL('?view=audience&session=room-check', inkBase).href)
  await until(projector2, "document.querySelector('deck-stage')?.length === 2")
  const ipad = await tablet2.open(new URL('?view=presenter', inkBase).href)
  const ipadFrame = "document.querySelector('iframe')?.contentWindow?.document"
  await until(ipad, `${ipadFrame}?.querySelector('deck-stage')?.length === 2`)
  await delay(500)
  await ipad.evaluate(`${ipadFrame}.querySelector('deck-stage').next()`)
  await until(projector2, "document.querySelector('deck-stage').index === 1")
  await ipad.evaluate("document.querySelector('.presenter-draw').click()")
  await until(ipad, "document.querySelector('.presenter-draw').getAttribute('aria-pressed') === 'true'")
  await choosePen(ipad, ipadFrame)
  const ipadBox = await ipad.evaluate(`(() => { const f = document.querySelector('iframe').getBoundingClientRect(), r = ${ipadFrame}.querySelector('deck-stage').getBoundingClientRect(); return [f.left + r.left, f.top + r.top, r.width, r.height] })()`)
  const onIpad = ([fx, fy]) => ({ x: ipadBox[0] + ipadBox[2] * fx, y: ipadBox[1] + ipadBox[3] * fy })
  await ipad.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...onIpad([0.2, 0.6]), clickCount: 1, buttons: 1, ...pen })
  for (let i = 1; i <= 8; i++) { await ipad.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...onIpad([0.2 + 0.05 * i, 0.6]), buttons: 1, ...pen }); await delay(30) }
  await until(projector2, "document.querySelector('deck-stage').shadowRoot.querySelectorAll('.ink-live path').length === 1")
  await ipad.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...onIpad([0.6, 0.6]), clickCount: 1, buttons: 0, ...pen })
  await until(projector2, "document.querySelectorAll('[data-deck-active] .slide-ink path').length === 1 && document.querySelector('deck-stage').shadowRoot.querySelectorAll('.ink-live path').length === 0")
  // More strokes, the laser and the zoom follow too, not only the first stroke.
  const ipadStroke = async y => {
    await ipad.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...onIpad([0.2, y]), clickCount: 1, buttons: 1, ...pen })
    for (let i = 1; i <= 8; i++) { await ipad.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...onIpad([0.2 + 0.05 * i, y]), buttons: 1, ...pen }); await delay(30) }
    await ipad.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...onIpad([0.6, y]), clickCount: 1, buttons: 0, ...pen })
  }
  await delay(300)
  await ipadStroke(0.45)
  await until(projector2, "document.querySelectorAll('[data-deck-active] .slide-ink path').length === 2")
  await delay(300)
  await ipadStroke(0.5)
  await until(projector2, "document.querySelectorAll('[data-deck-active] .slide-ink path').length === 3")
  await ipad.evaluate(`${ipadFrame}.querySelector('.ink-btn[title="Laser pointer"]').click()`)
  await until(ipad, `${ipadFrame}.querySelector('deck-stage').inkTool.tool === 'laser'`)
  await ipad.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...onIpad([0.3, 0.4]), clickCount: 1, buttons: 1, ...pen })
  for (let i = 1; i <= 8; i++) { await ipad.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...onIpad([0.3 + 0.03 * i, 0.4]), buttons: 1, ...pen }); await delay(30) }
  await until(projector2, "document.querySelector('deck-stage')._lasers.size > 0")
  await delay(1600)
  assert.ok(await projector2.evaluate("[...document.querySelector('deck-stage')._lasers.values()].some(entry => entry.points.length > 1)"), 'the projector keeps the trail while the iPad pen is down')
  await ipad.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...onIpad([0.54, 0.4]), clickCount: 1, buttons: 0, ...pen })
  await until(projector2, "document.querySelector('deck-stage')._lasers.size === 0")
  await ipad.evaluate(`${ipadFrame}.querySelector('deck-stage').setZoom({ scale: 2, x: 600, y: 400 })`)
  await until(projector2, "document.querySelector('deck-stage').zoom.scale === 2")

  // A video file played, paused or moved on the iPad does the same on the
  // projector, which plays it (silently, with a sound button, if nobody has
  // clicked it yet); the iPad's own copy goes silent while the projector
  // shows the deck.
  const videoDeck = resolve(temp, 'video.md')
  copyFileSync(resolve(root, 'tests/fixtures/video/clip.webm'), resolve(temp, 'clip.webm'))
  writeFileSync(videoDeck, '---\ntheme: neue\n---\n\n---\n# A clip\n\n<videoplayer src="./clip.webm" />\n')
  const videoConfig = baseConfig(videoDeck)
  // The deck's own files, as mdeck run serves them.
  videoDev = await createServer({ ...videoConfig, publicDir: temp, plugins: [...videoConfig.plugins, livePlugin(), inkPlugin(videoDeck)], server: { ...videoConfig.server, port: 0, host: '127.0.0.1' }, logLevel: 'silent' })
  await videoDev.listen()
  const videoBase = videoDev.resolvedUrls.local[0]
  const videoScreen = await open(new URL('?view=audience&session=video-check', videoBase).href)
  await until(videoScreen, "document.querySelector('[data-deck-active] video')?.readyState >= 1")
  const videoIpad = await tablet2.open(new URL('?view=presenter', videoBase).href)
  const videoOnIpad = `${ipadFrame}?.querySelector('[data-deck-active] video')`
  await until(videoIpad, `${videoOnIpad}?.readyState >= 1`)
  await until(videoIpad, `${ipadFrame}.querySelector('deck-stage').hasAttribute('data-others-watching')`)
  const projectorVideo = "document.querySelector('[data-deck-active] video')"
  await videoIpad.evaluate(`(() => { const video = ${videoOnIpad}; video.muted = true; video.currentTime = 4; return video.play().then(() => true) })()`)
  await until(videoScreen, `!${projectorVideo}.paused && Math.abs(${projectorVideo}.currentTime - 4) < 1.5`)
  assert.equal(await videoScreen.evaluate(`${projectorVideo}.muted === !!document.querySelector('.video-player-sound')`), true, 'a projector that may not start sound plays silently and offers it')
  await videoIpad.evaluate(`${videoOnIpad}.pause()`)
  await until(videoScreen, `${projectorVideo}.paused`)
  await videoIpad.evaluate(`(${videoOnIpad}).currentTime = 9`)
  await until(videoScreen, `${projectorVideo}.paused && Math.abs(${projectorVideo}.currentTime - 9) < 0.5`)
  // Without a server (a built folder), the presenter view learns from the
  // audience window in the same browser that it is there: its own copy is
  // silent, and the audience window plays.
  execFileSync(process.execPath, ['bin/mdeck.js', 'build', videoDeck, '-o', resolve(temp, 'video-built/index.html')], { cwd: root, stdio: 'pipe' })
  const builtAudience = await open('video-built/index.html?view=audience')
  await until(builtAudience, `${projectorVideo}?.readyState >= 1`)
  const builtPresenter = await open('video-built/index.html?view=presenter')
  const builtFrame = "document.querySelector('iframe')?.contentWindow?.document"
  await until(builtPresenter, `${builtFrame}?.querySelector('[data-deck-active] video')?.readyState >= 1`)
  await until(builtPresenter, `${builtFrame}.querySelector('deck-stage').hasAttribute('data-others-watching')`)
  // A click in each window, as before a talk: a page may start sound only after one.
  await builtAudience.send('Runtime.evaluate', { expression: 'document.body.click()', userGesture: true })
  await builtPresenter.send('Runtime.evaluate', { expression: `${builtFrame}.querySelector('[data-deck-active] video').play()`, userGesture: true, awaitPromise: true })
  await until(builtAudience, `!${projectorVideo}.paused`)
  assert.equal(await builtPresenter.evaluate(`${builtFrame}.querySelector('[data-deck-active] video').muted`), true, 'the presenter view plays silently while the audience window shows the deck')
  assert.equal(await builtAudience.evaluate(`${projectorVideo}.muted`), false, 'the audience window plays the sound')
  await builtAudience.close()
  await until(builtPresenter, `!${builtFrame}.querySelector('deck-stage').hasAttribute('data-others-watching')`)

  // With a standalone server for the polls (controls passed on with its
  // key), the stage room stays on mdeck run: here the server cannot be
  // reached at all, and the projector still follows the iPad's slide and
  // strokes.
  const stageDeck = resolve(temp, 'stage.md')
  writeFileSync(stageDeck, '---\ntheme: neue\nserver: http://127.0.0.1:9/live\n---\n\n---\nid: one\n---\n# One\n\n---\nid: two\n---\n# Two\n')
  const stageConfig = baseConfig(stageDeck, { proxyControls: true })
  const stageSession = sessionCode(parseSlides(readFileSync(stageDeck, 'utf8')).deckConfig)
  stageDev = await createServer({ ...stageConfig, plugins: [...stageConfig.plugins, livePlugin({ upstream: 'http://127.0.0.1:9/live', key: 'check-key', session: () => stageSession })], server: { ...stageConfig.server, port: 0, host: '127.0.0.1' }, logLevel: 'silent' })
  await stageDev.listen()
  const stageBase = stageDev.resolvedUrls.local[0]
  const projector3 = await open(new URL('?view=audience&session=stage-check', stageBase).href)
  await until(projector3, "document.querySelector('deck-stage')?.length === 2")
  const ipad3 = await tablet2.open(new URL('?view=presenter', stageBase).href)
  await until(ipad3, `${ipadFrame}?.querySelector('deck-stage')?.length === 2`)
  await delay(500)
  await ipad3.evaluate(`${ipadFrame}.querySelector('deck-stage').next()`)
  await until(projector3, "document.querySelector('deck-stage').index === 1")
  await ipad3.evaluate("document.querySelector('.presenter-draw').click()")
  await until(ipad3, "document.querySelector('.presenter-draw').getAttribute('aria-pressed') === 'true'")
  await choosePen(ipad3, ipadFrame)
  const box3 = await ipad3.evaluate(`(() => { const f = document.querySelector('iframe').getBoundingClientRect(), r = ${ipadFrame}.querySelector('deck-stage').getBoundingClientRect(); return [f.left + r.left, f.top + r.top, r.width, r.height] })()`)
  const on3 = ([fx, fy]) => ({ x: box3[0] + box3[2] * fx, y: box3[1] + box3[3] * fy })
  await ipad3.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...on3([0.2, 0.4]), clickCount: 1, buttons: 1, ...pen })
  for (let i = 1; i <= 8; i++) { await ipad3.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...on3([0.2 + 0.05 * i, 0.4]), buttons: 1, ...pen }); await delay(30) }
  await ipad3.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...on3([0.6, 0.4]), clickCount: 1, buttons: 0, ...pen })
  await until(projector3, "document.querySelectorAll('[data-deck-active] .slide-ink path').length === 1")

  // The launch page `mdeck run` opens renders the deck's details from its API.
  const slides = resolve(root, 'examples/custom-layouts/slides.md')
  const config = baseConfig(slides)
  dev = await createServer({ ...config, plugins: [...config.plugins, homePlugin(slides, { services: {} })], server: { ...config.server, port: 0, host: '127.0.0.1' }, logLevel: 'silent' })
  await dev.listen()
  const home = await open(new URL('home.html', dev.resolvedUrls.local[0]).href)
  await until(home, "document.querySelectorAll('.home-tile').length === 6 && [...document.querySelectorAll('.home-tile')].some(tile => tile.textContent.includes('Theme editor')) && !!document.querySelector('.home-header h1')?.textContent")
  assert.deepEqual(await home.evaluate("[...document.querySelectorAll('.home-tile strong')].slice(0, 3).map(e => e.textContent)"), ['Presenter view', 'Audience window', 'Reader view'])
  assert.equal(await home.evaluate("new URL(document.querySelector('.home-preview-open').href).searchParams.get('view')"), 'audience')
  assert.equal(await home.evaluate("document.querySelectorAll('.home-output').length"), 3)
  assert.equal(await home.evaluate("!!document.querySelector('.home-preview iframe') && !document.querySelector('.home-live')"), true, 'preview, and no polls section without a server setting')

  // Relay mode: the projector announces the poll on screen, the phone opens the
  // server's own answer page at /<code>, and its vote reaches the slide.
  const pollDeck = resolve(temp, 'poll.md')
  writeFileSync(pollDeck, '---\ntheme: neue\nlang: de\nmeta:\n  title: Poll check\nsession:\n  code: 424242\n---\n\n---\n# Lunch?\n\n<poll room="lunch" options="Mensa|Thai" />\n\n---\n# Pace?\n\n<scale room="pace" min="1" max="5" qr="false" />\n\n---\n# Anything else?\n\n<question room="ask" qr="false" />\n\n---\n# One word?\n\n<wordcloud room="mood" qr="false" />\n\n---\n# Join\n\n<qrcode join />\n\n---\n# Primes\n\n<poll room="primes" question="Which are prime?" options="2|4|5" answer="2|5" multiple buttons="letters" qr="false" />\n\n---\n# Half\n\n<numeric room="half" question="Half of $x$, for $x > 0$ and $x = 1$?" answer="1/2" qr="false" />\n\n---\n# Derivative\n\n<poll room="deriv" question="$\\frac{d}{dx} x^2$?" qr="false">\n\n- [x] $2x$\n- [ ] `a|b`\n\n</poll>\n\nAfter the poll.\n')
  const pollConfig = baseConfig(pollDeck)
  pollDev = await createServer({ ...pollConfig, plugins: [...pollConfig.plugins, livePlugin(), resultsPlugin(pollDeck)], server: { ...pollConfig.server, port: 0, host: '127.0.0.1' }, logLevel: 'silent' })
  await pollDev.listen()
  const pollBase = pollDev.resolvedUrls.local[0]
  const projector = await open(new URL('?view=deck', pollBase).href)
  await until(projector, "!!document.querySelector('.poll-dot.is-live')")
  assert.equal(await projector.evaluate("document.querySelector('.poll-join--local a')?.href"), new URL('__mdeck/live/424242', pollBase).href, 'on this computer only, a link to try the answer page')
  const phone = await open(new URL('__mdeck/live/424242', pollBase).href)
  await until(phone, "document.querySelectorAll('.answer-options button').length === 2 && document.querySelector('.answer h1')?.textContent === 'Lunch?'")
  assert.equal(await phone.evaluate("document.documentElement.lang + ' ' + getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()"), 'de #e30613', "the deck's language and look (neue's default palette, swiss)")
  await phone.evaluate("document.querySelectorAll('.answer-options button')[1].click()")
  await until(projector, "[...document.querySelectorAll('[data-deck-active] .poll-count')].map(e => e.textContent).join() === '0,1'")
  await until(phone, "document.querySelector('.answer-status').textContent.includes('Thai')")
  // The other kinds: a scale and an open question, answered on the same page.
  await projector.evaluate("document.querySelector('deck-stage').goTo(1)")
  await until(phone, "document.querySelectorAll('.answer-scale button').length === 5")
  await phone.evaluate("document.querySelectorAll('.answer-scale button')[3].click()")
  await until(projector, "[...document.querySelectorAll('[data-deck-active] .scale-count')].map(e => e.textContent).join() === '0,0,0,1,0' && document.querySelector('[data-deck-active] .scale-average').textContent.includes('4.0')")
  await projector.evaluate("document.querySelector('deck-stage').goTo(2)")
  await until(phone, "!!document.querySelector('.answer-text textarea')")
  await phone.evaluate("document.querySelector('.answer-text textarea').value = 'Does it work offline?'; document.querySelector('.answer-text button').click()")
  await until(projector, "document.querySelector('[data-deck-active] .question-cards li')?.textContent === 'Does it work offline?' && !document.querySelector('[data-deck-active] .poll-join')")
  await projector.evaluate("document.querySelector('deck-stage').goTo(3)")
  await until(phone, "!!document.querySelector('.answer-text textarea') && document.querySelector('.answer h1')?.textContent === 'One word?'")
  await phone.evaluate("document.querySelector('.answer-text textarea').value = 'fun'; document.querySelector('.answer-text button').click()")
  await until(projector, "[...document.querySelectorAll('[data-deck-active] .word-cloud text')].map(e => e.textContent).join() === 'fun'")
  await projector.evaluate("document.querySelector('deck-stage').goTo(4)")
  await until(projector, "!!document.querySelector('[data-deck-active] .poll-join-slide .poll-join')")
  // Several answers, with keys on the phone; closing and showing the answer
  // reach the phone, and a vote after closing does not count.
  await projector.evaluate("document.querySelector('deck-stage').goTo(5)")
  await until(phone, "[...document.querySelectorAll('.answer-keys button')].map(b => b.textContent).join() === 'A,B,C'")
  await phone.evaluate("document.querySelectorAll('.answer-keys button')[0].click()")
  await until(phone, "document.querySelectorAll('.answer-keys button.is-picked').length === 1")
  await phone.evaluate("document.querySelectorAll('.answer-keys button')[2].click()")
  await until(projector, "[...document.querySelectorAll('[data-deck-active] .poll-count')].map(e => e.textContent).join() === '1,0,1'")
  await until(projector, "document.querySelector('[data-deck-active] .poll-total').textContent.includes('1 von 1')")
  assert.equal(await projector.evaluate("[...document.querySelectorAll('[data-deck-active] .poll-key')].map(e => e.textContent).join()"), 'A,B,C', 'the keys before the options')
  await projector.evaluate("document.querySelector('[data-deck-active] .poll-close').click()")
  await until(phone, "document.querySelector('.answer-keys button').disabled && document.querySelector('.answer-status').textContent.includes('Geschlossen')")
  await phone.evaluate("fetch('rooms/424242.primes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'late', data: { value: ['4'] } }) })")
  await delay(400)
  assert.equal(await projector.evaluate("[...document.querySelectorAll('[data-deck-active] .poll-count')].map(e => e.textContent).join()"), '1,0,1', 'a vote after closing does not count')
  await projector.evaluate("document.querySelector('[data-deck-active] .poll-solve').click()")
  await until(phone, "document.querySelector('.answer-verdict')?.classList.contains('is-right')")
  // A number, typed: 0,5 counts as 1/2; words are refused on the phone.
  await projector.evaluate("document.querySelector('deck-stage').goTo(6)")
  await until(phone, "!!document.querySelector('.answer-number input') && !!document.querySelector('.answer h1 math')")
  await phone.evaluate("document.querySelector('.answer-number input').value = 'half'; document.querySelector('.answer-number button').click()")
  await until(phone, "document.querySelector('.answer-status').textContent.includes('Zahl')")
  await phone.evaluate("document.querySelector('.answer-number input').value = '0,5'; document.querySelector('.answer-number button').click()")
  await until(projector, "document.querySelector('[data-deck-active] .poll-label')?.textContent === '0,5' && document.querySelector('[data-deck-active] .poll-count').textContent === '1'")
  assert.equal(await projector.evaluate("!!document.querySelector('[data-deck-active] .numeric-answer')"), false, 'the answer stays hidden until it is shown')
  await projector.evaluate("document.querySelector('[data-deck-active] .poll-solve').click()")
  await until(projector, "document.querySelector('[data-deck-active] .numeric-answer')?.textContent.includes('1 richtig') && !!document.querySelector('[data-deck-active] .poll-row.is-correct')")
  await until(phone, "document.querySelector('.answer-verdict')?.classList.contains('is-right')")
  // Options written as a list in the tag: maths and a bar in code are one
  // option each, [x] is the right one, and what follows the tag stays.
  await projector.evaluate("document.querySelector('deck-stage').goTo(7)")
  await until(phone, "document.querySelectorAll('.answer-options button').length === 2 && !!document.querySelector('.answer-options button math')")
  assert.equal(await projector.evaluate("[...document.querySelectorAll('[data-deck-active] .poll-label')].length + ' ' + document.querySelector('[data-deck-active]').textContent.includes('After the poll.')"), '2 true', 'two options, and the text after the poll')
  await phone.evaluate("document.querySelectorAll('.answer-options button')[0].click()")
  await until(projector, "[...document.querySelectorAll('[data-deck-active] .poll-count')].map(e => e.textContent).join() === '1,0'")
  await projector.evaluate("document.querySelector('[data-deck-active] .poll-solve').click()")
  await until(projector, "document.querySelector('[data-deck-active] .poll-row.is-correct .poll-label')?.textContent.includes('2x')")
  await until(phone, "document.querySelector('.answer-verdict')?.classList.contains('is-right')")
  // The answers are kept beside the deck, with the phones numbered and the
  // late vote left out, and a build shows them without a server.
  const resultsFile = resolve(temp, 'poll.results.json')
  const kept = () => { try { return JSON.parse(readFileSync(resultsFile, 'utf8')).rooms } catch { return {} } }
  for (let i = 0; i < 100 && !kept().deriv; i++) await delay(50)
  const rooms = kept()
  assert.deepEqual(rooms.lunch.answers.map(answer => [answer.phone, answer.value]), [[1, 'Thai']], 'the poll kept')
  assert.deepEqual(rooms.primes.answers.map(answer => answer.value), [['2'], ['2', '5']], 'several picks kept, the late vote left out')
  assert.equal(rooms.primes.closed, true)
  assert.deepEqual(rooms.half.answers.map(answer => answer.value), ['0,5'], 'the number kept')
  assert.deepEqual(rooms.deriv.answers.map(answer => answer.value), ['$2x$'], 'a list option kept as written')
  execFileSync(process.execPath, ['bin/mdeck.js', 'build', pollDeck, '-o', resolve(temp, 'poll-built.html')], { cwd: root, stdio: 'pipe' })
  const record = await open('poll-built.html')
  await until(record, "document.querySelectorAll('[data-deck-active] .poll-count').length === 2")
  await until(record, "[...document.querySelectorAll('[data-deck-active] .poll-count')].map(e => e.textContent).join() === '0,1' && !document.querySelector('[data-deck-active] .poll-dot')")
  // A page left open in front would keep the later checks' pages in the background.
  await record.close()
  console.log('Browser checks passed: custom layout rendering, reveal/undo/reset synchronization, session isolation, launch page, poll relay, scale, open questions, word cloud and join code, several answers with keys, closing and the right answer on the phones, options as a list, numbers, results kept beside the deck and shown in a build, saved ink, drawing, drawing in the presenter view, touch (fingers swipe through slides), straight lines (snapping to 15° steps) and their end points, select and move, laser (kept while the pen is down), zoom, saving ink in dev, following on another device, a second device through the stage room, video played on the iPad playing on the projector, and in one browser without a server (also with a standalone server for the polls).')
} finally {
  await browser?.close()
  await tablet2?.close()
  await dev?.close()
  await pollDev?.close()
  await inkDev?.close()
  await stageDev?.close()
  await videoDev?.close()
  rmSync(temp, { recursive: true, force: true })
}
