import { h } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { Icon } from '../../components/Icon.jsx'
import { inkPaint } from '../../core/ink.js'
import { roomOpen, slidePages, slideStrokes, onInkChange } from './store.js'
import './toolbar.css'

// The floating ink toolbar: colours and sizes of the pen and the highlighter
// (each keeps its own; one pen colour is the theme's accent), first, so the
// tools after them stay in place; the tools; deleting a selection; undo/redo,
// clear slide, room to write (expanding the slide, a blank page after it),
// hide saved ink, drawing with a finger, and the drawings file.
// Every button is always there, so none moves when the tool changes. Swipes and the deck's own controls and keys
// turn the slides. It folds into one button in the bottom right corner,
// showing the current tool, and drawing goes on while it is folded. It drives
// a <deck-stage> (inkTool, inkFinger, data-ink-hidden), an ink controller and
// the selection.

// "accent" is stored as the word and drawn in the theme's --accent, so the
// drawing follows the palette (inkPaint in core/ink.js).
export const INK_COLORS = ['#e11d48', '#2563eb', '#16a34a', 'accent', '#111111']
export const HIGHLIGHTER_COLORS = ['#ffeb3b', '#76ff03', '#ff4081', '#40c4ff', '#ff9100']
const COLORS = { pen: INK_COLORS, highlighter: HIGHLIGHTER_COLORS }
const COLOR_NAMES = { '#e11d48': 'Red', '#2563eb': 'Blue', '#16a34a': 'Green', accent: 'Accent', '#111111': 'Text colour',
  '#ffeb3b': 'Yellow', '#76ff03': 'Green', '#ff4081': 'Pink', '#40c4ff': 'Blue', '#ff9100': 'Orange' }
const SIZES = { pen: [3, 6, 12], highlighter: [18, 30, 48] }
// Each tool's icon has the tool's name.
const TOOLS = [
  ['pen', 'Pen'],
  ['highlighter', 'Highlighter'],
  ['select', 'Select and move'],
  ['laser', 'Laser pointer'],
  ['eraser', 'Eraser'],
]

// A small popover above the button that opened it, with a question and its
// answers. It does not dim anything. While open it takes the keys, so the
// deck behind it does not turn slides; Escape or a tap elsewhere cancels, and
// focus stays inside. `choices`: [{ label, onClick, danger }]; `cancel`
// false leaves out the Cancel button (the button that opened it closes it).
function Popover({ message, choices, onCancel, cancel = true }) {
  const cancelRef = useRef(null)
  const popRef = useRef(null)
  useEffect(() => {
    const pop = popRef.current
    // Keep it on screen when the button sits near an edge of a narrow window.
    const rect = pop.getBoundingClientRect()
    const shift = Math.max(8 - rect.left, Math.min(0, innerWidth - 8 - rect.right))
    pop.style.setProperty('--shift', `${Math.round(shift)}px`)
    const opener = document.activeElement
    const first = cancelRef.current ?? pop.querySelector('button')
    first?.focus()
    const onKey = event => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); onCancel() }
      else if (event.key === 'Tab') {
        const items = [...pop.querySelectorAll('button')]
        const at = items.indexOf(document.activeElement)
        event.preventDefault()
        items[(at + (event.shiftKey ? items.length - 1 : 1)) % items.length].focus()
      }
    }
    const onDown = event => { if (!pop.parentElement.contains(event.target)) onCancel() }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
      opener?.focus?.()
    }
  }, [])
  return <div class="ink-pop" ref={popRef} role="alertdialog" aria-label={message}>
    <span class="ink-pop-text">{message}</span>
    {cancel && <button type="button" class="ink-pop-btn" ref={cancelRef} onClick={onCancel}>Cancel</button>}
    {choices.map(({ label, onClick, danger }) => <button type="button" key={label} class={`ink-pop-btn${danger ? ' is-danger' : ''}`} onClick={onClick}>{label}</button>)}
  </div>
}

