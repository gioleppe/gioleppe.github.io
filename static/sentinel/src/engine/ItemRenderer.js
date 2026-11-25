// World drawing for items (steps 3.4 and 3.5): ground pickups as small item icons with a soft shadow, a slow bob
// and a periodic glint so loot is findable in grass; thrown items in flight (shadow on the ground, the body
// raised by the arc); a dust puff or splash where they land; and on desktop a faint aim marker at the clamped
// landing point of the throwable in hand. Pickups and projectiles are EntityViews with their own `paint`, so the
// Renderer Y-sorts them with everything else. Reads the simulation only.
import { ICON_SIZE } from './PlaceholderSprites.js';
import { planFlight, wantsThrow } from '../entities/Projectile.js';

/** palette colours (assets/src/palette.gpl) */
export const ITEM_COLORS = Object.freeze({
  glint: '#cfeedd', shadow: 'rgba(13, 11, 18, 0.28)', dust: '#e7cd98', splash: '#cfeedd', aim: '#f2a33a', blocked: '#a8522b',
  body: { rock: '#6c6570', coconut: '#46723a', default: '#d2b07c' }, bodyLight: { rock: '#8f8789', coconut: '#77983f', default: '#e7cd98' },
});

/** culling box of a pickup's picture */
const PICKUP_SIZE = Object.freeze({ w: ICON_SIZE, h: ICON_SIZE + 3 });

/** a stable small number per id, so pickups do not bob in step */
export function phaseOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * Draw one pickup with its anchor (ground point) at screen (x, y).
 * @param {{ drawIcon: Function }} sprites anything with drawIcon (AssetManager, PlaceholderSprites)
 */
