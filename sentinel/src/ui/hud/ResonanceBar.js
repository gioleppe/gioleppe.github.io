// The Resonance bar (spec §9 HUD.js "Stamina/Hydration/Resonance bars"): the fourth row of the bars widget
// (Bars.js calls drawResonanceBar with the row's rectangle). Same geometry as the body bars: the 8 x 8
// `icon_resonance`, then the `bar_*` frame with the `fill_resonance_*` fill (ICONS.md); bone ticks on the frame at
// the Humming and Agitated thresholds. Quiet shows the fill dimmed (there, but asleep), Agitated flickers.
// Procedural in the same geometry until the ui sheet loads. Presentation only.

/** row geometry, matching Bars.js (icon 8 px + gap 2, then an 8-high frame with a 4-high trough) */
export const RESONANCE_BAR = Object.freeze({ iconW: 8, gap: 2, h: 8 });

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

/** 5 x 5 fallback icon: a wave */
const ICON = Object.freeze(['.....', '.#...', '#.#.#', '...#.', '.....']);

/** fill width in whole pixels for a value 0..100 inside a bar of inner width `inner` */
export function barFill(value, inner) {
  const v = value < 0 ? 0 : value > 100 ? 100 : value;
  return Math.round((v / 100) * inner);
}

/**
 * The Resonance row: icon, frame, fill in the tier's look, threshold ticks.
 * @param {CanvasRenderingContext2D} ctx #ui, logical pixels
 * @param {number} x left of the row (the icon)
 * @param {number} y top of the row (the bar's frame)
 * @param {number} w whole row width (icon, gap, framed bar)
 * @param {number} value 0..100
 * @param {'quiet'|'humming'|'agitated'} tier
 * @param {{ hummingAt?: number, agitatedAt?: number }} [tiers] where to draw the threshold ticks
 * @param {{ art?: import('../../engine/AssetManager.js').AssetManager|null, time?: number }} [opts]
 */
export function drawResonanceBar(ctx, x, y, w, value, tier, tiers = { hummingAt: 31, agitatedAt: 70 }, { art = null, time = 0 } = {}) {
  const C = RESONANCE_BAR_COLORS;
  const B = RESONANCE_BAR;
  const bx = x + B.iconW + B.gap;
  const bw = w - B.iconW - B.gap;
  const inner = bw - 4;
  const fill = barFill(value, inner);
  const sheet = !!art?.hasIcon('ui', 'fill_resonance_m');
  ctx.save();
  if (sheet) {
    art.drawIcon(ctx, 'ui', 'icon_resonance', x, y);
    art.drawPanel3(ctx, 'ui', 'bar', bx, y, bw);
    if (fill > 0) {
      // asleep when Quiet; a cyan flicker when Agitated
      ctx.globalAlpha = tier === 'quiet' ? 0.55 : 1;
      art.drawPanel3(ctx, 'ui', 'fill_resonance', bx + 2, y + 2, fill);
      ctx.globalAlpha = 1;
      if (tier === 'agitated' && Math.floor(time * 6) % 2 === 0) {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = C.agitated;
        ctx.fillRect(bx + 2, y + 2, fill, 4);
        ctx.globalAlpha = 1;
      }
    }
  } else {
    ctx.fillStyle = tier === 'agitated' ? C.agitated : C.icon;   // violet even when Quiet: the row must read as Resonance
    ICON.forEach((row, dy) => { for (let dx = 0; dx < row.length; dx++) if (row[dx] === '#') ctx.fillRect(x + 1 + dx, y + 1 + dy, 1, 1); });
    ctx.fillStyle = C.ink;
    ctx.fillRect(bx, y, bw, B.h);
    ctx.fillStyle = C.frame;
    ctx.fillRect(bx + 1, y + 1, bw - 2, B.h - 2);
    ctx.fillStyle = C.back;
    ctx.fillRect(bx + 2, y + 2, inner, B.h - 4);
    if (fill > 0) {
      ctx.fillStyle = C[tier] ?? C.quiet;
      ctx.fillRect(bx + 2, y + 2, fill, B.h - 4);
    }
  }
  ctx.fillStyle = C.tick;
  for (const t of [tiers.hummingAt ?? 31, tiers.agitatedAt ?? 70]) {
    const tx = bx + 2 + barFill(t, inner);
    ctx.fillRect(tx, y + 1, 1, 1);
    ctx.fillRect(tx, y + B.h - 2, 1, 1);
  }
  ctx.restore();
}
