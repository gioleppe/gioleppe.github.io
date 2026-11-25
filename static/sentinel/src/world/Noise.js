// Sound in the world (spec §6.1): a short-lived list of recent noises that the AI queries. Every noise is a
// circle: whoever stands inside its radius can hear it. The player's footsteps are one continuous source that
// is refreshed every tick while it moves; a thrown rock or coconut is a one-off impact. Entries are forgotten
// tuning.noise.memorySeconds after their last emission. Owned by the Sim as `sim.noise`.
//
// This is the only place noise events come from: `noise {x, y, radius, kind, sourceId}` when a new entry
// appears (not for a refresh, nor for a continuous source emitted with announce: false, i.e. footsteps), and
// `noise_loud` (same fields) when a source reaches loudAt. Callers just `emit`.
import { TICK_HZ } from '../sim/constants.js';

/**
 * @typedef {Object} Noise
 * @property {number} id        unique, increasing
 * @property {number} x         world pixels
 * @property {number} y
 * @property {number} radius    world pixels; heard by anyone within it
 * @property {string} kind      'footsteps' | 'impact' | ...
 * @property {string|null} sourceId  who or what made it; a source+kind pair has at most one entry (refreshed)
 * @property {number} tick      tick of the last emission
 */

export class NoiseField {
  /** @param {Object} tuning the whole tuning object (reads tuning.noise) */
  constructor(tuning) {
    const c = tuning.noise;
    /** noises at or above this radius are "loud": a `noise_loud` event, and the presentation draws a ring */
    this.loudAt = c.loudAt;
    this.memoryTicks = Math.max(1, Math.round(c.memorySeconds * TICK_HZ));
    this.maxEntries = c.maxEntries;
    /** @type {Noise[]} oldest first */
    this.list = [];
    /** the tick being simulated (set by the Sim at the start of every step) */
    this.tick = 0;
    this.nextId = 1;
    /** events (noise_loud) for the Sim to move into sim.events */
    this.outbox = [];
  }

  /** start of a step: set the clock and forget what is too old */
  beginTick(tick) {
    this.tick = tick;
    let keep = 0;
    for (const n of this.list) if (tick - n.tick < this.memoryTicks) this.list[keep++] = n;
    this.list.length = keep;
  }

  /**
   * Make a noise now. A source that is already sounding the same kind of noise is moved and refreshed instead of
   * adding an entry (continuous sources such as footsteps). Radius 0 or less is silence and is ignored.
   * @param {{ x: number, y: number, radius: number, kind?: string, sourceId?: string|null, announce?: boolean }} n
   *   announce false: no `noise` event for a new entry (a continuous source such as footsteps, heard by polling)
   * @returns {Noise|null} the entry, or null when nothing was emitted
   */
  emit({ x, y, radius, kind = 'noise', sourceId = null, announce = true }) {
    if (!(radius > 0) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) return null;
    let e = null;
    let wasLoud = false;
    if (sourceId !== null) {
      const i = this.list.findIndex((n) => n.sourceId === sourceId && n.kind === kind);
      if (i >= 0) {
        e = this.list[i];
        wasLoud = e.radius >= this.loudAt;
        this.list.splice(i, 1);   // re-appended below: the list stays ordered by last emission
      }
    }
    const fresh = !e;
    if (!e) e = { id: this.nextId++, x, y, radius, kind, sourceId, tick: this.tick };
    Object.assign(e, { x, y, radius, tick: this.tick });
    this.list.push(e);
    if (this.list.length > this.maxEntries) this.list.splice(0, this.list.length - this.maxEntries);
    if (fresh && announce) this.outbox.push({ type: 'noise', x, y, radius, kind, sourceId });
    if (radius >= this.loudAt && !wasLoud) this.outbox.push({ type: 'noise_loud', x, y, radius, kind, sourceId });
    return e;
  }

  /**
   * The noises that reach a point (its distance to the noise is within the radius), newest first.
   * @param {number} x
   * @param {number} y
   * @returns {Array<Noise & { age: number, distance: number }>} copies; `age` in seconds since the last emission
   */
  heardFrom(x, y) {
    const out = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const n = this.list[i];
      const dx = n.x - x;
      const dy = n.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= n.radius * n.radius) out.push({ ...n, age: (this.tick - n.tick) / TICK_HZ, distance: Math.sqrt(d2) });
    }
    return out;
  }

  /** @returns {Noise[]} every remembered noise, oldest first (read only) */
  get recent() {
    return this.list;
  }

  /** the events raised since the last call, emptied */
  takeEvents() {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  snapshot() {
    return { tick: this.tick, nextId: this.nextId, list: this.list.map((n) => ({ ...n })) };
  }

  static restore(s, tuning) {
    const f = new NoiseField(tuning);
    if (s) {
      f.tick = s.tick;
      f.nextId = s.nextId;
      f.list = s.list.map((n) => ({ ...n }));
    }
    return f;
  }
}

/**
 * The noise table lookup: radius for a surface and an action, before the weather.
 * @param {Object} cfg tuning.noise
 * @param {string} surface a key of cfg.table
 * @param {'still'|'sneak'|'walk'|'sprint'} action
 */
export function noiseFor(cfg, surface, action) {
  const row = cfg.table[surface] ?? cfg.table[cfg.defaultSurface];
  return row[action] ?? 0;
}
