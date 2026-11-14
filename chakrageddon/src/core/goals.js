// Where to go next. The story order lives in data/manifest.json ("goals"); the current goal is the
// first one not yet done, and the route hint walks the zone graph (warps) towards it.
//   goal: { id, zone, trainer?, text?, done: { flag } | { defeated } }

import { tl } from './i18n.js';
import { canUse, passable } from './OverworldEngine.js';

/** a zone name in the middle of a sentence: "The Poi Pit" -> "the Poi Pit" */
export const midName = (name) => String(name).replace(/^The /, 'the ');
const isDone = (s, g) => (g.done?.flag ? !!s.flags[g.done.flag] : g.done?.defeated ? !!s.defeated[g.done.defeated] : false);

/** the first goal not yet done, with its text filled in; null when the list is exhausted */
export function currentGoal(data, s) {
  const goals = data.manifest.goals || [];
  for (let i = 0; i < goals.length; i++) {
    const g = goals[i];
    if (g.done && isDone(s, g)) continue;
    return { ...g, index: i, text: goalText(data, g) };
  }
  return null;
}

export function goalText(data, g) {
  if (g.text) return g.text;
  const t = g.trainer && data.trainers[g.trainer];
  if (t) {
    const band = data.rules.wristbands?.[t.wristband];
    return band ? tl('Beat {0} in {1} for the {2}.', t.name, midName(data.zones[g.zone].name), band.name) : tl('Beat {0} in {1}.', t.name, midName(data.zones[g.zone].name));
  }
  return tl('Go to {0}.', midName(data.zones[g.zone]?.name || tl('the next place')));
}

/** which edge of a zone a warp sits on */
export function warpSide(zone, w) {
  const H = zone.rows.length, W = zone.rows[0].length;
  if (w.y <= 0) return 'north';
  if (w.y >= H - 1) return 'south';
  if (w.x <= 0) return 'west';
  if (w.x >= W - 1) return 'east';
  return 'through the door';
}

/** the walkable areas of a zone as the player can use it now: "x,y" -> area number (a map split by the cow has two) */
function areasOf(data, state, zoneId, memo) {
  if (memo.has(zoneId)) return memo.get(zoneId);
  const z = data.zones[zoneId], ctx = { data, state }, W = z.rows[0].length, H = z.rows.length, area = new Map();
  let n = 0;
  for (let y0 = 0; y0 < H; y0++) for (let x0 = 0; x0 < W; x0++) {
    const k0 = `${x0},${y0}`;
    if (area.has(k0) || !passable(ctx, x0, y0, z)) continue;
    area.set(k0, n); const q = [[x0, y0]];
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || area.has(k) || !passable(ctx, nx, ny, z)) continue;
        area.set(k, n); q.push([nx, ny]);
      }
    }
    n++;
  }
  memo.set(zoneId, area);
  return area;
}
/** the area a tile belongs to; a warp on a blocked tile (a door in a wall) belongs to the floor beside it */
function areaAt(area, x, y) {
  for (const [dx, dy] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) { const a = area.get(`${x + dx},${y + dy}`); if (a !== undefined) return a; }
  return -1;
}

/** the first warp to take from where the player stands towards zone `to`, walking areas rather than zones, so a road cut in
 *  two by a cow sends you round the detour instead of up to the cow. skip: warps known to be blocked ("zone:x,y").
 *  Returns { warp, next } or null (already there, or no way from here). */
export function routeWarp(data, s, to, skip = null) {
  if (!to || !s?.player || s.zoneId === to || !data.zones[s.zoneId]) return null;
  const memo = new Map(), node = (z, a) => `${z}#${a}`;
  const start = node(s.zoneId, areaAt(areasOf(data, s, s.zoneId, memo), s.player.x, s.player.y));
  const prev = new Map([[start, null]]), q = [start];
  while (q.length) {
    const cur = q.shift(), [z, a] = cur.split('#');
    if (z === to) { let c = cur; while (prev.get(c).from !== start) c = prev.get(c).from; return { warp: prev.get(c).warp, next: c.split('#')[0] }; }
    const area = areasOf(data, s, z, memo);
    for (const w of data.zones[z].warps || []) {
      if (!data.zones[w.to] || (w.needs && !canUse({ data, state: s }, w.needs)) || skip?.has(`${z}:${w.x},${w.y}`)) continue;
      if (String(areaAt(area, w.x, w.y)) !== a) continue;
      const nx = node(w.to, areaAt(areasOf(data, s, w.to, memo), w.tx, w.ty));
      if (prev.has(nx)) continue;
      prev.set(nx, { from: cur, warp: w }); q.push(nx);
    }
  }
  return null;
}

