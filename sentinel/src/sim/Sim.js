// The whole game state and the one way it advances: `step(input)`, exactly one tick of DT seconds.
// No browser, no clock, no files: the caller passes the loaded data in, randomness comes only from `rng`.
import { DT, TILE_W, TILE_H } from './constants.js';
import { Rng } from './rng.js';
import { sanitizeInput } from './input.js';
import { Player } from '../entities/Player.js';
import { buildTestField } from '../world/TestField.js';
import { IslandMap } from '../world/IslandMap.js';
import { WorldState } from '../world/WorldState.js';

/** bumped whenever the snapshot shape changes; restore refuses other versions (migration arrives with saving, step 5.2) */
export const SNAPSHOT_VERSION = 3;
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
    /** @type {Array<{type:string}>} events of the last step; replaced (not mutated) at the start of each step */
    this.events = [];
    this.rng = new Rng(seed);
    /** world rectangle, or null when the world is the open test field */
    this.bounds = worldBounds(this.map);

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
    /** tide, day/night and weather (WorldState.js) */
    this.world = new WorldState(tuning);
  }

  /** seconds simulated so far (derived from `tick`, so it never drifts) */
  get time() {
    return this.tick * DT;
  }

  /**
   * Advance exactly one tick.
   * @param {Partial<import('./input.js').InputState>} [input]
   */
  step(input) {
    this.events = [];
    const inp = sanitizeInput(input);
    this.world.step(this.rng, this.events);   // before the entities, so they see this tick's tide and weather
    this.player.update(inp, this.tuning.player, DT, this.bounds);
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
    return sim;
  }
}
