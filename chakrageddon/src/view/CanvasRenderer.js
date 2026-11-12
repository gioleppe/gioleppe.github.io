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
    // portrait touch layout keeps the lower part of the screen free for the controls
    const availH = touch && portrait ? vh * 0.58 : vh;
    // the largest whole scale that fits (sharp pixels), less the steps chosen in Options (Picture size)
    this.fit = Math.max(1, Math.floor(Math.min((vw * dpr) / W, (availH * dpr) / H)));
    this.scale = Math.max(1, this.fit - (this.shrink || 0));
    this.cssW = Math.round((W * this.scale) / dpr); this.cssH = Math.round((H * this.scale) / dpr);
    const c = this.canvas;
    if (c.width !== W * this.scale) { c.width = W * this.scale; c.height = H * this.scale; }
    c.style.width = `${(W * this.scale) / dpr}px`;
    c.style.height = `${(H * this.scale) / dpr}px`;
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

/** How far up (CSS px from the bottom of the screen) the landscape controls must sit so they never cover the
 *  text box: the bottom 48 of the 180 rows, where dialogue and the battle menu are. With room beside the
 *  picture for the controls, they stay at the bottom (16 px). */
export const TEXT_BOX_ROWS = 48, PAD_SIDE = 150;
export function padLift(vw, vh, rect) {
  if ((vw - rect.width) / 2 >= PAD_SIDE) return 16;
  const boxTop = rect.top + rect.height * (H - TEXT_BOX_ROWS) / H;
  return Math.max(16, Math.round(vh - boxTop + 6));
}
