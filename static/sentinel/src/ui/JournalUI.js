// The Journal (spec §6.4, §7.2, §9 ui/JournalUI.js): a deliberate stop with four tabs, Notes, Map, Objectives and
// Recipes. Opened by the openJournal UI action (Tab / J / the touch journal button; I opens it on Recipes); the page
// loop pauses the simulation while it is open (main.js uiPaused()). Presentation only: it reads the simulation and
// answers only through the tick input's `journal` field (input.js), handed to the page by takeCommands():
//   read:<id>   entries opened here; sent with the first tick after closing (they change nothing in the world)
//   craft:<id>  Make on the Recipes tab; the page runs one tick at once so the result shows while still open
//
// Layout and text are pure functions below (tested in Node): journalLayout, notesRows, listMetrics, pageLines,
// clampScroll, scrollToShow, objectiveLines, recipeLines. Drawing is in small isolated functions (drawPaper,
// drawTab, drawCheck) so the look can move to the ui sheet's page_* 9-slice and tab_* icons in a few lines.
//
// Keys: 1-4 / Q,E / [,] (and left/right except on the Map) switch tabs; up/down (W/S) pick an entry or scroll;
// PgUp/PgDn scroll the page; Enter / Space makes the selected recipe; Esc, Tab or J closes. Mouse: click a tab, an
// entry, Make; the wheel scrolls what is under it. Touch: tap, drag a list to scroll. On the Map tab the embedded
// MapOverlay gets the pointer, the wheel and its zoom keys; arrows pan it.
import { wrapText } from './DialogueUI.js';
import { journalEntries } from '../sim/Lore.js';
import { objectives } from '../sim/Objectives.js';

export const JOURNAL_TABS = Object.freeze(['notes', 'map', 'objectives', 'recipes']);
export const TAB_LABELS = Object.freeze({ notes: 'Notes', map: 'Map', objectives: 'Objectives', recipes: 'Recipes' });
/** ui sheet icons (assets/src/ICONS.md, 12 x 12) */
export const TAB_ICONS = Object.freeze({ notes: 'tab_notes', map: 'tab_map', objectives: 'tab_objectives', recipes: 'tab_recipes' });
/** Notes groups, in order (objective entries live on the Objectives tab) */
export const NOTE_GROUPS = Object.freeze([
  { category: 'note', label: 'Notes' }, { category: 'site', label: 'Places' }, { category: 'marek', label: 'Marek' }, { category: 'recipe', label: 'Recipes' },
]);

/** palette (assets/src/palette.gpl): paper, ink on paper, and the dark plate around it */
export const JOURNAL_COLORS = Object.freeze({
  backdrop: 'rgba(13, 11, 18, 0.86)', ink: '#0d0b12', plate: '#24212c', plateEdge: '#4f4955',
  paper: '#e7cd98', paperEdge: '#d2b07c', paperShade: '#b39062', paperLine: '#8c6d4b', paperInk: '#2a1e1a', paperDim: '#624433',
  tab: '#37323f', tabActive: '#e7cd98', tabText: '#e9e2cf', tabTextActive: '#2a1e1a', amber: '#f2a33a', rust: '#a8522b', ok: '#466e36',
});
const FONT_FAMILY = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';
const TAP_SLOP = 4;

// ---- pure layout ------------------------------------------------------------------------------------------------

/**
 * Where everything goes, in logical pixels.
 * @param {{ uiLogicalWidth: number, uiLogicalHeight: number, scale: number }} vp
 * @param {{ top?: number, right?: number, bottom?: number, left?: number }} safe
 * @param {Object} cfg tuning.journal
 * @param {boolean} touch a touch screen (tabs and rows grow to finger size)
 */
export function journalLayout(vp, safe, cfg, touch = false) {
  const s = { top: safe?.top || 0, right: safe?.right || 0, bottom: safe?.bottom || 0, left: safe?.left || 0 };
  const m = cfg.margin;
  const x = Math.round(s.left + m);
  const y = Math.round(s.top + m);
  const w = Math.floor(vp.uiLogicalWidth - s.right - m - x);
  const h = Math.floor(vp.uiLogicalHeight - s.bottom - m - y);
  const cssToLogical = (css) => Math.ceil(css / (vp.scale > 0 ? vp.scale : 1));
  const tabH = touch ? Math.max(cfg.tabHeight, cssToLogical(cfg.touchTabCss)) : cfg.tabHeight;
  const rowH = touch ? Math.max(cfg.rowHeight, cssToLogical(cfg.touchRowCss)) : cfg.rowHeight;
  const closeW = tabH + 6;
  const tabW = Math.floor((w - closeW - 2) / JOURNAL_TABS.length);
  const tabs = JOURNAL_TABS.map((id, i) => ({ id, x: x + i * tabW, y, w: tabW - 1, h: tabH }));
  const close = { x: x + w - closeW, y, w: closeW, h: tabH };
  const content = { x, y: y + tabH, w, h: h - tabH };
  const pad = cfg.padding;
  const listW = Math.round(Math.max(cfg.listWidth.min, Math.min(cfg.listWidth.max, content.w * cfg.listWidth.fraction)));
  const list = { x: content.x + pad, y: content.y + pad, w: listW, h: content.h - pad * 2 };
  const page = { x: list.x + listW + pad, y: content.y + pad, w: content.x + content.w - pad - (list.x + listW + pad), h: content.h - pad * 2 };
  const body = { x: content.x + pad, y: content.y + pad, w: content.w - pad * 2, h: content.h - pad * 2 };
  return { frame: { x, y, w, h }, tabs, close, content, list, page, body, tabH, rowH };
}

