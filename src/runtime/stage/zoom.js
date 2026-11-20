import { zoomToCamera, cameraToZoom } from '../hotspots.js';
import { flight, durationFor, ease } from '../zoom/camera.js';
import { TAP_SLOP } from './taps.js';
import { ROOM_SCALE } from '../../core/ink.js';

// Zoom: up to this many times the fitted size.
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
//
// An expanded slide (ink/Room.jsx) is the same view from further away: the
// slide at ROOM_SCALE in the top left corner and room to write around it,
// which is the slide's own surface, only larger. Zooming and moving then
// go as far as that room does.
export const ZOOM_MAX = 6;

export const Zoom = (Base) => class extends Base {
  constructor() {
    super();
    this._zoom = null;
    this._zoomRaf = 0;
    this._touches = new Map();
    this._onWheel = this._onWheel.bind(this);
    this._onGesture = this._onGesture.bind(this);
  }

  get zoom() {
    return this._zoom ? { ...this._zoom } : this._wholeZoom();
  }

  // The view without a zoom: the whole slide, or the expanded slide and its room.
  _zoomMin() { return this.expanded ? ROOM_SCALE : 1; }
  _wholeZoom() {
    const scale = this._zoomMin();
    return { scale, x: this.designWidth / scale / 2, y: this.designHeight / scale / 2 };
  }

  /** Whether the slide shows small, with room around it. */
  get expanded() { return this.hasAttribute('data-expanded'); }
  /**
   * Shows the slide small in the top left corner with room around it, or
   * whole again; `animate` moves there. The room and its ink (the stage's
   * `room` slots) show while data-room is set, which outlasts the way back.
   */
  setExpanded(on, { animate = true } = {}) {
    on = !!on;
    if (on === this.expanded) return;
    this._stopZoomFlight();
    this._hotspot = null;
    this._zoom = null;
    this.removeAttribute('data-zoomed');
    this.toggleAttribute('data-expanded', on);
    if (on) this.setAttribute('data-room', '');
    clearTimeout(this._roomTimer);
    const still = !animate || document.hidden || this.hasAttribute('noscale') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this._canvas.style.transition = still ? '' : 'transform 240ms ease';
    this._fit();
    const settle = () => { this._canvas.style.transition = ''; if (!this.expanded) this.removeAttribute('data-room'); };
    if (still) settle();
    else this._roomTimer = setTimeout(settle, 260);
    this.dispatchEvent(new CustomEvent('expandchange', { detail: { expanded: on } }));
  }

  setZoom(zoom, reason = 'api', { announce = true, flying = false } = {}) {
    // A pinch, a pan or another window's zoom takes over from a flight,
    // and the view is no longer a hotspot's.
    if (!flying) { this._stopZoomFlight(); this._hotspot = null; }
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
    const min = this._zoomMin();
    const scale = Math.min(ZOOM_MAX, Math.max(min, Number(zoom.scale) || 1));
    if (scale <= min * 1.01) return null;
    const rect = this.getBoundingClientRect();
    // Half the view, in design pixels; a view wider than the slide stays centred.
    const half = length => length / 2 / ((this._fitScale || 1) * scale);
    const clamp = (value, h, size) => h >= size / 2 ? size / 2 : Math.min(size - h, Math.max(h, value));
    const x = clamp(Number(zoom.x), half(rect.width || window.innerWidth), this.designWidth / min);
    const y = clamp(Number(zoom.y), half(rect.height || window.innerHeight), this.designHeight / min);
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
    if (this._overview || e.pointerType !== 'touch' || !this.hasAttribute('data-zoomable') || this._inInkUi(e)) return false;
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
      this.setZoom(this._zoomKeeping(this._pinch.point, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], Math.min(ZOOM_MAX, Math.max(this._zoomMin(), scale))), 'pinch');
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
    if (this._overview || !this.hasAttribute('data-zoomable') || this._inInkUi(e)) return;
    if (e.ctrlKey) {
      e.preventDefault();
      const zoom = this.zoom;
      const scale = Math.min(ZOOM_MAX, Math.max(this._zoomMin(), zoom.scale * Math.exp(-e.deltaY / 100)));
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

  /**
   * Fly to `zoom` ({ scale, x, y }, or null for the whole slide) along a
   * smooth zoom path. Announced once, at the start, with `fly: true` and
   * where it lands, so other windows fly along.
   */
  flyZoom(zoom, reason = 'api', { announce = true } = {}) {
    this._stopZoomFlight();
    const design = { width: this.designWidth, height: this.designHeight };
    const whole = this._wholeZoom();
    const to = this._clampZoom(zoom);
    // Others get the view asked for and keep it on the slide themselves:
    // their screens may have another shape.
    if (announce) {
      const { scale, x, y } = to ? zoom : whole;
      this.dispatchEvent(new CustomEvent('zoomchange', { detail: { slideId: this._inkSlideId(), scale, x, y, reason, fly: true }, bubbles: true, composed: true }));
    }
    const land = () => {
      this._zoomRaf = 0;
      this.removeAttribute('data-zoom-flying');
      this.setZoom(to, reason, { announce: false, flying: true });
    };
    const from = zoomToCamera(this.zoom, design), end = zoomToCamera(to ?? whole, design);
    const path = flight(from, end);
    // A hidden window gets no animation frames: it lands at once.
    if (document.hidden || this.hasAttribute('noscale') || typeof requestAnimationFrame !== 'function' || path.length < 1e-3) { land(); return; }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      land();
      this._canvas.animate?.([{ opacity: 0.4 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
      return;
    }
    const start = performance.now();
    const duration = durationFor(path.length);
    this.setAttribute('data-zoom-flying', '');
    const frame = now => {
      const t = (now - start) / duration;
      if (t >= 1) { land(); return; }
      this.setZoom(cameraToZoom(path.at(ease(Math.max(0, t))), design), reason, { announce: false, flying: true });
      this._zoomRaf = requestAnimationFrame(frame);
    };
    this._zoomRaf = requestAnimationFrame(frame);
  }

  _stopZoomFlight() {
    if (!this._zoomRaf) return;
    cancelAnimationFrame(this._zoomRaf);
    this._zoomRaf = 0;
    this.removeAttribute('data-zoom-flying');
  }
};
