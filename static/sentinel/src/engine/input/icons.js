// Placeholder icons for the touch controls: small pixel bitmaps drawn as rectangles. Each icon is one function
// in TOUCH_ICONS with the same signature, so the art step (A6) can swap any of them for a sprite.

const BITMAPS = {
  hand: [
    '..#.#.#..',
    '..#.#.#.#',
    '#.#.#.#.#',
    '#.#######',
    '#########',
    '.########',
    '.#######.',
    '..######.',
    '..#####..',
  ],
  eye: [
    '.........',
    '..#####..',
    '.##...##.',
    '##..#..##',
    '#..###..#',
    '##..#..##',
    '.##...##.',
    '..#####..',
    '.........',
  ],
  speech: [
    '.#######.',
    '#########',
    '##.#.#.##',
    '#########',
    '.#######.',
    '..##.....',
    '..#......',
    '.#.......',
    '.........',
  ],
  offering: [
    '...#.#...',
    '....#....',
    '..#####..',
    '.#######.',
    '.........',
    '#########',
    '.#######.',
    '..#####..',
    '.........',
  ],
  crouch: [
    '.........',
    '...##....',
    '...##....',
    '.######..',
    '...###.#.',
    '..##.##..',
    '.##...##.',
    '.........',
    '#########',
  ],
  use: [
    '....#####',
    '.......##',
    '......#.#',
    '.....#..#',
    '....#....',
    '...#.....',
    '.##......',
    '####.....',
    '.##......',
  ],
  light: [
    '#...#...#',
    '.#..#..#.',
    '.........',
    '...###...',
    '##.###.##',
    '...###...',
    '.........',
    '.#..#..#.',
    '#...#...#',
  ],
  inventory: [
    '...###...',
    '..#...#..',
    '.#######.',
    '#########',
    '###...###',
    '#########',
    '#########',
    '.#######.',
    '.........',
  ],
  journal: [
    '.###.###.',
    '#...#...#',
    '#.#.#.#.#',
    '#...#...#',
    '#.#.#.#.#',
    '#...#...#',
    '#########',
    '.........',
    '.........',
  ],
};

/**
 * Draw a bitmap centred on (cx, cy), `size` logical pixels across, in the current fillStyle.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string[]} rows
 */
function drawBitmap(ctx, rows, cx, cy, size) {
  const n = rows.length;
  const cell = size / n;
  const x0 = cx - size / 2;
  const y0 = cy - size / 2;
  for (let r = 0; r < n; r++) {
    const row = rows[r];
    let c = 0;
    while (c < row.length) {
      if (row[c] !== '#') { c++; continue; }
      let end = c;
      while (end < row.length && row[end] === '#') end++;
      ctx.fillRect(x0 + c * cell, y0 + r * cell, (end - c) * cell, cell);
      c = end;
    }
  }
}

/** @typedef {(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) => void} IconFn */

/** @type {Record<string, IconFn>} one drawing function per icon */
export const TOUCH_ICONS = Object.freeze({
  hand: (ctx, cx, cy, size) => drawBitmap(ctx, BITMAPS.hand, cx, cy, size),
  eye: (ctx, cx, cy, size) => drawBitmap(ctx, BITMAPS.eye, cx, cy, size),
  speech: (ctx, cx, cy, size) => drawBitmap(ctx, BITMAPS.speech, cx, cy, size),
  offering: (ctx, cx, cy, size) => drawBitmap(ctx, BITMAPS.offering, cx, cy, size),
  crouch: (ctx, cx, cy, size) => drawBitmap(ctx, BITMAPS.crouch, cx, cy, size),
  use: (ctx, cx, cy, size) => drawBitmap(ctx, BITMAPS.use, cx, cy, size),
  light: (ctx, cx, cy, size) => drawBitmap(ctx, BITMAPS.light, cx, cy, size),
  inventory: (ctx, cx, cy, size) => drawBitmap(ctx, BITMAPS.inventory, cx, cy, size),
  journal: (ctx, cx, cy, size) => drawBitmap(ctx, BITMAPS.journal, cx, cy, size),
});

/** the bitmaps, for tests (every row the same width, square) */
export const ICON_BITMAPS = BITMAPS;
