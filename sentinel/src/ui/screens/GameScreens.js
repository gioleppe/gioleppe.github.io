// The in-game screens (step 5.1): the plain game, the pause menu, the game over; the ending is EndingScreen.js.
//
// game      nothing drawn; watches for the run being lost and, after a short beat that lets the death be seen,
//           shows the game over; and for an ending reached (sim.ending, steps 5.3 / 5.4): the ending screen
// pause     Resume, Save, Load, Settings, Quit to Title over the dimmed, stopped world (Esc / P / the touch pause
//           button). Save shows why it is refused ("Not while they are searching for you").
// gameover  spec §8: the screen dims to the cause's tone; days survived and distance travelled; Retry (the newest
//           save, else a new game), Load, Title. Input is ignored for a moment so a held key cannot skip it.
// ending    EndingScreen.js (steps 5.3 / 5.4): screens.show('ending', { kind })
import { Panel } from './Panel.js';
import { Menu, menuHeight } from './Menu.js';
import { SCREEN_COLORS as C, font, safeArea, rowHeight, TITLE_FONT, wrapText, measurer } from './theme.js';
import { settingsPanel, slotsPanel, confirmPanel, messagePanel } from './panels.js';
import { slotLine, agoText, playTimeText } from './saveText.js';
import { EndingScreen } from './EndingScreen.js';

export class GameScreen {
  constructor(ui) {
    this.ui = ui;
    this.pausesWorld = false;
    this.world = 'game';
    this.hud = true;
    this.deadFor = 0;
    this.endedFor = 0;
  }

  enter() { this.deadFor = 0; this.endedFor = 0; }

  update(dt, now, screens) {
    const sim = this.ui.actions.sim();
    if (sim?.ending && !sim.over) {
      // a way out (steps 5.3, 5.4): a beat to see the boat clear the reef or the light settle, then the ending
      this.endedFor += dt;
      if (this.endedFor >= screens.cfg.ending.delaySeconds) screens.show('ending', { kind: sim.ending.kind });
      return;
    }
    this.endedFor = 0;
    if (!sim?.over) { this.deadFor = 0; return; }
    this.deadFor += dt;
    if (this.deadFor >= screens.cfg.gameOver.delaySeconds) screens.show('gameover', { over: sim.over });
  }

  /** the plain game owns no keys (the modal is off); kept for completeness */
  onKey() { return false; }
}

export class PauseScreen {
  constructor(ui) {
    this.ui = ui;
    this.pausesWorld = true;
    this.world = 'game';
    this.hud = true;
    this.panel = null;
  }

  enter() {
    const ui = this.ui;
    const a = ui.actions;
    const items = () => {
      const out = [{ id: 'resume', label: 'Resume', onSelect: () => this.resume() }];
      if (a.saving) {
        const c = a.canSave();
        out.push({
          id: 'save', label: 'Save', detail: c.ok ? null : c.reason, tone: c.ok ? undefined : 'quiet',
          onSelect: () => (c.ok ? slotsPanel(ui, 'save') : this.refuse(c.reason)),
        });
        out.push({ id: 'load', label: 'Load', onSelect: () => slotsPanel(ui, 'load') });
      }
      out.push({ id: 'settings', label: 'Settings', onSelect: () => settingsPanel(ui) });
      out.push({ id: 'quit', label: 'Quit to Title', onSelect: () => this.quit() });
      return out;
    };
    const text = () => {
      const s = a.summary();
      return s ? `${slotLine(s)} · ${playTimeText(s.playSeconds)} played` : '';
    };
    this.panel = new Panel({ id: 'pause', title: 'Paused', text, items, onBack: () => this.resume() });
  }

  refuse(reason) {
    this.panel.note = { text: reason, color: C.amber };
  }

  resume() { this.ui.screens.show('game'); }

