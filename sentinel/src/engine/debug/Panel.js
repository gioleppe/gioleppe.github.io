// The debug panel on #ui: a small "DBG" tab at the top-left that opens into a compact paged list. Usable with
// mouse and touch (the caller registers `rect()` as an InputManager hit region, so taps on it never reach the
// game and the joystick and buttons outside it stay free) and scrolled with the wheel or the ▲▼ row.
//
// Rows are data, rebuilt every frame by the caller's `rows(pageId)`:
//   { label }                                  a heading (no action)
//   { label, run, on?, value? }                a button; `on` draws a check box, `value` is right-aligned text
//   { label?, cells: [{ label, run, on? }] }   several small buttons side by side
// Layout and hit testing are pure (no DOM); only `draw` touches a canvas.

const BG = 'rgba(11, 20, 22, 0.82)';
const LINE = 'rgba(216, 210, 191, 0.25)';
const TEXT = '#d8d2bf';
const DIM = 'rgba(216, 210, 191, 0.55)';
const ON = '#e9c46a';

/** smallest comfortable finger target in CSS pixels; rows are at least this tall on any screen */
const MIN_TOUCH_CSS = 20;

/**
 * Sizes for a viewport: rows at least 9 logical px and at least MIN_TOUCH_CSS CSS px tall.
 * @param {{ uiLogicalWidth: number, uiLogicalHeight: number, scale: number }} vp
 * @param {{ top: number, left: number, bottom?: number }} safe
 */
export function panelMetrics(vp, safe = { top: 0, left: 0 }) {
  const rowH = Math.ceil(Math.max(9, MIN_TOUCH_CSS / (vp.scale > 0 ? vp.scale : 1)));
  const x = Math.round((safe.left || 0) + 2);
  const y = Math.round((safe.top || 0) + 2);
  const w = Math.min(156, Math.floor(vp.uiLogicalWidth - x - 2));
  // leave the lower part of the left half to the joystick, even with the panel open
  const maxH = Math.floor(vp.uiLogicalHeight * 0.62);
  return { x, y, w, rowH, maxH, font: rowH >= 12 ? 7 : 6, tabW: 26 };
}

export class Panel {
  /**
   * @param {Object} opts
   * @param {Array<{ id: string, label: string }>} opts.pages
   * @param {(pageId: string) => object[]} opts.rows
   * @param {{ getItem(k: string): string|null, setItem(k: string, v: string): void }|null} [opts.storage]
   */
  constructor({ pages, rows, storage = null }) {
    this.pages = pages;
    this.rows = rows;
    this.storage = storage;
    this.open = false;   // collapsed by default, every visit
    this.page = 0;
    this.scroll = 0;
    try {
      const saved = storage?.getItem('sentinel.debug.page');
      const i = pages.findIndex((p) => p.id === saved);
      if (i >= 0) this.page = i;
    } catch { /* storage blocked */ }
    /** @type {ReturnType<typeof panelMetrics>} */
    this.m = panelMetrics({ uiLogicalWidth: 480, uiLogicalHeight: 270, scale: 1 });
  }

  /** follow the screen size */
  setViewport(vp, safe) {
    this.m = panelMetrics(vp, safe);
  }

  toggle() { this.open = !this.open; }

  setPage(i) {
    this.page = Math.max(0, Math.min(this.pages.length - 1, i));
    this.scroll = 0;
    try { this.storage?.setItem('sentinel.debug.page', this.pages[this.page].id); } catch { /* ignore */ }
  }

  /** body rows that fit, given the total */
  visibleCount(total) {
    const { rowH, maxH } = this.m;
    const room = Math.floor((maxH - rowH) / rowH);   // minus the header
    return total > room ? room - 1 : total;           // overflow takes one row for ▲▼
  }

  /** the whole panel's rectangle (the hit region) */
  rect() {
    const { x, y, w, rowH, tabW } = this.m;
    if (!this.open) return { x, y, w: tabW, h: rowH };
    const total = this.rows(this.pages[this.page].id).length;
    const n = this.visibleCount(total);
    return { x, y, w, h: rowH * (1 + n + (n < total ? 1 : 0)) };
  }

  /** the right edge, for readouts drawn beside the panel */
  right() {
    const r = this.rect();
    return r.x + r.w;
  }

  /** the header's cells: the collapse tab, then one per page */
  headerCells() {
    const { x, y, w, rowH, tabW } = this.m;
    const cells = [{ kind: 'collapse', x, y, w: tabW, h: rowH }];
    const pw = (w - tabW) / this.pages.length;
    this.pages.forEach((p, i) => cells.push({ kind: 'page', index: i, x: x + tabW + i * pw, y, w: pw, h: rowH }));
    return cells;
  }

  /**
   * The rows on screen (clamping the scroll position to the list).
   * @returns {{ rows: Array<{ row: object, index: number, x: number, y: number, w: number, h: number }>, total: number, shown: number }}
   */
  layoutRows() {
    const { x, y, w, rowH } = this.m;
    const all = this.rows(this.pages[this.page].id);
    const n = this.visibleCount(all.length);
    this.scroll = Math.max(0, Math.min(this.scroll, all.length - n));
    const out = [];
    for (let i = 0; i < n; i++) {
      const index = this.scroll + i;
      out.push({ row: all[index], index, x, y: y + rowH * (1 + i), w, h: rowH });
    }
    return { rows: out, total: all.length, shown: n };
  }

