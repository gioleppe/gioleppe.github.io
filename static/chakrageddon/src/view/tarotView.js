// Juniper's table (mode TAROT, from six wristbands): an Astral's past lives laid out as cards. Pick an Astral, then a
// move from its past (anything its line learns by its level that it does not know now), then, with four moves already,
// the one it lets go. Every move shows its note (moveInfo.js) before you choose. The engine does the rest (RELEARN_MOVE).
import { W, H } from './CanvasRenderer.js';
import { drawText, wrap, textWidth, panel, list, moveName, C } from './ui.js';
import { nameOf, rememberable } from '../core/mons.js';
import { moveFacts, drawNote } from './moveInfo.js';
import { tl, tln } from '../core/i18n.js';

const VELVET = '#1A0B2E', GOLD = '#E8B04A', CARD = '#FFF4E4';
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI'];

export const tarotView = {
  step: 'pick', mon: 0, move: 0, forget: 0, sure: 0, pick: null, t: 0,
  onEvent(game, e) {
    if (e.type === 'TRANSITION_MODE' && e.to === 'TAROT') { this.step = 'pick'; this.mon = 0; this.move = 0; this.forget = 0; this.pick = null; }
    if (e.type === 'MOVE_LEARNED' && e.remembered) { this.flash = 0.6; this.step = 'pick'; this.pick = null; }
  },
  update(game, dt) { this.t += dt; if (this.flash > 0) this.flash -= dt; },

  draw(game, g) {
    const s = game.engine.state;
    if (s.mode !== 'TAROT') return;
    const d = game.data, input = game.input, price = d.rules.tarot?.price ?? 500, broke = s.rupees < price;
    // the reading cloth: deep velvet, a scatter of stars, a gold border
    g.fillStyle = VELVET; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) { const x = (i * 97) % W, y = (i * 61 + 13) % H, tw = Math.sin(this.t * 2 + i) > 0.6; g.fillStyle = tw ? '#FFE066' : '#4A2A6A'; g.fillRect(x, y, 1, 1); }
    g.fillStyle = GOLD; g.fillRect(4, 4, W - 8, 1); g.fillRect(4, H - 5, W - 8, 1); g.fillRect(4, 4, 1, H - 8); g.fillRect(W - 5, 4, 1, H - 8);
    drawText(g, tl('Juniper\'s Past Life Readings'), 12, 10, { color: GOLD });
    drawText(g, tl('Rs {0}', s.rupees), W - 12, 10, { color: broke ? '#FF6B6B' : C.cream, align: 'right' });
    drawText(g, tl('Rs {0} a reading. B: back', price), 12, 21, { color: '#9A8AB8' });

    const party = s.party, mon = party[this.mon];
    const past = (m) => (m ? rememberable(d, m) : []);

    if (this.step === 'pick') {
      // which Astral sits down: each with how many moves its past holds
      const items = party.map((m) => { const n = past(m).length; return { label: tl('{0} Lv{1}', nameOf(d, m), m.level), right: n ? tln(n, '{0} move', '{0} moves') : tl('none'), disabled: !n, color: C.cream, rightColor: n ? GOLD : '#6A5A8A' }; });
      const r = list(game, g, items, 10, 36, 180, this.mon, { rowH: 16, hi: '#4A2A6A' });
      this.mon = r.cursor;
      this.card(game, g, party[this.mon], this.mon, 200, 34);
      if (!past(party[this.mon]).length) drawText(g, tl('Its past is all here already.'), 12, H - 20, { color: '#9A8AB8' });
      if (r.chosen >= 0) { this.step = 'moves'; this.move = 0; }
      else if (input.pressed('b')) game.send({ type: 'CLOSE_TAROT' });
      return this.shine(g);
    }

    const moves = past(mon);
    if (!mon || !moves.length) { this.step = 'pick'; return; }
    if (this.step === 'moves') {
      wrap(tl('{0} remembers...', nameOf(d, mon)), 124).slice(0, 1).forEach((ln) => drawText(g, ln, 12, 32, { color: C.cream }));
      const items = moves.map((id) => ({ label: moveName(d.moves[id], 104), color: C.cream, disabled: broke }));
      const r = list(game, g, items, 10, 44, 124, this.move, { rowH: 16, maxRows: 7, hi: '#4A2A6A' });
      this.move = r.cursor;
      this.page(g, moveFacts(d, d.moves[moves[this.move]], mon), 140, 32);
      if (broke) drawText(g, tl('Not enough rupees.'), 12, H - 18, { color: '#FF6B6B' });
      if (r.chosen >= 0) { this.pick = moves[r.chosen]; this.step = mon.moves.length >= 4 ? 'forget' : 'sure'; this.forget = 0; this.sure = 0; }
      else if (input.pressed('b')) { this.step = 'pick'; game.audio?.sfx('back'); }
      return this.shine(g);
    }

    const pick = d.moves[this.pick];
    if (this.step === 'forget') {
      // four moves already: which one makes room. Each shows its note; the one coming in is named at the top
      wrap(tl('For {0}, forget...', pick.name), 124).slice(0, 2).forEach((ln, k) => drawText(g, ln, 12, 32 + k * 9, { color: C.cream }));
      const items = mon.moves.map((id) => ({ label: moveName(d.moves[id], 104), color: C.cream }));
      const r = list(game, g, items, 10, 52, 124, this.forget, { rowH: 16, hi: '#4A2A6A' });
      this.forget = r.cursor;
      this.page(g, moveFacts(d, d.moves[mon.moves[this.forget]], mon), 140, 32);
      if (r.chosen >= 0) { this.step = 'sure'; this.sure = 0; }
      else if (input.pressed('b')) { this.step = 'moves'; game.audio?.sfx('back'); }
      return this.shine(g);
    }

    // are you sure? No on the cursor
    const old = mon.moves.length >= 4 ? d.moves[mon.moves[this.forget]] : null;
    const q = old ? tl('{0} forgets {1} and remembers {2}, for Rs {3}?', nameOf(d, mon), old.name, pick.name, price) : tl('{0} remembers {1}, for Rs {2}?', nameOf(d, mon), pick.name, price);
    wrap(q, 124).forEach((ln, i) => drawText(g, ln, 12, 34 + i * 10, { color: C.cream }));
    const r = list(game, g, [{ label: old ? tl('No, keep it') : tl('No'), color: C.cream }, { label: tl('Yes'), color: GOLD }], 10, 96, 124, this.sure, { rowH: 16, hi: '#4A2A6A' });
    this.sure = r.cursor;
    this.page(g, moveFacts(d, pick, mon), 140, 32);
    if (r.chosen === 1) game.send({ type: 'RELEARN_MOVE', partyIndex: this.mon, moveId: this.pick, slot: old ? this.forget : -1 });
    else if (r.chosen === 0 || input.pressed('b')) { this.step = old ? 'forget' : 'moves'; game.audio?.sfx('back'); }
    return this.shine(g);
  },

  /** a move's note on a cream card, right of the list */
  page(g, n, x, y) {
    const w = W - x - 10, h = H - y - 10;
    panel(g, x, y, w, h, { bg: CARD, border: GOLD, accent: '#C86BFF' });
    drawNote(g, n, x + 6, y + 6, w - 12, h - 10);
  },

  /** the Astral as a tarot card: its numeral, its picture, THE NAME */
  card(game, g, m, i, x, y) {
    if (!m) return;
    const w = 108, h = 130, img = game.images[`mon:${m.speciesId}`];
    panel(g, x, y, w, h, { bg: CARD, border: GOLD, accent: '#C86BFF' });
    g.fillStyle = GOLD; g.fillRect(x + 6, y + 18, w - 12, 1); g.fillRect(x + 6, y + h - 22, w - 12, 1);
    drawText(g, ROMAN[i + 1], x + w / 2, y + 7, { color: C.purple, align: 'center' });   // its place in the party
    if (img) g.drawImage(img, (Math.floor(this.t * 2) % 2) * 64, 0, 64, 64, x + (w - 64) / 2, y + 24, 64, 64);
    const title = tl('THE {0}', nameOf(game.data, m).toUpperCase());
    drawText(g, textWidth(title) <= w - 8 ? title : nameOf(game.data, m).toUpperCase(), x + w / 2, y + h - 16, { color: C.ink, align: 'center' });
  },

  /** a moment of light when a move comes back */
  shine(g) {
    if (!(this.flash > 0)) return;
    g.globalAlpha = Math.min(0.5, this.flash); g.fillStyle = '#FFE066'; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
  },
};

export function install(game) { game.register('tarot', tarotView); }
