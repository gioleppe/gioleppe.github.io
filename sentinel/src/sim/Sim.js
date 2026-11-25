// The whole game state and the one way it advances: `step(input)`, exactly one tick of DT seconds.
// No browser, no clock, no files: the caller passes the loaded data in, randomness comes only from `rng`.
import { DT, TILE_W, TILE_H } from './constants.js';
import { Rng } from './rng.js';
import { sanitizeInput } from './input.js';
import { Player } from '../entities/Player.js';
import { buildTestField } from '../world/TestField.js';
import { IslandMap } from '../world/IslandMap.js';
import { WorldState } from '../world/WorldState.js';
import { Collider, terrainRules } from '../world/collision.js';

/** bumped whenever the snapshot shape changes; restore refuses other versions (migration arrives with saving, step 5.2) */
export const SNAPSHOT_VERSION = 4;
/** older versions restore can still read: 2 had no world (its clocks are rebuilt from the tick) */
const READABLE_VERSIONS = new Set([2, SNAPSHOT_VERSION]);

/**
 * World rectangle in world pixels for a map that is `width` x `height` tiles, or null for the open test field.
 * @param {{width:number,height:number}|null} map
 * @returns {{x:number,y:number,w:number,h:number}|null}
 */
export function worldBounds(map) {
  return map ? { x: 0, y: 0, w: map.width * TILE_W, h: map.height * TILE_H } : null;
}

export class Sim {
  /**
   * @param {Object} opts
   * @param {IslandMap|Object|null} [opts.map]  the island: an IslandMap, or the parsed data/island_map.json (decoded
   *                                   here); null gives the open, unbounded test field
   * @param {Object} opts.tuning       contents of data/tuning.json
   * @param {Object} [opts.data]       other loaded data files, by name
   * @param {number|string} [opts.seed]
   */
  constructor({ map = null, tuning, data = {}, seed = 1 } = {}) {
    if (!tuning) throw new Error('Sim: tuning is required');
    /** @type {IslandMap|null} static world data; never part of a snapshot */
    this.map = map == null ? null : map instanceof IslandMap ? map : IslandMap.fromJSON(map, tuning);
    this.tuning = tuning;
    this.data = data;
    this.seed = seed;
    /** ticks simulated so far */
    this.tick = 0;
    /**
     * @type {Array<{type:string}>} events of the last step; replaced (not mutated) at the start of each step.
     * Events raised while building or restoring (e.g. `player_unstuck`) are here until the first step.
     */
    this.events = [];
    this.rng = new Rng(seed);
    /** world rectangle, or null when the world is the open test field */
    this.bounds = worldBounds(this.map);
    /** @type {Collider|null} collision and line-of-sight queries on the island; null on the test field (no walls) */
    this.collider = this.map ? new Collider(this.map, tuning) : null;
    /** terrain movement rules (tuning.terrain as tables) */
    this.terrainRules = terrainRules(tuning);
    /** what the player's update borrows from the world each tick (reused, not state) */
    this.moveEnv = this.collider ? { collider: this.collider, rules: this.terrainRules, tide: 0, events: this.events } : null;

    let spawn;
    /** @type {import('../world/TestField.js').Prop[]} static scenery */
    this.props = [];
    if (this.map) {
      spawn = this.map.spawn;
      this.props = this.map.props;   // frozen and shared with the map: static scenery is not simulation state
    } else {
      const field = buildTestField(this.rng, tuning);
      spawn = field.spawn;
      this.props = field.props;
    }
    this.player = new Player({ x: spawn.x, y: spawn.y, radius: tuning.player.radius });
    if (spawn.facing && spawn.facing !== this.player.facing) {
      // the map chooses which way the player first looks (the island starts facing inland)
      const dir = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[spawn.facing];
      if (dir) [this.player.facing, this.player.dirX, this.player.dirY] = [spawn.facing, dir[0], dir[1]];
    }
    /** tide, day/night and weather (WorldState.js) */
    this.world = new WorldState(tuning);
    this.settlePlayer('spawn');
  }

  /** seconds simulated so far (derived from `tick`, so it never drifts) */
  get time() {
    return this.tick * DT;
  }

