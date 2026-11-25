// Every write the debug mode makes to simulation state, in one file so it can be audited.
//
// The presentation never writes the simulation except through input: this module is the one sanctioned
// exception, allowed because it only exists under `?debug` (debug mode is not the game). New cheats from
// later steps (give item, set tide, set hour, set Resonance, spawn scout) belong here too; the panel's
// actions call these functions rather than touching `sim` themselves.
import { Sim } from '../../sim/Sim.js';
import { toggleLight, syncLight } from '../../entities/ItemUse.js';
import { Story } from '../../sim/Dialogue.js';
import { OUTSIDER_SITES } from '../../entities/marekHooks.js';

/**
 * Move the player to a world point at once (no interpolation streak, no velocity). Inside a bounded map the
 * point is kept where the player could stand by the bounds rule; collision is not checked.
 * @param {Sim} sim
 * @param {number} x world pixels
 * @param {number} y
 * @returns {{x:number,y:number}} where the player ended up
 */
export function teleportPlayer(sim, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError(`teleport: expected finite x and y, got ${x}, ${y}`);
  const p = sim.player;
  let tx = x;
  let ty = y;
  if (sim.bounds) {
    const b = sim.bounds;
    tx = Math.max(b.x + p.radius, Math.min(b.x + b.w - p.radius, tx));
    ty = Math.max(b.y + p.radius, Math.min(b.y + b.h - p.radius, ty));
  }
  p.x = tx;
  p.y = ty;
  p.prevX = tx;
  p.prevY = ty;
  p.vx = 0;
  p.vy = 0;
  return { x: tx, y: ty };
}

/**
 * Where a new game with this sim's seed and data puts the player.
 * @param {Sim} sim
 * @returns {{x:number,y:number}}
 */
export function spawnPoint(sim) {
  const fresh = new Sim({ map: sim.map, tuning: sim.tuning, data: sim.data, seed: sim.seed });
  return { x: fresh.player.x, y: fresh.player.y };
}

/** put the player back where the game starts */
export function resetPlayerToSpawn(sim) {
  const s = spawnPoint(sim);
  return teleportPlayer(sim, s.x, s.y);
}

/**
 * A new Sim on the same map and data (a restart). Not a write to the old one, but listed here because it
 * replaces the running game.
 * @param {Sim} sim
 * @param {number|string} seed
 * @returns {Sim}
 */
export function freshSim(sim, seed = sim.seed) {
  return new Sim({ map: sim.map, tuning: sim.tuning, data: sim.data, seed });
}

/**
 * The running game rebuilt from a snapshot, on the same map and data.
 * @param {Sim} sim
 * @param {object} snapshot
 * @returns {Sim}
 */
export function restoreSim(sim, snapshot) {
  return Sim.restore(snapshot, { map: sim.map, tuning: sim.tuning, data: sim.data });
}

