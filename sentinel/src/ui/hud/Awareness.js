// HUD widget: the awareness eye (step 4.3). A small eye towards the screen edge, on the side of the scout that is most
// aware of the player, opening as that scout's awareness rises (sim.scouts.maxAwareness): shut and dim while
// nobody has noticed, half open while a scout wonders (INVESTIGATE), wide and red once the player is seen. Drawn
// procedurally (the ui sheet has no eye art) on the same dark plate as the tide widget (uiArt.drawDarkPanel), with
// the palette and the 1 px ink outline of the other widgets, on whole pixels; it only reads the simulation.
import { drawDarkPanel, UI_ART_COLORS } from './uiArt.js';

/** palette colours (assets/src/palette.gpl names) */
export const EYE_COLORS = Object.freeze({
  ink: UI_ART_COLORS.ink,
  lid: UI_ART_COLORS.bone,
  white: '#cfeedd',     // foam
  calm: '#66c2b0',      // teal_3
  wary: UI_ART_COLORS.amber,
  alarm: UI_ART_COLORS.rust,
});

/**
 * layout in logical pixels: the eye sits on an ellipse round the screen centre (where the player is) with half-axes
 * of the screen less side / vertical, at most maxRx / maxRy: towards the edge, but clear of the bars and the
 * compass (top), the hotbar (bottom) and the thumb buttons (bottom corners)
 */
export const EYE = Object.freeze({ w: 15, h: 9, side: 30, vertical: 42, maxRx: 90, maxRy: 80, minShow: 0.04 });

/**
 * Where the eye goes for a direction (a unit vector from the player towards the scout), in the safe area's
 * logical pixels (W x H), and the box it covers.
 * @returns {{ x: number, y: number, rect: { x: number, y: number, w: number, h: number } }}
 */
export function eyePosition(W, H, ux, uy) {
  const rx = Math.min(W / 2 - EYE.side, EYE.maxRx);
  const ry = Math.min(H / 2 - EYE.vertical, EYE.maxRy);
  const x = Math.round(W / 2 + ux * rx);
  const y = Math.round(H / 2 + uy * ry);
  // the plate round the almond: EYE.w + 4 by EYE.h + 4, centred on the eye
  return { x, y, rect: { x: x - (EYE.w + 3) / 2, y: y - (EYE.h + 3) / 2, w: EYE.w + 4, h: EYE.h + 4 } };
}

/**
 * What the eye shows, as plain values (tested without a canvas), or null when it is hidden.
 * @param {import('../../sim/Sim.js').Sim} sim
 * @param {number} W logical width of the UI
 * @param {number} H logical height
 * @returns {{ x: number, y: number, open: number, color: string, level: string }|null}
 */
export function eyeState(sim, W, H) {
  const scouts = sim?.scouts;
  if (!scouts || sim.over) return null;
  const level = sim.threat?.level ?? 'none';
  const a = scouts.maxAwareness;
  if (a < EYE.minShow && level === 'none') return null;
  const id = level !== 'none' ? sim.threat.nearestId : scouts.watcherId;
  const s = id ? scouts.byId(id) : null;
  if (!s) return null;
  const p = sim.player;
  let ux = s.x - p.x;
  let uy = s.y - p.y;
  const d = Math.sqrt(ux * ux + uy * uy) || 1;
  ux /= d;
  uy /= d;
  const open = level === 'chase' || level === 'warn' ? 1 : Math.max(a, level === 'none' ? 0 : 0.5);
  const color = level === 'chase' || level === 'warn' || a >= 1 ? EYE_COLORS.alarm : level === 'none' && a < 0.35 ? EYE_COLORS.calm : EYE_COLORS.wary;
  const at = eyePosition(W, H, ux, uy);
  return { x: at.x, y: at.y, open, color, level };
}

/** the HUD widget (see HUD.js) */
export const awarenessWidget = Object.freeze({
  id: 'awareness',
  draw(ctx, sim, { vp, safe, time = 0 }) {
    const W = vp.uiLogicalWidth;
    const H = vp.uiLogicalHeight;
    const e = eyeState(sim, W - (safe?.left || 0) - (safe?.right || 0), H - (safe?.top || 0) - (safe?.bottom || 0));
    if (!e) return;
    const x = e.x + (safe?.left || 0);
    const y = e.y + (safe?.top || 0);
    const hw = (EYE.w - 1) / 2;
    const lid = Math.max(0, Math.round(((EYE.h - 3) / 2) * e.open));
    ctx.save();
    const plate = eyePosition(W, H, 0, 0).rect;
    drawDarkPanel(ctx, x - (plate.w - 1) / 2, y - (plate.h - 1) / 2, plate.w, plate.h);
    // a pulse when the eye is wide open
    if (e.open >= 1) ctx.globalAlpha = 0.75 + 0.25 * Math.sin(time * 8);
    // the almond: one row per y, narrower towards the lids
    for (let dy = -lid - 1; dy <= lid + 1; dy++) {
      const k = lid + 1 > 0 ? Math.abs(dy) / (lid + 1) : 1;
      const half = Math.round(hw * Math.sqrt(1 - k * k));
      const edge = Math.abs(dy) === lid + 1;
      ctx.fillStyle = EYE_COLORS.ink;
      ctx.fillRect(x - half - 1, y + dy, half * 2 + 3, 1);
      ctx.fillStyle = edge ? EYE_COLORS.lid : EYE_COLORS.white;
      ctx.fillRect(x - half, y + dy, half * 2 + 1, 1);
    }
    if (lid > 0) {
      const r = Math.min(lid, 2);
      ctx.fillStyle = e.color;
      ctx.fillRect(x - r, y - r, r * 2 + 1, r * 2 + 1);
      ctx.fillStyle = EYE_COLORS.ink;
      ctx.fillRect(x, y, 1, 1);
    } else {
      // shut: a single lid line in the calm colour
      ctx.fillStyle = e.color;
      ctx.fillRect(x - hw, y, EYE.w, 1);
    }
    ctx.restore();
  },
});
