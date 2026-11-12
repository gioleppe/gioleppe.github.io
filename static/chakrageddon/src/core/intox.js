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
