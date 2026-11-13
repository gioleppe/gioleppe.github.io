// Quick items: from the overworld, one button (Q or I, or ITEMS on the touch pad) opens a small panel to use
// snacks and water on any Astral without going through the Fanny Pack. Pick an item, then an Astral; it stays
// on the Astral list so the same item can go to the next one straight away. B steps back, then closes.
// Once you have the blotter it is the first row: A licks it, no Astral needed (L, Y or LICK do it in one press).
import { W, H } from './CanvasRenderer.js';
import { drawText, wrap, panel, list, C } from './ui.js';
import { statsOf, nameOf } from '../core/mons.js';

const PX = 8, PY = 8, PW = W - 16, PH = H - 16, ROW = 17;   // room for a full team of six

export const quickView = {
  open: false, step: 'item', itemId: null, cursor: { item: 0, mon: 0 },
  busy() { return this.open; },

  /** recovery items in the bag, in bag order */
  items(game) {
    const s = game.engine.state, d = game.data;
    return [...(s.bag.glowing_blotter > 0 ? ['glowing_blotter'] : []), ...Object.keys(s.bag).filter((id) => s.bag[id] > 0 && d.items[id]?.category === 'RECOVERY')];
  },

  update(game) {
    const s = game.engine?.state, input = game.input;
    if (!s) return;
    if (!this.open) {
      if (game.screen === 'play' && s.mode === 'OVERWORLD' && !s.dialogue && !game.busy() && input.pressed('item')) {
        this.open = true; this.step = 'item'; this.cursor.item = 0; game.audio?.sfx('select');
      }
      return;
    }
    if (s.mode !== 'OVERWORLD' || s.dialogue) { this.open = false; return; }    // something else took over
    if (input.pressed('item')) this.close(game);
  },
  close(game) { this.open = false; this.step = 'item'; game.audio?.sfx('back'); },

  draw(game, g) {
    if (!this.open) return;
    const s = game.engine.state, d = game.data, input = game.input;
    g.fillStyle = 'rgba(11,3,20,0.45)'; g.fillRect(0, 0, W, H);
    panel(g, PX, PY, PW, PH, { bg: '#FFF4E4', accent: C.acid });
    drawText(g, 'QUICK ITEMS', PX + 8, PY + 5, { color: C.purple });
    const ids = this.items(game);
    if (!ids.length) {
      wrap('Nothing to use. Stalls sell snacks and water, and beaten wild Astrals sometimes leave some behind.', PW - 20).forEach((ln, i) => drawText(g, ln, PX + 8, PY + 22 + i * 11, { color: C.ink }));
      if (input.pressed('a') || input.pressed('b') || input.anyTap()) this.close(game);
      return;
    }
    if (!ids.includes(this.itemId)) { this.itemId = null; this.step = 'item'; }
    const pick = this.step === 'item';

    // left: what you have
    const ir = list(game, g, ids.map((id) => ({ label: id === 'glowing_blotter' ? 'Lick the blotter' : d.items[id].name, right: id === 'glowing_blotter' ? '' : `x${s.bag[id]}`, color: !pick && id === this.itemId ? C.magenta : undefined })), PX + 4, PY + 18, 136, Math.min(this.cursor.item, ids.length - 1), { rowH: 14, maxRows: 6, passive: !pick });
    if (pick) this.cursor.item = ir.cursor;
    const shown = d.items[ids[Math.min(this.cursor.item, ids.length - 1)]];

    // right: your team, with Serotonin and Hydration
    const rows = s.party.map((m) => {
      const st = statsOf(d, m);
      return { label: `${nameOf(d, m)}`, right: m.hp > 0 ? `${m.hp}/${st.maxHp}` : 'OUT', rightColor: m.hp > 0 ? C.ink : C.red };
    });
    const mx = PX + 146, mw = PW - 150;
    const mr = list(game, g, rows, mx, PY + 18, mw, this.cursor.mon, { rowH: ROW, passive: pick });
    // under each name: Serotonin (2 px, green or red when low) and Hydration (1 px, blue)
    const line = (x, y, w, h, k, col) => { g.fillStyle = '#E0D2BC'; g.fillRect(x, y, w, h); g.fillStyle = col; g.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, k))), h); };
    s.party.forEach((m, i) => {
      const st = statsOf(d, m), y = PY + 18 + i * ROW + 13;
      line(mx + 9, y, mw - 14, 2, m.hp / st.maxHp, m.hp > st.maxHp * 0.3 ? '#2A8A4A' : C.red);
      line(mx + 9, y + 2, mw - 14, 1, m.hyd / st.maxHyd, '#2A7A9A');
    });
    if (!pick) this.cursor.mon = mr.cursor;

    // the line at the bottom: what the item does, or what to do next
    const help = pick ? shown.desc : `Give the ${d.items[this.itemId].name} to whom? (x${s.bag[this.itemId]} left)`;
    wrap(help, PW - 20).slice(0, 2).forEach((ln, i) => drawText(g, ln, PX + 8, PY + PH - 24 + i * 10, { color: C.chai }));

    if (pick) {
      if (ir.chosen >= 0 && ids[ir.chosen] === 'glowing_blotter') { this.open = false; game.send({ type: 'USE_ITEM', itemId: 'glowing_blotter' }); }
      else if (ir.chosen >= 0) { this.itemId = ids[ir.chosen]; this.step = 'mon'; game.audio?.sfx('select'); }
      else if (input.pressed('b')) this.close(game);
    } else {
      if (mr.chosen >= 0) game.send({ type: 'USE_ITEM', itemId: this.itemId, target: mr.chosen });   // stays here for the next one
      else if (input.pressed('b')) { this.step = 'item'; game.audio?.sfx('back'); }
    }
  },
};

export function install(game) { game.register('quick', quickView); }
