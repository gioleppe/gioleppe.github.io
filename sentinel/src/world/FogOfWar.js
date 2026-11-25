// Fog of war (spec §6.3, §9 FogOfWar.js): which parts of the island the player has seen, for the journal map,
// and Shifting Paths, where the island makes them forget. Simulation side (`sim.fog`), stepped once per tick by
// Sim.step after Resonance; deterministic, no rng.
//
// The island is cut into cells of tuning.fog.cellTiles x cellTiles tiles (2 x 2 tiles = 64 x 48 px: 240 x 240
// cells on the 480 x 480 island, 7.2 KB as bits). A cell is explored once its centre has been within the sight
// radius of the player. Work per tick is bounded by the sight circle and is only done when the player enters a
// new cell, the radius changes or Shifting Paths switches: nothing ever walks the whole grid during play.
//
// Sight radius = max(minSightRadius, sightRadius x ambientVisibility(world)) (night and squalls shrink it),
// x highGround.multiplier inside highGround.regions (Signal Peak looks out over the island), rounded to 8 px.
//
// Shifting Paths: while Resonance is Agitated (resonance.shiftingPaths) and the player stands in deep jungle or
// anomaly territory (inside any anomaly zone, or in a region of tuning.fog.shifting.regions), the player only
// keeps memoryRadius px around them: explored cells between memoryRadius and forgetRadius are forgotten again as
// they move (marked `forgotten`, which the map draws as a violet smear until they are seen again). Discovered
// landmarks keep their names. The fog is all it touches: the map, collision and every position are untouched.
//
// Landmarks: a landmark is discovered the first time its cell is explored (event landmark_discovered { id, name }).
// Events: landmark_discovered, shifting_paths { active }.
// For later steps: revealArea(x, y, r), revealLandmarks(ids) (the Rogue Cartographer's map, step 4.6).
// Snapshot: the bit arrays run-length encoded (see encodeBits), a few KB even with half the island explored.
import { TILE_W, TILE_H } from '../sim/constants.js';
import { ambientVisibility } from './visibility.js';

const RADIUS_STEP = 8;

function num(v, what, min = 0) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) throw new Error(`FogOfWar: tuning.fog.${what} must be a number >= ${min} (got ${JSON.stringify(v)})`);
  return v;
}

/**
 * Check tuning.fog.
 * @param {Object} tuning the whole tuning object
 */
export function fogConfig(tuning) {
  const f = tuning?.fog;
  if (!f) throw new Error('FogOfWar: tuning.fog is missing');
  const cellTiles = num(f.cellTiles, 'cellTiles', 1);
  if (!Number.isInteger(cellTiles)) throw new Error('FogOfWar: tuning.fog.cellTiles must be a whole number');
  num(f.sightRadius, 'sightRadius', 1);
  num(f.minSightRadius, 'minSightRadius', 0);
  num(f.highGround?.multiplier, 'highGround.multiplier', 0);
  num(f.landmarkRevealRadius, 'landmarkRevealRadius', 0);
  const s = f.shifting ?? {};
  num(s.memoryRadius, 'shifting.memoryRadius', 0);
  num(s.forgetRadius, 'shifting.forgetRadius', s.memoryRadius);
  return Object.freeze({
    cellTiles, cellW: cellTiles * TILE_W, cellH: cellTiles * TILE_H,
    sightRadius: f.sightRadius, minSightRadius: f.minSightRadius,
    highRegions: new Set(f.highGround.regions ?? []), highMultiplier: f.highGround.multiplier,
    landmarkRevealRadius: f.landmarkRevealRadius,
    shiftRegions: new Set(s.regions ?? []), memoryRadius: s.memoryRadius, forgetRadius: s.forgetRadius,
  });
}

// ---- bit arrays and their compact text form -------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** bytes -> base64 (plain arithmetic, the same everywhere; no btoa in the simulation) */
export function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

/** base64 -> bytes; throws on a character outside the alphabet */
export function fromBase64(text) {
  const clean = String(text).replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let k = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64.indexOf(clean[i]);
    if (v < 0) throw new Error(`FogOfWar: bad base64 character "${clean[i]}"`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[k++] = (acc >> bits) & 255;
    }
  }
  return out.subarray(0, k);
}

