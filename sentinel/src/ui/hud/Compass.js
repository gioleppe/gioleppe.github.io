// The compass widget (spec §6.3, §9 HUD.js "Tide/Compass widget"): a small dial beside the tide indicator whose
// needle points north while Resonance is Quiet, jitters while it Hums and spins wildly when it is Agitated.
// Presentation only: the needle's motion is a function of the tier, the value and the clock, never stored.
import { tideWidgetRect } from './TideWidget.js';

/** widget size in logical pixels; the same height as the tide widget, `gap` px to its right */
export const COMPASS = Object.freeze({ w: 22, h: 22, gap: 3, r: 9 });

/** palette colours (assets/src/palette.gpl); the frame ones match HUD.js's tide widget */
export const COMPASS_COLORS = Object.freeze({
  ink: '#0d0b12',
  frame: '#4f4955',     // basalt_2
  text: '#e9e2cf',      // bone
  dim: '#8f8789',       // basalt_4
  face: '#1a284e',      // deep_1
  north: '#a8522b',     // rust_1, the red half
  south: '#8f8789',     // basalt_4
  violet: '#8b5cf6',    // violet, the monolith light
  cyan: '#6ff3ff',
});

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The needle's angle, clockwise from screen-up (north) in radians.
 *   Quiet: 0 (north is up: the map is drawn north-up).
 *   Humming: a jitter whose amplitude grows from compass.jitter[0] at the bottom of the tier to [1] at its top.
 *   Agitated: a spin at compass.spin[0] rad/s at 70 rising to [1] at 100, with a lurch so it never looks mechanical.
 * @param {'quiet'|'humming'|'agitated'} tier
 * @param {number} value 0..100
 * @param {number} time seconds (any clock; presentation only)
 * @param {Object} cfg tuning.resonanceFx.compass
 * @param {{ hummingAt: number, agitatedAt: number }} [tiers] tuning.resonance.tiers
 */
export function needleAngle(tier, value, time, cfg, tiers = { hummingAt: 31, agitatedAt: 70 }) {
  if (tier === 'humming') {
    const f = clamp01((value - tiers.hummingAt) / Math.max(1, tiers.agitatedAt - 1 - tiers.hummingAt));
    const amp = cfg.jitter[0] + (cfg.jitter[1] - cfg.jitter[0]) * f;
    const w = cfg.jitterSpeed;
    return amp * (0.6 * Math.sin(time * w) + 0.4 * Math.sin(time * w * 2.3 + 1.7));
  }
  if (tier === 'agitated') {
    const f = clamp01((value - tiers.agitatedAt) / Math.max(1, 100 - tiers.agitatedAt));
    const speed = cfg.spin[0] + (cfg.spin[1] - cfg.spin[0]) * f;
    return time * speed + 0.9 * Math.sin(time * 3.1) + 0.4 * Math.sin(time * 7.7);
  }
  return 0;
}

/**
 * Where the compass goes: right of the tide widget, same top.
 * @param {{x:number,y:number,w:number,h:number}} tideRect from tideWidgetRect
 */
export function compassRect(tideRect) {
  return { x: tideRect.x + tideRect.w + COMPASS.gap, y: tideRect.y, w: COMPASS.w, h: COMPASS.h };
}

/**
 * Draw the compass for the sim's Resonance next to the tide widget.
 * @param {CanvasRenderingContext2D} ctx #ui, logical pixels
 * @param {Object} sim
 * @param {{x:number,y:number,w:number,h:number}} tideRect
 * @param {number} [time] seconds; defaults to the sim's clock
 */
export function drawCompassWidget(ctx, sim, tideRect, time = sim.time) {
  const res = sim.resonance;
  if (!res) return;
  const cfg = sim.tuning.resonanceFx?.compass;
  const tiers = sim.tuning.resonance.tiers;
  const angle = cfg ? needleAngle(res.tier, res.value, time, cfg, tiers) : 0;
  drawCompass(ctx, compassRect(tideRect), angle, res.tier);
}

/** the dial with its needle at `angle` (clockwise from up) */
export function drawCompass(ctx, rect, angle, tier) {
  const C = COMPASS_COLORS;
  const K = COMPASS_COLORS;
  const { x, y, w, h } = rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.save();
  ctx.globalAlpha = 0.78;
  ctx.fillStyle = C.ink;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.fillStyle = tier === 'quiet' ? C.frame : K.violet;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);

  ctx.beginPath();
  ctx.arc(cx, cy, COMPASS.r, 0, Math.PI * 2);
  ctx.fillStyle = K.face;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = tier === 'agitated' ? K.cyan : tier === 'humming' ? K.violet : C.frame;
  ctx.stroke();
  // cardinal ticks
  ctx.fillStyle = C.dim;
  ctx.fillRect(Math.round(cx) - 1, y + 2, 2, 1);
  ctx.fillRect(Math.round(cx) - 1, y + h - 3, 2, 1);
  ctx.fillRect(x + 2, Math.round(cy) - 1, 1, 2);
  ctx.fillRect(x + w - 3, Math.round(cy) - 1, 1, 2);

  // needle: a red north half and a grey south half, as two thin triangles
  const len = COMPASS.r - 2;
  const sx = Math.sin(angle);
  const sy = -Math.cos(angle);
  const px = -sy * 1.6;
  const py = sx * 1.6;
  ctx.fillStyle = K.north;
  ctx.beginPath();
  ctx.moveTo(cx + sx * len, cy + sy * len);
  ctx.lineTo(cx + px, cy + py);
  ctx.lineTo(cx - px, cy - py);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = K.south;
  ctx.beginPath();
  ctx.moveTo(cx - sx * len, cy - sy * len);
  ctx.lineTo(cx + px, cy + py);
  ctx.lineTo(cx - px, cy - py);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.text;
  ctx.fillRect(Math.round(cx) - 1, Math.round(cy) - 1, 2, 2);
  ctx.restore();
}

/** the HUD widget (see HUD.js): beside the tide widget, the needle driven by the sim's clock */
export const compassWidget = Object.freeze({
  id: 'compass',
  draw(ctx, sim, { vp, safe }) {
    if (!sim?.resonance || !sim.world) return;
    drawCompassWidget(ctx, sim, tideWidgetRect(vp, safe));
  },
});
