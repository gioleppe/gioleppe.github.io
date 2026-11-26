// Draws one frame of the world from a Sim (spec §2): oblique ground tiles, then every visible entity sorted by
// world y (painter's algorithm), each as a soft ground shadow and an upright billboard anchored at its feet.
// It only reads the simulation.
import { TILE_W, TILE_H } from '../sim/constants.js';
import { PlaceholderSprites } from './PlaceholderSprites.js';
import { TideRenderer } from './TideRenderer.js';
import { drawFootprints, drawNoiseRings } from './StealthRenderer.js';
import { Lighting } from './Lighting.js';
import { WeatherFx, swayOffsets, grassPush } from './WeatherFx.js';
import { waterAt, isWaterClass } from '../world/water.js';
import { collectItemViews } from './ItemRenderer.js';
import { propKind } from '../entities/storyInteractions.js';
import { collectScoutViews } from './ScoutRenderer.js';

/**
 * The seam every picture goes through. PlaceholderSprites implements it; the AssetManager (step 1.2) will
 * implement it with real sheets and fall back to PlaceholderSprites for anything missing.
 *
 * @typedef {Object} SpriteSource
 * @property {(kind: string, state?: string, variant?: number) => {w: number, h: number, shadow?: number, below?: number}} size
 *   Sprite box in logical pixels; the anchor is its bottom-centre. Used for culling, so it must not be smaller than what `draw` paints.
 *   `shadow`, if present, is the ground shadow width (0 = none); otherwise the shadow follows `w`. `below`, if present,
 *   is how far the picture reaches under the anchor. `variant` is a prop's variant (that picture's own box).
 * @property {(ctx: CanvasRenderingContext2D, kind: string, state: string, facing: ('N'|'E'|'S'|'W'|null), x: number, y: number, time: number, variant?: number) => void} draw
 *   Paint an entity with its anchor (ground contact point) at screen (x, y), whole logical pixels. `time` in seconds drives
 *   animation; `variant` (props, 0-2) picks one of the kind's pictures.
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
 * @property {{w:number,h:number}} [size]  culling box when the view paints itself (instead of the sprite size)
 * @property {(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) => void} [paint]  draws the view
 *   itself (shadow included) with its anchor at screen (x, y): pickups, projectiles
 * @property {number} [variant]  props: which of the kind's pictures (0-2)
 * @property {number} [phase]    seconds added to the animation clock, so neighbouring props do not animate in step
 * @property {boolean} [flat]    a ground decal: drawn in a ground pass before the y-sorted upright entities, no shadow
 * @property {('swim'|'wade'|null)} [water]  a character in water: foam at the waterline instead of a ground shadow
 */

/** room below the anchor for the ground shadow, in logical pixels, counted in culling */
const SHADOW_PAD = 4;
/** how far below the view a prop's anchor may be and still reach into it (tallest sprite), for the map's prop query */
const PROP_REACH_BELOW = 160;
/** half the widest prop sprite, for the same query */
const PROP_REACH_SIDE = 64;
/** how far above the view a prop's anchor may be while its base (drawn under the anchor) still reaches into it */
const PROP_REACH_ABOVE = 16;
/** horizontal slices a swaying sprite is drawn in */
export const SWAY_SLICES = 4;

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

/** the world rectangle an entity's picture can cover: its sprite box above the anchor, plus its shadow or base below */
export function spriteRect(e, size) {
  const below = size.below > SHADOW_PAD ? size.below : SHADOW_PAD;
  return { x: e.x - size.w / 2, y: e.y - size.h, w: size.w, h: size.h + below };
}

