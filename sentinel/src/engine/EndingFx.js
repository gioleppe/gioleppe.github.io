// The endings' pictures (steps 5.3, 5.4), presentation only: the flare climbing over Signal Peak (an amber light
// rising for tuning.endings.signal.flareSeconds, seen from afar), the patrol boat out at sea with its engine light,
// and its spotlight sweeping the ridge (a strong moving light and a pale beam) until it settles on the player.
// Everything is derived from sim.endings each frame; nothing here writes the simulation. No new art: the boat is
// a few filled shapes, the lights go through the lighting layer (Lighting.addSource).
import { TICK_HZ } from '../sim/constants.js';
import { signalPointOf } from '../sim/endings/signal.js';

const AMBER = '#f2a33a';
const WHITE = '#e9f2ff';

/**
 * Where the flare is now: { x, y, k (0..1 burnt), intensity } or null.
 * @param {Object} sim
 * @param {number} alpha tick interpolation
 */
export function flareState(sim, alpha = 0) {
  const s = sim.endings?.signal;
  if (!s || s.lastFiredTick < 0) return null;
  const sp = signalPointOf(sim);
  if (!sp) return null;
  const secs = sim.tuning.endings.signal.flareSeconds;
  const t = (sim.tick - s.lastFiredTick + alpha) / TICK_HZ;
  if (t < 0 || t > secs) return null;
  const k = t / secs;
  // up fast, then hanging and drifting seaward while it burns down
  const rise = Math.min(1, t / 1.2);
  return { x: sp.x - 40 * k, y: sp.y - 30 - 150 * rise + 30 * k, k, intensity: 1 - k * k };
}

/**
 * The boat and its light: { bx, by, sx, sy, on } or null. The boat comes in from the sea side from
 * boatArriveSecond; the beam sweeps the ridge and, in the extraction, settles on the player.
 */
export function spotlightState(sim, alpha = 0) {
  const v = sim.endings?.signal?.vigil;
  if (!v) return null;
  const cfg = sim.tuning.endings.signal;
  const sp = signalPointOf(sim);
  if (!sp) return null;
  const t = (sim.tick - v.start + alpha) / TICK_HZ;
  const arrive = cfg.boatArriveSecond;
  if (t < arrive - 6) return null;
  const S = cfg.spotlight;
  const come = Math.max(0, Math.min(1, (t - (arrive - 6)) / 8));
  const bx = sp.x + S.offsetX * (1.6 - 0.6 * come);
  const by = sp.y + S.offsetY;
  const p = sim.player;
  const sweep = Math.sin(t * 0.9) * S.sweepPx;
  let sx = sp.x + sweep;
  let sy = sp.y + Math.cos(t * 0.6) * S.sweepPx * 0.4;
  if (v.phase === 'extract') {
    const k = Math.min(1, (sim.tick - (v.extractEnd - Math.round(cfg.extractSeconds * TICK_HZ))) / (cfg.extractSeconds * TICK_HZ * 0.6));
    sx += (p.x - sx) * k;
    sy += (p.y - sy) * k;
  }
  return { bx, by, sx, sy, on: t >= arrive, radius: S.radius };
}

/** register the lights and the beam on a Renderer (its lighting layer and afterLighting list) */
export function installEndingFx(renderer) {
  renderer.lighting?.addSource((sim, view, out) => {
    const f = flareState(sim);
    if (f) out.push({ id: 'flare', kind: 'flare', x: f.x, y: f.y, radius: 420, intensity: Math.min(1, 0.2 + f.intensity), color: AMBER, glow: 0.6 * f.intensity, flicker: 0.15 });
    const s = spotlightState(sim);
    if (s) {
      out.push({ id: 'boat', kind: 'boat', x: s.bx, y: s.by, radius: 60, intensity: 0.8, color: '#fff2c8', glow: 0.3 });
      if (s.on) out.push({ id: 'spotlight', kind: 'spotlight', x: s.sx, y: s.sy, radius: s.radius, intensity: 1, color: WHITE, glow: 0.35 });
    }
  });
  renderer.afterLighting.push((ctx, sim, camera, { alpha }) => {
    const s = spotlightState(sim, alpha);
    const f = flareState(sim, alpha);
    ctx.save();
    if (f) {
      const q = camera.worldToScreen(f.x, f.y);
      ctx.globalAlpha = 0.9 * f.intensity;
      ctx.fillStyle = '#fff0c0';
      ctx.fillRect(Math.round(q.x) - 1, Math.round(q.y) - 1, 3, 3);
      ctx.globalAlpha = 0.35 * f.intensity;
      ctx.fillStyle = AMBER;
      ctx.fillRect(Math.round(q.x), Math.round(q.y) + 2, 1, 10);
    }
    if (s) {
      const b = camera.worldToScreen(s.bx, s.by);
      // the hull, a cabin, a lamp
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#1b1a22';
      ctx.fillRect(Math.round(b.x) - 14, Math.round(b.y) - 3, 28, 6);
      ctx.fillStyle = '#d8d2bf';
      ctx.fillRect(Math.round(b.x) - 4, Math.round(b.y) - 8, 9, 5);
      ctx.fillStyle = '#fff2c8';
      ctx.fillRect(Math.round(b.x) + 6, Math.round(b.y) - 7, 2, 2);
      if (s.on) {
        const e = camera.worldToScreen(s.sx, s.sy);
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = WHITE;
        ctx.beginPath();
        ctx.moveTo(b.x + 7, b.y - 6);
        ctx.lineTo(e.x - s.radius * 0.45, e.y);
        ctx.lineTo(e.x + s.radius * 0.45, e.y);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  });
}
