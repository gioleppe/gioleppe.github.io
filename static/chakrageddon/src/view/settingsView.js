// Options screen, reachable from the title and from the Fanny Pack.
import { W, H } from './CanvasRenderer.js';
import { drawText, wrap, panel, list, C } from './ui.js';
import { tl } from '../core/i18n.js';

const SPEED = ['Slow', 'Normal', 'Fast'];
const BATTLE_SPEED = ['Normal', 'Fast', 'Very fast'];
const PICTURE = ['Full', 'Large', 'Medium', 'Small'];
const DIFFICULTY = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

export const settingsView = {
  screen: true, titleEntry: 'Options', cursor: 0, from: 'title',
  open(game, from) { this.from = from; this.cursor = 0; },
  update() {},
  draw(game, g) {
    const st = game.settings, input = game.input;
    g.fillStyle = C.void; g.fillRect(0, 0, W, H);
    panel(g, 20, 8, W - 40, H - 16, { bg: '#FFF4E4', accent: C.cyan });
    if (this.remap) return this.drawRemap(game, g);
    if (this.juke) return this.drawJukebox(game, g);
    drawText(g, tl('OPTIONS'), W / 2, 15, { color: C.purple, align: 'center' });
    const rows = [
      { id: 'difficulty', label: tl('Difficulty'), right: tl(DIFFICULTY[st.difficulty] || 'Normal'), help: tl({ easy: 'Easy: your Astrals hit 20% harder and take 20% less.', hard: 'Hard: your Astrals hit 20% softer and take 20% more.' }[st.difficulty] || 'Normal: everyone hits as hard as they hit.') },
      { id: 'grounded', label: tl('Grounded mode'), right: st.grounded ? tl('ON') : tl('off'), help: tl('Caps the trippy screen effects at their mildest level. Recommended if you are sensitive to motion or flashing.') },
      { id: 'reducedMotion', label: tl('Reduced motion'), right: st.reducedMotion ? tl('ON') : tl('off'), help: tl('Stops screen shake, flashes and spinning backgrounds.') },
      { id: 'textSpeed', label: tl('Text speed'), right: tl(SPEED[st.textSpeed]), help: tl('How fast dialogue types out.') },
      { id: 'battleSpeed', label: tl('Battle speed'), right: tl(BATTLE_SPEED[st.battleSpeed || 0]), help: tl('How fast battles play out. Holding B also fast-forwards.') },
      { id: 'battleStyle', label: tl('Battle style'), right: st.battleStyle === 'set' ? tl('Set') : tl('Shift'), help: st.battleStyle === 'set' ? tl('Set: a trainer sends their next Astral straight in.') : tl('Shift: when you knock out an Astral of a trainer, you may swap yours before the next one comes out.') },
      { id: 'pictureSize', label: tl('Picture size'), right: tl(PICTURE[st.pictureSize || 0]), help: pictureHelp(game) },
      { id: 'volume', label: tl('Volume'), right: `${Math.round(st.volume * 100)}%`, help: tl('Music and sound. 0% is mute.') },
      { id: 'jukebox', label: tl('Sound test'), right: '', help: tl('Listen to the music of every zone, battles and bosses.') },
      { id: 'keys', label: tl('Remap keyboard'), right: '', help: tl('Choose your own keys. Arrow keys, Enter and Esc always keep working.') },
      { id: 'export', label: tl('Export save to file'), right: '', help: tl('Downloads your save so you can move it to another device.'), disabled: !game.hasSave() },
      { id: 'import', label: tl('Import save from file'), right: '', help: tl('Loads a save file. This replaces the save on this device.') },
      { id: 'back', label: tl('Back'), right: '', help: '' },
    ];
    if (game.langs?.length > 1) rows.unshift({ id: 'language', label: tl('Language'), right: game.langName(), help: tl('The language of the whole game. Changing it restarts the page (your progress is saved first).') });
    const r = list(game, g, rows, 28, 25, W - 56, this.cursor, { rowH: 11, maxRows: 10 });   // scrolls: 10 rows above the help text
    this.cursor = r.cursor;
    const row = rows[this.cursor];
    wrap(row.help, W - 64).slice(0, 2).forEach((ln, i) => drawText(g, ln, 32, 150 + i * 10, { color: C.chai }));
    const side = input.pressed('right') ? 1 : input.pressed('left') ? -1 : 0;
    const act = r.chosen >= 0 ? 1 : side;
    if (act) {
      const id = r.chosen >= 0 ? rows[r.chosen].id : row.id;
      if (id === 'language') { game.cycleLanguage(act > 0 ? 1 : -1); return; }
      else if (id === 'difficulty') { const k = ['easy', 'normal', 'hard'], i = k.indexOf(st.difficulty || 'normal'); st.difficulty = k[(i + (act > 0 ? 1 : 2)) % 3]; }
      else if (id === 'grounded') st.grounded = !st.grounded;
      else if (id === 'reducedMotion') st.reducedMotion = !st.reducedMotion;
      else if (id === 'textSpeed') st.textSpeed = (st.textSpeed + (act > 0 ? 1 : 2)) % 3;
      else if (id === 'battleSpeed') st.battleSpeed = ((st.battleSpeed || 0) + (act > 0 ? 1 : 2)) % 3;
      else if (id === 'battleStyle') st.battleStyle = st.battleStyle === 'set' ? 'shift' : 'set';
      else if (id === 'pictureSize') st.pictureSize = ((st.pictureSize || 0) + (act > 0 ? 1 : 3)) % 4;
      else if (id === 'volume') st.volume = Math.max(0, Math.min(1, Math.round((st.volume + act * 0.1) * 10) / 10)) % 1.1;
      else if (id === 'keys' && r.chosen >= 0) { this.remap = { i: 0 }; return; }
      else if (id === 'jukebox' && r.chosen >= 0) { this.juke = { i: 0, playing: null }; return; }
      else if (id === 'export' && r.chosen >= 0) game.exportSave?.();
      else if (id === 'import' && r.chosen >= 0) game.importSave?.();
      else if (id === 'back' && r.chosen >= 0) return this.close(game);
      game.saveSettings();
    }
    if (input.pressed('b')) this.close(game);
  },
  drawRemap(game, g) {
    const st = game.settings, input = game.input, R = this.remap;
    const ACTIONS = [['up', 'Up'], ['down', 'Down'], ['left', 'Left'], ['right', 'Right'], ['a', 'Confirm (A)'], ['b', 'Back / run (B)'], ['start', 'Menu'], ['item', 'Quick items'], ['lick', 'Lick the blotter']];
    drawText(g, tl('REMAP KEYBOARD'), W / 2, 15, { color: C.purple, align: 'center' });
    st.keys ||= {};
    const nameOf = (btn) => st.keys[btn] || Object.keys(input.keys).find((k) => input.keys[k] === btn && !k.startsWith('Arrow') && k !== 'Enter' && k !== 'Escape') || '-';
    const rows = ACTIONS.map(([btn, label]) => ({ label: tl(label), right: R.waiting === btn ? tl('press a key...') : nameOf(btn).replace('Key', '') })).concat([{ label: tl('Reset to defaults') }, { label: tl('Done') }]);
    const r = list(game, g, rows, 28, 28, W - 56, R.i, { rowH: 14, passive: !!R.waiting });
    R.i = r.cursor;
    if (R.waiting) return;
    if (r.chosen >= 0 && r.chosen < ACTIONS.length) {
      const btn = ACTIONS[r.chosen][0];
      R.waiting = btn;
      input.captureKey((code) => { R.waiting = null; if (!code.startsWith('Arrow') && code !== 'Enter' && code !== 'Escape') { for (const k of Object.keys(st.keys)) if (st.keys[k] === code) delete st.keys[k]; st.keys[btn] = code; input.applyKeys(st.keys); game.saveSettings(); } input.held = {}; input.edges = {}; });
    } else if (r.chosen === ACTIONS.length) { st.keys = {}; input.applyKeys(st.keys); game.saveSettings(); }
    else if (r.chosen === ACTIONS.length + 1 || input.pressed('b')) this.remap = null;
  },
  /** Sound test: every zone's track, plus battle, boss and title music */
  drawJukebox(game, g) {
    const J = this.juke, input = game.input, d = game.data;
    drawText(g, tl('SOUND TEST'), W / 2, 15, { color: C.purple, align: 'center' });
    const tracks = Object.values(d.zones).map((z) => ({ label: z.name, bpm: z.baseBpm, mood: z.paletteId, zone: z.zoneId }))
      .concat([{ label: tl('Battle (wild)'), bpm: 146, mood: 'BATTLE', zone: 'sandy_trail' }, { label: tl('Battle (boss)'), bpm: 152, mood: 'BOSS', zone: 'forest_stage' }, { label: tl('Title'), bpm: 140, mood: 'TITLE', zone: '' }]);
    const rows = tracks.map((t, k) => ({ label: t.label, right: J.playing === k ? tl('playing') : `${t.bpm}` })).concat([{ label: tl('Back') }]);
    const r = list(game, g, rows, 28, 26, W - 56, J.i, { rowH: 13, maxRows: 9 });
    J.i = r.cursor;
    wrap(game.audio?.ctx ? tl('A plays a track. B goes back.') : tl('Press any button first so the browser lets sound play.'), W - 64).forEach((ln, k) => drawText(g, ln, 32, 150 + k * 10, { color: C.chai }));
    if (r.chosen >= 0 && r.chosen < tracks.length) {
      const t = tracks[r.chosen]; J.playing = r.chosen;
      game.audio?.unlock?.(); game.audio?.setTrack({ bpm: t.bpm, mood: t.mood, zone: t.zone, lowPass: 12000 });
    } else if (r.chosen === tracks.length || input.pressed('b')) {
      this.juke = null;
      if (game.engine) game.startZoneAudio(); else game.audio?.setTrack({ bpm: 140, mood: 'TITLE', zone: '' });
    }
  },
  close(game) { game.saveSettings(); game.screen = this.from === 'play' && game.engine ? 'play' : 'title'; game.audio?.sfx('back'); },
};

export function install(game) { game.register('settings', settingsView); }

/** what Picture size gives on this screen: the size in pixels, and whether it can go any smaller */
function pictureHelp(game) {
  const r = game.renderer, now = r?.cssW ? tl(' Now {0}x{1}.', r.cssW, r.cssH) : '';
  const floor = r && r.scale === 1 && (game.settings.pictureSize || 0) > 0 && r.fit - (game.settings.pictureSize || 0) < 1;
  return tl('Smaller picture in sharp whole steps, centred on black.') + now + (floor ? tl(' (As small as it goes.)') : '');
}
