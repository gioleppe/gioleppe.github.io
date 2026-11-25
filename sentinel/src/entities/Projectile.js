// Things in flight (step 3.5, spec §3.2 and §6.1): a thrown rock or coconut now, warning and lethal arrows in M4.
// A projectile moves on the ground plane in a straight line from (x0, y0) to (x1, y1) at a constant speed; its
// height is a fake parabola used only for drawing. The landing point is fixed at launch by `planFlight`: flight is
// blocked by line of sight (Collider.segmentBlocked: walls, trunks, boulders), so it lands in front of the
// obstacle, on the nearest free spot, never inside a blocker. On arrival the handler registered for its `kind`
// runs (`registerImpact`).
//
// Throwing (`throwHeld`): the held throwable flies to the aim point (clamped to tuning.throw.maxRange), or without
// one tuning.throw.defaultDistance in the facing direction. On impact: noise of radius tuning.noise.throwImpact
// (220 px; tuning.throw.impactNoise until the noise block exists) through `sim.noise?.emit` and a `noise` event,
// an `impact` event, and a rock becomes a pickup where it landed unless it fell in swimming-depth water (lost).
// A coconut is used up. Throwing keeps the player's crouch: throwing from cover is the point of a distraction.
// A key item is never thrown (ItemCatalog.canThrow).
//
// Events: throw {id, item, x0, y0, x1, y1, aimX, aimY, blocked}, throw_refused {reason, item},
//         impact {id, kind, item, x, y, water, lost, consumed}, noise {x, y, radius, kind: 'impact', sourceId}

import { TICK_HZ } from '../sim/constants.js';
import { terrainMove } from '../world/collision.js';

export class Projectile {
  /**
   * @param {Object} o
   * @param {string} o.id
   * @param {string} o.kind      impact handler ('throw'; M4: 'warning_arrow', 'arrow')
   * @param {string|null} [o.item] item carried (a thrown item)
   * @param {number} o.x0        launch point, world px
   * @param {number} o.y0
   * @param {number} o.x1        landing point (already clamped by planFlight)
   * @param {number} o.y1
   * @param {number} [o.aimX]    where it was aimed (debug drawing)
   * @param {number} [o.aimY]
   * @param {number} o.ticks     flight time in ticks (>= 1)
   * @param {number} [o.arc]     peak height of the drawn arc in px
   * @param {string} [o.ownerId]
   * @param {number} [o.t]       ticks flown so far
   */
  constructor({ id, kind, item = null, x0, y0, x1, y1, aimX = x1, aimY = y1, ticks, arc = 0, ownerId = 'player', t = 0 }) {
    Object.assign(this, { id, kind, item, x0, y0, x1, y1, aimX, aimY, ticks: Math.max(1, ticks), arc, ownerId, t });
    this.x = 0;
    this.y = 0;
    this.prevX = 0;
    this.prevY = 0;
    this.place();
    this.prevX = this.x;
    this.prevY = this.y;
  }

  /** set x, y from t */
  place() {
    const f = this.t / this.ticks;
    this.x = this.x0 + (this.x1 - this.x0) * f;
    this.y = this.y0 + (this.y1 - this.y0) * f;
  }

  /** @returns {boolean} it has arrived */
  get landed() {
    return this.t >= this.ticks;
  }

  /**
   * Height above the ground at a fraction of the flight, for drawing only.
   * @param {number} [f] 0..1, default now
   */
  heightAt(f = this.t / this.ticks) {
    return 4 * this.arc * f * (1 - f);
  }

  /** advance one tick; @returns {boolean} it arrived this tick */
  step() {
    this.prevX = this.x;
    this.prevY = this.y;
    if (this.t < this.ticks) this.t += 1;
    this.place();
    return this.t >= this.ticks;
  }

  snapshot() {
    const { id, kind, item, x0, y0, x1, y1, aimX, aimY, ticks, arc, ownerId, t } = this;
    return { id, kind, item, x0, y0, x1, y1, aimX, aimY, ticks, arc, ownerId, t };
  }

  static restore(s) {
    const p = new Projectile(s);
    // prev as it was after the last step (positions are a pure function of t)
    if (p.t > 0) {
      const f = (p.t - 1) / p.ticks;
      p.prevX = p.x0 + (p.x1 - p.x0) * f;
      p.prevY = p.y0 + (p.y1 - p.y0) * f;
    }
    return p;
  }
}

/** @type {Map<string, (sim: Object, p: Projectile) => void>} */
const IMPACTS = new Map();

/**
 * What happens when a projectile of a kind arrives (M4 registers its arrows here).
 * @param {string} kind
 * @param {(sim: Object, p: Projectile) => void} handler
 */
