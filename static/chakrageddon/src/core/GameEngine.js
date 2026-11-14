// Top-level state machine and command dispatcher. Headless: no DOM, no timers, no I/O.
// dispatch(command) mutates state deterministically and returns { state, events }.
import { makeRng } from './prng.js';
import * as OW from './OverworldEngine.js';
import { advance, startScript, setMode } from './ScriptEngine.js';
import { hooks, handleExtra } from './hooks.js';
import { bands, bandIndex, egoGone } from './intox.js';
import { currentGoal } from './goals.js';
import { questLog, check } from './quests.js';
import { statsOf } from './mons.js';

export const SAVE_VERSION = 1;

export function newState(data, seed = 1) {
  const start = data.manifest.start || { zone: Object.keys(data.zones)[0], x: 1, y: 1, dir: 'DOWN' };
  return {
    v: SAVE_VERSION,
    rng: seed >>> 0, salt: seed >>> 0,                                // salt: this playthrough's growth rolls (mons.js)
    mode: 'OVERWORLD',
    zoneId: start.zone,
    player: { x: start.x, y: start.y, dir: start.dir || 'DOWN' },
    party: [], box: [], bag: {}, rupees: data.rules.startRupees ?? 0,
    flags: {}, wristbands: [], defeated: {}, picked: {},
    cleared: {}, pushed: {}, visited: { [start.zone]: 1 }, tents: [],
    dex: { seen: {}, caught: {} },
    intox: 0, clock: 16 * 60, clockSteps: 0, steps: 0, repel: 0, nextUid: 1,
    encMeter: 0, encSteps: 0, encGap: null,                        // wild encounters: progress towards the next one
    lastTent: { zone: start.zone, x: start.x, y: start.y },
    script: null, scriptMode: null, dialogue: null, battle: null, shop: null, menu: null, scene: null,
    playerName: null, npcPos: {}, outfit: null, said: {}, visitor: null, visitorFx: null, entered: null,
    elapsed: 0, peakIntox: 0,                                       // for the end card: festival minutes lived, highest high
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
    // content added after a save was made, already behind you: marked as done (rules.doneIn: { flag: condition })
    for (const [flag, cond] of Object.entries(data.rules.doneIn || {})) if (flag[0] !== '_' && !state.flags[flag] && check(state, cond, data)) state.flags[flag] = 1;
    // stats come from growth since 1.2.0: an Astral from an older save keeps its level and lands on the average curve
    for (const m of [...(state.party || []), ...(state.box || [])]) { const st = statsOf(data, m); m.hp = Math.min(m.hp, st.maxHp); m.hyd = Math.min(m.hyd, st.maxHyd); }
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
    const bandBefore = bandIndex(this.data.rules, s.intox), goalBefore = currentGoal(this.data, s)?.id, clockBefore = s.clock;
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
          if (cmd.tab && cmd.tab !== s.menu?.tab) s.menu = { ...s.menu, tab: cmd.tab };
          else { s.menu = null; setMode(ctx, 'OVERWORLD'); }
        }
        break;
      case 'UNSTUCK':
        // System > Unstuck: from the map or the Fanny Pack, back to where you came into this area
        if (s.mode === 'OVERWORLD' || s.mode === 'FANNY_PACK_MENU') {
          if (s.mode === 'FANNY_PACK_MENU') { s.menu = null; setMode(ctx, 'OVERWORLD'); }
          OW.unstuck(ctx);
        }
        break;
      case 'BORED_LICK': {
        // left standing around with nothing to do, your hand finds the blotter by itself (rules.boredom)
        const R = this.data.rules.boredom || {};
        if (s.mode === 'OVERWORLD' && !s.dialogue && !s.battle && !ctx.data.zones[s.zoneId]?.indoor && (s.bag.glowing_blotter || 0) > 0 && s.intox < (R.ceiling ?? 0.9)) {
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
    // the end card's numbers: how long you have been at the festival, and how high you got
    s.elapsed = (s.elapsed || 0) + (((s.clock - clockBefore) % 1440) + 1440) % 1440;
    if (s.intox > (s.peakIntox || 0)) s.peakIntox = s.intox;
    // coming down inside something that only exists at Ego gone (the Inner Room, the stairs of light, the open road)
    if (s.mode === 'OVERWORLD' && !s.dialogue && !s.script) OW.egoCheck(ctx);
    // the festival timetable: after the third wristband, the next time you arrive somewhere, Banyan comes to find you
    const TT = this.data.rules.timetable;
    if (TT && !s.flags.timetable && s.wristbands.length >= (TT.unlockBands ?? 3) && events.some((x) => x.type === 'ZONE_CHANGED') && s.mode === 'OVERWORLD' && !s.dialogue && !s.script && !s.battle && this.data.dialogues.banyan_timetable) {
      startScript(ctx, this.data.dialogues.banyan_timetable);
    }
    // an area with a scene as you arrive (the back alley: an undercover locks the way out): zone.arriveScript, unless arriveUnless
    const AZ = this.data.zones[s.zoneId];
    if (AZ?.arriveScript && events.some((x) => x.type === 'ZONE_CHANGED' && x.to === s.zoneId) && s.mode === 'OVERWORLD' && !s.dialogue && !s.script && !s.battle
      && !(AZ.arriveUnless && check(s, AZ.arriveUnless, this.data)) && this.data.dialogues[AZ.arriveScript]) startScript(ctx, this.data.dialogues[AZ.arriveScript]);
    // the tarot reader: after the sixth wristband, the next time you arrive somewhere, Banyan's astral body floats down to say she is here
    const TR = this.data.rules.tarot;
    if (TR && !s.flags.tarot_arrived && s.wristbands.length >= (TR.unlockBands ?? 6) && events.some((x) => x.type === 'ZONE_CHANGED') && s.mode === 'OVERWORLD' && !s.dialogue && !s.script && !s.battle && this.data.dialogues.banyan_tarot) {
      startScript(ctx, this.data.dialogues.banyan_tarot);
    }
    // tell the player when they move into another intoxication band, and what it means
    const bandAfter = bandIndex(this.data.rules, s.intox);
    if (bandAfter !== bandBefore) {
      const b = bands(this.data.rules)[bandAfter];
      events.push({ type: 'INTOX_BAND', from: bandBefore, to: bandAfter, bandId: b.id });
      const text = bandAfter > bandBefore ? b.up : bands(this.data.rules)[bandAfter].down;
      if (text) events.push({ type: 'MESSAGE', text, kind: 'intox' });   // several in a row: the view shows only the latest
      // the first time your ego goes, Banyan feels it from the shack
      if (egoGone(this.data.rules, s.intox) && !s.flags.banyan_felt && s.flags.started) {
        s.flags.banyan_felt = 1;
        events.push({ type: 'MESSAGE', text: 'A text from Banyan: "I felt that from the shack. Drink some water. Then drink some more water."' });
      }
      // the first time you get high at all, say once what it means and how to come down
      if (bandAfter > 0 && !s.flags.tip_high) {
        s.flags.tip_high = 1;
        events.push({ type: 'MESSAGE', text: 'Tip: how high you are shows in the corner. Higher means more Vibes and rarer Astrals, but clumsier hands, harder hits and costlier whiteouts. Water, a nap in a Chai Tent or a long walk bring you down.' });
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
