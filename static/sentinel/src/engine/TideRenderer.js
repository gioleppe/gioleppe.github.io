// The ground of the island as the tide shapes it (step 2.4): flooded tiles drawn as water, a foam line where
// water meets land, wet darkening on tidal ground about to flood or just drained, and the water's ripple
// animation. Presentation only: it reads the map, sim.world and src/world/water.js, never writes anything.
//
// Water animation: the terrain sheet's water tags have three frames that are three phases of the same ripples
// (any phase tiles next to any other). Each tile cycles them with its hashed variant as its phase offset:
//   frame = (variant + floor(timeMs / frameMs)) % 3
// The renderer passes `variant + floor(timeMs / frameMs)` as drawTile's variant and the sprite source takes it
// modulo its frame count, so at time 0 every tile draws exactly as a static ground would.
import { TILE_W, TILE_H } from '../sim/constants.js';
import { TERRAINS, TERRAIN_ID } from '../world/IslandMap.js';
import { waterClass, tideWetness } from '../world/water.js';

/** palette colours used here (assets/src/palette.gpl names) */
export const TIDE_COLORS = Object.freeze({
  foam: '#cfeedd',     // foam
  crest: '#66c2b0',    // teal_3
  wetEdge: '#594b3c',  // wet_0
  wetShade: '#101834', // deep_0
});

/** how much of the ground shows through wading-depth water (0 = none) */
const WADE_GROUND = 0.3;
/** strongest wet darkening, right before a tile floods */
const WET_SHADE_MAX = 0.32;
/** foam segment length along an edge, world px */
const FOAM_SEG = 4;
/** foam wobble: radians per second and per world px along the edge */
const FOAM_SPEED = 0.8;
const FOAM_SPATIAL = 0.37;
/** if no frame length is known at all */
const DEFAULT_FRAME_MS = 500;

const DRY = 0;
const WET = 1;
const SHALLOW = 2;
const DEEP = 3;
const CLASS_ID = { dry: DRY, wet: WET, shallow: SHALLOW, deep: DEEP };
const SHALLOW_ID = TERRAIN_ID.shallow_water;
const DEEP_ID = TERRAIN_ID.deep_water;

/**
 * drawTile variant for an animated water tile: its static variant advanced one frame per frameMs.
 * @param {number} variant tileVariant(col, row)
 * @param {number} timeMs
 * @param {number} frameMs
 */
export function animatedVariant(variant, timeMs, frameMs) {
  return variant + Math.floor(timeMs / frameMs);
}

/**
 * The frame an animated water tile shows: (variant + floor(timeMs / frameMs)) % frames.
 * @returns {number} 0..frames-1
 */
export function waterFrame(variant, timeMs, frameMs, frames = 3) {
  return animatedVariant(variant, timeMs, frameMs) % frames;
}

/**
 * Milliseconds per water frame: the sheet tag's own timing when the sprite source knows it, else tuning.water.frameMs.
 * @param {{ tileFrameMs?: (terrain: string) => number|null }} sprites
 * @param {string} terrain
 * @param {Object} [tuning]
 */
export function waterFrameMs(sprites, terrain, tuning) {
  const fromSheet = sprites.tileFrameMs?.(terrain);
  if (fromSheet > 0) return fromSheet;
  const t = tuning?.water?.frameMs?.[terrain];
  return t > 0 ? t : DEFAULT_FRAME_MS;
}

/**
 * Whether a foam segment sits one pixel further into the water, and whether it carries a crest: a slow in-out
 * wobble that drifts along the shore. Pure function of the segment's world position and time.
 * @returns {{ offset: number, crest: boolean, gap: boolean }}
 */
export function foamWobble(pos, edgeSeed, time) {
  const a = Math.sin(time * FOAM_SPEED + pos * FOAM_SPATIAL + edgeSeed);
  const b = Math.sin(time * FOAM_SPEED * 0.6 - pos * FOAM_SPATIAL * 0.5 + edgeSeed * 1.7);
  return { offset: a > 0.15 ? 1 : 0, crest: a > 0.55, gap: b < -0.82 };
}

export class TideRenderer {
  constructor() {
    /** depth class per tile of the last view, one tile of margin around it */
    this.grid = new Uint8Array(0);
  }

