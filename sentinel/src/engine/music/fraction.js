// Exact rational numbers for pattern time. Cycle positions are kept as reduced fractions of integers so that
// thousands of cycles of nested subdivisions never accumulate float error; they turn into seconds only at the
// very end, once per event, from the absolute position.

const gcd = (a, b) => {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};

/** A reduced fraction n/d with d > 0. Immutable. `valueOf()` gives the float, so `+f` and comparisons work. */
export class Fraction {
  constructor(n, d = 1) {
    if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0) throw new RangeError(`bad fraction ${n}/${d}`);
    if (d < 0) { n = -n; d = -d; }
    const g = gcd(n, d) || 1;
    this.n = n / g;
    this.d = d / g;
    if (!Number.isSafeInteger(this.n) || !Number.isSafeInteger(this.d)) throw new RangeError(`fraction overflow ${n}/${d}`);
  }

  add(o) { o = frac(o); return new Fraction(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { o = frac(o); return new Fraction(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { o = frac(o); return new Fraction(this.n * o.n, this.d * o.d); }
  div(o) { o = frac(o); if (o.n === 0) throw new RangeError('division by zero'); return new Fraction(this.n * o.d, this.d * o.n); }
  /** -1, 0 or 1 */
  cmp(o) { o = frac(o); const l = this.n * o.d; const r = o.n * this.d; return l < r ? -1 : l > r ? 1 : 0; }
  lt(o) { return this.cmp(o) < 0; }
  lte(o) { return this.cmp(o) <= 0; }
  gt(o) { return this.cmp(o) > 0; }
  gte(o) { return this.cmp(o) >= 0; }
  eq(o) { return this.cmp(o) === 0; }
  /** largest integer <= this */
  floor() { return Math.floor(this.n / this.d); }
  /** smallest integer >= this */
  ceil() { return Math.ceil(this.n / this.d); }
  min(o) { o = frac(o); return this.lte(o) ? this : o; }
  max(o) { o = frac(o); return this.gte(o) ? this : o; }
  valueOf() { return this.n / this.d; }
  toString() { return this.d === 1 ? String(this.n) : `${this.n}/${this.d}`; }
  toJSON() { return this.toString(); }
}

/** Fraction from a Fraction, an integer, or [n, d]. */
export function frac(x, d) {
  if (x instanceof Fraction) return x;
  if (d !== undefined) return new Fraction(x, d);
  if (Array.isArray(x)) return new Fraction(x[0], x[1]);
  if (Number.isInteger(x)) return new Fraction(x, 1);
  throw new RangeError(`not an exact number: ${x}`);
}

/** Exact fraction from a decimal string such as "1.5", "2", "0.25" (no exponent). */
export function parseDecimal(s) {
  const m = /^(\d*)(?:\.(\d+))?$/.exec(s);
  if (!m || (m[1] === '' && m[2] === undefined)) throw new RangeError(`not a number: "${s}"`);
  const decimals = m[2] ?? '';
  const den = 10 ** decimals.length;
  return new Fraction(Number(m[1] || '0') * den + Number(decimals || '0'), den);
}

export const ZERO = new Fraction(0);
export const ONE = new Fraction(1);

/** greatest common divisor and least common multiple of positive integers */
export { gcd };
export const lcm = (a, b) => (a / gcd(a, b)) * b;
