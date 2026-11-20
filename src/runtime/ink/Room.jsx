import { h, Fragment } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { pageLayer, ROOM_SCALE } from '../../core/ink.js'
import { useSlidePages, useRoomOpen, useRoomPage } from './store.js'
import { InkLayer } from './InkLayer.jsx'

// Room to write (core/ink.js), in two kinds. An expanded slide is the slide
// seen from further away: the stage shows it small in the top left corner,
// with room around it, and what is written there is the slide's own ink. A
// blank page follows its slide and has ink of its own.

/**
 * A slide's blank pages are its last steps on the stage: each covers the
 * slide, and forward and back turn them like slides. When one comes or goes
 * while the slide is shown, the stage counts the steps again (stepsChanged).
 */
export function PageSteps({ id }) {
  const pages = useSlidePages(id)
  const anchor = useRef()
  const had = useRef(pages)
  useEffect(() => {
    if (had.current === pages) return
    had.current = pages
    anchor.current?.closest('deck-stage')?.stepsChanged?.()
  }, [pages])
  return <>
    <span ref={anchor} hidden />
    {pages.map(page => <div key={page} class="slide-page" data-step data-page={page}><InkLayer slideId={pageLayer(id, page)} /></div>)}
  </>
}

/**
 * On the stage: the room behind the slides and, above them, the expanded
 * slide's ink, which reaches beyond the slide. Both are children of
 * <deck-stage> in slots of their own; the stage shows them while the slide
 * is expanded (setExpanded), and this tells it when that is.
 */
export function StageRoom() {
  const ref = useRef()
  const [shown, setShown] = useState({ id: null, page: null })
  const open = useRoomOpen(shown.id) && !shown.page
  useEffect(() => {
    const stage = ref.current?.closest('deck-stage')
    if (!stage) return
    const update = () => setShown(was => {
      const now = { id: stage.inkBaseSlideId?.() ?? null, page: stage.pageShown ?? null }
      return was.id === now.id && was.page === now.page ? was : now
    })
    update()
    const events = ['slidechange', 'statechange', 'stepschange']
    for (const type of events) stage.addEventListener(type, update)
    return () => { for (const type of events) stage.removeEventListener(type, update) }
  }, [])
  // Expanding and closing are shown as a move; arriving on a slide or
  // turning to one of its pages is not.
  const last = useRef(null)
  useEffect(() => {
    ref.current?.closest('deck-stage')?.setExpanded?.(open, { animate: last.current === shown })
    last.current = shown
  }, [open, shown])
  // The room's ink is drawn while the slide is expanded, and on its way back.
  const [drawn, setDrawn] = useState(open)
  useEffect(() => {
    if (open) { setDrawn(true); return }
    const timer = setTimeout(() => setDrawn(false), 300)
    return () => clearTimeout(timer)
  }, [open])
  return <>
    <div ref={ref} class="deck-room" slot="room" aria-hidden="true" />
    <div class="deck-room-ink" slot="room-ink" aria-hidden="true">{shown.id && (open || drawn) && <InkLayer slideId={shown.id} room />}</div>
  </>
}

/**
 * In print, PDFs and the reader's Read mode, what does not fit on the slide
 * follows it as pages of their own: the expanded slide with what was written
 * around it, then its blank pages. On the stage they are no slides
 * (deck-stage leaves out [data-extra-page]). `copy` is the slide rendered
 * once more; `wrap` puts each page into the reader's frame.
 */
export function ExtraPages({ id, copy, width, height, wrap = page => page }) {
  const room = useRoomPage(id)
  const pages = useSlidePages(id)
  return <>
    {room && wrap(<section key="room" class="slide extra-page" data-extra-page data-room-page>
      <div class="room-copy" style={{ width: `${width * ROOM_SCALE}px`, height: `${height * ROOM_SCALE}px` }}>
        <div class="room-scale" style={{ width: `${width}px`, height: `${height}px`, transform: `scale(${ROOM_SCALE})` }}>
          <div class="slide-copy" data-slide-copy data-deck-static inert aria-hidden="true">{copy}</div>
        </div>
      </div>
      <InkLayer slideId={id} room />
    </section>, 'room')}
    {pages.map(page => wrap(<section key={page} class="slide extra-page" data-extra-page><InkLayer slideId={pageLayer(id, page)} /></section>, page))}
  </>
}