  /**
   * Draw the ground tiles of a tile range with the tide applied.
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('./Renderer.js').SpriteSource & { tileFrameMs?: Function }} sprites
   * @param {(c: number, r: number) => number} variantOf tileVariant
   * @param {import('./Camera.js').Camera} camera
   * @param {import('../sim/Sim.js').Sim} sim  with a map and a world
   * @param {number} time seconds
   * @param {{c0:number,c1:number,r0:number,r1:number}} range
   */
  draw(ctx, sprites, variantOf, camera, sim, time, range) {
    const { map, world } = sim;
    const cfg = world.waterConfig;
    const h = world.tideHeight;
    const { c0, c1, r0, r1 } = range;
    const ox = camera.originX;
    const oy = camera.originY;
    const timeMs = time * 1000;
    const msShallow = waterFrameMs(sprites, 'shallow_water', sim.tuning);
    const msDeep = waterFrameMs(sprites, 'deep_water', sim.tuning);

    // classes for the view plus a one-tile margin, so edges know their neighbours
    const gw = c1 - c0 + 2;
    const gh = r1 - r0 + 2;
    if (this.grid.length < gw * gh) this.grid = new Uint8Array(gw * gh);
    const g = this.grid;
    for (let r = r0 - 1; r <= r1; r++) {
      for (let c = c0 - 1; c <= c1; c++) {
        const thr = map.floodThreshold(map.floodLevel(c, r));
        g[(r - r0 + 1) * gw + (c - c0 + 1)] = CLASS_ID[waterClass(map.terrainIdAt(c, r), thr, h, cfg)];
      }
    }
    const cls = (c, r) => g[(r - r0 + 1) * gw + (c - c0 + 1)];

    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const x = c * TILE_W - ox;
        const y = r * TILE_H - oy;
        const v = variantOf(c, r);
        const t = map.terrainIdAt(c, r);
        const k = cls(c, r);
        if (t === SHALLOW_ID || t === DEEP_ID) {
          sprites.drawTile(ctx, TERRAINS[t], x, y, TILE_W, TILE_H, animatedVariant(v, timeMs, t === DEEP_ID ? msDeep : msShallow));
        } else if (k === DEEP) {
          sprites.drawTile(ctx, 'deep_water', x, y, TILE_W, TILE_H, animatedVariant(v, timeMs, msDeep));
        } else if (k === SHALLOW) {
          // wading depth: the ground still shows faintly through the water
          sprites.drawTile(ctx, TERRAINS[t], x, y, TILE_W, TILE_H, v);
          ctx.globalAlpha = 1 - WADE_GROUND;
          sprites.drawTile(ctx, 'shallow_water', x, y, TILE_W, TILE_H, animatedVariant(v, timeMs, msShallow));
          ctx.globalAlpha = 1;
        } else {
          sprites.drawTile(ctx, TERRAINS[t], x, y, TILE_W, TILE_H, v);
          const wet = tideWetness(map.floodThreshold(map.floodLevel(c, r)), h, cfg);
          if (wet > 0) {
            // three flat steps, not a gradient: the darkening grows as the water nears
            ctx.globalAlpha = (WET_SHADE_MAX * Math.ceil(wet * 3)) / 3;
            ctx.fillStyle = TIDE_COLORS.wetShade;
            ctx.fillRect(x, y, TILE_W, TILE_H);
            ctx.globalAlpha = 1;
          }
        }
      }
    }

    // shoreline: a foam line inside the water along every edge it shares with land
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        if (cls(c, r) < SHALLOW) continue;
        const x = c * TILE_W - ox;
        const y = r * TILE_H - oy;
        if (cls(c, r - 1) < SHALLOW) this.foamH(ctx, x, y, c * TILE_W, 1, time, 0);
        if (cls(c, r + 1) < SHALLOW) this.foamH(ctx, x, y + TILE_H - 1, c * TILE_W, -1, time, 2.1);
        if (cls(c - 1, r) < SHALLOW) this.foamV(ctx, x, y, r * TILE_H, 1, time, 4.2);
        if (cls(c + 1, r) < SHALLOW) this.foamV(ctx, x + TILE_W - 1, y, r * TILE_H, -1, time, 1.3);
      }
    }
  }

  /** foam along a horizontal edge at screen row y; dir +1 moves into the water downwards, -1 upwards */
  foamH(ctx, x, y, worldX, dir, time, seed) {
    for (let s = 0; s < TILE_W; s += FOAM_SEG) {
      const w = foamWobble(worldX + s, seed, time);
      if (w.gap) continue;
      ctx.fillStyle = TIDE_COLORS.foam;
      ctx.fillRect(x + s, y + dir * w.offset, FOAM_SEG, 1);
      if (w.crest) {
        ctx.fillStyle = TIDE_COLORS.crest;
        ctx.fillRect(x + s, y + dir * (w.offset + 1), FOAM_SEG, 1);
      }
    }
    // the wet line on the land side of the edge
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = TIDE_COLORS.wetEdge;
    ctx.fillRect(x, y - dir, TILE_W, 1);
    ctx.globalAlpha = 1;
  }

  /** foam along a vertical edge at screen column x; dir +1 moves into the water rightwards, -1 leftwards */
  foamV(ctx, x, y, worldY, dir, time, seed) {
    for (let s = 0; s < TILE_H; s += FOAM_SEG) {
      const w = foamWobble(worldY + s, seed, time);
      if (w.gap) continue;
      ctx.fillStyle = TIDE_COLORS.foam;
      ctx.fillRect(x + dir * w.offset, y + s, 1, FOAM_SEG);
      if (w.crest) {
        ctx.fillStyle = TIDE_COLORS.crest;
        ctx.fillRect(x + dir * (w.offset + 1), y + s, 1, FOAM_SEG);
      }
    }
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = TIDE_COLORS.wetEdge;
    ctx.fillRect(x - dir, y, 1, TILE_H);
    ctx.globalAlpha = 1;
  }
}
