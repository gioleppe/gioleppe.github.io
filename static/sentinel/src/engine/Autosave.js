// When the page autosaves (step 5.2). Each step's events can ask for an autosave (saveRules.autosaveReason:
// entering Marek's clearing, a key item, a story step), and so can the clock: every tuning.save.autosaveMinutes of
// play (ticks, not wall time). A request waits, step after step, until saveRules.canSave allows it: an autosave is
// only ever written at a safe moment. Quitting to the title and the page being hidden or closed ask too
// (`now(reason)`); when that moment is not safe nothing is written and the last safe autosave stands.
import { TICK_HZ } from '../sim/constants.js';
import { canSave, autosaveReason } from '../sim/saveRules.js';

export class Autosave {
  /**
   * @param {Object} opts
   * @param {import('./SaveStore.js').SaveStore} opts.store
   * @param {Object} opts.cfg tuning.save
   * @param {(result: Object, reason: string) => void} [opts.onSaved] after every write attempt (the HUD mark, a warning)
   */
  constructor({ store, cfg, onSaved = null }) {
    this.store = store;
    this.cfg = cfg;
    this.onSaved = onSaved;
    /** ticks between two clock autosaves */
    this.everyTicks = Math.max(1, Math.round((cfg.autosaveMinutes ?? 3) * 60 * TICK_HZ));
    /** @type {string|null} a request waiting for a safe moment */
    this.pending = null;
    this.lastTick = 0;
    /** @type {{ ok: boolean, reason: string, tick: number, code?: string, message?: string }|null} */
    this.last = null;
    this.enabled = true;
  }

  /** a new or loaded run: the clock starts from its present tick, nothing pending */
  reset(sim) {
    this.pending = null;
    this.lastTick = sim?.tick ?? 0;
  }

  /**
   * After every tick (with that tick's events).
   * @returns {Object|null} the write result when an autosave was written
   */
  onStep(sim) {
    if (!this.enabled || !sim) return null;
    const why = autosaveReason(sim.events, sim);
    if (why && !this.pending) this.pending = why;
    if (!this.pending && sim.tick - this.lastTick >= this.everyTicks) this.pending = 'interval';
    if (!this.pending) return null;
    if (!canSave(sim, this.cfg).ok) return null;   // wait for a safe moment
    return this.write(sim, this.pending);
  }

  /**
   * Autosave now if the moment is safe (quit to title, page hidden). Otherwise nothing is written: the previous
   * autosave, taken at a safe moment, stays the one to continue from.
   * @returns {{ ok: boolean, refused?: string, code?: string, message?: string }}
   */
  now(sim, reason) {
    if (!sim) return { ok: false, refused: 'There is nothing to save.' };
    const c = canSave(sim, this.cfg);
    if (!c.ok) return { ok: false, refused: c.reason, code: c.code };
    // nothing happened since the last autosave: writing again would only push the backup out
    if (this.last?.ok && this.last.tick === sim.tick && this.last.sim === sim) return { ok: true, unchanged: true };
    return this.write(sim, reason);
  }

  write(sim, reason) {
    const r = this.store.writeAuto(sim);
    // a failed write (storage full or blocked) is not retried every tick: the next request or the clock tries again
    this.pending = null;
    this.lastTick = sim.tick;
    this.last = { ok: r.ok, reason, tick: sim.tick, sim, code: r.code, message: r.message, bytes: r.bytes };
    this.onSaved?.(r, reason);
    return r;
  }
}
