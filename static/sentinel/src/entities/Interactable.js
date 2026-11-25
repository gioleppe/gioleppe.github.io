// Things the player can interact with (spec §3.2 context action, §6.4): a registry built from the map's
// entities, a bucketed spatial lookup (no per-tick scan of the whole island), and the interaction rules.
//
// ---- Registering behaviour (later steps) -------------------------------------------------------------------
// Every interactable has an `action`. What an action does is one handler, registered once at module load:
//
//   import { registerInteraction } from '../entities/Interactable.js';
//   registerInteraction('hatch', {
//     icon: 'hand',                                   // or (sim, target) => 'hand'|'eye'|'speech'|'offering'
//     canInteract: (sim, target) => true,             // optional; false hides it from targeting
//     interact: (sim, target) => { ... },             // change state, push events to sim.events
//     channelTick: (sim, target) => done,             // optional, for actions that last (see `spring`)
//   });
//
// A handler replaces the stub for its action. Until one is registered, `dinghy`, `hatch`, `signal_point`,
// `totem` and `talk` are stubs: targetable with the right icon, and interacting emits
// `{ type: 'interact', id, action, stub: true }` ("nothing happens yet").
//
// Actions and where they come from:
//   pickup        a ground item (Pickups.js)                          icon hand
//   container     a landmark that map loot names as its `container`  icon eye until inspected, then hand
//   spring        `spring` entity: drink to full over a short channel icon hand
//   totem         `totem` entity (offering, step 4.4)                 icon offering
//   talk          `npc` marek (dialogue, step 4.5)                    icon speech
//   <action>      `interactable` entities: dinghy, hatch, signal_point, ... (steps 4.7, 5.3, 5.4)
// Helpers for handlers: `lootContainer(sim, id)` (gives a container's contents as space allows) and
// `inspectSite(sim, id)` (sets the `inspected` flag once and emits `site_inspected`).
//
// Events: item_picked {id, item, n, from}, inventory_full {id, item}, site_inspected {id, landmark},
//         container_empty {id}, channel_start {id, action}, channel_end {id, action, reason}, interact {id, action, stub}
//
// Targeting: each tick the Sim keeps `sim.interactTarget`, the nearest interactable whose interaction radius
// contains the player and that can be used now; ties are broken by id. An `interact` input with an aim point
// (a click or a tap on the world) takes the in-range interactable nearest to the aim point within
// tuning.interaction.aimPickRadius instead, and does nothing when there is none.

import { DT, TICK_HZ } from '../sim/constants.js';
import { terrainMove } from '../world/collision.js';
import { SpatialHash } from './SpatialHash.js';

/** context icon per action (spec §3.2: hand loot, eye inspect, speech talk, offering totem) */
export const ACTION_ICONS = Object.freeze({
  pickup: 'hand', container: 'eye', spring: 'hand', totem: 'offering', talk: 'speech',
  dinghy: 'hand', hatch: 'hand', signal_point: 'hand',
});

/** @type {Map<string, Object>} */
const HANDLERS = new Map();

/**
 * Give an action its behaviour (replaces the stub or an earlier handler).
 * @param {string} action
 * @param {{ icon?: string|((sim:Object, target:Object) => string), canInteract?: (sim:Object, target:Object) => boolean,
 *   interact: (sim:Object, target:Object) => void, channelTick?: (sim:Object, target:Object) => boolean }} handler
 */
export function registerInteraction(action, handler) {
  if (typeof action !== 'string' || !action) throw new TypeError('registerInteraction: action must be a string');
  if (!handler || typeof handler.interact !== 'function') throw new TypeError(`registerInteraction ${action}: interact(sim, target) is required`);
  HANDLERS.set(action, handler);
}

/** the stub every unregistered action gets */
const STUB = Object.freeze({
  interact(sim, t) {
    sim.events.push({ type: 'interact', id: t.id, action: t.action, stub: true });
  },
});

/** @returns {Object} the handler of an action (the stub when none is registered) */
export function handlerFor(action) {
  return HANDLERS.get(action) ?? STUB;
}

