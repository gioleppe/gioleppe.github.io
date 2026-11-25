// World drawing for the Sentinelese (steps 4.1 to 4.3): scouts as `sentinelese` billboards in the Y-sort (their
// sheet state is scout.anim: patrol, idle, search, warn_bow, lower_bow, chase), arrows in flight and arrows stuck
// in the ground, a faint silhouette of a watchful scout hidden by foliage, and the emote bubbles. Silhouettes and
// bubbles are drawn from Renderer.afterLighting (ScoutOverlays.install), so they read at night: the bubbles
// (Emotes.js, with their pop-in) are the scouts' only voice. Reads the simulation only.
import { drawEmote } from './Emotes.js';

/** palette colours (assets/src/palette.gpl): bone shaft, rust head, basalt shadow */
export const ARROW_COLORS = Object.freeze({ shaft: '#d2b07c', head: '#a8522b', fletch: '#e9e2cf', shadow: 'rgba(13, 11, 18, 0.3)', warn: '#e9e2cf' });

/** height of the sentinelese sprite above its feet, where a bubble sits */
const HEAD = 48;
/** culling boxes of drawn-by-hand views */
const ARROW_SIZE = Object.freeze({ w: 16, h: 16 });

/**
 * Scouts, arrows in flight and stuck arrows that may touch the view, as EntityViews (Renderer.collectEntities).
 * @param {import('../sim/Sim.js').Sim} sim
 * @param {{x:number,y:number,w:number,h:number}|null} view
 * @param {Object[]} out appended to
 */
export function collectScoutViews(sim, view, out, alpha = 1) {
  const scouts = sim.scouts;
  if (!scouts) return out;
  const m = 64;
  const inView = (x, y) => !view || (x > view.x - m && x < view.x + view.w + m && y > view.y - m && y < view.y + view.h + HEAD + m);
  for (const s of scouts.list) {
    const x = s.prevX + (s.x - s.prevX) * alpha;
    const y = s.prevY + (s.y - s.prevY) * alpha;
    if (!inView(x, y)) continue;
    out.push({ id: s.id, kind: 'sentinelese', state: s.anim, facing: s.facing, x, y });
  }
  for (const pr of sim.projectiles?.list ?? []) {
    if (pr.kind === 'throw') continue;   // thrown items are ItemRenderer's
    const x = pr.prevX + (pr.x - pr.prevX) * alpha;
    const y = pr.prevY + (pr.y - pr.prevY) * alpha;
    if (!inView(x, y)) continue;
    const f = Math.max(0, Math.min(1, (pr.t - 1 + alpha) / pr.ticks));
    const h = pr.heightAt(f) + 10 * (1 - f);   // loosed at chest height, coming down to the ground
    const dx = pr.x1 - pr.x0;
    const dy = pr.y1 - pr.y0;
    out.push({ id: pr.id, kind: 'arrow', x, y, state: 'idle', facing: null, size: ARROW_SIZE, paint: (ctx, sx, sy) => paintFlyingArrow(ctx, sx, sy, dx, dy, h) });
  }
  for (const a of scouts.stuck) {
    if (!inView(a.x, a.y)) continue;
    out.push({ id: `stuck_${a.tick}_${a.x}`, kind: 'arrow', x: a.x, y: a.y, state: 'idle', facing: null, size: ARROW_SIZE, paint: (ctx, sx, sy) => paintStuckArrow(ctx, sx, sy, a.dx, a.dy) });
  }
  return out;
}

/** unit vector of a direction (for drawing only) */
function unit(dx, dy) {
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  return [dx / d, dy / d];
}

