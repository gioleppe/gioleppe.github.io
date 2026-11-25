// HUD widget: the body's bars (stamina, hydration, health) and status marks, top-left under the safe area
// (spec §6.2). Drawn procedurally with palette colours on whole pixels; the UI art sheet's 3-slice bars will
// replace `drawBar` and `drawIcon` only, so the readout and the layout stay as they are.
//
// - stamina shows the thirst cap: the part above the cap is drawn locked, with a mark at the cap
// - a bar below BAR_LOW of its maximum (hydration: below the stamina-cap threshold) pulses
// - status marks under the bars: crouching, in cover, bleeding, limping, swimming, drowning

import { drawResonanceBar } from './ResonanceBar.js';

/** palette colours (assets/src/palette.gpl names) */
export const BAR_COLORS = Object.freeze({
  ink: '#0d0b12',
  frame: '#4f4955',       // basalt_2
  back: '#24212c',        // basalt_0
  locked: '#37323f',      // basalt_1
  capMark: '#e9e2cf',     // bone
  text: '#e9e2cf',        // bone
  dim: '#8f8789',         // basalt_4
  stamina: '#779843',     // jungle_4
  staminaHi: '#b0b65c',   // jungle_5
  hydration: '#379a95',   // teal_2
  hydrationHi: '#66c2b0', // teal_3
  health: '#a8522b',      // rust_1
  healthHi: '#dba984',    // skin_2
  cover: '#467236',       // jungle_3
  bad: '#a8522b',         // rust_1
  water: '#28767e',       // teal_1
});

/** layout in logical pixels; `slots` rows are reserved, so a fourth bar does not move the status line */
export const BARS = Object.freeze({ x: 4, top: 4, rowH: 8, iconW: 5, gap: 2, barW: 48, barH: 5, slots: 4, marksH: 8 });
/** a bar below this fraction of its maximum pulses */
export const BAR_LOW = 0.25;
/** pulse rate of a low bar, flashes per second */
const PULSE_HZ = 2.5;

/** 5 x 5 icons, one string per row ('#' = pixel) */
const ICONS = Object.freeze({
  stamina: ['..##.', '.##..', '#####', '..##.', '.##..'],
  hydration: ['..#..', '.###.', '#####', '#####', '.###.'],
  health: ['.#.#.', '#####', '#####', '.###.', '..#..'],
});

/**
 * The body's bars, in slot order. Resonance (step 3.6) takes the fourth slot, drawn by drawResonanceBar
 * (ResonanceBar.js) from sim.resonance in the same row geometry.
 */
export const BAR_DEFS = Object.freeze([
  { id: 'stamina', value: (p) => p.stamina, max: (t) => t.stamina.max, cap: (p) => p.staminaCap },
  { id: 'hydration', value: (p) => p.hydration, max: (t) => t.hydration.max, lowAt: (t) => t.hydration.staminaCapBelow },
  { id: 'health', value: (p) => p.health, max: (t) => t.health.max },
]);

/**
 * What the bars show, as plain values (tested without a canvas).
 * @returns {Array<{ id: string, value: number, max: number, frac: number, capFrac: number, low: boolean }>}
 */
export function barReadout(player, tuning) {
  return BAR_DEFS.map((d) => {
    const max = d.max(tuning);
    const value = Math.max(0, Math.min(max, d.value(player)));
    const cap = d.cap ? Math.min(max, d.cap(player)) : max;
    const lowAt = d.lowAt ? d.lowAt(tuning) : max * BAR_LOW;
    return { id: d.id, value, max, frac: max > 0 ? value / max : 0, capFrac: max > 0 ? cap / max : 1, low: value < lowAt };
  });
}

/** the status marks to show, in a fixed order */
export function statusMarks(player) {
  const out = [];
  if (player.mode === 'swim') out.push({ id: 'swim', label: player.drowning ? 'DROWNING' : 'SWIM', color: player.drowning ? BAR_COLORS.bad : BAR_COLORS.water });
  else if (player.inCover) out.push({ id: 'cover', label: 'HIDDEN', color: BAR_COLORS.cover });
  else if (player.stance === 'crouch') out.push({ id: 'crouch', label: 'CROUCH', color: BAR_COLORS.frame });
  if (player.bleedTicks > 0) out.push({ id: 'bleed', label: 'BLEED', color: BAR_COLORS.bad });
  if (player.limpTicks > 0) out.push({ id: 'limp', label: 'LIMP', color: BAR_COLORS.frame });
  return out;
}

/**
 * Where the widget goes: top-left of the safe area, moved right/down by `reserve` (debug mode reserves its tab).
 * @param {{ uiLogicalWidth: number }} vp
 * @param {{ top: number, left: number }} safe
 * @param {{ left?: number, top?: number }} [reserve]
 */
