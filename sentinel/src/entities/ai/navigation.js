// How scouts move (steps 4.1, 4.2): the movement rule (no swimming, never into a safe zone), straight walks
// checked by the collider, and paths from the bounded A* (src/world/pathfind.js) when the straight way is shut.
// The collider does the fine movement and the sliding; a scout that cannot get somewhere gives up and says so,
// it never walks through a wall.
import { TILE_W, TILE_H, DT } from '../../sim/constants.js';
import { modeRankAt, terrainMove } from '../../world/collision.js';
import { findPath } from '../../world/pathfind.js';
import { facingFor } from '../Player.js';
import { inSafeZone } from './env.js';

const propScratch = [];
const probe = { terrain: '', mode: 'ground', speed: 1 };

/**
 * May a scout stand at this world point? Not in swimming-depth water (deep water, or ground flooded past the
 * swim depth right now), not inside a safe zone. Walls and props are the collider's business.
 */
export function scoutMayStand(sim, x, y) {
  if (sim.map && modeRankAt(sim.map, x, y, sim.tideHeight(), sim.terrainRules) >= 2) return false;
  return !inSafeZone(sim, x, y);
}

/**
 * The tile rule for the pathfinder: not blocked, not swimming depth, not in a safe zone, and no solid prop over
 * the tile centre (a cheap occupancy test through the map's prop index; the collider steers round the rest).
 */
export function scoutTilePassable(sim, tx, ty, radius) {
  const map = sim.map;
  if (!map.inBounds(tx, ty) || map.isBlocked(tx, ty)) return false;
  const cx = (tx + 0.5) * TILE_W;
  const cy = (ty + 0.5) * TILE_H;
  if (!scoutMayStand(sim, cx, cy)) return false;
  const props = map.propsNear(cx, cy, map.maxPropReach + radius, propScratch);
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    if (!(p.radius > 0) && p.blocker !== true) continue;
    const rr = p.radius + radius;
    const dx = p.x - cx;
    const dy = p.y - cy;
    if (dx * dx + dy * dy < rr * rr) return false;
  }
  return true;
}

/** extra path cost of a tile: wading is slow, so scouts keep to dry ground where they can */
export function scoutTileCost(sim, tx, ty, wadePenalty) {
  return modeRankAt(sim.map, (tx + 0.5) * TILE_W, (ty + 0.5) * TILE_H, sim.tideHeight(), sim.terrainRules) === 1 ? wadePenalty : 0;
}

/**
 * Can a scout walk straight from a to b? Samples every `step` px: each must be a free spot for its body and a
 * place it may stand.
 */
export function lineOfWalk(sim, ax, ay, bx, by, radius, step) {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.sqrt(dx * dx + dy * dy);
  const n = Math.max(1, Math.ceil(d / step));
  const c = sim.collider;
  for (let i = 1; i <= n; i++) {
    const x = ax + (dx * i) / n;
    const y = ay + (dy * i) / n;
    if (c && !c.isPositionFree(x, y, radius)) return false;
    if (!scoutMayStand(sim, x, y)) return false;
  }
  return true;
}

/**
 * One tick of movement towards (tx, ty) at `speed` px/s (times the terrain's speed when `terrain` is set).
 * The step is refused if it would end in swimming-depth water or a safe zone; otherwise the collider slides it.
 * Facing follows the motion.
 * @returns {'arrived'|'moving'|'blocked'} arrived: within `arrive` px of the target after the step
 */
export function stepToward(sim, s, tx, ty, speed, arrive, terrain = false) {
  const dx = tx - s.x;
  const dy = ty - s.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= arrive) return 'arrived';
  let v = speed;
  if (terrain && sim.map) v *= terrainMove(sim.map, s.x, s.y, sim.tideHeight(), sim.terrainRules, probe).speed;
  const step = v * DT < d ? v * DT : d;
  const mx = (dx / d) * step;
  const my = (dy / d) * step;
  s.dirX = dx / d;
  s.dirY = dy / d;
  s.facing = facingFor(s.dirX, s.dirY, s.facing);
  // a scout caught by the rising tide (or standing in a zone that appeared) may always walk out of it
  const free = scoutMayStand(sim, s.x, s.y);
  if (free && !scoutMayStand(sim, s.x + mx, s.y + my)) { s.blockedTicks += 1; return 'blocked'; }
  const c = sim.collider;
  let nx = s.x + mx;
  let ny = s.y + my;
  if (c) {
    const r = c.moveCircle(s.x, s.y, s.radius, mx, my, s.contact);
    nx = r.x;
    ny = r.y;
    // the slide must not carry the body into deep water or a safe zone either
    if (free && !scoutMayStand(sim, nx, ny)) { s.blockedTicks += 1; return 'blocked'; }
  }
  const mvx = nx - s.x;
  const mvy = ny - s.y;
  const moved2 = mvx * mvx + mvy * mvy;
  s.x = nx;
  s.y = ny;
  // progress: less than a quarter of the step for a while means stuck (the caller repaths or gives up)
  if (moved2 < step * step * 0.0625) s.blockedTicks += 1;
  else s.blockedTicks = 0;
  const ex = tx - s.x;
  const ey = ty - s.y;
  const e2 = ex * ex + ey * ey;
  if (e2 <= arrive * arrive) return 'arrived';
  // a goal the body cannot quite stand on (a waypoint against a trunk): close enough once it stops making progress
  const slack = sim.tuning.ai.path.arriveSlack;
  return s.blockedTicks >= 2 && e2 <= slack * slack ? 'arrived' : 'moving';
}

/**
 * Plan a path for a scout to (gx, gy) with the bounded A*, string-pulled by line of walk.
 * @returns {import('../../world/pathfind.js').PathResult}
 */
export function planPath(sim, s, gx, gy, cfg) {
  const map = sim.map;
  return findPath({
    sx: s.x, sy: s.y, tx: gx, ty: gy, width: map.width, height: map.height,
    passable: (tx, ty) => scoutTilePassable(sim, tx, ty, s.radius),
    cost: (tx, ty) => scoutTileCost(sim, tx, ty, cfg.wadePenalty),
    lineOfWalk: (ax, ay, bx, by) => lineOfWalk(sim, ax, ay, bx, by, s.radius, cfg.walkCheckStep),
    margin: cfg.windowMargin, maxWindow: cfg.maxWindow, maxNodes: cfg.maxNodes,
  });
}