/** an arrow in the air: a shadow on the ground and the shaft raised by its height */
export function paintFlyingArrow(ctx, x, y, dx, dy, h) {
  const [ux, uy] = unit(dx, dy);
  const L = 7;
  ctx.fillStyle = ARROW_COLORS.shadow;
  for (let i = -L; i <= 0; i += 2) ctx.fillRect(Math.round(x + ux * i), Math.round(y + uy * i * 0.6), 1, 1);
  const by = y - Math.round(h);
  ctx.fillStyle = ARROW_COLORS.shaft;
  for (let i = -L; i <= 0; i++) ctx.fillRect(Math.round(x + ux * i), Math.round(by + uy * i * 0.6), 1, 1);
  ctx.fillStyle = ARROW_COLORS.head;
  ctx.fillRect(Math.round(x + ux), Math.round(by + uy * 0.6), 1, 1);
  ctx.fillStyle = ARROW_COLORS.fletch;
  ctx.fillRect(Math.round(x - ux * L), Math.round(by - uy * L * 0.6) - 1, 1, 2);
}

/** an arrow stuck in the ground, leaning back the way it came */
export function paintStuckArrow(ctx, x, y, dx, dy) {
  const [ux] = unit(dx, dy);
  const lean = ux > 0.3 ? -1 : ux < -0.3 ? 1 : 0;
  ctx.fillStyle = ARROW_COLORS.shadow;
  ctx.fillRect(x - 2 + lean * 2, y, 4, 1);
  ctx.fillStyle = ARROW_COLORS.shaft;
  for (let i = 0; i < 7; i++) ctx.fillRect(x + Math.round((lean * i) / 3), y - i, 1, 1);
  ctx.fillStyle = ARROW_COLORS.fletch;
  ctx.fillRect(x + Math.round((lean * 7) / 3) - 1, y - 8, 3, 2);
}

/**
 * The bubble a scout shows now, or null: its emote, or (on patrol) a faint question mark that fills in as its
 * awareness rises, so the player sees the stare coming before the alarm.
 * @returns {{ name: string, alpha: number, urgency: number }|null}
 */
export function bubbleFor(s, tick, suspicious) {
  const e = s.emote;
  if (e && (e.until < 0 || tick < e.until)) {
    return { name: e.name, alpha: 1, urgency: s.state === 'investigate' ? s.awareness : s.state === 'chase' ? 1 : 0.3 };
  }
  if (s.state === 'patrol' && s.awareness > 0.05 && s.lod === 'near') {
    return { name: 'question', alpha: Math.min(1, 0.25 + (0.75 * s.awareness) / suspicious), urgency: s.awareness };
  }
  return null;
}

/** foliage and trunks that can hide a scout standing behind them (their sprite is drawn over the scout's) */
export const OCCLUDERS = Object.freeze(new Set(['palm', 'coconut_palm', 'banyan', 'mangrove', 'cliff_rock', 'tent', 'radio_rock']));
/** how strongly a hidden, watchful scout shows through the foliage */
export const SILHOUETTE_ALPHA = 0.4;
/** the sentinelese sprite's head top above its feet, px: a bubble's tail tip goes just above it */
export const HEAD_TOP = 43;

/**
 * The one place a bubble is painted: Emotes.js drawEmote (the pop-in, then the composed bubble), its tail tip a
 * pixel above the head.
 * @param {number} x screen x of the scout's feet
 * @param {number} y screen y of the scout's head top
 * @param {{ alpha?: number, popStartMs?: number|null, timeMs?: number, assets?: Object }} [opts]
 */
export function drawBubble(ctx, name, x, y, { alpha = 1, popStartMs = null, timeMs = 0, assets } = {}) {
  const before = ctx.globalAlpha;
  ctx.globalAlpha = before * alpha;
  drawEmote(ctx, name, x, y - 1, assets ? { popStartMs, timeMs, assets } : { popStartMs, timeMs });
  ctx.globalAlpha = before;
}

const propScratch = [];
/**
 * Is a scout's picture covered by foliage in front of it (a palm or a banyan south of it, whose sprite overlaps
 * the scout's)? Asks the map's prop index round the scout only: a few props per scout.
 * @param {(kind: string, state: string, variant?: number) => {w: number, h: number}} sizeOf
 */