  quit() {
    const ui = this.ui;
    const a = ui.actions;
    const r = a.quitToTitle({ dryRun: true });
    if (r.ok) { a.quitToTitle(); return; }
    const last = a.saving ? a.newestSave() : null;
    const text = a.saving
      ? `${r.refused ?? 'This moment cannot be saved.'} ${last ? `You will continue from ${slotLine(last.env)}, saved ${agoText(last.env.savedAt, a.now())}.` : 'There is no save to continue from.'}`
      : 'This run will be lost.';
    confirmPanel(ui, { title: 'Quit to the title?', text, yes: 'Quit anyway', no: 'Stay', danger: true, onYes: () => a.quitToTitle({ force: true }) });
  }

  onKey(code, repeat) {
    if (!repeat && code === 'KeyP') { this.resume(); return true; }
    return this.panel.onKey(code, repeat);
  }

  handlePointer(ev) { return this.panel.handlePointer(ev); }

  draw(ctx, vp, safe, now, screens) {
    ctx.save();
    ctx.fillStyle = C.backdrop;
    ctx.fillRect(0, 0, vp.uiLogicalWidth, vp.uiLogicalHeight);
    ctx.restore();
    this.panel.draw(ctx, vp, safe, screens.cfg, { touch: screens.isTouch() });
  }
}

const CAUSES = Object.freeze({
  arrow: { name: 'Struck by an arrow', line: 'This is their island, and they keep it.' },
  bleed: { name: 'Bled out', line: 'The wound would not close.' },
  drowning: { name: 'Drowned', line: 'The sea took back what it brought.' },
  thirst: { name: 'Died of thirst', line: 'There was water somewhere. Not near enough.' },
  debug: { name: 'Ended', line: '(debug)' },
});

/**
 * The game over's words for a `sim.over` record: the cause in one restrained line, never gloating, never making
 * the islanders monsters; days survived (the day the run ended on, counting the first as 1) and distance.
 * @param {{ cause: string, day: number, distance: number }} over
 */
