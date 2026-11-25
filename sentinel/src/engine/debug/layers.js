// The overlay layers debug mode ships with. Each is an OverlayLayer (see OverlayRegistry.js); later steps add
// theirs with `debug.addLayer` rather than editing this file.
//
// World layers draw on #world in logical pixels: a world point (x, y) is at (x - camera.originX, y - camera.originY).
// Lines are 1 px, offset by half a pixel so they land on whole pixels instead of blurring across two.
import { TILE_W, TILE_H } from '../../sim/constants.js';
import { spriteRect } from '../Renderer.js';

export const COLORS = Object.freeze({
  player: '#4cc9f0', prop: '#f4a261', grid: 'rgba(216, 210, 191, 0.18)', cursor: '#e9c46a', cull: '#90be6d',
  velocity: '#80ed99', facing: '#f72585', bounds: '#e76f51', text: '#d8d2bf', dim: 'rgba(216, 210, 191, 0.6)',
  real: '#90be6d', placeholder: '#e9c46a', bad: '#e76f51',
});

/**
 * Everything with a collision body, at its interpolated position, for the anchor layer.
 * Later steps add their entities here (scouts, pickups).
 * @returns {Array<{ id: string, kind: string, x: number, y: number, radius: number, color: string }>}
 */
export function collisionBodies(sim, alpha = 1) {
  const p = sim.player;
  const out = [{ id: 'player', kind: 'player', x: p.prevX + (p.x - p.prevX) * alpha, y: p.prevY + (p.y - p.prevY) * alpha, radius: p.radius, color: COLORS.player }];
  for (const prop of sim.props ?? []) out.push({ id: prop.id, kind: prop.kind, x: prop.x, y: prop.y, radius: prop.radius ?? 0, color: COLORS.prop });
  return out;
}

/** a 1 px circle outline */
function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(Math.round(x) + 0.5, Math.round(y) + 0.5, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** a 1 px rectangle outline around whole pixels */
function rectLine(ctx, x, y, w, h) {
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.max(0, Math.round(w) - 1), Math.max(0, Math.round(h) - 1));
}

function line(ctx, x0, y0, x1, y1) {
  ctx.beginPath();
  ctx.moveTo(Math.round(x0) + 0.5, Math.round(y0) + 0.5);
  ctx.lineTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
  ctx.stroke();
}

/** a small + at a point, whole pixels */
function cross(ctx, x, y, size = 2) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  ctx.fillRect(cx - size, cy, size * 2 + 1, 1);
  ctx.fillRect(cx, cy - size, 1, size * 2 + 1);
}

/** text with a dark outline so it reads on any ground */
export function label(ctx, text, x, y, color = COLORS.text, align = 'left') {
  ctx.font = '6px ui-monospace, Consolas, monospace';
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(11, 20, 22, 0.75)';
  const w = ctx.measureText(text).width;
  const bx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  ctx.fillRect(bx - 1, y - 1, w + 2, 8);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

const fixed = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : String(n));

/** the tile under a world point */
export function tileAt(wx, wy) {
  return { col: Math.floor(wx / TILE_W), row: Math.floor(wy / TILE_H) };
}

