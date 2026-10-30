import { inkPaint, snapAngle, spacedPoints, INK_SPACING } from '../../core/ink.js';

const CLICK_AFTER_INK_MS = 400;
// Holding the pen still this long turns the stroke into a straight line.
const STRAIGHTEN_MS = 500;
const STRAIGHTEN_SLOP = 6;  // CSS px the pen may tremble while held

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
export const Ink = (Base) => class extends Base {
  constructor() {
    super();
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerOut = this._onPointerOut.bind(this);
    this._onTouch = this._onTouch.bind(this);
    this._onClickCapture = this._onClickCapture.bind(this);
    // Drawing starts with the laser pointer on a touch screen (an iPad),
    // where pointing is the common case, and with the pen on a computer.
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.inkTool = { tool: touch ? 'laser' : 'pen', color: '#e11d48', size: 6 };
    this.inkRenderer = null;
    this._inkUpAt = 0;
  }

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
    const pen = tool === 'pen' || tool === 'highlighter';
    // A pen or highlighter keeps only points a little apart (INK_SPACING in
    // core/ink.js); the stroke drawn now is the one that is saved.
    const kept = pen ? spacedPoints(drawing.points[drawing.points.length - 1], added) : added;
    drawing.points.push(...kept);
    const last = drawing.points[drawing.points.length - 1];
    if (pen) this._holdStill(drawing, e);
    if (pen && !kept.length) return;
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
      else if (Math.hypot(point[0] - last[0], point[1] - last[1]) >= INK_SPACING - 1e-9) drawing.points.push([point[0], point[1], last[2]]);
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
    if (tool === 'highlighter') { path.setAttribute('data-under', ''); path.setAttribute('data-tool', 'highlighter'); }
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
   * of a selected straight line; null clears it. `remove` places a button
   * that deletes the selection (it calls `inkSelectionRemove`): `at`, a
   * point in design pixels, and `toward`, the direction in which the button
   * sits off it.
   */
  showSelection(selection) {
    const { box = null, lasso = null, handles = [], remove = null } = selection ?? {};
    this._selectionDeleteAt = remove;
    this._placeSelectionDelete();
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

  _placeSelectionDelete() {
    const button = this._selectionDelete;
    if (!button) return;
    const place = this._selectionDeleteAt;
    const canvas = place && this._canvas.getBoundingClientRect();
    if (!canvas?.width) { button.removeAttribute('data-shown'); return; }
    const [dx, dy] = place.toward ?? [0, -1];
    const length = Math.hypot(dx, dy) || 1;
    const OFF = 34, EDGE = 26; // screen pixels: the button's centre off the point, and off the window's edge
    const x = canvas.left + place.at[0] * canvas.width / this.designWidth + dx / length * OFF;
    const y = canvas.top + place.at[1] * canvas.height / this.designHeight + dy / length * OFF;
    const clamp = (value, max) => Math.min(max - EDGE, Math.max(EDGE, value));
    button.style.left = `${clamp(x, window.innerWidth)}px`;
    button.style.top = `${clamp(y, window.innerHeight)}px`;
    button.setAttribute('data-shown', '');
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
};
