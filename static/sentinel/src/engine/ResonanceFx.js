// Resonance on screen (spec §6.3). Presentation only: reads sim.resonance, never writes the simulation.
// Drawn on #world after the lighting pass (Renderer.render), so it reads through the dark, and before the UI.
//
//   Humming   a violet vignette at the screen edges, breathing slowly.
//   Agitated  a stronger vignette, plus brief distortion pulses: the frame split into a violet copy and a cyan
//             copy a few pixels apart, and a few horizontal bands shifted sideways. A pulse lasts about a
//             quarter of a second and comes every 2.6 s at 70 down to every 1.2 s at 100, so the scene stays
//             readable between them. No per-pixel work: a handful of drawImage calls on canvases of view size.
//   Anomaly pulses  each zone's last pulse (sim.resonance.pulses[].last) draws a ring of violet light expanding
//             from its heart for ring.seconds, and a matching light in the lighting layer.
//   Monoliths  monolith lights within monolith.sightRadius of the player glow stronger as Resonance rises.
//
// tuning.resonanceFx.intensity scales every screen effect (vignette, distortion, rings); 0 turns them off, for
// comfort. The settings screen can expose it later.
import { DT } from '../sim/constants.js';

/** palette colours */
export const FX_COLORS = Object.freeze({ vignette: [58, 22, 112], violet: '#8b5cf6', violetRgb: [139, 92, 246], cyan: '#6ff3ff' });

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Vignette strength now: 0 when Quiet, else the tier's alpha breathing by pulseDepth, times intensity.
 * @param {'quiet'|'humming'|'agitated'} tier
 * @param {number} time seconds
 * @param {Object} fx tuning.resonanceFx
 */
export function vignetteAlpha(tier, time, fx) {
  if (tier === 'quiet' || !(fx.intensity > 0)) return 0;
  const v = fx.vignette;
  const base = tier === 'agitated' ? v.agitated : v.humming;
  const breath = 1 - v.pulseDepth * (0.5 + 0.5 * Math.sin(time * v.pulseSpeed));
  return clamp01(base * breath * fx.intensity);
}

/**
 * Distortion pulse strength now, 0..1 (0 = no pulse this frame). Agitated only. Pulses repeat every
 * everySeconds[0] at the Agitated threshold down to everySeconds[1] at 100 and last pulseSeconds, shaped as
 * half a sine so they flick in and out.
 * @param {'quiet'|'humming'|'agitated'} tier
 * @param {number} value 0..100
 * @param {number} time seconds
 * @param {Object} fx tuning.resonanceFx
 * @param {number} [agitatedAt]
 */
export function distortionStrength(tier, value, time, fx, agitatedAt = 70) {
  if (tier !== 'agitated' || !(fx.intensity > 0)) return 0;
  const d = fx.distortion;
  const f = clamp01((value - agitatedAt) / Math.max(1, 100 - agitatedAt));
  const period = d.everySeconds[0] + (d.everySeconds[1] - d.everySeconds[0]) * f;
  const phase = time - Math.floor(time / period) * period;
  if (phase >= d.pulseSeconds) return 0;
  return Math.sin((Math.PI * phase) / d.pulseSeconds);
}

/**
 * The ring of an anomaly pulse at this moment, or null when it has faded (or never pulsed).
 * @param {{ last: number, strength: number }} pulse an entry of sim.resonance.pulses
 * @param {number} tick sim.tick
 * @param {number} alpha tick interpolation 0..1
 * @param {number} value Resonance 0..100
 * @param {Object} fx tuning.resonanceFx
 * @returns {{ age: number, t: number, radius: number, alpha: number }|null}
 */
