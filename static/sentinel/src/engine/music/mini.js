// A subset of Strudel's mini-notation (https://strudel.cc/learn/mini-notation/), parsed and evaluated in plain JS.
// Pure: no DOM, no Web Audio, no clock, no Math.random. One cycle is one bar in this engine.
//
// Supported (same meaning as in Strudel):
//   a b c        sequence: the steps share one cycle equally
//   ~  or  -     rest
//   [a b]        subdivision: a group that takes one step
//   <a b c>      alternation: one step per cycle (a in cycle 0, b in cycle 1, ...); `<a b, c d e>` stacks alternations
//   a*2          faster (also fractional: a*1.5)
//   a/2          slower (also fractional)
//   a@3          weight: the step takes 3 units of the cycle instead of 1
//   a!3  a!  !   replicate: `a!3` = `a a a`; a bare `!` repeats the previous step once more
//   a _ _        elongation: each `_` adds 1 to the previous step's weight (`a _ _` = `a@3`)
//   a, b         stack (polyphony / chords), at top level or inside [] and <>
//   a?  a?0.3    drop the event with probability 0.5 (or the given one); seeded and deterministic per event
//   a(3,8)       Euclidean rhythm (Bjorklund), optional rotation a(3,8,2) rotates left by 2 steps
// Atoms are words: note names (c3, eb3, f#4, cs4), scale degrees (0, 2, -1), or names (perc kinds: thud, shaker).
//
// Not supported (an error is raised, never a silent misread): `.` grouping, `|` random choice, `{}` polymeter and `%`,
// patterned modifier arguments (`a*<2 3>`, `a*[2 3]`), `:` sample indices are kept as part of the word, variables `^`.
//
// `?` uses a seeded hash of (seed, which `?`, the event's exact start), not Strudel's random signal, so the same
// drops happen every time for the same seed, but not the same drops as in strudel.cc.
import { Fraction, frac, parseDecimal, ZERO, ONE, gcd, lcm } from './fraction.js';

export class MiniSyntaxError extends SyntaxError {
  constructor(message, source, pos) {
    super(`${message} at ${pos} in "${source}"`);
    this.pos = pos;
  }
}

const WORD = /[A-Za-z0-9#.:\-]/;
const NUM = /[0-9.]/;
const UNSUPPORTED = { '{': 'polymeter {}', '}': 'polymeter {}', '%': 'polymeter steps %', '|': 'random choice |', '^': 'variables ^' };

/**
 * Split a mini-notation string into tokens.
 * @returns {{ type: string, text: string, arg?: string, pos: number, end: number, space: boolean, atom?: boolean }[]}
 */
export function tokenize(src) {
  const tokens = [];
  let i = 0;
  let space = true;
  let parens = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { space = true; i++; continue; }
    const start = i;
    if (UNSUPPORTED[ch]) throw new MiniSyntaxError(`unsupported mini-notation: ${UNSUPPORTED[ch]}`, src, i);
    if ('[]<>,()'.includes(ch)) {
      if (ch === '(') parens++;
      if (ch === ')') parens--;
      tokens.push({ type: ch, text: ch, pos: start, end: i + 1, space });
      i++;
    } else if ('*/@!?'.includes(ch)) {
      i++;
      let arg = '';
      while (i < src.length && NUM.test(src[i])) arg += src[i++];
      tokens.push({ type: ch, text: src.slice(start, i), arg, pos: start, end: i, space });
    } else if (ch === '~' || ch === '_') {
      tokens.push({ type: ch, text: ch, pos: start, end: i + 1, space });
      i++;
    } else if (WORD.test(ch)) {
      while (i < src.length && WORD.test(src[i])) i++;
      const text = src.slice(start, i);
      if (text === '-') tokens.push({ type: '~', text, pos: start, end: i, space });
      else if (text === '.') throw new MiniSyntaxError('unsupported mini-notation: . grouping', src, start);
      else tokens.push({ type: 'word', text, pos: start, end: i, space, atom: parens === 0 });
    } else {
      throw new MiniSyntaxError(`unexpected character "${ch}"`, src, i);
    }
    space = false;
  }
  return tokens;
}

// ---- parser: tokens -> tree ------------------------------------------------------------------------------
// Nodes: { type: 'atom', value } | { type: 'rest' } | { type: 'seq', steps: [{ node, weight }] }
//      | { type: 'stack', items } | { type: 'fast', factor, child } | { type: 'degrade', prob, salt, child }