/** @returns {string} context icon for a target */
export function iconOf(sim, target) {
  const h = handlerFor(target.action);
  const icon = typeof h.icon === 'function' ? h.icon(sim, target) : h.icon;
  return icon ?? ACTION_ICONS[target.action] ?? 'hand';
}

/** @returns {boolean} the target can be used now */
export function canInteractWith(sim, target) {
  const h = handlerFor(target.action);
  return h.canInteract ? !!h.canInteract(sim, target) : true;
}

/** one thing in the world the player can interact with */
export class Interactable {
  /**
   * @param {{ id: string, action: string, x: number, y: number, radius: number, landmark?: string|null, source?: string }} o
   */
  constructor({ id, action, x, y, radius, landmark = null, source = 'map' }) {
    this.id = id;
    this.action = action;
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.landmark = landmark;
    /** 'map' for one built from the map; anything else was added by a later step */
    this.source = source;
  }

  canInteract(sim) { return canInteractWith(sim, this); }

  interact(sim) { handlerFor(this.action).interact(sim, this); }

  icon(sim) { return iconOf(sim, this); }
}

export class Interactables {
  /**
   * @param {import('../world/IslandMap.js').IslandMap|null} map
   * @param {Object} cfg tuning.interaction
   */
  constructor(map, cfg) {
    this.cfg = cfg;
    this.grid = new SpatialHash(cfg.gridCell);
    /** @type {Map<string, Interactable>} */
    this.byId = new Map();
    /** largest interaction radius, to size the neighbourhood query */
    this.maxRadius = 0;
    /** @type {Map<string, Object>} per-id state flags (inspected, ...), only for ids that have any */
    this.flags = new Map();
    /** @type {{ id: string, action: string, ticksLeft: number }|null} an interaction that lasts (drinking) */
    this.channel = null;
    this.scratch = [];
    this.scratchPickups = [];
    this.probe = { terrain: '', mode: 'ground', speed: 1 };
    if (map) this.buildFromMap(map);
  }

  radiusFor(action) {
    const r = this.cfg.radius;
    return r[action] ?? r.default;
  }

  buildFromMap(map) {
    const add = (e, action) => this.add(new Interactable({ id: e.id, action, x: e.x, y: e.y, radius: this.radiusFor(action), landmark: e.landmark ?? null }));
    const containerIds = new Set(map.entitiesOfType('loot').map((l) => l.container).filter(Boolean));
    for (const e of map.entitiesOfType('landmark')) if (containerIds.has(e.id)) add(e, 'container');
    for (const e of map.entitiesOfType('interactable')) add(e, e.action);
    for (const e of map.entitiesOfType('spring')) add(e, 'spring');
    for (const e of map.entitiesOfType('totem')) add(e, 'totem');
    for (const e of map.entitiesOfType('npc')) if (e.npc === 'marek') add(e, 'talk');
  }

  /** register one more interactable (later steps: a placed offering, a moving NPC) */
  add(it) {
    if (this.byId.has(it.id)) throw new Error(`Interactables: duplicate id ${it.id}`);
    this.byId.set(it.id, it);
    this.grid.insert(it);
    if (it.radius > this.maxRadius) this.maxRadius = it.radius;
    return it;
  }

  remove(id) {
    const it = this.byId.get(id);
    if (!it) return false;
    this.byId.delete(id);
    this.grid.remove(it);
    return true;
  }

  /** move one (an NPC that walks) */
  move(id, x, y) {
    const it = this.byId.get(id);
    if (it) this.grid.move(it, x, y);
  }

  /** @returns {Interactable|null} */
  get(id) {
    return this.byId.get(id) ?? null;
  }

  near(x, y, r, out = []) {
    return this.grid.near(x, y, r, out);
  }

  /** a state flag of an interactable (undefined when unset) */
  flag(id, key) {
    return this.flags.get(id)?.[key];
  }

  setFlag(id, key, value) {
    let f = this.flags.get(id);
    if (!f) this.flags.set(id, (f = {}));
    f[key] = value;
  }