export function registerImpact(kind, handler) {
  if (typeof handler !== 'function') throw new TypeError(`registerImpact ${kind}: a handler function is required`);
  IMPACTS.set(kind, handler);
}

/** everything in flight, and the throw cooldown */
export class Projectiles {
  constructor() {
    /** @type {Projectile[]} in launch order */
    this.list = [];
    /** counter for projectile ids */
    this.seq = 0;
    /** ticks until the player may throw again */
    this.cooldown = 0;
  }

  /**
   * Launch one. Speed and arc come from the caller (tuning); the flight time follows from the distance.
   * @param {Omit<ConstructorParameters<typeof Projectile>[0], 'id'|'ticks'> & { speed: number }} o speed in px/s
   * @returns {Projectile}
   */
  spawn(o) {
    this.seq += 1;
    const dx = o.x1 - o.x0;
    const dy = o.y1 - o.y0;
    const ticks = Math.max(1, Math.ceil((Math.sqrt(dx * dx + dy * dy) / o.speed) * TICK_HZ));
    const p = new Projectile({ ...o, id: `proj_${this.seq}`, ticks });
    this.list.push(p);
    return p;
  }

  /** one tick: move everything; arrivals run their impact handler and leave the list */
  update(sim) {
    if (this.cooldown > 0) this.cooldown -= 1;
    if (!this.list.length) return;
    const arrived = [];
    for (const p of this.list) if (p.step()) arrived.push(p);
    if (!arrived.length) return;
    this.list = this.list.filter((p) => !p.landed);
    for (const p of arrived) IMPACTS.get(p.kind)?.(sim, p);
  }

  snapshot() {
    return { seq: this.seq, cooldown: this.cooldown, list: this.list.map((p) => p.snapshot()) };
  }

  static restore(s) {
    const ps = new Projectiles();
    ps.seq = s.seq;
    ps.cooldown = s.cooldown;
    ps.list = s.list.map((p) => Projectile.restore(p));
    return ps;
  }
}

// ---- flight planning ------------------------------------------------------------------------------------------

const propScratch = [];

/** is (x, y) inside a prop that stops sight (a trunk, a boulder)? */
function insideSightBlocker(collider, x, y) {
  const map = collider.map;
  const props = map.propsNear(x, y, map.maxPropReach, propScratch);
  for (const p of props) {
    if (!(p.radius > 0) || !collider.propBlocksSight(p)) continue;
    const dx = p.x - x;
    const dy = p.y - y;
    if (dx * dx + dy * dy < p.radius * p.radius) return true;
  }
  return false;
}

/**
 * Where something thrown from (x0, y0) towards (tx, ty) comes down: clamped to `maxRange`, stopped in front of
 * the first thing that blocks line of sight, then moved to the nearest free spot for a body of `radius` (never
 * inside a blocker, never past the obstacle). Pure: the presentation uses it for the aim marker too.
 * @param {{ collider: Object|null }} sim
 * @param {{ maxRange: number, radius: number, marchStep: number, backoff: number, landSearch: number }} cfg tuning.throw
 * @returns {{ x: number, y: number, blocked: boolean, clamped: boolean, aimX: number, aimY: number }}
 */
export function planFlight(sim, x0, y0, tx, ty, cfg) {
  let dx = tx - x0;
  let dy = ty - y0;
  let d = Math.sqrt(dx * dx + dy * dy);
  let clamped = false;
  if (d > cfg.maxRange) {
    dx *= cfg.maxRange / d;
    dy *= cfg.maxRange / d;
    d = cfg.maxRange;
    clamped = true;
  }
  const out = { x: x0 + dx, y: y0 + dy, blocked: false, clamped, aimX: tx, aimY: ty };
  const c = sim.collider;
  if (!c || !(d > 0)) return out;
  const clear = (x, y) => !c.segmentBlocked(x0, y0, x, y) && !insideSightBlocker(c, x, y);
  const ux = dx / d;
  const uy = dy / d;
  let reach = d;
  if (!clear(out.x, out.y)) {
    out.blocked = true;
    // march to the first blocked sample, then bisect between it and the last clear one
    const n = Math.max(1, Math.ceil(d / cfg.marchStep));
    let lo = 0;
    let hi = d;
    for (let i = 1; i <= n; i++) {
      const s = (d * i) / n;
      if (!clear(x0 + ux * s, y0 + uy * s)) { hi = s; break; }
      lo = s;
    }
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2;
      if (clear(x0 + ux * mid, y0 + uy * mid)) lo = mid; else hi = mid;
    }
    reach = lo;
  }
  // a free landing spot, stepping back towards the thrower until one is found (the thrower's own spot is free)
  const spot = { x: 0, y: 0 };
  const back = out.blocked ? cfg.backoff : 0;
  for (let s = reach - back; ; s -= cfg.backoff) {
    const k = s > 0 ? s : 0;
    const bx = x0 + ux * k;
    const by = y0 + uy * k;
    if (c.isPositionFree(bx, by, cfg.radius) && clear(bx, by)) { out.x = bx; out.y = by; return out; }
    if (c.nearestFreePosition(bx, by, cfg.radius, cfg.landSearch, spot) && clear(spot.x, spot.y)) { out.x = spot.x; out.y = spot.y; return out; }
    if (k === 0) break;
  }
  out.x = x0;
  out.y = y0;
  return out;
}

