// When the game may be saved (step 5.2), as one pure function of the simulation, so the page (explicit save,
// autosave), the bots and the save audit (V5) all obey the same rule: a save can never trap the player. Loading a
// save puts the player back into exactly that moment; if that moment is already lost (an arrow on its way, the
// tide closing over the reef walkway, the lungs empty), every load of it is lost too. So a save is refused at any
// moment that is not calm, and the autosave waits for a calm moment instead.
//
// The safety table, checked top to bottom; the first row that matches refuses, with its reason:
//
//   | code            | refused while                                                    | reason shown to the player                 |
//   | --------------- | ---------------------------------------------------------------- | ------------------------------------------ |
//   | over            | the run is lost (`sim.over`) or the player is dead                | The run is over.                           |
//   | ending          | an ending sequence runs (in the dinghy from     | Not now: there is no stopping halfway.     |
//   |                 | boarding on; a window on the peak after the    |                                            |
//   |                 | flare) or an ending was reached                 |                                            |
//   | chase           | a scout is in CHASE (`sim.threat.level` or any scout's state)      | Not while they are chasing you.            |
//   | warn            | a scout is in WARN                                                 | Not while you are being warned off.        |
//   | search          | a scout is in SEARCH                                               | Not while they are searching for you.      |
//   | investigate     | a scout in INVESTIGATE is within save.investigateRefuseRadius px   | Not while someone is coming to look.       |
//   |                 | of the player (or the threat says investigate and gives no place)  |                                            |
//   | drowning        | the player is drowning                                             | Not while you are drowning.                |
//   | deep_water      | the player is swimming (deep water)                                | Not in deep water.                         |
//   | bleeding        | the player is bleeding                                             | Not while you are bleeding.                |
//   | dialogue        | a conversation is open                                             | Not in the middle of a conversation.       |
//   | busy            | a channel (drinking, prying, repairing) is running                 | Finish what you are doing first.           |
//   | projectile      | anything thrown (or shot) is still in the air                      | Not while something is in the air.         |
//   | flooding_ground | any part of the player's body stands on ground the tide floods     | Not on ground the tide covers.             |
//   |                 | (map flood level > 0). The dry refuges and the wreck deck are      |                                            |
//   |                 | level 0, so saving there is fine; the reef walkway is not.         |                                            |
//
// INVESTIGATE, decided: refused only near the player. An investigating scout walking to a noise beside you can
// turn into a sighting within seconds of a load, before the player has even taken the controls back; one checking
// a rock thrown across the island cannot, and refusing that would make saving feel arbitrary. The radius
// (tuning.save.investigateRefuseRadius) is larger than a scout's sight and hearing so a nearby investigation
// always counts. When the threat summary says `investigate` but no scout position is known, the rule refuses:
// unknown is treated as near.
//
// The scouts (steps 4.1-4.3) are read defensively: `sim.threat?.level ?? 'none'` (with `nearest`, px), and `sim.scouts` as an array (or
// `{ list }`) of objects with a state in `state`, `ai.state` or `mode` and a position in `x`, `y`. With no scouts
// at all the threat rows never match.
//
// Also here, because bots and audits need them too: autosaveReason (which events make a safe moment worth an
// autosave) and saveSummary (day, time, region, nearby landmark and play time, for the save slot's label).
import { DT, TILE_W, TILE_H } from './constants.js';

/** threat levels, lowest first, as the AI reports them */
export const THREAT_LEVELS = Object.freeze(['none', 'investigate', 'search', 'warn', 'chase']);

/** default refuse radius for a nearby INVESTIGATE when tuning has no save block (world pixels) */
export const DEFAULT_INVESTIGATE_RADIUS = 480;

const lower = (s) => (typeof s === 'string' ? s.toLowerCase() : '');

/** the scouts as an array, whatever container the AI keeps them in */
export function scoutList(sim) {
  const s = sim?.scouts;
  if (!s) return [];
  if (Array.isArray(s)) return s;
  if (Array.isArray(s.list)) return s.list;
  if (typeof s[Symbol.iterator] === 'function') return [...s];
  return [];
}

/** a scout's AI state, lower case ('' when unknown) */
export function scoutState(scout) {
  return lower(scout?.state ?? scout?.ai?.state ?? scout?.mode);
}

/** the highest threat level, from the threat summary and from every scout's own state */
export function threatLevel(sim) {
  let best = Math.max(0, THREAT_LEVELS.indexOf(lower(sim?.threat?.level ?? 'none')));
  for (const sc of scoutList(sim)) best = Math.max(best, THREAT_LEVELS.indexOf(scoutState(sc)));
  return THREAT_LEVELS[best];
}

function investigatingNear(sim, radius) {
  const p = sim.player;
  let known = false;
  for (const sc of scoutList(sim)) {
    if (scoutState(sc) !== 'investigate') continue;
    if (!Number.isFinite(sc.x) || !Number.isFinite(sc.y)) return true;
    known = true;
    const dx = sc.x - p.x;
    const dy = sc.y - p.y;
    if (dx * dx + dy * dy <= radius * radius) return true;
  }
  if (lower(sim.threat?.level) === 'investigate' && !known) {
    // only a summary: use its distance if it has one, else assume near
    const d = sim.threat?.nearest ?? sim.threat?.distance;
    return !Number.isFinite(d) || d <= radius;
  }
  return false;
}

