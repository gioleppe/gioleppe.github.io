// What the scouts read from the rest of the game, in one place (step 4.1):
//   sim.resonance  (Resonance.js)  detectionMultiplier (1, 1.2 Humming, 1.35 Agitated), escalate (Agitated), tier
//   sim.safeZones  (SafeZones.js)  inSafeZone(x, y): scouts never enter it, pursue into it or shoot into it
// Both are read through guarded accessors, so a bare test object without them still works.
import { DT } from '../../sim/constants.js';
import { ambientVisibility } from '../../world/visibility.js';

/** @returns {number} factor on scout sight ranges from the Resonance tier (1 without Resonance) */
export function resonanceDetection(sim) {
  const m = sim.resonance?.detectionMultiplier;
  return typeof m === 'number' && m > 0 ? m : 1;
}

/** @returns {boolean} Resonance is Agitated: an INVESTIGATE escalates straight to the alert (spec §6.3) */
export function resonanceEscalates(sim) {
  return sim.resonance?.escalate === true;
}

/** @returns {string} 'quiet' | 'humming' | 'agitated' */
export function resonanceTier(sim) {
  return sim.resonance?.tier ?? 'quiet';
}

/**
 * Is a world point inside a safe zone (sim.safeZones: Marek's clearing)? Scouts never enter one, never pursue into
 * one and never shoot at a player inside one.
 * @returns {boolean}
 */
export function inSafeZone(sim, x, y) {
  return sim.safeZones?.inSafeZone(x, y) ?? false;
}

/**
 * Everything about the player the scouts need this tick, worked out once for all of them.
 * @typedef {Object} PlayerView
 * @property {number} x
 * @property {number} y
 * @property {number} vx  actual velocity this tick (px/s, after collision)
 * @property {number} vy
 * @property {boolean} hidden      dead, or the debug "invisible player"
 * @property {number} rangeFactor  sight range factor: cover x light x Resonance x crouching in the open
 * @property {number} presenceFactor  the all-round presence radius factor (no light term: you feel a body at arm's length in the dark)
 * @property {number} ambient      light factor used (ambient visibility, raised by a lit flashlight)
 * @property {boolean} inCover
 * @property {string|null} region
 * @property {boolean} inland      seen here, a scout attacks without warning
 * @property {boolean} provokes    metal or electronics in hand, or electronics switched on
 * @property {boolean} escalate    Resonance is Agitated
 * @property {boolean} safe        inside a safe zone
 */

/**
 * @param {import('../../sim/Sim.js').Sim} sim
 * @param {Object} ai tuning.ai
 * @param {{ invisible: boolean }} cheats
 * @param {Set<string>} inlandRegions
 * @param {PlayerView} [out]
 * @returns {PlayerView}
 */
export function viewPlayer(sim, ai, cheats, inlandRegions, out = {}) {
  const p = sim.player;
  const t = sim.tuning;
  out.x = p.x;
  out.y = p.y;
  out.vx = (p.x - p.prevX) / DT;
  out.vy = (p.y - p.prevY) / DT;
  out.hidden = p.dead || cheats.invisible === true;
  let amb = sim.world ? ambientVisibility(sim.world, t) : 1;
  if (p.lightOn && amb < ai.sight.flashlightVisibility) amb = ai.sight.flashlightVisibility;
  out.ambient = amb;
  out.inCover = p.inCover;
  const stance = p.stance === 'crouch' && !p.inCover ? ai.sight.crouchFactor : 1;
  const res = resonanceDetection(sim);
  out.rangeFactor = p.visibilityFactor * amb * res * stance;
  out.presenceFactor = p.visibilityFactor * res * stance;
  out.region = sim.map ? sim.map.regionAtWorld(p.x, p.y) : null;
  out.inland = out.region !== null && inlandRegions.has(out.region);
  const inv = sim.inventory;
  out.provokes = !!inv && (inv.holdingMetalOrElectronics || inv.carriesActiveElectronics);
  out.escalate = resonanceEscalates(sim);
  out.safe = inSafeZone(sim, p.x, p.y);
  return out;
}