/**
 * A bit array (bit i = byte i >> 3, mask 1 << (i & 7)) as text: the lengths of its alternating runs (zeros first)
 * as LEB128 varints, in base64. Explored land is a few blobs, so this is a small fraction of the raw bits.
 * @param {Uint8Array} bits
 * @param {number} n number of bits
 * @returns {string}
 */
export function encodeBits(bits, n) {
  const bytes = [];
  const put = (run) => {
    let v = run;
    while (v >= 128) { bytes.push((v & 127) | 128); v = Math.floor(v / 128); }
    bytes.push(v);
  };
  let cur = 0;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const b = (bits[i >> 3] >> (i & 7)) & 1;
    if (b === cur) run++;
    else { put(run); cur = b; run = 1; }
  }
  put(run);
  return toBase64(bytes);
}

/**
 * Inverse of encodeBits.
 * @param {string} text
 * @param {number} n number of bits
 * @returns {Uint8Array}
 */
export function decodeBits(text, n) {
  const bits = new Uint8Array((n + 7) >> 3);
  const bytes = fromBase64(text);
  let i = 0;
  let cur = 0;
  let k = 0;
  while (k < bytes.length) {
    let run = 0;
    let mul = 1;
    let b;
    do {
      b = bytes[k++];
      run += (b & 127) * mul;
      mul *= 128;
    } while (b & 128 && k < bytes.length);
    if (i + run > n) throw new Error('FogOfWar: encoded fog is longer than the grid');
    if (cur) for (let j = i; j < i + run; j++) bits[j >> 3] |= 1 << (j & 7);
    i += run;
    cur ^= 1;
  }
  if (i !== n) throw new Error(`FogOfWar: encoded fog covers ${i} cells, the grid has ${n}`);
  return bits;
}

// ---- the fog ---------------------------------------------------------------------------------------------------

export class FogOfWar {
  /**
   * @param {Object} tuning the whole tuning object
   * @param {import('./IslandMap.js').IslandMap} map
   */
  constructor(tuning, map) {
    if (!map) throw new Error('FogOfWar: needs a map');
    this.cfg = fogConfig(tuning);
    this.tuning = tuning;
    this.map = map;
    const c = this.cfg;
    this.cols = Math.ceil(map.width / c.cellTiles);
    this.rows = Math.ceil(map.height / c.cellTiles);
    this.cellCount = this.cols * this.rows;
    /** explored cells */
    this.bits = new Uint8Array((this.cellCount + 7) >> 3);
    /** cells Shifting Paths took back (explored once, not now) */
    this.forgottenBits = new Uint8Array((this.cellCount + 7) >> 3);
    this.explored = 0;
    /** @type {Set<string>} landmark ids discovered */
    this.discovered = new Set();
    /** landmark ids by the cell they stand in */
    this.landmarksByCell = new Map();
    for (const l of map.entitiesOfType('landmark')) {
      const i = this.cellAtWorld(l.x, l.y);
      if (i < 0) continue;
      if (!this.landmarksByCell.has(i)) this.landmarksByCell.set(i, []);
      this.landmarksByCell.get(i).push(l);
    }
    /** Shifting Paths is on this tick */
    this.shifting = false;
    /** debug: Shifting Paths on regardless of Resonance (still only in its regions) */
    this.forced = false;
    /** the cell and radius of the last update (-1: none yet) */
    this.lastCell = -1;
    this.lastRadius = -1;
    /** cells examined by the last step (cost guard for tests and the debug readout; not state) */
    this.touched = 0;
    /** bumped whenever a cell changes (the map overlay redraws its fog layer on a change; not state) */
    this.revision = 0;
  }

  // ---- queries ---------------------------------------------------------------------------------------------

  /** cell index of a world point, -1 off the map */
  cellAtWorld(x, y) {
    const cx = Math.floor(x / this.cfg.cellW);
    const cy = Math.floor(y / this.cfg.cellH);
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows ? cy * this.cols + cx : -1;
  }

  /** the cell (cx, cy) has been explored */
  isCellExplored(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;
    const i = cy * this.cols + cx;
    return ((this.bits[i >> 3] >> (i & 7)) & 1) === 1;
  }

  /** the cell (cx, cy) was explored and then forgotten by Shifting Paths */
  isCellForgotten(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;
    const i = cy * this.cols + cx;
    return ((this.forgottenBits[i >> 3] >> (i & 7)) & 1) === 1;
  }

