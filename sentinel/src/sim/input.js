// The input for one simulation tick. The presentation (InputManager, bots, replays) fills one of these per tick;
// the simulation only ever sees this object, never a device.
//
// Held values:      moveX, moveY  -1..1 (stick or keys; the length is capped at 1 by the player)
//                   sprint, crouch booleans
// One-tick actions: interact, useItem, toggleLight  true on the tick the action is pressed
//                   hotbar  slot 0..5 selected this tick, or -1
// Aim:              aimX, aimY  a point in world pixels, or null when there is no aim
// Journal and inventory toggles are presentation-only and never reach the simulation.

/**
 * @typedef {Object} InputState
 * @property {number} moveX
 * @property {number} moveY
 * @property {boolean} sprint
 * @property {boolean} crouch
 * @property {boolean} interact
 * @property {boolean} useItem
 * @property {boolean} toggleLight
 * @property {number} hotbar
 * @property {number|null} aimX
 * @property {number|null} aimY
 */

/** the field names, in a fixed order (for recording and replaying input streams) */
export const INPUT_FIELDS = Object.freeze(['moveX', 'moveY', 'sprint', 'crouch', 'interact', 'useItem', 'toggleLight', 'hotbar', 'aimX', 'aimY']);

/** @returns {InputState} an input with nothing pressed */
export function emptyInput() {
  return { moveX: 0, moveY: 0, sprint: false, crouch: false, interact: false, useItem: false, toggleLight: false, hotbar: -1, aimX: null, aimY: null };
}

/**
 * A clean copy of `raw`: missing fields get their defaults, numbers are clamped, NaN becomes 0, so a bad
 * input stream can never put NaN into the world.
 * @param {Partial<InputState>|null|undefined} raw
 * @returns {InputState}
 */
export function sanitizeInput(raw) {
  const r = raw || {};
  const axis = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
  const point = (v) => (Number.isFinite(v) ? v : null);
  const slot = Number.isInteger(r.hotbar) && r.hotbar >= 0 ? r.hotbar : -1;
  const aimX = point(r.aimX);
  const aimY = point(r.aimY);
  return {
    moveX: axis(r.moveX),
    moveY: axis(r.moveY),
    sprint: !!r.sprint,
    crouch: !!r.crouch,
    interact: !!r.interact,
    useItem: !!r.useItem,
    toggleLight: !!r.toggleLight,
    hotbar: slot,
    aimX: aimX === null || aimY === null ? null : aimX,
    aimY: aimX === null || aimY === null ? null : aimY,
  };
}
