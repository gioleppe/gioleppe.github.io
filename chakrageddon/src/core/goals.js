// Where to go next. The story order lives in data/manifest.json ("goals"); the current goal is the
// first one not yet done, and the route hint walks the zone graph (warps) towards it.
//   goal: { id, zone, trainer?, text?, done: { flag } | { defeated } }

import { canUse } from './OverworldEngine.js';

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
    return `Beat ${t.name} in ${midName(data.zones[g.zone].name)}${band ? ` for the ${band.name}` : ''}.`;
  }
  return `Go to ${midName(data.zones[g.zone]?.name || 'the next place')}.`;
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

/** first zone on the shortest warp path from `from` to `to` (null when unreachable or already there).
 *  With a state, exits that need a field technique the player cannot use yet are skipped. */
export function nextZone(data, from, to, state = null) {
  if (!to || from === to) return null;
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

/** a short line telling the player which way to go for the current goal */
export function routeHint(data, s, goal = currentGoal(data, s)) {
  if (!goal || !goal.zone) return null;
  const here = data.zones[s.zoneId];
  if (s.zoneId === goal.zone) {
    const npcId = goal.npc || (goal.trainer && (here.npcs || []).find((n) => n.trainer === goal.trainer)?.id);
    const n = npcId && (here.npcs || []).find((x) => x.id === npcId);
    if (!n) return { text: 'It is somewhere in this area.', zone: goal.zone };
    const who = goal.who || (goal.trainer ? data.trainers[goal.trainer].name : 'Your goal'), where = compass(n.x - s.player.x, n.y - s.player.y);
    return { text: `${who} ${where === 'right here' ? 'is right here' : `is to the ${where}`}.`, zone: goal.zone };
  }
  const nz = nextZone(data, s.zoneId, goal.zone, s);
  if (!nz) return { text: `Find a way to ${midName(data.zones[goal.zone].name)}.`, zone: goal.zone };
  if (here.interior && nz === here.parent) return { text: `Next: go back outside to ${midName(data.zones[nz].name)}.`, zone: goal.zone, next: nz, side: 'out' };
  const w = (here.warps || []).find((x) => x.to === nz);
  const side = w ? (data.zones[nz].interior ? 'through the door' : warpSide(here, w)) : '';
  return { text: `Next: ${side === 'through the door' ? 'go through the door' : `head ${side}`} to ${midName(data.zones[nz].name)}.`, zone: goal.zone, next: nz, side };
}
