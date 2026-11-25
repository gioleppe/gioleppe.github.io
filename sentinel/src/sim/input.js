// The input for one simulation tick. The presentation (InputManager, bots, replays) fills one of these per tick;
// the simulation only ever sees this object, never a device.
//
// Held values:      moveX, moveY  -1..1 (stick or keys; the length is capped at 1 by the player)
//                   sprint, crouch booleans
// One-tick actions: interact, useItem, toggleLight, drop  true on the tick the action is pressed
//                   (drop: put the stack in hand on the ground; G on desktop, long-press a hotbar slot on touch)
//                   hotbar  slot 0..5 selected this tick, or -1
// Aim:              aimX, aimY  a point in world pixels, or null when there is no aim
// Journal commands: journal  null, or a space-separated list of `read:<entry id>` (entries opened in the Journal)
//                   and `craft:<recipe id>` (Make on the Recipes tab), carried on one tick (Lore.js, Crafting.js)
// Journal and inventory toggles are presentation-only and never reach the simulation; what is done inside the
// Journal that changes the game (read marks, crafting) does, through `journal`.

/**
 * @typedef {Object} InputState
 * @property {number} moveX
 * @property {number} moveY
 * @property {boolean} sprint
 * @property {boolean} crouch
 * @property {boolean} interact
 * @property {boolean} useItem
 * @property {boolean} toggleLight
 * @property {boolean} drop
 * @property {number} hotbar
 * @property {number|null} aimX
 * @property {number|null} aimY
 * @property {string|null} journal
 */

/** the field names, in a fixed order (for recording and replaying input streams) */
export const INPUT_FIELDS = Object.freeze(['moveX', 'moveY', 'sprint', 'crouch', 'interact', 'useItem', 'toggleLight', 'hotbar', 'aimX', 'aimY', 'drop', 'journal']);

/** one Journal command */
export const JOURNAL_COMMAND = /^(read|craft):[a-z][a-z0-9_]*$/;
/** longest `journal` string kept (a Journal session's read marks fit many times over) */
export const JOURNAL_MAX_CHARS = 2048;

/** @returns {InputState} an input with nothing pressed */
export function emptyInput() {
  return { moveX: 0, moveY: 0, sprint: false, crouch: false, interact: false, useItem: false, toggleLight: false, hotbar: -1, aimX: null, aimY: null, drop: false, journal: null };
}

/**
 * The valid commands of a `journal` value, space-separated, or null when there are none.
 * @param {*} v
 * @returns {string|null}
 */
export function cleanJournal(v) {
  if (typeof v !== 'string' || !v || v.length > JOURNAL_MAX_CHARS) return null;
  const toks = v.split(' ').filter((t) => JOURNAL_COMMAND.test(t));
  return toks.length ? toks.join(' ') : null;
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
    drop: !!r.drop,
    journal: cleanJournal(r.journal),
  };
}
