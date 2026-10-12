// On-screen controls for phones and tablets: a floating joystick on the left
// half of the screen and JUMP / THROW buttons on the right. Everything is
// multi-touch (one pointer per thumb) and feeds the same abstract actions the
// keyboard and gamepad produce, so gameplay code never knows the difference.

const STICK_R = 58;      // px the knob can travel from the joystick centre
const DEAD_X = 0.32;     // horizontal dead zone (fraction of STICK_R)
const DOWN_Y = 0.58;     // push this far down (and mostly downward) to hold "down"

// keep receiving a thumb's moves even after it slides off the element
const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* pointer already gone */ } };

export const isTouchDevice = () =>
  matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);

export class TouchControls {
  constructor(root) {
    this.root = root;
    this.enabled = false;
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.buttons = new Map(); // pointerId -> action name
    this.lastBuzz = 0;

    this.zone = root.querySelector('.stick-zone');
    this.base = root.querySelector('.stick-base');
    this.knob = root.querySelector('.stick-knob');
    this.pad = root.querySelector('.btn-zone');
    this.btnEls = [...root.querySelectorAll('[data-action]')];

    this.zone.addEventListener('pointerdown', (e) => this._stickDown(e));
    this.zone.addEventListener('pointermove', (e) => this._stickMove(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.zone.addEventListener(t, (e) => this._stickUp(e));

    // the button zone hit-tests every move, so a thumb can slide from THROW to JUMP
    this.pad.addEventListener('pointerdown', (e) => this._btn(e, true));
    this.pad.addEventListener('pointermove', (e) => this._btn(e, false));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.pad.addEventListener(t, (e) => this._btnUp(e));

    // no long-press menus, text selection loupes or pinch zoom anywhere in the game
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());

    if (isTouchDevice()) this.enable();
    // touch laptops: switch on the first time a finger actually touches the screen
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.enable(); }, { capture: true });
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    document.body.classList.add('touch');
  }

  /** Actions currently held on screen (merged into Input every frame). */
  collect(out) {
    if (this.stick.id !== null) {
      const nx = this.stick.x / STICK_R, ny = this.stick.y / STICK_R;
      if (nx < -DEAD_X) out.add('left');
      if (nx > DEAD_X) out.add('right');
      if (ny > DOWN_Y && ny > Math.abs(nx) * 0.7) out.add('down');
    }
    for (const a of this.buttons.values()) if (a) out.add(a);
  }

  /** Short vibration for big impacts (Android; iOS ignores it). */
  buzz(ms) {
    if (!this.enabled || !navigator.vibrate) return;
    const now = performance.now();
    if (now - this.lastBuzz < 90) return;
    this.lastBuzz = now;
    try { navigator.vibrate(ms); } catch { /* blocked until first user gesture */ }
  }

  /** Fullscreen + landscape lock where the browser allows it (Android Chrome). */
  async goFullscreen() {
    if (!this.enabled) return;
    const el = document.documentElement;
    try {
      if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      await screen.orientation?.lock?.('landscape');
    } catch { /* iOS Safari and desktop browsers refuse: the rotate hint covers it */ }
  }

  // ------------------------------------------------------------ joystick
  _stickDown(e) {
    if (this.stick.id !== null) return;
    e.preventDefault();
    capture(this.zone, e.pointerId);
    Object.assign(this.stick, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
    this.root.classList.add('stick-active');
    this._drawStick();
  }

  _stickMove(e) {
    const s = this.stick;
    if (e.pointerId !== s.id) return;
    let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) {
      // the base trails the thumb, so reversing direction never needs a long swipe back
      const k = (d - STICK_R) / d;
      s.ox += dx * k; s.oy += dy * k;
      dx = e.clientX - s.ox; dy = e.clientY - s.oy;
    }
    s.x = dx; s.y = dy;
    this._drawStick();
  }

  _stickUp(e) {
    if (e.pointerId !== this.stick.id) return;
    this.stick.id = null;
    this.stick.x = this.stick.y = 0;
    this.root.classList.remove('stick-active');
    this.base.style.transform = '';
    this.knob.style.transform = '';
  }

  _drawStick() {
    const s = this.stick;
    const r = this.zone.getBoundingClientRect();
    this.base.style.transform = `translate(${s.ox - r.left}px, ${s.oy - r.top}px)`;
    this.knob.style.transform = `translate(${s.ox - r.left + s.x}px, ${s.oy - r.top + s.y}px)`;
  }

  // ------------------------------------------------------------- buttons
  _btn(e, down) {
    if (!down && !this.buttons.has(e.pointerId)) return;
    if (down) { e.preventDefault(); capture(this.pad, e.pointerId); }
    const hit = this._hitButton(e.clientX, e.clientY);
    const prev = this.buttons.get(e.pointerId) ?? null;
    if (hit === prev && !down) return;
    this.buttons.set(e.pointerId, hit);
    if (hit && hit !== prev) this.buzz(8);
    this._paintButtons();
  }

  _btnUp(e) {
    if (!this.buttons.delete(e.pointerId)) return;
    this._paintButtons();
  }

  _hitButton(x, y) {
    // nearest button within a generous radius: thumbs are imprecise
    let best = null, bestD = Infinity;
    for (const b of this.btnEls) {
      const r = b.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = Math.hypot(x - cx, y - cy) / (r.width / 2);
      if (d < 1.45 && d < bestD) { bestD = d; best = b.dataset.action; }
    }
    return best;
  }

  _paintButtons() {
    const held = new Set(this.buttons.values());
    for (const b of this.btnEls) b.classList.toggle('held', held.has(b.dataset.action));
  }

  /** Drop every held touch (pause, orientation change, stage transitions). */
  reset() {
    this.buttons.clear();
    this._paintButtons();
    if (this.stick.id !== null) this._stickUp({ pointerId: this.stick.id });
  }
}
