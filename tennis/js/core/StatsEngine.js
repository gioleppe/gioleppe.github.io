/**
 * StatsEngine.js - pure, deterministic statistical helpers for the tennis
 * visual analytics system (docs/api_contract.md, guideline §8 Phase 1.3).
 *
 * Runs in plain Node and in the browser: no DOM, no D3, no npm dependencies.
 * Every function is side-effect free and returns plain data.
 *
 * @module StatsEngine
 */

/**
 * Minimum number of points below which a cell / node / bucket is considered
 * statistically unreliable and must be visually de-emphasised by the views.
 * @type {number}
 */
export const LOW_SAMPLE_THRESHOLD = 10;

/**
 * Clamp a number into the closed interval [lo, hi].
 * NaN input is returned unchanged so callers can detect "no data".
 *
 * @param {number} x
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
export function clamp(x, lo, hi) {
  if (Number.isNaN(x)) return x;
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Format a proportion in [0, 1] as a percentage string, e.g. 0.6543 -> "65.4%".
 * Non-finite input (NaN / Infinity / undefined) yields "n/a".
 *
 * @param {number} x       proportion in [0, 1]
 * @param {number} [digits=1] number of decimal digits
 * @returns {string}
 */
export function formatPct(x, digits = 1) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "n/a";
  return `${(x * 100).toFixed(digits)}%`;
}

/**
 * Wilson score interval for a binomial proportion.
 * Bounds are clamped to [0, 1]. When total is 0 (or non-finite) the proportion is
 * undefined and the interval is maximally uninformative: { p: NaN, low: 0, high: 1 }.
 * A non-finite wins count is treated as 0.
 *
 * @param {number} wins
 * @param {number} total
 * @param {number} [z=1.96]  normal quantile (1.96 => 95% interval)
 * @returns {{ p: number, low: number, high: number }}
 */
export function computeWilsonCI(wins, total, z = 1.96) {
  if (!Number.isFinite(total) || total <= 0) return { p: NaN, low: 0, high: 1 };
  const n = total;
  const w = clamp(Number.isFinite(wins) ? wins : 0, 0, n);
  const p = w / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    p,
    low: clamp((centre - half) / denom, 0, 1),
    high: clamp((centre + half) / denom, 0, 1),
  };
}

/**
 * Summarise server outcomes for a set of canonical point records.
 * Uses `rec.serverWon` (boolean) and `rec.rallyLength` (integer >= 1).
 * Safe for an empty array: n = 0, rawRate = NaN, meanRally = NaN,
 * ci = { low: 0, high: 1 }.
 *
 * @param {Array<{ serverWon: boolean, rallyLength?: number }>} points
 * @returns {{ n: number, wins: number, rawRate: number,
 *             ci: { low: number, high: number }, meanRally: number }}
 */
export function summarizeOutcomes(points) {
  const list = Array.isArray(points) ? points : [];
  let n = 0;
  let wins = 0;
  let rallySum = 0;
  let rallyCount = 0;
  for (const rec of list) {
    if (!rec) continue;
    n += 1;
    if (rec.serverWon === true) wins += 1;
    const rl = rec.rallyLength;
    if (typeof rl === "number" && Number.isFinite(rl)) {
      rallySum += rl;
      rallyCount += 1;
    }
  }
  const ci = computeWilsonCI(wins, n);
  return {
    n,
    wins,
    rawRate: n > 0 ? wins / n : NaN,
    ci: { low: ci.low, high: ci.high },
    meanRally: rallyCount > 0 ? rallySum / rallyCount : NaN,
  };
}

/**
 * Difference between a subset's win share and a baseline's win share
 * (positive => the subset favours the server more than the baseline).
 * Returns NaN if either summary is missing or has no rawRate, or when the subset
 * carries an explicit sample size `n` that is not > 0 (an empty cell has no share).
 * Views must render NaN as "n/a".
 *
 * @param {{ rawRate: number, n?: number }} subsetSummary
 * @param {{ rawRate: number }} baselineSummary
 * @returns {number}
 */
