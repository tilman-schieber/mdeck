import { h, render } from 'preact'
import { SlideErrorBoundary } from './SlideErrorBoundary.jsx'
import { SlideRenderer, SlideExtraPages } from '../layouts/renderSlide'
import { StageRoom } from './ink/Room.jsx'
import { stageLabels } from '../core/labels.js'
import { strokePath } from '../core/ink.js'
import { followActiveRooms } from '../live/follow.js'
import { fitDeck } from './fit.js'
import './deck-stage.js'

// The speaker notes, where the stage reads them (deck-stage.js).
export function injectSpeakerNotes(slides) {
  let tag = document.getElementById('speaker-notes')
  if (!tag) {
    tag = document.createElement('script')
    tag.id = 'speaker-notes'
    tag.type = 'application/json'
    document.body.appendChild(tag)
  }
  tag.textContent = JSON.stringify(slides.map(s => s.meta?.notes ?? ''))
}

// Renders (or re-renders) the deck stage. Slides are keyed by id so an edit to
// one slide leaves the others and the stage's position untouched.
let unfit = null
let followDeck = null
export function mountDeck({ deck, deckConfig, selection = null, editor = false }) {
  const { slides } = deck
  injectSpeakerNotes(slides)
  const seen = new Map()
  const app = (
    <deck-stage width={deckConfig.width ?? 1920} height={deckConfig.height ?? 1080} data-hotspots={String(deckConfig.hotspots ?? 'off')}>
      {/* First, so that the last slide stays the stage's last child (its print rule). */}
      <StageRoom key="#room" />
      {slides.map((slide, i) => {
        const count = (seen.get(slide.id) ?? 0) + 1
        seen.set(slide.id, count)
        const key = count > 1 ? `${slide.id}#${i}` : slide.id
        const props = { id: slide.id, regions: slide.regions, meta: slide.meta, content: slide.content, deckConfig, index: i, total: slides.length }
        // What does not fit on the slide follows it as pages in print (ink/Room.jsx).
        const extra = <SlideExtraPages key={`${key}#extra`} {...props} />
        if (!editor) return [<SlideRenderer key={key} {...props} />, extra]
        return [<SlideErrorBoundary key={key} id={slide.id} source={deck.source.slice(slide.source.start, slide.source.end)}><SlideRenderer {...props} /></SlideErrorBoundary>, extra]
      })}
    </deck-stage>
  )
  render(app, document.body)
  document.querySelector('deck-stage')?.setLabels(stageLabels())
  const stage = document.querySelector('deck-stage')
  if (stage) stage.inkRenderer = strokePath
  followDeck?.()
  followDeck = followActiveRooms(document.querySelector('deck-stage'), slides)
  // Code taller than its place scrolls; too-full slides are reported (fit.js).
  unfit?.()
  unfit = fitDeck(document.querySelector('deck-stage'))
  if (!selection) return
  // The stage re-collects its slides asynchronously after structural changes.
  setTimeout(() => {
    const stage = document.querySelector('deck-stage')
    if (stage && stage.index !== selection.index) stage.setState({ index: selection.index, slideId: selection.slideId, step: -1 })
  }, 0)
}
