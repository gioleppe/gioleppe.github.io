// The screen state machine (step 5.1): which full-screen state the page is in, and the panels open over it.
//
//   title ─▶ opening ─▶ game ⇄ pause          title ─▶ game (Continue, Load)
//                        │                    pause ─▶ title (Quit) | game (Load)
//                        ├─▶ gameover ─▶ game (Retry with a save, Load) | opening (Retry without one) | title
//                        └─▶ ending ─▶ title                  (steps 5.3 / 5.4: screens.show('ending', { kind }))
//
// A screen is an object registered by id: { pausesWorld, world: 'game'|'title'|'black', hud, enter(params, screens),
// exit(), update(dt, nowMs), draw(ctx, vp, safe, nowMs), onKey(code, repeat), handlePointer(ev) } (all optional).
// Later steps register their own (`screens.register('ending', myEnding)` replaces the placeholder) and switch with
// one call, `screens.show(id, params)`. Panels (settings, save slots, confirmations) stack over the screen with
// `openPanel` / `closePanel`; the top one gets the keys and pointers.
//
// The page's world is paused (main.js uiPaused) whenever the screen says so or a panel is open. Keys arrive through
// the InputCore modal hook (the screens own the keyboard whenever they are not the plain game), pointers through
// `attach(surface)`. Presentation only.
import { SCREEN_COLORS } from './screens/theme.js';

export const TRANSITIONS = Object.freeze({
  title: Object.freeze(['opening', 'game']),
  opening: Object.freeze(['game', 'title']),
  game: Object.freeze(['pause', 'gameover', 'ending', 'title']),
  pause: Object.freeze(['game', 'title', 'opening']),
  gameover: Object.freeze(['game', 'opening', 'title']),
  ending: Object.freeze(['title', 'game', 'opening']),
});

/** may the machine go from `from` to `to`? (anything may start it; showing the same screen again re-enters it) */
export function canTransition(from, to) {
  return from == null || from === to || !!TRANSITIONS[from]?.includes(to);
}

export class Screens {
  /**
   * @param {Object} opts
   * @param {Object} [opts.input] the InputManager (setModal, toLogical)
   * @param {Object} opts.cfg tuning.screens
   * @param {Object} [opts.audio] the audio adapter (setScreen)
   * @param {() => boolean} [opts.isTouch] finger-sized rows
   * @param {() => number} [opts.now] ms clock (performance.now in the page)
   * @param {(id: string, from: string|null) => void} [opts.onChange]
   */
  constructor({ input = null, cfg, audio = null, isTouch = () => false, now = () => 0, onChange = null }) {
    this.input = input;
    this.cfg = cfg;
    this.audio = audio;
    this.isTouch = isTouch;
    this.now = now;
    this.onChange = onChange;
    /** @type {Map<string, Object>} */
    this.screens = new Map();
    this.currentId = null;
    /** @type {Array<Object>} panels over the screen, top last */
    this.panels = [];
    this.ownsModal = false;
    /** the transitions taken, newest last (tests, debug) */
    this.history = [];
  }

  register(id, screen) {
    this.screens.set(id, screen);
    return screen;
  }

  get current() { return this.screens.get(this.currentId) ?? null; }

  /**
   * Switch screens.
   * @param {string} id
   * @param {Object} [params] passed to the screen's enter()
   * @returns {boolean} false when the machine does not allow it (nothing changes)
   */
  show(id, params = {}) {
    const next = this.screens.get(id);
    if (!next) throw new Error(`Screens: no screen "${id}"`);
    if (!canTransition(this.currentId, id)) {
      console.warn(`Screens: ${this.currentId} -> ${id} is not a transition`);
      return false;
    }
    const from = this.currentId;
    this.current?.exit?.(this);
    this.panels = [];
    this.currentId = id;
    this.history.push(id);
    next.enter?.(params, this);
    this.audio?.setScreen?.(id);
    this.syncModal();
    this.onChange?.(id, from);
    return true;
  }

  openPanel(panel) {
    this.panels.push(panel);
    this.syncModal();
    return panel;
  }

  /** close the top panel (or the given one) */
  closePanel(panel = this.panels[this.panels.length - 1]) {
    const i = this.panels.lastIndexOf(panel);
    if (i >= 0) this.panels.splice(i, 1);
    this.syncModal();
  }

  closeAllPanels() {
    this.panels = [];
    this.syncModal();
  }

  /** the thing that gets keys and pointers */
  get top() { return this.panels[this.panels.length - 1] ?? this.current; }

  /** the world stands still */
  get pausesWorld() { return this.panels.length > 0 || !!this.current?.pausesWorld; }

  /** which world to draw: the running game's, the title's drifting island, or nothing */
  get world() { return this.current?.world ?? 'game'; }

  /** draw the HUD under the screen */
  get hud() { return this.current ? !!this.current.hud : true; }

  /** the plain game: no screen of ours over it */
  get inGame() { return this.currentId === 'game' && this.panels.length === 0; }

  /** take the keyboard (modal) whenever something of ours is up; give it back in the plain game */
  syncModal() {
    if (!this.input?.setModal) return;
    if (!this.inGame) {
      this.input.setModal({ onKey: (code, repeat) => this.onKey(code, repeat), allowRegion: (id) => id.startsWith('screens') || id.startsWith('debug') });
      this.ownsModal = true;
    } else if (this.ownsModal) {
      this.input.setModal(null);
      this.ownsModal = false;
    }
  }

  onKey(code, repeat = false) {
    const t = this.top;
    return t?.onKey ? t.onKey(code, repeat, this) !== false : true;
  }

  handlePointer(ev) {
    return this.top?.handlePointer?.(ev, this) ?? null;
  }

  update(dt, now = this.now()) {
    this.current?.update?.(dt, now, this);
  }

  draw(ctx, vp, safe, now = this.now()) {
    this.current?.draw?.(ctx, vp, safe, now, this);
    for (const p of this.panels) {
      ctx.save();
      ctx.fillStyle = SCREEN_COLORS.backdrop;
      ctx.fillRect(0, 0, vp.uiLogicalWidth, vp.uiLogicalHeight);
      ctx.restore();
      p.draw(ctx, vp, safe, this.cfg, { touch: this.isTouch(), now });
    }
  }

  /**
   * Wire pointer and wheel events of the #ui canvas (keys come through the modal hook).
   * @param {{ surface: EventTarget }} env
   * @returns {() => void} removes them
   */
  attach({ surface }) {
    const offs = [];
    const on = (type, fn, opts) => { surface.addEventListener(type, fn, opts); offs.push(() => surface.removeEventListener(type, fn, opts)); };
    const pos = (e) => (this.input?.toLogical ? this.input.toLogical(e) : { x: e.clientX, y: e.clientY });
    for (const type of ['down', 'move', 'up']) {
      on(`pointer${type}`, (e) => {
        if (!this.ownsModal) return;
        const p = pos(e);
        this.handlePointer({ type, id: e.pointerId, x: p.x, y: p.y, mouse: e.pointerType === 'mouse', t: e.timeStamp });
      });
    }
    on('pointercancel', (e) => { if (this.ownsModal) this.handlePointer({ type: 'cancel', id: e.pointerId }); });
    on('wheel', (e) => {
      if (!this.ownsModal) return;
      const p = pos(e);
      this.handlePointer({ type: 'wheel', dy: e.deltaY, x: p.x, y: p.y });
      e.preventDefault();
    }, { passive: false });
    return () => { for (const f of offs.splice(0)) f(); };
  }
}
