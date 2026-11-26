// Collision and terrain movement rules (spec §5, step 2.3). Simulation side: plain arithmetic and Math.sqrt only,
// deterministic, allocation-free per call (every query reuses scratch fields of its Collider).
//
// ---- the walkability rule (what the island author and the map audit rely on) -----------------------------------
// An entity is a circle on the ground (the player's radius is tuning.player.radius = 6 px). It may not overlap:
//   * a tile whose collision layer is 1 (an axis-aligned 32 x 24 rectangle),
//   * a solid prop: any map prop with a collision radius > 0, or flagged `blocker` (a circle of that radius),
//   * the map edge (the centre stays within [radius, width - radius] x [radius, height - radius]).
// Nothing else blocks: water never blocks, it changes the movement mode (see terrainMove below):
//   ground: sand, wet_sand, jungle_floor, basalt, reef_rock (speed x tuning.terrain.<name>.speed)
//   wade:   mud, shallow_water (slowed), or a tile flooded by the tide no more than tuning.water.deepMargin deep
//   swim:   deep_water, or a tile flooded deeper than that (speed x tuning.terrain.swimSpeed)
// Sight is blocked by blocked tiles and by props that block sight: tuning.props[kind].blocksSight if set, else
// tuning.collision.blocksSight[kind] if set, else the prop's solidity (trunks, rocks, hull, monoliths do; grass not).
//
// ---- how movement resolves ---------------------------------------------------------------------------------
// The displacement is cut into sub-steps no longer than radius * subStepFraction (no tunnelling at any speed).
// After each sub-step overlaps are pushed out deepest-first along their normals, which keeps the tangential part
// of the motion (sliding). A tile corner only counts as a corner when both tiles beside it are open: along a wall
// of many tiles the seams are flat faces, so nothing snags. If a sub-step cannot be resolved (squeezed between a
// prop and a wall) its axis-separated parts are tried and else it is dropped, so a circle that starts free never
// ends overlapping. When a move is mostly blocked, a corner assist probes sideways (up to maxOffset px) for an
// opening the circle could continue through and nudges towards the nearest one: gaps and doorways do not need
// pixel-perfect alignment.
import { TILE_W, TILE_H } from '../sim/constants.js';
import { TERRAINS, TERRAIN_ID } from './IslandMap.js';
import { isDeepFlood } from './water.js';

/** movement modes by rank: deeper water is a higher rank */
export const MODES = Object.freeze(['ground', 'wade', 'swim']);
const MODE_RANK = Object.freeze({ ground: 0, wade: 1, swim: 2 });

const need = (v, what) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`collision: tuning.${what} must be a number`);
  return v;
};

/**
 * Collision numbers from tuning.collision, checked once.
 * @param {Object} tuning the whole tuning object
 */
export function collisionConfig(tuning) {
  const c = tuning?.collision;
  if (!c) throw new Error('collision: tuning.collision is missing');
  const a = c.cornerAssist ?? {};
  return Object.freeze({
    subStepFraction: need(c.subStepFraction, 'collision.subStepFraction'),
    maxSubSteps: need(c.maxSubSteps, 'collision.maxSubSteps'),
    iterations: need(c.iterations, 'collision.iterations'),
    epsilon: need(c.epsilon, 'collision.epsilon'),
    assistMaxOffset: need(a.maxOffset, 'collision.cornerAssist.maxOffset'),
    assistProbeStep: need(a.probeStep, 'collision.cornerAssist.probeStep'),
    assistLookAhead: need(a.lookAhead, 'collision.cornerAssist.lookAhead'),
    assistMinProgress: need(a.minProgress, 'collision.cornerAssist.minProgress'),
    assistSpeed: need(a.speed, 'collision.cornerAssist.speed'),
    freeSearchStep: need(c.freeSearchStep, 'collision.freeSearchStep'),
    unstuckSearch: need(c.unstuckSearch, 'collision.unstuckSearch'),
  });
}

/**
 * A fresh contact record for `moveCircle` (allocate once, reuse every tick).
 * @returns {{ x: number, y: number, hitX: boolean, hitY: boolean, blocked: boolean, nx: number, ny: number, assisted: boolean }}
 */
export function makeContact() {
  return { x: 0, y: 0, hitX: false, hitY: false, blocked: false, nx: 0, ny: 0, assisted: false };
}

