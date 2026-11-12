// The festival timetable (IMPROVEMENTS.md point 2). From the third wristband Banyan brings you the schedule
// (flag "timetable"); after that, at set times a stage comes alive: a crowd, a set-only Astral, its own music,
// someone special, and for Diabolo the only chance of a rematch. Tuned in data/rules.json "timetable":
//   { unlockBands, sets: [{ id, zone, from, to (minutes on the festival clock; to may wrap past midnight), name,
//     what, mood, bpm, crowd?: [x0, y0, x1, y1], fill?: true (every dancefloor tile), pose?: 'back' }] }
// Wild entries with set: id only come out during that set; NPCs can use the quest condition { set: id }.

export const sets = (data) => data.rules.timetable?.sets || [];
export const timetableOpen = (s) => !!s.flags?.timetable;
const minute = (clock) => ((Math.floor(clock) % 1440) + 1440) % 1440;
const inWindow = (m, from, to) => (from <= to ? m >= from && m < to : m >= from || m < to);

/** is this set playing now (and do you know about it yet)? */
export function setOn(data, s, id) {
  const x = sets(data).find((t) => t.id === id);
  return !!x && timetableOpen(s) && inWindow(minute(s.clock), x.from, x.to);
}
/** the set playing in a zone right now, or null */
export function liveSet(data, s, zoneId = s.zoneId) {
  if (!timetableOpen(s)) return null;
  const m = minute(s.clock);
  return sets(data).find((x) => x.zone === zoneId && inWindow(m, x.from, x.to)) || null;
}
/** minutes from now until a set starts (0 while it is playing) */
export function minutesUntil(data, s, set) {
  const m = minute(s.clock);
  return inWindow(m, set.from, set.to) ? 0 : (set.from - m + 1440) % 1440;
}
/** the next set to start (not one already playing) */
export function nextSet(data, s) {
  let best = null, bd = 1e9;
  for (const x of sets(data)) { const d = (x.from - minute(s.clock) + 1440) % 1440 || 1440; if (d < bd) { bd = d; best = x; } }
  return best;
}
export const clockText = (m) => `${String(Math.floor(minute(m) / 60)).padStart(2, '0')}:${String(minute(m) % 60).padStart(2, '0')}`;

/** rest at a Chai Tent until the next set starts; returns that set */
export function restUntilSet(ctx) {
  const s = ctx.state, next = nextSet(ctx.data, s);
  if (!next) return null;
  s.clock = next.from; s.clockSteps = 0;
  return next;
}