export function barsRect(vp, safe, reserve = {}) {
  const w = BARS.iconW + BARS.gap + 1 + BARS.barW + 1;   // icon, gap, frame, bar, frame
  return {
    x: Math.round((safe.left || 0) + BARS.x + (reserve.left || 0)),
    y: Math.round((safe.top || 0) + BARS.top + (reserve.top || 0)),
    w,
    h: BARS.slots * BARS.rowH + BARS.marksH,
  };
}

/** one icon at (x, y) */
export function drawIcon(ctx, id, x, y, color) {
  const rows = ICONS[id];
  if (!rows) return;
  ctx.fillStyle = color;
  rows.forEach((row, dy) => {
    let start = -1;
    for (let dx = 0; dx <= row.length; dx++) {
      const on = row[dx] === '#';
      if (on && start < 0) start = dx;
      if (!on && start >= 0) { ctx.fillRect(x + start, y + dy, dx - start, 1); start = -1; }
    }
  });
}

/** one bar: frame, background, fill, the locked part above a cap, and the pulse when low */
export function drawBar(ctx, bar, x, y, time) {
  const C = BAR_COLORS;
  const W = BARS.barW;
  const H = BARS.barH;
  ctx.fillStyle = C.frame;
  ctx.fillRect(x - 1, y - 1, W + 2, H + 2);
  ctx.fillStyle = C.back;
  ctx.fillRect(x, y, W, H);
  const capPx = Math.round(bar.capFrac * W);
  if (capPx < W) {
    // the locked part: checkered, so it reads as "not available" rather than "empty"
    ctx.fillStyle = C.locked;
    for (let i = capPx; i < W; i++) if (i % 2 === 0) ctx.fillRect(x + i, y, 1, H);
  }
  const fill = Math.min(capPx, Math.round(bar.frac * W));
  const flash = bar.low && Math.floor(time * PULSE_HZ * 2) % 2 === 0;
  if (fill > 0) {
    ctx.fillStyle = flash ? C[`${bar.id}Hi`] ?? C.text : C[bar.id] ?? C.text;
    ctx.fillRect(x, y, fill, H);
    ctx.fillStyle = C[`${bar.id}Hi`] ?? C.text;
    ctx.fillRect(x, y, fill, 1);   // a lit top edge
  }
  if (capPx < W) {
    ctx.fillStyle = C.capMark;
    ctx.fillRect(x + capPx, y - 1, 1, H + 2);
  }
}

/**
 * Draw the bars and the marks.
 * @param {CanvasRenderingContext2D} ctx #ui context in logical pixels
 * @param {{x:number,y:number}} rect from barsRect
 * @param {ReturnType<typeof barReadout>} bars
 * @param {ReturnType<typeof statusMarks>} marks
 * @param {number} time seconds (presentation clock, drives the pulse)
 */
export function drawBars(ctx, rect, bars, marks, time) {
  const C = BAR_COLORS;
  ctx.save();
  bars.forEach((bar, i) => {
    const y = rect.y + i * BARS.rowH;
    const flash = bar.low && Math.floor(time * PULSE_HZ * 2) % 2 === 0;
    drawIcon(ctx, bar.id, rect.x, y + 1, flash ? C.text : C[`${bar.id}Hi`] ?? C.text);
    drawBar(ctx, bar, rect.x + BARS.iconW + BARS.gap + 1, y + 1, time);
  });
  if (marks.length) {
    ctx.font = '5px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let x = rect.x;
    const y = rect.y + BARS.slots * BARS.rowH;
    for (const m of marks) {
      const w = Math.ceil(ctx.measureText(m.label).width) + 4;
      ctx.fillStyle = m.color;
      ctx.fillRect(x, y, w, 7);
      ctx.fillStyle = C.text;
      ctx.fillText(m.label, x + 2, y + 1);
      x += w + 2;
    }
  }
  ctx.restore();
}

/** top of the fourth row, where the Resonance bar's frame starts (the body bars' frames start 1 px into their row) */
export function resonanceRowY(rect) {
  return rect.y + RESONANCE_SLOT * BARS.rowH;
}
/** the slot Resonance takes */
export const RESONANCE_SLOT = 3;

/** the HUD widget (see HUD.js) */
export const barsWidget = Object.freeze({
  id: 'bars',
  draw(ctx, sim, { vp, safe, time, reserve }) {
    if (!sim?.player || !sim.tuning?.hydration) return;
    const rect = barsRect(vp, safe, reserve);
    drawBars(ctx, rect, barReadout(sim.player, sim.tuning), statusMarks(sim.player), time);
    const r = sim.resonance;
    if (r) drawResonanceBar(ctx, rect.x, resonanceRowY(rect), rect.w, r.value, r.tier, sim.tuning.resonance?.tiers);
  },
});
