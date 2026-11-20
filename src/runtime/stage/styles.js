// The stage's shadow DOM stylesheet.
export const stylesheet = `
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
  slot:not([name])::slotted(*) {
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
  slot:not([name])::slotted([data-deck-active]) {
    opacity: 1;
    pointer-events: auto;
    visibility: visible;
  }

  /* The room around an expanded slide (stage/zoom.js): its ground behind
     the slides and its ink above them, as far as the slide's surface
     reaches at ROOM_SCALE (two thirds: one and a half times each way). */
  slot[name]::slotted(*) { position: absolute; left: 0; top: 0; width: 150%; height: 150%; display: none; pointer-events: none; overflow: hidden; }
  :host([data-room]:not([data-overview]):not([data-deck-static])) slot[name]::slotted(*) { display: block; }

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
  /* Deleting a selection, beside it; placed in screen pixels by
     _placeSelectionDelete so it keeps its size when the slide zooms. */
  .ink-selection-delete {
    position: fixed;
    z-index: 2147483000;
    display: none;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    margin: -22px 0 0 -22px;
    padding: 0;
    border: 1px solid #3a3a3a;
    border-radius: 50%;
    background: rgba(22, 22, 22, 0.94);
    color: #e6e6e6;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .ink-selection-delete[data-shown] { display: inline-flex; }
  .ink-selection-delete svg { width: 20px; height: 20px; }
  :host([data-overview]) .ink-selection-delete, :host(:not([data-inking])) .ink-selection-delete { display: none; }
  /* Overview (O): every slide in a grid, local to this window. The slides
     keep their place in the canvas, which grows to hold the grid; a
     sizer gives the stage the grid's height to scroll. */
  .ov-cells, .ov-sizer { display: none; }
  :host([data-overview]) { touch-action: pan-y; }
  :host([data-overview]) .stage { display: block; overflow-x: hidden; overflow-y: auto; touch-action: pan-y; -webkit-overflow-scrolling: touch; }
  :host([data-overview]) .canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; background: none; }
  :host([data-overview]) .ov-sizer { display: block; }
  :host([data-overview]) slot:not([name])::slotted(*) {
    inset: auto !important;
    left: var(--ov-x, 0) !important;
    top: var(--ov-y, 0) !important;
    width: var(--deck-design-w) !important;
    height: var(--deck-design-h) !important;
    opacity: 1;
    visibility: visible;
    pointer-events: none;
  }
  :host([data-overview]) .ink-live, :host([data-overview]) .hotspots, :host([data-overview]) .zoom-reset, :host([data-overview]) .overlay { display: none; }
  :host([data-overview]) .ov-cells { display: block; position: absolute; inset: 0; z-index: 3; }
  .ov-cell {
    position: absolute;
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 4px;
    outline: calc(3px * var(--ov-k, 1)) solid rgba(255, 255, 255, 0.18);
    background: transparent;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .ov-cell:hover { outline-color: rgba(255, 255, 255, 0.6); }
  .ov-cell[data-current] { outline-color: #e11d48; }
  .ov-cell[data-cursor] { outline: calc(5px * var(--ov-k, 1)) solid #4da3ff; outline-offset: calc(3px * var(--ov-k, 1)); }
  .ov-cell span {
    position: absolute;
    left: 0;
    top: 100%;
    transform: scale(var(--ov-k, 1));
    transform-origin: 0 0;
    margin-top: calc(6px * var(--ov-k, 1));
    max-width: calc(100% / var(--ov-k, 1));
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: #bbb;
    font: 13px/1.3 system-ui, -apple-system, sans-serif;
    text-align: left;
  }
  .ov-cell[data-current] span { color: #fff; }

  /* Black screen (B): the screens the audience sees go black; the
     presenter's own slide stays visible under a veil, to say so. */
  .blank {
    position: fixed;
    inset: 0;
    z-index: 2147482900;
    background: #000;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity 0.3s ease, visibility 0s linear 0.3s;
  }
  :host([data-blank]) .blank { opacity: 1; visibility: visible; pointer-events: auto; transition: opacity 0.3s ease; }
  :host([data-presenter]) .blank { background: rgba(0, 0, 0, 0.6); pointer-events: none; }
  :host([data-deck-static]) .blank { display: none; }
  /* Hotspots: a numbered key at the corner of each part of the slide the
     presenter can zoom to (in design pixels, inside the canvas; the badge
     keeps its size on screen). Only the presenter's own slide shows them. */
  .hotspots { position: absolute; inset: 0; z-index: 2; pointer-events: none; display: none; }
  :host([data-hotspot-badges]) .hotspots { display: block; }
  :host([data-zoomed]) .hotspots, :host([data-zoom-flying]) .hotspots, :host([data-deck-static]) .hotspots { display: none; }
  .hotspot {
    position: absolute;
    z-index: 1;
    min-width: 24px;
    height: 24px;
    padding: 0 6px;
    box-sizing: border-box;
    transform: scale(var(--hotspot-k, 1)) translate(-35%, -35%);
    transform-origin: 0 0;
    border: 1px solid rgba(255, 255, 255, 0.45);
    border-radius: 7px;
    background: rgba(17, 17, 17, 0.82);
    color: #fff;
    font: 600 13px/22px ui-monospace, SFMono-Regular, Menlo, monospace;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    cursor: zoom-in;
    pointer-events: auto;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .hotspot:hover { background: #e11d48; border-color: #e11d48; }
  .hotspot-area {
    position: absolute;
    border-radius: 6px;
    outline: calc(2px * var(--hotspot-k, 1)) dashed #e11d48;
    outline-offset: calc(4px * var(--hotspot-k, 1));
    opacity: 0;
    transition: opacity 0.15s;
    pointer-events: none;
  }
  .hotspot:hover + .hotspot-area { opacity: 1; }
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
  .ink-live path[data-tool="highlighter"] { mix-blend-mode: var(--highlighter-blend, multiply); }
  /* The ink toolbar replaces the overlay while drawing. */
  :host([data-inking]) .overlay { display: none; }
  .btn.draw, .btn.fullscreen, .btn.overview { display: none; }
  /* The overview is for a stage that is the page (data-zoomable). */
  :host([data-zoomable]) .btn.overview { display: inline-flex; }
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
    slot:not([name])::slotted(*) {
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
    slot:not([name])::slotted(*:last-child) {
      break-after: auto;
      page-break-after: auto;
    }
    .overlay, .ink-input, .ink-live, .ink-laser, .zoom-reset, .hotspots, .blank, .ov-cells, .ov-sizer { display: none !important; }
    slot[name]::slotted(*) { display: none !important; }
  }
`;
