// A dark plate with a title, a few lines of text and a menu, centred in the safe area: the pause menu, settings,
// the save slots, confirmations and messages are all one of these. Layout is the pure `panelLayout`.
import { drawDarkPanel } from '../hud/uiArt.js';
import { Menu, menuHeight } from './Menu.js';
import { SCREEN_COLORS as C, font, safeArea, rowHeight, centredBox, wrapText, measurer } from './theme.js';

/**
 * Where a panel's parts go.
 * @param {{ uiLogicalWidth: number, uiLogicalHeight: number, scale: number }} vp
 * @param {Object} safe insets in logical pixels
 * @param {Object} cfg tuning.screens
 * @param {{ width?: number, title?: boolean, textLines?: number, items: Array<Object>, touch?: boolean }} o
 */
export function panelLayout(vp, safe, cfg, { width = cfg.panelWidth, title = true, textLines = 0, items, touch = false }) {
  const area = safeArea(vp, safe, cfg.margin);
  const rowH = rowHeight(vp, cfg, touch);
  const detailH = cfg.detailHeight;
  const pad = cfg.padding;
  const w = Math.min(width, area.w);
  const titleH = title ? cfg.titlePx + 7 : 0;
  const textH = textLines ? textLines * cfg.lineHeight + 5 : 0;
  const menuH = menuHeight(items, rowH, detailH);
  const plate = centredBox(area, w, pad * 2 + titleH + textH + menuH);
  const menu = { x: plate.x + pad, y: plate.y + pad + titleH + textH, w: plate.w - pad * 2, h: Math.max(0, plate.h - pad * 2 - titleH - textH) };
  return { area, plate, rowH, detailH, pad, titleY: plate.y + pad, textY: plate.y + pad + titleH, menu, menuH };
}

export class Panel {
  /**
   * @param {Object} opts
   * @param {string} opts.id
   * @param {string} [opts.title]
   * @param {string|(() => string)} [opts.text] wrapped to the panel's width; '\n' starts a new line
   * @param {Array<Object>|(() => Array<Object>)} opts.items Menu items (a function is re-read by refresh())
   * @param {() => void} [opts.onBack] Esc / Backspace
   * @param {number} [opts.width] logical pixels (default tuning.screens.panelWidth)
   * @param {'left'|'center'} [opts.align]
   */
  constructor({ id, title = '', text = '', items, onBack = null, width = null, align = 'left' }) {
    this.id = id;
    this.title = title;
    this.text = text;
    this.itemsOf = typeof items === 'function' ? items : () => items;
    this.width = width;
    this.align = align;
    this.menu = new Menu({ items: this.itemsOf(), onBack });
    /** a one-line note under the text (e.g. why Save is refused), shown until replaced */
    this.note = null;
    this.layout = null;
  }

  /** re-read the items (after something they show changed) */
  refresh() {
    this.menu.setItems(this.itemsOf());
  }

  onKey(code, repeat) { return this.menu.onKey(code, repeat); }

  handlePointer(ev) { return this.menu.handlePointer(ev); }

  /** the text lines at the panel's inner width */
  lines(ctx, cfg, innerW) {
    const raw = typeof this.text === 'function' ? this.text() : this.text;
    ctx.font = font(cfg.fontPx);
    const m = measurer(ctx);
    const out = [];
    for (const para of String(raw ?? '').split('\n')) if (para) out.push(...wrapText(para, innerW, m));
    if (this.note) for (const l of wrapText(this.note.text, innerW, m)) out.push({ text: l, color: this.note.color });
    return out.map((l) => (typeof l === 'string' ? { text: l } : l));
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} vp
   * @param {Object} safe
   * @param {Object} cfg tuning.screens
   * @param {{ touch?: boolean }} [o]
   */
  draw(ctx, vp, safe, cfg, { touch = false } = {}) {
    const width = this.width ?? cfg.panelWidth;
    const probe = panelLayout(vp, safe, cfg, { width, title: !!this.title, items: this.menu.items, touch });
    const lines = this.lines(ctx, cfg, probe.plate.w - probe.pad * 2);
    const L = panelLayout(vp, safe, cfg, { width, title: !!this.title, textLines: lines.length, items: this.menu.items, touch });
    this.layout = L;
    ctx.save();
    drawDarkPanel(ctx, L.plate.x, L.plate.y, L.plate.w, L.plate.h);
    ctx.textBaseline = 'top';
    if (this.title) {
      ctx.font = font(cfg.titlePx, 'bold ');
      ctx.fillStyle = C.bone;
      ctx.textAlign = this.align === 'center' ? 'center' : 'left';
      ctx.fillText(this.title, this.align === 'center' ? L.plate.x + L.plate.w / 2 : L.plate.x + L.pad + 1, L.titleY + 1);
      ctx.fillStyle = C.rust;
      ctx.fillRect(L.plate.x + L.pad, L.titleY + cfg.titlePx + 3, L.plate.w - L.pad * 2, 1);
    }
    ctx.font = font(cfg.fontPx);
    ctx.textAlign = 'left';
    lines.forEach((l, i) => {
      ctx.fillStyle = l.color ?? C.bone;
      ctx.fillText(l.text, L.plate.x + L.pad + 1, L.textY + i * cfg.lineHeight + 1);
    });
    this.menu.draw(ctx, L.menu, { rowH: L.rowH, detailH: L.detailH, fontPx: cfg.fontPx, detailPx: cfg.detailPx, align: this.align });
    ctx.restore();
  }
}
