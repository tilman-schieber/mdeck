// Drawing on a deck window: connects a <deck-stage> with an ink controller
// and the floating toolbar. D starts and ends drawing, Escape ends it,
// Cmd/Ctrl+Z undoes, Cmd/Ctrl+Shift+Z redoes, Delete removes the selection.
import { h, render } from 'preact'
import { strokePath } from '../../core/ink.js'
import { createInkController, readLog } from './controller.js'
import { changeInk } from './store.js'
import { createInkBus, broadcastTransport } from './bus.js'
import { InkToolbar } from './Toolbar.jsx'
import { connectInkServer, followInkFile } from './server.js'
import { createInkSelection } from './select.js'

const typing = target => target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')

const channelName = storageKey => `mdeck-ink-live:${storageKey}`

/** A window that only shows the ink others draw, such as the audience window. */
export function watchInk(stage, { storageKey, transports = [] } = {}) {
  stage.inkRenderer = strokePath
  for (const op of readLog(storageKey)) changeInk(op)
  // Served by `mdeck run`: the saved changes and slides that got an id.
  followInkFile()
  return createInkBus(stage, [broadcastTransport(channelName(storageKey)), ...transports])
}

export function attachInk(stage, { storageKey, save = null, keys = true, transports = [], onMode = () => {} } = {}) {
  stage.inkRenderer = strokePath
  const bus = createInkBus(stage, [broadcastTransport(channelName(storageKey)), ...transports])
  const controller = createInkController({ storageKey, save, publish: op => bus.op(op) })
  // Saving through `mdeck run` when it lets this page; otherwise in this browser.
  if (!save) connectInkServer(controller)
  stage.addEventListener('inkstroke', event => { controller.addStroke(event.detail); bus.strokeDone(event.detail) })
  stage.addEventListener('inklaser', event => bus.laserDone(event.detail))
  stage.addEventListener('inkerase', event => controller.erase(event.detail))
  const selection = createInkSelection(stage, controller)

  const host = document.createElement('div')
  host.className = 'ink-toolbar-host'
  document.body.appendChild(host)
  const done = () => { stage.inking = false }
  const showToolbar = on => render(on ? h(InkToolbar, { stage, controller, selection, onDone: done }) : null, host)
  stage.setAttribute('data-ink-enabled', '')
  stage.addEventListener('inkmode', event => {
    showToolbar(event.detail.inking)
    document.documentElement.classList.toggle('is-inking', event.detail.inking)
    onMode(event.detail.inking)
  })

  if (keys) {
    window.addEventListener('keydown', event => {
      if (typing(event.target)) return
      const mod = event.metaKey || event.ctrlKey
      if (!mod && !event.altKey && (event.key === 'd' || event.key === 'D')) {
        event.preventDefault()
        stage.inking = !stage.inking
      } else if (event.key === 'Escape' && stage.inking) {
        stage.inking = false
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && stage.inking && selection.count() > 0) {
        event.preventDefault()
        selection.remove()
      } else if (mod && (event.key === 'z' || event.key === 'Z') && stage.inking) {
        event.preventDefault()
        if (event.shiftKey) controller.redo()
        else controller.undo()
      }
    })
  }
  return controller
}