/**
 * The Notes list: unlocked entries grouped by category (newest first within a group), objective entries left out.
 * @param {Array<{ id: string, category: string, title: string, read: boolean }>} entries in unlock order
 * @param {Set<string>} [seen] ids opened in this session (shown read before the sim hears of it)
 * @returns {Array<{ kind: 'header', label: string } | { kind: 'entry', id: string, title: string, unread: boolean }>}
 */
export function notesRows(entries, seen = new Set()) {
  const rows = [];
  for (const g of NOTE_GROUPS) {
    const list = entries.filter((e) => e.category === g.category).reverse();
    if (!list.length) continue;
    rows.push({ kind: 'header', label: g.label });
    for (const e of list) rows.push({ kind: 'entry', id: e.id, title: e.title, unread: !e.read && !seen.has(e.id) });
  }
  return rows;
}

/**
 * Row positions of a list: headers are `headerH` tall, entries `rowH`.
 * @returns {{ ys: number[], hs: number[], total: number }}
 */
export function listMetrics(rows, rowH, headerH) {
  const ys = [];
  const hs = [];
  let y = 0;
  for (const r of rows) {
    const h = r.kind === 'header' ? headerH : rowH;
    ys.push(y);
    hs.push(h);
    y += h;
  }
  return { ys, hs, total: y };
}

/** a scroll offset kept inside [0, content - view] */
export function clampScroll(v, contentH, viewH) {
  return Math.max(0, Math.min(Number.isFinite(v) ? v : 0, Math.max(0, contentH - viewH)));
}

/** the smallest scroll change that shows [top, top + h) inside a view of viewH scrolled to `scroll` */
export function scrollToShow(scroll, top, h, viewH) {
  if (top < scroll) return top;
  if (top + h > scroll + viewH) return top + h - viewH;
  return scroll;
}

/**
 * An entry's page as lines: the title (wrapped), a gap, then each paragraph wrapped with a gap between.
 * @param {{ title: string, text: string }} entry
 * @param {number} width
 * @param {(s: string) => number} measure width at the body font
 * @param {(s: string) => number} [measureTitle] width at the title font
 * @returns {Array<{ text: string, kind: 'title'|'body'|'gap' }>}
 */
export function pageLines(entry, width, measure, measureTitle = measure) {
  const out = [];
  for (const t of wrapText(entry.title, width, measureTitle)) out.push({ text: t, kind: 'title' });
  out.push({ text: '', kind: 'gap' });
  const paras = String(entry.text).split('\n');
  paras.forEach((p, i) => {
    for (const t of wrapText(p, width, measure)) out.push({ text: t, kind: 'body' });
    if (i < paras.length - 1) out.push({ text: '', kind: 'gap' });
  });
  return out;
}

/**
 * The Objectives tab as lines (wrapped to `width`): each plan with its steps (a box, ticked when done, or '?'),
 * then the hints learned.
 * @param {ReturnType<typeof objectives>} obj
 * @returns {Array<{ text: string, kind: 'heading'|'step'|'hint'|'gap'|'dim', done?: boolean, known?: boolean, first?: boolean }>}
 */
export function objectiveLines(obj, width, measure) {
  const out = [];
  const indent = 10;
  for (const plan of obj.plans) {
    out.push({ text: plan.known ? plan.title : 'Another way off the island?', kind: 'heading' });
    if (!plan.known) {
      out.push({ text: 'I have not found it yet.', kind: 'dim' });
    } else {
      for (const s of plan.steps) {
        const count = s.count ? ` ${s.count.have}/${s.count.need}` : '';
        wrapText(`${s.text}${count}`, width - indent, measure).forEach((t, i) => out.push({ text: t, kind: 'step', done: s.done, known: s.known, first: i === 0 }));
      }
    }
    out.push({ text: '', kind: 'gap' });
  }
  if (obj.hints.length) {
    out.push({ text: 'What I have learned', kind: 'heading' });
    for (const h of obj.hints) wrapText(h.text, width - indent, measure).forEach((t, i) => out.push({ text: t, kind: 'hint', first: i === 0 }));
  }
  return out;
}

