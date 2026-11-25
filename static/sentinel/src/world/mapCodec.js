// Run-length encoding of the island map's tile layers (format: see the top of IslandMap.js).
// A layer is one string per row; a row is a sequence of runs, each run a legend character followed by an
// optional decimal count (absent = 1): "d12h3s" is 12 x 'd', 3 x 'h', 1 x 's'. Legend characters are therefore
// never digits. Pure functions shared by the loader (decode) and the map tools (encode).

/** true for a character that may appear in a layer legend */
export function isLegendChar(ch) {
  return typeof ch === 'string' && ch.length === 1 && !(ch >= '0' && ch <= '9') && ch.charCodeAt(0) > 32 && ch.charCodeAt(0) < 127 && ch !== '"' && ch !== '\\';
}

/**
 * Encode one row of legend characters.
 * @param {string[]|string} chars one legend character per tile
 * @returns {string}
 */
export function encodeRow(chars) {
  let out = '';
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    let j = i + 1;
    while (j < chars.length && chars[j] === c) j++;
    out += j - i > 1 ? `${c}${j - i}` : c;
    i = j;
  }
  return out;
}

/**
 * Decode one row into `out` at `offset`, mapping each legend character through `lookup`.
 * @param {string} row
 * @param {Map<string, number>} lookup legend character -> stored value
 * @param {Uint8Array} out
 * @param {number} offset first index to write
 * @param {number} width tiles the row must hold
 * @returns {string|null} an error message, or null when the row decoded to exactly `width` tiles
 */
export function decodeRowInto(row, lookup, out, offset, width) {
  if (typeof row !== 'string') return 'row is not a string';
  let n = 0;
  let i = 0;
  while (i < row.length) {
    const c = row[i++];
    const v = lookup.get(c);
    if (v === undefined) return `unknown character "${c}"`;
    let count = 0;
    let digits = 0;
    while (i < row.length && row[i] >= '0' && row[i] <= '9') { count = count * 10 + (row.charCodeAt(i) - 48); i++; digits++; }
    if (digits === 0) count = 1;
    else if (count < 1) return `run of ${count} "${c}"`;
    if (n + count > width) return `row is longer than ${width} tiles`;
    out.fill(v, offset + n, offset + n + count);
    n += count;
  }
  return n === width ? null : `row has ${n} tiles, expected ${width}`;
}

/**
 * Decode a whole layer.
 * @param {string[]} rows
 * @param {Map<string, number>} lookup
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array} width * height values, row-major
 * @throws when the layer does not match the size or the legend
 */
export function decodeLayer(rows, lookup, width, height, name = 'layer') {
  if (!Array.isArray(rows) || rows.length !== height) throw new Error(`${name}: expected ${height} rows, got ${Array.isArray(rows) ? rows.length : typeof rows}`);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const err = decodeRowInto(rows[y], lookup, out, y * width, width);
    if (err) throw new Error(`${name} row ${y}: ${err}`);
  }
  return out;
}

/**
 * Encode a layer stored as values into rows of legend characters.
 * @param {ArrayLike<number>} values width * height, row-major
 * @param {number} width
 * @param {number} height
 * @param {string[]} chars value -> legend character
 * @returns {string[]}
 */
export function encodeLayer(values, width, height, chars) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = new Array(width);
    for (let x = 0; x < width; x++) {
      const c = chars[values[y * width + x]];
      if (c === undefined) throw new Error(`encodeLayer: no character for value ${values[y * width + x]} at ${x},${y}`);
      row[x] = c;
    }
    rows.push(encodeRow(row));
  }
  return rows;
}