export function computeDeltaVsBaseline(subsetSummary, baselineSummary) {
  const a = subsetSummary && subsetSummary.rawRate;
  const b = baselineSummary && baselineSummary.rawRate;
  if (typeof a !== "number" || typeof b !== "number") return NaN;
  if (subsetSummary.n !== undefined && !(subsetSummary.n > 0)) return NaN;
  return a - b;
}

/**
 * Barycentric layer ordering (Sugiyama / Patrignani heuristic) for the
 * tactical flow DAG. Each node of `currLayer` is placed at the value-weighted
 * mean of the `y` centres of its upstream neighbours in `prevLayer`, then the
 * layer is sorted by that barycenter. Deterministic: ties are broken by the
 * node's original index in `currLayer`; nodes without any upstream link (or
 * with zero total weight) are appended at the end in their original order.
 *
 * @param {Array<{ id: string, y: number }>} prevLayer  upstream layer with centre y coordinates
 * @param {Array<{ id: string }>} currLayer             layer to order
 * @param {Array<{ source: string, target: string, value: number }>} links  links from prevLayer ids to currLayer ids
 * @returns {string[]} ids of currLayer in barycentric order
 */
export function computeBarycentricOrder(prevLayer, currLayer, links) {
  const prev = Array.isArray(prevLayer) ? prevLayer : [];
  const curr = Array.isArray(currLayer) ? currLayer : [];
  const edges = Array.isArray(links) ? links : [];

  const yOf = new Map();
  for (const node of prev) {
    if (node && typeof node.y === "number" && Number.isFinite(node.y)) {
      yOf.set(node.id, node.y);
    }
  }

  /** @type {Map<string, { num: number, den: number }>} */
  const acc = new Map();
  for (const link of edges) {
    if (!link || !yOf.has(link.source)) continue;
    const v = typeof link.value === "number" && Number.isFinite(link.value) ? link.value : 0;
    if (v <= 0) continue;
    const a = acc.get(link.target) || { num: 0, den: 0 };
    a.num += v * yOf.get(link.source);
    a.den += v;
    acc.set(link.target, a);
  }

  const placed = [];
  const unplaced = [];
  curr.forEach((node, index) => {
    if (!node) return;
    const a = acc.get(node.id);
    if (a && a.den > 0) placed.push({ id: node.id, index, bary: a.num / a.den });
    else unplaced.push({ id: node.id, index });
  });

  placed.sort((p, q) => (p.bary - q.bary) || (p.index - q.index));
  unplaced.sort((p, q) => p.index - q.index);

  return [...placed.map((d) => d.id), ...unplaced.map((d) => d.id)];
}

/**
 * @typedef {object} Prop
 * @property {number} w     successes
 * @property {number} n     trials
 * @property {number} p     w / n (NaN when n = 0)
 * @property {number} low   Wilson 95% lower bound (NaN when n = 0)
 * @property {number} high  Wilson 95% upper bound (NaN when n = 0)
 */

/**
 * Single proportion with its Wilson 95% interval.
 * @param {number} w
 * @param {number} n
 * @returns {Prop}
 */
export function proportion(w, n) {
  const ci = computeWilsonCI(w, n);
  return { w, n, p: n > 0 ? w / n : NaN, low: n > 0 ? ci.low : NaN, high: n > 0 ? ci.high : NaN };
}

/**
 * Difference a.p - b.p with the Newcombe (1998, method 10) hybrid score interval built from
 * the two Wilson intervals. NaN fields when either group is empty.
 * @param {Prop} a
 * @param {Prop} b
 * @returns {{ d: number, low: number, high: number }}
 */
export function newcombeDiff(a, b) {
  if (!(a.n > 0 && b.n > 0)) return { d: NaN, low: NaN, high: NaN };
  const d = a.p - b.p;
  return {
    d,
    low: d - Math.sqrt((a.p - a.low) ** 2 + (b.high - b.p) ** 2),
    high: d + Math.sqrt((a.high - a.p) ** 2 + (b.p - b.low) ** 2),
  };
}