/** @returns {import('./OverlayRegistry.js').OverlayLayer[]} */
export function builtinLayers() {
  return [
    {
      id: 'grid', label: 'Tile grid', group: 'world', default: false,
      drawWorld(ctx, sim, camera, env) {
        const r = camera.visibleRect();
        const ox = camera.originX;
        const oy = camera.originY;
        ctx.fillStyle = COLORS.grid;
        for (let c = Math.floor(r.x / TILE_W); c * TILE_W <= r.x + r.w; c++) ctx.fillRect(c * TILE_W - ox, 0, 1, r.h);
        for (let rr = Math.floor(r.y / TILE_H); rr * TILE_H <= r.y + r.h; rr++) ctx.fillRect(0, rr * TILE_H - oy, r.w, 1);
        if (env.mouse) {
          const w = camera.screenToWorld(env.mouse.x, env.mouse.y);
          const t = tileAt(w.x, w.y);
          ctx.strokeStyle = COLORS.cursor;
          ctx.lineWidth = 1;
          rectLine(ctx, t.col * TILE_W - ox, t.row * TILE_H - oy, TILE_W + 1, TILE_H + 1);
        }
      },
      drawUi(ctx, sim, vp, env) {
        if (!env.mouse) return;
        const w = env.camera.screenToWorld(env.mouse.x, env.mouse.y);
        const t = tileAt(w.x, w.y);
        const right = env.mouse.x > vp.uiLogicalWidth - 70;
        label(ctx, `tile ${t.col},${t.row}  ${Math.round(w.x)},${Math.round(w.y)}`, env.mouse.x + (right ? -6 : 6), env.mouse.y + 6, COLORS.cursor, right ? 'right' : 'left');
      },
    },
    {
      id: 'anchors', label: 'Anchors + radii', group: 'world', default: true,
      drawWorld(ctx, sim, camera, env) {
        const ox = camera.originX;
        const oy = camera.originY;
        ctx.lineWidth = 1;
        for (const b of collisionBodies(sim, env.alpha)) {
          const x = b.x - ox;
          const y = b.y - oy;
          if (x < -40 || y < -40 || x > camera.viewW + 40 || y > camera.viewH + 40) continue;
          ctx.strokeStyle = b.color;
          ctx.fillStyle = b.color;
          if (b.radius > 0) circle(ctx, x, y, b.radius);
          cross(ctx, x, y);
        }
      },
    },
    {
      id: 'cull', label: 'Camera + culling', group: 'world', default: false,
      drawWorld(ctx, sim, camera, env) {
        const ox = camera.originX;
        const oy = camera.originY;
        ctx.lineWidth = 1;
        ctx.strokeStyle = COLORS.cull;
        rectLine(ctx, 0, 0, camera.viewW, camera.viewH);   // the culling rectangle is the view itself
        ctx.globalAlpha = 0.6;
        const views = env.renderer?.collectEntities ? env.renderer.collectEntities(sim, env.alpha) : [];
        for (const e of views) {
          const size = env.renderer.sprites.size(e.kind, e.state);
          const r = spriteRect(e, size);
          rectLine(ctx, r.x - ox, r.y - oy, r.w, r.h);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = COLORS.cull;
        cross(ctx, camera.x - ox, camera.y - oy, 4);   // camera centre
      },
      drawUi(ctx, sim, vp, env) {
        const s = env.renderer?.stats;
        const r = env.camera.visibleRect();
        if (s) label(ctx, `view ${r.x},${r.y} ${r.w}x${r.h}  tiles ${s.tiles}  drawn ${s.drawn}/${s.entities}`, vp.uiLogicalWidth / 2, vp.uiLogicalHeight - 10, COLORS.cull, 'center');
      },
    },
    {
      id: 'motion', label: 'Velocity + facing', group: 'player', default: true,
      drawWorld(ctx, sim, camera, env) {
        const p = sim.player;
        const a = env.alpha;
        const x = p.prevX + (p.x - p.prevX) * a - camera.originX;
        const y = p.prevY + (p.y - p.prevY) * a - camera.originY;
        ctx.lineWidth = 1;
        ctx.strokeStyle = COLORS.facing;
        line(ctx, x, y, x + p.dirX * 14, y + p.dirY * 14);
        if (p.vx || p.vy) {
          ctx.strokeStyle = COLORS.velocity;
          line(ctx, x, y, x + p.vx * 0.5, y + p.vy * 0.5);   // where it would be in half a second
        }
      },
      drawUi(ctx, sim, vp, env) {
        const p = sim.player;
        const s = env.camera.worldToScreen(p.x, p.y);
        label(ctx, `${p.facing} ${fixed(Math.hypot(p.vx, p.vy), 0)}px/s`, s.x + 9, s.y - 4, COLORS.facing);
      },
    },
    {
      id: 'bounds', label: 'World bounds', group: 'world', default: true,
      drawWorld(ctx, sim, camera) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = COLORS.bounds;
        const b = sim.bounds;
        if (b) { rectLine(ctx, b.x - camera.originX, b.y - camera.originY, b.w, b.h); return; }
        const f = sim.tuning?.testField;
        if (!f) return;
        ctx.setLineDash([3, 3]);   // the open field has no walls: dashed shows where the props were scattered
        rectLine(ctx, -f.halfWidth - camera.originX, -f.halfHeight - camera.originY, f.halfWidth * 2, f.halfHeight * 2);
      },
    },
    {
      id: 'stats', label: 'Stats', group: 'readouts', default: true,
      drawUi(ctx, sim, vp, env) { env.textBlock(ctx, env.debug.statsLines()); },
    },
    {
      id: 'input', label: 'Tick input', group: 'readouts', default: false,
      drawUi(ctx, sim, vp, env) {
        const i = env.lastInput;
        if (!i) { env.textBlock(ctx, ['input: (no tick yet)']); return; }
        const on = ['sprint', 'crouch', 'interact', 'useItem', 'toggleLight'].filter((k) => i[k]);
        env.textBlock(ctx, [
          `move ${fixed(i.moveX, 2)},${fixed(i.moveY, 2)}  ${on.join(' ') || '-'}`,
          `hotbar ${i.hotbar}  aim ${i.aimX === null ? '-' : `${Math.round(i.aimX)},${Math.round(i.aimY)}`}${env.debug.replaying ? '  [replay]' : ''}`,
        ]);
      },
    },
    {
      id: 'assets', label: 'Asset report', group: 'readouts', default: false,
      drawUi(ctx, sim, vp, env) {
        const r = env.assets?.report?.();
        if (!r) return;
        const lines = [`assets: manifest ${r.manifest}`];
        const add = (name, list, color) => { if (list?.length) lines.push({ text: `${name}: ${list.map((x) => (typeof x === 'string' ? x : x.what ?? x.sheet ?? JSON.stringify(x))).join(', ')}`, color }); };
        add('real', r.loaded, COLORS.real);
        add('placeholder (no art yet)', r.notReady, COLORS.placeholder);
        add('missing', r.missing, COLORS.bad);
        add('broken', r.broken, COLORS.bad);
        add('pending', r.pending, COLORS.dim);
        if (lines.length === 1) lines.push({ text: 'no sheets: everything is a placeholder', color: COLORS.placeholder });
        env.textBlock(ctx, lines);
      },
    },
  ];
}