export function ringAt(pulse, tick, alpha, value, fx) {
  if (pulse.last < 0 || !(fx.intensity > 0)) return null;
  const age = (tick - pulse.last + alpha) * DT;
  const R = fx.ring;
  if (age < 0 || age >= R.seconds) return null;
  const t = age / R.seconds;
  const ease = 1 - (1 - t) * (1 - t);
  const a = R.alpha * (1 - t) * (0.45 + 0.55 * clamp01(value / 100)) * (0.5 + 0.5 * pulse.strength) * fx.intensity;
  return { age, t, radius: Math.max(1, R.radius * ease * (0.6 + 0.4 * pulse.strength)), alpha: clamp01(a) };
}

/** a stable 0..1 number for an integer, for band positions (no Math.random in drawing either, so frames repeat) */
function hash01(n) {
  let h = Math.imul(n | 0, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

function defaultCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const doc = globalThis.document;
  if (!doc) return null;
  const c = doc.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export class ResonanceFx {
  /** @param {{ createCanvas?: (w: number, h: number) => any }} [opts] */
  constructor({ createCanvas = defaultCanvas } = {}) {
    this.createCanvas = createCanvas;
    this.vignette = null;   // cached edge gradient at the view size
    this.vignetteKey = '';
    this.bufA = null;
    this.bufB = null;
    /** what the last frame drew, for the debug readout and tests */
    this.last = { vignette: 0, distortion: 0, rings: 0 };
    /** graphics quality: the split-frame distortion pulses (Quality.js; the vignette and rings always draw) */
    this.distortion = true;
    /** the lighting source: brighter monoliths near the player, and the pulse rings' light */
    this.lightSource = (sim, view, out) => this.addLights(sim, view, out);
  }

  /**
   * Lighting source (Lighting.addSource): boosts monolith lights within sight of the player with Resonance, and
   * adds a growing light at every pulsing anomaly heart.
   */
  addLights(sim, view, out) {
    const res = sim.resonance;
    const fx = sim.tuning.resonanceFx;
    if (!res || !fx) return;
    const p = sim.player;
    const v = clamp01(res.value / 100);
    const m = fx.monolith;
    const s2 = m.sightRadius * m.sightRadius;
    if (v > 0) {
      for (const l of out) {
        if (l.kind !== 'monolith') continue;
        const dx = l.x - p.x;
        const dy = l.y - p.y;
        if (dx * dx + dy * dy > s2) continue;
        const k = 1 + m.boost * v;
        l.intensity = Math.min(1, l.intensity * k);
        l.glow = (l.glow ?? 0) * k;
        l.radius *= 1 + 0.25 * m.boost * v;
      }
    }
    const R = fx.ring;
    for (const z of res.pulses) {
      const ring = ringAt(z, sim.tick, 0, res.value, fx);
      if (!ring) continue;
      out.push({
        id: `pulse:${z.id}`, kind: 'pulse', x: z.x, y: z.y - 6, radius: ring.radius, intensity: R.light * (1 - ring.t),
        color: FX_COLORS.violet, glow: 0.5 * (1 - ring.t),
      });
    }
  }

  /**
   * Draw the effects for this frame on #world.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} sim
   * @param {import('./Camera.js').Camera} camera
   * @param {{ time: number, alpha?: number }} opts
   */
  draw(ctx, sim, camera, { time, alpha = 1 }) {
    const res = sim.resonance;
    const fx = sim.tuning.resonanceFx;
    this.last = { vignette: 0, distortion: 0, rings: 0 };
    if (!res || !fx || !(fx.intensity > 0)) return;
    this.drawRings(ctx, sim, camera, alpha, fx);
    const w = camera.viewW;
    const h = camera.viewH;
    const d = distortionStrength(res.tier, res.value, time, fx, sim.tuning.resonance.tiers.agitatedAt);
    if (d > 0 && this.distortion) this.drawDistortion(ctx, w, h, d, time, fx);
    const va = vignetteAlpha(res.tier, time, fx);
    if (va > 0.003) this.drawVignette(ctx, w, h, va);
  }

  drawRings(ctx, sim, camera, alpha, fx) {
    const view = camera.visibleRect();
    const res = sim.resonance;
    const R = fx.ring;
    let n = 0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = FX_COLORS.violet;
    for (const z of res.pulses) {
      const ring = ringAt(z, sim.tick, alpha, res.value, fx);
      if (!ring) continue;
      const r = ring.radius;
      if (z.x + r < view.x || z.x - r > view.x + view.w || z.y + r < view.y || z.y - r > view.y + view.h) continue;
      const x = Math.round(z.x - camera.originX);
      const y = Math.round(z.y - camera.originY);
      // the ground is oblique: a circle on it is an ellipse 3/4 as tall on screen
      for (const [k, wk, ak] of [[1, R.width, 1], [0.82, Math.max(1, R.width - 1), 0.45]]) {
        ctx.globalAlpha = ring.alpha * ak;
        ctx.lineWidth = wk;
        ctx.beginPath();
        ctx.ellipse(x, y, r * k, r * k * 0.75, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      n++;
    }
    ctx.restore();
    this.last.rings = n;
  }

  /** a cached view-sized canvas (re-made when the view size changes) */
  buffer(which, w, h) {
    let c = this[which];
    if (!c) {
      c = this.createCanvas(w, h);
      if (!c) return null;
      this[which] = c;
    }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return c;
  }

  /** the frame split into a violet and a cyan copy, then a few bands slid sideways */
  drawDistortion(ctx, w, h, strength, time, fx) {
    const src = ctx.canvas;
    if (!src) return;
    const D = fx.distortion;
    const a = this.buffer('bufA', w, h);
    const b = this.buffer('bufB', w, h);
    if (!a || !b) return;
    const tint = (buf, color) => {
      const g = buf.getContext('2d');
      g.globalCompositeOperation = 'copy';
      g.drawImage(src, 0, 0, w, h, 0, 0, w, h);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = color;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
    };
    tint(a, FX_COLORS.violet);
    tint(b, FX_COLORS.cyan);
    const off = Math.max(1, Math.round(D.offset * strength * fx.intensity));
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = clamp01(D.alpha * strength * fx.intensity);
    ctx.drawImage(a, off, 0);
    ctx.drawImage(b, -off, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // bands: positions change only between pulses (seeded by which pulse this is), so a pulse does not crawl
    const seed = Math.floor(time * 4);
    const shift = Math.max(1, Math.round(D.bandShift * strength * fx.intensity));
    for (let i = 0; i < D.bands; i++) {
      const y = Math.floor(hash01(seed * 31 + i) * h);
      const bh = 2 + Math.floor(hash01(seed * 17 + i + 7) * 6);
      const dir = hash01(seed * 7 + i) < 0.5 ? -1 : 1;
      ctx.drawImage(src, 0, y, w, Math.min(bh, h - y), dir * shift, y, w, Math.min(bh, h - y));
    }
    ctx.restore();
    this.last.distortion = strength;
  }

  /** the violet edge vignette, cached per view size */
  drawVignette(ctx, w, h, alpha) {
    const key = `${w}x${h}`;
    if (this.vignetteKey !== key) {
      this.vignette = this.createCanvas(w, h);
      this.vignetteKey = key;
      if (this.vignette) {
        const g = this.vignette.getContext('2d');
        const [r, gg, b] = FX_COLORS.vignette;
        const cx = w / 2;
        const cy = h / 2;
        const outer = Math.sqrt(cx * cx + cy * cy);
        const grad = g.createRadialGradient(cx, cy, Math.min(cx, cy) * 0.55, cx, cy, outer);
        grad.addColorStop(0, `rgba(${r},${gg},${b},0)`);
        grad.addColorStop(0.55, `rgba(${r},${gg},${b},0.45)`);
        grad.addColorStop(1, `rgba(${r},${gg},${b},1)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
      }
    }
    if (!this.vignette) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.vignette, 0, 0);
    ctx.restore();
    this.last.vignette = alpha;
  }
}
