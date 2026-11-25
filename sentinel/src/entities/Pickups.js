// Items lying in the world: the map's `loot` entities (on the ground, or inside a container site) and whatever
// the player drops or throws. Built from the map at Sim creation; the snapshot stores only the deltas from the
// map (which map loot is gone, and the items placed since), never the map itself.
//
// A pickup persists forever. One on a tile the tide floods is simply out of reach until the water falls (the
// `pickup` interaction refuses it while its spot is swimming depth); nothing in the world deletes a pickup but
// the player taking it.

import { SpatialHash } from './SpatialHash.js';

/**
 * @typedef {Object} Pickup
 * @property {string} id      the map loot id, or `drop_<n>` for one placed during play
 * @property {string} item    item id
 * @property {number} n       count (map loot is always 1)
 * @property {number} x       world px
 * @property {number} y
 * @property {'pickup'} action
 * @property {'map'|'drop'} source
 */

export class Pickups {
  /**
   * @param {import('../world/IslandMap.js').IslandMap|null} map
   * @param {import('./ItemCatalog.js').ItemCatalog} catalog loot naming an unknown item is left out (the
   *   validator reports it)
   * @param {{ gridCell: number }} cfg tuning.interaction
   */
  constructor(map, catalog, cfg) {
    this.catalog = catalog;
    this.grid = new SpatialHash(cfg.gridCell);
    /** @type {Map<string, Pickup>} every pickup on the ground, by id */
    this.ground = new Map();
    /** @type {Map<string, Array<{ id: string, item: string, n: number }>>} contents of each container, in map order */
    this.containers = new Map();
    /** @type {Set<string>} map loot taken out of the world (from the ground or from a container) */
    this.taken = new Set();
    /** counter for the ids of placed pickups */
    this.seq = 0;
    if (map) {
      for (const e of map.entitiesOfType('loot')) {
        if (!catalog.has(e.item)) continue;
        if (e.container) {
          let list = this.containers.get(e.container);
          if (!list) this.containers.set(e.container, (list = []));
          list.push({ id: e.id, item: e.item, n: 1 });
        } else {
          this.place({ id: e.id, item: e.item, n: 1, x: e.x, y: e.y, action: 'pickup', source: 'map' });
        }
      }
    }
  }

  place(p) {
    this.ground.set(p.id, p);
    this.grid.insert(p);
    return p;
  }

  /** @returns {Pickup|null} */
  get(id) {
    return this.ground.get(id) ?? null;
  }

  /** ground pickups within `r` of a point */
  near(x, y, r, out = []) {
    return this.grid.near(x, y, r, out);
  }

  inRect(x0, y0, x1, y1, out = []) {
    return this.grid.inRect(x0, y0, x1, y1, out);
  }

  /**
   * Take up to `n` from a ground pickup; it disappears when emptied.
   * @returns {number} how many were taken
   */
  take(id, n) {
    const p = this.ground.get(id);
    if (!p || !(n > 0)) return 0;
    const k = Math.min(n, p.n);
    p.n -= k;
    if (p.n === 0) {
      this.ground.delete(id);
      this.grid.remove(p);
      if (p.source === 'map') this.taken.add(id);
    }
    return k;
  }

  /**
   * Place items in the world (dropped, thrown, spawned by a later step).
   * @returns {Pickup}
   */
  drop(item, n, x, y) {
    this.seq += 1;
    return this.place({ id: `drop_${this.seq}`, item, n, x, y, action: 'pickup', source: 'drop' });
  }

  /** @returns {Array<{ id: string, item: string, n: number }>} what is still inside a container (live list) */
  contents(containerId) {
    return this.containers.get(containerId) ?? [];
  }

  /** is `id` a container (it held map loot at the start)? */
  isContainer(id) {
    return this.containers.has(id);
  }

  /** take one entry out of a container */
  takeFromContainer(containerId, lootId) {
    const list = this.containers.get(containerId);
    const i = list ? list.findIndex((e) => e.id === lootId) : -1;
    if (i < 0) return false;
    list.splice(i, 1);
    this.taken.add(lootId);
    return true;
  }

  // ---- state ------------------------------------------------------------------------------------------------

  /** deltas from the map: map loot taken, and every placed pickup (by id order, so the snapshot is canonical) */
  snapshot() {
    const placed = [...this.ground.values()].filter((p) => p.source === 'drop').sort((a, b) => (a.id < b.id ? -1 : 1));
    return {
      taken: [...this.taken].sort(),
      placed: placed.map((p) => ({ id: p.id, item: p.item, n: p.n, x: p.x, y: p.y })),
      seq: this.seq,
    };
  }

  /**
   * @param {ReturnType<Pickups['snapshot']>} snap
   * @param {ConstructorParameters<typeof Pickups>} args the map, catalog and cfg the Sim builds with
   */
  static restore(snap, ...args) {
    const p = new Pickups(...args);
    for (const id of snap.taken) {
      p.taken.add(id);
      const g = p.ground.get(id);
      if (g) { p.ground.delete(id); p.grid.remove(g); }
      for (const list of p.containers.values()) {
        const i = list.findIndex((e) => e.id === id);
        if (i >= 0) list.splice(i, 1);
      }
    }
    for (const d of snap.placed) p.place({ ...d, action: 'pickup', source: 'drop' });
    p.seq = snap.seq;
    return p;
  }
}