export function intersects(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * The entities whose picture touches `rect`, in draw order.
 * @param {EntityView[]} entities
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @param {(kind: string, state: string, variant?: number) => {w:number,h:number}} sizeOf
 * @returns {EntityView[]}
 */
export function cullAndSort(entities, rect, sizeOf) {
  return entities.filter((e) => intersects(spriteRect(e, e.size ?? sizeOf(e.kind, e.state, e.variant ?? 0)), rect)).sort(compareByY);
}

/**
 * Split a y-sorted list into ground decals (drawn first) and upright entities, each keeping the order.
 * @param {EntityView[]} sorted
 * @returns {{ flat: EntityView[], upright: EntityView[] }}
 */
export function splitFlat(sorted, flat = [], upright = []) {
  flat.length = 0;
  upright.length = 0;
  for (const e of sorted) (e.flat ? flat : upright).push(e);
  return { flat, upright };
}

/** a stable per-position number in [0, 1) for props: animation phase and automatic variants */
export function propHash(x, y) {
  return tileVariant(Math.round(x), Math.round(y)) / 4294967296;
}

/**
 * The EntityView of a map prop. Its variant is the map's, else (kinds with tuning.props[kind].autoVariant: the
 * scattered nature the map leaves unvaried) a stable hash of its position; the phase desynchronises animations.
 * @param {{ id: string, kind: string, x: number, y: number, variant?: number }} prop
 * @param {Object} [kc] tuning.props[prop.kind]
 * @returns {EntityView}
 */
export function propView(prop, kc) {
  const h = propHash(prop.x, prop.y);
  const variant = prop.variant ?? (kc?.autoVariant ? Math.floor(h * 3) : 0);
  return { id: prop.id, kind: prop.kind, x: prop.x, y: prop.y, state: 'idle', facing: null, variant, phase: h * 4, flat: !!kc?.flat };
}

/** foam at a swimmer's or wader's waterline (palette bone/teal, see-through) */
const FOAM = Object.freeze({ ring: 'rgba(207, 238, 221, 0.6)', dark: 'rgba(13, 11, 18, 0.16)' });

/** a ring of foam at the waterline (the swim frames show only head and shoulders) or round the shins when wading */
export function drawWaterRing(ctx, x, y, time, water) {
  const swim = water === 'swim';
  const rx = swim ? 9 : 7;
  const ry = swim ? 3 : 2;
  const wob = Math.sin(time * 3) > 0 ? 1 : 0;
  ctx.fillStyle = FOAM.dark;
  ctx.beginPath();
  ctx.ellipse(x, y, rx + 1, ry + 1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = FOAM.ring;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x, y - 0.5, rx + wob, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
}

const now = () => (globalThis.performance ? globalThis.performance.now() : 0);

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
  constructor({ sprites = new PlaceholderSprites(), terrainAt = testFieldTerrain, lighting = new Lighting(), weather = new WeatherFx(), resonanceFx = null } = {}) {
    /** @type {SpriteSource} */
    this.sprites = sprites;
    this.terrainAt = terrainAt;
    /** what the last frame processed, for debug overlays and tests */
    this.stats = { tiles: 0, entities: 0, drawn: 0, flat: 0, renderMs: 0, renderAvgMs: 0 };
    /** reused by the map's prop query every frame */
    this.propScratch = [];
    /** the island's ground under the tide: flooding, shoreline, water animation */
    this.tide = new TideRenderer();
    /** day/night tint and lights over the scene (null: none) */
    this.lighting = lighting;
    /** rain, splashes and the squall veil (null: none) */
    this.weather = weather;
    this.swayScratch = [];
    /** Resonance screen effects after the lighting pass (ResonanceFx.js; null: none); its light joins the lighting */
    this.resonanceFx = resonanceFx;
    if (resonanceFx && lighting) lighting.addSource(resonanceFx.lightSource);
    /** reused by the pickup query every frame */
    this.itemScratch = [];
    this.flatScratch = [];
    this.uprightScratch = [];
    /** drawn after the lighting pass, before Resonance effects: emote bubbles and other night-readable signals */
    this.afterLighting = [];
    /** presentation-only EntityViews added to every frame (debug: a lit campfire to look at) */
    this.extraViews = [];
  }

  /**
   * Draw a whole frame of the world onto the #world context.
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('../sim/Sim.js').Sim} sim
   * @param {import('./Camera.js').Camera} camera
   * @param {{ alpha?: number, time?: number }} [opts] alpha: tick interpolation 0..1; time: seconds for animation
   */
  render(ctx, sim, camera, { alpha = 1, time = sim.time } = {}) {
    const t0 = now();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0b1416';
    ctx.fillRect(0, 0, camera.viewW, camera.viewH);
    this.drawGround(ctx, camera, sim.bounds, sim, time);
    drawFootprints(ctx, sim, camera);

    const all = this.collectEntities(sim, alpha, camera.visibleRect());
    const visible = cullAndSort(all, camera.visibleRect(), (k, s, v) => this.sprites.size(k, s, v));
    const sway = this.swayContext(sim, alpha);
    // ground decals first, so nothing standing "behind" a spring or a pickup is hidden by it
    const { flat, upright } = splitFlat(visible, this.flatScratch, this.uprightScratch);
    for (const e of flat) this.drawEntity(ctx, e, camera, time, null);
    for (const e of upright) this.drawEntity(ctx, e, camera, time, sway);
    if (this.weather && sim.world) {
      const map = sim.map;
      this.weather.draw(ctx, sim, camera, time, map ? (tx, ty) => isWaterClass(waterAt(map, sim.world, tx, ty)) : null);
    }
    this.lighting?.draw(ctx, sim, camera, { time, alpha });
    drawNoiseRings(ctx, sim, camera, time);   // after the darkness: a loud noise is a signal, readable at night too
    // signals that must read at night (emote bubbles, Emotes.js): (ctx, sim, camera, { time, alpha })
    for (const fn of this.afterLighting) fn(ctx, sim, camera, { time, alpha });
    this.resonanceFx?.draw(ctx, sim, camera, { time, alpha });   // last: its vignette tints the edges over everything
    this.stats.entities = all.length;
    this.stats.drawn = visible.length;
    this.stats.flat = flat.length;
    const ms = now() - t0;
    this.stats.renderMs = ms;
    this.stats.renderAvgMs = this.stats.renderAvgMs ? this.stats.renderAvgMs + (ms - this.stats.renderAvgMs) * 0.05 : ms;
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
      // slightly see-through in cover, so the player can tell they are hidden (spec §6.1)
      alpha: p.inCover ? (sim.tuning?.cover?.spriteAlpha ?? 1) : 1,
      water: p.mode === 'swim' ? 'swim' : p.mode === 'wade' ? 'wade' : null,
    }];
    const props = sim.map && view
      ? sim.map.propsInRect(view.x - PROP_REACH_SIDE, view.y - PROP_REACH_ABOVE, view.x + view.w + PROP_REACH_SIDE, view.y + view.h + PROP_REACH_BELOW, this.propScratch)
      : sim.props;
    const kinds = sim.tuning?.props ?? {};
    for (const prop of props) {
      // propKind: a prop whose look follows the story (the patched dinghy, step 4.7)
      const kind = propKind(sim, prop);
      const view = propView(prop, kinds[kind]);
      view.kind = kind;
      out.push(view);
    }
    collectItemViews(sim, view ?? null, out, this.sprites, this.itemScratch, alpha);
    if (sim.marek) out.push(sim.marek.view());
    collectScoutViews(sim, view ?? null, out, alpha, this.sprites);
    for (const v of this.extraViews) out.push(v);
    return out;
  }

  /** what foliage sway needs this frame, or null when there is no wind to show */
  swayContext(sim, alpha) {
    const wind = sim.world?.windStrength ?? 0;
    const fx = sim.tuning?.weatherFx;
    if (!(wind > 0) || !fx) return null;
    const p = sim.player;
    return { wind, fx, props: sim.tuning.props ?? {}, px: p.prevX + (p.x - p.prevX) * alpha, py: p.prevY + (p.y - p.prevY) * alpha };
  }

  /**
   * One entity: shadow on the ground, then the upright billboard anchored at its feet. A kind with
   * tuning.props[kind].sway is drawn in horizontal slices sheared by the wind (the anchor slice never moves).
   */
  drawEntity(ctx, e, camera, time, sway = null) {
    const x = Math.round(e.x) - camera.originX;
    const y = Math.round(e.y) - camera.originY;
    if (e.paint) { e.paint(ctx, x, y, time); return; }
    const v = e.variant ?? 0;
    if (e.phase) time += e.phase;
    const size = this.sprites.size(e.kind, e.state, v);
    if (e.water) drawWaterRing(ctx, x, y, time, e.water);
    else if (size.shadow !== 0 && !e.flat) this.drawShadow(ctx, x, y, size.shadow ?? size.w);
    if (e.alpha !== undefined && e.alpha < 1) {
      const before = ctx.globalAlpha;
      ctx.globalAlpha = before * e.alpha;
      this.sprites.draw(ctx, e.kind, e.state, e.facing, x, y, time, v);
      ctx.globalAlpha = before;
      return;
    }
    const kc = sway && e.kind !== 'player' ? sway.props[e.kind] : null;
    if (kc?.sway > 0) {
      const push = kc.swayPush ? grassPush(e, sway.px, sway.py, kc.swayPush) : 0;
      const off = swayOffsets(kc.sway, sway.wind, time, e.x, e.y, SWAY_SLICES, sway.fx, push, this.swayScratch);
      if (off[SWAY_SLICES - 1] !== 0) {
        const sliceH = Math.ceil(size.h / SWAY_SLICES);
        const reach = Math.ceil(size.w / 2) + Math.abs(off[SWAY_SLICES - 1]) + 2;
        for (let k = 0; k < SWAY_SLICES; k++) {
          // the bottom slice also covers anything drawn below the anchor
          const top = k === SWAY_SLICES - 1 ? y - size.h - 8 : y - (k + 1) * sliceH;
          const bottom = k === 0 ? y + 8 : y - k * sliceH;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x - reach, top, reach * 2, bottom - top);
          ctx.clip();
          this.sprites.draw(ctx, e.kind, e.state, e.facing, x + off[k], y, time, v);
          ctx.restore();
        }
        return;
      }
    }
    this.sprites.draw(ctx, e.kind, e.state, e.facing, x, y, time, v);
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