/**
 * The Recipes tab as blocks: name, ingredients with have/need, a Make state, and the recipe's journal text.
 * @param {Array<{ id: string, name: string, ingredients: Array<{ label: string, have: number, need: number }>,
 *   state: 'make'|'missing'|'made'|'at', at?: string, note?: string }>} views from the crafting module (step 4.7)
 * @returns {Array<{ id: string, h: number, lines: Array<Object>, state: string }>}
 */
export function recipeLines(views, width, measure, lineH) {
  return views.map((v) => {
    const lines = [{ text: v.name, kind: 'title' }];
    for (const ing of v.ingredients) lines.push({ text: ing.label, kind: 'ingredient', have: ing.have, need: ing.need, ok: ing.have >= ing.need });
    for (const t of v.note ? wrapText(v.note, width, measure) : []) lines.push({ text: t, kind: 'note' });
    // the Make button row (or the place it is made at / "made")
    lines.push({ text: '', kind: 'action' });
    return { id: v.id, state: v.state, at: v.at ?? null, lines, h: lines.length * lineH + 6 };
  });
}

// ---- the component ----------------------------------------------------------------------------------------------

export class JournalUI {
  /**
   * @param {Object} opts
   * @param {import('../engine/InputManager.js').InputManager} opts.input
   * @param {import('../engine/AssetManager.js').AssetManager} [opts.assets]
   * @param {Object} opts.tuning the whole tuning (reads tuning.journal)
   * @param {import('./MapOverlay.js').MapOverlay} [opts.map] the map, embedded as the Map tab
   * @param {(sim: Object) => Array<Object>} [opts.recipes] the Recipes tab's views (crafting module, step 4.7)
   * @param {(recipeId: string) => void} [opts.onCraft] Make was pressed (the page runs a tick with craft:<id>)
   */
  constructor({ input, assets = null, tuning, map = null, recipes = null, onCraft = null }) {
    this.input = input;
    this.assets = assets;
    this.cfg = tuning.journal;
    this.map = map;
    this.recipesOf = recipes ?? (() => []);
    this.onCraft = onCraft;
    this.isOpen = false;
    /** remembered across openings */
    this.tab = 'notes';
    this.selected = null;
    this.scroll = { list: 0, page: 0, objectives: 0, recipes: 0 };
    this.recipeCursor = 0;
    /** entries opened in this session, and the read marks not yet sent to the sim */
    this.seen = new Set();
    this.pendingRead = [];
    this.pendingCraft = [];
    this.drag = null;
    /** last frame's layout and hit boxes */
    this.layout = null;
    this.hits = { rows: [], make: [] };
    this.metrics = { list: 0, page: 0, objectives: 0, recipes: 0 };
    this.sim = null;
    this.removers = [];
  }

  // ---- opening ------------------------------------------------------------------------------------------------

  /**
   * @param {Object} sim
   * @param {string} [tab] open on this tab (else the last one)
   */
  open(sim, tab = null) {
    if (tab && JOURNAL_TABS.includes(tab)) this.tab = tab;
    this.isOpen = true;
    this.sim = sim;
    this.drag = null;
    if (this.tab === 'map') this.map?.open(sim);
    this.input?.setModal?.({ onKey: (code, repeat) => this.onKey(code, repeat), allowRegion: (id) => id.startsWith('journal') || id.startsWith('debug') });
    // presses anywhere belong to the journal (handled by the pointer listeners of attach), never to the game's controls
    if (this.input?.addHitRegion) this.removers.push(this.input.addHitRegion('journal', () => (this.isOpen ? { x: -1e4, y: -1e4, w: 2e4, h: 2e4 } : null), () => {}));
    return true;
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.drag = null;
    this.map?.close();
    for (const r of this.removers.splice(0)) r();
    this.input?.setModal?.(null);
  }

  /** the toggle key: open (on `tab`), switch to `tab` when open elsewhere, or close */
  toggle(sim, tab = null) {
    if (!this.isOpen) return this.open(sim, tab);
    if (tab && tab !== this.tab) { this.setTab(tab); return true; }
    this.close();
    return false;
  }

  setTab(tab) {
    if (!JOURNAL_TABS.includes(tab) || tab === this.tab) return;
    if (this.tab === 'map') this.map?.close();
    this.tab = tab;
    if (tab === 'map' && this.sim) this.map?.open(this.sim);
  }

  cycleTab(d) {
    const i = JOURNAL_TABS.indexOf(this.tab);
    this.setTab(JOURNAL_TABS[(i + d + JOURNAL_TABS.length) % JOURNAL_TABS.length]);
  }

  /**
   * The commands for the next tick's `journal` input (read marks, crafts), then cleared. Read marks wait until the
   * Journal is closed; a craft goes at once.
   * @returns {string|null}
   */
  takeCommands() {
    const toks = [...this.pendingCraft.map((id) => `craft:${id}`)];
    this.pendingCraft = [];
    if (!this.isOpen && this.pendingRead.length) {
      toks.push(...this.pendingRead.map((id) => `read:${id}`));
      this.pendingRead = [];
    }
    return toks.length ? toks.join(' ') : null;
  }

