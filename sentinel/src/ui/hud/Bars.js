// HUD widget: the body's bars (stamina, hydration, health), the Resonance row, and the status icons, top-left under
// the safe area (spec §6.2). Drawn from the ui sheet (ICONS.md "HUD bars", "Status icons"): an 8 x 8 icon, the
// 3-slice frame `bar_*` with the per-stat 3-slice fill `fill_<stat>_*` inside it, and a line of 8 x 8 status icons
// under the bars. Until the sheet has loaded the same geometry is drawn procedurally in palette colours.
//
// - stamina shows the thirst cap: the trough above the cap is checkered (locked), with a bone mark at the cap
// - a bar below BAR_LOW of its maximum (hydration: below the stamina-cap threshold) pulses
// - status icons: crouching or in cover, wet (wading, swimming; blinking when drowning), bleeding, thirsty, light on,
//   noise (1-3 arcs), metal or electronics in hand; limping has no icon and stays a small text chip

import { drawResonanceBar } from './ResonanceBar.js';
import { activeAssets } from '../../engine/AssetManager.js';

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

/**
 * Layout in logical pixels (ICONS.md: icon 8 x 8, bar at icon x + 10, frame 8 high, fill 4 high at +2,+2).
 * `slots` rows are reserved, so the Resonance row does not move the status line; `marksH` is the status line.
 */
export const BARS = Object.freeze({ x: 4, top: 4, rowH: 10, iconW: 8, gap: 2, barW: 56, barH: 8, slots: 4, marksH: 10, markStep: 10 });
/** a bar below this fraction of its maximum pulses */
export const BAR_LOW = 0.25;
/** pulse rate of a low bar, flashes per second */
const PULSE_HZ = 2.5;
/** noise radius (world px) at or below which the noise icon shows 1 arc, 2 arcs; above: 3 (crouch 20, walk 60, sprint 180) */
export const NOISE_ARCS = Object.freeze([30, 110]);

/** 5 x 5 fallback icons, one string per row ('#' = pixel) */
const ICONS = Object.freeze({
  stamina: ['..##.', '.##..', '#####', '..##.', '.##..'],
  hydration: ['..#..', '.###.', '#####', '#####', '.###.'],
  health: ['.#.#.', '#####', '#####', '.###.', '..#..'],
});

/**
 * The body's bars, in slot order. Resonance takes the fourth slot, drawn by drawResonanceBar (ResonanceBar.js)
 * from sim.resonance in the same row geometry.
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

/** how many arcs the noise icon lights for a noise radius (0: no icon) */
export function noiseArcs(radius) {
  if (!(radius > 0)) return 0;
  return radius <= NOISE_ARCS[0] ? 1 : radius <= NOISE_ARCS[1] ? 2 : 3;
}

/**
 * The status marks to show, in a fixed order. `icon` is the ui-sheet status icon (null: a text chip).
 * @param {Object} player
 * @param {Object} [tuning] for "thirsty" (hydration below the stamina-cap threshold)
 * @param {Object} [inventory] for "metal in hand"
 * @returns {Array<{ id: string, label: string, color: string, icon: string|null, blink?: boolean }>}
 */
export function statusMarks(player, tuning = null, inventory = null) {
  const out = [];
  const C = BAR_COLORS;
  if (player.mode === 'swim') out.push({ id: 'swim', label: player.drowning ? 'DROWNING' : 'SWIM', color: player.drowning ? C.bad : C.water, icon: 'status_wet', blink: !!player.drowning });
  else if (player.inCover) out.push({ id: 'cover', label: 'HIDDEN', color: C.cover, icon: 'status_hidden' });
  else if (player.stance === 'crouch') out.push({ id: 'crouch', label: 'CROUCH', color: C.frame, icon: 'status_crouch' });
  if (player.mode === 'wade') out.push({ id: 'wet', label: 'WET', color: C.water, icon: 'status_wet' });
  if (player.bleedTicks > 0) out.push({ id: 'bleed', label: 'BLEED', color: C.bad, icon: 'status_bleeding' });
  const thirstAt = tuning?.hydration?.staminaCapBelow;
  if (thirstAt !== undefined && player.hydration < thirstAt) out.push({ id: 'thirsty', label: 'THIRST', color: C.water, icon: 'status_thirsty' });
  if (player.lightOn) out.push({ id: 'light', label: 'LIGHT', color: C.frame, icon: 'status_light' });
  const arcs = noiseArcs(player.noiseRadius);
  if (arcs) out.push({ id: 'noise', label: `NOISE ${arcs}`, color: C.frame, icon: `status_noise_${arcs}` });
  if (inventory?.holdingMetalOrElectronics) out.push({ id: 'metal', label: 'METAL', color: C.frame, icon: 'status_metal' });
  if (player.limpTicks > 0) out.push({ id: 'limp', label: 'LIMP', color: C.frame, icon: null });
  return out;
}

/**
 * Where the widget goes: top-left of the safe area, moved right/down by `reserve` (debug mode reserves its tab).
 * @param {{ uiLogicalWidth: number }} vp
 * @param {{ top: number, left: number }} safe
 * @param {{ left?: number, top?: number }} [reserve]
 */
export function barsRect(vp, safe, reserve = {}) {
  return {
    x: Math.round((safe.left || 0) + BARS.x + (reserve.left || 0)),
    y: Math.round((safe.top || 0) + BARS.top + (reserve.top || 0)),
    w: BARS.iconW + BARS.gap + BARS.barW,
    h: BARS.slots * BARS.rowH + BARS.marksH,
  };
}

