// Fingerprints of simulation state: a canonical text form of a snapshot and a fast hash of it, so two runs
// (Node and the page, a straight run and a restored one) can be compared with one short string, plus helpers
// that point at the exact field when they differ or when a value has gone NaN.

/**
 * Canonical text of a JSON-like value: object keys sorted, no whitespace, `-0` written as `0`.
 * Numbers use the language's own Number-to-string conversion (shortest round-trip digits, the same in Node and
 * every browser). NaN and the infinities, which JSON cannot hold, are written as the bare tokens `NaN`,
 * `Infinity` and `-Infinity` so a broken state still hashes (and differs from a sane one). Otherwise the
 * output is valid JSON: `undefined`, functions and symbols are dropped from objects and become `null` in arrays.
 * @param {*} value
 * @returns {string}
 * @throws {TypeError} on a BigInt or a cycle
 */
export function canonicalJson(value) {
  const out = [];
  write(value, out, []);
  return out.join('');
}

function writeNumber(v, out) {
  if (v === 0) out.push('0');                      // also -0
  else if (Number.isFinite(v)) out.push(String(v));
  else out.push(v !== v ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity');
}

const skipped = (v) => v === undefined || typeof v === 'function' || typeof v === 'symbol';

function write(v, out, stack) {
  if (v === null) { out.push('null'); return; }
  switch (typeof v) {
    case 'number': writeNumber(v, out); return;
    case 'string': out.push(JSON.stringify(v)); return;
    case 'boolean': out.push(v ? 'true' : 'false'); return;
    case 'bigint': throw new TypeError('canonicalJson: BigInt is not serialisable');
    case 'object': break;
    default: out.push('null'); return;             // undefined/function/symbol inside an array
  }
  if (stack.includes(v)) throw new TypeError('canonicalJson: cyclic structure');
  stack.push(v);
  if (Array.isArray(v)) {
    out.push('[');
    for (let i = 0; i < v.length; i++) {
      if (i) out.push(',');
      write(v[i], out, stack);
    }
    out.push(']');
  } else {
    out.push('{');
    let first = true;
    for (const k of Object.keys(v).sort()) {
      if (skipped(v[k])) continue;
      if (!first) out.push(',');
      first = false;
      out.push(JSON.stringify(k), ':');
      write(v[k], out, stack);
    }
    out.push('}');
  }
  stack.pop();
}

const hex8 = (n) => (n >>> 0).toString(16).padStart(8, '0');

/**
 * Fast non-cryptographic 64-bit hash of a string (cyrb53's two 32-bit lanes, both kept), as 16 hex digits.
 * Only Math.imul and 32-bit integer operations, so it is bit-identical in every engine.
 * @param {string} str
 * @param {number} [seed=0]
 * @returns {string}
 */
export function hash64(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return hex8(h2) + hex8(h1);
}

/**
 * Hash of a sim's snapshot (or of a snapshot object already taken).
 * @param {{ snapshot: () => object } | object} simOrSnapshot
 * @returns {string} 16 hex digits
 */
export function snapshotHash(simOrSnapshot) {
  const snap = simOrSnapshot && typeof simOrSnapshot.snapshot === 'function' ? simOrSnapshot.snapshot() : simOrSnapshot;
  return hash64(canonicalJson(snap));
}

const IDENT = /^[A-Za-z_$][\w$]*$/;
const keyPath = (base, k) => (IDENT.test(k) ? (base ? `${base}.${k}` : k) : `${base}[${JSON.stringify(k)}]`);
const indexPath = (base, i) => `${base}[${i}]`;
/** how a path is shown when it is the value itself */
export const ROOT_PATH = '(root)';

/**
 * Path of the first number that is NaN or infinite (depth first, object keys sorted), e.g. `player.x` or
 * `props[3].radius`; `(root)` when the value itself is one; null when every number is finite.
 * @param {*} value
 * @returns {string|null}
 */
export function findNonFinite(value) {
  const p = walkNonFinite(value, '');
  return p === null ? null : p || ROOT_PATH;
}

function walkNonFinite(v, path) {
  if (typeof v === 'number') return Number.isFinite(v) ? null : path;
  if (v === null || typeof v !== 'object') return null;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const p = walkNonFinite(v[i], indexPath(path, i));
      if (p !== null) return p;
    }
    return null;
  }
  for (const k of Object.keys(v).sort()) {
    const p = walkNonFinite(v[k], keyPath(path, k));
    if (p !== null) return p;
  }
  return null;
}

/** equal as the canonical form sees them: -0 equals 0, NaN equals NaN */
const sameLeaf = (a, b) => a === b || (a !== a && b !== b);

/**
 * The first place two JSON-like values differ, in canonical order (keys sorted, arrays by index; a length
 * difference shows as `<path>.length` once the common elements match). -0 and 0 are equal, as are two NaNs.
 * @param {*} a
 * @param {*} b
 * @returns {{ path: string, a: *, b: * } | null} null when canonically equal
 */
export function firstDifference(a, b) {
  const d = walkDiff(a, b, '');
  if (d && !d.path) d.path = ROOT_PATH;
  return d;
}

function walkDiff(a, b, path) {
  const ao = a !== null && typeof a === 'object';
  const bo = b !== null && typeof b === 'object';
  if (!ao || !bo || Array.isArray(a) !== Array.isArray(b)) return ao || bo || !sameLeaf(a, b) ? { path, a, b } : null;
  if (Array.isArray(a)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = walkDiff(a[i], b[i], indexPath(path, i));
      if (d) return d;
    }
    return a.length === b.length ? null : { path: keyPath(path, 'length'), a: a.length, b: b.length };
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) {
    const av = skipped(a[k]) ? undefined : a[k];
    const bv = skipped(b[k]) ? undefined : b[k];
    const d = walkDiff(av, bv, keyPath(path, k));
    if (d) return d;
  }
  return null;
}
