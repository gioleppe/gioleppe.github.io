// One vertical menu: the building block of every screen (title, pause, settings, saves, confirmations, game over).
// Keyboard: up/down (W/S) move, Enter / Space / E choose, left/right (A/D) change a slider or a switch, Esc or
// Backspace goes back. Mouse: hover highlights, click chooses, the wheel scrolls. Touch: tap chooses, a drag
// scrolls a list taller than its box. A slider row has two tap zones at its right end (‹ and ›).
//
// Items: { id, label, detail?, kind?: 'button'|'toggle'|'slider'|'text', disabled?, tone?: 'danger'|'quiet',
//          value?: () => string, onSelect?: () => void, onAdjust?: (dir: -1|1) => void }
// Layout is the pure `menuRows`; drawing and hit-testing use the rows of the last draw.
import { SCREEN_COLORS as C, font, ellipsize, inRect, measurer } from './theme.js';

const TAP_SLOP = 5;

/**
 * Row boxes of a menu in a rectangle (before scrolling).
 * @param {Array<Object>} items
 * @param {{x:number,y:number,w:number}} rect
 * @param {number} rowH height of a one-line row
 * @param {number} detailH extra height of a row with a detail line
 * @returns {{ rows: Array<{ index: number, x: number, y: number, w: number, h: number, dec?: Object, inc?: Object }>, total: number }}
 */
export function menuRows(items, rect, rowH, detailH) {
  const rows = [];
  let y = 0;
  items.forEach((it, index) => {
    const h = rowH + (it.detail ? detailH : 0);
    const row = { index, x: rect.x, y: rect.y + y, w: rect.w, h };
    if (it.kind === 'slider') {
      const z = Math.min(rowH, Math.floor(rect.w / 4));
      row.inc = { x: rect.x + rect.w - z, y: row.y, w: z, h };
      row.dec = { x: row.inc.x - z, y: row.y, w: z, h };
    }
    rows.push(row);
    y += h;
  });
  return { rows, total: y };
}

/** total height of a menu's rows */
export function menuHeight(items, rowH, detailH) {
  return items.reduce((s, it) => s + rowH + (it.detail ? detailH : 0), 0);
}

const selectable = (it) => !!it && it.kind !== 'text' && !it.disabled;

export class Menu {
  /**
   * @param {{ items: Array<Object>, onBack?: () => void, cursorId?: string }} opts
   */
  constructor({ items = [], onBack = null, cursorId = null } = {}) {
    this.items = items;
    this.onBack = onBack;
    this.cursor = 0;
    this.hover = -1;
    this.scroll = 0;
    this.drag = null;
    /** rows of the last draw (screen coordinates, scrolled) and the visible box */
    this.rows = [];
    this.box = null;
    this.total = 0;
    this.setItems(items, cursorId);
  }

  /** replace the items, keeping the cursor on the same id when it is still there */
  setItems(items, cursorId = this.items[this.cursor]?.id) {
    this.items = items;
    const i = items.findIndex((it) => it.id === cursorId && selectable(it));
    this.cursor = i >= 0 ? i : Math.max(0, items.findIndex(selectable));
    this.reveal = true;
  }

  get current() { return this.items[this.cursor] ?? null; }

  move(d) {
    const n = this.items.length;
    if (!n) return;
    let i = this.cursor;
    for (let k = 0; k < n; k++) {
      i = (i + d + n) % n;
      if (selectable(this.items[i])) { this.cursor = i; this.reveal = true; return; }
    }
  }

  activate(i = this.cursor) {
    const it = this.items[i];
    if (!selectable(it)) return false;
    this.cursor = i;
    if (it.kind === 'slider') { it.onAdjust?.(1); return true; }
    if (it.kind === 'toggle') { (it.onAdjust ?? (() => it.onSelect?.()))(1); return true; }
    it.onSelect?.();
    return true;
  }

  adjust(d) {
    const it = this.current;
    if (!selectable(it) || (it.kind !== 'slider' && it.kind !== 'toggle')) return false;
    (it.onAdjust ?? (() => it.onSelect?.()))(d);
    return true;
  }

  /** @returns {boolean} always true: an open menu owns the keyboard */
  onKey(code, repeat = false) {
    if (code === 'ArrowUp' || code === 'KeyW') this.move(-1);
    else if (code === 'ArrowDown' || code === 'KeyS') this.move(1);
    else if (code === 'ArrowLeft' || code === 'KeyA') this.adjust(-1);
    else if (code === 'ArrowRight' || code === 'KeyD') this.adjust(1);
    else if (!repeat && (code === 'Enter' || code === 'NumpadEnter' || code === 'Space' || code === 'KeyE')) this.activate();
    else if (!repeat && (code === 'Escape' || code === 'Backspace')) this.onBack?.();
    return true;
  }

  rowAt(x, y) {
    if (this.box && !inRect(this.box, x, y)) return null;
    return this.rows.find((r) => inRect(r, x, y)) ?? null;
  }