/** one fallback icon at (x, y) */
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

/** an 8-high frame with a 4-high trough, procedurally (the shape of the ui sheet's bar_* 3-slice) */
export function drawFrameFallback(ctx, x, y, w) {
  const C = BAR_COLORS;
  ctx.fillStyle = C.ink;
  ctx.fillRect(x, y, w, BARS.barH);
  ctx.fillStyle = C.frame;
  ctx.fillRect(x + 1, y + 1, w - 2, BARS.barH - 2);
  ctx.fillStyle = C.back;
  ctx.fillRect(x + 2, y + 2, w - 4, BARS.barH - 4);
}

/**
 * One body bar with its frame at (x, y): fill, the locked part above a cap, the cap mark, and the pulse when low.
 * @param {import('../../engine/AssetManager.js').AssetManager|null} [art] draws the ui sheet when it has loaded
 */
export function drawBar(ctx, bar, x, y, time, art = null) {
  const C = BAR_COLORS;
  const W = BARS.barW;
  const inner = W - 4;
  const sheet = !!art?.hasIcon('ui', 'bar_l');
  if (sheet) art.drawPanel3(ctx, 'ui', 'bar', x, y, W);
  else drawFrameFallback(ctx, x, y, W);
  const capPx = Math.round(bar.capFrac * inner);
  const fill = Math.min(capPx, Math.round(bar.frac * inner));
  const flash = bar.low && Math.floor(time * PULSE_HZ * 2) % 2 === 0;
  if (fill > 0) {
    if (sheet && art.hasIcon('ui', `fill_${bar.id}_m`)) {
      art.drawPanel3(ctx, 'ui', `fill_${bar.id}`, x + 2, y + 2, fill);
      if (flash) {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = C.text;
        ctx.fillRect(x + 2, y + 2, fill, 4);
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.fillStyle = flash ? C[`${bar.id}Hi`] ?? C.text : C[bar.id] ?? C.text;
      ctx.fillRect(x + 2, y + 2, fill, 4);
      ctx.fillStyle = C[`${bar.id}Hi`] ?? C.text;
      ctx.fillRect(x + 2, y + 2, fill, 1);   // a lit top edge
    }
  }
  if (capPx < inner) {
    // the locked part: checkered, so it reads as "not available" rather than "empty"
    ctx.fillStyle = C.locked;
    for (let i = capPx; i < inner; i++) if (i % 2 === 0) ctx.fillRect(x + 2 + i, y + 2, 1, 4);
    ctx.fillStyle = C.capMark;
    ctx.fillRect(x + 2 + capPx, y + 1, 1, BARS.barH - 2);
  }
}

/**
 * Draw the bars and the status line.
 * @param {CanvasRenderingContext2D} ctx #ui context in logical pixels
 * @param {{x:number,y:number}} rect from barsRect
 * @param {ReturnType<typeof barReadout>} bars
 * @param {ReturnType<typeof statusMarks>} marks
 * @param {number} time seconds (presentation clock, drives the pulse)
 * @param {import('../../engine/AssetManager.js').AssetManager|null} [art] defaults to the page's AssetManager
 */
export function drawBars(ctx, rect, bars, marks, time, art = activeAssets()) {
  const C = BAR_COLORS;
  ctx.save();
  bars.forEach((bar, i) => {
    const y = rect.y + i * BARS.rowH;
    const flash = bar.low && Math.floor(time * PULSE_HZ * 2) % 2 === 0;
    if (art?.hasIcon('ui', `icon_${bar.id}`)) {
      if (flash) ctx.globalAlpha = 0.5;
      art.drawIcon(ctx, 'ui', `icon_${bar.id}`, rect.x, y);
      ctx.globalAlpha = 1;
    } else drawIcon(ctx, bar.id, rect.x + 1, y + 1, flash ? C.text : C[`${bar.id}Hi`] ?? C.text);
    drawBar(ctx, bar, rect.x + BARS.iconW + BARS.gap, y, time, art);
  });
  drawStatusLine(ctx, rect.x, rect.y + BARS.slots * BARS.rowH, marks, time, art);
  ctx.restore();
}

/** the status icons left to right, 10 px apart; text chips for what has no icon (or while the sheet loads) */
export function drawStatusLine(ctx, x0, y, marks, time, art = null) {
  if (!marks.length) return;
  const C = BAR_COLORS;
  let x = x0;
  for (const m of marks) {
    if (m.icon && art?.hasIcon('ui', m.icon)) {
      if (!(m.blink && Math.floor(time * 4) % 2 === 1)) art.drawIcon(ctx, 'ui', m.icon, x, y);
      x += BARS.markStep;
      continue;
    }
    ctx.font = '5px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const w = Math.ceil(ctx.measureText(m.label).width) + 4;
    ctx.fillStyle = m.color;
    ctx.fillRect(x, y, w, 7);
    ctx.fillStyle = C.text;
    ctx.fillText(m.label, x + 2, y + 1);
    x += w + 2;
  }
}

/** top of the fourth row, where the Resonance bar's frame starts */
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
    const art = activeAssets();
    drawBars(ctx, rect, barReadout(sim.player, sim.tuning), statusMarks(sim.player, sim.tuning, sim.inventory), time, art);
    const r = sim.resonance;
    if (r) drawResonanceBar(ctx, rect.x, resonanceRowY(rect), rect.w, r.value, r.tier, sim.tuning.resonance?.tiers, { art, time });
  },
});
