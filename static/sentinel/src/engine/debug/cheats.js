// Every write the debug mode makes to simulation state, in one file so it can be audited.
//
// The presentation never writes the simulation except through input: this module is the one sanctioned
// exception, allowed because it only exists under `?debug` (debug mode is not the game). New cheats from
// later steps (give item, set tide, set hour, set Resonance, spawn scout) belong here too; the panel's
// actions call these functions rather than touching `sim` themselves.
import { Sim } from '../../sim/Sim.js';
import { toggleLight, syncLight } from '../../entities/ItemUse.js';

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
