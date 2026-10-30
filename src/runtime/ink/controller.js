// Drawing on a deck: turns the stage's ink events into changes of the ink,
// with undo and redo of this device's own changes; `publish(op)` passes each
// change on to the other windows (bus.js). Every change goes to
// `save(op)` when a server keeps the ink file; otherwise it is kept in this
// browser (localStorage) and the file can be downloaded.
import { currentInk, changeInk, slideStrokes, resolveSlideId } from './store.js'
import { hitTest, serializeInk } from '../../core/ink.js'
import { inkFileName } from 'virtual:deck-ink'

function deviceId() {
  try {
    let id = localStorage.getItem('mdeck-ink-device')
    if (!id) localStorage.setItem('mdeck-ink-device', id = Math.random().toString(36).slice(2, 8))
    return id
  } catch { return (deviceId.fallback ??= Math.random().toString(36).slice(2, 8)) }
}

export const readLog = key => { try { return JSON.parse(localStorage.getItem(key) ?? '[]') } catch { return [] } }
const writeLog = (key, log) => { try { localStorage.setItem(key, JSON.stringify(log)); return true } catch { return false } }

export function createInkController({ storageKey, save = null, publish = () => {} } = {}) {
  const device = deviceId()
  let counter = 0
  const undoStack = [], redoStack = []
  const listeners = new Set()
  const notify = () => { for (const listener of listeners) listener(state()) }
  let saving = save

  // Changes made in this browser without a server, from earlier visits too.
  let log = saving ? [] : readLog(storageKey)
  for (const op of log) changeInk(op)

  const state = () => ({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, unsaved: !saving && log.length > 0, saving: !!saving })

  function send(ops) {
    // Another window of this deck may have added to the log meanwhile.
    if (!saving) log = readLog(storageKey)
    for (const raw of ops) {
      // The undo of a stroke that gave its slide an id names the old id; the
      // server and the other windows only know the slide by its new one.
      const op = raw.slideId ? { ...raw, slideId: resolveSlideId(raw.slideId) } : raw
      changeInk(op)
      publish(op)
      if (saving) saving(op)
      else log.push(op)
    }
    if (!saving) writeLog(storageKey, log)
  }

  // A history entry is the list of changes that undoes it. Changes with the
  // same `gesture` (one stroke of the eraser) are one entry.
  function commit(ops, inverse, gesture = null) {
    if (!ops.length) return
    send(ops)
    const last = undoStack[undoStack.length - 1]
    if (gesture != null && last?.gesture === gesture) {
      last.ops.push(...ops)
      last.inverse.unshift(...inverse)
    } else undoStack.push({ ops, inverse, gesture })
    redoStack.length = 0
    notify()
  }

  return {
    device,
    subscribe(listener) { listeners.add(listener); listener(state()); return () => listeners.delete(listener) },
    /** Changes kept in this browser, not saved anywhere yet. */
    localChanges: () => log.slice(),
    /** Tells the other windows about a change already made here (a slide's new id). */
    share(op) { publish(op) },
    /** Sends a change without adding it to the undo history. */
    replay(op) { send([op]) },
    /** From here on, changes go to `save(op)` and the local copy is dropped. */
    useServer(saveOp) {
      saving = saveOp
      log = []
      try { localStorage.removeItem(storageKey) } catch {}
      notify()
    },

    // The stroke keeps every point the pen gave: perfect-freehand draws
    // fewer points differently, and the saved stroke would move away from
    // the one just drawn when the pen lifts.
    addStroke({ slideId, tool, color, size, points }) {
      const stroke = { id: `${device}:${Date.now().toString(36)}${(counter++).toString(36)}`, tool, color, size, points }
      commit([{ type: 'add', slideId, stroke }], [{ type: 'remove', slideId, ids: [stroke.id] }])
    },

    erase({ slideId, point, radius, gesture = null }) {
      const hits = slideStrokes(slideId).filter(stroke => hitTest(stroke, point, radius))
      if (!hits.length) return
      commit([{ type: 'remove', slideId, ids: hits.map(stroke => stroke.id) }], hits.map(stroke => ({ type: 'add', slideId, stroke })), gesture == null ? null : `erase:${gesture}`)
    },

    /** Puts changed copies of strokes (the same ids) in place of the originals: moving a selection. */
    replaceStrokes({ slideId, before, after }) {
      if (!after.length) return
      commit(after.map(stroke => ({ type: 'add', slideId, stroke })), before.map(stroke => ({ type: 'add', slideId, stroke })))
    },

    removeStrokes({ slideId, strokes }) {
      if (!strokes.length) return
      commit([{ type: 'remove', slideId, ids: strokes.map(stroke => stroke.id) }], strokes.map(stroke => ({ type: 'add', slideId, stroke })))
    },

    clearSlide(slideId) {
      const strokes = slideStrokes(slideId)
      if (!strokes.length) return
      commit([{ type: 'clear', slideId, ids: strokes.map(stroke => stroke.id) }], strokes.map(stroke => ({ type: 'add', slideId, stroke })))
    },

    undo() {
      const entry = undoStack.pop()
      if (!entry) return
      send(entry.inverse)
      redoStack.push(entry)
      notify()
    },

    redo() {
      const entry = redoStack.pop()
      if (!entry) return
      send(entry.ops)
      undoStack.push(entry)
      notify()
    },

    /** Saves the ink as its file, for putting it next to the deck. */
    download() {
      const blob = new Blob([serializeInk(currentInk())], { type: 'application/json' })
      const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: inkFileName })
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    },
  }
}