  snapshot() {
    const flags = {};
    for (const id of [...this.flags.keys()].sort()) flags[id] = { ...this.flags.get(id) };
    return { flags, channel: this.channel ? { ...this.channel } : null };
  }

  /** @param {ReturnType<Interactables['snapshot']>} snap */
  restoreState(snap) {
    this.flags = new Map(Object.entries(snap.flags ?? {}).map(([id, f]) => [id, { ...f }]));
    this.channel = snap.channel ? { ...snap.channel } : null;
  }
}

// ---- targeting --------------------------------------------------------------------------------------------

/** a candidate is better than the best so far: nearer, or as near with a smaller id */
const better = (d2, id, bestD2, bestId) => d2 < bestD2 || (d2 === bestD2 && id < bestId);

/**
 * The interactable the player would use: in range (its radius contains the player), usable now, nearest to the
 * player (or, with an aim point, nearest to the aim point within aimPickRadius); ties by id.
 * @param {import('../sim/Sim.js').Sim} sim
 * @param {{x:number,y:number}|null} [aim]
 * @returns {Object|null} an Interactable or a pickup
 */
export function findTarget(sim, aim = null) {
  const reg = sim.interactables;
  if (!reg) return null;
  const p = sim.player;
  const cfg = reg.cfg;
  const pickR = reg.radiusFor('pickup');
  const lists = [reg.near(p.x, p.y, Math.max(reg.maxRadius, pickR), reg.scratch), sim.pickups ? sim.pickups.near(p.x, p.y, pickR, reg.scratchPickups) : []];
  const aimR2 = cfg.aimPickRadius * cfg.aimPickRadius;
  let best = null;
  let bestD2 = Infinity;
  let bestId = '';
  for (const list of lists) {
    for (const t of list) {
      const dx = t.x - p.x;
      const dy = t.y - p.y;
      const d2p = dx * dx + dy * dy;
      const r = t.radius ?? pickR;
      if (d2p > r * r) continue;
      let d2 = d2p;
      if (aim) {
        const ax = t.x - aim.x;
        const ay = t.y - aim.y;
        d2 = ax * ax + ay * ay;
        if (d2 > aimR2) continue;
      }
      if (!better(d2, t.id, bestD2, bestId)) continue;
      if (!canInteractWith(sim, t)) continue;
      best = t;
      bestD2 = d2;
      bestId = t.id;
    }
  }
  return best;
}

/** recompute `sim.interactTarget` and `sim.interactIcon` (derived, never in a snapshot) */
export function refreshTarget(sim) {
  const t = findTarget(sim, null);
  sim.interactTarget = t;
  sim.interactIcon = t ? iconOf(sim, t) : null;
}

/** an interaction target by id: an interactable or a ground pickup */
function targetById(sim, id) {
  return sim.interactables.get(id) ?? sim.pickups?.get(id) ?? null;
}

/**
 * One tick of interaction: a running channel (drinking) goes on or is broken off by moving away or pressing
 * interact again; an `interact` press uses the target.
 * @param {import('../sim/Sim.js').Sim} sim
 * @param {import('../sim/input.js').InputState} inp
 */
export function updateInteraction(sim, inp) {
  const reg = sim.interactables;
  if (!reg) return;
  const ch = reg.channel;
  if (ch) {
    const t = targetById(sim, ch.id);
    const p = sim.player;
    const moved = inp.moveX !== 0 || inp.moveY !== 0;
    const inRange = t && (t.x - p.x) * (t.x - p.x) + (t.y - p.y) * (t.y - p.y) <= t.radius * t.radius;
    let reason = null;
    if (inp.interact) reason = 'cancelled';
    else if (moved || !inRange) reason = 'moved';
    else {
      const done = handlerFor(ch.action).channelTick?.(sim, t) === true;
      ch.ticksLeft -= 1;
      if (done || ch.ticksLeft <= 0) reason = 'done';
    }
    if (reason) endChannel(sim, reason);
    if (inp.interact) return;   // the press that ends a channel does nothing else
  }
  if (!inp.interact) return;
  const aim = inp.aimX !== null && inp.aimY !== null ? { x: inp.aimX, y: inp.aimY } : null;
  const t = findTarget(sim, aim);
  if (t) handlerFor(t.action).interact(sim, t);
}