  /**
   * Tide height 0 (lowest) .. 1 (highest). The world clock (step 2.4) provides `this.world.tideHeight`; until it
   * exists the tide stands at tuning.terrain.lowTide.
   * @returns {number}
   */
  tideHeight() {
    const h = this.world?.tideHeight;
    return typeof h === 'number' ? h : this.terrainRules.lowTide;
  }

  /**
   * Make sure the player is not inside a blocker: move them to the nearest free position (else near the map's
   * spawn) and emit `player_unstuck`. Then set mode and terrain from the ground. Never throws.
   * @param {string} reason 'spawn' | 'restore' | ...
   */
  settlePlayer(reason) {
    if (!this.collider) return;
    const p = this.player;
    const c = this.collider;
    this.moveEnv.tide = this.tideHeight();
    if (!c.isPositionFree(p.x, p.y, p.radius)) {
      const fromX = p.x;
      const fromY = p.y;
      const out = { x: p.x, y: p.y };
      const reach = this.tuning.collision.unstuckSearch;
      const sx = Number.isFinite(p.x) ? p.x : this.map.spawn.x;
      const sy = Number.isFinite(p.y) ? p.y : this.map.spawn.y;
      const ok = c.nearestFreePosition(sx, sy, p.radius, reach, out)
        || c.nearestFreePosition(this.map.spawn.x, this.map.spawn.y, p.radius, reach, out);
      if (ok) {
        p.x = p.prevX = out.x;
        p.y = p.prevY = out.y;
      }
      this.events.push({ type: 'player_unstuck', reason, ok, fromX, fromY, x: p.x, y: p.y });
    }
    p.syncTerrain(this.moveEnv);
  }

  /**
   * Advance exactly one tick.
   * @param {Partial<import('./input.js').InputState>} [input]
   */
  step(input) {
    this.events = [];
    const inp = sanitizeInput(input);
    this.world.step(this.rng, this.events);   // before the entities, so they see this tick's tide and weather
    const env = this.moveEnv;
    if (env) {
      env.tide = this.tideHeight();
      env.events = this.events;
    }
    this.player.update(inp, this.tuning.player, DT, this.bounds, env);
    this.tick++;
  }

  /** @returns {Object} JSON-serialisable state; with the same map/tuning/data it rebuilds this exact Sim */
  snapshot() {
    return {
      version: SNAPSHOT_VERSION,
      seed: this.seed,
      tick: this.tick,
      rng: this.rng.snapshot(),
      player: this.player.snapshot(),
      world: this.world.snapshot(),
      // the map itself is data, not state: only which map this was, so a save from another map is refused
      map: this.map ? { version: this.map.version, hash: this.map.hash } : null,
      // map props are rebuilt from the map; only the test field's (placed by the rng) are stored
      props: this.map ? null : this.props.map((p) => ({ ...p })),
    };
  }

  /**
   * @param {Object} snap from `snapshot()` (possibly through JSON)
   * @param {{ map?: Object|null, tuning: Object, data?: Object }} ctx
   * @returns {Sim}
   */
  static restore(snap, { map = null, tuning, data = {} }) {
    if (!snap || !READABLE_VERSIONS.has(snap.version)) throw new Error(`Sim.restore: unsupported snapshot version ${snap?.version}`);
    const sim = new Sim({ map, tuning, data, seed: snap.seed });
    const want = snap.map ? `${snap.map.version}/${snap.map.hash}` : 'none';
    const have = sim.map ? `${sim.map.version}/${sim.map.hash}` : 'none';
    if (want !== have) throw new Error(`Sim.restore: snapshot was made on map ${want}, not on ${have}`);
    sim.tick = snap.tick;
    sim.rng = Rng.restore(snap.rng);
    sim.player = Player.restore(snap.player);
    sim.world = snap.world ? WorldState.restore(snap.world, tuning) : WorldState.atTick(snap.tick, tuning);
    if (!sim.map) sim.props = snap.props.map((p) => ({ ...p }));
    sim.events = [];
    if (sim.collider) {
      // a restored player inside a wall is moved out; one that is free keeps its mode (hysteresis state) as saved
      const free = sim.collider.isPositionFree(sim.player.x, sim.player.y, sim.player.radius);
      if (!free) sim.settlePlayer('restore');
    }
    return sim;
  }
}
