// Built-in art for everything until real sprites exist, and the fallback afterwards (spec §4.1): colour-coded
// boxes sized per kind with a short label and a facing mark, flat checkered ground tiles, and 16 x 16 labelled icons.
// Implements the SpriteSource interface the Renderer draws through (see Renderer.js).

/** box size (logical px), colour and label for each entity kind */
export const PLACEHOLDER_KINDS = Object.freeze({
  player: { w: 32, h: 48, color: '#e9c46a', label: 'YOU' },
  sentinelese: { w: 32, h: 48, color: '#c8553d', label: 'SNT' },
  marek: { w: 32, h: 48, color: '#8ab17d', label: 'MRK' },
  palm: { w: 48, h: 96, color: '#4c8c4a', label: 'PALM' },
  banyan: { w: 80, h: 112, color: '#2f6b3a', label: 'BANYAN' },
  mangrove: { w: 64, h: 72, color: '#3d6b56', label: 'MANG' },
  tall_grass: { w: 24, h: 20, color: '#88b04b', label: 'GR' },
  rock: { w: 32, h: 22, color: '#8d8d8d', label: 'ROCK' },
  monolith: { w: 20, h: 64, color: '#5b4b8a', label: 'MONO' },
  totem: { w: 16, h: 40, color: '#a0703c', label: 'TOT' },
  wreck_hull: { w: 96, h: 56, color: '#6d5a4b', label: 'WRECK' },
  kayak: { w: 48, h: 14, color: '#d96c3f', label: 'KAYAK' },
  tent: { w: 48, h: 36, color: '#9c8f5a', label: 'TENT' },
  dinghy: { w: 48, h: 18, color: '#e0e0d0', label: 'DINGHY' },
  radio_rock: { w: 40, h: 80, color: '#6f6f78', label: 'RADIO' },
  coconut_palm: { w: 48, h: 96, color: '#5a9a4a', label: 'COCO' },
  spring: { w: 32, h: 14, color: '#5fb3c9', label: 'SPRING' },
  driftwood_pile: { w: 32, h: 12, color: '#a48a68', label: 'DRIFT' },
  cliff_rock: { w: 48, h: 48, color: '#5e5c60', label: 'CLIFF' },
  glow_fungus: { w: 16, h: 12, color: '#7fe3c4', label: 'GLOW' },
  shack: { w: 80, h: 72, color: '#8a6a44', label: 'SHACK' },
  skeleton: { w: 32, h: 12, color: '#e8e2cf', label: 'SKEL' },
  life_vest: { w: 20, h: 10, color: '#f08a24', label: 'VEST' },
  wreck_hatch: { w: 32, h: 14, color: '#4f4238', label: 'HATCH' },
  campfire_cold: { w: 24, h: 12, color: '#5a4a3a', label: 'FIRE' },
  sat_phone: { w: 16, h: 10, color: '#3a3f44', label: 'SAT' },
  map_board: { w: 24, h: 32, color: '#c9b48a', label: 'MAP' },
  warning_arrows: { w: 24, h: 40, color: '#b0703c', label: 'ARROW' },
  crate: { w: 32, h: 28, color: '#8c6b3e', label: 'CRATE' },
});

const UNKNOWN = { w: 24, h: 24, color: '#ff00ff', label: '?' };

/** 16 x 16 icon placeholders (items and emotes, spec §4.2): a colour per sheet and the first letters of the name */
export const ICON_SIZE = 16;
export const PLACEHOLDER_ICON_COLORS = Object.freeze({ items: '#d9a441', emotes: '#f1faee' });

/** flat colours for the eight terrain tiles of spec §4.2; [even, odd] for the checker */
export const PLACEHOLDER_TERRAIN = Object.freeze({
  sand: ['#cdb682', '#c4ad78'],
  wet_sand: ['#a8946b', '#a08c63'],
  shallow_water: ['#3f8f98', '#3a8790'],
  deep_water: ['#1f4f68', '#1c4a62'],
  jungle_floor: ['#41603a', '#3b5834'],
  mud: ['#5c4834', '#55422f'],
  reef_rock: ['#7b7568', '#736d60'],
  basalt: ['#3c3b3e', '#363538'],
});