/**
 * Start a channel on a target (an interaction that lasts `seconds`).
 * @returns {void}
 */
export function startChannel(sim, target, seconds) {
  sim.interactables.channel = { id: target.id, action: target.action, ticksLeft: Math.max(1, Math.round(seconds * TICK_HZ)) };
  sim.events.push({ type: 'channel_start', id: target.id, action: target.action });
}

/**
 * End the running channel, if any, with a reason: 'done' | 'moved' | 'cancelled' | 'dead'.
 * @returns {void}
 */
export function endChannel(sim, reason) {
  const ch = sim.interactables.channel;
  if (!ch) return;
  sim.interactables.channel = null;
  sim.events.push({ type: 'channel_end', id: ch.id, action: ch.action, reason });
}

// ---- helpers for handlers ---------------------------------------------------------------------------------

/**
 * Inspect a site: the first time sets its `inspected` flag and emits `site_inspected` (journal entries and
 * Marek's dialogue hang on it, step 4.6).
 * @returns {boolean} this was the first inspection
 */
export function inspectSite(sim, id) {
  const reg = sim.interactables;
  if (reg.flag(id, 'inspected')) return false;
  reg.setFlag(id, 'inspected', true);
  const it = reg.get(id);
  sim.events.push({ type: 'site_inspected', id, landmark: it?.landmark ?? null });
  return true;
}

/**
 * Give a container's contents, in map order, as far as the inventory has room; the rest stays inside.
 * @returns {number} how many items moved into the inventory
 */
export function lootContainer(sim, id) {
  const list = sim.pickups.contents(id);
  let moved = 0;
  for (const entry of [...list]) {
    const k = sim.inventory.add(entry.item, entry.n);
    if (k < entry.n) {
      // map loot is one item per entry, so nothing is split; a full inventory leaves it inside
      if (k > 0) entry.n -= k;
      sim.events.push({ type: 'inventory_full', id, item: entry.item });
      break;
    }
    sim.pickups.takeFromContainer(id, entry.id);
    sim.events.push({ type: 'item_picked', id: entry.id, item: entry.item, n: entry.n, from: id });
    moved += k;
  }
  return moved;
}

/** can the pickup's spot be reached now? Not while the tide has it at swimming depth. */
function pickupReachable(sim, p) {
  if (!sim.map) return true;
  return terrainMove(sim.map, p.x, p.y, sim.tideHeight(), sim.terrainRules, sim.interactables.probe).mode !== 'swim';
}

// ---- built-in handlers --------------------------------------------------------------------------------------

registerInteraction('pickup', {
  icon: 'hand',
  canInteract: (sim, p) => pickupReachable(sim, p),
  interact(sim, p) {
    const k = sim.inventory.add(p.item, p.n);
    if (k > 0) {
      sim.pickups.take(p.id, k);
      sim.events.push({ type: 'item_picked', id: p.id, item: p.item, n: k, from: 'ground' });
    }
    if (k < p.n) sim.events.push({ type: 'inventory_full', id: p.id, item: p.item });
  },
});

registerInteraction('container', {
  icon: (sim, t) => (sim.interactables.flag(t.id, 'inspected') ? 'hand' : 'eye'),
  canInteract: (sim, t) => !sim.interactables.flag(t.id, 'inspected') || sim.pickups.contents(t.id).length > 0,
  interact(sim, t) {
    inspectSite(sim, t.id);
    if (sim.pickups.contents(t.id).length === 0) {
      sim.events.push({ type: 'container_empty', id: t.id });
      return;
    }
    lootContainer(sim, t.id);
  },
});

registerInteraction('spring', {
  icon: 'hand',
  interact(sim, t) {
    startChannel(sim, t, sim.tuning.interaction.spring.seconds);
  },
  channelTick(sim) {
    const p = sim.player;
    p.drink(sim.tuning.interaction.spring.drinkPerSecond * DT);
    // full (or dead: drink is a no-op then): stop early
    return p.dead || p.hydration >= sim.tuning.hydration.max;
  },
});
