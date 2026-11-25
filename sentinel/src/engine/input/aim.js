// Aim points for the simulation, which wants them in world pixels.

/**
 * A screen point (logical pixels of #world / #ui) in world pixels, or null without a camera.
 * @param {{ screenToWorld(x:number,y:number): {x:number,y:number} }|null} camera
 * @param {number} sx
 * @param {number} sy
 * @returns {{x:number,y:number}|null}
 */
export function screenToWorldAim(camera, sx, sy) {
  if (!camera || !Number.isFinite(sx) || !Number.isFinite(sy)) return null;
  return camera.screenToWorld(sx, sy);
}

/**
 * The aim point of a touch drag-to-throw: `distance` world pixels from the player in the drag direction.
 * Screen and world axes point the same way (one world pixel is one logical pixel), so the drag vector is
 * used as it is.
 * @param {{x:number,y:number}|null} player world position
 * @param {number} dx drag vector, any length
 * @param {number} dy
 * @param {number} distance world pixels
 * @returns {{x:number,y:number}|null} null without a player or a direction
 */
export function throwAimPoint(player, dx, dy, distance) {
  const d = Math.sqrt(dx * dx + dy * dy);
  if (!player || !(d > 0)) return null;
  return { x: player.x + (dx / d) * distance, y: player.y + (dy / d) * distance };
}
