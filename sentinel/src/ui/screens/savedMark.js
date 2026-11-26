// HUD widget: a small unobtrusive "saved" mark under the tide widget for a couple of seconds after a save
// (step 5.2), or a short warning when a save could not be stored. The page calls `flashSaved(time, ...)`.
import { tideWidgetRect } from '../hud/TideWidget.js';
import { SCREEN_COLORS as C, font } from './theme.js';

const state = { at: -Infinity, text: '', ok: true, seconds: 2.5 };

/**
 * Show the mark.
 * @param {number} time presentation seconds (the HUD's layout.time)
 * @param {{ ok?: boolean, text?: string, seconds?: number }} [o]
 */
export function flashSaved(time, { ok = true, text = ok ? 'saved' : 'not saved', seconds = ok ? 2.5 : 4 } = {}) {
  state.at = time;
  state.ok = ok;
  state.text = text;
  state.seconds = seconds;
}

/** what the mark shows at `time` (tests): null when hidden */
export function savedMarkState(time) {
  const age = time - state.at;
  if (!(age >= 0) || age > state.seconds) return null;
  return { text: state.text, ok: state.ok, alpha: Math.min(1, age / 0.25, (state.seconds - age) / 0.8) };
}

export const savedMarkWidget = Object.freeze({
  id: 'saved',
  draw(ctx, sim, { vp, safe, time }) {
    const s = savedMarkState(time);
    if (!s || !(s.alpha > 0)) return;
    const tide = tideWidgetRect(vp, safe);
    ctx.save();
    ctx.globalAlpha = s.alpha;
    ctx.font = font(7);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const x = tide.x - 6;
    const y = tide.y + 6;
    ctx.fillStyle = 'rgba(13, 11, 18, 0.55)';
    const w = Math.ceil(ctx.measureText(s.text).width) + 14;
    ctx.fillRect(x - w + 2, y - 5, w, 10);
    ctx.fillStyle = s.ok ? C.teal : C.amber;
    // a small tick (or a dot when it failed)
    if (s.ok) { ctx.fillRect(x - w + 5, y, 1, 2); ctx.fillRect(x - w + 6, y + 1, 1, 2); ctx.fillRect(x - w + 7, y - 1, 1, 2); ctx.fillRect(x - w + 8, y - 2, 1, 2); }
    else ctx.fillRect(x - w + 5, y - 1, 3, 3);
    ctx.fillStyle = s.ok ? C.bone : C.amber;
    ctx.fillText(s.text, x, y + 0.5);
    ctx.restore();
  },
});
