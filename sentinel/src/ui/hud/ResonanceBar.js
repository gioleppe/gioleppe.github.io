// The Resonance bar (spec §9 HUD.js "Stamina/Hydration/Resonance bars"): the fourth row of the bars widget
// (Bars.js calls drawResonanceBar with the row's rectangle). Same geometry as the body bars: a 5 x 5 icon, then a
// framed 48 x 5 bar; marks above the frame at the Humming and Agitated thresholds. Presentation only.

/** row geometry, matching Bars.js (icon 5 px + gap 2, frame 1, inner bar, frame 1) */
export const RESONANCE_BAR = Object.freeze({ iconW: 5, gap: 2, h: 7 });

export const RESONANCE_BAR_COLORS = Object.freeze({
  ink: '#0d0b12',
  frame: '#4f4955',         // basalt_2
  back: '#24212c',          // basalt_0
  quiet: '#6c6570',         // basalt_3: there, but asleep
  humming: '#8b5cf6',       // violet, the monolith light
  agitated: '#6ff3ff',      // cyan: violet and cyan are the palette's supernatural colours
  tick: '#e9e2cf',          // bone
  icon: '#8b5cf6',
});

/** 5 x 5 icon: a wave */
const ICON = Object.freeze(['.....', '.#...', '#.#.#', '...#.', '.....']);

/** fill width in whole pixels for a value 0..100 inside a bar of inner width `inner` */
export function barFill(value, inner) {
  const v = value < 0 ? 0 : value > 100 ? 100 : value;
  return Math.round((v / 100) * inner);
}

/**
 * The Resonance row: icon, frame, fill in the tier's colour, threshold marks.
 * @param {CanvasRenderingContext2D} ctx #ui, logical pixels
 * @param {number} x left of the row (the icon)
 * @param {number} y top of the row (the bar's frame)
 * @param {number} w whole row width (icon, gap, framed bar)
 * @param {number} value 0..100
 * @param {'quiet'|'humming'|'agitated'} tier
 * @param {{ hummingAt?: number, agitatedAt?: number }} [tiers] where to draw the threshold marks
 */
export function drawResonanceBar(ctx, x, y, w, value, tier, tiers = { hummingAt: 31, agitatedAt: 70 }) {
  const C = RESONANCE_BAR_COLORS;
  const B = RESONANCE_BAR;
  ctx.save();
  ctx.fillStyle = tier === 'agitated' ? C.agitated : C.icon;   // violet even when Quiet: the row must read as Resonance
  ICON.forEach((row, dy) => { for (let dx = 0; dx < row.length; dx++) if (row[dx] === '#') ctx.fillRect(x + dx, y + 1 + dy, 1, 1); });
  const bx = x + B.iconW + B.gap;
  const bw = w - B.iconW - B.gap;
  ctx.fillStyle = C.frame;
  ctx.fillRect(bx, y, bw, B.h);
  ctx.fillStyle = C.back;
  ctx.fillRect(bx + 1, y + 1, bw - 2, B.h - 2);
  const inner = bw - 2;
  const fill = barFill(value, inner);
  if (fill > 0) {
    ctx.fillStyle = C[tier] ?? C.quiet;
    ctx.fillRect(bx + 1, y + 1, fill, B.h - 2);
  }
  ctx.fillStyle = C.tick;
  for (const t of [tiers.hummingAt ?? 31, tiers.agitatedAt ?? 70]) ctx.fillRect(bx + 1 + barFill(t, inner), y, 1, 1);
  ctx.restore();
}
