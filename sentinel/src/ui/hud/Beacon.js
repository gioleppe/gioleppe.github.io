// The beacon indicator (step 5.4): during the minute on Signal Peak it takes the tide widget's place with a small
// lamp and a bar that fills over the window, marked at 15, 30 and 45 s. No numbers: a subtle countdown, not a
// big timer. During the spotlight the bar is full and the lamp steady. Presentation only; reads sim.endings.
import { HUD_COLORS } from './TideWidget.js';
import { tideWidgetRect } from './TideWidget.js';
import { DT } from '../../sim/constants.js';

/**
 * How far the running window is: { fill 0..1, phase, seconds } or null when no window runs.
 * @param {Object} sim
 */
export function beaconReadout(sim) {
  const v = sim?.endings?.signal?.vigil;
  if (!v) return null;
  const total = (v.end - v.start) * DT;
  const s = (sim.tick - v.start) * DT;
  return { fill: v.phase === 'extract' ? 1 : Math.max(0, Math.min(1, s / total)), phase: v.phase, seconds: s, total };
}

/** the HUD widget (see HUD.js): drawn after the tide widget, over it */
export const beaconWidget = Object.freeze({
  id: 'beacon',
  draw(ctx, sim, { vp, safe, time = 0 }) {
    const r = beaconReadout(sim);
    if (!r) return;
    const rect = tideWidgetRect(vp, safe);
    drawBeacon(ctx, rect, r, time);
  },
});

/** the plate, the lamp (pulsing until the light comes) and the bar */
export function drawBeacon(ctx, rect, r, time = 0) {
  const C = HUD_COLORS;
  const { x, y, w, h } = rect;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = C.ink;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.frame;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
  // the lamp: a small amber diamond, pulsing once a second
  const pulse = r.phase === 'extract' ? 1 : 0.55 + 0.45 * Math.abs(Math.sin(time * Math.PI));
  const lx = x + 7;
  const ly = Math.round(y + h / 2);
  ctx.globalAlpha = pulse;
  ctx.fillStyle = '#f2a33a';
  ctx.fillRect(lx - 1, ly - 3, 3, 7);
  ctx.fillRect(lx - 3, ly - 1, 7, 3);
  ctx.globalAlpha = 1;
  // the bar
  const bx = x + 14;
  const bw = w - 19;
  const by = ly - 2;
  ctx.fillStyle = C.frame;
  ctx.fillRect(bx, by, bw, 5);
  ctx.fillStyle = '#d9a441';
  ctx.fillRect(bx + 1, by + 1, Math.round((bw - 2) * r.fill), 3);
  // quarter marks (the music's four sections)
  ctx.fillStyle = C.ink;
  for (const q of [0.25, 0.5, 0.75]) ctx.fillRect(Math.round(bx + bw * q), by, 1, 5);
  ctx.restore();
}