function parse(src) {
  const tokens = tokenize(src);
  let p = 0;
  let salt = 0;
  const peek = () => tokens[p];
  const fail = (msg, t = peek()) => { throw new MiniSyntaxError(msg, src, t ? t.pos : src.length); };
  const number = (t, what) => {
    if (!t.arg) fail(`${what} needs a number`, t);
    let f;
    try { f = parseDecimal(t.arg); } catch { fail(`${what}: bad number "${t.arg}"`, t); }
    return f;
  };
  const int = (t) => {
    if (!t || t.type !== 'word' || !/^\d+$/.test(t.text)) fail('Euclid arguments are whole numbers', t);
    return Number(t.text);
  };

  /** comma-separated sequences until `closer` (or the end) */
  function stackUntil(closer, alt) {
    const seqs = [sequenceUntil(closer)];
    while (peek() && peek().type === ',') { p++; seqs.push(sequenceUntil(closer)); }
    if (closer) {
      if (!peek() || peek().type !== closer) fail(`missing "${closer}"`);
      p++;
    }
    const items = alt ? seqs.map((s) => (s.type === 'seq' ? slowBy(s, totalWeight(s)) : s)) : seqs;
    return items.length === 1 ? items[0] : { type: 'stack', items };
  }

  function sequenceUntil(closer) {
    const steps = [];
    for (;;) {
      const t = peek();
      if (!t || t.type === ',' || t.type === closer) break;
      if (t.type === ']' || t.type === '>' || t.type === ')') fail(`unexpected "${t.type}"`);
      if (t.type === '_') {
        if (!steps.length) fail('"_" with nothing to extend');
        steps[steps.length - 1].weight = steps[steps.length - 1].weight.add(1);
        p++;
        continue;
      }
      if (t.type === '!') {
        if (!steps.length) fail('"!" with nothing to repeat');
        if (t.arg) fail('use "a!3", not "a !3"');
        steps.push({ ...steps[steps.length - 1] });
        p++;
        continue;
      }
      steps.push(...step());
    }
    if (!steps.length) return { type: 'rest' };
    return { type: 'seq', steps };
  }

  /** one element with its modifiers; returns one step, or several for a!n */
  function step() {
    let node = element();
    let weight = ONE;
    let copies = 1;
    for (let t = peek(); t && !t.space; t = peek()) {
      if (t.type === '*') { p++; const f = number(t, '*'); if (f.n === 0) fail('*0', t); node = { type: 'fast', factor: f, child: node }; }
      else if (t.type === '/') { p++; const f = number(t, '/'); if (f.n === 0) fail('/0', t); node = { type: 'fast', factor: ONE.div(f), child: node }; }
      else if (t.type === '@') { p++; weight = number(t, '@'); if (weight.n === 0) fail('@0', t); }
      else if (t.type === '!') { p++; if (t.arg) { copies = Number(t.arg); if (!Number.isInteger(copies) || copies < 1) fail('!n needs a whole number >= 1', t); } else copies++; }
      else if (t.type === '?') {
        p++;
        const prob = t.arg ? Number(t.arg) : 0.5;
        if (!(prob >= 0 && prob <= 1)) fail('?p needs 0..1', t);
        node = { type: 'degrade', prob, salt: salt++, child: node };
      } else if (t.type === '(') {
        p++;
        const k = int(tokens[p++]);
        if (peek()?.type !== ',') fail('expected "," in Euclid (k,n)');
        p++;
        const n = int(tokens[p++]);
        let r = 0;
        if (peek()?.type === ',') { p++; r = int(tokens[p++]); }
        if (peek()?.type !== ')') fail('missing ")"');
        p++;
        if (n < 1 || k > n) fail(`Euclid (${k},${n}) needs 1 <= n and k <= n`, t);
        const hits = rotate(bjorklund(k, n), r);
        node = { type: 'seq', steps: hits.map((h) => ({ node: h ? node : { type: 'rest' }, weight: ONE })) };
      } else break;
    }
    return Array.from({ length: copies }, () => ({ node, weight }));
  }

  function element() {
    const t = peek();
    if (!t) fail('unexpected end');
    p++;
    switch (t.type) {
      case 'word':
        if (!t.atom) fail('unexpected number');
        return { type: 'atom', value: t.text };
      case '~': return { type: 'rest' };
      case '[': return stackUntil(']', false);
      case '<': return stackUntil('>', true);
      default: return fail(`unexpected "${t.text}"`, t);
    }
  }

  const tree = stackUntil(null, false);
  if (p < tokens.length) fail(`unexpected "${tokens[p].text}"`, tokens[p]);
  return tree;
}

const totalWeight = (seq) => seq.steps.reduce((w, s) => w.add(s.weight), ZERO);
const slowBy = (node, w) => ({ type: 'fast', factor: ONE.div(w), child: node });

/** Bjorklund's algorithm: k pulses spread over n steps, as in Strudel ((3,8) = x..x..x., (5,8) = x.xx.xx.) */
export function bjorklund(k, n) {
  if (k === 0) return new Array(n).fill(false);
  let a = Array.from({ length: k }, () => [true]);
  let b = Array.from({ length: n - k }, () => [false]);
  while (b.length > 1) {
    const m = Math.min(a.length, b.length);
    const joined = [];
    for (let i = 0; i < m; i++) joined.push([...a[i], ...b[i]]);
    const rest = a.length > m ? a.slice(m) : b.slice(m);
    a = joined;
    b = rest;
  }
  return [...a, ...b].flat();
}

const rotate = (arr, r) => {
  const n = arr.length;
  const s = ((r % n) + n) % n;
  return [...arr.slice(s), ...arr.slice(0, s)];
};

