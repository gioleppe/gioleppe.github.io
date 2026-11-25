// Debug overlays for collision and terrain (step 2.3), registered by main.js with `debug.addLayer`:
// blocked tiles (hatched), solid prop circles (sight-blocking ones solid, others dashed), the player's collision
// circle with the last contact normal, a terrain/mode readout under the cursor, and a line-of-sight probe from
// the player to the cursor (green clear, red blocked). Reads the simulation only.
import { TILE_W, TILE_H } from '../../sim/constants.js';
import { terrainMove } from '../../world/collision.js';
import { label } from './layers.js';

const C = Object.freeze({
  hatch: 'rgba(231, 111, 81, 0.55)', edge: 'rgba(231, 111, 81, 0.9)', prop: '#e76f51', propSoft: '#f4a261',
  body: '#4cc9f0', normal: '#f72585', clear: '#80ed99', blocked: '#ff4d4d', text: '#d8d2bf',
});
const MODE_COLOR = Object.freeze({ ground: '#d8d2bf', wade: '#e9c46a', swim: '#4cc9f0' });

const px = (v) => Math.round(v) + 0.5;
const probe = { terrain: '', mode: 'ground', speed: 1 };

function cursorWorld(env) {
  return env.mouse ? env.camera.screenToWorld(env.mouse.x, env.mouse.y) : null;
}

/** @returns {import('./OverlayRegistry.js').OverlayLayer[]} */
export function collisionLayers() {
  return [
    {
      id: 'collision', label: 'Collision (tiles, props, body)', group: 'collision', default: true,
      drawWorld(ctx, sim, camera, env) {
        const map = sim.map;
        const col = sim.collider;
        if (!map || !col) return;
        const ox = camera.originX;
        const oy = camera.originY;
        const r = camera.visibleRect();
        ctx.lineWidth = 1;
        // blocked tiles: diagonal hatch plus an outline
        ctx.strokeStyle = C.hatch;
        ctx.beginPath();
        for (let ty = Math.max(0, Math.floor(r.y / TILE_H)); ty * TILE_H <= r.y + r.h && ty < map.height; ty++) {
          for (let tx = Math.max(0, Math.floor(r.x / TILE_W)); tx * TILE_W <= r.x + r.w && tx < map.width; tx++) {
            if (!map.isBlocked(tx, ty)) continue;
            const x0 = tx * TILE_W - ox;
            const y0 = ty * TILE_H - oy;
            for (let k = 6; k < TILE_W + TILE_H; k += 6) {
              // a line x + y = k clipped to the tile
              const ax = Math.min(k, TILE_W);
              const ay = k - ax;
              const by = Math.min(k, TILE_H);
              const bx = k - by;
              ctx.moveTo(px(x0 + ax), px(y0 + ay));
              ctx.lineTo(px(x0 + bx), px(y0 + by));
            }
            ctx.rect(px(x0), px(y0), TILE_W - 1, TILE_H - 1);
          }
        }
        ctx.stroke();
        // solid props
        for (const p of sim.props) {
          if (!col.propIsSolid(p)) continue;
          const x = p.x - ox;
          const y = p.y - oy;
          if (x < -40 || y < -40 || x > camera.viewW + 40 || y > camera.viewH + 40) continue;
          const sight = col.propBlocksSight(p);
          ctx.strokeStyle = sight ? C.prop : C.propSoft;
          ctx.setLineDash(sight ? [] : [2, 2]);
          ctx.beginPath();
          ctx.arc(px(x), px(y), Math.max(1, p.radius), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        // the player's body and the last contact normal
        const pl = sim.player;
        const a = env.alpha;
        const bx = pl.prevX + (pl.x - pl.prevX) * a - ox;
        const by = pl.prevY + (pl.y - pl.prevY) * a - oy;
        ctx.strokeStyle = MODE_COLOR[pl.mode] ?? C.body;
        ctx.beginPath();
        ctx.arc(px(bx), px(by), pl.radius, 0, Math.PI * 2);
        ctx.stroke();
        if (pl.contactX || pl.contactY) {
          ctx.strokeStyle = C.normal;
          ctx.beginPath();
          ctx.moveTo(px(bx - pl.contactX * pl.radius), px(by - pl.contactY * pl.radius));
          ctx.lineTo(px(bx + pl.contactX * 10), px(by + pl.contactY * 10));
          ctx.stroke();
        }
      },
    },
    {
      id: 'terrain', label: 'Terrain + mode readout', group: 'collision', default: true,
      drawUi(ctx, sim, vp, env) {
        const map = sim.map;
        if (!map) return;
        const p = sim.player;
        const tide = sim.tideHeight();
        const lines = [{ text: `player ${p.mode} on ${p.terrain}  tide ${tide.toFixed(2)}`, color: MODE_COLOR[p.mode] ?? C.text }];
        const w = cursorWorld(env);
        if (w) {
          const tx = Math.floor(w.x / TILE_W);
          const ty = Math.floor(w.y / TILE_H);
          terrainMove(map, w.x, w.y, tide, sim.terrainRules, probe);
          const flood = map.floodLevel(tx, ty);
          lines.push({
            text: `cursor ${tx},${ty} ${probe.terrain}${map.isBlocked(tx, ty) ? ' BLOCKED' : ''}  ${probe.mode} x${probe.speed.toFixed(2)}`
              + `  flood ${flood}${map.isFlooded(tx, ty, tide) ? ' (under)' : ''}`,
            color: map.isBlocked(tx, ty) ? C.blocked : MODE_COLOR[probe.mode],
          });
        }
        env.textBlock(ctx, lines);
      },
    },
    {
      id: 'los', label: 'Line of sight to cursor', group: 'collision', default: true,
      drawWorld(ctx, sim, camera, env) {
        const w = cursorWorld(env);
        if (!w || !sim.collider) return;
        const p = sim.player;
        const blocked = sim.collider.segmentBlocked(p.x, p.y, w.x, w.y);
        ctx.strokeStyle = blocked ? C.blocked : C.clear;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(px(p.x - camera.originX), px(p.y - camera.originY));
        ctx.lineTo(px(w.x - camera.originX), px(w.y - camera.originY));
        ctx.stroke();
      },
      drawUi(ctx, sim, vp, env) {
        if (!env.mouse || !sim.collider) return;
        const w = cursorWorld(env);
        const blocked = sim.collider.segmentBlocked(sim.player.x, sim.player.y, w.x, w.y);
        label(ctx, blocked ? 'LOS blocked' : 'LOS clear', env.mouse.x + 6, env.mouse.y - 10, blocked ? C.blocked : C.clear);
      },
    },
  ];
}