export class Collider {
  /**
   * @param {import('./IslandMap.js').IslandMap} map
   * @param {Object} tuning the whole tuning object
   */
  constructor(map, tuning) {
    this.map = map;
    this.cfg = collisionConfig(tuning);
    this.W = map.width * TILE_W;
    this.H = map.height * TILE_H;
    const propCfg = tuning.props ?? {};
    const sightCfg = tuning.collision.blocksSight ?? {};
    /** @type {Map<string, boolean>} sight rule per prop kind where tuning decides it */
    this.sightByKind = new Map();
    for (const kind of new Set([...Object.keys(propCfg), ...Object.keys(sightCfg)])) {
      const v = typeof propCfg[kind]?.blocksSight === 'boolean' ? propCfg[kind].blocksSight : sightCfg[kind];
      if (typeof v === 'boolean') this.sightByKind.set(kind, v);
    }
    /** @type {Set<string>} ids of props moved off their map place (see propIsSolid) */
    this.moved = new Set();
    // scratch, so no query allocates
    this.props = [];
    this.cx = 0; this.cy = 0;           // working position of resolve()
    this.pen = 0; this.nx = 0; this.ny = 0;   // last contact of tileContact()/deepest()
    this.lastNx = 0; this.lastNy = 0;   // normal of the last push of a resolve
    this.inner = makeContact();         // for the corner assist's own moves
  }

  /** @returns {boolean} the prop stops movement */
  propIsSolid(p) {
    // a prop that has left its map place (the dragged dinghy, step 5.3) no longer blocks there; derived from the
    // simulation's state by its owner (endings/dinghy.js sync), never state of its own
    if (this.moved.size > 0 && this.moved.has(p.id)) return false;
    return p.radius > 0 || p.blocker === true;
  }

  /** @returns {boolean} the prop stops sight lines */
  propBlocksSight(p) {
    if (typeof p.blocksSight === 'boolean') return p.blocksSight;
    const v = this.sightByKind.get(p.kind);
    return v === undefined ? this.propIsSolid(p) : v;
  }

  blocked(tx, ty) {
    return this.map.isBlocked(tx, ty);
  }

