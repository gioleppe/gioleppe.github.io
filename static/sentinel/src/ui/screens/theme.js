// Shared look and pure layout helpers of the full-screen menus (title, pause, settings, saves, game over): the
// game's palette (assets/src/palette.gpl), the Journal's type, and the safe-area arithmetic every screen uses.
import { wrapText } from '../DialogueUI.js';

export { wrapText };

/** palette */
export const SCREEN_COLORS = Object.freeze({
  ink: '#0d0b12', face: '#24212c', plate: '#37323f', edge: '#4f4955', bone: '#e9e2cf', dim: '#8f8789',
  amber: '#f2a33a', rust: '#a8522b', teal: '#379a95', sand: '#e7cd98', backdrop: 'rgba(13, 11, 18, 0.72)',
  highlight: 'rgba(242, 163, 58, 0.14)',
});

/** the Journal's UI face; the title is set in a book face */
export const UI_FONT = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';
export const TITLE_FONT = 'Georgia, "Times New Roman", serif';

/** a CSS font string */
export function font(px, style = '', family = UI_FONT) {
  return `${style}${px}px ${family}`;
}

/**
 * The screen minus the safe-area insets and a margin: where every menu must fit.
 * @param {{ uiLogicalWidth: number, uiLogicalHeight: number }} vp
 * @param {{ top?: number, right?: number, bottom?: number, left?: number }} safe
 * @param {number} margin
 */
export function safeArea(vp, safe, margin) {
  const s = { top: safe?.top || 0, right: safe?.right || 0, bottom: safe?.bottom || 0, left: safe?.left || 0 };
  const x = Math.round(s.left + margin);
  const y = Math.round(s.top + margin);
  return { x, y, w: Math.floor(vp.uiLogicalWidth - s.right - margin - x), h: Math.floor(vp.uiLogicalHeight - s.bottom - margin - y) };
}

/**
 * Menu row height: the compact row for a mouse, at least `touchRowCss` CSS pixels on a touch screen.
 * @param {{ scale: number }} vp
 * @param {{ rowHeight: number, touchRowCss: number }} cfg tuning.screens
 */
export function rowHeight(vp, cfg, touch) {
  if (!touch) return cfg.rowHeight;
  const finger = Math.max(cfg.rowHeight, Math.ceil(cfg.touchRowCss / (vp.scale > 0 ? vp.scale : 1)));
  // a very short window (a finger row would be a big slice of it) keeps rows to a fraction of the height
  return Math.max(cfg.rowHeight, Math.min(finger, Math.floor(vp.uiLogicalHeight * cfg.maxRowFraction)));
}

/** a w x h box centred in `area` (clamped to it), whole pixels */
export function centredBox(area, w, h) {
  const bw = Math.min(Math.floor(w), area.w);
  const bh = Math.min(Math.floor(h), area.h);
  return { x: Math.round(area.x + (area.w - bw) / 2), y: Math.round(area.y + (area.h - bh) / 2), w: bw, h: bh };
}

/** text cut with an ellipsis to fit `w` (measure: width at the current font) */
export function ellipsize(s, w, measure) {
  const t = String(s ?? '');
  if (measure(t) <= w) return t;
  let n = t.length;
  while (n > 1 && measure(`${t.slice(0, n)}…`) > w) n--;
  return `${t.slice(0, n)}…`;
}

/** true if r lies inside outer (tolerance eps) */
export function insideRect(r, outer, eps = 1e-6) {
  return r.x >= outer.x - eps && r.y >= outer.y - eps && r.x + r.w <= outer.x + outer.w + eps && r.y + r.h <= outer.y + outer.h + eps;
}

export const inRect = (r, x, y) => !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** a context's measureText as a plain function */
export const measurer = (ctx) => (s) => ctx.measureText(s).width;
