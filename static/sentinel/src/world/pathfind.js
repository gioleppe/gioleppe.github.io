// Bounded, deterministic A* on the tile grid (step 4.2): scouts going off their route, and later the bots (V3),
// which pass their own movement rule. Simulation side: integer costs, no floating maths in the search, a binary
// heap whose ties break by insertion order, so Node and every browser expand the same nodes in the same order.
//
// The search never looks at the whole island: it runs inside a window of tiles around the start and the goal
// (clipped to the map) and stops after `maxNodes` expansions. A goal it cannot reach (blocked, outside the window,
// over budget) gives the best partial path: to the expanded tile closest to the goal, so a caller can go "as near
// as possible" or give up. The fine movement is the collider's: the path is a list of world points (tile centres,
// then string-pulled with the caller's line-of-walk test so a scout walks straight where it can).
//
// Step costs in world px of the oblique tile: 32 across, 24 down, 40 on a diagonal (exactly sqrt(32² + 24²)).
// A diagonal step needs both orthogonal neighbours passable (no cutting a corner). `cost(tx, ty)` may add a
// whole-number penalty per tile entered (wading is slow, so scouts prefer dry ground).
import { TILE_W, TILE_H } from '../sim/constants.js';

const STEP_X = TILE_W;   // 32
const STEP_Y = TILE_H;   // 24
const STEP_D = 40;       // sqrt(32² + 24²)

/** octile distance in world px between two tiles (admissible: no path is shorter) */
export function tileHeuristic(ax, ay, bx, by) {
  const dx = ax > bx ? ax - bx : bx - ax;
  const dy = ay > by ? ay - by : by - ay;
  const m = dx < dy ? dx : dy;
  return m * STEP_D + (dx - m) * STEP_X + (dy - m) * STEP_Y;
}

// scratch shared by every search (simulation code is single-threaded): grown on demand, never shrunk, reset by
// a generation stamp instead of clearing
let cap = 0;
let stamp = new Uint32Array(0);
let gScore = new Int32Array(0);
let parent = new Int32Array(0);
let closed = new Uint32Array(0);
let heapNode = new Int32Array(0);
let heapF = new Int32Array(0);
let heapSeq = new Int32Array(0);
let passStamp = new Uint32Array(0);
let passVal = new Uint8Array(0);
let generation = 0;

function ensure(n) {
  if (n <= cap) return;
  cap = Math.max(n, cap * 2, 1024);
  stamp = new Uint32Array(cap);
  gScore = new Int32Array(cap);
  parent = new Int32Array(cap);
  closed = new Uint32Array(cap);
  heapNode = new Int32Array(cap * 8 + 8);
  heapF = new Int32Array(cap * 8 + 8);
  heapSeq = new Int32Array(cap * 8 + 8);
  passStamp = new Uint32Array(cap);
  passVal = new Uint8Array(cap);
  generation = 0;
}

/** min-heap on (f, seq): equal f values come out in the order they went in */
const less = (i, j) => heapF[i] < heapF[j] || (heapF[i] === heapF[j] && heapSeq[i] < heapSeq[j]);
function swap(i, j) {
  let t = heapNode[i]; heapNode[i] = heapNode[j]; heapNode[j] = t;
  t = heapF[i]; heapF[i] = heapF[j]; heapF[j] = t;
  t = heapSeq[i]; heapSeq[i] = heapSeq[j]; heapSeq[j] = t;
}

/**
 * @typedef {Object} PathRequest
 * @property {number} sx  start, world px
 * @property {number} sy
 * @property {number} tx  goal, world px
 * @property {number} ty
 * @property {number} width   map size in tiles
 * @property {number} height
 * @property {(tx: number, ty: number) => boolean} passable  may an agent stand on this tile? (its movement rule)
 * @property {(tx: number, ty: number) => number} [cost]     extra whole px for entering a tile (default 0)
 * @property {(ax: number, ay: number, bx: number, by: number) => boolean} [lineOfWalk]  a straight walk between two
 *   world points is clear (for string pulling; without it the tile path is returned as it is)
 * @property {number} [margin]    tiles added around the start/goal box to make the search window (default 12)
 * @property {number} [maxWindow] the window's longest side in tiles (default 96)
 * @property {number} [maxNodes]  expansions allowed (default 2000)
 */

