// A patrol route as a closed walk (step 4.1): the map's `patrol_route` waypoints flattened into the order a scout
// visits them, so loop and ping-pong routes are the same thing to the AI.
//   loop:     p0 p1 ... pn-1 (then back to p0)                 K = n legs
//   pingpong: p0 p1 ... pn-1 pn-2 ... p1 (then back to p0)     K = 2(n - 1) legs
//   a post:   a single point (a sentry, or a scout spawned by debug): K = 1 leg of length 0
// Leg k runs from W[k] to W[(k + 1) % K]; `cum[k]` is the walk distance at W[k], `length` the whole cycle.
// Pure geometry with Math.sqrt only; positions along the route are what far scouts are drawn at (LOD).

export class Route {
  /**
   * @param {string} id
   * @param {'loop'|'pingpong'|'post'} mode
   * @param {Array<[number, number]>} points world px
   * @param {string|null} [sector]
   * @param {[number, number]} [postDir] a post's facing (a unit vector; default south)
   */
  constructor(id, mode, points, sector = null, postDir = null) {
    this.id = id;
    this.mode = points.length < 2 ? 'post' : mode;
    this.sector = sector;
    /** the map's waypoints */
    this.points = points.map((p) => [p[0], p[1]]);
    const seq = [];
    if (this.mode === 'post') seq.push(this.points[0]);
    else if (this.mode === 'pingpong') {
      for (const p of this.points) seq.push(p);
      for (let i = this.points.length - 2; i >= 1; i--) seq.push(this.points[i]);
    } else for (const p of this.points) seq.push(p);
    /** waypoints in visiting order */
    this.wx = Float64Array.from(seq, (p) => p[0]);
    this.wy = Float64Array.from(seq, (p) => p[1]);
    this.K = seq.length;
    /** walk distance at each waypoint, and the cycle length at the end */
    this.cum = new Float64Array(this.K + 1);
    /** unit direction and length of every leg */
    this.ux = new Float64Array(this.K);
    this.uy = new Float64Array(this.K);
    this.len = new Float64Array(this.K);
    for (let k = 0; k < this.K; k++) {
      const j = (k + 1) % this.K;
      const dx = this.wx[j] - this.wx[k];
      const dy = this.wy[j] - this.wy[k];
      const l = Math.sqrt(dx * dx + dy * dy);
      this.len[k] = l;
      // a leg of no length (a post) points the way the post faces
      this.ux[k] = l > 0 ? dx / l : postDir ? postDir[0] : 0;
      this.uy[k] = l > 0 ? dy / l : postDir ? postDir[1] : 1;
      this.cum[k + 1] = this.cum[k] + l;
    }
    this.length = this.cum[this.K];
    /**
     * where a ping-pong turns back (its two ends): a scout always stops there and looks around; other waypoints
     * get a pause only by chance (see the AI's patrol rules)
     */
    this.isEnd = new Uint8Array(this.K);
    if (this.mode === 'pingpong') { this.isEnd[0] = 1; this.isEnd[this.points.length - 1] = 1; }
    if (this.mode === 'post') this.isEnd[0] = 1;
  }

  /** the next waypoint index after k */
  next(k) {
    return (k + 1) % this.K;
  }

  /**
   * The point at walk distance s along leg k (s is clamped to the leg).
   * @param {{x:number,y:number}} out
   */
  pointOnLeg(k, s, out) {
    let t = s - this.cum[k];
    if (t < 0) t = 0;
    if (t > this.len[k]) t = this.len[k];
    out.x = this.wx[k] + this.ux[k] * t;
    out.y = this.wy[k] + this.uy[k] * t;
    return out;
  }

  /** the leg that contains walk distance s (0 <= s < length) */
  legAt(s) {
    if (!(this.length > 0)) return 0;
    let x = s % this.length;
    if (x < 0) x += this.length;
    // the routes are short lists (at most a few dozen legs): a linear scan is as fast as anything here
    for (let k = 0; k < this.K; k++) if (x < this.cum[k + 1]) return k;
    return this.K - 1;
  }

  /**
   * The walk distance on leg k of the point nearest to (x, y) on that leg (the projection, clamped).
   */
  projectOnLeg(k, x, y) {
    const t = (x - this.wx[k]) * this.ux[k] + (y - this.wy[k]) * this.uy[k];
    return this.cum[k] + (t < 0 ? 0 : t > this.len[k] ? this.len[k] : t);
  }

  /**
   * The nearest point of the whole route to (x, y): its leg and walk distance. Ties go to the earlier leg.
   * @returns {{ leg: number, s: number, d2: number }}
   */
  nearest(x, y) {
    let best = { leg: 0, s: 0, d2: Infinity };
    const p = { x: 0, y: 0 };
    for (let k = 0; k < this.K; k++) {
      const s = this.projectOnLeg(k, x, y);
      this.pointOnLeg(k, s, p);
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best.d2) best = { leg: k, s, d2 };
    }
    return best;
  }
}

/**
 * The map's routes by id.
 * @param {import('../../world/IslandMap.js').IslandMap|null} map
 * @returns {Map<string, Route>}
 */
export function routesOf(map) {
  const out = new Map();
  if (!map) return out;
  for (const r of map.entitiesOfType('patrol_route')) out.set(r.id, new Route(r.id, r.mode, r.points, r.sector ?? null));
  return out;
}

/**
 * A small deterministic hash of integers to [0, 1): per-scout, per-waypoint variety without the rng (so it costs
 * nothing in the snapshot and does not depend on what else drew from the rng).
 * @param {...number} ints
 */
export function hash01(...ints) {
  let h = 0x9e3779b9;
  for (const v of ints) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

/** a stable integer from a string id (FNV-1a) */
export function idHash(id) {
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
