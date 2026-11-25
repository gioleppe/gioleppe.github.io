// Draws one frame of the world from a Sim (spec §2): oblique ground tiles, then every visible entity sorted by
// world y (painter's algorithm), each as a soft ground shadow and an upright billboard anchored at its feet.
// It only reads the simulation.
import { TILE_W, TILE_H } from '../sim/constants.js';
import { PlaceholderSprites } from './PlaceholderSprites.js';
import { TideRenderer } from './TideRenderer.js';

/**
 * The seam every picture goes through. PlaceholderSprites implements it; the AssetManager (step 1.2) will
 * implement it with real sheets and fall back to PlaceholderSprites for anything missing.
 *
 * @typedef {Object} SpriteSource
 * @property {(kind: string, state?: string) => {w: number, h: number, shadow?: number}} size
 *   Sprite box in logical pixels; the anchor is its bottom-centre. Used for culling, so it must not be smaller than what `draw` paints.
 *   `shadow`, if present, is the ground shadow width (0 = none); otherwise the shadow follows `w`.
 * @property {(ctx: CanvasRenderingContext2D, kind: string, state: string, facing: ('N'|'E'|'S'|'W'|null), x: number, y: number, time: number) => void} draw
 *   Paint an entity with its anchor (ground contact point) at screen (x, y), whole logical pixels. `time` in seconds drives animation.
 * @property {(ctx: CanvasRenderingContext2D, terrain: string, x: number, y: number, w: number, h: number, variant: number) => void} drawTile
 *   Paint one ground tile with its top-left at screen (x, y); w x h is TILE_W x TILE_H; `variant` is tileVariant(col, row),
 *   a non-negative integer that is stable per tile (pick a frame with `variant % frames`). Animated water tiles
 *   pass it advanced by one per frame time (TideRenderer.js), so `variant % frames` also animates them.
 * @property {(terrain: string) => number|null} [tileFrameMs]  optional: ms per frame of an animated terrain
 */

/**
 * What the renderer draws for one entity, in world pixels.
 * @typedef {Object} EntityView
 * @property {string} id
 * @property {string} kind
 * @property {number} x
 * @property {number} y
 * @property {string} state
 * @property {('N'|'E'|'S'|'W'|null)} facing
 */

/** room below the anchor for the ground shadow, in logical pixels, counted in culling */
const SHADOW_PAD = 4;
/** how far below the view a prop's anchor may be and still reach into it (tallest sprite), for the map's prop query */
const PROP_REACH_BELOW = 160;
/** half the widest prop sprite, for the same query */
const PROP_REACH_SIDE = 64;

