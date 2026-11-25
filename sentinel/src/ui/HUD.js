// The HUD on #ui, in logical pixels (spec §9 ui/HUD.js). For now one widget: the tide indicator (height gauge,
// rising/falling arrow, time to the next low or high water) with a small sun/moon dial of the time of day.
// Step 3.3 adds the bars and the hotbar here. Reads the simulation, never writes it.
//
// Placement: top centre, below the safe-area inset, clear of the debug tab (top left) and the touch controls'
// top-right bar.

/** palette colours used here (assets/src/palette.gpl names) */
export const HUD_COLORS = Object.freeze({
  ink: '#0d0b12',
  frame: '#4f4955',      // basalt_2
  gaugeBack: '#1a284e',  // deep_1
  water: '#28767e',      // teal_1
  waterTop: '#66c2b0',   // teal_3
  text: '#e9e2cf',       // bone
  dim: '#8f8789',        // basalt_4
  sun: '#f2a33a',        // amber
  moon: '#e9e2cf',       // bone
  ground: '#1d3824',     // jungle_1
  sky: { night: '#101834', dawn: '#a8522b', day: '#379a95', dusk: '#6b2c1e' },   // deep_0, rust_1, teal_2, rust_0
});

/** widget size in logical pixels */
export const TIDE_WIDGET = Object.freeze({ w: 94, h: 22, top: 3 });
const DIAL_R = 8;

/** m:ss for a number of seconds (rounded up, so it never shows 0:00 before the moment) */
export function clockText(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * What the tide widget shows, as plain values (tested without a canvas).
 * @param {import('../world/WorldState.js').WorldState} world
 */
export function tideReadout(world) {
  const rising = world.tideRising;
  const next = rising ? 'high' : 'low';
  return {
    height: world.tideHeight,
    percent: Math.round(world.tideHeight * 100),
    rising,
    next,
    line1: `TIDE ${String(Math.round(world.tideHeight * 100)).padStart(3)}%`,
    line2: `${next} in ${clockText(world.timeToNext(next))}`,
  };
}

/**
 * Where the widget goes: top centre of the safe area.
 * @param {{ uiLogicalWidth: number }} vp
 * @param {{ top: number, left: number, right: number }} safe
 */
export function tideWidgetRect(vp, safe) {
  const left = safe.left || 0;
  const right = vp.uiLogicalWidth - (safe.right || 0);
  return { x: Math.round((left + right - TIDE_WIDGET.w) / 2), y: Math.round((safe.top || 0) + TIDE_WIDGET.top), w: TIDE_WIDGET.w, h: TIDE_WIDGET.h };
}

/** a filled disc of whole pixels */
function disc(ctx, cx, cy, r, color, lowerOnly = false) {
  ctx.fillStyle = color;
  for (let dy = lowerOnly ? 1 : -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy + r * 0.8));
    ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
  }
}

/**
 * Draw the HUD.
 * @param {CanvasRenderingContext2D} ctx #ui context, scaled to logical pixels
 * @param {import('../sim/Sim.js').Sim} sim
 * @param {{ uiLogicalWidth: number, uiLogicalHeight: number }} vp
 * @param {{ top: number, right: number, bottom: number, left: number }} safe
 */
export function drawHud(ctx, sim, vp, safe) {
  if (sim?.world) drawTideWidget(ctx, sim.world, tideWidgetRect(vp, safe));
}

/** the tide indicator and the time-of-day dial in `rect` */
export function drawTideWidget(ctx, world, rect) {
  const C = HUD_COLORS;
  const { x, y, w, h } = rect;
  const t = tideReadout(world);
  ctx.save();
  ctx.globalAlpha = 0.78;
  ctx.fillStyle = C.ink;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.frame;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);

  // gauge: water rising in a little column
  const gx = x + 4;
  const gy = y + 3;
  const gh = h - 6;
  ctx.fillStyle = C.frame;
  ctx.fillRect(gx - 1, gy - 1, 8, gh + 2);
  ctx.fillStyle = C.gaugeBack;
  ctx.fillRect(gx, gy, 6, gh);
  const fill = Math.round(t.height * gh);
  if (fill > 0) {
    ctx.fillStyle = C.water;
    ctx.fillRect(gx, gy + gh - fill, 6, fill);
    ctx.fillStyle = C.waterTop;
    ctx.fillRect(gx, gy + gh - fill, 6, 1);
  }

  // arrow: up while rising, down while falling
  const ax = x + 14;
  const ay = y + 8;
  ctx.fillStyle = C.waterTop;
  for (let i = 0; i < 4; i++) {
    const row = t.rising ? i : 3 - i;
    ctx.fillRect(ax + 3 - i, ay + row, i * 2 + 1, 1);
  }
  ctx.fillRect(ax + 2, t.rising ? ay + 4 : ay - 2, 3, 2);

  // text
  ctx.font = '6px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = C.text;
  ctx.fillText(t.line1, x + 23, y + 3);
  ctx.fillStyle = C.dim;
  ctx.fillText(t.line2, x + 23, y + 12);

  // time-of-day dial: sky above the horizon, ground below, sun and moon opposite each other
  const cx = x + w - DIAL_R - 3;
  const cy = y + Math.floor(h / 2);
  disc(ctx, cx, cy, DIAL_R + 1, C.frame);
  disc(ctx, cx, cy, DIAL_R, C.sky[world.dayPhase] ?? C.sky.day);
  disc(ctx, cx, cy, DIAL_R, C.ground, true);
  const a = (world.timeOfDay / 24) * Math.PI * 2;   // presentation only: noon at the top, midnight at the bottom
  const rr = DIAL_R - 3;
  const sx = cx - Math.round(Math.sin(a) * rr);
  const sy = cy + Math.round(Math.cos(a) * rr);
  ctx.fillStyle = C.moon;
  ctx.fillRect(2 * cx - sx - 1, 2 * cy - sy - 1, 2, 2);
  ctx.fillStyle = C.sun;
  ctx.fillRect(sx - 1, sy - 1, 3, 3);
  ctx.restore();
}
