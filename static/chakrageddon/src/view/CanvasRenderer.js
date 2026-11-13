// 320x180 back buffer presented on the visible canvas at a whole-number scale in device pixels.
export const W = 320, H = 180;

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.back = document.createElement('canvas');
    this.back.width = W; this.back.height = H;
    this.g = this.back.getContext('2d');
    this.g.imageSmoothingEnabled = false;
    this.post = null;            // optional WebGL post-process (set by main.js)
    this.ctx2d = null;
    this.scale = 1;
    this.resize = this.resize.bind(this);
    addEventListener('resize', this.resize);
    addEventListener('orientationchange', this.resize);
    if (window.visualViewport) visualViewport.addEventListener('resize', this.resize);
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const vw = window.innerWidth, vh = window.innerHeight;
    const touch = document.documentElement.classList.contains('touch');
    const portrait = vh > vw;
    const roomW = this.canvas.parentElement?.clientWidth || vw;
    const { fit, scale } = pictureScale({ vw: Math.min(vw, roomW), vh, dpr, touch, portrait, shrink: this.shrink || 0 });
    this.fit = fit; this.scale = scale;
    const cw = Math.round(W * scale), ch = Math.round(H * scale);
    this.cssW = Math.round(cw / dpr); this.cssH = Math.round(ch / dpr);
    const c = this.canvas;
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    c.style.width = `${cw / dpr}px`;
    c.style.height = `${ch / dpr}px`;
    if (this.post) this.post.resize(c.width, c.height);
    // landscape touch: the on-screen controls overlay the picture, so keep them above the text box
    if (touch && !portrait && c.getBoundingClientRect) {
      const r = c.getBoundingClientRect();
      document.documentElement.style.setProperty('--pad-lift', `${padLift(vw, vh, r)}px`);
    }
  }

  /** Copy the back buffer to the screen (through the shader when one is active). */
  present(fx) {
    if (this.post) { if (this.post.ok) this.post.render(this.back, fx); return; }
    if (!this.ctx2d) this.ctx2d = this.canvas.getContext('2d');
    const g = this.ctx2d;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.back, 0, 0, this.canvas.width, this.canvas.height);
  }

  /** Client (CSS pixel) coordinates -> back-buffer coordinates. */
  toGame(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
  }
}

/** How big the picture is drawn, in device pixels per game pixel. Normally the largest whole scale that fits (sharp
 *  pixels), less the steps chosen in Options (Picture size). A phone held upright on Full fills the width instead:
 *  whole steps there leave a band of black down each side (3x of a 393 px phone is 349 px), and at two or three
 *  device pixels per screen pixel the uneven 3-and-4 pixel columns don't show. The picture keeps the top 58% at
 *  most, so the controls below stay as they are. */
export function pictureScale({ vw, vh, dpr, touch, portrait, shrink = 0 }) {
  const availH = touch && portrait ? vh * 0.58 : vh;
  const exact = Math.min((vw * dpr) / W, (availH * dpr) / H);
  const fit = Math.max(1, Math.floor(exact));
  if (touch && portrait && !shrink && exact > fit) return { fit, scale: Math.floor(exact * W) / W };
  return { fit, scale: Math.max(1, fit - shrink) };
}

/** How far up (CSS px from the bottom of the screen) the landscape controls must sit so they never cover the
 *  text box: the bottom 48 of the 180 rows, where dialogue and the battle menu are. With room beside the
 *  picture for the controls, they stay at the bottom (16 px). */
export const TEXT_BOX_ROWS = 48, PAD_SIDE = 150;
export function padLift(vw, vh, rect) {
  if ((vw - rect.width) / 2 >= PAD_SIDE) return 16;
  const boxTop = rect.top + rect.height * (H - TEXT_BOX_ROWS) / H;
  return Math.max(16, Math.round(vh - boxTop + 6));
}
