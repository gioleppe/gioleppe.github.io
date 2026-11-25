// Emote bubbles above heads (spec §7.3: the Sentinelese never speak; ICONS.md "emotes"). One call draws one bubble
// on the #world canvas: the 3-frame pop-in (`pop_neutral_*` / `pop_alert_*`, 60 ms a frame, the glyph from frame 2
// on) when it has just appeared, then the pre-composed emote. Draw bubbles after the lighting pass
// (Renderer.afterLighting) so they read at night. Presentation only; nothing here touches the simulation.
//
//   import { drawEmote } from './Emotes.js';
//   drawEmote(ctx, 'exclaim', headX, headTopY - 1, { popStartMs, timeMs });   // screen px, whole pixels
import { activeAssets } from './AssetManager.js';

/** every emote, with its recommended plate (ICONS.md table): true = alert (amber rim) */
export const EMOTES = Object.freeze({
  exclaim: true, question: false, arrow_warn: true, palm_up: false, eye: false, fish: false, skull: true,
  resonance_wave: false, spear: true, whistle: true, search: false, ellipsis: false,
});
/** ms per pop-in frame; three frames */
export const EMOTE_POP_MS = 60;
/** the bubble frame is 16 x 16; its anchor is the tail's bottom-centre (8, 16) */
export const EMOTE_SIZE = 16;

/**
 * Which pictures make up a bubble `elapsedMs` after it appeared: the pop frame (or null once popped), whether the
 * glyph shows, and the composed name to use after the pop.
 * @param {string} name an EMOTES key
 * @param {boolean} alert
 * @param {number} elapsedMs
 * @returns {{ pop: string|null, glyph: boolean }}
 */
export function emoteFrames(name, alert, elapsedMs) {
  const plate = alert ? 'alert' : 'neutral';
  if (elapsedMs >= 0 && elapsedMs < EMOTE_POP_MS * 3) {
    const k = Math.floor(elapsedMs / EMOTE_POP_MS);
    return { pop: `pop_${plate}_${k}`, glyph: k >= 2 };
  }
  return { pop: null, glyph: true };
}

/**
 * Draw an emote bubble whose tail tip (the frame's bottom-centre) is at screen (x, y): put y a pixel or two above
 * the top of the head.
 * @param {CanvasRenderingContext2D} ctx #world context (after the lighting pass)
 * @param {string} name 'exclaim' | 'question' | 'arrow_warn' | 'palm_up' | 'eye' | 'fish' | 'skull' |
 *   'resonance_wave' | 'spear' | 'whistle' | 'search' | 'ellipsis'
 * @param {number} x
 * @param {number} y
 * @param {{ alert?: boolean, popStartMs?: number|null, timeMs?: number, assets?: Object|null }} [opts]
 *   alert: amber-rimmed plate (default: the emote's recommended plate); popStartMs and timeMs on one clock (ms):
 *   the bubble pops in over the first 180 ms after popStartMs (omit popStartMs for no pop)
 */
export function drawEmote(ctx, name, x, y, { alert = EMOTES[name] ?? false, popStartMs = null, timeMs = 0, assets = activeAssets() } = {}) {
  const left = Math.round(x) - EMOTE_SIZE / 2;
  const top = Math.round(y) - EMOTE_SIZE;
  const f = emoteFrames(name, alert, popStartMs === null ? Infinity : timeMs - popStartMs);
  if (!assets) return;
  if (f.pop) {
    assets.drawIcon(ctx, 'emotes', f.pop, left, top);
    if (f.glyph) assets.drawIcon(ctx, 'emotes', `glyph_${name}`, left, top);
    return;
  }
  // the pre-composed picture when its plate is the recommended one; otherwise compose bubble + glyph
  if (alert === (EMOTES[name] ?? false) && assets.hasIcon?.('emotes', name)) assets.drawIcon(ctx, 'emotes', name, left, top);
  else {
    assets.drawIcon(ctx, 'emotes', alert ? 'bubble_alert' : 'bubble_neutral', left, top);
    assets.drawIcon(ctx, 'emotes', `glyph_${name}`, left, top);
  }
}
