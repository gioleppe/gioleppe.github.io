// The opening of a new game (step 5.1): three lines over black in the Journal's voice ("Washed up"), then the
// crash site fades in and the controls are given back. Any key or tap skips to the fade. With `{ fadeOnly: true }`
// (a retry without a save) only the fade plays. The world stands still until the game screen takes over.
import { SCREEN_COLORS as C, font, safeArea, wrapText, measurer, TITLE_FONT } from './theme.js';

export const OPENING_LINES = Object.freeze([
  'The storm put me on the reef before dawn.',
  'The surf did the rest.',
  'I know whose island this is.',
]);

/**
 * Where the opening is at `t` seconds: each line's opacity, the black's opacity, and whether it is over.
 * @param {number} t seconds since it began
 * @param {{ lineSeconds: number, holdSeconds: number, fadeSeconds: number, lineFade: number }} cfg tuning.screens.opening
 * @param {{ lines?: number, skippedAt?: number|null, fadeOnly?: boolean }} [o]
 * @returns {{ lineAlpha: number[], black: number, done: boolean }}
 */
export function openingState(t, cfg, { lines = OPENING_LINES.length, skippedAt = null, fadeOnly = false } = {}) {
  const textEnd = fadeOnly ? 0 : lines * cfg.lineSeconds + cfg.holdSeconds;
  // a skip jumps straight to the fade
  const fadeStart = skippedAt != null ? Math.min(skippedAt, textEnd) : textEnd;
  const lineAlpha = [];
  for (let i = 0; i < lines; i++) {
    if (fadeOnly) { lineAlpha.push(0); continue; }
    const a = Math.min(1, Math.max(0, (t - i * cfg.lineSeconds) / cfg.lineFade));
    const out = Math.min(1, Math.max(0, (t - fadeStart) / cfg.lineFade));
    lineAlpha.push(Math.max(0, a - out));
  }
  const ft = (t - fadeStart - (fadeOnly ? 0 : cfg.lineFade)) / cfg.fadeSeconds;
  const black = t < fadeStart + (fadeOnly ? 0 : cfg.lineFade) ? 1 : Math.max(0, 1 - ft);
  return { lineAlpha, black, done: ft >= 1 };
}

export class OpeningScreen {
  constructor(ui) {
    this.ui = ui;
    this.pausesWorld = true;
    this.world = 'game';
    this.hud = false;
    this.t = 0;
    this.skippedAt = null;
    this.fadeOnly = false;
  }

  enter(params = {}) {
    this.t = 0;
    this.skippedAt = null;
    this.fadeOnly = !!params.fadeOnly;
  }

  skip() {
    if (this.skippedAt == null) this.skippedAt = this.t;
  }

  update(dt, now, screens) {
    this.t += Math.min(dt, 0.1);
    if (openingState(this.t, screens.cfg.opening, { skippedAt: this.skippedAt, fadeOnly: this.fadeOnly }).done) {
      screens.show('game', { from: 'opening' });
    }
  }

  onKey(code, repeat) {
    if (!repeat) this.skip();
    return true;
  }

  handlePointer(ev) {
    if (ev.type === 'up') this.skip();
    return null;
  }

  draw(ctx, vp, safe, now, screens) {
    const cfg = screens.cfg;
    const s = openingState(this.t, cfg.opening, { skippedAt: this.skippedAt, fadeOnly: this.fadeOnly });
    ctx.save();
    ctx.globalAlpha = s.black;
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, 0, vp.uiLogicalWidth, vp.uiLogicalHeight);
    const area = safeArea(vp, safe, cfg.margin);
    ctx.font = font(cfg.opening.textPx, 'italic ', TITLE_FONT);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const m = measurer(ctx);
    const rows = OPENING_LINES.map((l) => wrapText(l, area.w - 8, m));
    const lh = cfg.opening.textPx + 6;
    const total = rows.reduce((n, r) => n + r.length, 0) * lh + (rows.length - 1) * 4;
    let y = Math.round(area.y + area.h / 2 - total / 2 + lh / 2);
    rows.forEach((r, i) => {
      ctx.globalAlpha = s.lineAlpha[i];
      ctx.fillStyle = C.bone;
      for (const line of r) { ctx.fillText(line, Math.round(area.x + area.w / 2), y); y += lh; }
      y += 4;
    });
    if (!this.fadeOnly && s.black > 0.5) {
      ctx.globalAlpha = 0.5 * Math.min(1, this.t);
      ctx.font = font(cfg.detailPx);
      ctx.fillStyle = C.dim;
      ctx.textBaseline = 'bottom';
      ctx.fillText(screens.isTouch() ? 'tap to skip' : 'any key to skip', Math.round(area.x + area.w / 2), area.y + area.h);
    }
    ctx.restore();
  }
}