/** first zone on the shortest warp path from `from` to `to` (null when unreachable or already there).
 *  With a state, exits that need a field technique the player cannot use yet are skipped, and from where the player
 *  stands the route follows the areas you can actually walk (routeWarp). */
export function nextZone(data, from, to, state = null) {
  if (!to || from === to) return null;
  if (state && state.zoneId === from) { const r = routeWarp(data, state, to); if (r) return r.next; }
  const prev = new Map([[from, null]]), q = [from];
  while (q.length) {
    const z = q.shift();
    if (z === to) { let c = z; while (prev.get(c) !== from) c = prev.get(c); return c; }
    for (const w of data.zones[z].warps || []) {
      if (prev.has(w.to) || (w.needs && state && !canUse({ data, state }, w.needs))) continue;
      prev.set(w.to, z); q.push(w.to);
    }
  }
  return null;
}

/** compass words for a vector on the map (y grows southwards) */
function compass(dx, dy) {
  const ns = dy < -1 ? 'north' : dy > 1 ? 'south' : '', ew = dx < -1 ? 'west' : dx > 1 ? 'east' : '';
  return ns && ew ? `${ns}-${ew}` : ns || ew || 'right here';
}

/** the "who is where" and "head there" sentences, one whole sentence each so a translation can bend them */
const IS_AT = {
  'right here': (w) => tl('{0} is right here.', w),
  north: (w) => tl('{0} is to the north.', w), south: (w) => tl('{0} is to the south.', w),
  west: (w) => tl('{0} is to the west.', w), east: (w) => tl('{0} is to the east.', w),
  'north-west': (w) => tl('{0} is to the north-west.', w), 'north-east': (w) => tl('{0} is to the north-east.', w),
  'south-west': (w) => tl('{0} is to the south-west.', w), 'south-east': (w) => tl('{0} is to the south-east.', w),
};
const HEAD_TO = {
  'through the door': (p) => tl('Next: go through the door to {0}.', p),
  north: (p) => tl('Next: head north to {0}.', p), south: (p) => tl('Next: head south to {0}.', p),
  west: (p) => tl('Next: head west to {0}.', p), east: (p) => tl('Next: head east to {0}.', p),
};

/** a short line telling the player which way to go for the current goal */
export function routeHint(data, s, goal = currentGoal(data, s)) {
  if (!goal || !goal.zone) return null;
  const here = data.zones[s.zoneId];
  if (s.zoneId === goal.zone) {
    const npcId = goal.npc || (goal.trainer && (here.npcs || []).find((n) => n.trainer === goal.trainer)?.id);
    const n = npcId && (here.npcs || []).find((x) => x.id === npcId);
    if (!n) return { text: tl('It is somewhere in this area.'), zone: goal.zone };
    const who = goal.who || (goal.trainer ? data.trainers[goal.trainer].name : tl('Your goal')), where = compass(n.x - s.player.x, n.y - s.player.y);
    return { text: IS_AT[where](who), zone: goal.zone };
  }
  const nz = nextZone(data, s.zoneId, goal.zone, s);
  if (!nz) return { text: tl('Find a way to {0}.', midName(data.zones[goal.zone].name)), zone: goal.zone };
  if (here.interior && nz === here.parent) return { text: tl('Next: go back outside to {0}.', midName(data.zones[nz].name)), zone: goal.zone, next: nz, side: 'out' };
  const w = routeWarp(data, s, goal.zone)?.warp || (here.warps || []).find((x) => x.to === nz);
  const side = w ? (data.zones[nz].interior ? 'through the door' : warpSide(here, w)) : '';
  return { text: HEAD_TO[side || 'through the door'](midName(data.zones[nz].name)), zone: goal.zone, next: nz, side };
}
