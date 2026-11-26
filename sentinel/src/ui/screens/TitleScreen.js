// The title screen (step 5.1): the island at dawn drifting behind (main.js draws it, world: 'title'), the name set
// in a book face, and Continue / New Game / Load / Settings, with a one-line controls hint for the device.
// Continue shows only when a save loads, with its day, hour, place and how long ago it was made. New Game asks
// first when it would abandon a run that only lives in the autosave.
import { Menu, menuHeight } from './Menu.js';
import { SCREEN_COLORS as C, font, safeArea, rowHeight, TITLE_FONT, ellipsize, measurer } from './theme.js';
import { settingsPanel, slotsPanel, confirmPanel, messagePanel } from './panels.js';
import { slotLine, agoText } from './saveText.js';

export const GAME_TITLE = Object.freeze({ small: 'ESCAPE', large: 'NORTH SENTINEL ISLAND', split: ['NORTH SENTINEL', 'ISLAND'] });

export const CONTROLS_HINT = Object.freeze({
  keys: 'WASD move · Shift run · C crouch · E use · Q throw · Tab journal · Esc pause',
  touch: 'Left thumb moves · right thumb acts · the book is your journal',
});

/** the two endings, in the order their marks show on the title (step 5.6) */
export const ENDING_MARKS = Object.freeze([{ id: 'dinghy', label: 'by sea' }, { id: 'rescue', label: 'rescued' }]);

/**
 * Which endings the title marks: nothing until one has been reached, then every ending with seen true/false.
 * @param {unknown} seen prefs endingsSeen
 */
export function endingMarks(seen) {
  const ids = Array.isArray(seen) ? seen : [];
  if (!ENDING_MARKS.some((e) => ids.includes(e.id))) return [];
  return ENDING_MARKS.map((e) => ({ ...e, seen: ids.includes(e.id) }));
}

/**
 * How the name is set at a width: the large line whole, else split in two, shrinking only as a last resort.
 * @param {number} maxW
 * @param {(px: number, text: string) => number} measure width of `text` at `px` in the title face
 * @param {{ titleLargePx: number, titleSmallPx: number }} cfg tuning.screens.title
 * @returns {Array<{ text: string, px: number, small?: boolean }>}
 */
export function titleLines(maxW, measure, cfg) {
  const out = [{ text: GAME_TITLE.small, px: cfg.titleSmallPx, small: true }];
  for (let px = cfg.titleLargePx; px >= 8; px--) {
    if (measure(px, GAME_TITLE.large) <= maxW) return [...out, { text: GAME_TITLE.large, px }];
    if (GAME_TITLE.split.every((t) => measure(px, t) <= maxW)) return [...out, ...GAME_TITLE.split.map((text) => ({ text, px }))];
  }
  return [...out, ...GAME_TITLE.split.map((text) => ({ text, px: 8 }))];
}

/**
 * Title screen layout.
 * @param {Object} vp
 * @param {Object} safe
 * @param {Object} cfg tuning.screens
 * @param {{ items: Array<Object>, touch: boolean, lines: Array<{px:number}>, notes?: number }} o
 */
export function titleLayout(vp, safe, cfg, { items, touch, lines, notes = 0 }) {
  const area = safeArea(vp, safe, cfg.margin);
  const rowH = rowHeight(vp, cfg, touch);
  const titleH = lines.reduce((s, l) => s + l.px + (l.small ? 5 : 3), 0);
  const hintH = cfg.lineHeight * (1 + notes);
  const menuW = Math.min(cfg.title.menuWidth, area.w);
  const menuH = menuHeight(items, rowH, cfg.detailHeight);
  const free = area.h - titleH - menuH - hintH;
  const gap = Math.max(4, Math.min(cfg.title.gap, Math.floor(free / 3)));
  const top = area.y + Math.max(2, Math.floor((free - gap * 2) / 3));
  const menuY = top + titleH + gap;
  const menu = { x: Math.round(area.x + (area.w - menuW) / 2), y: menuY, w: menuW, h: Math.max(rowH, Math.min(menuH, area.y + area.h - hintH - 2 - menuY)) };
  return { area, rowH, titleY: top, menu, hintY: area.y + area.h - hintH, titleH };
}

export class TitleScreen {
  /** @param {Object} ui { actions, prefs, audio, screens } */
  constructor(ui) {
    this.ui = ui;
    this.pausesWorld = true;
    this.world = 'title';
    this.hud = false;
    this.menu = new Menu({ items: [] });
    this.newest = null;
    this.layout = null;
  }

  enter(params = {}) {
    this.ui.screens.closeAllPanels();
    this.refresh();
    if (params.message) messagePanel(this.ui, params.message);
  }

  /** read the saves again (after a delete, an import, a reset) */
  refresh() {
    const a = this.ui.actions;
    this.newest = a.saving ? a.newestSave() : null;
    this.menu.setItems(this.items(), this.newest ? 'continue' : 'new');
  }

  items() {
    const a = this.ui.actions;
    const n = this.newest;
    const out = [];
    if (n) {
      out.push({
        id: 'continue', label: 'Continue', detail: `${slotLine(n.env)} · saved ${agoText(n.env.savedAt, a.now())}`,
        onSelect: () => this.continueGame(),
      });
    }
    out.push({ id: 'new', label: 'New Game', onSelect: () => this.newGame() });
    if (a.saving) out.push({ id: 'load', label: 'Load', onSelect: () => slotsPanel(this.ui, 'load') });
    out.push({ id: 'settings', label: 'Settings', onSelect: () => settingsPanel(this.ui) });
    return out;
  }

