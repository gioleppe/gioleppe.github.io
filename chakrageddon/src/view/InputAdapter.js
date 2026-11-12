// Keyboard + touch pad + canvas taps, unified into buttons: up down left right a b start.
const KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  KeyZ: 'a', Enter: 'a', Space: 'a', KeyX: 'b', Escape: 'b', Backspace: 'b', KeyM: 'start', Tab: 'start',
};
export const DEFAULT_KEYS = KEYS;

export class InputAdapter {
  constructor(renderer, { onFirstGesture } = {}) {
    this.renderer = renderer;
    this.held = {};        // button -> true while down
    this.edges = {};       // button -> pressed this frame
    this.taps = [];        // canvas taps this frame, in game coordinates
    this.keys = { ...KEYS };
    this.lastDir = null;
    let unlocked = false;
    const gesture = () => { if (!unlocked) { unlocked = true; onFirstGesture?.(); } };

    addEventListener('keydown', (e) => {
      if (this.capture) { e.preventDefault(); const fn = this.capture; this.capture = null; fn(e.code); return; }
      const b = this.keys[e.code];
      if (!b) return;
      e.preventDefault(); gesture();
      if (!e.repeat) this.press(b);
    });
    addEventListener('keyup', (e) => { const b = this.keys[e.code]; if (b) this.release(b); });
    addEventListener('blur', () => { this.held = {}; });

    // touch devices get the on-screen pad
    const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    if (isTouch) document.documentElement.classList.add('touch');

    for (const el of document.querySelectorAll('[data-btn]')) {
      const b = el.dataset.btn;
      const down = (e) => { e.preventDefault(); gesture(); el.setPointerCapture?.(e.pointerId); el.classList.add('on'); this.press(b); };
      const up = (e) => { e.preventDefault(); el.classList.remove('on'); this.release(b); };
      el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    }

    const dpad = document.getElementById('dpad');
    if (dpad) {
      const set = (dir) => {
        if (dir === this.padDir) return;
        if (this.padDir) this.release(this.padDir);
        this.padDir = dir;
        if (dir) { this.press(dir); dpad.dataset.dir = dir; } else delete dpad.dataset.dir;
      };
      const track = (e) => {
        e.preventDefault(); gesture();
        const r = dpad.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        if (Math.hypot(dx, dy) < r.width * 0.12) return set(null);
        set(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));
      };
      dpad.addEventListener('pointerdown', (e) => { dpad.setPointerCapture?.(e.pointerId); track(e); });
      dpad.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') track(e); });
      const end = (e) => { e.preventDefault(); set(null); };
      dpad.addEventListener('pointerup', end); dpad.addEventListener('pointercancel', end);
    }

    renderer.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault(); gesture();
      this.taps.push(renderer.toGame(e.clientX, e.clientY));
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** custom: { button: keyCode } added on top of the defaults */
  applyKeys(custom = {}) {
    this.keys = { ...KEYS };
    for (const [btn, code] of Object.entries(custom)) { for (const k of Object.keys(this.keys)) if (this.keys[k] === btn && !k.startsWith('Arrow') && k !== 'Enter' && k !== 'Escape') delete this.keys[k]; this.keys[code] = btn; }
  }
  /** call fn(code) with the next key pressed, instead of treating it as input */
  captureKey(fn) { this.capture = fn; }

  /** read the first connected gamepad (standard mapping) */
  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads).find((p) => p && p.connected);
    const now = {};
    if (gp) {
      const B = (i) => !!gp.buttons[i]?.pressed, ax = gp.axes || [];
      now.up = B(12) || ax[1] < -0.5; now.down = B(13) || ax[1] > 0.5; now.left = B(14) || ax[0] < -0.5; now.right = B(15) || ax[0] > 0.5;
      now.a = B(0); now.b = B(1); now.start = B(9) || B(8);
    }
    this.padState ||= {};
    for (const b of ['up', 'down', 'left', 'right', 'a', 'b', 'start']) {
      if (now[b] && !this.padState[b]) this.press(b);
      if (!now[b] && this.padState[b]) this.release(b);
      this.padState[b] = !!now[b];
    }
  }

  press(b) { this.held[b] = true; this.edges[b] = true; if (['up', 'down', 'left', 'right'].includes(b)) this.lastDir = b; }
  release(b) { delete this.held[b]; }
  /** true once per physical press */
  pressed(b) { if (this.edges[b]) { delete this.edges[b]; return true; } return false; }
  /** most recently pressed direction that is still held */
  dir() {
    if (this.lastDir && this.held[this.lastDir]) return this.lastDir;
    return ['up', 'down', 'left', 'right'].find((d) => this.held[d]) || null;
  }
  /** take one tap inside the rectangle, if any */
  tapIn(x, y, w, h) {
    const i = this.taps.findIndex((t) => t.x >= x && t.x < x + w && t.y >= y && t.y < y + h);
    if (i < 0) return false;
    this.taps.splice(i, 1);
    return true;
  }
  anyTap() { if (this.taps.length) { this.taps.length = 0; return true; } return false; }
  endFrame() { this.edges = {}; this.taps.length = 0; }
}
