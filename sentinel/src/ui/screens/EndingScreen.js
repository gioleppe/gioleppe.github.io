// The ending screen (steps 5.3, 5.4): `screens.show('ending', { kind: 'dinghy' | 'rescue' })` once `sim.ending` is
// set (the game screen watches for it, as for the game over). A slow fade from the world, a few restrained lines,
// the run's figures, which way out it was (and a quiet note that another exists), a line on the save that is kept,
// then Title. The ending is remembered in the preferences (`endingsSeen`) so the title can mark it.
// Words: relief, not triumph; the island stays theirs; nobody followed you out; Marek stayed.
import { Menu, menuHeight } from './Menu.js';
import { SCREEN_COLORS as C, font, safeArea, rowHeight, TITLE_FONT, wrapText, measurer } from './theme.js';
import { playTimeText } from './saveText.js';

export const ENDING_KINDS = Object.freeze(['dinghy', 'rescue']);

const TEXT = Object.freeze({
  dinghy: {
    title: 'Out past the reef',
    tone: '#0c1a22',
    lines: [
      'The coral slides by under the hull, and then there is only the swell.',
      'By first light the island is a dark line on the water, then a smudge, then weather.',
      'You are alive. It does not feel like winning.',
      'Nobody followed you out. The island stays as it was: theirs. Marek stayed.',
    ],
  },
  rescue: {
    title: 'The light on the ridge',
    tone: '#14110c',
    lines: [
      'A white beam comes in off the sea and finds you on the rock.',
      'An engine, voices in a language you know, hands pulling you over a gunwale.',
      'Behind you the ridge goes dark again. Nobody followed you down.',
      'The island stays theirs. Marek stayed.',
    ],
  },
});

/**
 * The ending's words and figures for a `sim.ending` record (pure: tests read it).
 * @param {{ kind: string, day: number, distance: number, seconds: number, sites: number, sitesTotal: number,
 *   hit: boolean, hits: number, offerings: number|null }} e
 * @param {{ seen?: string[] }} [opts] the endings seen before this one
 */