// ---- evaluation: tree -> query(begin, end) ---------------------------------------------------------------
// Queries are onset-based: an event belongs to the span its start lies in. Every time is an exact Fraction.

/** deterministic uniform [0, 1) from integers (a small avalanche hash; not Math.random) */
export function hashUnit(...ints) {
  let h = 0x9e3779b9 | 0;
  for (const x of ints) {
    const lo = x % 4294967296;
    const hi = Math.floor(x / 4294967296);
    for (const part of [lo, hi]) {
      h = Math.imul(h ^ (part | 0), 0x85ebca6b);
      h ^= h >>> 13;
      h = Math.imul(h, 0xc2b2ae35);
      h ^= h >>> 16;
    }
  }
  return (h >>> 0) / 4294967296;
}

function build(node, seed) {
  switch (node.type) {
    case 'rest': return { period: 1, query: () => [] };
    case 'atom': return {
      period: 1,
      query: (b, e) => {
        const out = [];
        for (let c = b.ceil(); c < e.ceil(); c++) out.push({ value: node.value, start: frac(c), end: frac(c + 1) });
        return out;
      },
    };
    case 'stack': {
      const items = node.items.map((n) => build(n, seed));
      return { period: items.reduce((P, it) => lcm(P, it.period), 1), query: (b, e) => items.flatMap((it) => it.query(b, e)) };
    }
    case 'fast': {
      const child = build(node.child, seed);
      const k = node.factor;
      const pq = child.period * k.d;
      return {
        period: pq / gcd(pq, k.n),
        query: (b, e) => child.query(b.mul(k), e.mul(k)).map((ev) => ({ ...ev, start: ev.start.div(k), end: ev.end.div(k) })),
      };
    }
    case 'degrade': {
      const child = build(node.child, seed);
      return {
        period: child.period,
        query: (b, e) => child.query(b, e).filter((ev) => hashUnit(seed, node.salt, ev.start.n, ev.start.d) >= node.prob),
      };
    }
    case 'seq': {
      const W = totalWeight(node);
      let offset = ZERO;
      const steps = node.steps.map((s) => {
        const st = { child: build(s.node, seed), from: offset.div(W), width: s.weight.div(W) };
        offset = offset.add(s.weight);
        return st;
      });
      return {
        period: steps.reduce((P, s) => lcm(P, s.child.period), 1),
        query: (b, e) => {
          const out = [];
          for (let c = b.floor(); c < e.ceil(); c++) {
            for (const s of steps) {
              const segStart = s.from.add(c);
              const segEnd = segStart.add(s.width);
              const lo = b.max(segStart);
              const hi = e.min(segEnd);
              if (lo.gte(hi)) continue;
              // child cycle c is squashed into [segStart, segEnd)
              const toChild = (t) => t.sub(segStart).div(s.width).add(c);
              const fromChild = (t) => t.sub(c).mul(s.width).add(segStart);
              for (const ev of s.child.query(toChild(lo), toChild(hi))) {
                out.push({ ...ev, start: fromChild(ev.start), end: fromChild(ev.end) });
              }
            }
          }
          return out;
        },
      };
    }
    default: throw new Error(`unknown node ${node.type}`);
  }
}

const byStart = (a, b) => a.start.cmp(b.start) || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0);

/**
 * Compile a mini-notation string.
 * @param {string} source
 * @param {{ seed?: number }} [opts] seed for `?`
 * @returns {{ source: string, seed: number, period: number, atoms: string[],
 *   query: (begin: Fraction|number, end: Fraction|number) => { value: string, start: Fraction, end: Fraction }[] }}
 *   `period` is the number of cycles after which the structure repeats (ignoring `?`).
 */
export function compile(source, { seed = 0 } = {}) {
  if (typeof source !== 'string') throw new TypeError('pattern must be a string');
  const tree = parse(source);
  const built = build(tree, seed);
  const atoms = [...new Set(tokenize(source).filter((t) => t.type === 'word' && t.atom).map((t) => t.text))];
  return {
    source, seed, period: built.period, atoms,
    query: (b, e) => built.query(frac(b), frac(e)).sort(byStart),
  };
}

/**
 * Events whose start lies in cycle `cycle` ([cycle, cycle + 1)), sorted by start then value.
 * Start and end are absolute cycle positions (Fractions); an event may end after the cycle (e.g. `a/2`).
 */
export function queryCycle(pattern, cycle) {
  return pattern.query(frac(cycle), frac(cycle + 1));
}

/**
 * Rewrite every atom word of a pattern, keeping the rest of the text as written (used by tools/music/to-strudel.mjs).
 * @param {string} source
 * @param {(word: string) => string} fn
 */
export function mapAtoms(source, fn) {
  let out = '';
  let last = 0;
  for (const t of tokenize(source)) {
    if (t.type !== 'word' || !t.atom) continue;
    out += source.slice(last, t.pos) + fn(t.text);
    last = t.end;
  }
  return out + source.slice(last);
}

export { Fraction };