  /** the world point lies in an explored cell */
  isExplored(x, y) {
    const i = this.cellAtWorld(x, y);
    return i >= 0 && ((this.bits[i >> 3] >> (i & 7)) & 1) === 1;
  }

  /** 0..1 of the cells of the whole grid (sea included) */
  get exploredFraction() {
    return this.explored / this.cellCount;
  }

  /**
   * The sight radius for the player now.
   * @param {Object} sim
   * @returns {number} world px, a multiple of 8
   */
  sightRadius(sim) {
    const c = this.cfg;
    let r = c.sightRadius * (sim.world ? ambientVisibility(sim.world, this.tuning) : 1);
    if (r < c.minSightRadius) r = c.minSightRadius;
    if (c.highRegions.has(this.map.regionAtWorld(sim.player.x, sim.player.y))) r *= c.highMultiplier;
    return Math.round(r / RADIUS_STEP) * RADIUS_STEP;
  }

  /** the player is where Shifting Paths can take hold: an anomaly zone or a deep-jungle region */
  inShiftingGround(x, y) {
    return this.map.anomalyAt(x, y) > 0 || this.cfg.shiftRegions.has(this.map.regionAtWorld(x, y));
  }

  // ---- step ------------------------------------------------------------------------------------------------

  /**
   * Advance one tick (after Resonance).
   * @param {Object} sim
   * @param {Array<Object>} events
   */
  step(sim, events) {
    this.touched = 0;
    const p = sim.player;
    const agitated = this.forced || !!sim.resonance?.shiftingPaths;
    const shifting = agitated && this.inShiftingGround(p.x, p.y);
    const switched = shifting !== this.shifting;
    if (switched) {
      this.shifting = shifting;
      events.push({ type: 'shifting_paths', active: shifting });
    }
    const cell = this.cellAtWorld(p.x, p.y);
    const radius = shifting ? this.cfg.memoryRadius : this.sightRadius(sim);
    if (!switched && cell === this.lastCell && radius === this.lastRadius) return;
    this.lastCell = cell;
    this.lastRadius = radius;
    this.reveal(p.x, p.y, radius, events);
    if (shifting) this.forgetRing(p.x, p.y, this.cfg.memoryRadius, this.cfg.forgetRadius);
  }

  /** the cell range of a circle, clipped to the grid */
  range(x, y, r) {
    const c = this.cfg;
    return {
      c0: Math.max(0, Math.floor((x - r) / c.cellW)), c1: Math.min(this.cols - 1, Math.floor((x + r) / c.cellW)),
      r0: Math.max(0, Math.floor((y - r) / c.cellH)), r1: Math.min(this.rows - 1, Math.floor((y + r) / c.cellH)),
    };
  }

  /**
   * Explore every cell whose centre is within r of (x, y).
   * @param {Array<Object>|null} events landmark discoveries are announced here (null: silently)
   * @returns {number} cells newly explored
   */
  reveal(x, y, r, events = null) {
    const c = this.cfg;
    const { c0, c1, r0, r1 } = this.range(x, y, r);
    const r2 = r * r;
    let fresh = 0;
    for (let cy = r0; cy <= r1; cy++) {
      const dy = (cy + 0.5) * c.cellH - y;
      for (let cx = c0; cx <= c1; cx++) {
        this.touched++;
        const dx = (cx + 0.5) * c.cellW - x;
        if (dx * dx + dy * dy > r2) continue;
        const i = cy * this.cols + cx;
        const m = 1 << (i & 7);
        if (this.bits[i >> 3] & m) continue;
        this.bits[i >> 3] |= m;
        this.forgottenBits[i >> 3] &= ~m;
        this.explored++;
        fresh++;
        const marks = this.landmarksByCell.get(i);
        if (marks) for (const l of marks) this.discover(l, events);
      }
    }
    if (fresh) this.revision++;
    return fresh;
  }