  /**
   * Overlap of a circle with one blocked tile; sets this.pen and this.nx/ny (pointing out of the tile).
   * Faces and corners shared with another blocked tile are not exposed and give no contact: the neighbour's own
   * exposed face answers instead, which is what keeps seams flat.
   * @returns {boolean} overlapping by more than epsilon
   */
  tileContact(tx, ty, cx, cy, r) {
    const x0 = tx * TILE_W;
    const x1 = x0 + TILE_W;
    const y0 = ty * TILE_H;
    const y1 = y0 + TILE_H;
    const sx = cx < x0 ? -1 : cx > x1 ? 1 : 0;
    const sy = cy < y0 ? -1 : cy > y1 ? 1 : 0;
    if (sx === 0 && sy === 0) {
      // centre inside the tile: out through the nearest exposed face (any face if none is exposed)
      let best = Infinity;
      for (let pass = 0; pass < 2 && best === Infinity; pass++) {
        const any = pass === 1;
        if ((any || !this.blocked(tx - 1, ty)) && cx - x0 < best) { best = cx - x0; this.nx = -1; this.ny = 0; }
        if ((any || !this.blocked(tx + 1, ty)) && x1 - cx < best) { best = x1 - cx; this.nx = 1; this.ny = 0; }
        if ((any || !this.blocked(tx, ty - 1)) && cy - y0 < best) { best = cy - y0; this.nx = 0; this.ny = -1; }
        if ((any || !this.blocked(tx, ty + 1)) && y1 - cy < best) { best = y1 - cy; this.nx = 0; this.ny = 1; }
      }
      this.pen = best + r;
      return true;
    }
    if (sx !== 0 && sy !== 0) {
      if (this.blocked(tx + sx, ty) || this.blocked(tx, ty + sy)) return false;   // not a convex corner
      const dx = cx - (sx < 0 ? x0 : x1);
      const dy = cy - (sy < 0 ? y0 : y1);
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) return false;
      const d = Math.sqrt(d2);
      this.pen = r - d;
      this.nx = dx / d;
      this.ny = dy / d;
      return this.pen > this.cfg.epsilon;
    }
    if (sx !== 0) {
      if (this.blocked(tx + sx, ty)) return false;
      const d = sx < 0 ? x0 - cx : cx - x1;
      this.pen = r - d;
      this.nx = sx; this.ny = 0;
    } else {
      if (this.blocked(tx, ty + sy)) return false;
      const d = sy < 0 ? y0 - cy : cy - y1;
      this.pen = r - d;
      this.nx = 0; this.ny = sy;
    }
    return this.pen > this.cfg.epsilon;
  }

  /**
   * The deepest overlap at (cx, cy): sets this.pen, this.nx, this.ny.
   * @returns {boolean} there is one (beyond epsilon)
   */
  deepest(cx, cy, r) {
    let bestPen = this.cfg.epsilon;
    let bnx = 0;
    let bny = 0;
    const tx0 = Math.floor((cx - r) / TILE_W);
    const tx1 = Math.floor((cx + r) / TILE_W);
    const ty0 = Math.floor((cy - r) / TILE_H);
    const ty1 = Math.floor((cy + r) / TILE_H);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!this.blocked(tx, ty)) continue;
        if (this.tileContact(tx, ty, cx, cy, r) && this.pen > bestPen) { bestPen = this.pen; bnx = this.nx; bny = this.ny; }
      }
    }
    const props = this.map.propsNear(cx, cy, r + this.map.maxPropReach, this.props);
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (!this.propIsSolid(p)) continue;
      const dx = cx - p.x;
      const dy = cy - p.y;
      const rr = r + p.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2);
      const pen = rr - d;
      if (pen > bestPen) {
        bestPen = pen;
        if (d > 0) { bnx = dx / d; bny = dy / d; } else { bnx = 0; bny = 1; }   // dead centre: out to the south
      }
    }
    if (bnx === 0 && bny === 0) return false;
    this.pen = bestPen;
    this.nx = bnx;
    this.ny = bny;
    return true;
  }

  /** clamp a centre inside the map edge */
  clampX(x, r) { return x < r ? r : x > this.W - r ? this.W - r : x; }
  clampY(y, r) { return y < r ? r : y > this.H - r ? this.H - r : y; }

  /**
   * Push (x, y) out of every overlap, deepest first. Result in this.cx/this.cy.
   * @returns {boolean} the result is free
   */
  resolve(x, y, r) {
    let cx = this.clampX(x, r);
    let cy = this.clampY(y, r);
    this.lastNx = 0; this.lastNy = 0;
    const n = this.cfg.iterations;
    let free = false;
    for (let i = 0; i <= n; i++) {
      if (!this.deepest(cx, cy, r)) { free = true; break; }
      if (i === n) break;
      cx = this.clampX(cx + this.nx * this.pen, r);
      cy = this.clampY(cy + this.ny * this.pen, r);
      this.lastNx = this.nx; this.lastNy = this.ny;
    }
    this.cx = cx;
    this.cy = cy;
    return free;
  }

  /**
   * True when a circle there overlaps nothing (tiles, solid props, map edge) beyond epsilon.
   * @param {number} x
   * @param {number} y
   * @param {number} r
   */
  isPositionFree(x, y, r) {
    const e = this.cfg.epsilon;
    if (!(x >= r - e && y >= r - e && x <= this.W - r + e && y <= this.H - r + e)) return false;   // also NaN
    return !this.deepest(x, y, r);
  }

  /**
   * Move a circle by (dx, dy) with sliding, sub-steps and the corner assist.
   * @param {number} x
   * @param {number} y
   * @param {number} r radius
   * @param {number} dx
   * @param {number} dy
   * @param {ReturnType<typeof makeContact>} out new position in out.x/out.y; hitX/hitY = that axis lost
   *   part of its motion, blocked = either; nx/ny = normal of the last push (0, 0 when nothing was touched)
   * @param {boolean} [assist] use the corner assist (default true)
   * @returns {typeof out}
   */
  moveCircle(x, y, r, dx, dy, out, assist = true) {
    this.moveRaw(x, y, r, dx, dy, out);
    out.assisted = false;
    const len2 = dx * dx + dy * dy;
    if (assist && out.blocked && len2 > 0) {
      const c = this.cfg;
      const len = Math.sqrt(len2);
      const ux = dx / len;
      const uy = dy / len;
      const progress = (out.x - x) * ux + (out.y - y) * uy;
      if (progress < len * c.assistMinProgress) this.cornerAssist(out, r, ux, uy, len);
    }
    return out;
  }

  /** sideways nudge towards the nearest opening the circle could continue through; updates `out` */
  cornerAssist(out, r, ux, uy, len) {
    const c = this.cfg;
    const px = -uy;
    const py = ux;
    const bx = out.x;
    const by = out.y;
    for (let o = c.assistProbeStep; o <= c.assistMaxOffset; o += c.assistProbeStep) {
      for (let s = 1; s >= -1; s -= 2) {
        const sx = bx + px * o * s;
        const sy = by + py * o * s;
        if (!this.isPositionFree(sx, sy, r) || !this.isPositionFree(sx + ux * c.assistLookAhead, sy + uy * c.assistLookAhead, r)) continue;
        const step = Math.min(o, len * c.assistSpeed);
        const inner = this.moveRaw(bx, by, r, px * step * s, py * step * s, this.inner);
        if (inner.x === bx && inner.y === by) continue;   // the side path itself is shut
        out.x = inner.x;
        out.y = inner.y;
        out.assisted = true;
        return;
      }
    }
  }

  /** moveCircle without the assist */
  moveRaw(x, y, r, dx, dy, out) {
    const c = this.cfg;
    const len = Math.sqrt(dx * dx + dy * dy);
    const startFree = this.isPositionFree(x, y, r);
    let steps = Math.ceil(len / (r * c.subStepFraction));
    if (!(steps >= 1)) steps = 1;
    if (steps > c.maxSubSteps) steps = c.maxSubSteps;
    const sx = dx / steps;
    const sy = dy / steps;
    let cx = x;
    let cy = y;
    let nx = 0;
    let ny = 0;
    for (let i = 0; i < steps; i++) {
      if (this.resolve(cx + sx, cy + sy, r) || !startFree) {
        if (this.lastNx !== 0 || this.lastNy !== 0) { nx = this.lastNx; ny = this.lastNy; }
        cx = this.cx; cy = this.cy;
      } else if (sx !== 0 && this.resolve(cx + sx, cy, r)) {
        cx = this.cx; cy = this.cy; nx = this.lastNx; ny = this.lastNy;
      } else if (sy !== 0 && this.resolve(cx, cy + sy, r)) {
        cx = this.cx; cy = this.cy; nx = this.lastNx; ny = this.lastNy;
      }
      // else: wedged; stay where the circle was free
    }
    const tol = c.epsilon;
    out.x = cx;
    out.y = cy;
    out.hitX = Math.abs(cx - x - dx) > tol;
    out.hitY = Math.abs(cy - y - dy) > tol;
    out.blocked = out.hitX || out.hitY;
    out.nx = out.blocked ? nx : 0;
    out.ny = out.blocked ? ny : 0;
    return out;
  }

  /**
   * The free position nearest to (x, y) within `maxSearch` px (a grid search of tuning.collision.freeSearchStep).
   * @param {{x:number,y:number}} out written on success
   * @returns {boolean} found (out holds (x, y) itself when that is free)
   */
  nearestFreePosition(x, y, r, maxSearch, out) {
    if (this.isPositionFree(x, y, r)) { out.x = x; out.y = y; return true; }
    const step = this.cfg.freeSearchStep;
    const rings = Math.ceil(maxSearch / step);
    let bestD2 = Infinity;
    let bx = 0;
    let by = 0;
    for (let k = 1; k <= rings; k++) {
      const ringMin = k * step;
      if (bestD2 <= ringMin * ringMin) break;   // nothing further out can be nearer
      for (let j = -k; j <= k; j++) {
        for (let side = 0; side < 4; side++) {
          // the four sides of the square ring; corners are visited by two sides, which is harmless
          const ox = side === 0 ? j : side === 1 ? j : side === 2 ? -k : k;
          const oy = side === 0 ? -k : side === 1 ? k : j;
          const d2 = (ox * ox + oy * oy) * step * step;
          if (d2 >= bestD2 || d2 > maxSearch * maxSearch) continue;
          const qx = x + ox * step;
          const qy = y + oy * step;
          if (this.isPositionFree(qx, qy, r)) { bestD2 = d2; bx = qx; by = qy; }
        }
      }
    }
    if (bestD2 === Infinity) return false;
    out.x = bx;
    out.y = by;
    return true;
  }

  /**
   * Line of sight: does the segment cross a blocked tile (grid traversal; the endpoints' own tiles count) or a
   * sight-blocking prop (circle strictly crossed; a prop containing an endpoint is ignored, so an entity standing
   * in or against cover still sees out)? Grazing a single tile corner exactly is clear; slipping between two
   * blocked tiles that touch only at a corner is blocked.
   * @param {{ props?: boolean }} [opts] props: also test props (default true)
   * @returns {boolean}
   */
  segmentBlocked(x0, y0, x1, y1, opts) {
    if (this.segmentBlockedByTiles(x0, y0, x1, y1)) return true;
    if (opts && opts.props === false) return false;
    return this.segmentBlockedByProps(x0, y0, x1, y1);
  }

  segmentBlockedByTiles(x0, y0, x1, y1) {
    const fx0 = x0 / TILE_W;
    const fy0 = y0 / TILE_H;
    const fx1 = x1 / TILE_W;
    const fy1 = y1 / TILE_H;
    let tx = Math.floor(fx0);
    let ty = Math.floor(fy0);
    if (this.blocked(tx, ty)) return true;
    const ddx = fx1 - fx0;
    const ddy = fy1 - fy0;
    const stepX = ddx > 0 ? 1 : -1;
    const stepY = ddy > 0 ? 1 : -1;
    const tDeltaX = ddx !== 0 ? 1 / Math.abs(ddx) : Infinity;
    const tDeltaY = ddy !== 0 ? 1 / Math.abs(ddy) : Infinity;
    let tMaxX = ddx > 0 ? (tx + 1 - fx0) / ddx : ddx < 0 ? (fx0 - tx) / -ddx : Infinity;
    let tMaxY = ddy > 0 ? (ty + 1 - fy0) / ddy : ddy < 0 ? (fy0 - ty) / -ddy : Infinity;
    let guard = Math.abs(Math.floor(fx1) - tx) + Math.abs(Math.floor(fy1) - ty) + 2;
    while (guard-- > 0) {
      if (tMaxX < tMaxY) {
        if (tMaxX > 1) break;
        tx += stepX; tMaxX += tDeltaX;
      } else if (tMaxY < tMaxX) {
        if (tMaxY > 1) break;
        ty += stepY; tMaxY += tDeltaY;
      } else {
        if (!(tMaxX <= 1)) break;   // also both Infinity: a zero-length segment
        // exactly through a tile corner: blocked only when both tiles beside the corner are
        if (this.blocked(tx + stepX, ty) && this.blocked(tx, ty + stepY)) return true;
        tx += stepX; ty += stepY; tMaxX += tDeltaX; tMaxY += tDeltaY;
      }
      if (this.blocked(tx, ty)) return true;
    }
    return false;
  }

  segmentBlockedByProps(x0, y0, x1, y1) {
    const reach = this.map.maxPropReach;
    const props = this.map.propsInRect(Math.min(x0, x1) - reach, Math.min(y0, y1) - reach, Math.max(x0, x1) + reach, Math.max(y0, y1) + reach, this.props);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l2 = dx * dx + dy * dy;
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (!(p.radius > 0) || !this.propBlocksSight(p)) continue;
      const r2 = p.radius * p.radius;
      const ax = p.x - x0;
      const ay = p.y - y0;
      const bx = p.x - x1;
      const by = p.y - y1;
      if (ax * ax + ay * ay <= r2 || bx * bx + by * by <= r2) continue;   // an endpoint stands in it
      let t = l2 > 0 ? (ax * dx + ay * dy) / l2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const qx = ax - dx * t;
      const qy = ay - dy * t;
      if (qx * qx + qy * qy < r2) return true;
    }
    return false;
  }
}

