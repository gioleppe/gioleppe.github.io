// Intoxication bands: what being higher changes, beyond the picture. Tuned in data/rules.json (intox.bands).
// Each band: { id, name, min, xp, catch, fumble, encounter, tilt, wildLevel, whiteoutLoss, up, down }
//   xp, catch      multipliers on Vibes gained and catch odds (the reward)
//   fumble         chance a thrown bag misses completely (the risk)
//   encounter      multiplier on the wild encounter rate; tilt favours high-intoxication species
//   wildLevel      levels added to wild Astrals; whiteoutLoss multiplies the Rupees lost on a whiteout
//   up / down      what the player is told on entering the band from below / from above
const NEUTRAL = [{ id: 'MICRODOSE', name: 'Microdose', min: 0 }];

export function bands(rules) { return rules.intox?.bands || NEUTRAL; }
export function bandOf(rules, v = 0) {
  let b = bands(rules)[0];
  for (const x of bands(rules)) if (v >= x.min) b = x;
  return b;
}
export const bandIndex = (rules, v) => bands(rules).indexOf(bandOf(rules, v));

/** the top band, where the world itself changes (rules: the band with id EGO_GONE, or the last one) */
export function egoMin(rules) { const b = bands(rules); return (b.find((x) => x.id === 'EGO_GONE') || b[b.length - 1]).min; }
export const egoGone = (rules, v) => bands(rules).length > 1 && v >= egoMin(rules);

/** Astrals that only show themselves to people who are high: species whose every wild entry has a minIntox.
 *  { speciesId: [{ zone, minIntox, night }] } */
const highCache = new WeakMap();
export function highOnly(data) {
  if (highCache.has(data.zones)) return highCache.get(data.zones);
  const out = {}, any = {};
  for (const z of Object.values(data.zones)) {
    const enc = z.encounters;
    if (!enc) continue;
    for (const e of [...(enc.table || []), ...(enc.water || []), ...(enc.nightTable || [])]) {
      any[e.speciesId] = (any[e.speciesId] || 0) + 1;
      if (e.minIntox > 0) (out[e.speciesId] ||= []).push({ zone: z.zoneId, minIntox: e.minIntox, night: !!e.night });
    }
  }
  for (const id of Object.keys(out)) if (out[id].length !== any[id]) delete out[id];
  highCache.set(data.zones, out);
  return out;
}
