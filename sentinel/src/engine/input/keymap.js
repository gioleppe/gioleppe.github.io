// Desktop key map (spec §3.2). Keys are matched by `KeyboardEvent.code`, the physical position, so WASD stays
// under the left hand on every layout.
//
// Deliberate deviation from the spec: Ctrl is not a crouch key. Ctrl+W closes the tab, Ctrl+D bookmarks, and a
// page cannot block either, so holding Ctrl while walking would end the game. Crouch is `C` (a toggle).

/** what a key does: a held direction or sprint, the crouch toggle, a one-tick sim action, a hotbar slot, or a UI action */
export const KEY_BINDINGS = Object.freeze({
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyC: 'crouch',
  KeyE: 'interact',
  KeyQ: 'useItem',
  KeyF: 'toggleLight',
  Digit1: 'hotbar0', Digit2: 'hotbar1', Digit3: 'hotbar2', Digit4: 'hotbar3', Digit5: 'hotbar4', Digit6: 'hotbar5',
  Numpad1: 'hotbar0', Numpad2: 'hotbar1', Numpad3: 'hotbar2', Numpad4: 'hotbar3', Numpad5: 'hotbar4', Numpad6: 'hotbar5',
  Tab: 'openJournal', KeyJ: 'openJournal',
  KeyI: 'openInventory',
  Escape: 'pause', KeyP: 'pause',
});

/** actions that last while their key is down */
export const HELD_ACTIONS = Object.freeze(['up', 'down', 'left', 'right', 'sprint']);

/** one-tick actions that reach the simulation (besides the hotbar) */
export const SIM_ACTIONS = Object.freeze(['interact', 'useItem', 'toggleLight']);

/** presentation-only one-shot actions: they never reach the simulation */
export const UI_ACTIONS = Object.freeze(['openJournal', 'openInventory', 'pause']);

/** number of hotbar slots (spec §6.4) */
export const HOTBAR_SLOTS = 6;

/**
 * Codes whose browser default is suppressed: every bound key (Tab would move focus, arrows scroll) plus Space,
 * which scrolls and which the game reserves. Never applied while Ctrl, Alt or Meta is down.
 */
export const PREVENT_DEFAULT_CODES = Object.freeze(new Set([...Object.keys(KEY_BINDINGS), 'Space']));

/** hotbar slot for an action name like 'hotbar2', or -1 */
export function hotbarSlot(action) {
  const m = /^hotbar(\d)$/.exec(action ?? '');
  return m ? Number(m[1]) : -1;
}
