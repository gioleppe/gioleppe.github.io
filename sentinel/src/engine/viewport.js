// Resolution maths for the two canvases, kept free of the DOM so it can be unit-tested.
//
// #world is drawn at a logical resolution (height 270, width from the aspect ratio) and scaled up by CSS,
// so pixel art stays crisp. #ui covers the same box at device resolution; its context is scaled by
// `uiScale` so UI code also draws in logical pixels while text stays sharp.

export const LOGICAL_HEIGHT = 270;

/**
 * @typedef {Object} Viewport
 * @property {number} cssWidth        size of the game box in CSS pixels
 * @property {number} cssHeight
 * @property {number} dpr             devicePixelRatio used
 * @property {number} logicalWidth    #world canvas width (integer, >= 1)
 * @property {number} logicalHeight   #world canvas height (integer)
 * @property {number} scale           CSS pixels per logical pixel (the CSS scale of #world)
 * @property {number} worldCssWidth   CSS width of #world: logicalWidth * scale, at most one logical pixel wider than the box (cropped on the right)
 * @property {number} worldCssHeight  CSS height of #world (= cssHeight)
 * @property {number} uiWidth         #ui canvas width in device pixels
 * @property {number} uiHeight        #ui canvas height in device pixels
 * @property {number} uiScale         device pixels per logical pixel: the transform set on the #ui context
 * @property {number} uiLogicalWidth  width of the #ui box in logical pixels (may be fractional, <= logicalWidth)
 * @property {number} uiLogicalHeight height of the #ui box in logical pixels (= logicalHeight)
 */

/**
 * Compute both canvases' sizes for a game box of the given CSS size.
 * Degenerate input (0, negative, NaN) is treated as 1 so a hidden or collapsing window never yields a 0-sized canvas.
 * @param {number} cssWidth
 * @param {number} cssHeight
 * @param {number} [dpr=1]
 * @param {number} [logicalHeight=LOGICAL_HEIGHT]
 * @returns {Viewport}
 */
export function computeViewport(cssWidth, cssHeight, dpr = 1, logicalHeight = LOGICAL_HEIGHT) {
  const w = positive(cssWidth);
  const h = positive(cssHeight);
  const d = positive(dpr);
  const logicalWidth = Math.max(1, Math.ceil(logicalHeight * (w / h) - 1e-9));   // epsilon: 16:9 must give exactly 480, not 481
  const scale = h / logicalHeight;
  return {
    cssWidth: w,
    cssHeight: h,
    dpr: d,
    logicalWidth,
    logicalHeight,
    scale,
    worldCssWidth: logicalWidth * scale,
    worldCssHeight: h,
    uiWidth: Math.max(1, Math.round(w * d)),
    uiHeight: Math.max(1, Math.round(h * d)),
    uiScale: scale * d,
    uiLogicalWidth: w / scale,
    uiLogicalHeight: logicalHeight,
  };
}

/**
 * Convert safe-area insets from CSS pixels to logical pixels (for placing HUD elements clear of notches).
 * @param {{top:number,right:number,bottom:number,left:number}} insets CSS pixels
 * @param {number} scale CSS pixels per logical pixel
 */
export function insetsToLogical(insets, scale) {
  const s = positive(scale);
  const f = (v) => (Number.isFinite(v) && v > 0 ? v / s : 0);
  return { top: f(insets.top), right: f(insets.right), bottom: f(insets.bottom), left: f(insets.left) };
}

/**
 * Convert a point in CSS pixels relative to the game box into logical pixels (world screen space).
 * @param {number} cssX
 * @param {number} cssY
 * @param {Viewport} vp
 */
export function cssToLogical(cssX, cssY, vp) {
  return { x: cssX / vp.scale, y: cssY / vp.scale };
}

function positive(v) {
  return Number.isFinite(v) && v > 0 ? v : 1;
}
