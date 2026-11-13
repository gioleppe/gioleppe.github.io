// The Fanny Pack: pause menu with the Wristband Arm (party), Stash Tin (items), Trip Journal (dex),
// wristbands, tuk-tuk fast travel, save and options. Drawn as an unzipped nylon waist bag.
import { W, H } from './CanvasRenderer.js';
import { drawText, wrap, textWidth, panel, list, bar, typeTag, moveName, C, TYPE_COLORS } from './ui.js';
import { statsOf, nameOf, xpForLevel } from '../core/mons.js';
import { canUse } from '../core/OverworldEngine.js';
import { currentGoal, routeHint } from '../core/goals.js';
import { questLog, questMarker } from '../core/quests.js';
import { highOnly } from '../core/intox.js';
import { whereLines } from '../core/where.js';
import { highWorld } from './highWorld.js';
import { moveFacts, typeFacts, TERMS, drawNote, growthWords } from './moveInfo.js';
import { sets as allSets, liveSet, minutesUntil, clockText } from '../core/timetable.js';

const TABS = [
  { id: 'WRISTBAND_ARM', label: 'Astrals' }, { id: 'STASH_TIN', label: 'Stash Tin' }, { id: 'TRIP_JOURNAL', label: 'Journal' }, { id: 'MAP', label: 'Map' }, { id: 'SETS', label: 'Sets' },
  { id: 'QUESTS', label: 'Quests' }, { id: 'BANDS', label: 'Wristbands' }, { id: 'LOG', label: 'Log' }, { id: 'SYSTEM', label: 'System' },
];
const CAT_ORDER = ['BAGGING', 'RECOVERY', 'CATALYST', 'HELD', 'GEAR', 'OUTFIT', 'KEY'];
const SORTS = ['type', 'name', 'count'], SORT_NAME = { type: 'By type', name: 'A to Z', count: 'Most first' };
const CAT_NAME = { BAGGING: 'Bagging tools', RECOVERY: 'Recovery', CATALYST: 'Catalysts', HELD: 'To hold', GEAR: 'Gear', OUTFIT: 'Clothing', KEY: 'Key items' };
// nickname suggestions: typing on a phone is a pain, so pick one (the list depends on the creature)
const NICKS = ['Dave', 'Moonchild', 'Biscuit', 'Disco', 'Noodle', 'Ziggy', 'Pickle', 'Tofu', 'Bongo', 'Wobbles', 'Mango', 'Sparkle', 'Gus', 'Lentil', 'Fizz', 'Bubbles', 'Chai', 'Kevin', 'Pixie', 'Big Steve'];
const nicknamesFor = (m) => Array.from({ length: 5 }, (_, k) => NICKS[(m.uid * 7 + k * 3) % NICKS.length]);
const BAND_COLORS = ['#C9A45A', '#C8F4FF', '#7FD6FF', '#FFD23F', '#4FE88A', '#FF4FA8', '#A8AEB6', '#F4FFF0'];

// ---- region map terrain: each character of the grid is an 8x8 cell with its own small pattern;
// land next to the sea gets a dark coastline and a line of foam
const TERRAIN = { '~': '#2E6FA0', '.': '#74BE63', ':': '#F1D2AE', J: '#2F7A3E', '^': '#C8603A', o: '#5DB2C6', T: '#DCCBA4' };
function drawRegion(g, grid, mx, my, CELL, t) {
  const at = (x, y) => (grid[y] && grid[y][x]) || '~';
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) {
    const c = at(x, y), px = mx + x * CELL, py = my + y * CELL;
    g.fillStyle = TERRAIN[c] || TERRAIN['.']; g.fillRect(px, py, CELL, CELL);
    if (c === '~') { const k = (x * 3 + y * 5 + Math.floor(t * 1.5)) % 4; if (k < 2) { g.fillStyle = '#5DA0C8'; g.fillRect(px + 1 + k * 3, py + 3 + k, 3, 1); } }
    else if (c === 'o') { g.fillStyle = '#8FD0DE'; g.fillRect(px + 2, py + 3, 3, 1); g.fillRect(px + 5, py + 6, 2, 1); }
    else if (c === '.') { if ((x + y) % 2) { g.fillStyle = '#5AA04B'; g.fillRect(px + 2, py + 5, 1, 1); g.fillRect(px + 5, py + 2, 1, 1); } }
    else if (c === ':') { g.fillStyle = '#DDB48A'; g.fillRect(px + 3, py + 4, 1, 1); }
    else if (c === 'J') { g.fillStyle = '#3F8F52'; g.fillRect(px + 1, py + 1, 3, 3); g.fillRect(px + 4, py + 4, 3, 3); g.fillStyle = '#1E5A2E'; g.fillRect(px + 2, py + 4, 1, 1); g.fillRect(px + 5, py + 7, 1, 1); }
    else if (c === '^') { g.fillStyle = '#9A4424'; g.fillRect(px + 1, py + 6, 6, 1); g.fillRect(px + 2, py + 5, 1, 1); g.fillRect(px + 3, py + 4, 1, 1); g.fillRect(px + 4, py + 3, 1, 1); g.fillStyle = '#E6906A'; g.fillRect(px + 5, py + 4, 1, 1); }
    else if (c === 'T') { g.fillStyle = '#C2AF86'; g.fillRect(px, py + 7, CELL, 1); g.fillRect(px + 7, py, 1, CELL); }
    if (c !== '~') {
      g.fillStyle = '#1E3A5A';
      if (at(x, y - 1) === '~') g.fillRect(px, py, CELL, 1);
      if (at(x, y + 1) === '~') g.fillRect(px, py + CELL - 1, CELL, 1);
      if (at(x - 1, y) === '~') g.fillRect(px, py, 1, CELL);
      if (at(x + 1, y) === '~') g.fillRect(px + CELL - 1, py, 1, CELL);
    } else {
      g.fillStyle = '#BFE8F0';
      if (at(x, y - 1) !== '~' && y > 0) g.fillRect(px + 1, py, CELL - 2, 1);
      if (at(x, y + 1) !== '~' && y < grid.length - 1) g.fillRect(px + 1, py + CELL - 1, CELL - 2, 1);
      if (at(x - 1, y) !== '~' && x > 0) g.fillRect(px, py + 1, 1, CELL - 2);
      if (at(x + 1, y) !== '~' && x < grid[y].length - 1) g.fillRect(px + CELL - 1, py + 1, 1, CELL - 2);
    }
  }
  // a frame round the whole map
  g.fillStyle = '#14101E'; const W2 = grid[0].length * CELL, H2 = grid.length * CELL;
  g.fillRect(mx - 1, my - 1, W2 + 2, 1); g.fillRect(mx - 1, my + H2, W2 + 2, 1); g.fillRect(mx - 1, my, 1, H2); g.fillRect(mx + W2, my, 1, H2);
}

