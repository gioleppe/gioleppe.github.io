// The only source of randomness in the simulation: a small seeded generator (mulberry32) whose whole state is
// one 32-bit integer, so it snapshots as a number and replays exactly in Node and in the page.

/**
 * Turn any seed (number or string) into a 32-bit state. FNV-1a over the text, so 1 and '1' are the same seed
 * and nearby seeds still give unrelated sequences.
 * @param {number|string} seed
 * @returns {number} uint32
 */
export function hashSeed(seed) {
  const s = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  /** @param {number|string} [seed=1] */
  constructor(seed = 1) {
    this.state = hashSeed(seed);
  }

  /** @returns {number} uniform in [0, 1) */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** @returns {number} uniform in [a, b) */
  range(a, b) {
    return a + (b - a) * this.next();
  }

  /** @returns {number} integer in 0..n-1 */
  int(n) {
    return Math.floor(this.next() * n);
  }

  /**
   * @template T
   * @param {T[]} arr non-empty
   * @returns {T}
   */
  pick(arr) {
    if (!arr.length) throw new Error('Rng.pick: empty array');
    return arr[this.int(arr.length)];
  }

  /** @returns {{ state: number }} */
  snapshot() {
    return { state: this.state };
  }

  /** @param {{ state: number }} snap */
  static restore(snap) {
    const r = new Rng(0);
    r.state = snap.state >>> 0;
    return r;
  }
}
