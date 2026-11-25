// The two lists later steps feed into the debug panel. Pure.
//
//   debug.addPlaces((sim) => [{ id: 'crash', label: 'Crash site', x: 812, y: 1460 }, ...])
//       teleport targets; the provider is asked again every time the list is shown, so it can follow the map
//       (landmarks from IslandMap, scouts, the dinghy). Places from all providers are listed in order.
//   debug.addAction({ id: 'tide-high', label: 'Tide: high', group: 'world', run(sim, debug) { ... } })
//       cheat buttons (give item, set tide, set hour, set Resonance, spawn scout). Any write to the simulation
//       an action makes goes through src/engine/debug/cheats.js, so every debug write is in one place.

/** @typedef {{ id: string, label: string, x: number, y: number }} Place */
/** @typedef {{ id: string, label: string, group?: string, run: (sim: object, debug?: object) => void }} DebugAction */

export class PlaceRegistry {
  constructor({ log = console } = {}) {
    /** @type {Array<(sim: object) => Place[]>} */
    this.providers = [];
    this.log = log;
  }

  /**
   * @param {(sim: object) => Place[]} provider
   * @returns {() => void} removes it
   */
  add(provider) {
    if (typeof provider !== 'function') throw new TypeError('addPlaces: pass a function returning [{ id, label, x, y }]');
    this.providers.push(provider);
    return () => { this.providers = this.providers.filter((p) => p !== provider); };
  }

  /**
   * Every place now, in provider order; entries without finite x/y are skipped, a later duplicate id is dropped,
   * and a provider that throws contributes nothing.
   * @returns {Place[]}
   */
  list(sim) {
    const out = [];
    const seen = new Set();
    for (const p of this.providers) {
      let places;
      try { places = p(sim) ?? []; } catch (e) { this.log.warn(`debug: a places provider threw: ${e?.message ?? e}`); continue; }
      for (const pl of places) {
        if (!pl || !Number.isFinite(pl.x) || !Number.isFinite(pl.y)) continue;
        const id = String(pl.id ?? pl.label);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ id, label: String(pl.label ?? id), x: pl.x, y: pl.y });
      }
    }
    return out;
  }

  /** @returns {Place|null} */
  find(sim, id) {
    return this.list(sim).find((p) => p.id === id) ?? null;
  }
}

export class ActionRegistry {
  constructor() {
    /** @type {Map<string, DebugAction>} registration order */
    this.actions = new Map();
  }

  /**
   * @param {DebugAction} action replaces one with the same id
   * @returns {() => void} removes it
   */
  add(action) {
    if (!action || typeof action.id !== 'string' || !action.id) throw new TypeError('addAction: an action needs a string id');
    if (typeof action.run !== 'function') throw new TypeError(`addAction ${action.id}: run(sim) is required`);
    const entry = { group: 'misc', label: action.id, ...action };
    this.actions.set(action.id, entry);
    return () => { if (this.actions.get(action.id) === entry) this.actions.delete(action.id); };
  }

  /** @returns {DebugAction[]} */
  list() {
    return [...this.actions.values()];
  }

  /**
   * Run an action by id.
   * @returns {*} what the action returned
   */
  run(id, sim, debug) {
    const a = this.actions.get(id);
    if (!a) throw new Error(`debug: no action "${id}"`);
    return a.run(sim, debug);
  }
}