export function endingLines(e, { seen = [] } = {}) {
  const kind = ENDING_KINDS.includes(e?.kind) ? e.kind : 'dinghy';
  const t = TEXT[kind];
  const d = Math.max(0, Number(e?.distance) || 0);
  const figures = [
    ['Days', String(Math.max(1, e?.day ?? 1))],
    ['Distance', d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`],
    ['Time', playTimeText(e?.seconds ?? 0)],
    ['Sites found', `${e?.sites ?? 0}/${e?.sitesTotal ?? 3}`],
    ['Arrows', e?.hit ? `hit ${e.hits}×` : 'never hit'],
  ];
  if (Number.isFinite(e?.offerings)) figures.push(['Offerings', String(e.offerings)]);
  const other = kind === 'dinghy' ? 'rescue' : 'dinghy';
  return {
    kind,
    title: t.title,
    tone: t.tone,
    lines: t.lines,
    way: kind === 'dinghy' ? 'You left by sea, in the dinghy.' : 'You were taken off Signal Peak.',
    hint: seen.includes(other) ? null : 'There was another way off the island.',
    saved: 'Your last autosave is kept: Continue returns to it.',
    figures,
  };
}

/**
 * Layout: title, the story lines that fit (all of them on most screens; on a very short one the first and the
 * last), the figures in rows of three, the way out, the notes, and a narrow menu, all inside the safe area.
 * @returns {{ area: Object, rowH: number, titleY: number, lines: number[], linesY: number, figuresY: number,
 *   figureRows: number, notesY: number, menu: Object }}
 */
export function endingLayout(vp, safe, cfg, { items, touch, lineCount, notes = 3 }) {
  const area = safeArea(vp, safe, cfg.margin);
  const E = cfg.ending;
  const rowH = rowHeight(vp, cfg, touch);
  const menuH = menuHeight(items, rowH, cfg.detailHeight);
  const figurePerRow = 3;
  const figureRows = Math.ceil(6 / figurePerRow);
  const figureH = figureRows * E.figureRowHeight;
  const titleH = E.titlePx + 6;
  const fixed = titleH + figureH + notes * cfg.lineHeight + menuH + 3 * E.gap;
  const room = Math.max(0, area.h - fixed);
  const fit = Math.min(lineCount, Math.floor(room / cfg.lineHeight));
  // which story lines show: all that fit, else the first and the last (never the middle only)
  let shown = [];
  for (let i = 0; i < lineCount; i++) shown.push(i);
  if (fit < lineCount) shown = fit >= 2 ? [...shown.slice(0, fit - 1), lineCount - 1] : fit === 1 ? [lineCount - 1] : [];
  const total = fixed + shown.length * cfg.lineHeight;
  let y = area.y + Math.max(0, Math.floor((area.h - total) / 2));
  const titleY = y;
  y += titleH + E.gap;
  const linesY = y;
  y += shown.length * cfg.lineHeight;
  const figuresY = y + E.gap;
  y = figuresY + figureH;
  const notesY = y;
  y += notes * cfg.lineHeight + E.gap;
  const w = Math.min(E.menuWidth, area.w);
  const menuY = Math.min(y, area.y + area.h - Math.min(menuH, area.h));
  return { area, rowH, titleY, lines: shown, linesY, figuresY, figureRows, figurePerRow, notesY, menu: { x: Math.round(area.x + (area.w - w) / 2), y: menuY, w, h: Math.min(menuH, area.y + area.h - menuY) } };
}

export class EndingScreen {
  constructor(ui) {
    this.ui = ui;
    this.pausesWorld = true;
    this.world = 'game';
    this.hud = false;
    this.menu = new Menu({ items: [] });
    this.shownAt = 0;
    this.acceptAt = 0;
    this.early = new Set();
    this.audioDue = false;
    this.text = null;
  }

  enter(params = {}, screens) {
    const sim = this.ui.actions.sim();
    const e = sim?.ending ?? { kind: params.kind ?? 'dinghy', day: 1, distance: 0, seconds: 0, sites: 0, sitesTotal: 3, hit: false, hits: 0, offerings: null };
    const kind = params.kind ?? e.kind;
    const prefs = this.ui.prefs;
    let seen = [];
    try { seen = Array.isArray(prefs?.get?.('endingsSeen')) ? prefs.get('endingsSeen') : []; } catch { seen = []; }
    this.text = endingLines({ ...e, kind }, { seen });
    if (!seen.includes(this.text.kind)) { try { prefs?.set?.('endingsSeen', [...seen, this.text.kind]); } catch { /* kept in memory only */ } }
    this.shownAt = screens.now();
    this.acceptAt = this.shownAt + screens.cfg.ending.inputLockSeconds * 1000;
    this.early.clear();
    this.audioDue = true;
    this.menu.setItems([{ id: 'title', label: 'Title', onSelect: () => screens.show('title') }], 'title');
  }

  /** the music: after Screens.show has told it 'ending', the ending's own cue */
  update() {
    if (!this.audioDue) return;
    this.audioDue = false;
    this.ui.audio?.setScreen?.(`ending_${this.text.kind === 'rescue' ? 'rescue' : 'dinghy'}`);
  }

  ready(now) { return now >= this.acceptAt; }

  onKey(code, repeat, screens) {
    if (repeat || !this.ready(screens.now())) return true;
    return this.menu.onKey(code, repeat);
  }

  handlePointer(ev, screens) {
    const now = screens.now();
    if (ev.type === 'down' && !this.ready(now)) { this.early.add(ev.id); return null; }
    if ((ev.type === 'up' || ev.type === 'cancel') && this.early.has(ev.id)) { this.early.delete(ev.id); return null; }
    if (this.early.has(ev.id)) return null;
    if (ev.type === 'move' && !this.ready(now)) return null;
    return this.menu.handlePointer(ev);
  }

  draw(ctx, vp, safe, now, screens) {
    const cfg = screens.cfg;
    const E = cfg.ending;
    const T = this.text;
    const t = (now - this.shownAt) / 1000;
    const fade = Math.min(1, t / E.fadeSeconds);
    const W = vp.uiLogicalWidth;
    const H = vp.uiLogicalHeight;
    ctx.save();
    ctx.globalAlpha = E.dimAlpha * fade;
    ctx.fillStyle = T.tone;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(13, 11, 18, 0.55)';
    ctx.fillRect(0, 0, W, H);
    const area = safeArea(vp, safe, cfg.margin);
    ctx.font = font(cfg.fontPx, 'italic ', TITLE_FONT);
    const m = measurer(ctx);
    const wrapped = T.lines.map((l) => wrapText(l, area.w - 8, m));
    const flat = [];
    wrapped.forEach((ls, i) => ls.forEach((s) => flat.push({ s, i })));
    ctx.font = font(cfg.detailPx + 1);
    const mn = measurer(ctx);
    const notes = [];
    for (const [s, color] of [[T.way, C.sand], [T.hint, C.dim], [T.saved, C.dim]]) if (s) for (const w of wrapText(s, area.w - 4, mn)) notes.push([w, color]);
    const L = endingLayout(vp, safe, cfg, { items: this.menu.items, touch: screens.isTouch(), lineCount: flat.length, notes: notes.length });
    this.layout = L;
    const cx = Math.round(area.x + area.w / 2);
    // the lines come one at a time after the fade
    const since = t - E.fadeSeconds * 0.6;
    const alphaOf = (k) => Math.max(0, Math.min(1, (since - k * E.lineSeconds) / 0.8));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.globalAlpha = Math.min(1, Math.max(0, since / 0.8));
    // the title shrinks to fit a narrow screen
    let tpx = E.titlePx;
    ctx.font = font(tpx, '', TITLE_FONT);
    while (tpx > 6 && ctx.measureText(T.title).width > area.w - 4) { tpx -= 1; ctx.font = font(tpx, '', TITLE_FONT); }
    ctx.fillStyle = C.bone;
    ctx.fillText(T.title, cx, L.titleY);
    ctx.fillStyle = C.amber;
    ctx.fillRect(cx - 20, L.titleY + E.titlePx + 3, 40, 1);
    ctx.font = font(cfg.fontPx, 'italic ', TITLE_FONT);
    ctx.fillStyle = C.sand;
    L.lines.forEach((idx, row) => {
      ctx.globalAlpha = alphaOf(flat[idx].i);
      ctx.fillText(flat[idx].s, cx, L.linesY + row * cfg.lineHeight);
    });
    const after = alphaOf(T.lines.length);
    ctx.globalAlpha = after;
    const colW = Math.min(96, Math.floor(area.w / L.figurePerRow));
    T.figures.forEach(([label, value], i) => {
      const r = Math.floor(i / L.figurePerRow);
      const c = i % L.figurePerRow;
      const x = Math.round(cx + (c - 1) * colW);
      const y = L.figuresY + r * E.figureRowHeight;
      ctx.font = font(cfg.titlePx + 1, 'bold ');
      ctx.fillStyle = C.bone;
      ctx.fillText(value, x, y);
      ctx.font = font(cfg.detailPx);
      ctx.fillStyle = C.dim;
      ctx.fillText(label, x, y + cfg.titlePx + 3);
    });
    ctx.font = font(cfg.detailPx + 1);
    let y = L.notesY;
    for (const [s, color] of notes) {
      ctx.fillStyle = color;
      ctx.fillText(s, cx, y);
      y += cfg.lineHeight;
    }
    ctx.globalAlpha = this.ready(now) ? after : 0.35 * after;
    this.menu.draw(ctx, L.menu, { rowH: L.rowH, detailH: cfg.detailHeight, fontPx: cfg.fontPx + 1, detailPx: cfg.detailPx, align: 'center' });
    ctx.restore();
  }
}
