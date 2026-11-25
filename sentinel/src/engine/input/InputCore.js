// Everything the InputManager decides, without the DOM: it is fed plain key and pointer records (so tests drive
// it with fake events) and hands out one simulation input per tick plus the presentation-only UI actions.
//
// One-tick actions are queued when pressed and taken by the next simulation tick, one of each kind per tick, so
// every press reaches the simulation exactly once whether a frame runs zero, one or several ticks. Held values
// (movement, sprint) and the crouch toggle are read fresh every tick.
import { emptyInput } from '../../sim/input.js';
import { KEY_BINDINGS, HELD_ACTIONS, SIM_ACTIONS, UI_ACTIONS, PREVENT_DEFAULT_CODES, HOTBAR_SLOTS, hotbarSlot } from './keymap.js';
import { startJoystick, moveJoystick, joystickVector } from './joystick.js';
import { layoutTouchControls, hitTestTouch, inRect } from './touchLayout.js';
import { screenToWorldAim, throwAimPoint } from './aim.js';

/** icons the game can put on the context action button (`setContext`); null shows it idle */
export const CONTEXT_ICONS = Object.freeze(['hand', 'eye', 'speech', 'offering']);

const DIRECTION_CODES = {};
for (const [code, action] of Object.entries(KEY_BINDINGS)) if (HELD_ACTIONS.includes(action)) (DIRECTION_CODES[action] ??= []).push(code);

/** touch button -> the action it fires on press ('use' fires on release, see pointerUp) */
const BUTTON_ACTIONS = { context: 'interact', crouch: 'crouch', light: 'toggleLight', journal: 'openJournal', inventory: 'openInventory' };

const noUi = () => Object.fromEntries(UI_ACTIONS.map((a) => [a, false]));

/**
 * @typedef {Object} PointerRecord
 * @property {number} id
 * @property {string} type    'mouse' | 'touch' | 'pen'
 * @property {number} [button] 0 left, 2 right (mouse)
 * @property {number} x       logical pixels
 * @property {number} y
 * @property {number} [t]     event time in ms (any clock), for long presses on hit regions
 */

export class InputCore {
  /**
   * @param {Object} cfg tuning.input
   */
  constructor(cfg) {
    if (!cfg) throw new Error('InputCore: tuning.input is required');
    this.cfg = cfg;
    /** codes of held keys */
    this.heldCodes = new Set();
    /** crouch toggle (keyboard C, touch button); sent as a held value every tick */
    this.crouch = false;
    /** @type {Array<{ action: string, slot?: number, aim?: { screen?: {x:number,y:number}, throw?: {dx:number,dy:number} } | null }>} */
    this.queue = [];
    this.ui = noUi();
    /** last mouse position in logical pixels, or null when the mouse is off the game */
    this.mouse = null;
    /** touch controls are drawn and active only after a touch is seen, and hidden again by a key or the mouse */
    this.touchVisible = false;
    /** @type {string|null} one of CONTEXT_ICONS */
    this.context = null;
    this.view = { width: 1, height: 1, scale: 1 };
    this.safe = { top: 0, right: 0, bottom: 0, left: 0 };
    /** @type {import('./touchLayout.js').TouchLayout} */
    this.layout = layoutTouchControls(this.view, this.safe, cfg);
    /** @type {Map<number, { control: string }>} which control each pointer owns */
    this.pointers = new Map();
    /** @type {import('./joystick.js').Joystick|null} */
    this.joystick = null;
    /** @type {{ startX:number, startY:number, x:number, y:number, aiming:boolean }|null} use button press */
    this.useDrag = null;
    /** @type {Map<string, { rect: () => ({x:number,y:number,w:number,h:number}|null), onTap: () => void, onLongPress?: () => void, longPressMs?: number }>} */
    this.regions = new Map();
  }

  // ---- configuration ------------------------------------------------------------------------------------

  /**
   * Lay the touch controls out for a #ui size.
   * @param {{ width: number, height: number, scale: number }} view logical pixels, CSS px per logical px
   * @param {{top:number,right:number,bottom:number,left:number}} safe insets in logical pixels
   */
  setView(view, safe) {
    this.view = { ...view };
    this.safe = { ...this.safe, ...safe };
    this.layout = layoutTouchControls(this.view, this.safe, this.cfg);
  }

  /** set the context button's icon: one of CONTEXT_ICONS, or null for nothing in reach */
  setContext(icon) {
    this.context = CONTEXT_ICONS.includes(icon) ? icon : null;
  }

  /** force the crouch toggle (e.g. the game stands the player up to swim) */
  setCrouch(on) {
    this.crouch = !!on;
  }