export function deathLines(over) {
  const c = CAUSES[over?.cause] ?? { name: 'Lost', line: '' };
  const d = Math.max(0, Number(over?.distance) || 0);
  return {
    title: 'You did not get away',
    cause: c.name,
    line: c.line,
    days: String(Math.max(1, over?.day ?? 1)),
    distance: d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`,
  };
}

/**
 * Game over layout: the text block centred above a narrow menu.
 * @returns {{ area: Object, textY: number, menu: Object, rowH: number }}
 */
export function gameOverLayout(vp, safe, cfg, { items, touch, textH }) {
  const area = safeArea(vp, safe, cfg.margin);
  const rowH = rowHeight(vp, cfg, touch);
  const menuH = menuHeight(items, rowH, cfg.detailHeight);
  const w = Math.min(cfg.gameOver.menuWidth, area.w);
  const total = textH + 10 + menuH;
  const top = area.y + Math.max(0, Math.floor((area.h - total) / 2));
  const menuY = Math.min(top + textH + 10, area.y + area.h - Math.min(menuH, area.h));
  return { area, rowH, textY: top, menu: { x: Math.round(area.x + (area.w - w) / 2), y: menuY, w, h: Math.min(menuH, area.y + area.h - menuY) } };
}

export class GameOverScreen {
  constructor(ui) {
    this.ui = ui;
    this.pausesWorld = true;
    this.world = 'game';
    this.hud = false;
    this.menu = new Menu({ items: [] });
    this.shownAt = 0;
    this.acceptAt = 0;
    /** pointers that went down before input was accepted: their release is ignored too */
    this.early = new Set();
  }

  enter(params = {}, screens) {
    const a = this.ui.actions;
    this.over = params.over ?? a.sim()?.over ?? { cause: 'lost', day: 1, distance: 0 };
    this.lines = deathLines(this.over);
    this.shownAt = screens.now();
    this.acceptAt = this.shownAt + screens.cfg.gameOver.inputLockSeconds * 1000;
    this.early.clear();
    const newest = a.saving ? a.newestSave() : null;
    const items = [
      { id: 'retry', label: 'Retry', detail: newest ? `from ${slotLine(newest.env)}` : 'a new game', onSelect: () => this.retry() },
      ...(a.saving ? [{ id: 'load', label: 'Load', onSelect: () => slotsPanel(this.ui, 'load') }] : []),
      { id: 'title', label: 'Title', onSelect: () => screens.show('title') },
    ];
    this.menu.setItems(items, 'retry');
  }

  /** input is accepted: the lock has passed */
  ready(now) { return now >= this.acceptAt; }

  retry() {
    const r = this.ui.actions.retry();
    if (r && !r.ok) messagePanel(this.ui, { title: 'Cannot retry', text: r.message });
  }

  onKey(code, repeat, screens) {
    if (repeat || !this.ready(screens.now())) return true;   // a held key cannot skip the game over
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
    const g = cfg.gameOver;
    const t = (now - this.shownAt) / 1000;
    const dim = Math.min(1, t / g.dimSeconds);
    const W = vp.uiLogicalWidth;
    const H = vp.uiLogicalHeight;
    ctx.save();
    ctx.globalAlpha = g.dimAlpha * dim;
    ctx.fillStyle = g.tones[this.over.cause] ?? g.tones.default;
    ctx.fillRect(0, 0, W, H);
    // a darker vignette towards the edges
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(13, 11, 18, 0)');
    v.addColorStop(1, 'rgba(13, 11, 18, 0.85)');
    ctx.globalAlpha = dim;
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    const area = safeArea(vp, safe, cfg.margin);
    const textAlpha = Math.min(1, Math.max(0, (t - g.dimSeconds * 0.4) / 0.8));
    ctx.font = font(cfg.fontPx, 'italic ', TITLE_FONT);
    const m = measurer(ctx);
    const quote = this.lines.line ? wrapText(this.lines.line, area.w - 8, m) : [];
    const textH = 16 + 12 + quote.length * cfg.lineHeight + 8 + 24;
    const L = gameOverLayout(vp, safe, cfg, { items: this.menu.items, touch: screens.isTouch(), textH });
    this.layout = L;
    const cx = Math.round(area.x + area.w / 2);
    let y = L.textY;
    ctx.globalAlpha = textAlpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = font(g.titlePx, '', TITLE_FONT);
    ctx.fillStyle = C.bone;
    ctx.fillText(this.lines.title, cx, y);
    y += g.titlePx + 4;
    ctx.fillStyle = C.rust;
    ctx.fillRect(cx - 20, y, 40, 1);
    y += 5;
    ctx.font = font(cfg.fontPx);
    ctx.fillStyle = C.sand;
    ctx.fillText(this.lines.cause, cx, y);
    y += cfg.lineHeight + 1;
    ctx.font = font(cfg.fontPx, 'italic ', TITLE_FONT);
    ctx.fillStyle = C.dim;
    for (const q of quote) { ctx.fillText(q, cx, y); y += cfg.lineHeight; }
    y += 7;
    // the two numbers of spec §8, side by side
    const cols = [['Days survived', this.lines.days], ['Distance travelled', this.lines.distance]];
    const colW = Math.min(90, Math.floor(area.w / 2));
    cols.forEach(([label, value], i) => {
      const x = cx + (i === 0 ? -colW / 2 : colW / 2);
      ctx.font = font(cfg.titlePx + 2, 'bold ');
      ctx.fillStyle = C.bone;
      ctx.fillText(value, Math.round(x), y);
      ctx.font = font(cfg.detailPx);
      ctx.fillStyle = C.dim;
      ctx.fillText(label, Math.round(x), y + cfg.titlePx + 5);
    });
    ctx.globalAlpha = this.ready(now) ? 1 : 0.35 * textAlpha;
    this.menu.draw(ctx, L.menu, { rowH: L.rowH, detailH: cfg.detailHeight, fontPx: cfg.fontPx + 1, detailPx: cfg.detailPx, align: 'center' });
    ctx.restore();
  }
}

/** the four standard screens and the ending (EndingScreen.js), registered on a Screens */
export function registerGameScreens(screens, ui) {
  screens.register('game', new GameScreen(ui));
  screens.register('pause', new PauseScreen(ui));
  screens.register('gameover', new GameOverScreen(ui));
  screens.register('ending', new EndingScreen(ui));
}

export { confirmPanel, messagePanel };
