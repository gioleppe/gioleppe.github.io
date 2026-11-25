// Debug tools for Resonance and the fog of war (steps 3.6 and 3.7; `?debug` only): anomaly zones with their
// strengths, monolith proximity radii and pulse hearts, the fog grid near the player, a readout of the model (value,
// target, tier, each source, the totem, the multipliers, Shifting Paths, explored share), and actions to set or pin
// the value, reveal or forget the map and force Shifting Paths. main.js calls registerResonanceDebug(debug) once debug mode is up; every
// write goes through cheats.js.
import { COLORS, label } from './layers.js';
import * as cheats from './cheats.js';

const VIOLET = '#b794f6';
const f1 = (v) => v.toFixed(1);

/** the readout lines for a sim's Resonance */
export function resonanceLines(sim) {
  const r = sim.resonance;
  const s = r.sources;
  const pin = r.forced ? `  PINNED ${r.forcedTicks < 0 ? 'until released' : `${(r.forcedTicks / 60).toFixed(1)}s`}` : '';
  const next = r.pulses.length
    ? r.pulses.reduce((best, z) => {
      const left = (z.interval - z.phase) / (1 + r.cfg.pulseSpeedAtMax * (r.value / r.cfg.max));
      return !best || left < best.left ? { id: z.id, left } : best;
    }, null)
    : null;
  return [
    `resonance ${f1(r.value)} -> ${f1(r.target)}  ${r.tier.toUpperCase()}${pin}`,
    `  light ${f1(s.flashlight)}  electronics ${f1(s.electronics)}${s.electronicIds.length ? ` [${s.electronicIds.join(',')}]` : ''}  anomaly ${f1(s.anomaly)}  monolith ${f1(s.monolith)}  raw ${f1(s.raw)}`,
    `  totem ${s.totem ? `yes -${f1(s.dampened)}` : 'no'}  detection x${r.detectionMultiplier.toFixed(2)}  escalate ${r.escalate ? 'YES' : 'no'}  shifting ${r.shiftingPaths ? 'YES' : 'no'}`,
    next ? `  next pulse ${next.id} in ${next.left.toFixed(1)}s` : '  no anomaly zones',
    ...(sim.fog ? [fogLine(sim)] : []),
  ];
}

/** one line on the fog */
export function fogLine(sim) {
  const f = sim.fog;
  return `fog ${(f.exploredFraction * 100).toFixed(1)}% explored  ${f.discovered.size} landmarks  sight ${f.lastRadius}px  touched ${f.touched}  shifting ${f.shifting ? 'ON' : 'off'}${f.forced ? ' (forced)' : ''}`;
}

/**
 * Register the Resonance layers and actions.
 * @param {import('./DebugMode.js').DebugMode} debug
 */