// ---- terrain movement rules ------------------------------------------------------------------------------------

/**
 * Terrain rules from tuning.terrain, as tables indexed by terrain id.
 * @param {Object} tuning the whole tuning object
 */
export function terrainRules(tuning) {
  const t = tuning?.terrain;
  if (!t) throw new Error('collision: tuning.terrain is missing');
  const speed = new Float64Array(TERRAINS.length);
  const rank = new Int8Array(TERRAINS.length);
  TERRAINS.forEach((name, i) => {
    const e = t[name] ?? {};
    speed[i] = typeof e.speed === 'number' ? e.speed : 1;
    const m = e.mode ?? 'ground';
    if (!(m in MODE_RANK)) throw new Error(`collision: tuning.terrain.${name}.mode "${m}" is not one of ${MODES.join(', ')}`);
    rank[i] = MODE_RANK[m];
  });
  return Object.freeze({
    speed, rank,
    swimSpeed: need(t.swimSpeed, 'terrain.swimSpeed'),
    floodWadeSpeed: need(t.floodWadeSpeed, 'terrain.floodWadeSpeed'),
    /** tuning.water, for water.js isDeepFlood: when flooded ground is swum (the same rule the water classes use) */
    water: Object.freeze({ deepMargin: need(tuning.water?.deepMargin, 'water.deepMargin') }),
    modeExitMargin: need(t.modeExitMargin, 'terrain.modeExitMargin'),
    lowTide: need(t.lowTide, 'terrain.lowTide'),
  });
}