  /**
   * Make a rectangle tappable (touch) and clickable (left mouse button), on top of every other control.
   * Later regions are on top of earlier ones. Replaces a region with the same id.
   * @param {string} id
   * @param {() => ({x:number,y:number,w:number,h:number}|null)} rectProvider current rectangle in logical pixels, or null when hidden
   * @param {() => void} onTap called when a press both starts and ends inside it
   * @param {{ onLongPress?: () => void, longPressMs?: number }} [opts] a press held at least `longPressMs` (judged on
   *   release, from the pointer event times) calls onLongPress instead of onTap
   * @returns {() => void} removes the region
   */
  addHitRegion(id, rectProvider, onTap, { onLongPress, longPressMs = 450 } = {}) {
    this.regions.delete(id);
    this.regions.set(id, { rect: rectProvider, onTap, onLongPress, longPressMs });
    return () => { if (this.regions.get(id)?.onTap === onTap) this.regions.delete(id); };
  }

  /** id of the topmost hit region under (x, y), or null */
  regionAt(x, y) {
    const ids = [...this.regions.keys()].reverse();
    for (const id of ids) if (inRect(this.regions.get(id).rect(), x, y)) return id;
    return null;
  }

  // ---- actions --------------------------------------------------------------------------------------------

  /**
   * Fire an action as if its key were pressed: a one-tick sim action ('interact', 'useItem', 'toggleLight',
   * 'hotbar0'..'hotbar5'), 'crouch' (toggles) or a UI action ('openJournal', 'openInventory', 'pause').
   * @param {string} action
   * @param {{ screen?: {x:number,y:number}, throw?: {dx:number,dy:number} }|null} [aim]
   */
  trigger(action, aim = null) {
    if (action === 'crouch') { this.crouch = !this.crouch; return; }
    if (UI_ACTIONS.includes(action)) { this.ui[action] = true; return; }
    const slot = hotbarSlot(action);
    if (slot >= 0 && slot < HOTBAR_SLOTS) { this.queue.push({ action: 'hotbar', slot }); return; }
    if (SIM_ACTIONS.includes(action)) this.queue.push({ action, aim });
  }

  /** select a hotbar slot (0-based) on the next tick, e.g. from a tapped HUD slot */
  selectHotbar(slot) {
    this.trigger(`hotbar${slot}`);
  }

  // ---- keyboard -------------------------------------------------------------------------------------------

  /**
   * @param {string} code KeyboardEvent.code
   * @param {{ repeat?: boolean, ctrl?: boolean, alt?: boolean, meta?: boolean }} [mods]
   * @returns {boolean} true if the browser default should be prevented
   */
  keyDown(code, { repeat = false, ctrl = false, alt = false, meta = false } = {}) {
    this.touchVisible = false;
    if (ctrl || alt || meta) return false;   // browser and system shortcuts stay theirs
    const action = KEY_BINDINGS[code];
    if (action) {
      if (HELD_ACTIONS.includes(action)) this.heldCodes.add(code);
      else if (!repeat) this.trigger(action, action === 'useItem' && this.mouse ? { screen: { ...this.mouse } } : null);
    }
    return PREVENT_DEFAULT_CODES.has(code);
  }

  /** @param {string} code */
  keyUp(code) {
    this.heldCodes.delete(code);
  }

  /**
   * Let go of everything held (window lost focus, tab hidden): keys, the joystick, buttons under a finger, a
   * throw being aimed. Pending one-tick actions are dropped too; the crouch toggle and the context icon stay.
   */
  releaseAll() {
    this.heldCodes.clear();
    this.pointers.clear();
    this.joystick = null;
    this.useDrag = null;
    this.queue = [];
    this.mouse = null;
  }

  // ---- pointers -------------------------------------------------------------------------------------------

  /**
   * @param {PointerRecord} p
   * @returns {boolean} true if the pointer now owns a control (the caller should capture it)
   */
  pointerDown(p) {
    const { id, x, y } = p;
    if (this.pointers.has(id)) this.pointerCancel(id);
    if (p.type === 'mouse') {
      this.touchVisible = false;
      this.mouse = { x, y };
      const button = p.button ?? 0;
      if (button === 0) {
        const region = this.regionAt(x, y);
        if (region) { this.pointers.set(id, { control: `region:${region}`, t0: p.t }); return true; }
        this.trigger('interact', { screen: { x, y } });
      } else if (button === 2) {
        this.trigger('useItem', { screen: { x, y } });
      }
      return false;
    }

    const wasVisible = this.touchVisible;
    this.touchVisible = true;
    const region = this.regionAt(x, y);
    if (region) { this.pointers.set(id, { control: `region:${region}`, t0: p.t }); return true; }
    const hit = hitTestTouch(this.layout, x, y);
    if (!hit) return false;
    if (hit === 'joystick') {
      if (this.joystick) return false;   // one thumb steers
      this.joystick = startJoystick(x, y, this.layout.joystick, this.layout.safeRect);
      this.pointers.set(id, { control: 'joystick' });
      return true;
    }
    if (!wasVisible) return false;   // a button nobody could see yet is not pressed; this touch only reveals them
    if (hit === 'use' && this.useDrag) return false;
    this.pointers.set(id, { control: hit });
    if (hit === 'use') this.useDrag = { startX: x, startY: y, x, y, aiming: false };
    else this.trigger(BUTTON_ACTIONS[hit]);
    return true;
  }

