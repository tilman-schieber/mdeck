/**
 * <deck-stage> — reusable web component for HTML decks.
 *
 * Handles:
 *  (a) speaker notes — reads <script type="application/json" id="speaker-notes">
 *      and posts {slideIndexChanged: N} to the parent window on nav.
 *  (b) keyboard navigation — ←/→, PgUp/PgDn, Space, Home/End, number keys.
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
 */

import { iconSvg } from '../core/icons.js'
import { inkPaint, snapAngle } from '../core/ink.js'

(() => {
  const DESIGN_W_DEFAULT = 1920;
  const DESIGN_H_DEFAULT = 1080;
  const OVERLAY_HIDE_MS = 1800;
  // Taps: short and still; controls on the slide keep theirs.
  const TAP_MS = 350;
  const TAP_SLOP = 12;
  // Swipes: mostly sideways, this far, this fast.
  const SWIPE_MIN = 60;
  const SWIPE_MS = 700;
  const TAP_IGNORE = 'a, button, input, select, textarea, label, summary, iframe, video, audio, canvas, [contenteditable], [role="button"], [data-ink-ui], [data-no-tap], .overlay';
  const CLICK_AFTER_INK_MS = 400;
  // Holding the pen still this long turns the stroke into a straight line.
  const STRAIGHTEN_MS = 500;
  const STRAIGHTEN_SLOP = 6;  // CSS px the pen may tremble while held
  // Laser: a red glow with a white core. The trail stays while the pen is
  // down; lifted, it retracts from its tail within LASER_MS.
  const LASER_GLOW = '#ff2a2a';
  const LASER_CORE = '#ffffff';
  const LASER_MS = 1200;
  // A trail whose end never arrives (the other window closed) goes after this.
  const LASER_HELD_MS = 30000;
  const LASER_STEP = 4;  // design px between the points of a held trail
  // Zoom: up to this many times the fitted size.
  const ZOOM_MAX = 6;
  const VALIDATE_ATTR = 'no_overflowing_text,no_overlapping_text,slide_sized_text';
  // An embedded deck (the presenter view's frames, a preview) hides its
  // controls, unless the page embedding it asks for them with ?controls=1, as
  // the docs' example deck does.
  const isEmbedded = new URLSearchParams(location.search).has('embedded');
  const hideControls = isEmbedded && !new URLSearchParams(location.search).has('controls');

  const pad2 = (n) => String(n).padStart(2, '0');

  const stylesheet = `
    :host {
      position: fixed;
      inset: 0;
      display: block;
      background: #000;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
      overflow: hidden;
    }

    .stage {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .canvas {
      position: relative;
      transform-origin: center center;
      flex-shrink: 0;
      background: #fff;
      will-change: transform;
    }

    /* Slides live in light DOM (via <slot>) so authored CSS still applies.
       We absolutely position each slotted child to stack them. */
    ::slotted(*) {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      box-sizing: border-box !important;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
      visibility: hidden;
    }
    ::slotted([data-deck-active]) {
      opacity: 1;
      pointer-events: auto;
      visibility: visible;
    }

    /* Ink: the pen and the mouse are taken on the window (see "Ink input"),
       so fingers keep reaching the slides. Only when fingers draw too, a
       layer above the slides takes all touches. The stroke in progress is
       drawn on .ink-live, which sits in the scaled canvas and so uses design
       pixels; the laser on .ink-laser, in screen pixels. */
    .ink-input {
      position: fixed;
      inset: 0;
      z-index: 2147482100;
      display: none;
      touch-action: none;
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
      -webkit-tap-highlight-color: transparent;
      cursor: crosshair;
    }
    :host([data-inking][data-ink-finger]) .ink-input { display: block; }
    :host([data-inking]) { cursor: crosshair; }
    /* The stage's own zoom replaces the browser's: no page zoom or panning
       on the slide (fingers zoom and move the slide itself). */
    :host([data-zoomable]) { touch-action: none; }
    .zoom-reset {
      position: fixed;
      top: max(12px, env(safe-area-inset-top));
      left: max(12px, env(safe-area-inset-left));
      z-index: 2147483000;
      display: none;
      align-items: center;
      gap: 6px;
      height: 40px;
      padding: 0 14px;
      border: 1px solid #3a3a3a;
      border-radius: 20px;
      background: rgba(22, 22, 22, 0.9);
      color: #e6e6e6;
      font: 13px/1 system-ui, -apple-system, sans-serif;
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .zoom-reset svg { width: 16px; height: 16px; }
    :host([data-zoomed]) .zoom-reset { display: inline-flex; }
    :host([data-follower]) .zoom-reset { display: none; }
    :host([data-inking][data-ink-tool="eraser"]) { cursor: cell; }
    .ink-laser {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147482200;
      pointer-events: none;
    }
    .ink-live .ink-selection { fill: rgba(77, 163, 255, 0.08); stroke: #4da3ff; stroke-width: 1.5; stroke-dasharray: 6 4; vector-effect: non-scaling-stroke; }
    .ink-live .ink-lasso { fill: none; }
    .ink-live .ink-handle { fill: #fff; stroke: #4da3ff; stroke-width: 3; vector-effect: non-scaling-stroke; }
    .ink-live {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: visible;
      z-index: 1;
    }
    .ink-live .fading { transition: opacity 0.8s ease 2.2s; opacity: 0; }
    /* The ink toolbar replaces the overlay while drawing. */
    :host([data-inking]) .overlay { display: none; }
    .btn.draw, .btn.fullscreen { display: none; }
    :host([data-ink-enabled]) .btn.draw { display: inline-flex; }
    :host([data-fullscreen-available]) .btn.fullscreen { display: inline-flex; }
    @media (pointer: coarse) { .overlay .btn { height: 40px; min-width: 40px; } }

    .overlay {
      position: fixed;
      left: 50%;
      bottom: 22px;
      transform: translate(-50%, 6px) scale(0.92);
      filter: blur(6px);
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      background: #000;
      color: #fff;
      border-radius: 999px;
      font-size: 12px;
      font-feature-settings: "tnum" 1;
      letter-spacing: 0.01em;
      opacity: 0;
      pointer-events: none;
      transition: opacity 260ms ease, transform 260ms cubic-bezier(.2,.8,.2,1), filter 260ms ease;
      transform-origin: center bottom;
      z-index: 2147483000;
      user-select: none;
    }
    .overlay[data-visible] {
      opacity: 1;
      pointer-events: auto;
      transform: translate(-50%, 0) scale(1);
      filter: blur(0);
    }

    .btn {
      appearance: none;
      -webkit-appearance: none;
      background: transparent;
      border: 0;
      margin: 0;
      padding: 0;
      color: inherit;
      font: inherit;
      cursor: default;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 28px;
      min-width: 28px;
      border-radius: 999px;
      color: rgba(255,255,255,0.72);
      transition: background 140ms ease, color 140ms ease;
      -webkit-tap-highlight-color: transparent;
    }
    .btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
    .btn:active { background: rgba(255,255,255,0.18); }
    .btn:focus { outline: none; }
    .btn:focus-visible { outline: none; }
    .btn::-moz-focus-inner { border: 0; }
    .btn svg { width: 16px; height: 16px; display: block; }
    .btn.reset {
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.02em;
      padding: 0 10px 0 12px;
      gap: 6px;
      color: rgba(255,255,255,0.72);
    }
    .btn.reset .kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 10px;
      line-height: 1;
      color: rgba(255,255,255,0.88);
      background: rgba(255,255,255,0.12);
      border-radius: 4px;
    }

    .count {
      font-variant-numeric: tabular-nums;
      color: #fff;
      font-weight: 500;
      padding: 0 8px;
      min-width: 42px;
      text-align: center;
      font-size: 12px;
    }
    .count .sep { color: rgba(255,255,255,0.45); margin: 0 3px; font-weight: 400; }
    .count .total { color: rgba(255,255,255,0.55); }
    .step-progress { color: rgba(255,255,255,0.55); font-size: 11px; margin: 0 2px; }

    .divider {
      width: 1px;
      height: 14px;
      background: rgba(255,255,255,0.18);
      margin: 0 2px;
    }

    /* ── Print: one page per slide, no chrome ────────────────────────────
       The screen layout stacks every slide at inset:0 inside a scaled
       canvas; for print we want them in document flow at the authored
       design size so the browser paginates one slide per sheet. The
       @page size is set from the width/height attributes via the inline
       <style id="deck-stage-print-page"> that connectedCallback injects
       into <head> (the @page at-rule has no effect inside shadow DOM). */
    @media print {
      :host {
        position: static;
        inset: auto;
        background: none;
        overflow: visible;
        color: inherit;
      }
      .stage { position: static; display: block; }
      .canvas {
        transform: none !important;
        width: auto !important;
        height: auto !important;
        background: none;
        will-change: auto;
      }
      ::slotted(*) {
        position: relative !important;
        inset: auto !important;
        width: var(--deck-design-w) !important;
        height: var(--deck-design-h) !important;
        box-sizing: border-box !important;
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto;
        break-after: page;
        page-break-after: always;
        break-inside: avoid;
        overflow: hidden;
      }
      ::slotted(*:last-child) {
        break-after: auto;
        page-break-after: auto;
      }
      .overlay, .ink-input, .ink-live, .ink-laser, .zoom-reset { display: none !important; }
    }
  `;

  // Full screen, with Safari's prefixed names (iPad); unavailable on an iPhone.
  function fullscreenAvailable() {
    return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  }
  // Older Safari (iPad) names the element and the exit differently; a miss
  // here made the button enter full screen again instead of leaving it, and
  // an iPad has no Escape key to get out.
  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.webkitCurrentFullScreenElement || null;
  }
  function toggleFullscreen(element = document.documentElement) {
    if (fullscreenElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen;
      return exit?.call(document);
    }
    const request = element.requestFullscreen || element.webkitRequestFullscreen;
    return request?.call(element);
  }
  /** Calls back with true or false whenever the page enters or leaves full screen; returns a function that stops it. */
  function onFullscreenChange(listener) {
    const handler = () => listener(!!fullscreenElement());
    for (const name of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(name, handler);
    return () => { for (const name of ['fullscreenchange', 'webkitfullscreenchange']) document.removeEventListener(name, handler); };
  }
  window.mdeckFullscreen = { available: fullscreenAvailable, element: fullscreenElement, toggle: toggleFullscreen, onChange: onFullscreenChange };

  class DeckStage extends HTMLElement {
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
      this._onPointerDown = this._onPointerDown.bind(this);
      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerUp = this._onPointerUp.bind(this);
      this._onPointerOut = this._onPointerOut.bind(this);
      this._onTouch = this._onTouch.bind(this);
      this._onClickCapture = this._onClickCapture.bind(this);
      this._laserFrame = this._laserFrame.bind(this);
      // Drawing starts with the laser pointer: pointing is the common case.
      this.inkTool = { tool: 'laser', color: '#e11d48', size: 6 };
      this.inkRenderer = null;
      this._lasers = new Map();
      this._inkUpAt = 0;
      this._zoom = null;
      this._touches = new Map();
      this._onWheel = this._onWheel.bind(this);
      this._onGesture = this._onGesture.bind(this);
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
      if (typeof ResizeObserver !== 'undefined') { this._resizeObserver = new ResizeObserver(() => this._fit()); this._resizeObserver.observe(this); }
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

      const slot = document.createElement('slot');
      slot.addEventListener('slotchange', this._onSlotChange);
      canvas.appendChild(slot);
      const inkLive = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      inkLive.setAttribute('class', 'ink-live');
      inkLive.setAttribute('viewBox', `0 0 ${this.designWidth} ${this.designHeight}`);
      inkLive.setAttribute('preserveAspectRatio', 'none');
      canvas.appendChild(inkLive);
      stage.appendChild(canvas);

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
      zoomReset.addEventListener('click', () => this.setZoom(null, 'reset'));

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
      overlay.querySelector('.draw').addEventListener('click', () => { this.inking = !this.inking; });
      const fullscreenButton = overlay.querySelector('.fullscreen');
      fullscreenButton.addEventListener('click', () => toggleFullscreen());
      // The same button leaves full screen, and says so.
      onFullscreenChange(on => {
        fullscreenButton.innerHTML = iconSvg(on ? 'fullscreen-exit' : 'fullscreen');
        fullscreenButton.title = on ? 'Exit full screen (F)' : 'Full screen (F)';
        fullscreenButton.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
      });
      // Only a top-level window can go full screen (an iPhone cannot at all).
      if (window.top === window && fullscreenAvailable()) this.setAttribute('data-fullscreen-available', '');

      this._root.append(style, stage, inkInput, inkLaser, zoomReset, overlay);
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
      this._collectSlides();
      this._restoreIndex();
      this._applyIndex({ showOverlay: false, broadcast: true, reason: 'init' });
      this._fit();
    }

    _collectSlides() {
      const assigned = this._slot.assignedElements({ flatten: true });
      this._slides = assigned.filter((el) => {
        // Skip template/style/script nodes even if someone slots them.
        const tag = el.tagName;
        return tag !== 'TEMPLATE' && tag !== 'SCRIPT' && tag !== 'STYLE';
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
      if (curr !== prev && this._zoom) this.setZoom(null, 'slide', { announce: false });
      // The live layer sits above every slide: nothing drawn on another
      // slide may stay on it.
      if (curr !== prev) this._clearLive();
      if (this._countEl) this._countEl.textContent = String(curr + 1);

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
        step: this._stepMap.get(this._index) ?? -1 };
    }

    _broadcastState(reason) {
      const message = { deckStateChanged: this.state, reason };
      window.postMessage(message, '*');
      if (window.parent !== window) window.parent.postMessage(message, '*');
      this.dispatchEvent(new CustomEvent('statechange', { detail: { ...this.state, reason } }));
    }

    setState(state) {
      if (!state || !Number.isInteger(state.index) || !Number.isInteger(state.step)) return;
      const byId = state.slideId ? this._slides.findIndex(s => s.dataset.slideId === state.slideId) : -1;
      const index = byId >= 0 ? byId : state.index;
      if (index < 0 || index >= this._slides.length) return;
      const max = this._getSteps(this._slides[index]).length - 1;
      const step = Math.max(-1, Math.min(max, state.step));
      if (index === this._index) {
        if (step === this.state.step) return;
        this._stepMap.set(index, step);
        this._applySteps(index);
        this._broadcastState('sync');
      } else {
        this._index = index;
        this._applyIndex({ reason: 'sync', step });
      }
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
      const s = Math.min(vw / this.designWidth, vh / this.designHeight);
      this._fitScale = s;
      const zoom = this._zoom;
      if (!zoom) { this._canvas.style.transform = `scale(${s})`; return; }
      const tx = (this.designWidth / 2 - zoom.x) * s * zoom.scale;
      const ty = (this.designHeight / 2 - zoom.y) * s * zoom.scale;
      this._canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${s * zoom.scale})`;
      this._kickLaser();
    }

    _onResize() { this._fit(); }

    _onMouseMove() {
      // Keep overlay visible while mouse moves; hide after idle.
      this._flashOverlay();
    }

    // Fingers (and a pen while not drawing): a swipe to the left goes
    // forward, to the right back; on a zoomed slide a finger moves the view
    // instead. While not drawing, a tap on the left or right third of the
    // screen goes back or forward, as the tap zones did. A tap while drawing selects the stroke under it
    // (`inktap`, { slideId, point }); the selection then takes the pen.
    // Read from pointer events, so it works whatever pointer the device
    // reports, and controls on the slide (buttons, links, polls, embedded
    // frames) keep their own taps.
    _tapStart(e) {
      const finger = e.pointerType === 'touch' && !(this.inking && this.inkFinger);
      const pen = e.pointerType === 'pen' && !this.inking;
      this._tap = (finger || pen) && e.isPrimary ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;
    }

    _tapEnd(e) {
      const tap = this._tap;
      this._tap = null;
      if (!tap || tap.id !== e.pointerId || e.type !== 'pointerup') return;
      const dx = e.clientX - tap.x, dy = e.clientY - tap.y, ms = performance.now() - tap.t;
      if (e.composedPath().some(el => el.nodeType === 1 && el.matches(TAP_IGNORE))) return;
      if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5 && ms <= SWIPE_MS) {
        if (dx < 0) this.next('swipe');
        else this.prev('swipe');
        return;
      }
      if (ms > TAP_MS || Math.hypot(dx, dy) > TAP_SLOP) return;
      if (!this.inking) {
        // Not drawing: a tap on the left third goes back, on the right third forward.
        if (this._zoom) return;
        const x = e.clientX / window.innerWidth;
        if (x < 1 / 3) this.prev('tap');
        else if (x > 2 / 3) this.next('tap');
        return;
      }
      const slideId = this._inkSlideId();
      if (slideId) this.dispatchEvent(new CustomEvent('inktap', { detail: { slideId, point: this._inkPoint(e), radius: 22 }, bubbles: true, composed: true }));
    }

    _onKey(e) {
      // Ignore when the user is typing.
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;
      let handled = true;

      if (key === 'ArrowRight' || key === 'PageDown' || key === ' ' || key === 'Spacebar') {
        this.next('keyboard');
      } else if (key === 'ArrowLeft' || key === 'PageUp') {
        this.prev('keyboard');
      } else if (key === 'Home') {
        this._go(0, 'keyboard');
      } else if (key === 'End') {
        this._go(this._slides.length - 1, 'keyboard');
      } else if (key === 'i' || key === 'I') {
        // Show or hide the saved ink.
        e.preventDefault();
        this.toggleAttribute('data-ink-hidden');
      } else if ((key === 'f' || key === 'F') && window.top === window && fullscreenAvailable()) {
        toggleFullscreen();
      } else if (key === 'r' || key === 'R') {
        this.reset();
      } else if (/^[0-9]$/.test(key)) {
        // 1..9 jump to that slide; 0 jumps to 10.
        const n = key === '0' ? 9 : parseInt(key, 10) - 1;
        if (n < this._slides.length) this._go(n, 'keyboard');
      } else {
        handled = false;
      }

      if (handled) {
        e.preventDefault();
        this._flashOverlay();
      }
    }

    _go(i, reason = 'api') {
      if (!this._slides.length) return;
      const clamped = Math.max(0, Math.min(this._slides.length - 1, i));
      if (clamped === this._index) {
        this._flashOverlay();
        return;
      }
      this._index = clamped;
      this._applyIndex({ showOverlay: true, broadcast: true, reason });
    }

    // Step reveal helpers ---------------------------------------------------

    _getSteps(slide) {
      if (!slide) return [];
      // Multiple and nested reveal blocks follow document order.
      return [...slide.querySelectorAll('[data-step]')];
    }

    _applySteps(slideIndex) {
      const slide = this._slides[slideIndex];
      if (!slide) return;
      const steps = this._getSteps(slide);
      const curr  = this._printing ? steps.length - 1 : (this._stepMap.get(slideIndex) ?? -1);
      steps.forEach((el, i) =>
        i <= curr ? el.setAttribute('data-step-visible', '') : el.removeAttribute('data-step-visible')
      );
      this._updateStepCount(slideIndex);
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
     *  { controls, previous, next, reset, resetHint }. */
    setLabels(labels = {}) {
      this._labels = labels;
      const overlay = this._overlay;
      if (!overlay) return;
      if (labels.controls) overlay.setAttribute('aria-label', labels.controls);
      if (labels.previous) overlay.querySelector('.prev').setAttribute('aria-label', labels.previous);
      if (labels.next) overlay.querySelector('.next').setAttribute('aria-label', labels.next);
      const reset = overlay.querySelector('.reset');
      if (labels.resetHint) reset.setAttribute('aria-label', labels.resetHint);
      if (labels.reset) reset.firstChild.textContent = labels.reset;
      if (labels.resetHint) reset.title = `${labels.resetHint} (R)`;
    }
    // Ink input ---------------------------------------------------------------
    //
    // While `inking` is on, the pen and the mouse draw on the current slide;
    // fingers keep operating the deck (taps move the slides, slide content
    // stays usable) and draw only when `inkFinger` is set. Finished strokes
    // are announced as `inkstroke` events ({ slideId, tool, color, size,
    // points }), in design pixels with pressure; the eraser sends `inkerase`
    // ({ slideId, point, radius }) while it moves, all with the same
    // `gesture` number for one stroke of the eraser. The laser is never kept:
    // its trail retracts within a second (`inklaser` when it ends) and its dot
    // follows a hovering pen (`inklaserdot`, { slideId, point | null }). The
    // select tool sends `inkselect` ({ phase: 'down' | 'move' | 'up', slideId,
    // point }) and shows what it is given with `showSelection`. `inkTool` is
    // { tool: 'pen' | 'highlighter' | 'laser' | 'select' | 'eraser', color,
    // size }. `inkRenderer(stroke)` may return an SVG path for the stroke in
    // progress. While a stroke or a laser trail is drawn, `inkprogress`
    // repeats it as it grows; `key` ties it to its end event.

    get inking() { return this.hasAttribute('data-inking'); }
    set inking(on) {
      this.toggleAttribute('data-inking', !!on);
      if (!on) { this._endInk(null); this.laserRelease('local'); this.laserDot('local', null, null); this.showSelection(null); }
      this.dispatchEvent(new CustomEvent('inkmode', { detail: { inking: !!on }, bubbles: true, composed: true }));
    }

    get inkFinger() { return this.hasAttribute('data-ink-finger'); }
    set inkFinger(on) { this.toggleAttribute('data-ink-finger', !!on); }

    _inkSlideId() { return this._slides[this._index]?.dataset.slideId ?? null; }

    _inkPoint(e) {
      const rect = this._canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * this.designWidth / rect.width;
      const y = (e.clientY - rect.top) * this.designHeight / rect.height;
      const pressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(pressure * 100) / 100];
    }

    _windowInput() {
      return [['pointerdown', this._onPointerDown], ['pointermove', this._onPointerMove], ['pointerup', this._onPointerUp],
        ['pointercancel', this._onPointerUp], ['pointerout', this._onPointerOut],
        ['touchstart', this._onTouch], ['touchmove', this._onTouch], ['touchend', this._onTouch], ['click', this._onClickCapture],
        ['wheel', this._onWheel], ['gesturestart', this._onGesture], ['gesturechange', this._onGesture]];
    }

    // The ink toolbar and the deck's controls keep their input.
    _inInkUi(e) {
      return e.composedPath().some(el => el.nodeType === 1 && (el.hasAttribute('data-ink-ui') || el.classList.contains('overlay')));
    }

    // While drawing: the pen, the mouse's main button, and fingers only when they draw.
    _inkTakes(e) {
      if (!this.inking || this._printing) return false;
      if (e.pointerType === 'touch' && !this.inkFinger) return false;
      if (e.pointerType === 'mouse' && e.button !== 0) return false;
      return !this._inInkUi(e);
    }

    _onPointerDown(e) {
      this._tapStart(e);
      if (this._zoomDown(e)) return;
      if (this._inkDrawing || !this._inkTakes(e)) return;
      e.preventDefault();
      e.stopPropagation();
      let tool = { ...this.inkTool };
      const point = this._inkPoint(e);
      // A selection (picked with a finger, or the select tool) takes the pen
      // that lands on it: on an end point's handle or inside its box. Landing
      // elsewhere puts the selection away and draws as usual.
      if (tool.tool !== 'select' && this.inkSelectionHit) {
        if (this.inkSelectionHit(point)) tool = { ...tool, tool: 'select' };
        else this.inkSelectionClear?.();
      }
      this._inkGesture = (this._inkGesture || 0) + 1;
      const drawing = this._inkDrawing = { pointerId: e.pointerId, touch: e.pointerType === 'touch', tool, points: [point], slideId: this._inkSlideId(), gesture: this._inkGesture, key: `${this._inkGesture}` };
      if (tool.tool === 'eraser') { this._erase(point); return; }
      if (tool.tool === 'select') { this._inkSelect('down', point); return; }
      if (tool.tool === 'laser') { this.laserTrail('local', drawing.slideId, [point], { start: true }); this._inkProgress(drawing); return; }
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      this._styleLive(path, tool);
      this._appendLive(path);
      drawing.path = path;
      this._drawLive(path, drawing.points, tool);
      this._inkProgress(drawing);
      this._holdStill(drawing, e);
    }

    // Pen and highlighter: holding still at the end of a stroke straightens
    // it, from its first point to the pen. Moving on afterwards (without
    // lifting) moves the line's end; lifting keeps the straight line.
    _holdStill(drawing, e) {
      const hold = drawing.hold;
      if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) <= STRAIGHTEN_SLOP) return;
      clearTimeout(hold?.timer);
      drawing.hold = { x: e.clientX, y: e.clientY, timer: setTimeout(() => this._straighten(drawing), STRAIGHTEN_MS) };
    }

    _straighten(drawing) {
      if (this._inkDrawing !== drawing || drawing.straight || drawing.points.length < 3) return;
      const pressures = drawing.points.map(p => p[2]);
      drawing.straight = Math.round(pressures.reduce((a, b) => a + b, 0) / pressures.length * 100) / 100;
      this._drawStraight(drawing, drawing.points[drawing.points.length - 1]);
    }

    // The line's end snaps to steps of 15° (horizontal, vertical, 45° …)
    // when it is close to one, see snapAngle in core/ink.js.
    _drawStraight(drawing, end) {
      const [x0, y0] = drawing.points[0];
      const [x, y] = snapAngle([x0, y0], end);
      drawing.points = [[x0, y0, drawing.straight], [x, y, drawing.straight]];
      drawing.restart = true;
      this._drawLive(drawing.path, drawing.points, drawing.tool);
      this._inkProgress(drawing);
    }

    _onPointerMove(e) {
      if (this._zoomMove(e)) return;
      const drawing = this._inkDrawing;
      if (!drawing) { this._laserHover(e); return; }
      if (e.pointerId !== drawing.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const added = (events.length ? events : [e]).map(ev => this._inkPoint(ev));
      const tool = drawing.tool.tool;
      if (drawing.straight) { this._drawStraight(drawing, added[added.length - 1]); return; }
      drawing.points.push(...added);
      const last = drawing.points[drawing.points.length - 1];
      if (tool === 'pen' || tool === 'highlighter') this._holdStill(drawing, e);
      if (tool === 'eraser') this._erase(last);
      else if (tool === 'select') this._inkSelect('move', last);
      else if (tool === 'laser') { this.laserTrail('local', drawing.slideId, added); this._inkProgress(drawing); }
      else { this._drawLive(drawing.path, drawing.points, drawing.tool); this._inkProgress(drawing); }
    }

    _onPointerUp(e) {
      this._zoomUp(e);
      this._tapEnd(e);
      const drawing = this._inkDrawing;
      if (!drawing || e.pointerId !== drawing.pointerId) return;
      e.stopPropagation();
      this._inkUpAt = performance.now();
      // The stroke ends where the pen left the screen, which the last move
      // event does not always reach.
      const tool = drawing.tool.tool;
      if (e.type === 'pointerup' && (tool === 'pen' || tool === 'highlighter')) {
        const point = this._inkPoint(e);
        const last = drawing.points[drawing.points.length - 1];
        if (drawing.straight) this._drawStraight(drawing, point);
        else if (Math.hypot(point[0] - last[0], point[1] - last[1]) > 0.5) drawing.points.push([point[0], point[1], last[2]]);
      }
      this._endInk(drawing);
    }

    // The laser's dot follows a pen hovering over the screen (newer iPads).
    _laserHover(e) {
      if (!this.inking || this.inkTool.tool !== 'laser' || e.pointerType === 'touch' || (e.pointerType === 'mouse' && e.buttons)) return;
      const point = this._inInkUi(e) ? null : this._inkPoint(e);
      this.laserDot('local', this._inkSlideId(), point);
      this.dispatchEvent(new CustomEvent('inklaserdot', { detail: { slideId: this._inkSlideId(), point }, bubbles: true, composed: true }));
    }

    _onPointerOut(e) {
      if (e.relatedTarget || !this._lasers.get('local')?.dot) return;
      this.laserDot('local', null, null);
      this.dispatchEvent(new CustomEvent('inklaserdot', { detail: { slideId: this._inkSlideId(), point: null }, bubbles: true, composed: true }));
    }

    // iPad Safari: a pen touch while drawing neither scrolls, zooms, selects
    // text nor becomes a click.
    _onTouch(e) {
      if (this.hasAttribute('data-zoomable') && e.touches.length > 1 && e.cancelable && !this._inInkUi(e)) e.preventDefault();
      if (!this.inking || this._inInkUi(e)) return;
      if (![...e.changedTouches].some(t => t.touchType === 'stylus')) return;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    }

    // The click that ends a stroke is not a click on the slide.
    _onClickCapture(e) {
      if (!this.inking || performance.now() - this._inkUpAt > CLICK_AFTER_INK_MS || this._inInkUi(e)) return;
      e.preventDefault();
      e.stopPropagation();
    }

    _drawLive(path, points, tool) {
      const stroke = { tool: tool.tool === 'highlighter' ? 'highlighter' : 'pen', size: tool.size, points };
      // In progress: not yet `last`, so the outline does not close early.
      const d = this.inkRenderer ? this.inkRenderer(stroke, { last: false })
        : 'M' + points.map(p => p[0] + ' ' + p[1]).join(' L');
      path.setAttribute('d', d);
    }

    _styleLive(path, { tool, color, size }) {
      const renderer = !!this.inkRenderer;
      // Pen colours follow the palette and appearance (inkPaint in core/ink.js).
      path.style[renderer ? 'fill' : 'stroke'] = inkPaint(color);
      if (!renderer) { path.setAttribute('fill', 'none'); path.setAttribute('stroke-width', size); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); }
      path.setAttribute(renderer ? 'fill-opacity' : 'stroke-opacity', tool === 'highlighter' ? '0.35' : '1');
      // The highlighter goes under the pen, as on paper.
      if (tool === 'highlighter') path.setAttribute('data-under', '');
    }

    // Highlighter strokes go below the pen's, the selection stays on top.
    _appendLive(path) {
      const above = path.hasAttribute('data-under')
        ? [...this._inkLive.children].find(el => !el.hasAttribute('data-under'))
        : this._inkLive.querySelector('.ink-selection-group');
      this._inkLive.insertBefore(path, above ?? null);
    }

    // Announces the stroke in progress (`inkprogress`, the same points array
    // as it grows), so other windows can show it while it is drawn.
    _inkProgress(drawing) {
      const { tool, color, size } = drawing.tool;
      // `restart`: the points were replaced (a straightened stroke), not extended.
      const restart = !!drawing.restart;
      drawing.restart = false;
      this.dispatchEvent(new CustomEvent('inkprogress', { detail: { key: drawing.key, slideId: drawing.slideId, tool, color, size, points: drawing.points, restart }, bubbles: true, composed: true }));
    }

    _endInk(drawing) {
      this._inkDrawing = null;
      clearTimeout(drawing?.hold?.timer);
      if (!drawing || drawing.tool.tool === 'eraser' || !drawing.slideId) { drawing?.path?.remove(); return; }
      const { tool, color, size } = drawing.tool;
      if (tool === 'select') { this._inkSelect('up', drawing.points[drawing.points.length - 1], drawing); return; }
      const detail = { key: drawing.key, slideId: drawing.slideId, tool, color, size, points: drawing.points };
      if (tool === 'laser') {
        // Never saved: lifted, the trail retracts on its own.
        this.laserRelease('local');
        this.laserDot('local', drawing.slideId, null);
        this.dispatchEvent(new CustomEvent('inklaser', { detail, bubbles: true, composed: true }));
        return;
      }
      this.dispatchEvent(new CustomEvent('inkstroke', { detail, bubbles: true, composed: true }));
      // The saved layer draws the stroke from now on; keep this one a moment
      // longer so nothing flickers.
      const path = drawing.path;
      this._removeLive(path);
    }

    // The saved layer draws a finished stroke from the next frame on; keep the
    // live one until then so nothing flickers. A window that is hidden gets
    // no frames, so a timer removes it in any case.
    _removeLive(path) {
      const remove = () => path.remove();
      requestAnimationFrame(() => requestAnimationFrame(remove));
      setTimeout(remove, 250);
    }

    _clearLive() {
      if (!this._inkLive) return;
      const own = this._inkDrawing?.path;
      for (const path of [...this._inkLive.querySelectorAll(':scope > path')]) if (path !== own) path.remove();
      for (const [key, value] of this._remoteInk ?? []) if (typeof value !== 'number') this._remoteInk.delete(key);
    }

    _erase(point) {
      const slideId = this._inkDrawing?.slideId ?? this._inkSlideId();
      if (!slideId) return;
      this.dispatchEvent(new CustomEvent('inkerase', { detail: { slideId, point, radius: 14, gesture: this._inkDrawing?.gesture ?? 0 }, bubbles: true, composed: true }));
    }

    _inkSelect(phase, point, drawing = this._inkDrawing) {
      const slideId = drawing?.slideId ?? this._inkSlideId();
      if (!slideId) return;
      this.dispatchEvent(new CustomEvent('inkselect', { detail: { phase, slideId, point, points: drawing?.points ?? [point] }, bubbles: true, composed: true }));
    }

    /**
     * Shows a selection on the current slide, in design pixels: `box` is
     * [x0, y0, x1, y1], `lasso` a list of points, `handles` the end points
     * of a selected straight line; null clears it.
     */
    showSelection(selection) {
      const { box = null, lasso = null, handles = [] } = selection ?? {};
      if (!this._inkLive) return;
      this._inkLive.querySelector('.ink-selection-group')?.remove();
      if (!box && !lasso?.length && !handles.length) return;
      const ns = 'http://www.w3.org/2000/svg';
      const group = document.createElementNS(ns, 'g');
      group.setAttribute('class', 'ink-selection-group');
      if (box) {
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('class', 'ink-selection');
        rect.setAttribute('x', box[0]); rect.setAttribute('y', box[1]);
        rect.setAttribute('width', Math.max(0, box[2] - box[0])); rect.setAttribute('height', Math.max(0, box[3] - box[1]));
        group.appendChild(rect);
      }
      for (const [x, y] of handles) {
        const handle = document.createElementNS(ns, 'circle');
        handle.setAttribute('class', 'ink-handle');
        handle.setAttribute('cx', x); handle.setAttribute('cy', y); handle.setAttribute('r', 16);
        group.appendChild(handle);
      }
      if (lasso?.length > 1) {
        const polygon = document.createElementNS(ns, 'polygon');
        polygon.setAttribute('class', 'ink-selection ink-lasso');
        polygon.setAttribute('points', lasso.map(p => `${p[0]},${p[1]}`).join(' '));
        group.appendChild(polygon);
      }
      this._inkLive.appendChild(group);
    }

    // Zoom --------------------------------------------------------------------
    //
    // Two fingers zoom into the slide and move around it; one finger moves a
    // zoomed slide; Ctrl + scroll (a trackpad pinch) zooms at the pointer.
    // Only the slide's canvas scales: the stage's controls, the ink toolbar
    // and the presenter's bars keep their size, and ink and laser points stay
    // exact. `zoom` is { scale, x, y }: the magnification over the fitted
    // slide and the design point at the centre of the view. Every slide
    // starts whole. `zoomchange` ({ slideId, scale, x, y, reason }) lets
    // other windows show the same part (setZoom with reason 'remote', which
    // is not announced again).

    get zoom() {
      return this._zoom ? { ...this._zoom } : { scale: 1, x: this.designWidth / 2, y: this.designHeight / 2 };
    }

    setZoom(zoom, reason = 'api', { announce = true } = {}) {
      const next = this._clampZoom(zoom);
      const same = JSON.stringify(next) === JSON.stringify(this._zoom);
      this._zoom = next;
      this.toggleAttribute('data-zoomed', !!next);
      this._fit();
      if (same || !announce) return;
      const { scale, x, y } = this.zoom;
      this.dispatchEvent(new CustomEvent('zoomchange', { detail: { slideId: this._inkSlideId(), scale, x, y, reason }, bubbles: true, composed: true }));
    }

    // Keeps the view on the slide; null when it shows the whole slide.
    _clampZoom(zoom) {
      if (!zoom) return null;
      const scale = Math.min(ZOOM_MAX, Math.max(1, Number(zoom.scale) || 1));
      if (scale <= 1.01) return null;
      const rect = this.getBoundingClientRect();
      // Half the view, in design pixels; a view wider than the slide stays centred.
      const half = length => length / 2 / ((this._fitScale || 1) * scale);
      const clamp = (value, h, size) => h >= size / 2 ? size / 2 : Math.min(size - h, Math.max(h, value));
      const x = clamp(Number(zoom.x), half(rect.width || window.innerWidth), this.designWidth);
      const y = clamp(Number(zoom.y), half(rect.height || window.innerHeight), this.designHeight);
      return { scale: Math.round(scale * 1000) / 1000, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    }

    // The design point under a screen point, for a given zoom.
    _designAt(clientX, clientY, zoom = this.zoom) {
      const rect = this.getBoundingClientRect();
      const k = (this._fitScale || 1) * zoom.scale;
      return [zoom.x + (clientX - rect.left - rect.width / 2) / k, zoom.y + (clientY - rect.top - rect.height / 2) / k];
    }

    // The zoom that keeps design point `point` under screen point `client`.
    _zoomKeeping(point, [clientX, clientY], scale) {
      const rect = this.getBoundingClientRect();
      const k = (this._fitScale || 1) * scale;
      return { scale, x: point[0] - (clientX - rect.left - rect.width / 2) / k, y: point[1] - (clientY - rect.top - rect.height / 2) / k };
    }

    _zoomDown(e) {
      if (e.pointerType !== 'touch' || !this.hasAttribute('data-zoomable') || this._inInkUi(e)) return false;
      this._touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (this._touches.size === 2) {
        // A second finger: a pinch, not a tap or a finger's stroke.
        this._tap = null;
        if (this._inkDrawing?.touch) { this._inkDrawing.path?.remove(); this._inkDrawing = null; }
        const [a, b] = [...this._touches.values()];
        const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const start = this.zoom;
        this._pinch = { distance: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, point: this._designAt(...middle, start), scale: start.scale };
        this._pan = null;
        return true;
      }
      if (this._touches.size === 1 && this._zoom && !(this.inking && this.inkFinger)) {
        this._pan = { id: e.pointerId, from: [e.clientX, e.clientY], point: this._designAt(e.clientX, e.clientY), moving: false };
      }
      return false;
    }

    _zoomMove(e) {
      if (!this._touches.has(e.pointerId)) return false;
      this._touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (this._pinch && this._touches.size >= 2) {
        e.preventDefault();
        const [a, b] = [...this._touches.values()];
        const scale = this._pinch.scale * Math.hypot(a[0] - b[0], a[1] - b[1]) / this._pinch.distance;
        this.setZoom(this._zoomKeeping(this._pinch.point, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], Math.min(ZOOM_MAX, Math.max(1, scale))), 'pinch');
        return true;
      }
      const pan = this._pan;
      if (pan?.id === e.pointerId && this._zoom) {
        if (!pan.moving && Math.hypot(e.clientX - pan.from[0], e.clientY - pan.from[1]) <= TAP_SLOP) return false;
        pan.moving = true;
        this._tap = null;
        e.preventDefault();
        this.setZoom(this._zoomKeeping(pan.point, [e.clientX, e.clientY], this._zoom.scale), 'pan');
        return true;
      }
      return false;
    }

    _zoomUp(e) {
      if (!this._touches.delete(e.pointerId)) return;
      if (this._touches.size < 2) this._pinch = null;
      if (this._pan?.id === e.pointerId || !this._touches.size) this._pan = null;
    }

    // Ctrl + scroll is how a trackpad pinch arrives; plain scrolling moves a zoomed slide.
    _onWheel(e) {
      if (!this.hasAttribute('data-zoomable') || this._inInkUi(e)) return;
      if (e.ctrlKey) {
        e.preventDefault();
        const zoom = this.zoom;
        const scale = Math.min(ZOOM_MAX, Math.max(1, zoom.scale * Math.exp(-e.deltaY / 100)));
        this.setZoom(this._zoomKeeping(this._designAt(e.clientX, e.clientY, zoom), [e.clientX, e.clientY], scale), 'wheel');
      } else if (this._zoom) {
        e.preventDefault();
        const k = (this._fitScale || 1) * this._zoom.scale;
        this.setZoom({ ...this._zoom, x: this._zoom.x + e.deltaX / k, y: this._zoom.y + e.deltaY / k }, 'wheel');
      }
    }

    // iPad Safari's own pinch zoom, which would enlarge every bar on the page.
    _onGesture(e) {
      if (this.hasAttribute('data-zoomable') && !this._inInkUi(e)) e.preventDefault();
    }

    // Laser -------------------------------------------------------------------
    //
    // Trails and dots by key ('local' for this window, others from the ink
    // bus), in design pixels. While the pen is down a trail's points stay
    // (time Infinity); lifted, they are stamped so that they expire one after
    // the other within LASER_MS, and the trail retracts from its tail. Frames
    // run only while some trail is left.

    _laserEntry(key, slideId) {
      let entry = this._lasers.get(key);
      if (!entry) this._lasers.set(key, entry = { slideId, points: [], dot: null });
      if (slideId) entry.slideId = slideId;
      return entry;
    }

    /** Adds points to a laser trail, held until laserRelease; its dot moves to the last one. */
    laserTrail(key, slideId, points, { start = false } = {}) {
      if (!points?.length) return;
      const entry = this._laserEntry(key, slideId);
      points.forEach(([x, y], i) => {
        // A held trail grows as long as the pen is down: skip points that
        // add nothing visible, so a long trail stays cheap to draw.
        const last = entry.points[entry.points.length - 1];
        const begins = start && i === 0;
        if (!begins && last && last[2] === Infinity && Math.hypot(x - last[0], y - last[1]) < LASER_STEP) return;
        entry.points.push([x, y, Infinity, begins]);
      });
      entry.heldSince = performance.now();
      if (key !== 'local') { clearTimeout(entry.heldTimer); entry.heldTimer = setTimeout(() => this.laserRelease(key), LASER_HELD_MS); }
      entry.dot = points[points.length - 1];
      this._kickLaser();
    }

    /** The pen is lifted: the held trail retracts from its tail. */
    laserRelease(key) {
      const entry = this._lasers.get(key);
      if (!entry) return;
      const held = entry.points.filter(p => p[2] === Infinity);
      const now = performance.now();
      held.forEach((p, i) => { p[2] = now - LASER_MS + LASER_MS * (i + 1) / held.length; });
      entry.heldSince = null;
      clearTimeout(entry.heldTimer);
      this._kickLaser();
    }

    /** Moves (or with null, hides) a laser dot. */
    laserDot(key, slideId, point) {
      const entry = this._lasers.get(key);
      if (!point && !entry) return;
      this._laserEntry(key, slideId).dot = point ? [point[0], point[1]] : null;
      this._kickLaser();
    }

    _kickLaser() {
      if (!this._laserRaf) this._laserRaf = requestAnimationFrame(this._laserFrame);
    }

    _laserFrame() {
      this._laserRaf = 0;
      const canvas = this._inkLaser;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const rect = this._canvas.getBoundingClientRect();
      const sx = rect.width / this.designWidth, sy = rect.height / this.designHeight;
      const at = ([x, y]) => [rect.left + x * sx, rect.top + y * sy];
      const now = performance.now();
      const slideId = this._inkSlideId();
      let running = false;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = LASER_GLOW;
      for (const [key, entry] of this._lasers) {
        entry.points = entry.points.filter(p => now - p[2] < LASER_MS);
        if (!entry.points.length && !entry.dot) { this._lasers.delete(key); continue; }
        // Only a retracting trail needs frames; a held one is drawn again when points arrive.
        if (entry.points.some(p => p[2] !== Infinity)) running = true;
        if (entry.slideId && slideId && entry.slideId !== slideId) continue;
        // A red glow with a white core, the core drawn second.
        for (const [color, lineWidth, blur] of [[LASER_GLOW, 8, 14], [LASER_CORE, 3, 0]]) {
          ctx.strokeStyle = color;
          ctx.lineWidth = lineWidth;
          ctx.shadowBlur = blur;
          ctx.beginPath();
          entry.points.forEach((p, i) => {
            const [x, y] = at(p);
            if (i === 0 || p[3]) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
        }
        if (entry.dot) {
          const [x, y] = at(entry.dot);
          for (const [color, radius, blur] of [[LASER_GLOW, 8, 20], [LASER_CORE, 4, 0]]) {
            ctx.fillStyle = color;
            ctx.shadowBlur = blur;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.shadowBlur = 0;
      if (running) this._laserRaf = requestAnimationFrame(this._laserFrame);
    }

    /**
     * Strokes being drawn in another window: `liveStroke(key, stroke)` shows
     * or updates one ({ slideId, tool, color, size, points }), only while
     * this window shows that slide; `endLiveStroke(key, { fade })` removes it,
     * fading, or once the saved layer draws it. A laser's points go to its
     * trail instead.
     */
    liveStroke(key, { slideId, tool = 'pen', color = '#e11d48', size = 6, points }) {
      if (!this._inkLive || !points?.length) return;
      this._remoteInk ??= new Map();
      if (tool === 'laser') {
        const seen = this._remoteInk.get(key) ?? 0;
        if (points.length > seen) this.laserTrail(key, slideId, points.slice(seen), { start: seen === 0 });
        this._remoteInk.set(key, points.length);
        return;
      }
      let path = this._remoteInk.get(key);
      if (slideId && slideId !== this._inkSlideId()) { path?.remove?.(); this._remoteInk.delete(key); return; }
      if (!path) {
        path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this._styleLive(path, { tool, color, size });
        this._appendLive(path);
        this._remoteInk.set(key, path);
      }
      this._drawLive(path, points, { tool, size });
    }

    endLiveStroke(key, { fade = false } = {}) {
      const path = this._remoteInk?.get(key);
      if (path == null) return;
      this._remoteInk.delete(key);
      if (typeof path === 'number') { this.laserRelease(key); this.laserDot(key, null, null); return; }
      if (fade) { requestAnimationFrame(() => path.classList.add('fading')); setTimeout(() => path.remove(), 3200); }
      else this._removeLive(path);
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
      const steps = this._getSteps(this._slides[this._index]);
      const curr  = this._stepMap.get(this._index) ?? -1;
      if (steps.length > 0 && curr < steps.length - 1) {
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
      const steps = this._getSteps(this._slides[this._index]);
      const curr  = this._stepMap.get(this._index) ?? -1;
      if (steps.length > 0 && curr >= 0) {
        this._stepMap.set(this._index, curr - 1);
        this._applySteps(this._index);
        this._broadcastState(reason);
        this._flashOverlay();
        return;
      }
      this._go(this._index - 1, reason);
    }
    /** Reset to first slide and clear all step state. */
    reset() {
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
})();