  // ---- notes ----------------------------------------------------------------------------------------------------

  /** open an entry on the page (marks it read) */
  select(id) {
    if (this.selected !== id) this.scroll.page = 0;
    this.selected = id;
    if (!this.seen.has(id)) {
      this.seen.add(id);
      const e = this.sim?.story;
      if (e && !e.read.has(id)) this.pendingRead.push(id);
    }
  }

  /** the Notes rows for the current sim */
  rows() {
    return this.sim ? notesRows(journalEntries(this.sim), this.seen) : [];
  }

  /** any unlocked entry not opened yet (a mark on the Notes tab) */
  hasUnread() {
    return this.sim ? journalEntries(this.sim).some((e) => e.category !== 'objective' && !e.read && !this.seen.has(e.id)) : false;
  }

  moveSelection(d) {
    const entries = this.rows().filter((r) => r.kind === 'entry');
    if (!entries.length) return;
    const i = entries.findIndex((r) => r.id === this.selected);
    const next = entries[Math.max(0, Math.min(entries.length - 1, i < 0 ? 0 : i + d))];
    this.select(next.id);
    this.revealSelected = true;
  }

  // ---- input ----------------------------------------------------------------------------------------------------

  /**
   * A key while open (the InputCore modal hook).
   * @returns {boolean} the key belongs to the journal
   */
  onKey(code, repeat = false) {
    if (!this.isOpen) return false;
    const cfg = this.cfg;
    if (code === 'Escape' || code === 'Tab' || code === 'KeyJ') { if (!repeat) this.close(); return true; }
    if (code === 'KeyI') { if (!repeat) this.toggle(this.sim, 'recipes'); return true; }
    const digit = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 }[code];
    if (digit !== undefined) { this.setTab(JOURNAL_TABS[digit]); return true; }
    if (code === 'KeyQ' || code === 'BracketLeft') { this.cycleTab(-1); return true; }
    if (code === 'KeyE' || code === 'BracketRight') { this.cycleTab(1); return true; }
    if (this.tab === 'map') {
      const pan = { ArrowUp: [0, 1], KeyW: [0, 1], ArrowDown: [0, -1], KeyS: [0, -1], ArrowLeft: [1, 0], KeyA: [1, 0], ArrowRight: [-1, 0], KeyD: [-1, 0] }[code];
      if (pan) { this.map?.panBy(pan[0] * cfg.mapKeyPan, pan[1] * cfg.mapKeyPan); return true; }
      return !!this.map?.handleInput({ type: 'key', code }) || true;
    }
    if (code === 'ArrowLeft' || code === 'KeyA') { this.cycleTab(-1); return true; }
    if (code === 'ArrowRight' || code === 'KeyD') { this.cycleTab(1); return true; }
    const up = code === 'ArrowUp' || code === 'KeyW';
    const down = code === 'ArrowDown' || code === 'KeyS';
    const pageKey = code === 'PageUp' ? -1 : code === 'PageDown' ? 1 : 0;
    if (this.tab === 'notes') {
      if (up || down) { this.moveSelection(up ? -1 : 1); return true; }
      if (pageKey) { this.scrollBy('page', pageKey * (this.layout?.page.h ?? 100) * 0.8); return true; }
      return true;
    }
    const area = this.tab;   // objectives | recipes
    if (this.tab === 'recipes') {
      const n = this.recipesOf(this.sim).length;
      if ((up || down) && n) { this.recipeCursor = (this.recipeCursor + (up ? n - 1 : 1)) % n; this.revealRecipe = true; return true; }
      if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') { this.make(this.recipeCursor); return true; }
    } else if (up || down) { this.scrollBy(area, (up ? -1 : 1) * cfg.keyStep); return true; }
    if (pageKey) { this.scrollBy(area, pageKey * (this.layout?.body.h ?? 100) * 0.8); return true; }
    return true;
  }

  scrollBy(area, d) {
    const view = area === 'list' ? this.layout?.list.h : area === 'page' ? this.layout?.page.h : this.layout?.body.h;
    this.scroll[area] = clampScroll(this.scroll[area] + d, this.metrics[area] ?? 0, view ?? 0);
  }

  /** Make the i-th recipe of the Recipes tab, if it can be made here */
  make(i) {
    const v = this.recipesOf(this.sim)[i];
    if (!v || v.state !== 'make') return false;
    this.recipeCursor = i;
    this.pendingCraft.push(v.id);
    this.onCraft?.(v.id);
    return true;
  }

  /** which scrollable area a point is in */
  areaAt(x, y) {
    const L = this.layout;
    if (!L) return null;
    const inR = (r) => r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    if (this.tab === 'map') return inR(L.content) ? 'map' : null;
    if (this.tab === 'notes') return inR(L.list) ? 'list' : inR(L.page) ? 'page' : null;
    return inR(L.body) ? this.tab : null;
  }

  /**
   * One pointer or wheel event while open (pure: no DOM objects).
   *   { type: 'down' | 'move' | 'up', id, x, y }  { type: 'wheel', dy, x, y }
   * @returns {string|null} what it did
   */
  handleInput(ev) {
    if (!this.isOpen || !this.layout) return null;
    const L = this.layout;
    const inR = (r) => r && ev.x >= r.x && ev.x < r.x + r.w && ev.y >= r.y && ev.y < r.y + r.h;
    if (ev.type === 'wheel') {
      const a = this.areaAt(ev.x, ev.y);
      if (a === 'map') return this.map?.handleInput(ev) ?? null;
      if (a) { this.scrollBy(a, (ev.dy > 0 ? 1 : -1) * this.cfg.wheelStep); return 'scroll'; }
      return null;
    }
    if (ev.type === 'down') {
      if (this.drag) return null;
      const area = this.areaAt(ev.x, ev.y);
      this.drag = { id: ev.id, x: ev.x, y: ev.y, startX: ev.x, startY: ev.y, moved: false, area };
      if (area === 'map') this.map?.handleInput(ev);
      return null;
    }
    const d = this.drag;
    if (!d || d.id !== ev.id) return null;
    if (ev.type === 'move') {
      if (d.area === 'map') { this.map?.handleInput(ev); d.x = ev.x; d.y = ev.y; return 'pan'; }
      if (!d.moved && Math.abs(ev.x - d.startX) + Math.abs(ev.y - d.startY) > TAP_SLOP) d.moved = true;
      if (d.moved && d.area) this.scrollBy(d.area, d.y - ev.y);
      d.x = ev.x;
      d.y = ev.y;
      return d.moved ? 'scroll' : null;
    }
    if (ev.type !== 'up') return null;
    this.drag = null;
    if (d.area === 'map') {
      const r = this.map?.handleInput(ev);
      if (r === 'close') { this.close(); return 'close'; }
      if (r) return r;
    }
    if (d.moved) return 'scroll';
    // a tap
    if (inR(L.close)) { this.close(); return 'close'; }
    for (const t of L.tabs) if (inR(t)) { this.setTab(t.id); return 'tab'; }
    if (this.tab === 'notes') {
      for (const h of this.hits.rows) if (inR(h)) { this.select(h.id); return 'select'; }
    } else if (this.tab === 'recipes') {
      for (const h of this.hits.make) if (inR(h)) return this.make(h.index) ? 'make' : null;
    }
    return null;
  }

  /**
   * Wire the browser events (pointer and wheel on the surface) to handleInput. Keys arrive through the modal hook.
   * @param {{ surface: EventTarget }} env
   * @returns {() => void} removes them
   */
  attach({ surface }) {
    const offs = [];
    const on = (type, fn, opts) => { surface.addEventListener(type, fn, opts); offs.push(() => surface.removeEventListener(type, fn, opts)); };
    const pos = (e) => this.input.toLogical(e);
    for (const type of ['down', 'move', 'up']) {
      on(`pointer${type}`, (e) => { if (this.isOpen) { const p = pos(e); this.handleInput({ type, id: e.pointerId, x: p.x, y: p.y }); } });
    }
    on('pointercancel', () => { this.drag = null; });
    on('wheel', (e) => {
      if (!this.isOpen) return;
      const p = pos(e);
      this.handleInput({ type: 'wheel', dy: e.deltaY, x: p.x, y: p.y });
      e.preventDefault();
    }, { passive: false });
    return () => { for (const f of offs.splice(0)) f(); };
  }

  // ---- drawing --------------------------------------------------------------------------------------------------

  /** finger-sized rows: the touch controls are showing, or the screen's main pointer is a finger */
  touch() {
    if (this.input?.touchVisible) return true;
    if (this.coarse === undefined) this.coarse = !!globalThis.matchMedia?.('(pointer: coarse)')?.matches;
    return this.coarse;
  }

  font(px = this.cfg.fontPx, style = '') {
    return `${style}${px}px ${FONT_FAMILY}`;
  }

  /**
   * Draw the journal on #ui (logical pixels).
   * @param {CanvasRenderingContext2D} ctx
   * @param {{ uiLogicalWidth: number, uiLogicalHeight: number, scale: number }} vp
   * @param {{ top?: number, right?: number, bottom?: number, left?: number }} safe
   * @param {Object} sim
   * @param {number} now ms
   */
  draw(ctx, vp, safe, sim, now = 0) {
    if (!this.isOpen || !sim) return;
    this.sim = sim;
    const L = journalLayout(vp, safe, this.cfg, this.touch());
    this.layout = L;
    const C = JOURNAL_COLORS;
    ctx.save();
    ctx.fillStyle = C.backdrop;
    ctx.fillRect(0, 0, vp.uiLogicalWidth, vp.uiLogicalHeight);
    this.drawTabs(ctx, L);
    if (this.tab === 'map') {
      if (this.map && !this.map.isOpen) this.map.open(sim);
      this.map?.draw(ctx, vp, safe, sim, now, L.content);
    } else {
      drawPaper(ctx, L.content);
      if (this.tab === 'notes') this.drawNotes(ctx, L, sim);
      else if (this.tab === 'objectives') this.drawObjectives(ctx, L, sim);
      else this.drawRecipes(ctx, L, sim);
    }
    ctx.restore();
  }

  drawTabs(ctx, L) {
    const unread = this.hasUnread();
    for (const t of L.tabs) {
      const label = TAB_LABELS[t.id] + (t.id === 'notes' && unread ? ' •' : '');
      drawTab(ctx, t, t.id === this.tab, label, this.font(this.cfg.fontPx), (x, y) => this.icon(ctx, TAB_ICONS[t.id], x, y));
    }
    const c = L.close;
    ctx.fillStyle = JOURNAL_COLORS.tab;
    ctx.fillRect(c.x, c.y, c.w, c.h - 2);
    ctx.fillStyle = JOURNAL_COLORS.tabText;
    ctx.font = this.font(this.cfg.titlePx + 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('×', c.x + c.w / 2, c.y + (c.h - 2) / 2);
  }

  /** a ui-sheet icon when the sheet is loaded (else nothing: the label carries the tab) */
  icon(ctx, name, x, y) {
    if (this.assets?.sheets?.has?.('ui')) { this.assets.drawIcon(ctx, 'ui', name, x, y); return true; }
    return false;
  }

  /** clip to a rectangle and translate by a scroll offset; returns the restore function */
  clipTo(ctx, r) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    // every area draws left-aligned from its top-left; set here, inside the save, so nothing leaks either way
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    return () => ctx.restore();
  }

  drawNotes(ctx, L, sim) {
    const cfg = this.cfg;
    const C = JOURNAL_COLORS;
    const rows = this.rows();
    const entries = rows.filter((r) => r.kind === 'entry');
    if (!this.selected || !entries.some((r) => r.id === this.selected)) {
      // the first unread entry, else the newest
      const first = entries.find((r) => r.unread) ?? entries[0];
      if (first) this.select(first.id);
    }
    const headerH = cfg.rowHeight;
    const M = listMetrics(rows, L.rowH, headerH);
    this.metrics.list = M.total;
    if (this.revealSelected) {
      const i = rows.findIndex((r) => r.kind === 'entry' && r.id === this.selected);
      if (i >= 0) this.scroll.list = scrollToShow(this.scroll.list, M.ys[i], M.hs[i], L.list.h);
      this.revealSelected = false;
    }
    this.scroll.list = clampScroll(this.scroll.list, M.total, L.list.h);
    // the list
    let undo = this.clipTo(ctx, L.list);
    this.hits.rows = [];
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    rows.forEach((r, i) => {
      const y = L.list.y + M.ys[i] - this.scroll.list;
      const h = M.hs[i];
      if (y + h < L.list.y || y > L.list.y + L.list.h) return;
      if (r.kind === 'header') {
        ctx.font = this.font(cfg.fontPx - 1, 'bold ');
        ctx.fillStyle = C.paperDim;
        ctx.fillText(r.label.toUpperCase(), L.list.x, y + h / 2 + 1);
        return;
      }
      const sel = r.id === this.selected;
      if (sel) { ctx.fillStyle = C.paperShade; ctx.fillRect(L.list.x - 2, y, L.list.w + 2, h - 1); }
      if (r.unread) { ctx.fillStyle = C.rust; ctx.fillRect(L.list.x, Math.round(y + h / 2 - 1), 3, 3); }
      ctx.font = this.font(cfg.fontPx, sel ? 'bold ' : '');
      ctx.fillStyle = C.paperInk;
      ctx.fillText(ellipsize(ctx, r.title, L.list.w - 7), L.list.x + 6, y + h / 2 + 1);
      this.hits.rows.push({ id: r.id, x: L.list.x - 2, y: Math.max(y, L.list.y), w: L.list.w + 2, h: Math.min(h, L.list.y + L.list.h - y) });
    });
    undo();
    drawScrollBar(ctx, L.list, this.scroll.list, M.total);
    // the divider
    ctx.fillStyle = C.paperLine;
    ctx.fillRect(L.page.x - Math.ceil(cfg.padding / 2) - 1, L.page.y, 1, L.page.h);
    // the page
    const e = this.selected ? sim.lore.get(this.selected) : null;
    if (!e) {
      ctx.font = this.font();
      ctx.fillStyle = C.paperDim;
      ctx.fillText('Nothing written yet.', L.page.x, L.page.y + 8);
      return;
    }
    const tfont = this.font(cfg.titlePx, 'bold ');
    const bfont = this.font();
    ctx.font = bfont;
    const mb = (s) => ctx.measureText(s).width;
    const lines = pageLines(e, L.page.w - 4, mb, (s) => { ctx.font = tfont; const w = ctx.measureText(s).width; ctx.font = bfont; return w; });
    const lh = cfg.lineHeight;
    this.metrics.page = lines.length * lh + 4;
    this.scroll.page = clampScroll(this.scroll.page, this.metrics.page, L.page.h);
    undo = this.clipTo(ctx, L.page);
    ctx.textBaseline = 'top';
    lines.forEach((ln, i) => {
      const y = L.page.y + i * lh - this.scroll.page;
      if (y + lh < L.page.y || y > L.page.y + L.page.h || ln.kind === 'gap') return;
      ctx.font = ln.kind === 'title' ? tfont : bfont;
      ctx.fillStyle = C.paperInk;
      ctx.fillText(ln.text, L.page.x, y);
    });
    undo();
    drawScrollBar(ctx, L.page, this.scroll.page, this.metrics.page);
  }

  drawObjectives(ctx, L, sim) {
    const cfg = this.cfg;
    const C = JOURNAL_COLORS;
    ctx.font = this.font();
    const measure = (s) => ctx.measureText(s).width;
    const lines = objectiveLines(objectives(sim), L.body.w - 4, measure);
    const lh = cfg.lineHeight;
    this.metrics.objectives = lines.length * lh + 4;
    this.scroll.objectives = clampScroll(this.scroll.objectives, this.metrics.objectives, L.body.h);
    const undo = this.clipTo(ctx, L.body);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    lines.forEach((ln, i) => {
      const y = L.body.y + i * lh - this.scroll.objectives;
      if (y + lh < L.body.y || y > L.body.y + L.body.h || ln.kind === 'gap') return;
      if (ln.kind === 'heading') {
        ctx.font = this.font(cfg.titlePx, 'bold ');
        ctx.fillStyle = C.paperInk;
        ctx.fillText(ln.text, L.body.x, y);
        return;
      }
      ctx.font = this.font();
      if (ln.kind === 'step' && ln.first) drawCheck(ctx, L.body.x + 1, y + 1, ln.known ? ln.done : null);
      if (ln.kind === 'hint' && ln.first) { ctx.fillStyle = C.paperDim; ctx.fillRect(L.body.x + 2, y + 4, 3, 1); }
      ctx.fillStyle = ln.kind === 'dim' || (ln.kind === 'step' && !ln.known) ? C.paperDim : C.paperInk;
      ctx.fillText(ln.text, L.body.x + 10, y);
    });
    undo();
    drawScrollBar(ctx, L.body, this.scroll.objectives, this.metrics.objectives);
  }

  drawRecipes(ctx, L, sim) {
    const cfg = this.cfg;
    const C = JOURNAL_COLORS;
    ctx.font = this.font();
    const measure = (s) => ctx.measureText(s).width;
    const views = this.recipesOf(sim);
    const lh = Math.max(cfg.lineHeight, Math.min(L.rowH, cfg.lineHeight + 4));
    const blocks = recipeLines(views, L.body.w - 4, measure, cfg.lineHeight);
    this.hits.make = [];
    if (!blocks.length) {
      ctx.textBaseline = 'top';
      ctx.fillStyle = C.paperDim;
      ctx.fillText('No recipes yet. Someone on this island knows how they make things here.', L.body.x, L.body.y);
      return;
    }
    if (this.recipeCursor >= blocks.length) this.recipeCursor = 0;
    const btnH = Math.max(lh + 2, L.rowH);
    const heights = blocks.map((b) => (b.lines.length - 1) * cfg.lineHeight + btnH + 8);
    const tops = [];
    let total = 0;
    for (const h of heights) { tops.push(total); total += h; }
    this.metrics.recipes = total;
    if (this.revealRecipe) {
      this.scroll.recipes = scrollToShow(this.scroll.recipes, tops[this.recipeCursor], heights[this.recipeCursor], L.body.h);
      this.revealRecipe = false;
    }
    this.scroll.recipes = clampScroll(this.scroll.recipes, total, L.body.h);
    const undo = this.clipTo(ctx, L.body);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    blocks.forEach((b, bi) => {
      let y = L.body.y + tops[bi] - this.scroll.recipes;
      const sel = bi === this.recipeCursor;
      if (sel) { ctx.fillStyle = 'rgba(179, 144, 98, 0.35)'; ctx.fillRect(L.body.x - 3, y - 2, L.body.w + 3, heights[bi] - 4); }
      for (const ln of b.lines) {
        if (ln.kind === 'action') {
          const label = b.state === 'make' ? 'Make' : b.state === 'made' ? 'Made' : b.state === 'at' ? `Made at the ${b.at ?? 'place'}` : 'Missing something';
          ctx.font = this.font(cfg.fontPx, 'bold ');
          const w = Math.max(40, Math.ceil(ctx.measureText(label).width) + 12);
          const r = { x: L.body.x, y: y + 1, w, h: btnH };
          drawButton(ctx, r, label, b.state === 'make');
          if (b.state === 'make') this.hits.make.push({ index: bi, x: r.x, y: Math.max(r.y, L.body.y), w: r.w, h: r.h });
          y += btnH;
          continue;
        }
        if (ln.kind === 'title') {
          ctx.font = this.font(cfg.titlePx, 'bold ');
          ctx.fillStyle = C.paperInk;
          ctx.fillText(ln.text, L.body.x, y);
        } else if (ln.kind === 'ingredient') {
          ctx.font = this.font();
          drawCheck(ctx, L.body.x + 1, y + 1, ln.ok);
          ctx.fillStyle = C.paperInk;
          ctx.fillText(ln.text, L.body.x + 10, y);
          ctx.fillStyle = ln.ok ? C.ok : C.rust;
          ctx.textAlign = 'right';
          ctx.fillText(`${Math.min(ln.have, 99)}/${ln.need}`, L.body.x + Math.min(L.body.w - 6, 220), y);
          ctx.textAlign = 'left';
        } else {
          ctx.font = this.font(cfg.fontPx, 'italic ');
          ctx.fillStyle = C.paperDim;
          ctx.fillText(ln.text, L.body.x, y);
        }
        y += cfg.lineHeight;
      }
    });
    undo();
    drawScrollBar(ctx, L.body, this.scroll.recipes, total);
  }
}

