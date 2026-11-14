// Dialogue box with typewriter text, pages and choices. Also used for whiteout and tent messages.
import { W, H } from './CanvasRenderer.js';
import { drawText, wrap, textWidth, panel, list, typeTag, bar, C } from './ui.js';
import { termRuns } from './glossary.js';
import { tl } from '../core/i18n.js';

const BOX_H = 50, LINES = 3, STYLE_SPEED = { STIMULANT: 110, DOWNER: 28, PSYCHEDELIC: 55, NORMAL: 60 };
// A choice box ignores confirm for this long after it opens, so mashing through the text
// cannot pick an answer the player never saw.
export const CHOICE_GRACE = 0.4;

export const dialogueView = {
  pages: [], page: 0, shown: 0, cursor: 0, key: null, t: 0, choiceT: 0,

  sync(game) {
    const d = game.engine.state.dialogue;
    const key = d ? `${d.speaker}|${d.text}` : null;
    if (key === this.key) return d;
    this.key = key; this.page = 0; this.shown = 0; this.cursor = d?.choiceDefault || 0; this.choiceT = 0;
    this.pages = [];
    if (d) { const lines = wrap(d.text, W - 28); for (let i = 0; i < lines.length; i += LINES) this.pages.push(lines.slice(i, i + LINES)); }
    return d;
  },

  update(game, dt) {
    const d = this.sync(game);
    if (!d) return;
    this.t += dt;
    const input = game.input, speedMul = [0.6, 1, 2.5][game.settings.textSpeed ?? 1];
    const total = this.pages[this.page].join('').length;
    const before = Math.floor(this.shown);
    this.shown = Math.min(total, this.shown + dt * (STYLE_SPEED[d.style] || 60) * speedMul);
    if (Math.floor(this.shown) > before && Math.floor(this.shown) % 3 === 0) game.audio?.sfx('blip');
    const lastPage = this.page === this.pages.length - 1, done = this.shown >= total;
    if (done && lastPage && d.choices) {          // choices are handled in draw (needs geometry)
      if (this.choiceT < CHOICE_GRACE) { input.pressed('a'); input.pressed('b'); input.anyTap(); }
      this.choiceT += dt;
      return;
    }
    if (input.pressed('a') || input.pressed('b') || input.anyTap()) {
      if (!done) this.shown = total;
      else if (!lastPage) { this.page++; this.shown = 0; }
      else { this.key = null; game.send({ type: 'ADVANCE_DIALOGUE' }); }
    }
  },

  draw(game, g) {
    // sync first: a line can advance during this frame's update (or a choice in the last draw), and drawing the
    // new dialogue with the old line's progress would flash its choice box before the question is typed
    const d = this.sync(game);
    if (!d || !this.pages.length) return;
    const y = H - BOX_H - 3, intox = game.fxLevel();
    panel(g, 3, y, W - 6, BOX_H, { bg: C.cream, accent: C.terracotta });
    if (d.speaker) {
      const w = textWidth(d.speaker) + 12;
      panel(g, 8, y - 9, w, 14, { bg: C.chai, accent: C.marigold });
      drawText(g, d.speaker, 14, y - 6, { color: C.cream });
    }
    let left = Math.floor(this.shown);
    const lines = this.pages[this.page];
    lines.forEach((line, i) => {
      const part = line.slice(0, Math.max(0, left)); left -= line.length;
      let color = C.ink;
      if (d.style === 'PSYCHEDELIC') color = ['#8F00FF', '#C2185B', '#00796B', '#B34700'][(Math.floor(this.t * 3) + i) % 4];
      if (d.style === 'DOWNER') color = '#5A5F8A';
      const jitter = d.style === 'STIMULANT' ? Math.round(Math.sin(this.t * 40 + i * 2)) : 0;
      const runs = d.style === 'PSYCHEDELIC' ? null : termRuns(line, game.data);   // key terms in colour (not over the rainbow)
      drawText(g, part, 12 + jitter, y + 9 + i * 12, { color, scramble: intox > 0.9 ? 0.12 : 0, t: this.t, runs });
    });
    const total = lines.join('').length, done = this.shown >= total, lastPage = this.page === this.pages.length - 1;
    if (done && !(lastPage && d.choices) && Math.floor(this.t * 3) % 2) drawText(g, 'v', W - 16, y + BOX_H - 12, { color: C.magenta });
    if (done && lastPage && d.choices) {
      const w = Math.max(...d.choices.map((c) => textWidth(c))) + 24, h = d.choices.length * 14 + 8;
      const x = W - w - 6, cy = y - h - 2;
      panel(g, x, cy, w, h, { bg: C.cream, accent: C.magenta });
      const r = list(game, g, d.choices.map((c) => ({ label: c })), x + 4, cy + 4, w - 8, this.cursor);
      this.cursor = r.cursor;
      const sp = d.show && game.data.dex[d.show[this.cursor]];
      if (sp) this.drawPreview(game, g, sp, 8, y - 76);
      if (r.chosen >= 0) { this.key = null; game.send({ type: 'ADVANCE_DIALOGUE', choiceIndex: r.chosen }); }
    }
  },

  /** creature card shown beside a choice that offers creatures (the starter pick) */
  drawPreview(game, g, sp, x, y) {
    const w = 112, h = 62, bs = sp.baseStats || {};
    panel(g, x, y, w, h, { bg: C.cream, accent: C.magenta });
    const img = game.images[`mon:${sp.id}`];
    if (img) g.drawImage(img, 64, 64, 40, 40, x + 3, y + 3, 40, 40);   // the 40 px miniature (frame 11)
    drawText(g, sp.name, x + 46, y + 6, { color: C.ink });
    let ty = y + 17;
    for (const t of sp.types) { typeTag(g, t, x + 46, ty); ty += 12; }
    [['SER', bs.serotonin], ['ATK', Math.max(bs.vibeAttack || 0, bs.spFractal || 0)], ['BPM', bs.bpmSpeed]].forEach(([label, v], i) => {
      const bx = x + 5 + i * 35;
      drawText(g, label === 'BPM' ? tl(label).slice(0, 3).toUpperCase() : tl(label), bx, y + 47, { color: C.chai });
      bar(g, bx + 19, y + 48, 13, 5, (v || 0) / 100, '#FF4FA8');
    });
  },
};
