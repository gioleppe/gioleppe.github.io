// Deterministic mulberry32 PRNG. The whole state is one uint32, so it serialises into a save.
export function mulberry32Step(s) {
  s = (s + 0x6D2B79F5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { state: s, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/** PRNG bound to a holder object: reads and writes holder[key], so the game state owns the seed. */
export function makeRng(holder, key = 'rng') {
  const next = () => {
    const r = mulberry32Step(holder[key] >>> 0);
    holder[key] = r.state;
    return r.value;
  };
  return {
    next,
    chance: (p) => next() < p,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted(items, weightOf = (i) => i.weight) {
      const total = items.reduce((a, i) => a + weightOf(i), 0);
      let r = next() * total;
      for (const i of items) { r -= weightOf(i); if (r < 0) return i; }
      return items[items.length - 1];
    },
  };
}