export function registerResonanceDebug(debug) {
  debug.addLayer({
    id: 'anomaly', label: 'Anomaly zones', group: 'resonance', default: false,
    drawWorld(ctx, sim, camera) {
      if (!sim.map) return;
      const v = camera.visibleRect();
      ctx.lineWidth = 1;
      for (const z of sim.map.anomalyZones) {
        if (z.maxX < v.x || z.minX > v.x + v.w || z.maxY < v.y || z.minY > v.y + v.h) continue;
        ctx.strokeStyle = VIOLET;
        ctx.globalAlpha = 0.4 + 0.6 * z.strength;
        ctx.beginPath();
        z.points.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, Math.round(x - camera.originX) + 0.5, Math.round(y - camera.originY) + 0.5));
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha = 1;
        const [lx, ly] = z.points[0];
        label(ctx, `${z.id} ${z.strength}`, lx - camera.originX, ly - camera.originY, VIOLET);
      }
    },
  });
  debug.addLayer({
    id: 'monoliths', label: 'Monolith radii + pulse hearts', group: 'resonance', default: false,
    drawWorld(ctx, sim, camera) {
      const r = sim.resonance;
      if (!r) return;
      const R = r.cfg.monolithRadius;
      const v = camera.visibleRect();
      const list = sim.map ? sim.map.propsInRect(v.x - R, v.y - R, v.x + v.w + R, v.y + v.h + R) : sim.props;
      ctx.lineWidth = 1;
      ctx.strokeStyle = VIOLET;
      for (const p of list) {
        if (p.kind !== 'monolith') continue;
        ctx.beginPath();
        ctx.arc(Math.round(p.x - camera.originX) + 0.5, Math.round(p.y - camera.originY) + 0.5, R, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const z of r.pulses) {
        const x = Math.round(z.x - camera.originX);
        const y = Math.round(z.y - camera.originY);
        ctx.fillStyle = COLORS.cursor;
        ctx.fillRect(x - 2, y, 5, 1);
        ctx.fillRect(x, y - 2, 1, 5);
        label(ctx, `${z.id} every ${r.pulseInterval(z.strength).toFixed(1)}s`, x + 4, y + 2, COLORS.cursor);
      }
    },
  });
  debug.addLayer({
    id: 'fog', label: 'Fog grid near the player', group: 'resonance', default: false,
    drawWorld(ctx, sim, camera) {
      const f = sim.fog;
      if (!f) return;
      const v = camera.visibleRect();
      const { cellW, cellH } = f.cfg;
      const c0 = Math.max(0, Math.floor(v.x / cellW));
      const c1 = Math.min(f.cols - 1, Math.floor((v.x + v.w) / cellW));
      const r0 = Math.max(0, Math.floor(v.y / cellH));
      const r1 = Math.min(f.rows - 1, Math.floor((v.y + v.h) / cellH));
      ctx.lineWidth = 1;
      for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
          const x = Math.round(cx * cellW - camera.originX) + 0.5;
          const y = Math.round(cy * cellH - camera.originY) + 0.5;
          const seen = f.isCellExplored(cx, cy);
          const lost = !seen && f.isCellForgotten(cx, cy);
          ctx.strokeStyle = seen ? 'rgba(144, 190, 109, 0.5)' : lost ? 'rgba(183, 148, 246, 0.8)' : 'rgba(231, 111, 81, 0.35)';
          ctx.strokeRect(x + 1, y + 1, cellW - 3, cellH - 3);
        }
      }
      const p = sim.player;
      ctx.strokeStyle = f.shifting ? VIOLET : COLORS.cursor;
      ctx.beginPath();
      ctx.arc(Math.round(p.x - camera.originX) + 0.5, Math.round(p.y - camera.originY) + 0.5, Math.max(1, f.lastRadius), 0, Math.PI * 2);
      ctx.stroke();
      if (f.shifting) {
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(Math.round(p.x - camera.originX) + 0.5, Math.round(p.y - camera.originY) + 0.5, f.cfg.forgetRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    },
  });
  debug.addLayer({
    id: 'resonance', label: 'Resonance readout', group: 'readouts', default: true,
    drawUi(ctx, sim, vp, env) {
      if (!sim.resonance) return;
      const lines = resonanceLines(sim);
      const fx = env.renderer?.resonanceFx?.last;
      if (fx) lines.push(`  fx vignette ${fx.vignette.toFixed(2)}  distortion ${fx.distortion.toFixed(2)}  rings ${fx.rings}`);
      env.textBlock(ctx, lines.map((text, i) => ({ text, color: i ? COLORS.text : VIOLET })));
    },
  });

  const act = (id, label, run) => debug.addAction({ id, label, group: 'resonance', run });
  act('res-0', 'Resonance: 0', (sim) => cheats.setResonance(sim, 0));
  act('res-50', 'Resonance: 50', (sim) => cheats.setResonance(sim, 50));
  act('res-90', 'Resonance: 90', (sim) => cheats.setResonance(sim, 90));
  act('res-agitated', 'Resonance: Agitated for 30 s', (sim) => cheats.forceResonance(sim, 90, 30));
  act('fog-reveal', 'Map: reveal whole island', (sim) => cheats.revealMap(sim));
  act('fog-forget', 'Map: forget whole island', (sim) => cheats.forgetMap(sim));
  act('fog-shifting', 'Map: Shifting Paths forced on/off', (sim) => cheats.toggleShiftingPaths(sim));
}
