// Debug tools for the player's body (steps 3.1 to 3.3; `?debug` only): the noise radius ring with its number,
// the recent noises, cover radii and the in-cover state, footprints with their ages, a vitals readout, and
// actions that set stamina, hydration and health, hit with an arrow, kill, and toggle "no needs". main.js calls
// registerPlayerDebug(debug) once debug mode is up; every write goes through cheats.js.
import { TICK_HZ } from '../../sim/constants.js';
import { COLORS, label } from './layers.js';
import * as cheats from './cheats.js';

export const DEBUG_COLORS = Object.freeze({ noise: '#e9c46a', heard: '#f4a261', cover: '#90be6d', coverOn: '#80ed99', print: '#d8d2bf' });

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));

/** the vitals readout lines for a player */
export function vitalsLines(sim) {
  const p = sim.player;
  const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
  return [
    `player ${p.state}  ${p.stance}${p.sprinting ? ' SPRINT' : ''}  ${p.mode}  ${f1(speed)}px/s`,
    `  stamina ${f1(p.stamina)}/${f1(p.staminaCap)}  rest ${p.restTicks}t`,
    `  noise ${f1(p.noiseRadius)}px on ${p.noiseSurface}  cover ${p.inCover ? 'YES' : 'no'}  sight x${p.visibilityFactor.toFixed(2)}`,
    `  hydration ${f1(p.hydration)}  health ${f1(p.health)}  bleed ${f1(p.bleedTicks / TICK_HZ)}s  limp ${f1(p.limpTicks / TICK_HZ)}s${p.drowning ? '  DROWNING' : ''}`,
    `  distance ${f1(p.distanceMetres)} m${p.noNeeds ? '  NO NEEDS' : ''}${sim.over ? `  OVER: ${sim.over.cause} day ${sim.over.day}` : ''}`,
  ];
}

/** a 1 px circle outline at a world point */
function ring(ctx, camera, x, y, r) {
  ctx.beginPath();
  ctx.arc(Math.round(x) - camera.originX + 0.5, Math.round(y) - camera.originY + 0.5, Math.max(0, r), 0, Math.PI * 2);
  ctx.stroke();
}

/** the player's interpolated position */
function playerAt(sim, alpha) {
  const p = sim.player;
  return { x: p.prevX + (p.x - p.prevX) * alpha, y: p.prevY + (p.y - p.prevY) * alpha };
}

/** cover props near a point: the map's prop index on the island, the few test-field props otherwise */
function coverPropsNear(sim, x, y, r) {
  const kinds = sim.tuning.props;
  const list = sim.map ? sim.map.propsNear(x, y, r) : sim.props;
  return list
    .map((p) => ({ p, r: p.cover === false ? 0 : p.coverRadius ?? kinds[p.kind]?.coverRadius ?? 0 }))
    .filter((c) => c.r > 0);
}

/**
 * Register the player layers and actions.
 * @param {import('./DebugMode.js').DebugMode} debug
 */
export function registerPlayerDebug(debug) {
  debug.addLayer({
    id: 'noise-radius', label: 'Noise radius (player)', group: 'player', default: true,
    drawWorld(ctx, sim, camera, env) {
      const r = sim.player.noiseRadius;
      if (!(r > 0)) return;
      const at = playerAt(sim, env.alpha);
      ctx.lineWidth = 1;
      ctx.strokeStyle = DEBUG_COLORS.noise;
      ctx.globalAlpha = 0.7;
      ring(ctx, camera, at.x, at.y, r);
      ctx.globalAlpha = 1;
    },
    drawUi(ctx, sim, vp, env) {
      const p = sim.player;
      const at = playerAt(sim, env.alpha);
      const s = env.camera.worldToScreen(at.x, at.y);
      label(ctx, `noise ${Math.round(p.noiseRadius)}`, s.x - 9, s.y + 4, DEBUG_COLORS.noise, 'right');
    },
  });
  debug.addLayer({
    id: 'noises', label: 'Recent noises', group: 'player', default: false,
    drawWorld(ctx, sim, camera) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = DEBUG_COLORS.heard;
      for (const n of sim.noise?.recent ?? []) {
        if (n.sourceId === 'player') continue;   // drawn by the noise radius layer
        ctx.globalAlpha = 0.6;
        ring(ctx, camera, n.x, n.y, n.radius);
      }
      ctx.globalAlpha = 1;
    },
    drawUi(ctx, sim, vp, env) {
      const f = sim.noise;
      for (const n of f?.recent ?? []) {
        const s = env.camera.worldToScreen(n.x, n.y);
        label(ctx, `${n.kind} ${Math.round(n.radius)} ${((f.tick - n.tick) / TICK_HZ).toFixed(1)}s`, s.x + 4, s.y - 10, DEBUG_COLORS.heard);
      }
    },
  });
  debug.addLayer({
    id: 'cover', label: 'Cover radii', group: 'player', default: false,
    drawWorld(ctx, sim, camera, env) {
      const at = playerAt(sim, env.alpha);
      ctx.lineWidth = 1;
      for (const c of coverPropsNear(sim, at.x, at.y, 160)) {
        const dx = c.p.x - at.x;
        const dy = c.p.y - at.y;
        ctx.strokeStyle = dx * dx + dy * dy <= c.r * c.r ? DEBUG_COLORS.coverOn : DEBUG_COLORS.cover;
        ring(ctx, camera, c.p.x, c.p.y, c.r);
      }
    },
    drawUi(ctx, sim, vp, env) {
      const p = sim.player;
      const at = playerAt(sim, env.alpha);
      const s = env.camera.worldToScreen(at.x, at.y);
      label(ctx, p.inCover ? 'IN COVER' : p.stance === 'crouch' ? 'crouched' : 'standing', s.x + 9, s.y + 4, p.inCover ? DEBUG_COLORS.coverOn : COLORS.dim);
    },
  });
  debug.addLayer({
    id: 'footprints', label: 'Footprints + ages', group: 'player', default: false,
    drawUi(ctx, sim, vp, env) {
      const t = sim.footprints;
      if (!t) return;
      t.list.forEach((f, i) => {
        if (i % 2) return;   // every other print, so the labels do not pile up
        const s = env.camera.worldToScreen(f.x, f.y);
        label(ctx, `${t.ageOf(f).toFixed(0)}`, s.x, s.y + 2, DEBUG_COLORS.print, 'center');
      });
    },
  });
  debug.addLayer({
    id: 'vitals', label: 'Player vitals', group: 'readouts', default: true,
    drawUi(ctx, sim, vp, env) {
      env.textBlock(ctx, vitalsLines(sim).map((text) => ({ text, color: COLORS.text })));
    },
  });
  const act = (id, label, run) => debug.addAction({ id, label, group: 'player', run });
  for (const v of [100, 10, 0]) act(`stamina-${v}`, `Stamina: ${v}`, (sim) => cheats.setStamina(sim, v));
  for (const v of [100, 10, 0]) act(`hydration-${v}`, `Hydration: ${v}`, (sim) => cheats.setHydration(sim, v));
  for (const v of [100, 10, 0]) act(`health-${v}`, `Health: ${v}`, (sim) => cheats.setHealth(sim, v));
  act('arrow', 'Hit with an arrow', (sim) => cheats.arrowHit(sim));
  act('kill', 'Kill the player', (sim) => cheats.killPlayer(sim));
  act('no-needs', 'No needs on/off', (sim) => cheats.toggleNoNeeds(sim));
}
