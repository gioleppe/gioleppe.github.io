// Small immediate-mode UI helpers drawn on the 320x180 back buffer.
import { drawText, textWidth, wrap, LINE_H, textProbe } from './font.js';
import { tl } from '../core/i18n.js';

export const C = {
  void: '#0B0314', magenta: '#FF007F', acid: '#00FF66', cyan: '#00F0FF', purple: '#8F00FF',
  cream: '#F9DCC4', marigold: '#F4A261', terracotta: '#E76F51', chai: '#3B2314',
  sand: '#E8C39E', red: '#D90429', grey: '#6C757D', white: '#FFFFFF', ink: '#2A1A2E', yellow: '#FFE066',
};
export const TYPE_COLORS = {
  PSYCHEDELIC: '#C86BFF', STIMULANT: '#FFD23F', DISSOCIATIVE: '#7FD6FF', ORGANIC: '#6CCB5F', DOWNER: '#7C8CD9', BUMMER: '#9A8F9F', NORMAL: '#D8C9B8',
};

export function panel(g, x, y, w, h, opts = {}) {
  const bg = opts.bg || C.cream, border = opts.border || C.ink, accent = opts.accent || C.terracotta;
  g.fillStyle = border; g.fillRect(x + 1, y, w - 2, h); g.fillRect(x, y + 1, w, h - 2);
  g.fillStyle = accent; g.fillRect(x + 1, y + 1, w - 2, h - 2);
  g.fillStyle = bg; g.fillRect(x + 2, y + 2, w - 4, h - 4);
}

/**
 * A vertical (or grid) list with keyboard cursor and tap support.
 * Returns { cursor, chosen } where chosen is the activated index or -1.
 * items: [{ label, right?, color?, disabled? }]
 */
export function list(game, g, items, x, y, w, cursor, opts = {}) {
  const rowH = opts.rowH || 14, cols = opts.cols || 1, colW = Math.floor(w / cols);
  const input = game.input;
  let chosen = -1;
  const n = items.length;
  if (n === 0) return { cursor: 0, chosen };
  cursor = Math.max(0, Math.min(n - 1, cursor));
  if (!opts.passive) {
    // the cursor wraps: down off the last row comes back in at the top of that column, up off the first row lands on
    // the bottom; in a grid, left and right wrap round the row
    const lastRow = Math.floor((n - 1) / cols), row = Math.floor(cursor / cols), col = cursor % cols;
    const at = (r) => Math.min(n - 1, r * cols + col);
    if (input.pressed('down')) cursor = row < lastRow ? at(row + 1) : col;
    if (input.pressed('up')) cursor = row > 0 ? at(row - 1) : at(lastRow);
    if (cols > 1) {
      const first = row * cols, last = Math.min(n - 1, first + cols - 1);
      if (input.pressed('right')) cursor = cursor < last ? cursor + 1 : first;
      if (input.pressed('left')) cursor = cursor > first ? cursor - 1 : last;
    }
    if (input.pressed('a')) chosen = cursor;
  }
  const first = opts.maxRows ? Math.max(0, Math.min(Math.ceil(n / cols) - opts.maxRows, Math.floor(cursor / cols) - Math.floor(opts.maxRows / 2))) : 0;
  const rows = opts.maxRows ? Math.min(opts.maxRows, Math.ceil(n / cols)) : Math.ceil(n / cols);
  const scrolls = !!opts.maxRows && Math.ceil(n / cols) > opts.maxRows;   // leave room for the ^ v arrows
  // touch: a tap inside the list (or just around it) picks the nearest row. Rows shorter than 16 px take two
  // taps, the first one moves the cursor there, so a fat finger cannot confirm the wrong line.
  if (!opts.passive && input.taps?.length) {
    const PAD = 5, tw = cols * colW, th = rows * rowH;
    const k = input.taps.findIndex((t) => t.x >= x - PAD && t.x < x + tw + PAD && t.y >= y - PAD && t.y < y + th + PAD);
    if (k >= 0) {
      const t = input.taps.splice(k, 1)[0];
      const c = Math.max(0, Math.min(cols - 1, Math.floor((t.x - x) / colW))), r = Math.max(0, Math.min(rows - 1, Math.floor((t.y - y) / rowH)));
      const i = Math.min(n - 1, (first + r) * cols + c);
      if (rowH >= 16 || i === cursor || opts.oneTap) chosen = i;
      cursor = i;
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = (first + r) * cols + c;
      if (i >= n) break;
      const it = items[i], ix = x + c * colW, iy = y + r * rowH;
      if (i === cursor && !opts.passive) { g.fillStyle = opts.hi || '#F4A26188'; g.fillRect(ix, iy, colW - 1, rowH - 1); }
      const col = it.disabled ? C.grey : (it.color || opts.color || C.ink);
      if (i === cursor && !opts.passive) drawText(g, '>', ix + 2, iy + Math.floor((rowH - 8) / 2), { color: C.magenta });
      drawText(g, it.label, ix + 9, iy + Math.floor((rowH - 8) / 2), { color: col });
      if (it.right !== undefined) drawText(g, it.right, ix + colW - 4 - (scrolls ? 7 : 0), iy + Math.floor((rowH - 8) / 2), { color: it.rightColor || col, align: 'right' });
    }
  }
  if (opts.maxRows && Math.ceil(n / cols) > opts.maxRows) {
    if (first > 0) drawText(g, '^', x + w - 6, y - 2, { color: C.magenta });
    if (first + rows < Math.ceil(n / cols)) drawText(g, 'v', x + w - 6, y + rows * rowH - 6, { color: C.magenta });
  }
  if (chosen >= 0 && items[chosen].disabled) { chosen = -1; game.audio?.sfx('deny'); }
  else if (chosen >= 0) game.audio?.sfx('select');
  return { cursor, chosen };
}

export function bar(g, x, y, w, h, ratio, color, bg = '#2A1A2E') {
  g.fillStyle = bg; g.fillRect(x, y, w, h);
  g.fillStyle = color; g.fillRect(x + 1, y + 1, Math.max(0, Math.round((w - 2) * Math.max(0, Math.min(1, ratio)))), h - 2);
}

export function typeTag(g, type, x, y) {
  const label = tl(type).slice(0, 5);
  const w = textWidth(label) + 6;
  g.fillStyle = C.ink; g.fillRect(x, y, w, 10);
  g.fillStyle = TYPE_COLORS[type] || C.cream; g.fillRect(x + 1, y + 1, w - 2, 8);
  drawText(g, label, x + 3, y + 1, { color: C.ink });
  return w + 2;
}

/** A move's name, or its short form when the full name is wider than maxW pixels. */
export function moveName(mv, maxW = Infinity) {
  return textWidth(mv.name) <= maxW ? mv.name : (mv.short || mv.name);
}

export { drawText, textWidth, wrap, LINE_H, textProbe };