export const menuView = {
  tab: 0, focus: 'tabs', cur: {}, sub: null, open: 0, t: 0,

  onEvent(game, e) {
    if (e.type === 'TRANSITION_MODE' && e.to === 'FANNY_PACK_MENU') {
      this.focus = 'tabs'; this.sub = null; this.open = 0; game.audio?.sfx('zip');
      if (game.engine.state.menu?.hut) { this.tab = 0; this.focus = 'content'; this.cur.party = game.engine.state.party.length; }   // Chai Mama's stash
    }
  },
  update(game, dt) { this.t += dt; if (game.engine.state.mode === 'FANNY_PACK_MENU') this.open = Math.min(1, this.open + dt * 5); },

  draw(game, g) {
    const s = game.engine.state;
    if (s.mode !== 'FANNY_PACK_MENU') return;
    const input = game.input, d = game.data;
    // the bag: nylon body, zip teeth along the top that part as it opens
    g.fillStyle = 'rgba(11,3,20,0.55)'; g.fillRect(0, 0, W, H);
    const top = Math.round(6 + (1 - this.open) * 80);
    g.fillStyle = C.ink; g.fillRect(2, top - 2, W - 4, H - top);
    g.fillStyle = '#3A2A6A'; g.fillRect(3, top - 1, W - 6, H - top - 2);
    g.fillStyle = '#4A3A80'; g.fillRect(3, top - 1, W - 6, 3);
    for (let x = 6; x < W - 6; x += 4) { g.fillStyle = (x / 4) % 2 ? '#FFD23F' : '#C9A227'; g.fillRect(x, top - 3, 2, 3); }
    g.fillStyle = '#FFD23F'; g.fillRect(Math.round(8 + this.open * (W - 24)), top - 6, 6, 8);
    if (this.open < 1) return;

    // left: tabs
    const tabs = TABS.filter((t) => t.id !== 'SETS' || s.flags.timetable);   // Sets: once Banyan has brought the timetable
    const TAB_H = tabs.length > 9 ? 13 : 15;
    this.tab = Math.max(0, Math.min(this.tab, tabs.length - 1));
    panel(g, 6, 12, 84, H - 18, { bg: '#F9DCC4', accent: C.magenta });
    const tr = list(game, g, tabs.map((t) => ({ label: t.label })), 9, 16, 78, this.tab, { rowH: TAB_H, passive: this.focus !== 'tabs', hi: '#FF4FA855' });
    if (this.focus === 'tabs') {
      this.tab = tr.cursor;
      const act = tr.chosen >= 0 || input.pressed('right');
      if (act) this.activate(game, tabs[this.tab].id);
      else if (input.pressed('b') || input.pressed('start')) { game.audio?.sfx('zip'); game.send({ type: 'TOGGLE_MENU' }); return; }
    } else {
      // tapping a tab while in content switches tab
      tabs.forEach((t, i) => { if (input.tapIn(9, 16 + i * TAB_H, 78, TAB_H)) { this.tab = i; this.sub = null; this.activate(game, t.id); } });
      g.fillStyle = '#FF4FA855'; g.fillRect(9, 16 + this.tab * TAB_H, 77, TAB_H - 1);
      drawText(g, tabs[this.tab].label, 18, 16 + Math.floor((TAB_H - 8) / 2) + this.tab * TAB_H, { color: C.ink });
    }
    drawText(g, `Rs ${s.rupees}`, 12, H - 30, { color: C.chai });
    const ix = s.intox, band = ix > 0.9 ? 'Ego gone' : ix > 0.6 ? 'Peaking' : ix > 0.25 ? 'Come-up' : 'Microdose';
    bar(g, 12, H - 20, 44, 6, ix, ix > 0.6 ? C.magenta : C.acid); drawText(g, band.slice(0, 5), 59, H - 21, { color: C.chai });

    // right: content
    panel(g, 94, 12, W - 100, H - 18, { bg: '#FFF4E4', accent: C.purple });
    const id = tabs[Math.min(this.tab, tabs.length - 1)].id;
    const X = 100, Y = 18, CW = W - 112;
    const back = () => { if (this.sub) this.sub = null; else this.focus = 'tabs'; game.audio?.sfx('back'); };
    const active = this.focus === 'content';
    if (id === 'WRISTBAND_ARM') this.party(game, g, X, Y, CW, active, back);
    else if (id === 'STASH_TIN') this.stash(game, g, X, Y, CW, active, back);
    else if (id === 'TRIP_JOURNAL') this.journal(game, g, X, Y, CW, active, back);
    else if (id === 'MAP') this.map(game, g, X, Y, CW, active, back);
    else if (id === 'LOG') this.log(game, g, X, Y, CW, active, back);
    else if (id === 'BANDS') this.bands(game, g, X, Y, CW, active, back);
    else if (id === 'QUESTS') this.quests(game, g, X, Y, CW, active, back);
    else if (id === 'SETS') this.sets(game, g, X, Y, CW, active, back);
    else if (id === 'SYSTEM') this.system(game, g, X, Y, CW, active, back);
    else {
      const text = { SAVE: 'Write your progress to this device. The game also saves by itself when you change zone and after battles.', OPTIONS: 'Grounded mode, motion, text speed, volume, save export.', CLOSE: 'Zip it up and get back out there.' }[id];
      wrap(text, CW).forEach((ln, i) => drawText(g, ln, X, Y + i * 11, { color: C.chai }));
      const h = Math.floor(s.clock / 60), m = s.clock % 60;
      drawText(g, `Festival clock ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, X, H - 30, { color: C.grey });
      drawText(g, `${d.zones[s.zoneId].name}`, X, H - 20, { color: C.grey });
    }
    void canUse;
  },

  activate(game, id) {
    if (id === 'CLOSE') return game.send({ type: 'TOGGLE_MENU' });
    this.focus = 'content'; this.sub = null;
    game.audio?.sfx('select');
  },

  // ---- Wristband Arm: the forearm with one woven band per Astral
  party(game, g, X, Y, CW, active, back) {
    const s = game.engine.state, d = game.data, input = game.input, cur = this.cur;
    if (!s.party.length) { drawText(g, 'No Astrals yet. Bare forearm.', X, Y, { color: C.chai }); if (active && (input.pressed('b') || input.pressed('left'))) back(); return; }
    if (this.sub?.kind === 'summary') return this.summary(game, g, this.sub.box !== undefined ? s.box[this.sub.box] : s.party[this.sub.i], X, Y, CW, () => { this.sub = this.sub.box !== undefined ? { kind: 'boxmon', j: this.sub.box } : null; game.audio?.sfx('back'); });
    // the stash: sorted as you like (order caught, name, level), each one can be taken, swapped for a party Astral, or read
    const BOX_SORTS = ['caught', 'name', 'level'];
    const bsort = BOX_SORTS.includes(game.settings.stashSort) ? game.settings.stashSort : 'caught';
    const order = s.box.map((m, j) => j);
    if (bsort === 'name') order.sort((a, b2) => nameOf(d, s.box[a]).localeCompare(nameOf(d, s.box[b2])));
    else if (bsort === 'level') order.sort((a, b2) => s.box[b2].level - s.box[a].level || nameOf(d, s.box[a]).localeCompare(nameOf(d, s.box[b2])));
    if (this.sub?.kind === 'box') {
      const hut = !!s.menu?.hut;
      drawText(g, 'Chai Tent stash', X, Y, { color: C.purple });
      // the sort chip: tap it, or left / right
      const label = `Sort: ${{ caught: 'caught', name: 'name', level: 'level' }[bsort]}`, cw = textWidth(label) + 8, cx = X + CW + 4 - cw;
      const cycle = (k) => { game.settings.stashSort = BOX_SORTS[(BOX_SORTS.indexOf(bsort) + k + BOX_SORTS.length) % BOX_SORTS.length]; game.saveSettings?.(); game.audio?.sfx('blip'); };
      if (active && input.tapIn(cx, Y - 2, cw, 12)) cycle(1);
      else if (active && input.pressed('right')) cycle(1);
      else if (active && input.pressed('left')) cycle(-1);
      g.fillStyle = '#E8D8C0'; g.fillRect(cx, Y - 2, cw, 11); drawText(g, label, cx + 4, Y, { color: C.chai });
      if (!s.box.length) wrap('Nobody here. Astrals you bag while your party is full wait here.', CW).forEach((ln, k) => drawText(g, ln, X, Y + 14 + k * 10, { color: C.chai }));
      const r = list(game, g, order.map((j) => ({ label: nameOf(d, s.box[j]), right: `Lv${s.box[j].level}` })), X - 4, Y + 12, CW + 8, cur.box || 0, { rowH: 14, maxRows: 9 });
      cur.box = r.cursor;
      if (r.chosen >= 0) { this.sub = { kind: 'boxmon', j: order[r.chosen] }; cur.boxAct = 0; }
      else if (input.pressed('b')) back();
      return;
    }
    if (this.sub?.kind === 'boxmon') {        // one Astral from the stash: take it, swap it for someone, or read its summary
      const j = this.sub.j, m = s.box[j], hut = !!s.menu?.hut, full = s.party.length >= (d.rules.partyMax || 6);
      if (!m) { this.sub = { kind: 'box' }; return; }
      drawText(g, `${nameOf(d, m)} Lv${m.level}`, X, Y, { color: C.purple });
      const acts = [{ label: 'Take', disabled: !hut || full }, { label: 'Swap with...', disabled: !hut }, { label: 'Summary' }, { label: 'Back' }];
      const r = list(game, g, acts, X - 4, Y + 14, 120, cur.boxAct || 0, { rowH: 16 });
      cur.boxAct = r.cursor;
      const why = !hut ? 'Chai Mama keeps the stash: swap at a Chai Tent.' : full && cur.boxAct === 0 ? 'Your party is full: swap instead.' : '';
      if (why) wrap(why, CW).forEach((ln, k) => drawText(g, ln, X, Y + 84 + k * 10, { color: C.chai }));
      if (r.chosen === 0) { game.send({ type: 'STASH_SWAP', boxIndex: j }); this.sub = s.box.length ? { kind: 'box' } : null; }
      else if (r.chosen === 1) { this.sub = { kind: 'swapwith', j }; cur.swap = 0; }
      else if (r.chosen === 2) this.sub = { kind: 'summary', box: j };
      else if (r.chosen === 3 || input.pressed('b')) { this.sub = { kind: 'box' }; game.audio?.sfx('back'); }
      return;
    }
    if (this.sub?.kind === 'swapwith') {      // who goes to the stash in its place
      const j = this.sub.j, m = s.box[j];
      drawText(g, `${nameOf(d, m)} joins. Who goes to the stash?`, X, Y, { color: C.purple });
      const r = list(game, g, s.party.map((p) => ({ label: nameOf(d, p), right: `Lv${p.level}` })).concat([{ label: 'Back' }]), X - 4, Y + 14, CW + 8, cur.swap || 0, { rowH: 16 });
      cur.swap = r.cursor;
      if (r.chosen >= 0 && r.chosen < s.party.length) { game.send({ type: 'STASH_SWAP', boxIndex: j, partyIndex: r.chosen }); this.sub = { kind: 'box' }; }
      else if (r.chosen >= 0 || input.pressed('b')) { this.sub = { kind: 'boxmon', j }; game.audio?.sfx('back'); }
      return;
    }
    if (this.sub?.kind === 'actions') {
      const i = this.sub.i, m = s.party[i];
      drawText(g, nameOf(d, m), X, Y, { color: C.purple });
      const acts = [{ label: 'Summary' }, { label: 'Move', disabled: s.party.length < 2 }, { label: 'Send to stash', disabled: s.party.length < 2 || !s.menu?.hut }, { label: 'Hold item' }, { label: 'Nickname' }, { label: 'Back' }];
      const r = list(game, g, acts, X - 4, Y + 14, 110, cur.act || 0, { rowH: 16 });
      cur.act = r.cursor;
      if (r.chosen === 0) this.sub = { kind: 'summary', i };
      else if (r.chosen === 1) { this.sub = { kind: 'move', from: i }; cur.party = i; }
      else if (r.chosen === 2) { game.send({ type: 'STASH_SWAP', partyIndex: i }); this.sub = null; }
      else if (r.chosen === 3) { this.sub = { kind: 'hold', i }; cur.hold = 0; }
      else if (r.chosen === 4) { this.sub = { kind: 'nick', i }; cur.nick = 0; }
      else if (r.chosen === 5 || input.pressed('b')) back();
      return;
    }
    if (this.sub?.kind === 'hold') {           // give a held item, or take one back
      const i = this.sub.i, m = s.party[i];
      drawText(g, `${nameOf(d, m)} holds: ${m.held ? d.items[m.held].name : 'nothing'}`, X, Y, { color: C.purple });
      const ids = Object.keys(s.bag).filter((id) => s.bag[id] > 0 && d.items[id].category === 'HELD');
      const rows = ids.map((id) => ({ label: d.items[id].name, right: `x${s.bag[id]}` })).concat(m.held ? [{ label: 'Take it back' }] : [], [{ label: 'Back' }]);
      const r = list(game, g, rows, X - 4, Y + 14, CW + 8, cur.hold || 0, { rowH: 16, maxRows: 6 });
      cur.hold = r.cursor;
      const it = ids[cur.hold] && d.items[ids[cur.hold]];
      if (it) wrap(it.desc, CW).slice(0, 2).forEach((ln, k) => drawText(g, ln, X, Y + 118 + k * 10, { color: C.chai }));
      else if (!ids.length) wrap('Nothing to hold. The flea market sells some.', CW).forEach((ln, k) => drawText(g, ln, X, Y + 118 + k * 10, { color: C.chai }));
      if (r.chosen >= 0 && r.chosen < ids.length) { game.send({ type: 'HOLD_ITEM', partyIndex: i, itemId: ids[r.chosen] }); this.sub = { kind: 'actions', i }; }
      else if (r.chosen >= 0 && m.held && r.chosen === ids.length) { game.send({ type: 'HOLD_ITEM', partyIndex: i, itemId: null }); this.sub = { kind: 'actions', i }; }
      else if (r.chosen >= 0 || input.pressed('b')) this.sub = { kind: 'actions', i };
      return;
    }
    if (this.sub?.kind === 'nick') {           // choose a nickname from a few suggestions
      const i = this.sub.i, m = s.party[i], own = d.dex[m.speciesId].name;
      drawText(g, `What should ${nameOf(d, m)} be called?`, X, Y, { color: C.purple });
      const names = [own, ...nicknamesFor(m)];
      const rows = names.map((n, k) => ({ label: k === 0 ? `${n} (own name)` : n })).concat([{ label: 'Type a name...' }, { label: 'Back' }]);
      const r = list(game, g, rows, X - 4, Y + 14, CW + 8, cur.nick || 0, { rowH: 16 });
      cur.nick = r.cursor;
      if (r.chosen >= 0 && r.chosen < names.length) { game.send({ type: 'NICKNAME', partyIndex: i, name: names[r.chosen] }); this.sub = { kind: 'actions', i }; }
      else if (r.chosen === names.length) { this.sub = { kind: 'type', i, text: m.nickname || '', upper: true }; cur.key = 0; }
      else if (r.chosen >= 0 || input.pressed('b')) this.sub = { kind: 'actions', i };
      return;
    }
    if (this.sub?.kind === 'type') {           // a letter grid for typing a name: works with taps, the pad and keys
      const S = this.sub, m = s.party[S.i];
      const letters = (S.upper ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : 'abcdefghijklmnopqrstuvwxyz').split('').concat([' ', '-', '!', '?']);
      const keys = letters.map((c) => ({ label: c === ' ' ? '_' : c })).concat([{ label: S.upper ? 'abc' : 'ABC' }, { label: 'Del' }, { label: 'OK' }]);
      drawText(g, `Name for ${d.dex[m.speciesId].name}:`, X, Y, { color: C.purple });
      panel(g, X - 4, Y + 11, CW + 8, 14, { bg: C.white, accent: C.purple });
      drawText(g, S.text + (Math.floor(this.t * 2) % 2 ? '_' : ''), X + 2, Y + 14, { color: C.ink });
      const r = list(game, g, keys, X - 4, Y + 30, CW + 8, cur.key || 0, { cols: 6, rowH: 16, oneTap: true });
      cur.key = r.cursor;
      const pick = r.chosen >= 0 ? keys[r.chosen].label : null;
      if (pick === 'OK') { game.send({ type: 'NICKNAME', partyIndex: S.i, name: S.text }); this.sub = { kind: 'actions', i: S.i }; }
      else if (pick === 'Del') S.text = S.text.slice(0, -1);
      else if (pick === 'abc' || pick === 'ABC') S.upper = !S.upper;
      else if (pick && S.text.length < 12) S.text += pick === '_' ? ' ' : pick;
      else if (input.pressed('b')) { if (S.text) S.text = S.text.slice(0, -1); else this.sub = { kind: 'nick', i: S.i }; }
      return;
    }
    // one row per Astral: mini sprite, name, types, serotonin and hydration; a woven band marks each row
    const RH = 21, moving = this.sub?.kind === 'move' ? this.sub : null;
    const rows = s.party.length + (!moving && (s.box.length || s.menu?.hut) ? 1 : 0);
    let chosen = -1;
    const c = Math.max(0, Math.min(rows - 1, cur.party || 0));
    for (let i = 0; i < rows; i++) {
      const y = Y - 2 + i * RH;
      const box = i >= s.party.length;
      if (active && input.tapIn(X - 4, y, CW + 8, RH)) { cur.party = i; chosen = i; }
      if (active && i === c) { g.fillStyle = '#F4A26166'; g.fillRect(X - 4, y, CW + 8, RH - 1); }
      if (moving && i === moving.from) { g.fillStyle = C.magenta; g.fillRect(X - 4, y, CW + 8, 1); g.fillRect(X - 4, y + RH - 2, CW + 8, 1); g.fillRect(X - 4, y, 1, RH - 1); g.fillRect(X + CW + 3, y, 1, RH - 1); }
      if (box) { drawText(g, `Chai Tent stash (${s.box.length})`, X + 22, y + 6, { color: C.purple }); continue; }
      const m = s.party[i], st = statsOf(d, m), sp = d.dex[m.speciesId];
      // woven wristband behind the sprite, in the creature's type colours
      g.fillStyle = TYPE_COLORS[sp.types[0]]; g.fillRect(X - 4, y + 15, 22, 4);
      g.fillStyle = TYPE_COLORS[sp.types[1] || sp.types[0]]; for (let k = 0; k < 22; k += 4) g.fillRect(X - 4 + k, y + 15, 2, 4);
      const img = game.images[`mon:${m.speciesId}`];
      if (img) { if (m.hp <= 0) g.globalAlpha = 0.4; g.drawImage(img, 0, 64, 24, 24, X - 5, y - 2, 24, 24); g.globalAlpha = 1; }   // the 24 px miniature (frame 10), drawn for this size
      drawText(g, nameOf(d, m), X + 22, y + 1, { color: C.ink });
      drawText(g, `Lv${m.level}`, X + CW, y + 1, { color: C.ink, align: 'right' });
      let tx = X + 22; for (const t of sp.types) tx += typeTag(g, t, tx, y + 10);
      const r = m.hp / st.maxHp;
      bar(g, X + 100, y + 12, 50, 6, r, r > 0.5 ? '#FF4FA8' : r > 0.2 ? '#FF9A2A' : '#E0303C');
      bar(g, X + 153, y + 12, 26, 6, m.hyd / st.maxHyd, '#3FB8D8');
      if (m.hp <= 0) drawText(g, 'OUT', X + CW, y + 11, { color: C.red, align: 'right' });
      else if (m.status) drawText(g, m.status.id.slice(0, 4), X + CW, y + 11, { color: C.purple, align: 'right' });
    }
    if (moving) drawText(g, "Move where?  A: swap here  B: cancel", X, Y + s.party.length * RH + 2, { color: C.purple });
    if (!active) return;
    cur.party = c;
    if (input.pressed('down')) cur.party = Math.min(rows - 1, c + 1);
    if (input.pressed('up')) cur.party = Math.max(0, c - 1);
    if (input.pressed('a')) chosen = cur.party;
    if (moving) {
      if (chosen >= 0) { if (chosen !== moving.from) game.send({ type: 'SWAP_PARTY', a: moving.from, b: chosen }); game.audio?.sfx('select'); this.sub = null; cur.party = chosen; }
      else if (input.pressed('b') || input.pressed('left')) { this.sub = { kind: 'actions', i: moving.from }; }
      return;
    }
    if (chosen >= 0) { game.audio?.sfx('select'); this.sub = chosen >= s.party.length ? { kind: 'box' } : { kind: 'actions', i: chosen }; cur.act = 0; }
    else if (input.pressed('b') || input.pressed('left')) back();
  },

  /** An Astral's summary. Everything on it can be pointed at (d-pad, or a tap) and A tells you what it is: each move's
   *  numbers and effects, the stats, the types, the ability, the held item. B closes the note, then the summary. */
  summary(game, g, m, X, Y, CW, back) {
    const d = game.data, input = game.input, S = this.sub?.kind === 'summary' ? this.sub : (this.loose ||= {});   // (tests draw it bare)
    if (!m) return back();
    const sp = d.dex[m.speciesId], st = statsOf(d, m);
    const ab = d.rules.abilities?.[sp.ability || sp.trait];
    // what can be pointed at: [x, y, w, h, note]
    const ents = [];
    let tx = X; const tags = sp.types.map((t) => { const x = tx; tx += textWidth(t.slice(0, 5)) + 8; return [x, t]; });
    for (const [x, t] of tags) ents.push([x - 1, Y + 10, textWidth(t.slice(0, 5)) + 8, 12, () => typeFacts(d, t)]);
    ents.push([X - 2, Y + 24, 112, 10, () => ({ ...TERMS.serotonin, text: TERMS.serotonin.text + growthWords(d, m.speciesId, 'serotonin') })], [X - 2, Y + 34, 112, 10, () => TERMS.hydration], [X - 2, Y + 44, 140, 10, () => TERMS.vibes]);
    const rows = [['Vibe Atk', 'vibeAttack'], ['Ego Def', 'egoDefense'], ['Fractal', 'spFractal'], ['Grounded', 'spGrounded'], ['BPM', 'bpmSpeed']];
    rows.forEach(([, k], i) => ents.push([X + (i % 2) * 104 - 2, Y + 59 + Math.floor(i / 2) * 10, 80, 10, () => ({ ...TERMS[k], text: TERMS[k].text + growthWords(d, m.speciesId, k) })]));
    const firstMove = ents.length;
    const MY = Y + 93, AY = Y + 117;                 // the moves, then the ability (the held item last, inside the panel)
    m.moves.forEach((id, i) => ents.push([X + (i % 2) * 104 - 7, MY - 1 + Math.floor(i / 2) * 11, 102, 11, () => moveFacts(d, d.moves[id], m)]));
    let holdY = AY, abLines = null;
    if (ab) {
      const nw = textWidth(ab.name) + 6, first = wrap(ab.desc, CW - nw), rest = first.length > 1 ? wrap(first.slice(1).join(' '), CW) : [];
      abLines = { nw, first, rest };
      holdY = AY + 10 + rest.length * 9;
      ents.push([X - 2, AY - 1, CW + 2, 10 + rest.length * 9, () => ({ title: ab.name, text: `${ab.desc} An ability works by itself; every ${sp.name} has this one.` })]);
    }
    ents.push([X - 2, holdY - 1, 160, 10, () => (m.held ? { title: d.items[m.held].name, text: `${d.items[m.held].desc} ${TERMS.held.text}` } : TERMS.held)]);
    if (S.at == null || S.at >= ents.length) S.at = m.moves.length ? firstMove : 0;

    // a note is open: read it, B (or a tap, or A) puts it away
    if (S.note) {
      const n = S.note, nx = X - 4, ny = Y - 4, nw = CW + 8;
      panel(g, nx, ny, nw, H - 8 - ny, { accent: C.purple });     // the whole page: the longest note (11 lines) fits
      drawNote(g, n, nx + 6, ny + 5, nw - 12);
      if (input.pressed('b') || input.pressed('a') || input.anyTap()) { S.note = null; game.audio?.sfx('back'); }
      return;
    }

    // move the pointer to the nearest thing that way
    const centre = (e) => [e[0] + e[2] / 2, e[1] + e[3] / 2];
    const go = (dx, dy) => {
      const [ax, ay] = centre(ents[S.at]); let best = -1, score = Infinity;
      ents.forEach((e, j) => {
        if (j === S.at) return;
        const [ex, ey] = centre(e), ahead = (ex - ax) * dx + (ey - ay) * dy, aside = Math.abs(dx ? ey - ay : ex - ax);
        if (ahead > 2 && ahead + aside * 3 < score) { score = ahead + aside * 3; best = j; }
      });
      if (best >= 0) { S.at = best; game.audio?.sfx('blip'); }
    };
    if (input.pressed('up')) go(0, -1); else if (input.pressed('down')) go(0, 1);
    else if (input.pressed('left')) go(-1, 0); else if (input.pressed('right')) go(1, 0);
    let open = input.pressed('a') ? S.at : -1;
    if (input.taps?.length) {
      const t = input.taps.splice(0, 1)[0];
      const j = ents.findIndex((e) => t.x >= e[0] - 2 && t.x < e[0] + e[2] + 2 && t.y >= e[1] - 1 && t.y < e[1] + e[3] + 1);
      if (j >= 0) { S.at = j; open = j; } else return back();     // a tap on nothing: done here
    }

    // the pointer, under the text
    const at = ents[S.at];
    g.fillStyle = '#F4A26188'; g.fillRect(at[0], at[1], at[2], at[3]);

    const img = game.images[`mon:${m.speciesId}`];
    if (img) g.drawImage(img, (Math.floor(this.t * 2) % 2) * 64, 0, 64, 64, X + CW - 62, Y - 4, 64, 64);
    drawText(g, `${nameOf(d, m)}  Lv${m.level}`, X, Y, { color: C.ink });
    for (const [x, t] of tags) typeTag(g, t, x, Y + 11);
    drawText(g, `Serotonin ${m.hp}/${st.maxHp}`, X, Y + 25, { color: C.chai });
    drawText(g, `Hydration ${m.hyd}/${st.maxHyd}`, X, Y + 35, { color: C.chai });
    const need = xpForLevel(m.level + 1) - m.xp;
    drawText(g, `Next peak in ${Math.max(0, need)} Vibes`, X, Y + 45, { color: C.grey });
    rows.forEach(([n, k], i) => { drawText(g, n, X + (i % 2) * 104, Y + 60 + Math.floor(i / 2) * 10, { color: C.ink }); drawText(g, String(st[k]), X + (i % 2) * 104 + 74, Y + 60 + Math.floor(i / 2) * 10, { color: C.purple, align: 'right' }); });
    m.moves.forEach((id, i) => {
      const mv = d.moves[id], mx = X + (i % 2) * 104, my = MY + Math.floor(i / 2) * 11;
      drawText(g, moveName(mv, 94), mx, my, { color: C.ink });
      g.fillStyle = TYPE_COLORS[mv.type]; g.fillRect(mx - 5, my + 2, 3, 3);
    });
    drawText(g, 'A: what is this?', X + CW, Y + 80, { color: C.grey, align: 'right' });
    if (abLines) {
      drawText(g, ab.name, X, AY, { color: C.purple });
      drawText(g, abLines.first[0], X + abLines.nw, AY, { color: C.chai });
      abLines.rest.forEach((ln, k) => drawText(g, ln, X, AY + 9 + k * 9, { color: C.chai }));
    }
    drawText(g, `Holding: ${m.held ? d.items[m.held].name : 'nothing'}`, X, holdY, { color: C.grey });

    if (open >= 0) { S.note = ents[open][4](); game.audio?.sfx('select'); }
    else if (input.pressed('b')) back();
  },

  // ---- Stash Tin: a mint tin with compartments
  stash(game, g, X, Y, CW, active, back) {
    const s = game.engine.state, d = game.data, input = game.input, cur = this.cur;
    const sort = SORTS.includes(game.settings.bagSort) ? game.settings.bagSort : 'type';
    const byType = (a, b) => CAT_ORDER.indexOf(d.items[a].category) - CAT_ORDER.indexOf(d.items[b].category);
    const ids = Object.keys(s.bag).filter((id) => s.bag[id] > 0).sort(sort === 'name' ? (a, b) => d.items[a].name.localeCompare(d.items[b].name)
      : sort === 'count' ? (a, b) => (s.bag[b] - s.bag[a]) || byType(a, b) : byType);
    if (!ids.length) { drawText(g, 'The tin rattles. It is empty.', X, Y, { color: C.chai }); if (active && (input.pressed('b') || input.pressed('left'))) back(); return; }
    if (this.sub?.kind === 'holder') {         // a held item chosen from the tin: who should hold it?
      const item = d.items[this.sub.item];
      drawText(g, `Who holds the ${item.name}?`, X, Y, { color: C.purple });
      const r = list(game, g, s.party.map((m) => ({ label: `${nameOf(d, m)} Lv${m.level}`, right: m.held ? d.items[m.held].name.split(' ')[0] : '' })), X - 4, Y + 14, CW + 8, cur.target || 0, { rowH: 15 });
      cur.target = r.cursor;
      if (r.chosen >= 0) { game.send({ type: 'HOLD_ITEM', partyIndex: r.chosen, itemId: item.id }); this.sub = null; }
      else if (input.pressed('b')) back();
      return;
    }
    if (this.sub?.kind === 'target') {
      const item = d.items[this.sub.item];
      drawText(g, `Use ${item.name} on...`, X, Y, { color: C.purple });
      const r = list(game, g, s.party.map((m) => { const st = statsOf(d, m); return { label: `${nameOf(d, m)} Lv${m.level}`, right: `${m.hp}/${st.maxHp}` }; }), X - 4, Y + 14, CW + 8, cur.target || 0, { rowH: 15 });
      cur.target = r.cursor;
      if (r.chosen >= 0) { game.send({ type: 'USE_ITEM', itemId: item.id, target: r.chosen }); if (!(s.bag[item.id] > 0)) this.sub = null; }
      else if (input.pressed('b')) back();
      return;
    }
    // the tin: brushed metal rim with a hinge
    g.fillStyle = '#A8AEB6'; g.fillRect(X - 5, Y - 5, CW + 10, 100); g.fillStyle = '#D8DEE6'; g.fillRect(X - 4, Y - 4, CW + 8, 98); g.fillStyle = '#F4F8FA'; g.fillRect(X - 3, Y - 3, CW + 6, 96);
    g.fillStyle = '#A8AEB6'; g.fillRect(X + 20, Y - 6, 10, 2); g.fillRect(X + CW - 30, Y - 6, 10, 2);
    // the first row sorts the tin: by type, A to Z, or most first (remembered on this device)
    const items = [{ label: `Sort: ${SORT_NAME[sort]}`, color: C.purple }].concat(ids.map((id) => ({ label: d.items[id].name, right: d.items[id].category === 'KEY' ? '' : d.items[id].category === 'OUTFIT' && s.outfit === d.items[id].effect.outfit ? 'worn' : `x${s.bag[id]}` })));
    const r = list(game, g, items, X - 4, Y, CW + 8, cur.item || 0, { rowH: 13, maxRows: 7, passive: !active });
    cur.item = r.cursor;
    const it = cur.item > 0 ? d.items[ids[Math.min(cur.item - 1, ids.length - 1)]] : null;
    g.fillStyle = '#E8D8C0'; g.fillRect(X - 2, Y + 96, CW + 4, 1);
    if (it) {
      drawText(g, CAT_NAME[it.category], X, Y + 100, { color: C.purple });
      wrap(it.desc, CW).slice(0, 3).forEach((ln, i) => drawText(g, ln, X, Y + 111 + i * 10, { color: C.chai }));
    } else wrap(`A: sort the tin ${SORT_NAME[SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length]].toLowerCase()} instead.`, CW).forEach((ln, i) => drawText(g, ln, X, Y + 100 + i * 10, { color: C.chai }));
    if (!active) return;
    if (r.chosen === 0) { game.settings.bagSort = SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length]; game.saveSettings?.(); game.audio?.sfx('select'); }
    else if (r.chosen > 0) {
      const item = d.items[ids[r.chosen - 1]];
      if (item.category === 'RECOVERY' || item.category === 'CATALYST') { if (s.party.length) { this.sub = { kind: 'target', item: item.id }; cur.target = 0; } else game.say('Nobody to use it on.'); }
      else if (item.category === 'HELD') { if (s.party.length) { this.sub = { kind: 'holder', item: item.id }; cur.target = 0; } else game.say('Nobody to give it to.'); }
      else game.send({ type: 'USE_ITEM', itemId: item.id });
    } else if (input.pressed('b') || input.pressed('left')) back();
  },

  // ---- Trip Journal: a duct-taped notebook
  journal(game, g, X, Y, CW, active, back) {
    const s = game.engine.state, d = game.data, input = game.input, cur = this.cur;
    g.fillStyle = '#F4EAD0'; g.fillRect(X - 4, Y - 4, CW + 8, H - 26);
    if (this.sub?.kind === 'page') return this.journalPage(game, g, d.dexList[this.sub.i], X, Y, CW, active);
    g.fillStyle = '#A8AEB6'; g.fillRect(X + 40, Y - 5, 26, 6);                       // duct tape
    for (let y = Y + 9; y < H - 14; y += 11) { g.fillStyle = '#D8CCE8'; g.fillRect(X - 2, y, CW + 4, 1); }
    g.strokeStyle = '#C9A878'; g.lineWidth = 1; g.beginPath(); g.arc(X + CW - 16, Y + 108, 11, 0, 7); g.stroke();   // coffee ring
    const seen = Object.keys(s.dex.seen).length, caught = Object.keys(s.dex.caught).length;
    const items = d.dexList.map((sp) => ({ label: `${String(sp.dexNumber).padStart(2, '0')} ${s.dex.seen[sp.id] ? sp.name : '?????'}`, color: s.dex.caught[sp.id] ? '#1E3A8A' : s.dex.seen[sp.id] ? C.ink : C.grey }));
    const r = list(game, g, items, X - 4, Y, 110, cur.dex || 0, { rowH: 11, maxRows: 11, passive: !active, color: C.ink, hi: '#FFE06699' });   // wide enough that the scroll arrows clear the longest name
    cur.dex = r.cursor;
    const sp = d.dexList[cur.dex];
    const px = X + 108, NW = CW - 108;
    drawText(g, `seen ${seen}  bagged ${caught}`, X + CW, Y + 122, { color: '#B02A2A', align: 'right' });
    if (sp && s.dex.seen[sp.id]) {
      const img = game.images[`mon:${sp.id}`];
      // a ballpoint sketch until you have bagged one, then the real thing
      if (img) g.drawImage(img, (s.dex.caught[sp.id] ? 0 : 4) * 64, 0, 64, 64, px + 18, Y - 6, 64, 64);
      let tx = px; for (const t of sp.types) tx += typeTag(g, t, tx, Y + 56);
      if (highOnly(d)[sp.id]) drawEye(g, tx + 2, Y + 57);                // only seen when high
      if (s.dex.caught[sp.id]) {                                          // the start of the notes; A turns to the full page
        const notes = wrap(sp.journalNotes, NW);
        notes.slice(0, 4).forEach((ln, i) => drawText(g, ln, px, Y + 69 + i * 10, { color: '#1E3A8A' }));
      }
      else wrap('(bag one to take notes)', NW).forEach((ln, i) => drawText(g, ln, px, Y + 69 + i * 10, { color: C.grey }));
      drawText(g, 'A: where to find it', px, Y + 109, { color: '#B02A2A' });
    } else {
      drawText(g, 'not seen yet', px + 10, Y + 30, { color: C.grey });
      // an Astral that only comes out when you are high: where it hides, once you have been there
      const at = sp && (highOnly(d)[sp.id] || []).find((a) => s.visited[a.zone]);
      if (at) { drawEye(g, px + 10, Y + 47); wrap(`Something else lives at ${d.zones[at.zone].name}. Get higher to see it.`, NW).slice(0, 5).forEach((ln, i) => drawText(g, ln, px, Y + 58 + i * 10, { color: '#7A4FE0' })); }
    }
    if (active && r.chosen >= 0 && sp && s.dex.seen[sp.id]) { this.sub = { kind: 'page', i: cur.dex, view: 'where', off: 0 }; game.audio?.sfx('select'); }
    else if (active && (input.pressed('b') || input.pressed('left') || r.chosen >= 0)) back();
  },

  /** a seen Astral's page: the sketch and its types, then Where (every place it lives, and its line) or Notes (every
   *  word, once bagged). Left and right turn between them, up and down scroll a long list, A or B closes it. */
  journalPage(game, g, sp, X, Y, CW, active) {
    const d = game.data, s = game.engine.state, input = game.input, img = game.images[`mon:${sp.id}`], S = this.sub;
    for (let y = Y + 9; y < H - 14; y += 11) { g.fillStyle = '#D8CCE8'; g.fillRect(X - 2, y, CW + 4, 1); }
    if (img) g.drawImage(img, (s.dex.caught[sp.id] ? 0 : 4) * 64, 0, 64, 64, X - 4, Y - 8, 64, 64);
    drawText(g, `${String(sp.dexNumber).padStart(2, '0')} ${sp.name}`, X + 64, Y + 4, { color: '#1E3A8A' });
    let tx = X + 64; for (const ty of sp.types) tx += typeTag(g, ty, tx, Y + 16);
    if (highOnly(d)[sp.id]) drawEye(g, tx + 2, Y + 17);
    // the two pages, as tabs: tap one, or left / right
    const views = ['where', 'notes'], label = { where: 'Where', notes: 'Notes' };
    views.forEach((v, i) => {
      const x = X + 64 + i * 52, on = (S.view || 'where') === v;
      if (active && input.tapIn(x, Y + 32, 48, 13)) { S.view = v; S.off = 0; }
      g.fillStyle = on ? '#1E3A8A' : '#E8DCC0'; g.fillRect(x, Y + 32, 48, 13);
      drawText(g, label[v], x + 24, Y + 35, { color: on ? C.white : '#1E3A8A', align: 'center' });
    });
    if (active && (input.pressed('right') || input.pressed('left'))) { S.view = S.view === 'notes' ? 'where' : 'notes'; S.off = 0; game.audio?.sfx('blip'); }
    const lines = (S.view === 'notes'
      ? (s.dex.caught[sp.id] ? [sp.journalNotes] : ['(bag one to take notes)'])
      : whereLines(d, s, sp.id)).flatMap((l) => wrap(l, CW - 8));   // a little room on the right for the scroll arrows
    const rows = Math.floor((H - 22 - (Y + 58)) / 9) + 1, max = Math.max(0, lines.length - rows);   // down to the page's bottom edge
    S.off = Math.max(0, Math.min(max, S.off || 0));
    if (active && input.pressed('down')) S.off = Math.min(max, S.off + 1);
    if (active && input.pressed('up')) S.off = Math.max(0, S.off - 1);
    lines.slice(S.off, S.off + rows).forEach((ln, i) => drawText(g, ln, X, Y + 58 + i * 9, { color: S.view === 'notes' && !s.dex.caught[sp.id] ? C.grey : '#1E3A8A' }));
    if (S.off > 0) drawText(g, '^', X + CW - 6, Y + 50, { color: C.magenta });
    if (S.off < max) drawText(g, 'v', X + CW - 6, H - 22, { color: C.magenta });
    if (active && (input.pressed('a') || input.pressed('b') || input.anyTap())) { this.sub = null; game.audio?.sfx('back'); }
  },

  // ---- Log: what people said and what happened, newest at the bottom; up and down scroll back
  log(game, g, X, Y, CW, active, back) {
    const input = game.input, cur = this.cur;
    const lines = game.log.flatMap((l) => wrap(l, CW));
    if (!lines.length) drawText(g, 'Nothing has happened yet. Give it time.', X, Y, { color: C.chai });
    const vis = Math.floor((H - 22 - Y) / 10), maxOff = Math.max(0, lines.length - vis);
    cur.log = Math.max(0, Math.min(maxOff, cur.log || 0));
    if (active) { if (input.pressed('up')) cur.log = Math.min(maxOff, cur.log + 1); if (input.pressed('down')) cur.log = Math.max(0, cur.log - 1); }
    lines.slice(Math.max(0, lines.length - vis - cur.log), lines.length - cur.log).forEach((ln, i) => drawText(g, ln, X, Y + i * 10, { color: C.ink }));
    if (cur.log < maxOff) drawText(g, '^', X + CW - 4, Y - 6, { color: C.magenta });
    if (active && (input.pressed('b') || input.pressed('left'))) back();
  },

  // ---- System: Save, Options, and Unstuck (back to where you came into this area, after a question)
  system(game, g, X, Y, CW, active, back) {
    const s = game.engine.state, d = game.data, input = game.input, cur = this.cur;
    if (this.sub?.kind === 'unstuck') {
      wrap('Stuck? Go back to the spot where you came into this area.', CW).forEach((ln, i) => drawText(g, ln, X, Y + i * 10, { color: C.purple }));
      drawText(g, d.zones[s.zoneId].name, X, H - 20, { color: C.grey });
      const r = list(game, g, [{ label: 'No, stay here' }, { label: 'Yes, take me back' }], X - 4, Y + 30, CW + 8, cur.unstuck || 0, { rowH: 16, passive: !active });
      cur.unstuck = r.cursor;
      if (r.chosen === 1) { this.sub = null; this.focus = 'tabs'; cur.unstuck = 0; game.audio?.sfx('zip'); game.send({ type: 'UNSTUCK' }); }
      else if (r.chosen === 0 || (active && input.pressed('b'))) { this.sub = null; cur.unstuck = 0; game.audio?.sfx('back'); }
      return;
    }
    const rows = [
      { label: 'Save', about: 'Write your progress to this device. The game also saves by itself when you change area and after battles.' },
      { label: 'Options', about: 'Grounded mode, motion, text speed, volume, keys, save export.' },
      { label: 'Unstuck', about: 'Walled in, or lost? Go back to where you came into this area. Nothing else changes.' },
    ];
    const r = list(game, g, rows, X - 4, Y - 2, CW + 8, cur.system || 0, { rowH: 16, passive: !active });
    cur.system = r.cursor;
    wrap(rows[cur.system].about, CW).forEach((ln, i) => drawText(g, ln, X, Y + 54 + i * 10, { color: C.chai }));
    const h = Math.floor(s.clock / 60), m = s.clock % 60;
    drawText(g, `Festival clock ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, X, H - 30, { color: C.grey });
    drawText(g, `${d.zones[s.zoneId].name}`, X, H - 20, { color: C.grey });
    if (!active) return;
    if (r.chosen === 0) game.save(true);
    else if (r.chosen === 1) { game.screen = 'settings'; game.extra.settings.open(game, 'play'); }
    else if (r.chosen === 2) { this.sub = { kind: 'unstuck' }; cur.unstuck = 0; game.audio?.sfx('select'); }
    else if (input.pressed('b') || input.pressed('left')) back();
  },

  // ---- Quests: active ones with their next step, finished ones greyed out below
  quests(game, g, X, Y, CW, active, back) {
    const s = game.engine.state, input = game.input, cur = this.cur;
    const log = questLog(game.data, s).filter((q) => q.state !== 'hidden');
    const lines = [];
    for (const q of log.filter((x) => x.state === 'active')) {
      lines.push({ t: q.name, color: C.purple });
      for (const ln of wrap(q.next.text, CW - 8)) lines.push({ t: ln, color: C.ink, x: 8 });
    }
    const done = log.filter((x) => x.state === 'done');
    if (done.length) { lines.push({ t: '' }); for (const q of done) lines.push({ t: `${q.name} - done`, color: C.grey }); }
    if (!log.length) wrap('No side quests yet. People around the festival will ask you for things.', CW).forEach((ln) => lines.push({ t: ln, color: C.chai }));
    const vis = Math.floor((H - 24 - Y) / 10), maxOff = Math.max(0, lines.length - vis);
    cur.quests = Math.max(0, Math.min(maxOff, cur.quests || 0));
    if (active) { if (input.pressed('down')) cur.quests = Math.min(maxOff, cur.quests + 1); if (input.pressed('up')) cur.quests = Math.max(0, cur.quests - 1); }
    lines.slice(cur.quests, cur.quests + vis).forEach((l, i) => { if (l.t) drawText(g, l.t, X + (l.x || 0), Y + i * 10, { color: l.color }); });
    if (cur.quests < maxOff) drawText(g, 'v', X + CW - 4, Y + vis * 10, { color: C.magenta });
    if (active && (input.pressed('b') || input.pressed('left'))) back();
  },

  // ---- Map: a region map in the handheld style. Terrain from a grid of 8x8 cells, routes between places,
  // red squares for hubs and small squares for everywhere else, names hidden until you have been there.
  // The d-pad (or a tap) moves a cursor between places; with the VIP Press Pass, A on a Chai Tent calls a tuk-tuk.
  map(game, g, X, Y, CW, active, back) {
    const s = game.engine.state, d = game.data, input = game.input, wm = d.manifest.worldmap || {}, grid = wm.grid || [], places = wm.places || {};
    const goal = currentGoal(d, s), hint = routeHint(d, s, goal);
    let ty = Y;
    for (const ln of wrap(goal ? goal.text : 'Nothing urgent. Enjoy the festival.', CW).slice(0, 2)) { drawText(g, ln, X, ty, { color: C.purple }); ty += 10; }
    const mx = X - 2, my = Y + 31, CELL = 8;
    const at = d.zones[s.zoneId].interior ? d.zones[s.zoneId].parent : s.zoneId;
    const lineY = Y + 20;
    if (hint && (!this.mapCur || this.mapCur === at)) drawText(g, wrap(hint.text, CW)[0], X, lineY, { color: C.chai });
    drawRegion(g, grid, mx, my, CELL, game.settings.reducedMotion ? 0 : this.t);
    const zones = Object.keys(places).filter((z) => d.zones[z]);
    const known = (z) => !!s.visited[z];
    const P = (z) => ({ x: mx + places[z][0] * CELL + 4, y: my + places[z][1] * CELL + 4 });
    // routes: right-angled paths between connected places, bright once you have walked either end
    const drawn = new Set();
    for (const z of zones) for (const w of d.zones[z].warps || []) {
      const to = d.zones[w.to]?.interior ? null : w.to;
      if (!to || !places[to] || drawn.has(`${to}|${z}`)) continue;
      drawn.add(`${z}|${to}`);
      const a1 = P(z), b1 = P(to), lit = known(z) || known(to);
      const segs = [[a1.x, a1.y, b1.x, a1.y], [b1.x, a1.y, b1.x, b1.y]];
      for (const [col, wd] of [['#3B2314', 5], [lit ? '#F4E4B8' : '#C8B890', 3]]) {
        g.fillStyle = col;
        for (const [x0, y0, x1, y1] of segs) g.fillRect(Math.min(x0, x1) - (wd >> 1), Math.min(y0, y1) - (wd >> 1), Math.abs(x1 - x0) + wd, Math.abs(y1 - y0) + wd);
      }
    }
    // places, tents, quests, the goal
    const tentZones = s.tents.map((t) => t.zone);
    for (const z of zones) {
      const q = P(z), hub = places[z][2] === 'hub', r = hub ? 4 : 3;
      g.fillStyle = '#14101E'; g.fillRect(q.x - r, q.y - r, r * 2 + 1, r * 2 + 1);
      g.fillStyle = known(z) ? (hub ? '#E0303C' : '#FFD23F') : '#8E8A98'; g.fillRect(q.x - r + 1, q.y - r + 1, r * 2 - 1, r * 2 - 1);
      g.fillStyle = known(z) ? (hub ? '#FF8A8A' : '#FFF4B0') : '#B8B4C0'; g.fillRect(q.x - r + 1, q.y - r + 1, r * 2 - 1, 1);
      if (tentZones.includes(z)) { g.fillStyle = '#14101E'; g.fillRect(q.x + r, q.y - r - 4, 6, 5); g.fillStyle = C.terracotta; g.fillRect(q.x + r + 1, q.y - r - 3, 4, 3); g.fillRect(q.x + r + 2, q.y - r - 4, 2, 1); }
      const quest = known(z) && ((d.zones[z].npcs || []).some((n) => questMarker(d, s, z, n.id)) || Object.values(d.zones).some((iz) => iz.interior && iz.parent === z && s.visited[iz.zoneId] && (iz.npcs || []).some((n) => questMarker(d, s, iz.zoneId, n.id))));
      if (known(z) && highWorld.hidden(d, z, s.dex.seen).length) drawEye(g, q.x + r + 1, q.y + r - 1);
      if (liveSet(d, s, z)) { g.fillStyle = '#14101E'; g.fillRect(q.x - r - 6, q.y + r - 4, 5, 6); g.fillStyle = '#FF4FA8'; g.fillRect(q.x - r - 5, q.y + r - 3, 3, 4); g.fillStyle = '#FFFFFF'; g.fillRect(q.x - r - 4, q.y + r - 3, 1, 1); }   // a set is on
      if (quest) { g.fillStyle = '#14101E'; g.fillRect(q.x - r - 5, q.y - r - 5, 4, 7); g.fillStyle = C.yellow; g.fillRect(q.x - r - 4, q.y - r - 4, 2, 3); g.fillRect(q.x - r - 4, q.y - r, 2, 1); }
    }
    if (goal?.zone && places[goal.zone]) { const q = P(goal.zone); g.fillStyle = '#14101E'; g.fillRect(q.x - 1, q.y - 12, 1, 9); g.fillStyle = '#E0303C'; g.fillRect(q.x, q.y - 12, 5, 3); g.fillStyle = '#FF8A8A'; g.fillRect(q.x, q.y - 12, 5, 1); }
    // you: your head, bobbing on your place
    if (places[at]) {
      const q = P(at), head = game.images[`char:${s.outfit || 'player'}`], bob = Math.floor(this.t * 2) % 2;
      if (head) g.drawImage(head, 2, 0, 12, 12, q.x - 6, q.y - 13 - bob, 12, 12);
      else { g.fillStyle = C.magenta; g.fillRect(q.x - 2, q.y - 9 - bob, 5, 5); }
    }
    // the cursor: moves to the nearest place in the pressed direction
    if (!zones.includes(this.mapCur)) this.mapCur = zones.includes(at) ? at : zones[0];
    const taxi = s.wristbands.includes('vip_press');
    if (active) {
      for (const [k, v] of [['up', [0, -1]], ['down', [0, 1]], ['left', [-1, 0]], ['right', [1, 0]]]) {
        if (!input.pressed(k)) continue;
        const c0 = places[this.mapCur];
        let best = null, bd = 1e9;
        for (const z of zones) {
          if (z === this.mapCur) continue;
          const dx = places[z][0] - c0[0], dy = places[z][1] - c0[1], along = dx * v[0] + dy * v[1];
          if (along <= 0) continue;
          const dd = Math.hypot(dx, dy) + Math.abs(dx * v[1] - dy * v[0]) * 1.5;
          if (dd < bd) { bd = dd; best = z; }
        }
        if (best) { this.mapCur = best; game.audio?.sfx('blip'); }
      }
      if (input.taps?.length) {
        const t = input.taps[0];
        const hit = zones.find((z) => Math.abs(P(z).x - t.x) <= 7 && Math.abs(P(z).y - t.y) <= 7);
        if (hit) { input.taps.length = 0; if (hit !== this.mapCur) { this.mapCur = hit; game.audio?.sfx('blip'); } else input.press('a'); }
      }
    }
    const cz = this.mapCur;
    if (cz) {
      const q = P(cz), r = (places[cz][2] === 'hub' ? 4 : 3) + 2;
      if (Math.floor(this.t * 3) % 3) { g.fillStyle = '#FFFFFF'; g.fillRect(q.x - r, q.y - r, r * 2 + 1, 1); g.fillRect(q.x - r, q.y + r, r * 2 + 1, 1); g.fillRect(q.x - r, q.y - r, 1, r * 2 + 1); g.fillRect(q.x + r, q.y - r, 1, r * 2 + 1); }
      const tentHere = s.tents.findIndex((t) => t.zone === cz);
      const label = known(cz) ? d.zones[cz].name : '???';
      const hides = known(cz) && highWorld.hidden(d, cz, s.dex.seen).length;
      const extra = taxi && tentHere >= 0 && cz !== at ? 'A: tuk-tuk' : tentHere >= 0 ? 'Chai Tent' : '';
      if (cz !== at) { drawText(g, label, X, lineY, { color: C.ink }); if (hides) drawEye(g, X + textWidth(label) + 4, lineY + 1); if (extra) drawText(g, extra, X + CW, lineY, { color: '#B02A2A', align: 'right' }); }
      if (active && taxi && tentHere >= 0 && cz !== at && input.pressed('a')) { game.send({ type: 'USE_FIELD_TECHNIQUE', techniqueId: 'share_taxi_tuktuk', tentIndex: tentHere }); return; }
    }
    if (active && input.pressed('b')) back();
  },

  // ---- Sets: the festival timetable Banyan brought you. What plays where and when, what is on now, what is next.
  sets(game, g, X, Y, CW, active, back) {
    const s = game.engine.state, d = game.data, cur = this.cur, list0 = [...allSets(d)].sort((a, b) => a.from - b.from);
    drawText(g, `Festival clock ${clockText(s.clock)}`, X, Y, { color: C.purple });
    const rows = list0.map((x) => {
      const live = liveSet(d, s, x.zone)?.id === x.id, wait = minutesUntil(d, s, x);
      return { label: `${clockText(x.from)} ${x.name}`, color: live ? '#B02A2A' : C.ink, tag: live ? 'LIVE' : wait < 120 ? `in ${wait < 60 ? wait + 'm' : Math.floor(wait / 60) + 'h'}` : '' };
    });
    const r = list(game, g, rows, X - 4, Y + 12, CW + 4, cur.sets || 0, { rowH: 11, maxRows: 7, passive: !active, color: C.ink, hi: '#FFE06699' });
    cur.sets = r.cursor;
    rows.forEach((row, i) => { if (row.tag) drawText(g, row.tag, X + CW - 2, Y + 14 + i * 11, { color: row.tag === 'LIVE' ? '#B02A2A' : C.chai, align: 'right' }); });
    const x = list0[cur.sets];
    if (x) {
      const by = Y + 14 + 7 * 11 + 4;
      drawText(g, `${d.zones[x.zone].name}, until ${clockText(x.to)}`, X, by, { color: C.purple });
      wrap(x.what, CW).slice(0, 3).forEach((ln, i) => drawText(g, ln, X, by + 11 + i * 10, { color: C.ink }));
    }
    if (active && (game.input.pressed('b') || game.input.pressed('left'))) back();
  },

  bands(game, g, X, Y, CW, active, back) {
    const s = game.engine.state, d = game.data, input = game.input;
    const all = Object.keys(d.rules.wristbands);
    drawText(g, `Wristbands of Enlightenment ${s.wristbands.length}/8`, X, Y, { color: C.purple });
    all.forEach((id, i) => {
      const has = s.wristbands.includes(id), wb = d.rules.wristbands[id], y = Y + 14 + i * 14;
      g.fillStyle = C.ink; g.fillRect(X, y, 20, 8); g.fillStyle = has ? BAND_COLORS[i] : '#C8C0B0'; g.fillRect(X + 1, y + 1, 18, 6);
      if (has) { g.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 2; k < 18; k += 4) g.fillRect(X + k, y + 1, 1, 6); }
      drawText(g, has ? wb.name : `??? (${wb.boss})`, X + 26, y, { color: has ? C.ink : C.grey });
    });
    if (active && (input.pressed('b') || input.pressed('left') || input.pressed('a') || input.anyTap())) back();
  },

};

/** a small eye: an Astral that only comes out when you are high (on the map, and in the Journal) */
function drawEye(g, x, y) {
  g.fillStyle = '#14101E'; g.fillRect(x + 1, y, 5, 1); g.fillRect(x, y + 1, 7, 3); g.fillRect(x + 1, y + 4, 5, 1);
  g.fillStyle = '#F4F0FF'; g.fillRect(x + 1, y + 1, 5, 3);
  g.fillStyle = '#C86BFF'; g.fillRect(x + 3, y + 1, 1, 3); g.fillRect(x + 2, y + 2, 3, 1);
}

export function install(game) { game.register('menu', menuView); }