  /** split a row into its cells' rectangles */
  static cellRects(r) {
    const cells = r.row.cells ?? [];
    const lw = r.row.label ? Math.min(44, r.w * 0.3) : 0;
    const cw = (r.w - lw) / Math.max(1, cells.length);
    return cells.map((c, i) => ({ cell: c, x: r.x + lw + i * cw, y: r.y, w: cw, h: r.h }));
  }

  /**
   * What is under a point, without acting on it.
   * @returns {{ kind: 'collapse' } | { kind: 'page', index: number } | { kind: 'scroll', dir: number }
   *   | { kind: 'row', row: object } | { kind: 'cell', cell: object } | null}
   */
  hitTest(px, py) {
    const inside = (r) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
    if (!this.open) return inside(this.rect()) ? { kind: 'collapse' } : null;
    for (const c of this.headerCells()) if (inside(c)) return c.kind === 'page' ? { kind: 'page', index: c.index } : { kind: 'collapse' };
    const { rows, total, shown } = this.layoutRows();
    for (const r of rows) {
      if (!inside(r)) continue;
      if (r.row.cells) {
        for (const c of Panel.cellRects(r)) if (inside(c)) return { kind: 'cell', cell: c.cell };
        return null;
      }
      return r.row.run ? { kind: 'row', row: r.row } : null;
    }
    if (shown < total) {
      const { x, y, w, rowH } = this.m;
      const sy = y + rowH * (1 + shown);
      if (py >= sy && py < sy + rowH && px >= x && px < x + w) return { kind: 'scroll', dir: px < x + w / 2 ? -1 : 1 };
    }
    return null;
  }

  /** act on a tap or click at a point; returns what was hit */
  tap(px, py) {
    const hit = this.hitTest(px, py);
    if (!hit) return null;
    if (hit.kind === 'collapse') this.toggle();
    else if (hit.kind === 'page') this.setPage(hit.index);
    else if (hit.kind === 'scroll') this.scrollBy(hit.dir * Math.max(1, this.layoutRows().shown - 1));
    else if (hit.kind === 'row') hit.row.run();
    else if (hit.kind === 'cell') hit.cell.run?.();
    return hit;
  }

  scrollBy(n) {
    this.scroll = Math.max(0, this.scroll + n);   // the upper limit is applied by layoutRows
  }

  /** @param {CanvasRenderingContext2D} ctx #ui, logical pixels */
  draw(ctx) {
    const { rowH, font } = this.m;
    ctx.save();
    ctx.font = `${font}px ui-monospace, Consolas, monospace`;
    ctx.textBaseline = 'middle';
    const r = this.rect();
    ctx.fillStyle = BG;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const mid = (y) => y + rowH / 2 + 0.5;
    const text = (s, x, y, color = TEXT, align = 'left') => { ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, mid(y)); };

    if (!this.open) {
      text('DBG', r.x + r.w / 2, r.y, ON, 'center');
      ctx.restore();
      return;
    }
    for (const c of this.headerCells()) {
      if (c.kind === 'collapse') text('DBG', c.x + c.w / 2, c.y, ON, 'center');
      else {
        const active = c.index === this.page;
        if (active) { ctx.fillStyle = 'rgba(233, 196, 106, 0.2)'; ctx.fillRect(c.x, c.y, c.w, c.h); }
        text(this.pages[c.index].label, c.x + c.w / 2, c.y, active ? ON : DIM, 'center');
      }
    }
    ctx.fillStyle = LINE;
    ctx.fillRect(r.x, r.y + rowH, r.w, 1);

    const { rows, total, shown } = this.layoutRows();
    for (const lr of rows) {
      const row = lr.row;
      if (row.cells) {
        if (row.label) text(row.label, lr.x + 3, lr.y, DIM);
        for (const c of Panel.cellRects(lr)) {
          if (c.cell.on) { ctx.fillStyle = 'rgba(233, 196, 106, 0.25)'; ctx.fillRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2); }
          ctx.fillStyle = LINE;
          ctx.fillRect(c.x, c.y + 2, 1, c.h - 4);
          text(c.cell.label, c.x + c.w / 2, c.y, c.cell.on ? ON : TEXT, 'center');
        }
      } else if (!row.run) {
        text(row.label, lr.x + 3, lr.y, ON);
      } else {
        let tx = lr.x + 3;
        if (row.on !== undefined) {
          const b = Math.min(5, rowH - 4);
          const by = Math.round(lr.y + (rowH - b) / 2);
          ctx.strokeStyle = row.on ? ON : DIM;
          ctx.lineWidth = 1;
          ctx.strokeRect(tx + 0.5, by + 0.5, b, b);
          if (row.on) { ctx.fillStyle = ON; ctx.fillRect(tx + 2, by + 2, b - 3, b - 3); }
          tx += b + 4;
        }
        text(row.label, tx, lr.y, row.on ? ON : TEXT);
        if (row.value !== undefined) text(String(row.value), lr.x + lr.w - 3, lr.y, DIM, 'right');
      }
    }
    if (shown < total) {
      const { x, y, w } = this.m;
      const sy = y + rowH * (1 + shown);
      ctx.fillStyle = LINE;
      ctx.fillRect(x, sy, w, 1);
      text('▲', x + w / 4, sy, this.scroll > 0 ? TEXT : DIM, 'center');
      text(`${this.scroll + 1}-${this.scroll + shown}/${total}`, x + w / 2, sy, DIM, 'center');
      text('▼', x + (3 * w) / 4, sy, this.scroll + shown < total ? TEXT : DIM, 'center');
    }
    ctx.restore();
  }
}