const CHARACTERS = new Set(['player', 'sentinelese', 'marek']);

export class PlaceholderSprites {
  /** @returns {{w:number,h:number}} */
  size(kind) {
    const k = PLACEHOLDER_KINDS[kind] ?? UNKNOWN;
    return { w: k.w, h: k.h };
  }

  /** @returns {true} placeholders exist for every kind (unknown kinds draw magenta) */
  has() {
    return true;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} kind
   * @param {string} state   'idle' | 'walk' | ...
   * @param {'N'|'E'|'S'|'W'|null} facing
   * @param {number} x       screen x of the anchor (bottom-centre), whole pixels
   * @param {number} y       screen y of the anchor
   * @param {number} time    seconds, for animation
   */
  draw(ctx, kind, state, facing, x, y, time) {
    const k = PLACEHOLDER_KINDS[kind] ?? UNKNOWN;
    const bob = state === 'walk' ? (Math.floor(time * 8) & 1) : 0;   // a one-pixel step so walking reads as walking
    const left = x - (k.w >> 1);
    const top = y - k.h - bob;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(left, top, k.w, k.h);
    ctx.fillStyle = k.color;
    ctx.fillRect(left + 1, top + 1, k.w - 2, k.h - 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.fillRect(left + 1, top + 1, k.w - 2, 2);

    ctx.fillStyle = '#10181a';
    ctx.font = '7px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = k === UNKNOWN ? String(kind).slice(0, 4).toUpperCase() || '?' : k.label;   // name an unknown kind so it can be found
    const label = k.w < 28 ? text.slice(0, 2) : text;
    ctx.fillText(label, x, top + Math.min(k.h - 6, CHARACTERS.has(kind) ? 30 : k.h / 2));

    if (facing) this.drawFacing(ctx, facing, left, top, k.w);
  }

  /** a mark on the side of the box the entity faces: head-height notch for E/W, eyes for S, a top bar for N */
  drawFacing(ctx, facing, left, top, w) {
    ctx.fillStyle = '#10181a';
    const cx = left + (w >> 1);
    if (facing === 'S') { ctx.fillRect(cx - 5, top + 9, 3, 3); ctx.fillRect(cx + 2, top + 9, 3, 3); }
    else if (facing === 'N') ctx.fillRect(cx - 6, top + 2, 12, 3);
    else if (facing === 'E') ctx.fillRect(left + w - 6, top + 8, 5, 5);
    else if (facing === 'W') ctx.fillRect(left + 1, top + 8, 5, 5);
  }

  /**
   * A 16 x 16 icon with its top-left at (x, y).
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} sheet  'items' | 'emotes'
   * @param {string} name   icon name, e.g. 'water_bottle' or 'exclaim'
   * @param {number} x
   * @param {number} y
   */
  drawIcon(ctx, sheet, name, x, y) {
    const s = ICON_SIZE;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = PLACEHOLDER_ICON_COLORS[sheet] ?? '#ff00ff';
    ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    ctx.fillStyle = '#10181a';
    ctx.font = '6px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(name).slice(0, 2).toUpperCase(), x + s / 2, y + s / 2);
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} terrain
   * @param {number} x        screen x of the tile's top-left, whole pixels
   * @param {number} y
   * @param {number} w        tile size (TILE_W x TILE_H)
   * @param {number} h
   * @param {number} variant  0 or 1, for a checker so the oblique grid reads
   */
  drawTile(ctx, terrain, x, y, w, h, variant) {
    const c = PLACEHOLDER_TERRAIN[terrain] ?? ['#ff00ff', '#cc00cc'];
    ctx.fillStyle = c[variant & 1];
    ctx.fillRect(x, y, w, h);
  }
}