  /** @param {PointerRecord} p */
  pointerMove(p) {
    const { id, x, y } = p;
    if (p.type === 'mouse') {
      this.mouse = { x, y };
      if (!this.pointers.has(id)) this.touchVisible = false;
      return;
    }
    const owned = this.pointers.get(id);
    if (!owned) return;
    if (owned.control === 'joystick' && this.joystick) moveJoystick(this.joystick, x, y, this.layout.joystick);
    else if (owned.control === 'use' && this.useDrag) {
      const d = this.useDrag;
      d.x = x;
      d.y = y;
      const dx = x - d.startX;
      const dy = y - d.startY;
      if (!d.aiming && dx * dx + dy * dy >= this.layout.dragThreshold * this.layout.dragThreshold) d.aiming = true;
    }
  }

  /** @param {PointerRecord} p */
  pointerUp(p) {
    const owned = this.pointers.get(p.id);
    if (p.type === 'mouse') this.mouse = { x: p.x, y: p.y };
    if (!owned) return;
    if (p.type !== 'mouse') this.pointerMove(p);
    this.pointers.delete(p.id);
    if (owned.control === 'joystick') this.joystick = null;
    else if (owned.control === 'use' && this.useDrag) {
      const d = this.useDrag;
      this.useDrag = null;
      this.trigger('useItem', d.aiming ? { throw: { dx: d.x - d.startX, dy: d.y - d.startY } } : null);
    } else if (owned.control.startsWith('region:')) {
      const region = this.regions.get(owned.control.slice(7));
      const long = region?.onLongPress && Number.isFinite(p.t) && Number.isFinite(owned.t0) && p.t - owned.t0 >= region.longPressMs;
      if (region && inRect(region.rect(), p.x, p.y)) (long ? region.onLongPress : region.onTap)();
    }
  }

  /** the pointer was taken away (pointercancel, lost capture): release its control without firing it */
  pointerCancel(id) {
    const owned = this.pointers.get(id);
    if (!owned) return;
    this.pointers.delete(id);
    if (owned.control === 'joystick') this.joystick = null;
    else if (owned.control === 'use') this.useDrag = null;
  }

  /** the mouse left the game surface */
  mouseLeave() {
    this.mouse = null;
  }

  /** true while some pointer holds the control with this id */
  isPressed(control) {
    for (const p of this.pointers.values()) if (p.control === control) return true;
    return false;
  }

  // ---- per tick and per frame ---------------------------------------------------------------------------

  /**
   * The input for one simulation tick. Call exactly once per `sim.step`.
   * @param {{ camera?: { screenToWorld(x:number,y:number): {x:number,y:number} }|null, player?: {x:number,y:number}|null }} [ctx]
   *   the camera converts screen aims to world; the player position anchors touch throws
   * @returns {import('../../sim/input.js').InputState}
   */
  nextTick({ camera = null, player = null } = {}) {
    const input = emptyInput();
    const held = (action) => DIRECTION_CODES[action].some((c) => this.heldCodes.has(c));
    let mx = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
    let my = (held('down') ? 1 : 0) - (held('up') ? 1 : 0);
    const kl = Math.sqrt(mx * mx + my * my);
    if (kl > 1) { mx /= kl; my /= kl; }
    const stick = joystickVector(this.joystick, this.layout.joystick);
    mx += stick.x;
    my += stick.y;
    const len = Math.sqrt(mx * mx + my * my);
    if (len > 1) { mx /= len; my /= len; }
    input.moveX = mx;
    input.moveY = my;
    input.sprint = held('sprint') || stick.sprint;
    input.crouch = this.crouch;

    // one of each kind per tick; later presses of the same kind wait for the following ticks
    const taken = new Set();
    const rest = [];
    let interactAim = null;
    let useAim = null;
    for (const ev of this.queue) {
      if (taken.has(ev.action)) { rest.push(ev); continue; }
      taken.add(ev.action);
      if (ev.action === 'hotbar') input.hotbar = ev.slot;
      else input[ev.action] = true;
      const aim = this.resolveAim(ev.aim, camera, player);
      if (ev.action === 'interact') interactAim = aim;
      if (ev.action === 'useItem') useAim = aim;
    }
    this.queue = rest;
    const aim = useAim ?? interactAim;
    if (aim) { input.aimX = aim.x; input.aimY = aim.y; }
    return input;
  }

  /** @returns {{x:number,y:number}|null} */
  resolveAim(aim, camera, player) {
    if (!aim) return null;
    if (aim.screen) return screenToWorldAim(camera, aim.screen.x, aim.screen.y);
    if (aim.throw) return throwAimPoint(player, aim.throw.dx, aim.throw.dy, this.cfg.throwAimDistance);
    return null;
  }

  /**
   * The UI actions pressed since the last call, then cleared. Call once per frame.
   * @returns {{ openJournal: boolean, openInventory: boolean, pause: boolean }}
   */
  takeUiActions() {
    const out = this.ui;
    this.ui = noUi();
    return out;
  }
}
