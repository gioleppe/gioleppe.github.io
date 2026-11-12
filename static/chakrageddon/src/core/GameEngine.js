// Top-level state machine and command dispatcher. Headless: no DOM, no timers, no I/O.
// dispatch(command) mutates state deterministically and returns { state, events }.
import { makeRng } from './prng.js';
import * as OW from './OverworldEngine.js';
import { advance, startScript, setMode } from './ScriptEngine.js';
import { hooks, handleExtra } from './hooks.js';
import { bands, bandIndex } from './intox.js';
import { currentGoal } from './goals.js';
import { questLog } from './quests.js';

export const SAVE_VERSION = 1;

export function newState(data, seed = 1) {
  const start = data.manifest.start || { zone: Object.keys(data.zones)[0], x: 1, y: 1, dir: 'DOWN' };
  return {
    v: SAVE_VERSION,
    rng: seed >>> 0,
    mode: 'OVERWORLD',
    zoneId: start.zone,
    player: { x: start.x, y: start.y, dir: start.dir || 'DOWN' },
    party: [], box: [], bag: {}, rupees: data.rules.startRupees ?? 0,
    flags: {}, wristbands: [], defeated: {}, picked: {},
    cleared: {}, pushed: {}, visited: { [start.zone]: 1 }, tents: [],
    dex: { seen: {}, caught: {} },
    intox: 0, clock: 16 * 60, clockSteps: 0, steps: 0, repel: 0, nextUid: 1,
    lastTent: { zone: start.zone, x: start.x, y: start.y },
    script: null, scriptMode: null, dialogue: null, battle: null, shop: null, menu: null, scene: null,
    playerName: null, npcPos: {}, outfit: null,
  };
}

export class GameEngine {
  constructor(data, opts = {}) {
    this.data = data;
    this.state = opts.state || newState(data, opts.seed ?? 1);
    this.rng = makeRng(this.state);
    this.options = { ...(opts.options || {}) };   // rules the player picks (e.g. shift: the Shift battle style); not saved
  }

  serialize() { return JSON.stringify(this.state); }
  static load(data, json) {
    const state = typeof json === 'string' ? JSON.parse(json) : json;
    if (state.v !== SAVE_VERSION) throw new Error(`save version ${state.v} not supported`);
    // saves from earlier builds: fill in any field that did not exist yet
    const base = newState(data, 1);
    for (const k of Object.keys(base)) if (!(k in state)) state[k] = base[k];
    const e = new GameEngine(data, { state });
    if (state.mode === 'OVERWORLD' && data.zones[state.zoneId]) e.run((ctx) => OW.settle(ctx));   // the map may have been redrawn since
    return e;
  }

  /** Tooling and test hook: run fn(ctx) against the live state and return the events it emitted. */
  run(fn) {
    const events = [];
    fn({ data: this.data, state: this.state, rng: this.rng, options: this.options, emit: (e) => events.push(e), hooks });
    return events;
  }

