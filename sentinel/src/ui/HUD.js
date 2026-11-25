// The HUD on #ui, in logical pixels (spec §9 ui/HUD.js): a list of widgets, each one import and one line below.
// A widget is `{ id, draw(ctx, sim, layout) }` with layout `{ vp, safe, time, reserve }`; it places itself and
// only reads the simulation.
//
// Placement: tide top centre; bars top-left (moved right/down by `reserve`, which debug mode uses for its tab);
// hotbar bottom centre (raised above the touch controls when they show), notices above it; the touch controls
// own the top-right bar and the bottom corners.
import { tideWidget } from './hud/TideWidget.js';
import { barsWidget } from './hud/Bars.js';
import { hotbarWidget, noticesWidget } from './hud/Hotbar.js';
import { deathNotice } from './hud/DeathNotice.js';

export { HUD_COLORS, TIDE_WIDGET, clockText, tideReadout, tideWidgetRect, drawTideWidget } from './hud/TideWidget.js';

/** in draw order */
export const WIDGETS = [
  tideWidget,
  barsWidget,
  hotbarWidget,
  noticesWidget,
  // compass (step 3.6) goes here
  deathNotice,   // last: it covers the rest
];

/**
 * Draw the HUD.
 * @param {CanvasRenderingContext2D} ctx #ui context, scaled to logical pixels
 * @param {import('../sim/Sim.js').Sim} sim
 * @param {{ uiLogicalWidth: number, uiLogicalHeight: number }} vp
 * @param {{ top: number, right: number, bottom: number, left: number }} safe
 * @param {{ time?: number, reserve?: { left?: number, top?: number } }} [opts] time: presentation seconds (pulses)
 */
export function drawHud(ctx, sim, vp, safe, { time = 0, reserve = {} } = {}) {
  const layout = { vp, safe, time, reserve };
  for (const w of WIDGETS) w.draw(ctx, sim, layout);
}