  /**
   * A pointer or wheel event in logical pixels: { type: 'down'|'move'|'up', id, x, y, mouse? } or { type: 'wheel', dy }.
   * @returns {string|null} what it did
   */
  handlePointer(ev) {
    if (ev.type === 'wheel') { this.scrollBy(ev.dy > 0 ? 24 : -24); return 'scroll'; }
    if (ev.type === 'cancel') { this.drag = null; return null; }
    if (ev.type === 'down') {
      const row = this.rowAt(ev.x, ev.y);
      this.drag = { id: ev.id, x: ev.x, y: ev.y, sx: ev.x, sy: ev.y, moved: false, row: row?.index ?? -1 };
      if (row) this.hover = row.index;
      return null;
    }
    if (ev.type === 'move') {
      const d = this.drag;
      if (!d || d.id !== ev.id) {
        if (ev.mouse) { const r = this.rowAt(ev.x, ev.y); this.hover = r ? r.index : -1; if (r && selectable(this.items[r.index])) this.cursor = r.index; }
        return null;
      }
      if (!d.moved && Math.abs(ev.x - d.sx) + Math.abs(ev.y - d.sy) > TAP_SLOP) d.moved = true;
      if (d.moved) this.scrollBy(d.y - ev.y);
      d.x = ev.x;
      d.y = ev.y;
      return d.moved ? 'scroll' : null;
    }
    if (ev.type !== 'up') return null;
    const d = this.drag;
    this.drag = null;
    if (!d || d.id !== ev.id || d.moved) return d?.moved ? 'scroll' : null;
    const row = this.rowAt(ev.x, ev.y);
    if (!row || row.index !== d.row) return null;
    const it = this.items[row.index];
    if (!selectable(it)) return null;
    this.cursor = row.index;
    if (it.kind === 'slider') {
      if (row.dec && inRect(row.dec, ev.x, ev.y)) { it.onAdjust?.(-1); return 'adjust'; }
      it.onAdjust?.(1);
      return 'adjust';
    }
    this.activate(row.index);
    return 'select';
  }

  scrollBy(d) {
    if (!this.box) return;
    this.scroll = Math.max(0, Math.min(this.scroll + d, Math.max(0, this.total - this.box.h)));
  }

  /**
   * Draw the rows into `box` (scrolling when they do not fit).
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x:number,y:number,w:number,h:number}} box
   * @param {{ rowH: number, detailH: number, fontPx: number, detailPx: number, align?: 'left'|'center' }} st
   */
  draw(ctx, box, st) {
    const { rows, total } = menuRows(this.items, { x: box.x, y: box.y, w: box.w }, st.rowH, st.detailH);
    this.box = box;
    this.total = total;
    if (this.reveal && rows[this.cursor]) {
      const r = rows[this.cursor];
      const top = r.y - box.y;
      if (top < this.scroll) this.scroll = top;
      else if (top + r.h > this.scroll + box.h) this.scroll = top + r.h - box.h;
      this.reveal = false;
    }
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, total - box.h)));
    const off = this.scroll;
    this.rows = rows.map((r) => ({ ...r, y: r.y - off, dec: r.dec && { ...r.dec, y: r.dec.y - off }, inc: r.inc && { ...r.inc, y: r.inc.y - off } }));
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    const center = st.align === 'center';
    for (const r of this.rows) {
      if (r.y + r.h < box.y || r.y > box.y + box.h) continue;
      const it = this.items[r.index];
      const sel = r.index === this.cursor && selectable(it);
      const off2 = !selectable(it);
      if (sel) {
        // a centred menu highlights around its label; a list highlights the whole row
        ctx.font = font(st.fontPx, 'bold ');
        const lw = center && !it.value ? Math.min(r.w, Math.ceil(Math.max(ctx.measureText(it.label).width, 40)) + 28) : r.w;
        const lx = Math.round(r.x + (r.w - lw) / 2);
        ctx.fillStyle = C.highlight;
        ctx.fillRect(lx, r.y + 1, lw, r.h - 2);
        ctx.fillStyle = C.amber;
        ctx.fillRect(lx, r.y + 2, 2, r.h - 4);
      }
      const lineH = st.rowH;
      const cy = r.y + lineH / 2 + 1;
      const color = off2 ? C.dim : it.tone === 'danger' ? (sel ? C.amber : '#d98a5f') : sel ? C.amber : it.tone === 'quiet' ? C.dim : C.bone;
      ctx.font = font(st.fontPx, sel ? 'bold ' : '');
      ctx.textBaseline = 'middle';
      const m = measurer(ctx);
      const pad = 7;
      let valueW = 0;
      if (it.value) {
        const v = it.kind === 'slider' ? `‹ ${it.value()} ›` : it.value();
        ctx.textAlign = 'right';
        ctx.fillStyle = off2 ? C.dim : sel ? C.amber : C.sand;
        ctx.fillText(v, r.x + r.w - 4, cy);
        valueW = m(v) + 8;
      }
      ctx.fillStyle = color;
      if (center && !it.value) {
        ctx.textAlign = 'center';
        ctx.fillText(ellipsize(it.label, r.w - pad * 2, m), r.x + r.w / 2, cy);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(ellipsize(it.label, r.w - pad - valueW - 2, m), r.x + pad, cy);
      }
      if (it.detail) {
        ctx.font = font(st.detailPx);
        ctx.fillStyle = off2 ? C.dim : C.dim;
        const dm = measurer(ctx);
        const dy = r.y + lineH + st.detailH / 2 - 1;
        if (center) { ctx.textAlign = 'center'; ctx.fillText(ellipsize(it.detail, r.w - pad * 2, dm), r.x + r.w / 2, dy); }
        else { ctx.textAlign = 'left'; ctx.fillText(ellipsize(it.detail, r.w - pad - 2, dm), r.x + pad, dy); }
      }
    }
    ctx.restore();
    if (total > box.h) {
      const h = Math.max(8, Math.round((box.h * box.h) / total));
      const y = Math.round(box.y + (this.scroll / (total - box.h)) * (box.h - h));
      ctx.fillStyle = 'rgba(233, 226, 207, 0.35)';
      ctx.fillRect(box.x + box.w + 1, y, 2, h);
    }
  }
}