  dispatch(cmd) {
    const events = [];
    const ctx = { data: this.data, state: this.state, rng: this.rng, options: this.options, emit: (e) => events.push(e), hooks };
    const s = this.state;
    const bandBefore = bandIndex(this.data.rules, s.intox), goalBefore = currentGoal(this.data, s)?.id;
    const questsBefore = Object.fromEntries(questLog(this.data, s).map((q) => [q.id, q.state]));
    switch (cmd.type) {
      case 'BEGIN':
        if (!s.flags.started) { s.flags.started = 1; const intro = this.data.dialogues.intro; if (intro) startScript(ctx, intro); }
        break;
      case 'MOVE_STEP':
        if (s.mode === 'OVERWORLD' && OW.DIRS[cmd.direction]) OW.step(ctx, cmd.direction);
        break;
      case 'INTERACT_TILE':
        if (s.mode === 'OVERWORLD') OW.interact(ctx);
        break;
      case 'ADVANCE_DIALOGUE':
        if (s.dialogue || s.mode === 'K_HOLE_WHITEOUT') {
          if (s.mode === 'K_HOLE_WHITEOUT' && !s.script) { s.dialogue = null; setMode(ctx, 'OVERWORLD'); } else advance(ctx, cmd.choiceIndex);
        }
        break;
      case 'TOGGLE_MENU':
        if (s.mode === 'OVERWORLD') { s.menu = { tab: cmd.tab || 'WRISTBAND_ARM' }; setMode(ctx, 'FANNY_PACK_MENU'); }
        else if (s.mode === 'FANNY_PACK_MENU') {
          if (cmd.tab && cmd.tab !== s.menu?.tab) s.menu = { tab: cmd.tab };
          else { s.menu = null; setMode(ctx, 'OVERWORLD'); }
        }
        break;
      case 'BORED_LICK': {
        // left standing around with nothing to do, your hand finds the blotter by itself (rules.boredom)
        const R = this.data.rules.boredom || {};
        if (s.mode === 'OVERWORLD' && !s.dialogue && !s.battle && (s.bag.glowing_blotter || 0) > 0 && s.intox < (R.ceiling ?? 0.9)) {
          const before = s.intox;
          s.intox = Math.min(1, s.intox + (R.dose ?? 0.12));
          events.push({ type: 'INTOXICATION_CHANGED', oldLevel: before, newLevel: s.intox });
          events.push({ type: 'MESSAGE', text: s.flags.tip_bored ? 'Bored, you lick a corner of the blotter.' : 'Bored, you lick a corner of the blotter. Stand around with nothing to do and your hand finds it by itself. Keep moving.' });
          s.flags.tip_bored = 1;
        }
        break;
      }
      default:
        handleExtra(ctx, cmd);
    }
    // tell the player when they move into another intoxication band, and what it means
    const bandAfter = bandIndex(this.data.rules, s.intox);
    if (bandAfter !== bandBefore) {
      const b = bands(this.data.rules)[bandAfter];
      events.push({ type: 'INTOX_BAND', from: bandBefore, to: bandAfter, bandId: b.id });
      const text = bandAfter > bandBefore ? b.up : bands(this.data.rules)[bandAfter].down;
      if (text) events.push({ type: 'MESSAGE', text, kind: 'intox' });   // several in a row: the view shows only the latest
      // the first time you get high at all, say once what it means and how to come down
      if (bandAfter > 0 && !s.flags.tip_high) {
        s.flags.tip_high = 1;
        events.push({ type: 'MESSAGE', text: 'Tip: how high you are shows in the corner. Higher means more Vibes and rarer Astrals, but clumsier hands, harder hits and costlier whiteouts. Water, chai or a nap bring you down.' });
      }
    }
    // Quick Items, explained once: on the Sandy Trail, after your first battle (right after it, if it was there)
    if (events.some((x) => x.type === 'BATTLE_END')) s.flags.fought = 1;
    if (!s.flags.tip_quick && s.flags.fought && s.zoneId === 'sandy_trail' && s.mode === 'OVERWORLD' && !s.dialogue && !s.battle) {
      s.flags.tip_quick = 1;
      events.push({ type: 'MESSAGE', text: 'Tip: Quick Items. Press Q (or ITEMS on the touch pad) to give snacks and water to any Astral without opening the Fanny Pack. Everything that heals or hydrates shows up there by itself.' });
    }
    // side quests that start or finish
    for (const q of questLog(this.data, s)) {
      if (q.state === questsBefore[q.id]) continue;
      if (q.state === 'active' && questsBefore[q.id] === 'hidden') { events.push({ type: 'QUEST', questId: q.id, state: 'active' }); events.push({ type: 'MESSAGE', text: `New quest: ${q.name}` }); }
      if (q.state === 'done') { events.push({ type: 'QUEST', questId: q.id, state: 'done' }); events.push({ type: 'MESSAGE', text: `Quest complete: ${q.name}` }); }
    }
    // and when the story moves on
    const goal = currentGoal(this.data, s);
    if (goal && goal.id !== goalBefore && s.flags.started && cmd.type !== 'BEGIN') {
      events.push({ type: 'GOAL_CHANGED', goalId: goal.id, text: goal.text });
      events.push({ type: 'MESSAGE', text: `New goal: ${goal.text}` });
    }
    return { state: s, events };
  }
}
