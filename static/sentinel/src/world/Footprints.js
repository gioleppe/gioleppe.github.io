// Footprints on wet sand (spec §6.1): temporary marks that scouts can spot and follow. A capped list in the
// simulation, oldest first; a print is forgotten tuning.footprints.lifetimeSeconds after it was made, and the
// oldest is dropped when the cap is reached. Owned by the Sim as `sim.footprints`.
import { TICK_HZ } from '../sim/constants.js';

/**
 * @typedef {Object} Footprint
 * @property {number} x      world pixels
 * @property {number} y
 * @property {number} dirX   heading of the walker (unit vector)
 * @property {number} dirY
 * @property {number} tick   when it was made
 * @property {number} n      running count: odd and even prints are the two feet
 */

export class FootprintTrail {
  /** @param {Object} tuning the whole tuning object (reads tuning.footprints) */
  constructor(tuning) {
    const c = tuning.footprints;
    this.lifeTicks = Math.max(1, Math.round(c.lifetimeSeconds * TICK_HZ));
    this.max = c.max;
    /** @type {Footprint[]} oldest first */
    this.list = [];
    this.count = 0;
    this.tick = 0;
  }

  /** seconds a print lasts */
  get lifetime() {
    return this.lifeTicks / TICK_HZ;
  }

  /** start of a step: set the clock and drop the prints that have faded */
  beginTick(tick) {
    this.tick = tick;
    let drop = 0;
    while (drop < this.list.length && tick - this.list[drop].tick >= this.lifeTicks) drop++;
    if (drop) this.list.splice(0, drop);
  }

  /** leave a print now */
  add(x, y, dirX, dirY) {
    this.list.push({ x, y, dirX, dirY, tick: this.tick, n: this.count++ });
    if (this.list.length > this.max) this.list.splice(0, this.list.length - this.max);
  }

  /** age of a print in seconds */
  ageOf(fp) {
    return (this.tick - fp.tick) / TICK_HZ;
  }

  /**
   * The prints within `r` of a point, freshest first (what a scout looking at the ground sees).
   * @returns {Array<Footprint & { age: number }>} copies; `age` in seconds
   */
  near(x, y, r) {
    const out = [];
    const r2 = r * r;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      if (this.tick - f.tick >= this.lifeTicks) continue;
      const dx = f.x - x;
      const dy = f.y - y;
      if (dx * dx + dy * dy <= r2) out.push({ ...f, age: this.ageOf(f) });
    }
    return out;
  }

  snapshot() {
    return { tick: this.tick, count: this.count, list: this.list.map((f) => ({ ...f })) };
  }

  static restore(s, tuning) {
    const t = new FootprintTrail(tuning);
    if (s) {
      t.tick = s.tick;
      t.count = s.count;
      t.list = s.list.map((f) => ({ ...f }));
    }
    return t;
  }
}
