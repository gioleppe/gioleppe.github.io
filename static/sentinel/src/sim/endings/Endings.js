// The two ways off the island (spec §8, steps 5.3 and 5.4), owned by the Sim as `sim.endings`, and the result:
// `sim.ending` = { kind: 'dinghy'|'rescue', tick, day, distance, seconds, sites, hit, hits, offerings } once one
// is reached (the ending event fires once; after it the Sim takes no more input). Simulation side.
//
// Events: see dinghy.js and signal.js; and here `ending { kind, ...figures }`.
import { DT } from '../constants.js';
import { DinghyEnding } from './dinghy.js';
import { SignalEnding } from './signal.js';

/** the three Fallen Outsiders' sites (spec §7.2) */
export const SITES = Object.freeze(['missionary_camp', 'sailor_remains', 'cartographer_camp']);

export class Endings {
  constructor() {
    this.dinghy = new DinghyEnding();
    this.signal = new SignalEnding();
    /** arrows that struck the player this run (for the ending's figures) */
    this.hits = 0;
  }

  /** an ending sequence is under way: in the boat, or a window on the peak */
  get inSequence() {
    return this.dinghy.afloat || this.dinghy.phase === 'away' || this.signal.inSequence;
  }

  /** the scouts do not stand down after a hit (the peak's minute) */
  get noStandDown() {
    return this.signal.holdoutActive;
  }

  /** the player is in the boat (Player.update is replaced by the oars) */
  get ridesBoat() {
    return this.dinghy.afloat;
  }

  /** the player is in the boat leaving: scouts shoot without warning */
  get fleeing() {
    return this.dinghy.afloat;
  }

  beforePlayer(sim, inp) {
    this.dinghy.beforePlayer(sim, inp);
  }

  afterPlayer(sim) {
    this.dinghy.afterPlayer(sim);
  }

  /** before the scouts: the peak's minute gives its orders */
  beforeScouts(sim) {
    this.signal.step(sim);
  }

  /** end of the step: count hits */
  afterStep(sim) {
    for (const e of sim.events) if (e.type === 'arrow_hit') this.hits += 1;
  }

  /** an ending is reached */
  finish(sim, kind) {
    if (sim.ending) return;
    const st = sim.story;
    const sites = SITES.filter((id) => st.inspected.has(id)).length;
    const offerings = Number.isFinite(st.counters.offerings) ? st.counters.offerings : null;
    sim.ending = {
      kind, tick: sim.tick, day: sim.world?.day ?? 1, distance: Math.round(sim.player.distanceMetres),
      seconds: Math.floor(sim.tick * DT), sites, sitesTotal: SITES.length, hit: this.hits > 0, hits: this.hits, offerings,
    };
    st.flags.add(kind === 'dinghy' ? 'ending_dinghy' : 'ending_rescue');
    sim.events.push({ type: 'ending', ...sim.ending });
  }

  snapshot() {
    return { dinghy: this.dinghy.snapshot(), signal: this.signal.snapshot(), hits: this.hits };
  }

  /** @param {Object|null|undefined} s from snapshot(); missing (an older save) gives fresh endings */
  static restore(s) {
    const e = new Endings();
    if (!s) return e;
    e.dinghy = DinghyEnding.restore(s.dinghy);
    e.signal = SignalEnding.restore(s.signal);
    e.hits = s.hits ?? 0;
    return e;
  }
}