// ---- throwing -------------------------------------------------------------------------------------------------

/**
 * Does this `useItem` throw the item in hand? A rock always does; a coconut (used to drink) only when aimed at
 * least tuning.throw.minAimDistance away from the player.
 */
export function wantsThrow(sim, inp) {
  const id = sim.inventory.heldId;
  const def = id ? sim.catalog.get(id) : null;
  if (!def || def.throwable !== true) return false;
  if (def.use.type === 'throw') return true;
  if (inp.aimX === null || inp.aimY === null) return false;
  const dx = inp.aimX - sim.player.x;
  const dy = inp.aimY - sim.player.y;
  const m = sim.tuning.throw.minAimDistance;
  return dx * dx + dy * dy >= m * m;
}

/** the noise radius of an impact: the noise system's tuning when present (spec §6.1: 220 px) */
export function impactNoiseRadius(tuning) {
  return tuning.noise?.throwImpact ?? tuning.throw.impactNoise;
}

/**
 * Throw the item in hand towards the aim point (or straight ahead).
 * @param {import('../sim/Sim.js').Sim} sim
 * @param {import('../sim/input.js').InputState} inp
 * @returns {Projectile|null}
 */
export function throwHeld(sim, inp) {
  const inv = sim.inventory;
  const id = inv.heldId;
  const cfg = sim.tuning.throw;
  if (!id || !sim.catalog.canThrow(id)) {
    sim.events.push({ type: 'throw_refused', reason: 'not_throwable', item: id });
    return null;
  }
  if (sim.projectiles.cooldown > 0) {
    sim.events.push({ type: 'throw_refused', reason: 'cooldown', item: id });
    return null;
  }
  const p = sim.player;
  let tx;
  let ty;
  if (inp.aimX !== null && inp.aimY !== null && (inp.aimX !== p.x || inp.aimY !== p.y)) {
    tx = inp.aimX;
    ty = inp.aimY;
  } else {
    tx = p.x + p.dirX * cfg.defaultDistance;
    ty = p.y + p.dirY * cfg.defaultDistance;
  }
  const plan = planFlight(sim, p.x, p.y, tx, ty, cfg);
  inv.removeOneFromSlot(inv.selected);
  const dx = plan.x - p.x;
  const dy = plan.y - p.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const pr = sim.projectiles.spawn({
    kind: 'throw', item: id, x0: p.x, y0: p.y, x1: plan.x, y1: plan.y, aimX: plan.aimX, aimY: plan.aimY,
    speed: cfg.speed, arc: Math.min(cfg.maxArcHeight, dist * cfg.arcHeight), ownerId: 'player',
  });
  sim.projectiles.cooldown = Math.max(1, Math.round(cfg.cooldownSeconds * TICK_HZ));
  sim.events.push({ type: 'throw', id: pr.id, item: id, x0: p.x, y0: p.y, x1: plan.x, y1: plan.y, aimX: plan.aimX, aimY: plan.aimY, blocked: plan.blocked });
  return pr;
}

const probe = { terrain: '', mode: 'ground', speed: 1 };

registerImpact('throw', (sim, p) => {
  const water = sim.map ? terrainMove(sim.map, p.x1, p.y1, sim.tideHeight(), sim.terrainRules, probe).mode : 'ground';
  const lost = water === 'swim';
  const consumed = sim.catalog.get(p.item)?.consumable === true;
  if (!lost && !consumed) sim.pickups.drop(p.item, 1, p.x1, p.y1);
  const radius = impactNoiseRadius(sim.tuning);
  const noise = { x: p.x1, y: p.y1, radius, kind: 'impact', sourceId: p.id };
  if (sim.noise && typeof sim.noise.emit === 'function') sim.noise.emit({ ...noise });
  sim.events.push({ type: 'noise', ...noise });
  sim.events.push({ type: 'impact', id: p.id, kind: p.kind, item: p.item, x: p.x1, y: p.y1, water: water !== 'ground', lost, consumed });
});