// ---- drawing pieces (swap these for the ui sheet's page_* 9-slice and tab_* icons) ------------------------------

/** the paper page */
export function drawPaper(ctx, r) {
  const C = JOURNAL_COLORS;
  ctx.fillStyle = C.paperDim;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = C.paperShade;
  ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  ctx.fillStyle = C.paperEdge;
  ctx.fillRect(r.x + 1, r.y + 1, r.w - 3, r.h - 3);
  ctx.fillStyle = C.paper;
  ctx.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
}

/** one tab: a raised paper tab when active, a dark one otherwise; icon(x, y) draws the 12 x 12 icon if it can */
export function drawTab(ctx, r, active, label, font, icon) {
  const C = JOURNAL_COLORS;
  ctx.fillStyle = active ? C.paperDim : C.ink;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = active ? C.paper : C.tab;
  ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - (active ? 0 : 2));
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const iconSize = 12;
  const tw = ctx.measureText(label).width;
  const hasRoom = r.w >= tw + iconSize + 12;
  const total = hasRoom ? iconSize + 3 + tw : tw;
  const x0 = Math.round(r.x + (r.w - total) / 2);
  const cy = r.y + r.h / 2;
  let tx = x0;
  if (hasRoom && icon(x0, Math.round(cy - iconSize / 2))) tx = x0 + iconSize + 3;
  else if (hasRoom) tx = Math.round(r.x + (r.w - tw) / 2);
  ctx.fillStyle = active ? C.tabTextActive : C.tabText;
  ctx.fillText(label, tx, cy + 1);
}