export function occluded(sim, x, y, state, sizeOf) {
  const map = sim.map;
  if (!map) return false;
  const box = sizeOf('sentinelese', state);
  const props = map.propsInRect(x - 64, y + 1, x + 64, y + 160, propScratch);
  for (const p of props) {
    if (!OCCLUDERS.has(p.kind)) continue;
    const s = sizeOf(p.kind, 'idle', p.variant ?? 0);
    const third = s.w / 3;
    if (p.x + third < x - box.w / 2 || p.x - third > x + box.w / 2) continue;   // trunk and crown, not the sprite's edges
    if (p.y - s.h > y - box.h * 0.25) continue;                                   // its picture starts below the scout's chest
    return true;
  }
  return false;
}

/**
 * Draws everything over the scouts after the lighting pass: a faint silhouette of a scout that is aware of the
 * player (awareness at least `suspicious`, or hunting) but hidden behind foliage, so the threat stays readable in
 * the jungle; then the emote bubbles, which are the scouts' only voice and are never darkened. Keeps the time each
 * bubble appeared, for the pop-in (presentation state only).
 */
export class ScoutOverlays {
  /** @param {{ draw: Function, size: Function }} sprites the renderer's sprite source (AssetManager) */
  constructor(sprites) {
    this.sprites = sprites;
    /** @type {Map<string, { name: string, startMs: number }>} the bubble each scout shows, and since when */
    this.shown = new Map();
  }

  /** the Renderer.afterLighting hook */
  draw(ctx, sim, camera, { time = sim.time, alpha = 1 } = {}) {
    const scouts = sim.scouts;
    if (!scouts) return;
    const sus = sim.tuning?.ai?.awareness?.suspicious ?? 0.35;
    const view = camera.visibleRect();
    const timeMs = time * 1000;
    const sizeOf = (k, s, v) => this.sprites.size(k, s, v);
    for (const s of scouts.list) {
      const x = s.prevX + (s.x - s.prevX) * alpha;
      const y = s.prevY + (s.y - s.prevY) * alpha;
      if (x < view.x - 24 || x > view.x + view.w + 24 || y < view.y || y > view.y + view.h + 64) { this.shown.delete(s.id); continue; }
      const sx = Math.round(x) - camera.originX;
      const sy = Math.round(y) - camera.originY;
      if ((s.awareness >= sus || s.state !== 'patrol') && occluded(sim, x, y, s.anim, sizeOf)) {
        const before = ctx.globalAlpha;
        ctx.globalAlpha = before * SILHOUETTE_ALPHA;
        this.sprites.draw(ctx, 'sentinelese', s.anim, s.facing, sx, sy, time);
        ctx.globalAlpha = before;
      }
      const b = bubbleFor(s, sim.tick, sus);
      if (!b) { this.shown.delete(s.id); continue; }
      let seen = this.shown.get(s.id);
      if (!seen || seen.name !== b.name) { seen = { name: b.name, startMs: timeMs }; this.shown.set(s.id, seen); }
      // a slow bob, quicker and higher as the scout grows sure
      const bob = Math.round(Math.sin(time * (2 + 6 * b.urgency) + (s.x % 7)) * (1 + b.urgency));
      drawBubble(ctx, b.name, sx, sy - HEAD_TOP + bob, { alpha: b.alpha, popStartMs: seen.startMs, timeMs, assets: this.sprites });
    }
  }

  /**
   * Hook the overlays into a Renderer (after its lighting pass).
   * @param {{ afterLighting: Function[], sprites: Object }} renderer
   * @returns {ScoutOverlays}
   */
  static install(renderer) {
    const o = new ScoutOverlays(renderer.sprites);
    renderer.afterLighting.push((ctx, sim, camera, opts) => o.draw(ctx, sim, camera, opts));
    return o;
  }
}
