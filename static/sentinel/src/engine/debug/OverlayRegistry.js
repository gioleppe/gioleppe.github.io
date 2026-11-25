// Named debug overlay layers, each switched on and off on its own and remembered between visits.
//
// ADDING A LAYER (later steps: noise radii, sight cones, AI states, tide, Resonance, landmarks):
//
//   window.__game?.debug?.addLayer({ ... })       // from anywhere in the page, only exists under ?debug
//   debug.addLayer({                              // or from inside src/engine/debug/ with the DebugMode object
//     id: 'noise', label: 'Noise radii', group: 'stealth', default: true,
//     drawWorld(ctx, sim, camera, env) { ... },   // #world canvas, after the scene, logical pixels;
//                                                 // world (x, y) is at screen (x - camera.originX, y - camera.originY)
//     drawUi(ctx, sim, vp, env) { ... },          // #ui canvas, logical pixels, for text and panels
//   });
//
// `env` is { camera, input, assets, renderer, alpha, mouse, lastInput, debug }: `alpha` is the tick
// interpolation of this frame, `mouse` the pointer in logical pixels (or null). Layers draw in registration
// order, each inside save()/restore(). A layer that throws is switched off and named once on the console,
// so one broken overlay never takes the frame down. Pure (no DOM): storage is passed in.

/**
 * @typedef {Object} OverlayLayer
 * @property {string} id                 unique, stable (it is the storage key)
 * @property {string} label              shown in the panel
 * @property {string} [group]            panel heading; layers of a group are listed together
 * @property {boolean} [default]         on when the viewer has never toggled it (default false)
 * @property {(ctx: CanvasRenderingContext2D, sim: object, camera: object, env: object) => void} [drawWorld]
 * @property {(ctx: CanvasRenderingContext2D, sim: object, vp: object, env: object) => void} [drawUi]
 */

/** localStorage key of the on/off choices */
export const LAYER_STORAGE_KEY = 'sentinel.debug.layers';

export class OverlayRegistry {
  /**
   * @param {Object} [opts]
   * @param {{ getItem(k: string): string|null, setItem(k: string, v: string): void }|null} [opts.storage] e.g. localStorage
   * @param {string} [opts.key]
   * @param {{ warn: Function }} [opts.log]
   */
  constructor({ storage = null, key = LAYER_STORAGE_KEY, log = console } = {}) {
    this.storage = storage;
    this.key = key;
    this.log = log;
    /** @type {Map<string, OverlayLayer>} in registration (= draw) order */
    this.layers = new Map();
    /** @type {Record<string, boolean>} choices the viewer made, persisted */
    this.choices = this.readChoices();
    /** ids switched off for this visit because they threw (not persisted: a reload tries again after a fix) */
    this.broken = new Set();
  }

  readChoices() {
    try {
      const raw = this.storage?.getItem(this.key);
      const v = raw ? JSON.parse(raw) : null;
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch {
      return {};   // storage blocked or corrupt: start from the defaults
    }
  }

  writeChoices() {
    try { this.storage?.setItem(this.key, JSON.stringify(this.choices)); } catch { /* private mode, quota: forget quietly */ }
  }

  /**
   * Register a layer (replaces one with the same id, keeping its place in the order).
   * @param {OverlayLayer} layer
   * @returns {() => void} removes it
   */
  add(layer) {
    if (!layer || typeof layer.id !== 'string' || !layer.id) throw new TypeError('addLayer: a layer needs a string id');
    if (!layer.drawWorld && !layer.drawUi) throw new TypeError(`addLayer ${layer.id}: give drawWorld and/or drawUi`);
    const entry = { group: 'misc', label: layer.id, default: false, ...layer };
    this.layers.set(layer.id, entry);
    return () => { if (this.layers.get(layer.id) === entry) this.layers.delete(layer.id); };
  }

  /** @returns {boolean} */
  isOn(id) {
    const l = this.layers.get(id);
    if (!l || this.broken.has(id)) return false;
    return typeof this.choices[id] === 'boolean' ? this.choices[id] : !!l.default;
  }

  /** switch a layer on or off and remember the choice */
  set(id, on) {
    this.broken.delete(id);
    this.choices[id] = !!on;
    this.writeChoices();
  }

  /** @returns {boolean} the new state */
  toggle(id) {
    const on = !this.isOn(id);
    this.set(id, on);
    return on;
  }

  /** @returns {Array<OverlayLayer & { on: boolean }>} in draw order */
  list() {
    return [...this.layers.values()].map((l) => ({ ...l, on: this.isOn(l.id) }));
  }

  /** @returns {Array<{ group: string, layers: Array<OverlayLayer & { on: boolean }> }>} groups in order of first appearance */
  byGroup() {
    const groups = new Map();
    for (const l of this.list()) {
      if (!groups.has(l.group)) groups.set(l.group, []);
      groups.get(l.group).push(l);
    }
    return [...groups].map(([group, layers]) => ({ group, layers }));
  }

  /** draw every layer that is on and has a drawWorld */
  drawWorld(ctx, sim, camera, env) {
    this.drawEach('drawWorld', ctx, (l) => l.drawWorld(ctx, sim, camera, env));
  }

  /** draw every layer that is on and has a drawUi */
  drawUi(ctx, sim, vp, env) {
    this.drawEach('drawUi', ctx, (l) => l.drawUi(ctx, sim, vp, env));
  }

  drawEach(method, ctx, call) {
    for (const l of [...this.layers.values()]) {
      if (!l[method] || !this.isOn(l.id)) continue;
      ctx.save();
      try {
        call(l);
      } catch (e) {
        this.broken.add(l.id);
        this.log.warn(`debug: overlay "${l.id}" threw and was switched off: ${e?.message ?? e}`);
      } finally {
        ctx.restore();
      }
    }
  }
}
