// Keyboard, mouse and touch into one input per simulation tick (spec §3.2). The decisions live in
// input/InputCore.js (pure, unit-tested); this class wires browser events to it and draws the touch controls.
//
// Per tick:  sim.step(input.nextTick({ camera, player: sim.player }))
// Per frame: input.takeUiActions() -> { openJournal, openInventory, pause } (never reach the simulation)
//            input.draw(uiCtx, { camera, player })
// From the game: setContext('hand'|'eye'|'speech'|'offering'|null), setCrouch(bool), setModal(box|null),
//            addHitRegion(id, rectProvider, onTap, { onLongPress, longPressMs }) for tappable HUD parts (hotbar
//            slots: tap selects, long-press drops), selectHotbar(slot).
import { InputCore, CONTEXT_ICONS } from './input/InputCore.js';
import { drawTouchControls } from './input/touchDraw.js';

export { CONTEXT_ICONS };
export { UI_ACTIONS } from './input/keymap.js';

export class InputManager extends InputCore {
  /**
   * @param {Object} opts
   * @param {Object} opts.tuning              the whole tuning object (reads `tuning.input`)
   * @param {EventTarget} opts.surface        element receiving pointer events (the #ui canvas, on top)
   * @param {EventTarget} [opts.keyTarget]    receives keys, blur (default: window)
   * @param {EventTarget & {hidden?: boolean}} [opts.doc] receives visibilitychange (default: document)
   */
  constructor({ tuning, surface, keyTarget = globalThis.window, doc = globalThis.document }) {
    super(tuning.input);
    this.surface = surface;
    this.keyTarget = keyTarget;
    this.doc = doc;
    /** CSS pixels per logical pixel, to convert pointer positions */
    this.scale = 1;
    /** @type {Array<[EventTarget, string, Function, Object?]>} */
    this.listeners = [];
    this.attach();
  }

  /**
   * Follow a new screen size: pointer conversion and the touch layout.
   * @param {import('./viewport.js').Viewport} vp
   * @param {{top:number,right:number,bottom:number,left:number}} safe insets in logical pixels
   */
  setViewport(vp, safe) {
    this.scale = vp.scale;
    this.setView({ width: vp.uiLogicalWidth, height: vp.uiLogicalHeight, scale: vp.scale }, safe);
  }

  /** a pointer event's position in logical pixels of the surface */
  toLogical(e) {
    const r = typeof this.surface.getBoundingClientRect === 'function' ? this.surface.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: (e.clientX - r.left) / this.scale, y: (e.clientY - r.top) / this.scale };
  }

  record(e) {
    const { x, y } = this.toLogical(e);
    return { id: e.pointerId, type: e.pointerType || 'mouse', button: e.button, x, y, t: e.timeStamp };
  }

  attach() {
    const on = (target, type, fn, opts) => {
      if (!target) return;
      target.addEventListener(type, fn, opts);
      this.listeners.push([target, type, fn, opts]);
    };
    on(this.keyTarget, 'keydown', (e) => {
      if (this.keyDown(e.code, { repeat: e.repeat, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey })) e.preventDefault();
    });
    on(this.keyTarget, 'keyup', (e) => this.keyUp(e.code));
    on(this.keyTarget, 'blur', () => this.releaseAll());   // no stuck keys or thumbs after alt-tab
    on(this.doc, 'visibilitychange', () => { if (this.doc.hidden) this.releaseAll(); });

    on(this.surface, 'pointerdown', (e) => {
      const p = this.record(e);
      if (this.pointerDown(p) && p.type !== 'mouse') {
        try { this.surface.setPointerCapture?.(e.pointerId); } catch { /* the pointer may already be gone */ }
      }
      if (p.type !== 'mouse') e.preventDefault();
    });
    on(this.surface, 'pointermove', (e) => this.pointerMove(this.record(e)));
    on(this.surface, 'pointerup', (e) => this.pointerUp(this.record(e)));
    on(this.surface, 'pointercancel', (e) => this.pointerCancel(e.pointerId));
    on(this.surface, 'lostpointercapture', (e) => this.pointerCancel(e.pointerId));   // no-op after a normal pointerup
    on(this.surface, 'pointerleave', (e) => { if (e.pointerType === 'mouse') this.mouseLeave(); });
    on(this.surface, 'contextmenu', (e) => e.preventDefault());
  }

  /** remove every listener (tests, teardown) */
  detach() {
    for (const [target, type, fn, opts] of this.listeners) target.removeEventListener(type, fn, opts);
    this.listeners = [];
    this.releaseAll();
  }

  /**
   * Draw the touch controls (nothing unless a touch has been seen).
   * @param {CanvasRenderingContext2D} ctx #ui context, scaled to logical pixels
   * @param {{ camera?: { worldToScreen(x:number,y:number): {x:number,y:number}, screenToWorld(x:number,y:number): {x:number,y:number} }|null,
   *   player?: {x:number,y:number}|null, landing?: ((wx:number, wy:number) => ({x:number,y:number}|null))|null }} [ctx2]
   *   landing: where a throw aimed at a world point would come down (the drag-aim line ends there)
   */
  draw(ctx, { camera = null, player = null, landing = null } = {}) {
    if (this.modal) return;   // the dialogue box is open: the touch controls are hidden (and inert, see InputCore)
    const playerScreen = camera && player ? camera.worldToScreen(player.x, player.y) : null;
    const clampAim = camera && landing ? (sx, sy) => {
      const w = camera.screenToWorld(sx, sy);
      const l = landing(w.x, w.y);
      return l ? camera.worldToScreen(l.x, l.y) : null;
    } : null;
    drawTouchControls(ctx, this, { playerScreen, clampAim });
  }
}