/** a 7 x 7 tick box: true ticked, false empty, null unknown ('?') */
export function drawCheck(ctx, x, y, state) {
  const C = JOURNAL_COLORS;
  ctx.fillStyle = C.paperDim;
  ctx.fillRect(x, y, 7, 7);
  ctx.fillStyle = C.paper;
  ctx.fillRect(x + 1, y + 1, 5, 5);
  if (state === true) {
    ctx.fillStyle = C.ok;
    ctx.fillRect(x + 1, y + 3, 1, 2);
    ctx.fillRect(x + 2, y + 4, 1, 2);
    ctx.fillRect(x + 3, y + 3, 1, 2);
    ctx.fillRect(x + 4, y + 2, 1, 2);
    ctx.fillRect(x + 5, y + 1, 1, 2);
  } else if (state === null) {
    ctx.fillStyle = C.paperDim;
    ctx.fillRect(x + 3, y + 5, 1, 1);
    ctx.fillRect(x + 3, y + 3, 1, 1);
    ctx.fillRect(x + 4, y + 2, 1, 1);
    ctx.fillRect(x + 2, y + 1, 2, 1);
  }
}

/** a button on the page */
export function drawButton(ctx, r, label, enabled) {
  const C = JOURNAL_COLORS;
  ctx.fillStyle = enabled ? C.paperInk : C.paperShade;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = enabled ? C.rust : C.paperEdge;
  ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  ctx.fillStyle = enabled ? C.tabText : C.paperDim;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

/** a thin bar at the right edge of a scrolled area (nothing when everything fits) */
export function drawScrollBar(ctx, r, scroll, contentH) {
  if (contentH <= r.h) return;
  const h = Math.max(8, Math.round((r.h * r.h) / contentH));
  const y = Math.round(r.y + (scroll / (contentH - r.h)) * (r.h - h));
  ctx.fillStyle = 'rgba(98, 68, 51, 0.55)';
  ctx.fillRect(r.x + r.w - 1, y, 2, h);
}

/** text cut with an ellipsis to fit */
function ellipsize(ctx, s, w) {
  if (ctx.measureText(s).width <= w) return s;
  let n = s.length;
  while (n > 1 && ctx.measureText(`${s.slice(0, n)}…`).width > w) n--;
  return `${s.slice(0, n)}…`;
}
