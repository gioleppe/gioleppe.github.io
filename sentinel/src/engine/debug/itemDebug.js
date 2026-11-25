// Debug tools for items and interaction (steps 3.4 and 3.5; `?debug` only): layers for the interactables' radii
// and the current target, the pickups with their ids, and projectile paths; actions to give each item, clear or
// fill the inventory and spawn a pickup at the player. main.js calls registerItemDebug(debug) once debug mode is
// up; every write goes through cheats.js.
import { label, COLORS } from './layers.js';
import * as cheats from './cheats.js';

const C = Object.freeze({ radius: 'rgba(233, 196, 106, 0.55)', target: '#80ed99', pickup: '#f4a261', path: '#4cc9f0', land: '#f72585' });

function ring(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(Math.round(x) + 0.5, Math.round(y) + 0.5, r, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * Register the item layers and actions.
 * @param {import('./DebugMode.js').DebugMode} debug
 */
export function registerItemDebug(debug) {
  debug.addLayer({
    id: 'interact', label: 'Interactables: radii + target', group: 'items', default: false,
    drawWorld(ctx, sim, camera) {
      if (!sim.interactables) return;
      const v = camera.visibleRect();
      const reg = sim.interactables;
      ctx.lineWidth = 1;
      for (const it of reg.near(v.x + v.w / 2, v.y + v.h / 2, Math.max(v.w, v.h))) {
        ctx.strokeStyle = C.radius;
        ring(ctx, it.x - camera.originX, it.y - camera.originY, it.radius);
        label(ctx, `${it.id} ${it.action}`, it.x - camera.originX + 3, it.y - camera.originY + 2, COLORS.dim);
      }
      const t = sim.interactTarget;
      if (t) {
        ctx.strokeStyle = C.target;
        ring(ctx, t.x - camera.originX, t.y - camera.originY, 4);
        ring(ctx, t.x - camera.originX, t.y - camera.originY, 6);
      }
    },
  });
  debug.addLayer({
    id: 'pickups', label: 'Pickups with ids', group: 'items', default: false,
    drawWorld(ctx, sim, camera) {
      if (!sim.pickups) return;
      const v = camera.visibleRect();
      for (const p of sim.pickups.inRect(v.x - 8, v.y - 8, v.x + v.w + 8, v.y + v.h + 8)) {
        const x = Math.round(p.x) - camera.originX;
        const y = Math.round(p.y) - camera.originY;
        ctx.fillStyle = C.pickup;
        ctx.fillRect(x - 1, y - 1, 3, 3);
        label(ctx, `${p.id} ${p.item}${p.n > 1 ? ` x${p.n}` : ''}`, x + 3, y + 2, C.pickup);
      }
    },
  });
  debug.addLayer({
    id: 'projectiles', label: 'Projectile paths', group: 'items', default: false,
    drawWorld(ctx, sim, camera) {
      const list = sim.projectiles?.list ?? [];
      ctx.lineWidth = 1;
      for (const pr of list) {
        ctx.strokeStyle = C.path;
        ctx.beginPath();
        ctx.moveTo(Math.round(pr.x0 - camera.originX) + 0.5, Math.round(pr.y0 - camera.originY) + 0.5);
        ctx.lineTo(Math.round(pr.x1 - camera.originX) + 0.5, Math.round(pr.y1 - camera.originY) + 0.5);
        ctx.stroke();
        if (pr.aimX !== undefined && (pr.aimX !== pr.x1 || pr.aimY !== pr.y1)) {
          ctx.strokeStyle = C.land;
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(Math.round(pr.x1 - camera.originX) + 0.5, Math.round(pr.y1 - camera.originY) + 0.5);
          ctx.lineTo(Math.round(pr.aimX - camera.originX) + 0.5, Math.round(pr.aimY - camera.originY) + 0.5);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.strokeStyle = C.land;
        ring(ctx, pr.x1 - camera.originX, pr.y1 - camera.originY, 3);
      }
    },
    drawUi(ctx, sim, vp, env) {
      const inv = sim.inventory;
      if (!inv) return;
      const slots = inv.slots.map((s, i) => `${i === inv.selected ? '>' : ' '}${i + 1}:${s ? `${s.id}${s.n > 1 ? `x${s.n}` : ''}${s.on ? '*' : ''}` : '-'}`).join(' ');
      env.textBlock(ctx, [{ text: `inv ${slots}`, color: COLORS.text }, { text: `target ${sim.interactTarget?.id ?? '-'} ${sim.interactIcon ?? ''}  projectiles ${sim.projectiles?.list.length ?? 0}`, color: COLORS.dim }]);
    },
  });

  for (const id of debugItemIds(debug)) {
    debug.addAction({ id: `give-${id}`, label: `Give ${id}`, group: 'items', run: (sim) => debug.say(`gave ${cheats.giveItem(sim, id, 1)} ${id}`) });
  }
  debug.addAction({ id: 'inv-clear', label: 'Inventory: clear', group: 'items', run: (sim) => cheats.clearInventory(sim) });
  debug.addAction({ id: 'inv-fill', label: 'Inventory: fill (bone)', group: 'items', run: (sim) => cheats.fillInventory(sim) });
  debug.addAction({ id: 'spawn-pickup', label: 'Spawn rock at player', group: 'items', run: (sim) => debug.say(`spawned ${cheats.spawnPickup(sim, 'rock', 1).id}`) });
}

/** the item ids to make give-actions for: the running game's catalog */
function debugItemIds(debug) {
  return debug.sim?.catalog?.ids() ?? [];
}