/**
 * @typedef {Object} PathResult
 * @property {'found'|'partial'|'none'} status  found: to the goal tile; partial: to the expanded tile nearest the
 *   goal (goal unreachable, outside the window or over budget); none: no step brings the agent nearer (the start
 *   itself is never tested: an agent may stand on a tile the rule calls closed, and walks out of it)
 * @property {Array<{x: number, y: number}>} points world px, start excluded, the last is the goal itself when found
 * @property {number} expanded   nodes expanded (the cost of the call)
 * @property {boolean} exhausted the node budget ran out
 */

/**
 * Find a path. Pure: the same request gives the same answer everywhere.
 * @param {PathRequest} req
 * @returns {PathResult}
 */
export function findPath(req) {
  const { sx, sy, tx, ty, width, height, passable } = req;
  const cost = req.cost ?? null;
  const margin = req.margin ?? 12;
  const maxWindow = req.maxWindow ?? 96;
  const maxNodes = req.maxNodes ?? 2000;
  const s0x = Math.floor(sx / TILE_W);
  const s0y = Math.floor(sy / TILE_H);
  const g0x = Math.floor(tx / TILE_W);
  const g0y = Math.floor(ty / TILE_H);
  const out = { status: 'none', points: [], expanded: 0, exhausted: false };
  if (!(s0x >= 0 && s0y >= 0 && s0x < width && s0y < height)) return out;
  if (s0x === g0x && s0y === g0y) {
    out.status = 'found';
    out.points.push({ x: tx, y: ty });
    return out;
  }

  // the window: the box of start and goal plus a margin, at most maxWindow tiles on a side, centred on the start
  // when it has to be cut (the start must be inside; the goal may fall outside and give a partial path)
  let wx0 = Math.min(s0x, g0x) - margin;
  let wy0 = Math.min(s0y, g0y) - margin;
  let wx1 = Math.max(s0x, g0x) + margin;
  let wy1 = Math.max(s0y, g0y) + margin;
  const half = maxWindow >> 1;
  if (wx1 - wx0 + 1 > maxWindow) { wx0 = Math.max(wx0, s0x - half); wx1 = wx0 + maxWindow - 1; }
  if (wy1 - wy0 + 1 > maxWindow) { wy0 = Math.max(wy0, s0y - half); wy1 = wy0 + maxWindow - 1; }
  if (wx0 < 0) wx0 = 0;
  if (wy0 < 0) wy0 = 0;
  if (wx1 > width - 1) wx1 = width - 1;
  if (wy1 > height - 1) wy1 = height - 1;
  const ww = wx1 - wx0 + 1;
  const wh = wy1 - wy0 + 1;
  ensure(ww * wh);
  generation += 1;
  if (generation >= 0xffffffff) { stamp.fill(0); closed.fill(0); passStamp.fill(0); generation = 1; }
  const gen = generation;

  const inWin = (x, y) => x >= wx0 && y >= wy0 && x <= wx1 && y <= wy1;
  const startIdx = (s0y - wy0) * ww + (s0x - wx0);
  let heapLen = 0;
  let seq = 0;
  const push = (node, f) => {
    let i = heapLen++;
    heapNode[i] = node; heapF[i] = f; heapSeq[i] = seq++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(i, p)) break;
      swap(i, p);
      i = p;
    }
  };
  const pop = () => {
    const node = heapNode[0];
    heapLen -= 1;
    if (heapLen > 0) {
      heapNode[0] = heapNode[heapLen]; heapF[0] = heapF[heapLen]; heapSeq[0] = heapSeq[heapLen];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heapLen && less(l, m)) m = l;
        if (r < heapLen && less(r, m)) m = r;
        if (m === i) break;
        swap(i, m);
        i = m;
      }
    }
    return node;
  };
  // passable() is asked at most once per tile per search (it may be a prop query)
  const open = (x, y) => {
    const i = (y - wy0) * ww + (x - wx0);
    if (passStamp[i] !== gen) { passStamp[i] = gen; passVal[i] = passable(x, y) === true ? 1 : 0; }
    return passVal[i] === 1;
  };

  stamp[startIdx] = gen;
  gScore[startIdx] = 0;
  parent[startIdx] = -1;
  push(startIdx, tileHeuristic(s0x, s0y, g0x, g0y));
  let best = startIdx;
  let bestH = tileHeuristic(s0x, s0y, g0x, g0y);
  let found = -1;
  let expanded = 0;
  // neighbour offsets: E W S N, then the diagonals (fixed order: part of the determinism)
  const NX = [1, -1, 0, 0, 1, -1, 1, -1];
  const NY = [0, 0, 1, -1, 1, 1, -1, -1];
  const NC = [STEP_X, STEP_X, STEP_Y, STEP_Y, STEP_D, STEP_D, STEP_D, STEP_D];
  const ok = [false, false, false, false];
  while (heapLen > 0) {
    const node = pop();
    if (closed[node] === gen) continue;
    closed[node] = gen;
    const x = wx0 + (node % ww);
    const y = wy0 + ((node / ww) | 0);
    if (x === g0x && y === g0y) { found = node; break; }
    if (expanded >= maxNodes) { out.exhausted = true; break; }
    expanded += 1;
    const g = gScore[node];
    for (let k = 0; k < 8; k++) {
      const nx = x + NX[k];
      const ny = y + NY[k];
      if (k >= 4) {
        // a diagonal only past two open orthogonal neighbours
        const a = NX[k] > 0 ? 0 : 1;
        const b = NY[k] > 0 ? 2 : 3;
        if (!ok[a] || !ok[b]) continue;
      }
      const pass = inWin(nx, ny) && open(nx, ny);
      if (k < 4) ok[k] = pass;
      if (!pass) continue;
      const ni = (ny - wy0) * ww + (nx - wx0);
      if (closed[ni] === gen) continue;
      const ng = g + NC[k] + (cost ? cost(nx, ny) | 0 : 0);
      if (stamp[ni] === gen && gScore[ni] <= ng) continue;
      stamp[ni] = gen;
      gScore[ni] = ng;
      parent[ni] = node;
      const h = tileHeuristic(nx, ny, g0x, g0y);
      push(ni, ng + h);
      if (h < bestH) { bestH = h; best = ni; }
    }
  }
  out.expanded = expanded;
  const end = found >= 0 ? found : best;
  if (end === startIdx && found < 0) {
    // no tile nearer the goal than where the agent stands: nowhere to go
    out.status = 'none';
    return out;
  }
  // walk back to the start, then string-pull
  const tiles = [];
  for (let n = end; n !== -1 && n !== startIdx; n = parent[n]) tiles.push(n);
  tiles.reverse();
  const pts = tiles.map((n) => ({ x: (wx0 + (n % ww) + 0.5) * TILE_W, y: (wy0 + ((n / ww) | 0) + 0.5) * TILE_H }));
  if (found >= 0) pts[pts.length - 1] = { x: tx, y: ty };
  out.status = found >= 0 ? 'found' : 'partial';
  out.points = req.lineOfWalk ? stringPull(sx, sy, pts, req.lineOfWalk) : pts;
  return out;
}

/**
 * Drop the waypoints a straight walk can skip: from each anchor, the furthest later point in a clear line.
 * @param {number} sx
 * @param {number} sy
 * @param {Array<{x:number,y:number}>} pts
 * @param {(ax: number, ay: number, bx: number, by: number) => boolean} clear
 * @returns {Array<{x:number,y:number}>}
 */
export function stringPull(sx, sy, pts, clear) {
  const out = [];
  let ax = sx;
  let ay = sy;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !clear(ax, ay, pts[j].x, pts[j].y)) j--;
    out.push(pts[j]);
    ax = pts[j].x;
    ay = pts[j].y;
    i = j + 1;
  }
  return out;
}
