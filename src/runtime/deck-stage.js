/**
 * <deck-stage> — reusable web component for HTML decks.
 *
 * Handles:
 *  (a) speaker notes — reads <script type="application/json" id="speaker-notes">
 *      and posts {slideIndexChanged: N} to the parent window on nav.
 *  (b) keyboard navigation — ←/→, PgUp/PgDn, Space, Home/End; number keys
 *      zoom to a slide's hotspots when they are on (see "Hotspots") and do
 *      nothing when they are off.
 *  (c) press R to reset to slide 0 (with a tasteful keyboard hint).
 *  (d) bottom-center overlay showing slide count + hints, fades out on idle.
 *  (e) auto-scaling — inner canvas is a fixed design size (default 1920×1080)
 *      scaled with `transform: scale()` to fit the viewport, letterboxed.
 *      Set the `noscale` attribute to render at authored size (1:1) — the
 *      PPTX exporter sets this so its DOM capture sees unscaled geometry.
 *  (f) print — `@media print` lays every slide out as its own page at the
 *      design size, so the browser's Print → Save as PDF produces a clean
 *      one-page-per-slide PDF with no extra setup. While printing, every
 *      step on every slide is revealed and the stage carries the
 *      `data-deck-static` attribute (see "Print mode" below).
 *
 * Slides are HIDDEN, not unmounted. Non-active slides stay in the DOM with
 * `visibility: hidden` + `opacity: 0`, so their state (videos, iframes,
 * form inputs, React trees) is preserved across navigation.
 *
 * Lifecycle event — the component dispatches a `slidechange` CustomEvent on
 * itself whenever the active slide changes (including the initial mount).
 * The event bubbles and composes out of shadow DOM, so you can listen on
 * the <deck-stage> element or on document:
 *
 *   document.querySelector('deck-stage').addEventListener('slidechange', (e) => {
 *     e.detail.index         // new 0-based index
 *     e.detail.previousIndex // previous index, or -1 on init
 *     e.detail.total         // total slide count
 *     e.detail.slide         // the new active slide element
 *     e.detail.previousSlide // the prior slide element, or null on init
 *     e.detail.reason        // 'init' | 'keyboard' | 'click' | 'tap' | 'api' | 'reset' | 'sync'
 *   });
 *
 * Print mode — before printing (the browser's `beforeprint`, or an explicit
 * `stage.printing = true` from the PDF renderer) the stage reveals all steps,
 * sets `data-deck-static` on itself and dispatches a `printchange` event with
 * `detail.printing`. The reader's Read mode marks its slides the same way.
 * Interactive slide code that normally waits for its slide or its steps
 * should render its finished state inside `[data-deck-static]`:
 *
 *   const finished = () => !!el.closest('[data-deck-static]');
 *   stage?.addEventListener('printchange', () => render(finished()));
 *
 * Leaving print mode restores each slide's step position.
 *
 * Persistence: none at the deck level. The host app keeps the current slide
 * in its own URL (?slide=) and re-delivers it via location.hash on load, so a
 * bare load with no hash always starts at slide 1.
 *
 * Usage:
 *   <deck-stage width="1920" height="1080">
 *     <section data-label="Title">...</section>
 *     <section data-label="Agenda">...</section>
 *   </deck-stage>
 *
 * Slides are the direct element children of <deck-stage>. Each slide is
 * automatically tagged with:
 *   - data-screen-label="NN Label"   (1-indexed, for comment flow)
 *   - data-om-validate="no_overflowing_text,no_overlapping_text,slide_sized_text"
 *
 * The stage's features live in ./stage/, one mixin each: taps and swipes,
 * ink, the laser, zoom, hotspots and the overview. This file keeps the
 * slides, their steps, the position every window follows and the controls.
 */

import { iconSvg } from '../core/icons.js';
import { slideSteps } from './steps.js';
import { stylesheet } from './stage/styles.js';
import { fullscreenAvailable, toggleFullscreen, onFullscreenChange } from './stage/fullscreen.js';
import { Taps } from './stage/taps.js';
import { Ink } from './stage/ink.js';
import { Laser } from './stage/laser.js';
import { Zoom } from './stage/zoom.js';
import { Hotspots } from './stage/hotspots.js';
import { Overview } from './stage/overview.js';

const DESIGN_W_DEFAULT = 1920;
const DESIGN_H_DEFAULT = 1080;
const OVERLAY_HIDE_MS = 1800;
const VALIDATE_ATTR = 'no_overflowing_text,no_overlapping_text,slide_sized_text';
// An embedded deck (the presenter view's frames, a preview) hides its
// controls, unless the page embedding it asks for them with ?controls=1, as
// the docs' example deck does.
const isEmbedded = new URLSearchParams(location.search).has('embedded');
const hideControls = isEmbedded && !new URLSearchParams(location.search).has('controls');

const pad2 = (n) => String(n).padStart(2, '0');

const features = [Taps, Ink, Laser, Zoom, Hotspots, Overview];

