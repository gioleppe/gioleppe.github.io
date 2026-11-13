// Side quests, defined in data/manifest.json ("quests"). A quest starts when its start condition holds,
// and each step is done when its condition holds; steps after the first not-done step wait.
//   quest: { id, name, giver: { zone, npc }, offer?: false, start: cond, steps: [{ text, done: cond, ready?: cond, npc?: { zone, id } }] }
//   offer: false means the quest starts by itself (a flag, an event), so its giver shows no "!" beforehand
//   cond:  { flag } | { has: itemId, n? } | { defeated: trainerId } | { caught: n } | { caughtSpecies: id } | { partyType: type }
//          | { bands: n } | { hour: [from, to] } (on the festival clock, to exclusive) | { intox: level }
//          | { set: id } (a set on the festival timetable is playing)
//          | { not: cond } | { any: [cond] } | { all: [cond] }     (partyType and set need data: check(s, c, data))
import { setOn } from './timetable.js';
export function check(s, c, data) {
  if (!c) return true;
  if (c.not) return !check(s, c.not, data);
  if (c.any) return c.any.some((x) => check(s, x, data));
  if (c.all) return c.all.every((x) => check(s, x, data));
  if (c.flag) return !!s.flags[c.flag];
  if (c.has) return (s.bag[c.has] || 0) >= (c.n || 1);
  if (c.caughtSpecies) return !!s.dex.caught[c.caughtSpecies];
  if (c.partyType) return !!data && s.party.some((m) => data.dex[m.speciesId].types.includes(c.partyType));
  if (c.defeated) return !!s.defeated[c.defeated];
  if (c.caught !== undefined) return Object.keys(s.dex.caught).length >= c.caught;
  if (c.bands !== undefined) return s.wristbands.length >= c.bands;
  if (c.party !== undefined) return (s.party || []).length >= c.party;   // how many Astrals you carry (the trail's ranger)
  if (c.hour) { const h = Math.floor(s.clock / 60) % 24; return h >= c.hour[0] && h < c.hour[1]; }
  if (c.intox !== undefined) return s.intox >= c.intox;
  if (c.set) return !!data && setOn(data, s, c.set);
  return false;
}

/** every quest with its state: 'hidden' (not started), 'active' or 'done', and the step to do next */
export function questLog(data, s) {
  return (data.manifest.quests || []).map((q) => {
    const steps = q.steps.map((st) => ({ ...st, isDone: check(s, st.done, data) }));
    const done = steps.every((st) => st.isDone);
    const started = done || check(s, q.start, data) || (!q.start && steps.some((st) => st.isDone));
    const next = steps.find((st) => !st.isDone) || null;
    return { ...q, steps, state: done ? 'done' : started ? 'active' : 'hidden', next };
  });
}

/** what an NPC has for you: '!' a quest to start, '?' a step to hand in, or null */
export function questMarker(data, s, zoneId, npcId) {
  for (const q of questLog(data, s)) {
    if (q.state === 'hidden' && q.offer !== false && q.giver?.zone === zoneId && q.giver?.npc === npcId && check(s, q.available, data)) return '!';
    if (q.state === 'active' && q.next?.npc?.zone === zoneId && q.next.npc.id === npcId && check(s, q.next.ready, data)) return '?';
  }
  return null;
}