/** mode rank (0 ground, 1 wade, 2 swim) of the ground at a world point */
export function modeRankAt(map, x, y, tideHeight, rules) {
  const tx = Math.floor(x / TILE_W);
  const ty = Math.floor(y / TILE_H);
  let r = rules.rank[map.terrainIdAt(tx, ty)];
  if (r < 2 && map.isFlooded(tx, ty, tideHeight)) {
    const depth = tideHeight - map.floodThreshold(map.floodLevel(tx, ty));
    const f = isDeepFlood(depth, rules.water) ? 2 : 1;
    if (f > r) r = f;
  }
  return r;
}

/**
 * The movement rule at a world point, without hysteresis: what the AI, bots and audits use.
 * @param {import('./IslandMap.js').IslandMap} map
 * @param {number} x
 * @param {number} y
 * @param {number} tideHeight 0..1
 * @param {ReturnType<typeof terrainRules>} rules
 * @param {{terrain:string,mode:string,speed:number}} [out]
 * @returns {{ terrain: string, mode: 'ground'|'wade'|'swim', speed: number }} speed is a multiplier of walk speed
 */
export function terrainMove(map, x, y, tideHeight, rules, out = { terrain: '', mode: 'ground', speed: 1 }) {
  const id = map.terrainIdAt(Math.floor(x / TILE_W), Math.floor(y / TILE_H));
  const rank = modeRankAt(map, x, y, tideHeight, rules);
  out.terrain = TERRAINS[id];
  out.mode = MODES[rank];
  out.speed = speedFor(id, rank, rank, rules);
  return out;
}