class DeckStage extends features.reduce((base, feature) => feature(base), HTMLElement) {
  static get observedAttributes() { return ['width', 'height', 'noscale']; }

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    this._index = 0;
    this._slides = [];
    this._notes = [];
    this._hideTimer = null;
    this._mouseIdleTimer = null;
    this._stepMap = new Map();

    this._onKey = this._onKey.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onSlotChange = this._onSlotChange.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    // Black screen (B), part of the position every screen follows.
    this._blank = false;
    // The join code over the slide (J), the same: shown on every screen.
    this._join = false;
    // A frozen projector (Z): the position the audience's screens keep
    // while the presenter goes on, or null. Part of the position too; only
    // a stage marked data-freezable (the audience window) stays there.
    this._freeze = null;
    this._onBeforePrint = () => { this.printing = true; };
    this._onAfterPrint = () => { this.printing = false; };
  }

  get designWidth() {
    return parseInt(this.getAttribute('width'), 10) || DESIGN_W_DEFAULT;
  }
  get designHeight() {
    return parseInt(this.getAttribute('height'), 10) || DESIGN_H_DEFAULT;
  }

  connectedCallback() {
    // Zooming is for the stage that is the page (the deck, the audience
    // window, the presenter's slide frame), not one inside the reader.
    if (this.parentElement === document.body) this.setAttribute('data-zoomable', '');
    this._render();
    this._loadNotes();
    this._syncPrintPageRule();
    window.addEventListener('keydown', this._onKey);
    if (typeof ResizeObserver !== 'undefined') { this._resizeObserver = new ResizeObserver(() => { this._fit(); this._queueHotspots(); }); this._resizeObserver.observe(this); }
    // Pictures and fonts that arrive late move the hotspots.
    this.addEventListener('load', this._queueHotspots, true);
    document.fonts?.ready?.then(this._queueHotspots);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('mousemove', this._onMouseMove, { passive: true });
    window.addEventListener('beforeprint', this._onBeforePrint);
    window.addEventListener('afterprint', this._onAfterPrint);
    // Taps and ink are read on the window, before slide content sees them.
    for (const [type, handler] of this._windowInput()) window.addEventListener(type, handler, { capture: true, passive: false });
    // Initial collection + layout happens via slotchange, which fires on mount.
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this._onKey);
    this._resizeObserver?.disconnect();
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('beforeprint', this._onBeforePrint);
    window.removeEventListener('afterprint', this._onAfterPrint);
    for (const [type, handler] of this._windowInput()) window.removeEventListener(type, handler, { capture: true });
    cancelAnimationFrame(this._laserRaf);
    this._laserRaf = 0;
    this.removeEventListener('load', this._queueHotspots, true);
    cancelAnimationFrame(this._hotspotRaf);
    this._hotspotRaf = 0;
    this._stopZoomFlight();
    if (this._hideTimer) clearTimeout(this._hideTimer);
    if (this._mouseIdleTimer) clearTimeout(this._mouseIdleTimer);
  }

  attributeChangedCallback() {
    if (this._canvas) {
      this._canvas.style.width = this.designWidth + 'px';
      this._canvas.style.height = this.designHeight + 'px';
      this._canvas.style.setProperty('--deck-design-w', this.designWidth + 'px');
      this._canvas.style.setProperty('--deck-design-h', this.designHeight + 'px');
      this._inkLive?.setAttribute('viewBox', `0 0 ${this.designWidth} ${this.designHeight}`);
      this._fit();
      this._syncPrintPageRule();
    }
  }

  _render() {
    const style = document.createElement('style');
    style.textContent = stylesheet;

    const stage = document.createElement('div');
    stage.className = 'stage';

    const canvas = document.createElement('div');
    canvas.className = 'canvas';
    canvas.style.width = this.designWidth + 'px';
    canvas.style.height = this.designHeight + 'px';
    canvas.style.setProperty('--deck-design-w', this.designWidth + 'px');
    canvas.style.setProperty('--deck-design-h', this.designHeight + 'px');

    // The room around an expanded slide, behind the slides, and its ink
    // above them (ink/Room.jsx puts them there; stage/zoom.js shows them).
    const room = document.createElement('slot');
    room.name = 'room';
    canvas.appendChild(room);
    const slot = document.createElement('slot');
    slot.addEventListener('slotchange', this._onSlotChange);
    canvas.appendChild(slot);
    const roomInk = document.createElement('slot');
    roomInk.name = 'room-ink';
    canvas.appendChild(roomInk);
    const inkLive = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    inkLive.setAttribute('class', 'ink-live');
    inkLive.setAttribute('viewBox', `0 0 ${this.designWidth} ${this.designHeight}`);
    inkLive.setAttribute('preserveAspectRatio', 'none');
    canvas.appendChild(inkLive);
    const hotspots = document.createElement('div');
    hotspots.className = 'hotspots export-hidden';
    hotspots.addEventListener('click', e => {
      const badge = e.target.closest?.('.hotspot');
      if (!badge) return;
      e.stopPropagation();
      this.zoomToHotspot(Number(badge.dataset.n));
    });
    canvas.appendChild(hotspots);
    this._hotspotLayer = hotspots;
    const ovCells = document.createElement('div');
    ovCells.className = 'ov-cells export-hidden';
    ovCells.setAttribute('data-ink-ui', '');
    ovCells.addEventListener('click', e => {
      const cell = e.target.closest?.('.ov-cell');
      if (!cell) return;
      e.stopPropagation();
      this._overviewGo(Number(cell.dataset.i), 'click');
    });
    canvas.appendChild(ovCells);
    this._ovCells = ovCells;
    stage.appendChild(canvas);
    const ovSizer = document.createElement('div');
    ovSizer.className = 'ov-sizer';
    stage.appendChild(ovSizer);
    this._ovSizer = ovSizer;
    this._stageEl = stage;

    // Only shown when fingers draw: keeps their touches from scrolling or
    // zooming. The input itself is read on the window.
    const inkInput = document.createElement('div');
    inkInput.className = 'ink-input export-hidden';
    inkInput.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    this._inkLive = inkLive;
    const inkLaser = document.createElement('canvas');
    inkLaser.className = 'ink-laser export-hidden';
    inkLaser.setAttribute('aria-hidden', 'true');
    this._inkLaser = inkLaser;
    const zoomReset = document.createElement('button');
    zoomReset.type = 'button';
    zoomReset.className = 'zoom-reset export-hidden';
    zoomReset.setAttribute('data-ink-ui', '');
    zoomReset.setAttribute('aria-label', 'Show the whole slide');
    zoomReset.title = 'Show the whole slide';
    zoomReset.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-4-4"/></svg>1:1';
    zoomReset.addEventListener('click', () => this.wholeSlide());

    // Overlay: compact, solid black, with clickable controls.
    const overlay = document.createElement('div');
    overlay.className = 'overlay export-hidden';
    overlay.setAttribute('role', 'toolbar');
    overlay.setAttribute('aria-label', 'Deck controls');
    overlay.setAttribute('data-noncommentable', '');
    overlay.innerHTML = `
      <button class="btn prev" type="button" aria-label="Previous slide" title="Previous (←)">
        ${iconSvg('prev')}
      </button>
      <span class="count" aria-live="polite"><span class="current">1</span><span class="step-progress" hidden> · <span class="step-cur">0</span>/<span class="step-total">1</span></span><span class="sep">/</span><span class="total">1</span></span>
      <button class="btn next" type="button" aria-label="Next slide" title="Next (→)">
        ${iconSvg('next')}
      </button>
      <span class="divider"></span>
      <button class="btn reset" type="button" aria-label="Reset to first slide" title="Reset (R)">Reset<span class="kbd">R</span></button>
      <button class="btn overview" type="button" aria-label="All slides" title="All slides (O)">
        ${iconSvg('overview')}
      </button>
      <button class="btn draw" type="button" aria-label="Draw on the slide" title="Draw (D)">
        ${iconSvg('pen')}
      </button>
      <button class="btn fullscreen" type="button" aria-label="Full screen" title="Full screen (F)">
        ${iconSvg('fullscreen')}
      </button>
    `;

    overlay.querySelector('.prev').addEventListener('click', () => this.prev('click'));
    overlay.querySelector('.next').addEventListener('click', () => this.next('click'));
    overlay.querySelector('.reset').addEventListener('click', () => this.reset());
    overlay.querySelector('.overview').addEventListener('click', () => { this.overview = true; });
    overlay.querySelector('.draw').addEventListener('click', () => { this.inking = !this.inking; });
    const fullscreenButton = overlay.querySelector('.fullscreen');
    fullscreenButton.addEventListener('click', () => toggleFullscreen());
    // The same button leaves full screen, and says so.
    onFullscreenChange(on => {
      this._fullscreenOn = on;
      fullscreenButton.innerHTML = iconSvg(on ? 'fullscreen-exit' : 'fullscreen');
      const label = (on ? this._labels?.exitFullscreen : this._labels?.fullscreen) || (on ? 'Exit full screen' : 'Full screen');
      fullscreenButton.title = `${label} (F)`;
      fullscreenButton.setAttribute('aria-label', label);
    });
    // Only a top-level window can go full screen (an iPhone cannot at all).
    if (window.top === window && fullscreenAvailable()) this.setAttribute('data-fullscreen-available', '');

    // Black screen: a click on it shows the slide again, except on a phone
    // that only watches the talk (data-watching, the follow view).
    const blank = document.createElement('div');
    blank.className = 'blank export-hidden';
    blank.setAttribute('data-ink-ui', '');
    blank.addEventListener('click', () => { if (!this.hasAttribute('data-watching')) this.setBlank(false, 'click'); });

    const selectionDelete = document.createElement('button');
    selectionDelete.type = 'button';
    selectionDelete.className = 'ink-selection-delete export-hidden';
    selectionDelete.setAttribute('data-ink-ui', '');
    selectionDelete.setAttribute('aria-label', 'Delete the selection');
    selectionDelete.title = 'Delete the selection';
    selectionDelete.innerHTML = iconSvg('trash', 20);
    selectionDelete.addEventListener('click', e => { e.stopPropagation(); this.inkSelectionRemove?.(); });
    this._selectionDelete = selectionDelete;

    this._root.append(style, stage, inkInput, inkLaser, zoomReset, selectionDelete, blank, overlay);
    this._canvas = canvas;
    this._slot = slot;
    this._overlay = overlay;
    this._countEl        = overlay.querySelector('.current');
    this._totalEl        = overlay.querySelector('.total');
    this._stepProgressEl = overlay.querySelector('.step-progress');
    this._stepCurEl      = overlay.querySelector('.step-cur');
    this._stepTotalEl    = overlay.querySelector('.step-total');
    this._overlay        = overlay;
    if (this._labels) this.setLabels(this._labels);
  }

  /** @page must live in the document stylesheet — it's a no-op inside
   *  shadow DOM. Inject/update a single <head> style tag so the print
   *  sheet matches the design size and Save-as-PDF yields one slide per
   *  page with no margins. */
  _syncPrintPageRule() {
    const id = 'deck-stage-print-page';
    let tag = document.getElementById(id);
    if (!tag) {
      tag = document.createElement('style');
      tag.id = id;
      document.head.appendChild(tag);
    }
    tag.textContent =
      '@page { size: ' + this.designWidth + 'px ' + this.designHeight + 'px; margin: 0; } ' +
      '@media print { html, body { margin: 0 !important; padding: 0 !important; background: none !important; overflow: visible !important; height: auto !important; } ' +
      '* { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }';
  }

  _onSlotChange() {
    // A page that follows a slide in print (ink/Room.jsx) came or went: the
    // slides are the same, and so is the position.
    const before = this._slides;
    this._collectSlides();
    if (before.length && before.length === this._slides.length && before.every((slide, i) => slide === this._slides[i])) return;
    this._restoreIndex();
    if (this._overview) this._buildOverview();
    this._applyIndex({ showOverlay: false, broadcast: true, reason: 'init' });
    this._fit();
  }

  _collectSlides() {
    const assigned = this._slot.assignedElements({ flatten: true });
    this._slides = assigned.filter((el) => {
      // Skip template/style/script nodes even if someone slots them.
      const tag = el.tagName;
      // What follows a slide as pages shows only in print (ink/Room.jsx).
      return tag !== 'TEMPLATE' && tag !== 'SCRIPT' && tag !== 'STYLE' && !el.hasAttribute('data-extra-page');
    });

    this._slides.forEach((slide, i) => {
      const n = i + 1;
      // Determine a label for comment flow: prefer explicit data-label,
      // then an existing data-screen-label, then first heading, else "Slide".
      let label = slide.getAttribute('data-label');
      if (!label) {
        const existing = slide.getAttribute('data-screen-label');
        if (existing) {
          // Strip any leading number the author may have included.
          label = existing.replace(/^\s*\d+\s*/, '').trim() || existing;
        }
      }
      if (!label) {
        const h = slide.querySelector('h1, h2, h3, [data-title]');
        if (h) label = (h.textContent || '').trim().slice(0, 40);
      }
      if (!label) label = 'Slide';
      slide.setAttribute('data-screen-label', `${pad2(n)} ${label}`);

      // Validation attribute for comment flow / auto-checks.
      if (!slide.hasAttribute('data-om-validate')) {
        slide.setAttribute('data-om-validate', VALIDATE_ATTR);
      }

      slide.setAttribute('data-deck-slide', String(i));
    });

    if (this._totalEl) this._totalEl.textContent = String(this._slides.length || 1);
    if (this._index >= this._slides.length) this._index = Math.max(0, this._slides.length - 1);
  }

  _loadNotes() {
    const tag = document.getElementById('speaker-notes');
    if (!tag) { this._notes = []; return; }
    try {
      const parsed = JSON.parse(tag.textContent || '[]');
      if (Array.isArray(parsed)) this._notes = parsed;
    } catch (e) {
      console.warn('[deck-stage] Failed to parse #speaker-notes JSON:', e);
      this._notes = [];
    }
  }

  _restoreIndex() {
    const named = this._slides.findIndex(s => '#' + encodeURIComponent(s.dataset.slideId) === location.hash);
    if (named >= 0) { this._index = named; return; }
    // The host's ?slide= param is delivered as a #<int> hash (1-indexed) on
    // the iframe src. No hash → slide 1; the deck itself keeps no position
    // state across loads.
    const h = (location.hash || '').match(/^#(\d+)$/);
    if (h) {
      const n = parseInt(h[1], 10) - 1;
      if (n >= 0 && n < this._slides.length) this._index = n;
    }
  }

  _applyIndex({ showOverlay = true, broadcast = true, reason = 'init', step = -1 } = {}) {
    if (!this._slides.length) return;
    const prev = this._prevIndex == null ? -1 : this._prevIndex;
    const curr = this._index;
    // Keep the iframe's own hash in sync so an in-iframe location.reload()
    // (reload banner path in viewer-handle.ts) lands on the current slide,
    // not the stale deep-link hash from initial load.
    try { history.replaceState(null, '', '#' + (this._slides[curr].dataset.slideId || (curr + 1))); } catch (e) {}
    this._slides.forEach((s, i) => {
      if (i === curr) s.setAttribute('data-deck-active', '');
      else s.removeAttribute('data-deck-active');
    });
    this._stepMap.delete(curr);
    if (step >= 0) this._stepMap.set(curr, step);
    this._applySteps(curr);
    // Every slide starts whole; each window does this itself.
    if (curr !== prev) {
      this._stopZoomFlight();
      this._hotspot = null;
      if (this._zoom) this.setZoom(null, 'slide', { announce: false });
    }
    this._queueHotspots();
    // The live layer sits above every slide: nothing drawn on another
    // slide may stay on it.
    if (curr !== prev) this._clearLive();
    if (this._countEl) this._countEl.textContent = String(curr + 1);
    // The overview marks the slide shown, wherever the change came from.
    if (this._overview) {
      const cells = this._ovCells?.children ?? [];
      for (let i = 0; i < cells.length; i++) cells[i].toggleAttribute('data-current', i === curr);
    }

    if (broadcast) {
      // (1) Legacy: postMessage bridge for presenter/speaker-note renderers.
      const note = this._notes[curr] ?? null;
      try { window.postMessage({ slideIndexChanged: curr, note, reason }, '*'); } catch (e) {}
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ slideIndexChanged: curr, note, reason }, '*');
        }
      } catch (e) {}

      // (2) In-page CustomEvent on the <deck-stage> element itself.
      //     Bubbles and composes out of shadow DOM so slide code can listen:
      //       document.querySelector('deck-stage').addEventListener('slidechange', e => {
      //         e.detail.index, e.detail.previousIndex, e.detail.total, e.detail.slide, e.detail.reason
      //       });
      const detail = {
        index: curr,
        previousIndex: prev,
        total: this._slides.length,
        slide: this._slides[curr] || null,
        previousSlide: prev >= 0 ? (this._slides[prev] || null) : null,
        reason: reason, // 'init' | 'keyboard' | 'click' | 'tap' | 'api' | 'reset' | 'sync'
      };
      this.dispatchEvent(new CustomEvent('slidechange', {
        detail,
        bubbles: true,
        composed: true,
      }));
    }

    this._prevIndex = curr;
    if (broadcast) this._broadcastState(reason);
    if (showOverlay) this._flashOverlay();
  }

  get state() {
    return { index: this._index, slideId: this._slides[this._index]?.dataset.slideId,
      step: this._stepMap.get(this._index) ?? -1, blank: this._blank, join: this._join, freeze: this._freeze,
      inkHidden: this.hasAttribute('data-ink-hidden') };
  }

  /** Whether the saved drawings are hidden (I). Setting it tells the other screens. */
  get inkHidden() { return this.hasAttribute('data-ink-hidden'); }
  setInkHidden(on, reason = 'api') {
    on = !!on;
    if (on === this.inkHidden) return;
    this.toggleAttribute('data-ink-hidden', on);
    this._broadcastState(reason);
  }

  /** The position the audience's screens keep (Z), or null. */
  get freeze() { return this._freeze; }
  /** Freeze the audience's screens at the position shown here, or let them follow again. */
  setFreeze(on, reason = 'api') {
    if (!!on === !!this._freeze) return;
    const { index, step, slideId } = this.state;
    this._applyFreeze(on ? { index, step, slideId } : null);
    this._broadcastState(reason);
  }
  _applyFreeze(position) {
    this._freeze = position;
    if (!position) this._followed = null;
    this.toggleAttribute('data-frozen', !!position);
  }
  // Whether this screen keeps the frozen position instead of following.
  _frozenHere() { return !!this._freeze && this.hasAttribute('data-freezable'); }
  // A press in a frozen audience window lets it follow again, where the
  // presenter went on to: a presenter tab that closed while it was frozen
  // would otherwise leave it stuck, with only a reload as the way out. The
  // presenter view hears of it like any change made in this window.
  _thaw(reason) {
    const position = this._followed;
    this._applyFreeze(null);
    if (position) this.setState({ ...position, freeze: null });
    this._broadcastState(reason);
  }

  /** Whether the screen is black (B). Setting it tells the other screens. */
  get blank() { return this._blank; }
  set blank(on) { this.setBlank(on); }
  /** Make the screen black or show the slide again; `reason` as in statechange. */
  setBlank(on, reason = 'api') {
    on = !!on;
    if (on === this._blank) return;
    this._applyBlank(on);
    this._broadcastState(reason);
  }
  _applyBlank(on) {
    this._blank = on;
    this.toggleAttribute('data-blank', on);
    if (on && this._join) this._applyJoin(false);
  }

  /** Whether the join code shows over the slide (J). Setting it tells the other screens; JoinOverlay.jsx draws it. */
  get join() { return this._join; }
  setJoin(on, reason = 'api') {
    on = !!on;
    if (on === this._join) return;
    this._applyJoin(on);
    this._broadcastState(reason);
  }
  _applyJoin(on) {
    this._join = on;
    this.toggleAttribute('data-join', on);
    if (on && this._blank) this._applyBlank(false);
    this.dispatchEvent(new CustomEvent('joinchange', { detail: { join: on } }));
  }

  _broadcastState(reason) {
    // atEnd: nothing comes after this, which ends a rehearsal (presenter/PresenterView.jsx).
    const state = this.state;
    const atEnd = state.index === this._slides.length - 1 && state.step >= this._getSteps(this._slides[state.index]).length - 1;
    const message = { deckStateChanged: state, atEnd, reason };
    window.postMessage(message, '*');
    if (window.parent !== window) window.parent.postMessage(message, '*');
    this.dispatchEvent(new CustomEvent('statechange', { detail: { ...this.state, reason } }));
  }

  setState(state) {
    if (!state || !Number.isInteger(state.index) || !Number.isInteger(state.step)) return;
    // A position without `freeze` (a follower paging on its own) leaves it.
    const freeze = !('freeze' in state) ? this._freeze
      : Number.isInteger(state.freeze?.index) && Number.isInteger(state.freeze?.step)
        ? { index: state.freeze.index, step: state.freeze.step, slideId: state.freeze.slideId } : null;
    const freezeChanged = JSON.stringify(freeze) !== JSON.stringify(this._freeze);
    if (freezeChanged) this._applyFreeze(freeze);
    // The audience window stays at the frozen position, and remembers where
    // the presenter went, for when a press in it lets it follow again.
    if (this._frozenHere()) this._followed = { index: state.index, step: state.step, slideId: state.slideId };
    const target = this._frozenHere() ? this._freeze : state;
    const byId = target.slideId ? this._slides.findIndex(s => s.dataset.slideId === target.slideId) : -1;
    const index = byId >= 0 ? byId : target.index;
    if (index < 0 || index >= this._slides.length) { if (freezeChanged) this._broadcastState('sync'); return; }
    const max = this._getSteps(this._slides[index]).length - 1;
    const step = Math.max(-1, Math.min(max, target.step));
    // A step that is not there yet (a blank page whose ink is still on its
    // way) is shown once it comes (stepsChanged).
    this._wanted = target.step > max ? { index, step: target.step } : null;
    // A position without `blank` (a follower paging on its own) leaves it.
    const blankChanged = typeof state.blank === 'boolean' && state.blank !== this._blank;
    if (blankChanged) this._applyBlank(state.blank);
    const joinChanged = typeof state.join === 'boolean' && state.join !== this._join;
    if (joinChanged) this._applyJoin(state.join);
    const inkChanged = typeof state.inkHidden === 'boolean' && state.inkHidden !== this.inkHidden;
    if (inkChanged) this.toggleAttribute('data-ink-hidden', state.inkHidden);
    if (index === this._index) {
      if (step === this.state.step) {
        // The same position again, after the slide's content was swapped in
        // place (another language): its new elements get the reveals too.
        this._applySteps(index);
        if (blankChanged || joinChanged || freezeChanged || inkChanged) this._broadcastState('sync');
        return;
      }
      if (this._hotspot) this.wholeSlide();
      this._stepMap.set(index, step);
      this._applySteps(index);
      this._broadcastState('sync');
    } else {
      this._index = index;
      this._applyIndex({ reason: 'sync', step });
    }
  }

  /**
   * A slide's steps changed while it is shown: a blank page came or went
   * (ink/Room.jsx). The step asked for before it was there is shown now; a
   * step that is gone goes back to the last one there is.
   */
  stepsChanged() {
    const index = this._index;
    const max = this._getSteps(this._slides[index]).length - 1;
    const wanted = this._wanted?.index === index ? Math.min(max, this._wanted.step) : null;
    const step = this._stepMap.get(index) ?? -1;
    if (wanted != null && wanted > step) { this._wanted = null; this._stepMap.set(index, wanted); }
    else if (step > max) this._stepMap.set(index, max);
    this._applySteps(index);
    this.dispatchEvent(new CustomEvent('stepschange'));
  }

  _flashOverlay() {
    if (!this._overlay || hideControls) return;
    this._overlay.setAttribute('data-visible', '');
    if (this._hideTimer) clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      this._overlay.removeAttribute('data-visible');
    }, OVERLAY_HIDE_MS);
  }

  _fit() {
    if (!this._canvas) return;
    // PPTX export sets noscale so the DOM capture sees authored-size
    // geometry — the scaled canvas is in shadow DOM, so the exporter's
    // resetTransformSelector can't reach .canvas.style.transform directly.
    if (this.hasAttribute('noscale')) {
      this._canvas.style.transform = 'none';
      return;
    }
    // Fit the host element, which is the viewport when the stage is
    // full-screen and a panel when it is embedded in another layout.
    const rect = this.getBoundingClientRect();
    const vw = rect.width || window.innerWidth;
    const vh = rect.height || window.innerHeight;
    if (this._overview) { this._fitOverview(vw, vh); return; }
    const s = Math.min(vw / this.designWidth, vh / this.designHeight);
    this._fitScale = s;
    this._hotspotLayer?.style.setProperty('--hotspot-k', String(1 / s));
    // An expanded slide is the whole view from further away (stage/zoom.js).
    const zoom = this._zoom ?? (this.expanded ? this._wholeZoom() : null);
    if (!zoom) { this._canvas.style.transform = `scale(${s})`; this._placeSelectionDelete(); return; }
    const tx = (this.designWidth / 2 - zoom.x) * s * zoom.scale;
    const ty = (this.designHeight / 2 - zoom.y) * s * zoom.scale;
    this._canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${s * zoom.scale})`;
    this._kickLaser();
    this._placeSelectionDelete();
  }

  _onResize() { this._fit(); this._queueHotspots(); }

  _onMouseMove() {
    // Keep overlay visible while mouse moves; hide after idle.
    this._flashOverlay();
  }

  _onKey(e) {
    // Ignore when the user is typing.
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key;
    let handled = true;

    if (this._overview && this.overviewKey(key)) {
      // Arrows, Enter, Escape and O belong to the overview while it is open.
    } else if ((key === 'o' || key === 'O') && this._isPage()) {
      this.overview = true;
    } else if (key === 'ArrowRight' || key === 'PageDown' || key === ' ' || key === 'Spacebar') {
      this.next('keyboard');
    } else if (key === 'ArrowLeft' || key === 'PageUp') {
      this.prev('keyboard');
    } else if (key === 'Home') {
      this._go(0, 'keyboard');
    } else if (key === 'End') {
      this._go(this._slides.length - 1, 'keyboard');
    } else if (key === 'i' || key === 'I') {
      // Show or hide the saved ink, on every screen.
      e.preventDefault();
      this.setInkHidden(!this.inkHidden, 'keyboard');
    } else if ((key === 'f' || key === 'F') && window.top === window && fullscreenAvailable()) {
      toggleFullscreen();
    } else if (key === 'r' || key === 'R') {
      this.reset();
    } else if ((key === 'j' || key === 'J') && this._isPage() && !this.hasAttribute('data-watching') && this.hasAttribute('data-joinable')) {
      // J: the join code over the slide, in a deck phones join (deckWindow.jsx sets data-joinable).
      this.setJoin(!this._join, 'keyboard');
    } else if ((key === 'z' || key === 'Z') && this._isPage() && this.hasAttribute('data-presenter')) {
      // Z (freeze) in the presenter's slide frame: the audience's screens keep
      // this slide. Not P, which is "previous" in PowerPoint.
      this.setFreeze(!this._freeze, 'keyboard');
    } else if ((key === 'b' || key === 'B' || key === '.') && this._isPage() && !this.hasAttribute('data-watching')) {
      // B, or the "blank" button of a presenter's clicker, which sends a full stop.
      this.setBlank(!this._blank, 'keyboard');
    } else if (/^[0-9]$/.test(key) || key === 'Escape') {
      handled = this.hotspotKey(key);
    } else {
      handled = false;
    }

    if (handled) {
      e.preventDefault();
      this._flashOverlay();
    }
  }

  // A stage that is the page (a deck window, the audience window, the
  // presenter's slide); the reader's stage sits in its page and has an
  // outline of its own.
  _isPage() { return this.parentElement === document.body; }

  _go(i, reason = 'api', step = -1) {
    if (!this._slides.length) return;
    if (this._frozenHere()) { this._thaw(reason); return; }
    const clamped = Math.max(0, Math.min(this._slides.length - 1, i));
    if (clamped === this._index) {
      this._flashOverlay();
      return;
    }
    this._index = clamped;
    this._applyIndex({ showOverlay: true, broadcast: true, reason, step });
  }

  // Step reveal helpers ---------------------------------------------------

  _getSteps(slide) {
    // Each step is a list of elements that appear together.
    return slideSteps(slide);
  }

  _applySteps(slideIndex) {
    const slide = this._slides[slideIndex];
    if (!slide) return;
    const steps = this._getSteps(slide);
    const curr  = this._printing ? steps.length - 1 : (this._stepMap.get(slideIndex) ?? -1);
    steps.forEach((elements, i) => elements.forEach(el =>
      i <= curr ? el.setAttribute('data-step-visible', '') : el.removeAttribute('data-step-visible')
    ));
    this._updateStepCount(slideIndex);
    if (slideIndex === this._index) this._queueHotspots();
  }

  _updateStepCount(slideIndex) {
    if (!this._stepProgressEl) return;
    const steps = this._getSteps(this._slides[slideIndex]);
    if (steps.length === 0) {
      this._stepProgressEl.hidden = true;
      return;
    }
    const curr = this._stepMap.get(slideIndex) ?? -1;
    this._stepCurEl.textContent  = String(curr + 1);
    this._stepTotalEl.textContent = String(steps.length);
    this._stepProgressEl.hidden  = false;
  }

  // Public API ------------------------------------------------------------

  /** Current slide index (0-based). */
  get index() { return this._index; }
  /** Total slide count. */
  get length() { return this._slides.length; }
  /** Words on the control bar, in the deck's language:
   *  { controls, previous, next, reset, resetHint }, and if given
   *  { overview, draw, fullscreen, exitFullscreen }. Each button's tooltip
   *  is its word and its key. */
  setLabels(labels = {}) {
    this._labels = labels;
    const overlay = this._overlay;
    if (!overlay) return;
    const name = (selector, label, key) => {
      if (!label) return;
      const button = overlay.querySelector(selector);
      button.setAttribute('aria-label', label);
      button.title = `${label} (${key})`;
    };
    if (labels.controls) overlay.setAttribute('aria-label', labels.controls);
    name('.prev', labels.previous, '←');
    name('.next', labels.next, '→');
    name('.reset', labels.resetHint, 'R');
    if (labels.reset) overlay.querySelector('.reset').firstChild.textContent = labels.reset;
    name('.overview', labels.overview, 'O');
    name('.draw', labels.draw, 'D');
    name('.fullscreen', this._fullscreenOn ? labels.exitFullscreen : labels.fullscreen, 'F');
  }

  _windowInput() {
    return [['pointerdown', this._onPointerDown], ['pointermove', this._onPointerMove], ['pointerup', this._onPointerUp],
      ['pointercancel', this._onPointerUp], ['pointerout', this._onPointerOut],
      ['touchstart', this._onTouch], ['touchmove', this._onTouch], ['touchend', this._onTouch], ['click', this._onClickCapture],
      ['wheel', this._onWheel], ['gesturestart', this._onGesture], ['gesturechange', this._onGesture]];
  }

  /** True while the deck is laid out for print or PDF. */
  get printing() { return !!this._printing; }
  /** Enter or leave print mode: reveal every step and tell slide code to show its final state. */
  set printing(on) {
    on = !!on;
    if (on === this.printing) return;
    this._printing = on;
    this.toggleAttribute('data-deck-static', on);
    this._slides.forEach((_, i) => this._applySteps(i));
    this.dispatchEvent(new CustomEvent('printchange', {
      detail: { printing: on },
      bubbles: true,
      composed: true,
    }));
  }
  /** Programmatically navigate to a specific slide (no step checks). */
  goTo(i) { this._go(i, 'api'); }
  /** Advance: reveals next step if the current slide has unrevealed steps, else goes to next slide. */
  next(reason = 'api') {
    // A frozen audience window (Z in the presenter view) follows again on a press.
    if (this._frozenHere()) { this._thaw(reason); return; }
    // On a black screen, the next press shows the slide again first; so with the join code.
    if (this._blank) { this.setBlank(false, reason); return; }
    if (this._join) { this.setJoin(false, reason); return; }
    const steps = this._getSteps(this._slides[this._index]);
    const curr  = this._stepMap.get(this._index) ?? -1;
    if (steps.length > 0 && curr < steps.length - 1) {
      // The step may appear outside the hotspot: show the whole slide.
      if (this._hotspot) this.wholeSlide();
      this._stepMap.set(this._index, curr + 1);
      this._applySteps(this._index);
      this._broadcastState(reason);
      this._flashOverlay();
      return;
    }
    this._go(this._index + 1, reason);
  }
  /** Go back: hides last revealed step if any, else goes to previous slide. */
  prev(reason = 'api') {
    if (this._frozenHere()) { this._thaw(reason); return; }
    if (this._blank) { this.setBlank(false, reason); return; }
    if (this._join) { this.setJoin(false, reason); return; }
    const steps = this._getSteps(this._slides[this._index]);
    const curr  = this._stepMap.get(this._index) ?? -1;
    if (steps.length > 0 && curr >= 0) {
      if (this._hotspot) this.wholeSlide();
      this._stepMap.set(this._index, curr - 1);
      this._applySteps(this._index);
      this._broadcastState(reason);
      this._flashOverlay();
      return;
    }
    // Back onto a slide with blank pages (ink/Room.jsx) shows the last of
    // them, as turning back through pages does.
    const before = this._slides[this._index - 1];
    const page = before?.querySelector(':scope > .slide-page') ? this._getSteps(before).length - 1 : -1;
    this._go(this._index - 1, reason, page);
  }
  /** Reset to first slide and clear all step state. */
  reset() {
    if (this._frozenHere()) { this._thaw('reset'); return; }
    this._stepMap.clear();
    // Moving to the first slide reports the new position itself; report it
    // once more only when the deck was already there, for the cleared steps.
    // Two reports for one reset arrived in other windows one after the
    // other, and the late one could undo a change made in between.
    if (this._index !== 0) { this._go(0, 'reset'); return; }
    this._applySteps(0);
    this._broadcastState('reset');
  }
}

if (!customElements.get('deck-stage')) {
  customElements.define('deck-stage', DeckStage);
}