/** true if the tide floods the ground under any part of the player's body (centre and four edge points) */
export function onFloodingGround(sim) {
  const map = sim.map;
  const p = sim.player;
  if (!map || typeof map.floodLevel !== 'function') return false;
  const r = Number.isFinite(p.radius) ? p.radius : 0;
  for (const [ox, oy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
    if (map.floodLevel(Math.floor((p.x + ox) / TILE_W), Math.floor((p.y + oy) / TILE_H)) > 0) return true;
  }
  return false;
}

/**
 * The rows of the safety table, in the order they are checked. `test(sim, cfg)` is true when the row refuses.
 * @type {ReadonlyArray<{ code: string, reason: string, test: (sim: Object, cfg: Object) => boolean }>}
 */
export const SAVE_RULES = Object.freeze([
  { code: 'over', reason: 'The run is over.', test: (sim) => !!sim.over || !!sim.player?.dead },
  { code: 'ending', reason: 'Not now: there is no stopping halfway.', test: (sim) => !!sim.ending || sim.endings?.inSequence === true },
  { code: 'chase', reason: 'Not while they are chasing you.', test: (sim) => threatLevel(sim) === 'chase' },
  { code: 'warn', reason: 'Not while you are being warned off.', test: (sim) => threatLevel(sim) === 'warn' },
  { code: 'search', reason: 'Not while they are searching for you.', test: (sim) => threatLevel(sim) === 'search' },
  { code: 'investigate', reason: 'Not while someone is coming to look.', test: (sim, cfg) => investigatingNear(sim, cfg.investigateRefuseRadius ?? DEFAULT_INVESTIGATE_RADIUS) },
  { code: 'drowning', reason: 'Not while you are drowning.', test: (sim) => !!sim.player?.drowning },
  { code: 'deep_water', reason: 'Not in deep water.', test: (sim) => sim.player?.mode === 'swim' },
  { code: 'bleeding', reason: 'Not while you are bleeding.', test: (sim) => (sim.player?.bleedTicks ?? 0) > 0 },
  { code: 'dialogue', reason: 'Not in the middle of a conversation.', test: (sim) => !!sim.dialogue?.active || !!sim.story?.conversation },
  { code: 'busy', reason: 'Finish what you are doing first.', test: (sim) => !!sim.interactables?.channel },
  { code: 'projectile', reason: 'Not while something is in the air.', test: (sim) => (sim.projectiles?.list?.length ?? 0) > 0 },
  { code: 'flooding_ground', reason: 'Not on ground the tide covers.', test: (sim) => onFloodingGround(sim) },
]);

/**
 * May the game be saved now? Explicit saves and autosaves both ask this.
 * @param {Object} sim a Sim
 * @param {Object} [cfg] tuning.save (defaults to sim.tuning.save)
 * @returns {{ ok: boolean, code: string|null, reason: string|null }}
 */
export function canSave(sim, cfg = sim?.tuning?.save ?? {}) {
  if (!sim || !sim.player) return { ok: false, code: 'none', reason: 'There is nothing to save.' };
  for (const row of SAVE_RULES) {
    if (row.test(sim, cfg)) return { ok: false, code: row.code, reason: row.reason };
  }
  return { ok: true, code: null, reason: null };
}

/** story events that complete a step of an escape plan (an autosave follows, once the moment is safe) */
// signal_confirm: the first press of the flare gun at the peak is a safe moment by construction (endings/signal.js
// asks canSave first); TASKS.md 5.4 wants the autosave there, just before the signal is fired
export const STORY_SAVE_EVENTS = Object.freeze(['dinghy_repaired', 'hatch_opened', 'crafted', 'signal_confirm']);

/**
 * Why this step's events call for an autosave, or null: entering a safe zone (Marek's clearing), picking up a key
 * item, completing a story step. The caller still asks canSave before writing.
 * @param {Array<Object>} events sim.events of one step
 * @param {Object} sim
 * @returns {'safe_zone'|'key_item'|'story'|null}
 */
export function autosaveReason(events, sim) {
  for (const e of events ?? []) {
    if (e.type === 'safe_zone' && e.entered) return 'safe_zone';
    if (e.type === 'item_picked' && sim?.catalog?.isKey?.(e.item)) return 'key_item';
    if (STORY_SAVE_EVENTS.includes(e.type)) return 'story';
  }
  return null;
}

/** 'southern_cove' -> 'Southern Cove' */
export function regionLabel(id) {
  if (!id) return '';
  return String(id).split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

/**
 * What a save slot shows about a moment: day, hour, region, the nearest named place within `near` px, play time.
 * Play time comes from ticks (every tick played, conversations included), never from the wall clock.
 * @param {Object} sim
 * @param {{ near?: number }} [opts]
 * @returns {{ tick: number, day: number, timeOfDay: number, region: string, landmarkNearby: string|null, playSeconds: number }}
 */
export function saveSummary(sim, { near = 320 } = {}) {
  const p = sim.player;
  const map = sim.map;
  let landmarkNearby = null;
  if (map?.entitiesOfType) {
    let best = near * near;
    for (const l of map.entitiesOfType('landmark')) {
      const dx = l.x - p.x;
      const dy = l.y - p.y;
      const d = dx * dx + dy * dy;
      if (d <= best) { best = d; landmarkNearby = l.name ?? l.id; }
    }
  }
  const region = map?.regionAtWorld ? regionLabel(map.regionAtWorld(p.x, p.y)) : 'Test Field';
  return {
    tick: sim.tick,
    day: sim.world?.day ?? 1,
    timeOfDay: Math.round((sim.world?.timeOfDay ?? 0) * 100) / 100,
    region,
    landmarkNearby,
    playSeconds: Math.floor(sim.tick * DT),
  };
}
