// Keyboard + gamepad + on-screen touch input mapped to abstract actions.
const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'KeyZ', 'KeyK', 'ArrowUp', 'KeyW'],
  fire: ['KeyX', 'KeyJ', 'KeyL', 'ShiftLeft', 'ShiftRight'],
  pause: ['Escape', 'KeyP'],
  start: ['Enter', 'Space', 'KeyZ', 'KeyX', 'KeyJ'],
  mute: ['KeyM'],
  fps: ['KeyF'],
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.cur = new Set();
    this.prev = new Set();
    this.anyPressed = false;
    this.touch = null; // TouchControls, attached by the game
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.anyPressed = true;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  update() {
    this.prev = this.cur;
    const cur = new Set();
    for (const [action, codes] of Object.entries(KEYS)) {
      if (codes.some((c) => this.keys.has(c))) cur.add(action);
    }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const b = (i) => p.buttons[i] && p.buttons[i].pressed;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (ax < -0.4 || b(14)) cur.add('left');
      if (ax > 0.4 || b(15)) cur.add('right');
      if (ay < -0.5 || b(12)) cur.add('up');
      if (ay > 0.5 || b(13)) cur.add('down');
      if (b(0)) { cur.add('jump'); cur.add('start'); }
      if (b(1) || b(2) || b(5) || b(7)) { cur.add('fire'); cur.add('start'); }
      if (b(9)) cur.add('pause');
      if (b(0) || b(1) || b(2) || b(9)) this.anyPressed = true;
    }
    if (this.touch) this.touch.collect(cur);
    this.cur = cur;
  }

  down(a) { return this.cur.has(a); }
  pressed(a) { return this.cur.has(a) && !this.prev.has(a); }
  released(a) { return !this.cur.has(a) && this.prev.has(a); }
  axisX() { return (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0); }
}