/** stable per-tile variant: a hash of the tile coordinates (never the rng), so the ground never reshuffles */
export function tileVariant(col, row) {
  let h = Math.imul(col, 0x27d4eb2d) ^ Math.imul(row, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

/** painter's order: north first; ties broken by x then id so the order never flickers between frames */
export function compareByY(a, b) {
  return a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Tile columns and rows that touch a world rectangle, clipped to the map when there is one.
 * @param {{x:number,y:number,w:number,h:number}} rect world pixels
 * @param {{x:number,y:number,w:number,h:number}|null} bounds
 * @returns {{c0:number,c1:number,r0:number,r1:number}} half-open: c0 <= c < c1, r0 <= r < r1
 */
export function tileRange(rect, bounds) {
  let c0 = Math.floor(rect.x / TILE_W);
  let r0 = Math.floor(rect.y / TILE_H);
  let c1 = Math.ceil((rect.x + rect.w) / TILE_W);
  let r1 = Math.ceil((rect.y + rect.h) / TILE_H);
  if (bounds) {
    c0 = Math.max(c0, Math.floor(bounds.x / TILE_W));
    r0 = Math.max(r0, Math.floor(bounds.y / TILE_H));
    c1 = Math.min(c1, Math.ceil((bounds.x + bounds.w) / TILE_W));
    r1 = Math.min(r1, Math.ceil((bounds.y + bounds.h) / TILE_H));
  }
  return { c0, c1: Math.max(c0, c1), r0, r1: Math.max(r0, r1) };
}

/** the world rectangle an entity's picture can cover: its sprite box above the anchor, plus its shadow below */
export function spriteRect(e, size) {
  return { x: e.x - size.w / 2, y: e.y - size.h, w: size.w, h: size.h + SHADOW_PAD };
}

export function intersects(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * The entities whose picture touches `rect`, in draw order.
 * @param {EntityView[]} entities
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @param {(kind: string, state: string) => {w:number,h:number}} sizeOf
 * @returns {EntityView[]}
 */
export function cullAndSort(entities, rect, sizeOf) {
  return entities.filter((e) => intersects(spriteRect(e, sizeOf(e.kind, e.state)), rect)).sort(compareByY);
}

/**
 * Ground of the open test field: patches of a few terrains so the oblique grid and the motion read.
 * Pure function of the tile, so the field looks the same every frame and in every run.
 */
export function testFieldTerrain(col, row) {
  const px = Math.floor(col / 5);
  const py = Math.floor(row / 4);
  let h = Math.imul(px, 374761393) + Math.imul(py, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  const kinds = ['jungle_floor', 'jungle_floor', 'sand', 'jungle_floor', 'wet_sand', 'mud'];
  return kinds[h % kinds.length];
}

export class Renderer {
  /**
   * @param {Object} [opts]
   * @param {SpriteSource} [opts.sprites]       defaults to the built-in placeholders
   * @param {(col: number, row: number) => string} [opts.terrainAt]  terrain name of a tile; defaults to the test field
   */
  constructor({ sprites = new PlaceholderSprites(), terrainAt = testFieldTerrain } = {}) {
    /** @type {SpriteSource} */
    this.sprites = sprites;
    this.terrainAt = terrainAt;
    /** what the last frame processed, for debug overlays and tests */
    this.stats = { tiles: 0, entities: 0, drawn: 0 };
    /** reused by the map's prop query every frame */
    this.propScratch = [];
    /** the island's ground under the tide: flooding, shoreline, water animation */
    this.tide = new TideRenderer();
  }

  /**
   * Draw a whole frame of the world onto the #world context.
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('../sim/Sim.js').Sim} sim
   * @param {import('./Camera.js').Camera} camera
   * @param {{ alpha?: number, time?: number }} [opts] alpha: tick interpolation 0..1; time: seconds for animation
   */
  render(ctx, sim, camera, { alpha = 1, time = sim.time } = {}) {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0b1416';
    ctx.fillRect(0, 0, camera.viewW, camera.viewH);
    this.drawGround(ctx, camera, sim.bounds, sim, time);

    const all = this.collectEntities(sim, alpha, camera.visibleRect());
    const visible = cullAndSort(all, camera.visibleRect(), (k, s) => this.sprites.size(k, s));
    for (const e of visible) this.drawEntity(ctx, e, camera, time);
    this.stats.entities = all.length;
    this.stats.drawn = visible.length;
  }

  /**
   * Ground tiles under the view only. With a map and a world clock (`sim`), the tide decides what each tile shows.
   * @param {Object} [sim]
   * @param {number} [time] seconds, for the water animation
   */
  drawGround(ctx, camera, bounds, sim = null, time = 0) {
    const range = tileRange(camera.visibleRect(), bounds);
    const { c0, c1, r0, r1 } = range;
    this.stats.tiles = (c1 - c0) * (r1 - r0);
    if (sim?.map && sim.world) {
      this.tide.draw(ctx, this.sprites, tileVariant, camera, sim, time, range);
      return;
    }
    const ox = camera.originX;
    const oy = camera.originY;
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        this.sprites.drawTile(ctx, this.terrainAt(c, r), c * TILE_W - ox, r * TILE_H - oy, TILE_W, TILE_H, tileVariant(c, r));
      }
    }
  }

  /**
   * Everything that stands on the ground, as EntityViews. Moving entities are interpolated between their
   * last two ticks by `alpha`, so motion is smooth on displays faster than the 60 Hz simulation.
   * Later steps add their entity lists here.
   * @param {{x:number,y:number,w:number,h:number}} [view] visible world rect: with a map, only props near it are listed
   * @returns {EntityView[]}
   */
  collectEntities(sim, alpha, view) {
    const p = sim.player;
    const out = [{
      id: 'player', kind: 'player', state: p.state, facing: p.facing,
      x: p.prevX + (p.x - p.prevX) * alpha, y: p.prevY + (p.y - p.prevY) * alpha,
    }];
    const props = sim.map && view
      ? sim.map.propsInRect(view.x - PROP_REACH_SIDE, view.y - SHADOW_PAD, view.x + view.w + PROP_REACH_SIDE, view.y + view.h + PROP_REACH_BELOW, this.propScratch)
      : sim.props;
    for (const prop of props) out.push({ id: prop.id, kind: prop.kind, x: prop.x, y: prop.y, state: 'idle', facing: null });
    return out;
  }

  /** one entity: shadow on the ground, then the upright billboard anchored at its feet */
  drawEntity(ctx, e, camera, time) {
    const x = Math.round(e.x) - camera.originX;
    const y = Math.round(e.y) - camera.originY;
    const size = this.sprites.size(e.kind, e.state);
    if (size.shadow !== 0) this.drawShadow(ctx, x, y, size.shadow ?? size.w);
    this.sprites.draw(ctx, e.kind, e.state, e.facing, x, y, time);
  }

  /** a soft oval: a wide faint ring around a darker core */
  drawShadow(ctx, x, y, spriteW) {
    const rx = Math.max(4, Math.round(spriteW * 0.4));
    const ry = Math.max(2, Math.round(rx * 0.4));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.beginPath();
    ctx.ellipse(x, y, rx * 0.65, ry * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