/**
 * Walk-speed multiplier for a terrain under the feet and the entity's current mode.
 * @param {number} terrainId
 * @param {number} rankHere the raw mode rank of the point (flooding included)
 * @param {number} modeRank the entity's mode (with hysteresis)
 */
export function speedFor(terrainId, rankHere, modeRank, rules) {
  if (modeRank === 2) return rules.swimSpeed;
  let s = rules.speed[terrainId];
  if (rankHere === 1 && rules.rank[terrainId] === 0 && rules.floodWadeSpeed < s) s = rules.floodWadeSpeed;   // flooded ground
  return s;
}

/**
 * The next movement mode with hysteresis: deeper water is entered at once; a shallower mode is taken only when
 * the ground point and four points `modeExitMargin` px around it all allow it, so a shoreline does not flicker.
 * @param {number} current rank
 * @returns {number} rank
 */
export function nextModeRank(map, x, y, tideHeight, current, rules) {
  const raw = modeRankAt(map, x, y, tideHeight, rules);
  if (raw >= current) return raw;
  const m = rules.modeExitMargin;
  let worst = raw;
  let r = modeRankAt(map, x + m, y, tideHeight, rules); if (r > worst) worst = r;
  r = modeRankAt(map, x - m, y, tideHeight, rules); if (r > worst) worst = r;
  r = modeRankAt(map, x, y + m, tideHeight, rules); if (r > worst) worst = r;
  r = modeRankAt(map, x, y - m, tideHeight, rules); if (r > worst) worst = r;
  return worst < current ? worst : current;
}

export { MODE_RANK, TERRAIN_ID };