export function InkToolbar({ stage, controller, selection, onDone }) {
  const [tool, setTool] = useState(TOOLS.some(([id]) => id === stage.inkTool?.tool) ? stage.inkTool.tool : 'pen')
  const [style, setStyle] = useState(() => ({ pen: { color: INK_COLORS[0], sizeIndex: 1 }, highlighter: { color: HIGHLIGHTER_COLORS[0], sizeIndex: 1 }, ...stage._inkStyle }))
  const [selected, setSelected] = useState(0)
  const [collapsed, setCollapsed] = useState(!!stage._inkCollapsed)
  const [hidden, setHidden] = useState(stage.hasAttribute('data-ink-hidden'))
  const [finger, setFinger] = useState(!!stage.inkFinger)
  const [clearing, setClearing] = useState(null) // what awaits confirmation: { layer, id, page }
  // The pen or the highlighter whose colours and sizes the bar shows: the
  // one in use, or the last one used; a colour or size picks it again.
  const [writer, setWriter] = useState(COLORS[tool] ? tool : 'pen')
  useEffect(() => { if (COLORS[tool]) setWriter(tool) }, [tool])
  const [history, setHistory] = useState({ canUndo: false, canRedo: false, unsaved: false })

  useEffect(() => controller.subscribe(setHistory), [controller])
  useEffect(() => selection?.subscribe(setSelected), [selection])
  useEffect(() => {
    const { color, sizeIndex } = style[tool] ?? style.pen
    stage.inkTool = { tool, color, size: (SIZES[tool] ?? SIZES.pen)[sizeIndex] }
    // Remembered while the page is open, when drawing starts again.
    stage._inkStyle = style
    stage.setAttribute('data-ink-tool', tool)
    if (tool !== 'select') selection?.clear()
  }, [tool, style])
  const setOwn = change => { setTool(writer); setStyle(all => ({ ...all, [writer]: { ...all[writer], ...change } })) }
  useEffect(() => { stage._inkCollapsed = collapsed }, [collapsed])
  useEffect(() => { stage.setInkHidden(hidden, 'toolbar') }, [hidden])
  useEffect(() => { stage.inkFinger = finger }, [finger])

  const slideId = () => stage._inkSlideId?.()

  // Room to write (ink/Room.jsx). What the stage shows: the slide, the blank
  // page of it on the screen if any, and whether the slide is expanded.
  const where = () => { const id = stage.inkBaseSlideId?.() ?? null; return { id, page: stage.pageShown ?? null, open: !!id && roomOpen(id) } }
  const [at, setAt] = useState(where)
  useEffect(() => {
    const update = () => setAt(was => { const now = where(); return was.id === now.id && was.page === now.page && was.open === now.open ? was : now })
    const events = ['slidechange', 'statechange', 'stepschange']
    for (const type of events) stage.addEventListener(type, update)
    const off = onInkChange(update)
    return () => { for (const type of events) stage.removeEventListener(type, update); off() }
  }, [])
  // The new page comes after what is on the screen: the slide, or one of its pages.
  const addPage = () => {
    const { id, page } = where()
    if (!id) return
    const added = controller.addPage(id, page ? slidePages(id).indexOf(page) + 1 : 0)
    // It is on the slide once the slide has drawn it.
    const show = (tries = 30) => { if (!stage.showPage(added, 'click') && tries > 0) setTimeout(() => show(tries - 1), 20) }
    show()
  }
  const removePage = ({ id, page }) => { stage.prev('click'); controller.removePage(id, page) }
  const button = (label, icon, action, { active = false, disabled = false } = {}) =>
    <button type="button" class={`ink-btn${active ? ' is-active' : ''}`} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={action}><Icon name={icon} size={20} /></button>

  // A stage with data-ink-reserve (the iPad's presenter view) gives the open
  // toolbar a strip of its own below the slide, and takes it back when the
  // toolbar is folded. The toolbar is a little smaller there.
  const reserve = stage.hasAttribute('data-ink-reserve')
  const barRef = useRef(null)
  useLayoutEffect(() => {
    const bar = barRef.current
    if (!reserve || !bar) return
    const fit = () => { stage.style.bottom = collapsed ? '' : `${Math.ceil(window.innerHeight - bar.getBoundingClientRect().top) + 4}px` }
    fit()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
    observer?.observe(bar)
    window.addEventListener('resize', fit)
    return () => { observer?.disconnect(); window.removeEventListener('resize', fit); stage.style.bottom = '' }
  }, [collapsed, reserve])
  const compact = reserve ? ' is-compact' : ''

  const writing = !!COLORS[tool]
  if (collapsed) {
    const [, label] = TOOLS.find(([id]) => id === tool)
    return <div ref={barRef} class={`ink-toolbar is-collapsed${compact}`} role="toolbar" aria-label="Ink" data-ink-ui>
      <button type="button" class="ink-btn ink-expand" title={`${label}: show the toolbar`} aria-label={`${label}: show the toolbar`} style={writing ? { '--tool-color': inkPaint(style[tool].color) } : {}} onClick={() => setCollapsed(false)}><Icon name={tool} size={20} /></button>
    </div>
  }
  return <div ref={barRef} class={`ink-toolbar${compact}`} role="toolbar" aria-label="Ink" data-ink-ui>
    <div class={`ink-group${writing ? '' : ' is-idle'}`}>
      {COLORS[writer].map(value => <button type="button" key={value} class={`ink-color${value === style[writer].color ? ' is-active' : ''}`} style={{ '--swatch': inkPaint(value) }} title={COLOR_NAMES[value] ?? value} aria-label={`Colour ${COLOR_NAMES[value] ?? value}`} aria-pressed={writing && value === style[writer].color} onClick={() => setOwn({ color: value })} />)}
    </div>
    <div class={`ink-group${writing ? '' : ' is-idle'}`}>
      {[0, 1, 2].map(i => <button type="button" key={i} class={`ink-size${i === style[writer].sizeIndex ? ' is-active' : ''}`} title={['Thin', 'Medium', 'Thick'][i]} aria-label={['Thin', 'Medium', 'Thick'][i]} aria-pressed={writing && i === style[writer].sizeIndex} onClick={() => setOwn({ sizeIndex: i })}><span style={{ width: `${6 + i * 5}px`, height: `${6 + i * 5}px` }} /></button>)}
    </div>
    <div class="ink-group">
      {TOOLS.map(([id, label]) => button(label, id, () => setTool(id), { active: tool === id }))}
      {button('Delete selection (Delete)', 'trash', () => selection.remove(), { disabled: !selected })}
    </div>
    <div class="ink-group">
      {button('Undo', 'undo', () => controller.undo(), { disabled: !history.canUndo })}
      {button('Redo', 'redo', () => controller.redo(), { disabled: !history.canRedo })}
      <span class="ink-anchor">
        {button(at.page ? 'Clear or remove this page' : 'Clear this slide', 'clear', () => { const id = slideId(); setClearing(open => open || !id ? null : { layer: id, ...where() }) })}
        {clearing && <Popover
          message={!clearing.page ? 'Clear this slide?' : slideStrokes(clearing.layer).length ? 'This page and what is written on it:' : 'Remove this page?'}
          choices={[
            ...(!clearing.page || slideStrokes(clearing.layer).length ? [{ label: 'Clear', danger: true, onClick: () => { controller.clearSlide(clearing.layer); setClearing(null) } }] : []),
            ...(clearing.page ? [{ label: 'Remove page', danger: true, onClick: () => { removePage(clearing); setClearing(null) } }] : []),
          ]}
          onCancel={() => setClearing(null)}
        />}
      </span>
    </div>
    <div class="ink-group">
      {button(at.open ? 'Show the slide whole again' : 'Expand: room to write around this slide', 'room', () => controller.setRoom(at.id, !at.open), { active: at.open && !at.page, disabled: !at.id || !!at.page })}
      {button(at.page ? 'Blank page after this one' : 'Blank page after this slide', 'page', addPage, { disabled: !at.id })}
    </div>
    <div class="ink-group">
      {button(hidden ? 'Show saved ink' : 'Hide saved ink', hidden ? 'eye-off' : 'eye', () => setHidden(!hidden), { active: hidden })}
      {button(finger ? 'Fingers draw (on)' : 'Fingers draw (off: fingers swipe and select)', 'finger', () => setFinger(!finger), { active: finger })}
      {!history.saving && button(history.unsaved ? 'Download the drawings file (changes are only in this browser)' : 'Download the drawings file', 'download', () => controller.download(), { active: history.unsaved })}
    </div>
    <div class="ink-group">
      {button('Fold the toolbar', 'fold', () => setCollapsed(true))}
      {button('Stop drawing (D)', 'close', onDone)}
    </div>
  </div>
}