  continueGame() {
    const r = this.ui.actions.continueGame();
    if (r && !r.ok) {
      messagePanel(this.ui, { title: 'Cannot continue', text: r.message });
      this.refresh();
    }
  }

  newGame() {
    const a = this.ui.actions;
    const lose = a.saving ? a.newGameWouldLose() : null;
    if (!lose) { a.newGame(); return; }
    confirmPanel(this.ui, {
      title: 'Start a new game?', danger: true, yes: 'Start again', no: 'Keep my run',
      text: `Your run (${slotLine(lose.env)}) is only in the autosave, and a new game will replace it. Save it in a slot from the pause menu to keep it.`,
      onYes: () => a.newGame(),
    });
  }

  onKey(code, repeat) {
    this.menu.onKey(code === 'Escape' ? '' : code, repeat);
    return true;
  }

  handlePointer(ev) { return this.menu.handlePointer(ev); }

  draw(ctx, vp, safe, now, screens) {
    const cfg = screens.cfg;
    const touch = screens.isTouch();
    // the name
    const area = safeArea(vp, safe, cfg.margin);
    const measure = (px, text) => { ctx.font = font(px, '', TITLE_FONT); return ctx.measureText(text).width + (text === GAME_TITLE.small ? text.length * 3 : text.length * 0.8); };
    const lines = titleLines(area.w, measure, cfg.title);
    const notes = this.ui.actions.savingNote ? 1 : 0;
    const L = titleLayout(vp, safe, cfg, { items: this.menu.items, touch, lines, notes });
    this.layout = L;
    ctx.save();
    // a soft band of shade behind the type, so it reads over the bright dawn sea
    const g = ctx.createLinearGradient(0, 0, 0, vp.uiLogicalHeight);
    g.addColorStop(0, 'rgba(13, 11, 18, 0.55)');
    g.addColorStop(0.55, 'rgba(13, 11, 18, 0.25)');
    g.addColorStop(1, 'rgba(13, 11, 18, 0.6)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vp.uiLogicalWidth, vp.uiLogicalHeight);
    const cx = Math.round(area.x + area.w / 2);
    let y = L.titleY;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const l of lines) {
      ctx.font = font(l.px, l.small ? '' : '', TITLE_FONT);
      if ('letterSpacing' in ctx) ctx.letterSpacing = l.small ? '3px' : '0.8px';
      ctx.fillStyle = 'rgba(13, 11, 18, 0.65)';
      ctx.fillText(l.text, cx + 1, y + 1);
      ctx.fillStyle = l.small ? C.sand : C.bone;
      ctx.fillText(l.text, cx, y);
      y += l.px + (l.small ? 5 : 3);
    }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.fillStyle = C.rust;
    ctx.fillRect(cx - 24, y + 1, 48, 1);
    // a soft dark plate under the menu, so its words read over the bright sand of the dawn
    ctx.fillStyle = 'rgba(13, 11, 18, 0.5)';
    ctx.fillRect(L.menu.x - 6, L.menu.y - 3, L.menu.w + 12, L.menu.h + 6);
    this.menu.draw(ctx, L.menu, { rowH: L.rowH, detailH: cfg.detailHeight, fontPx: cfg.fontPx + 1, detailPx: cfg.detailPx, align: 'center' });
    // the controls hint (and why saving is off, if it is)
    ctx.font = font(cfg.detailPx);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const m = measurer(ctx);
    let hy = L.hintY;
    if (notes) {
      ctx.fillStyle = C.amber;
      ctx.fillText(ellipsize(this.ui.actions.savingNote, area.w, m), cx, hy);
      hy += cfg.lineHeight;
    }
    ctx.fillStyle = C.dim;
    ctx.fillText(ellipsize(touch ? CONTROLS_HINT.touch : CONTROLS_HINT.keys, area.w, m), cx, hy);
    this.drawEndingMarks(ctx, area, cfg);
    ctx.restore();
  }

  /** a small mark per ending in the top-right corner once one has been reached: filled amber when seen */
  drawEndingMarks(ctx, area, cfg) {
    const marks = endingMarks(this.ui.prefs?.get?.('endingsSeen'));
    if (!marks.length) return;
    ctx.font = font(cfg.detailPx);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    let x = Math.round(area.x + area.w);
    const y = Math.round(area.y + 4);
    for (let i = marks.length - 1; i >= 0; i--) {
      const mk = marks[i];
      ctx.fillStyle = mk.seen ? C.bone : C.dim;
      ctx.fillText(mk.label, x, y + 0.5);
      x -= Math.ceil(ctx.measureText(mk.label).width) + 3;
      ctx.fillStyle = C.ink;
      ctx.fillRect(x - 5, y - 3, 6, 6);
      ctx.fillStyle = mk.seen ? C.amber : C.edge;
      if (mk.seen) ctx.fillRect(x - 4, y - 2, 4, 4);
      else { ctx.fillRect(x - 4, y - 2, 4, 1); ctx.fillRect(x - 4, y + 1, 4, 1); ctx.fillRect(x - 4, y - 2, 1, 4); ctx.fillRect(x - 1, y - 2, 1, 4); }
      x -= 12;
    }
  }
}