export function paintPickup(ctx, sprites, item, phase, x, y, time) {
  const bob = Math.round(Math.sin((time * 1.6 + phase) * Math.PI * 2 * 0.5) * 1);
  ctx.fillStyle = ITEM_COLORS.shadow;
  ctx.beginPath();
  ctx.ellipse(x, y, 6, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  const ix = x - ICON_SIZE / 2;
  const iy = y - ICON_SIZE - 2 + bob;
  sprites.drawIcon(ctx, 'items', item, ix, iy);
  // a short glint every few seconds, out of step between pickups
  const g = (time / 3.2 + phase) % 1;
  if (g < 0.08) {
    const k = Math.floor(g / 0.02);
    ctx.fillStyle = ITEM_COLORS.glint;
    ctx.fillRect(ix + 11, iy + 2, 1, 1);
    if (k === 1 || k === 2) {
      ctx.fillRect(ix + 10, iy + 2, 3, 1);
      ctx.fillRect(ix + 11, iy + 1, 1, 3);
    }
  }
}

/** a thrown item in the air: shadow at the ground point, a small body raised by the arc */
export function paintProjectile(ctx, item, x, y, height) {
  ctx.fillStyle = ITEM_COLORS.shadow;
  ctx.fillRect(x - 2, y - 1, 4, 2);
  const by = Math.round(y - 3 - height);
  ctx.fillStyle = ITEM_COLORS.body[item] ?? ITEM_COLORS.body.default;
  const s = item === 'coconut' ? 4 : 3;
  ctx.fillRect(x - (s >> 1), by - s, s, s);
  ctx.fillStyle = ITEM_COLORS.bodyLight[item] ?? ITEM_COLORS.bodyLight.default;
  ctx.fillRect(x - (s >> 1), by - s, 1, 1);
}

/**
 * Ground pickups and things in flight whose picture may touch the view, as EntityViews (Renderer.collectEntities).
 * @param {import('../sim/Sim.js').Sim} sim
 * @param {{x:number,y:number,w:number,h:number}|null} view visible world rect
 * @param {Object[]} out appended to
 * @param {{ drawIcon: Function }} sprites
 * @param {Object[]} [scratch]
 */
export function collectItemViews(sim, view, out, sprites, scratch = [], alpha = 1) {
  for (const pr of sim.projectiles?.list ?? []) {
    const x = pr.prevX + (pr.x - pr.prevX) * alpha;
    const y = pr.prevY + (pr.y - pr.prevY) * alpha;
    const f = Math.max(0, Math.min(1, (pr.t - 1 + alpha) / pr.ticks));
    const h = pr.heightAt(f);
    out.push({
      id: pr.id, kind: 'projectile', x, y, state: 'idle', facing: null, size: { w: 8, h: 8 + Math.ceil(h) },
      paint: (ctx, sx, sy) => paintProjectile(ctx, pr.item, sx, sy, h),
    });
  }
  if (!sim.pickups) return out;
  const list = view
    ? sim.pickups.inRect(view.x - ICON_SIZE, view.y - 4, view.x + view.w + ICON_SIZE, view.y + view.h + ICON_SIZE + 4, scratch)
    : [...sim.pickups.ground.values()];
  for (const p of list) {
    const phase = phaseOf(p.id);
    out.push({
      id: p.id, kind: 'pickup', x: p.x, y: p.y, state: 'idle', facing: null, size: PICKUP_SIZE,
      paint: (ctx, x, y, time) => paintPickup(ctx, sprites, p.item, phase, x, y, time),
    });
  }
  return out;
}

/** dust or splash puffs where thrown things land, fed from sim events (presentation state only) */
export class ImpactEffects {
  constructor({ seconds = 0.45 } = {}) {
    this.seconds = seconds;
    /** @type {Array<{ x: number, y: number, water: boolean, born: number }>} */
    this.puffs = [];
  }

  /** after every sim.step */
  onStep(sim) {
    for (const e of sim.events) if (e.type === 'impact') this.puffs.push({ x: e.x, y: e.y, water: e.water, born: sim.time });
  }

  /**
   * Draw the live puffs on #world (after the scene).
   * @param {number} time seconds (sim.time)
   */
  draw(ctx, camera, time) {
    this.puffs = this.puffs.filter((p) => time - p.born < this.seconds && time >= p.born);
    for (const p of this.puffs) {
      const f = (time - p.born) / this.seconds;
      const x = Math.round(p.x) - camera.originX;
      const y = Math.round(p.y) - camera.originY;
      ctx.globalAlpha = 1 - f;
      ctx.fillStyle = p.water ? ITEM_COLORS.splash : ITEM_COLORS.dust;
      const r = 2 + Math.round(f * 7);
      const lift = p.water ? Math.round(f * (1 - f) * 16) : 0;
      for (const [dx, dy] of [[-1, 0], [1, 0], [-0.7, -0.6], [0.7, -0.6], [0, -1]]) {
        ctx.fillRect(Math.round(x + dx * r) - 1, Math.round(y + dy * r * 0.6) - 1 - lift, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
  }
}

/**
 * Where the throwable in hand would land if thrown at a world point now, or null when nothing would be thrown.
 * @param {import('../sim/Sim.js').Sim} sim
 * @returns {ReturnType<typeof planFlight>|null}
 */
export function throwPreview(sim, wx, wy) {
  if (!sim.inventory || !sim.tuning.throw || !Number.isFinite(wx) || !Number.isFinite(wy)) return null;
  if (!wantsThrow(sim, { aimX: wx, aimY: wy })) return null;
  return planFlight(sim, sim.player.x, sim.player.y, wx, wy, sim.tuning.throw);
}

/**
 * Desktop: a faint marker at the clamped landing point of the throwable in hand, aimed at the mouse. A dotted
 * line runs from the player; when the throw would be cut short (range or an obstacle) a small mark stays at the
 * cursor.
 * @param {{x:number,y:number}|null} mouse logical screen pixels, or null
 */
export function drawAimMarker(ctx, sim, camera, mouse) {
  if (!mouse) return;
  const w = camera.screenToWorld(mouse.x, mouse.y);
  const plan = throwPreview(sim, w.x, w.y);
  if (!plan) return;
  const p = sim.player;
  const ox = camera.originX;
  const oy = camera.originY;
  const lx = Math.round(plan.x) - ox;
  const ly = Math.round(plan.y) - oy;
  const sx = Math.round(p.x) - ox;
  const sy = Math.round(p.y) - oy;
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = ITEM_COLORS.aim;
  const n = Math.max(1, Math.floor(Math.sqrt((lx - sx) ** 2 + (ly - sy) ** 2) / 6));
  for (let i = 1; i < n; i++) ctx.fillRect(Math.round(sx + ((lx - sx) * i) / n), Math.round(sy + ((ly - sy) * i) / n), 1, 1);
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = ITEM_COLORS.aim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(lx + 0.5, ly + 0.5, 5, 2.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  if (plan.blocked || plan.clamped) {
    ctx.fillStyle = ITEM_COLORS.blocked;
    const cx = Math.round(mouse.x);
    const cy = Math.round(mouse.y);
    for (const [dx, dy] of [[-2, -2], [2, -2], [0, 0], [-2, 2], [2, 2]]) ctx.fillRect(cx + dx, cy + dy, 1, 1);
  }
  ctx.restore();
}