/** the next seed for "reseed and restart": numbers count up, text seeds get a numeric suffix */
export function nextSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed + 1;
  const m = /^(.*?)(\d+)$/.exec(String(seed));
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${seed}2`;
}

// ---- world clocks (step 2.4): every debug write to sim.world goes through these -----------------------------

/** set the tide to a phase of its cycle: 0 low water, 0.25 mid (rising), 0.5 high water */
export function setTidePhase(sim, phase) {
  sim.world.setTidePhase(phase);
  return sim.world.tidePhase;
}

/** move the tide clock on by a fraction of a cycle */
export function advanceTide(sim, fraction) {
  sim.world.setTidePhase(sim.world.tidePhase + fraction);
  return sim.world.tidePhase;
}

/** toggle (or set) the debug fast tide; returns whether it is on */
export function toggleFastTide(sim, on = !sim.world.fastTide) {
  sim.world.setFastTide(on);
  return sim.world.fastTide;
}

/** set the time of day in hours */
export function setTimeOfDay(sim, hour) {
  sim.world.setTimeOfDay(hour);
  return sim.world.timeOfDay;
}

/** start a squall now; instant: at full strength at once */
export function startSquall(sim, { instant = false } = {}) {
  sim.world.startSquall({ instant });
}

/** clear the sky now */
export function clearWeather(sim) {
  sim.world.clearWeather();
}

// ---- the player's body (steps 3.1 to 3.3): every debug write to stamina, hydration and health ----------------

/** set stamina (clamped to 0..the current cap); returns the value set */
export function setStamina(sim, value) {
  const p = sim.player;
  p.stamina = Math.max(0, Math.min(p.staminaCap, value));
  return p.stamina;
}

/** set hydration (clamped to 0..max); the stamina cap follows at once */
export function setHydration(sim, value) {
  const p = sim.player;
  p.hydration = Math.max(0, Math.min(sim.tuning.hydration.max, value));
  p.staminaCap = p.capFor(p.hydration);
  if (p.stamina > p.staminaCap) p.stamina = p.staminaCap;
  return p.hydration;
}

/** set health: up through heal, down through damage (0 kills, cause 'debug') */
export function setHealth(sim, value) {
  const p = sim.player;
  const v = Math.max(0, Math.min(sim.tuning.health.max, value));
  if (v > p.health) p.heal(v - p.health);
  else if (v < p.health) p.damage(p.health - v, 'debug');
  return p.health;
}

/** an arrow hit, as M4's scouts will deal it */
export function arrowHit(sim) {
  return sim.player.applyArrowHit();
}

/** kill the player now */
export function killPlayer(sim) {
  return sim.player.damage(sim.player.health, 'debug');
}

/** toggle (or set) "no needs": hydration and stamina stop draining; returns whether it is on */
export function toggleNoNeeds(sim, on = !sim.player.noNeeds) {
  sim.player.noNeeds = !!on;
  return sim.player.noNeeds;
}

/**
 * Move the calendar to the day whose moon at the current hour is nearest to a phase (0 new, 0.5 full), so the
 * night's moonlight can be seen. Searches one moon cycle from day 1.
 * @param {number} phase 0..1
 * @returns {number} the day chosen
 */
export function setMoon(sim, phase) {
  const w = sim.world;
  let best = w.day;
  let bestD = Infinity;
  const cycle = Math.ceil(sim.tuning.world.day.moonCycleDays) + 1;
  for (let d = 1; d <= cycle; d++) {
    w.setDay(d);
    const diff = Math.abs(w.moonPhase - phase);
    const dist = Math.min(diff, 1 - diff);
    if (dist < bestD) { bestD = dist; best = d; }
  }
  w.setDay(best);
  return best;
}

/** wind to full strength for the longest gust */
export function maxWind(sim) {
  sim.world.setGust(1);
}

/**
 * Switch the player's flashlight through the inventory, which owns `player.lightOn` (a flashlight is given first
 * when none is carried).
 * @returns {boolean} whether the light is on now
 */
export function toggleFlashlight(sim) {
  if (sim.inventory.slotOf('flashlight') < 0) sim.inventory.add('flashlight', 1);
  toggleLight(sim);
  syncLight(sim);
  return sim.player.lightOn;
}

// ---- Resonance (step 3.6): every debug write to sim.resonance goes through these ------------------------------

/** put Resonance at a value now (it then follows its sources as usual) */
export function setResonance(sim, value) {
  sim.resonance.setValue(value);
  return sim.resonance.value;
}

/** pin Resonance at a value for some seconds (the scripted hook the Signal Peak climax will use) */
export function forceResonance(sim, value, seconds) {
  sim.resonance.force(value, seconds);
  return sim.resonance.value;
}

// ---- fog of war (step 3.7): every debug write to sim.fog goes through these ----------------------------------

/** explore the whole island and discover every landmark */
export function revealMap(sim) {
  sim.fog?.revealAll();
  return sim.fog?.exploredFraction ?? 0;
}

/** forget the whole island (discovered landmarks keep their names) */
export function forgetMap(sim) {
  sim.fog?.forgetAll();
  return sim.fog?.exploredFraction ?? 0;
}

/** Shifting Paths on regardless of Resonance (still only in deep jungle and anomaly ground), or back off */
export function toggleShiftingPaths(sim, on = !sim.fog?.forced) {
  if (!sim.fog) return false;
  sim.fog.forced = !!on;
  return sim.fog.forced;
}

// ---- items (step 3.4): every debug write to the inventory and the pickups goes through these ----------------

/**
 * Put items in the inventory as far as there is room.
 * @returns {number} how many went in
 */
export function giveItem(sim, id, n = 1) {
  return sim.inventory.add(id, n);
}

/** empty every slot */
export function clearInventory(sim) {
  sim.inventory.clear();
}

/** fill every free slot with full stacks of ordinary items (to try an overflow) */
export function fillInventory(sim, id = 'bone') {
  const stack = sim.catalog.stackOf(id);
  let n = 0;
  const free = sim.inventory.slots.filter((s) => s === null).length;
  for (let i = 0; i < free; i++) n += sim.inventory.add(id, stack);
  return n;
}

/** place a pickup at the player's feet */
export function spawnPickup(sim, id = 'rock', n = 1) {
  return sim.pickups.drop(id, n, sim.player.x, sim.player.y);
}

// ---- the Sentinelese (steps 4.1 to 4.3): every debug write to the scouts goes through these ------------------

/** a scout standing guard at a world point, facing the player; returns it */
export function spawnScout(sim, x, y) {
  const p = sim.player;
  return sim.scouts.spawnPost({ x, y, dirX: p.x - x, dirY: p.y - y || 1 });
}

/** freeze or unfreeze every scout (they keep their state; arrows in the air still land) */
export function setAiFrozen(sim, on = !sim.scouts.cheats.frozen) {
  sim.scouts.cheats.frozen = on;
  return on;
}

/** the scouts cannot see the player */
export function setInvisiblePlayer(sim, on = !sim.scouts.cheats.invisible) {
  sim.scouts.cheats.invisible = on;
  return on;
}

/** the scouts hear nothing */
export function setDeafScouts(sim, on = !sim.scouts.cheats.deaf) {
  sim.scouts.cheats.deaf = on;
  return on;
}

/** put the scout nearest to the player into a state ('patrol', 'investigate', 'search', 'warn', 'chase') */
export function forceScoutState(sim, state) {
  const s = sim.scouts.nearestTo(sim.player.x, sim.player.y);
  if (s) sim.scouts.force(sim, s, state);
  return s?.id ?? null;
}

/**
 * Move the scout nearest to the player next to them (`dist` px south, or the nearest free spot), facing them; it
 * walks back to its route from there. Returns its id.
 */
export function teleportNearestScout(sim, dist = 110) {
  const p = sim.player;
  const s = sim.scouts.nearestTo(p.x, p.y);
  if (!s) return null;
  const at = { x: p.x, y: p.y + dist };
  if (sim.collider && !sim.collider.isPositionFree(at.x, at.y, s.radius)) sim.collider.nearestFreePosition(p.x, p.y + dist, s.radius, 200, at);
  s.x = s.prevX = at.x;
  s.y = s.prevY = at.y;
  sim.scouts.force(sim, s, 'patrol');
  const dx = p.x - s.x;
  const dy = p.y - s.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  s.dirX = s.baseX = dx / d;
  s.dirY = s.baseY = dy / d;
  return s.id;
}

// ---- story and dialogue (step 4.5) ---------------------------------------------------------------------------

/** set (on) or clear a story flag; returns whether it is now set */
export function setStoryFlag(sim, name, on = !sim.story.flags.has(name)) {
  if (on) sim.story.flags.add(name);
  else sim.story.flags.delete(name);
  return sim.story.flags.has(name);
}

/**
 * Pretend the player inspected a Fallen Outsider site (what the interaction step's `site_inspected` event
 * records). The fact goes straight into the story, since events pushed between steps are cleared.
 * @returns {string|null} the site recorded
 */
export function fakeSiteInspected(sim, id) {
  const site = OUTSIDER_SITES.includes(id) ? id : null;
  if (site) sim.story.inspected.add(site);
  return site;
}

/** close the open conversation, if any */
export function endConversation(sim) {
  sim.dialogue.end();
}

/** forget the whole story: flags, counters, visits, sites, recipes, journal, used choices, the conversation */
export function resetStory(sim) {
  sim.dialogue.end();
  const fresh = new Story();
  for (const k of Object.keys(fresh)) sim.story[k] = fresh[k];
}