  /** forget explored cells whose centre lies between inner (exclusive) and outer (inclusive) of (x, y) */
  forgetRing(x, y, inner, outer) {
    const c = this.cfg;
    const { c0, c1, r0, r1 } = this.range(x, y, outer);
    const i2 = inner * inner;
    const o2 = outer * outer;
    let lost = 0;
    for (let cy = r0; cy <= r1; cy++) {
      const dy = (cy + 0.5) * c.cellH - y;
      for (let cx = c0; cx <= c1; cx++) {
        this.touched++;
        const dx = (cx + 0.5) * c.cellW - x;
        const d2 = dx * dx + dy * dy;
        if (d2 <= i2 || d2 > o2) continue;
        const i = cy * this.cols + cx;
        const m = 1 << (i & 7);
        if (!(this.bits[i >> 3] & m)) continue;
        this.bits[i >> 3] &= ~m;
        this.forgottenBits[i >> 3] |= m;
        this.explored--;
        lost++;
      }
    }
    if (lost) this.revision++;
    return lost;
  }

  discover(landmark, events) {
    if (this.discovered.has(landmark.id)) return false;
    this.discovered.add(landmark.id);
    events?.push({ type: 'landmark_discovered', id: landmark.id, name: landmark.name ?? landmark.id });
    return true;
  }

  // ---- for other systems -------------------------------------------------------------------------------------

  /**
   * Explore a circle of the map (a found map, a view from a height).
   * @param {number} x world px
   * @param {number} y
   * @param {number} r world px
   * @param {Array<Object>|null} [events]
   * @returns {number} cells newly explored
   */
  revealArea(x, y, r, events = null) {
    if (![x, y, r].every(Number.isFinite) || r < 0) throw new TypeError(`revealArea: expected finite x, y and r >= 0, got ${x}, ${y}, ${r}`);
    return this.reveal(x, y, r, events);
  }

  /**
   * Discover landmarks at once and explore landmarkRevealRadius around each (the Rogue Cartographer's map).
   * Unknown ids are ignored.
   * @param {string[]} ids
   * @param {Array<Object>|null} [events]
   * @returns {string[]} the ids newly discovered
   */
  revealLandmarks(ids, events = null) {
    const out = [];
    for (const id of ids) {
      const l = this.map.landmark(id);
      if (!l) continue;
      if (this.discover(l, events)) out.push(id);
      this.reveal(l.x, l.y, this.cfg.landmarkRevealRadius, events);
    }
    return out;
  }

  /** debug: explore the whole grid and discover every landmark (no events) */
  revealAll() {
    this.bits.fill(255);
    this.forgottenBits.fill(0);
    this.explored = this.cellCount;
    for (const l of this.map.entitiesOfType('landmark')) this.discovered.add(l.id);
    this.lastCell = -1;
    this.revision++;
  }

  /** debug: forget the whole grid (landmarks stay discovered) */
  forgetAll() {
    this.bits.fill(0);
    this.forgottenBits.fill(0);
    this.explored = 0;
    this.lastCell = -1;
    this.revision++;
  }

  // ---- snapshot ----------------------------------------------------------------------------------------------

  /** @returns {Object} plain JSON */
  snapshot() {
    return {
      cellTiles: this.cfg.cellTiles, cols: this.cols, rows: this.rows,
      explored: encodeBits(this.bits, this.cellCount),
      forgotten: encodeBits(this.forgottenBits, this.cellCount),
      discovered: [...this.discovered].sort(),
      shifting: this.shifting, forced: this.forced, lastCell: this.lastCell, lastRadius: this.lastRadius,
    };
  }

  /**
   * @param {Object} snap from snapshot()
   * @param {Object} tuning
   * @param {import('./IslandMap.js').IslandMap} map
   */
  static restore(snap, tuning, map) {
    const f = new FogOfWar(tuning, map);
    if (snap.cols !== f.cols || snap.rows !== f.rows) throw new Error(`FogOfWar.restore: the snapshot's fog is ${snap.cols}x${snap.rows} cells, this map and tuning give ${f.cols}x${f.rows}`);
    f.bits = decodeBits(snap.explored, f.cellCount);
    f.forgottenBits = decodeBits(snap.forgotten, f.cellCount);
    let n = 0;
    for (let i = 0; i < f.cellCount; i++) n += (f.bits[i >> 3] >> (i & 7)) & 1;
    f.explored = n;
    for (const id of snap.discovered ?? []) f.discovered.add(id);
    f.shifting = !!snap.shifting;
    f.forced = !!snap.forced;
    f.lastCell = snap.lastCell ?? -1;
    f.lastRadius = snap.lastRadius ?? -1;
    return f;
  }
}
