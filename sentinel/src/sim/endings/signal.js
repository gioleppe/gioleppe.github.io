// Win B, the distress signal (spec §8, step 5.4): fire the flare at Signal Peak with the radio battery, survive
// the minute while the island comes for you, and be taken off the ridge by a patrol boat's spotlight. Simulation
// side; every number is in tuning.endings.signal.
//
// Firing (the flare gun's useItem at the signal point, storyInteractions.useFlareGun):
//   - no flare: flare_refused { reason: 'empty' }; the first firing without the radio battery carried:
//     flare_refused { reason: 'no_battery' }; a window already running: flare_refused { reason: 'burning' };
//   - the first press: the moment must be one the game may be saved at (saveRules.canSave), else
//     signal_refused { code, reason } and nothing happens. If it may: flare_ready { flares } and
//     signal_confirm { flares, seconds } (the page autosaves on it: Retry after a death on the peak loads that
//     moment, the flare still in the gun);
//   - a second press within confirmSeconds (and the moment still safe): the flare is fired (signal_fired), a
//     round is spent (the gun's first, then the pouch's), and the first time the battery is wired into the old
//     mast on the radio rock (beacon_on; it stays there and the beacon runs for good). A window starts.
// A window (holdout): Resonance forced to resonanceValue (100) for holdoutSeconds (60); scouts within
//   convergeRadius and those of peakRoutes (at most maxCalled, nearest first) are called in waves of waveSize
//   every waveSeconds (holdout_wave { n, ids }), at most plateauCap hunting at once; they CHASE to the plateau and
//   search it, and one that gives up is sent back (every reorderSeconds). No stand-down after a hit while it runs
//   (`noStandDown`). holdout_tick { second, left } every second; boat_arrives { n } at boatArriveSecond.
//   At the end, alive and on the plateau (signal_peak region or plateauRadius of the signal point):
//   spotlight_sweep { n }, the scouts near the peak withdraw, and after extractSeconds `rescued` and the ending.
//   Elsewhere: boat_missed { n }, Resonance released, the called scouts go back, and the beacon brings another
//   boat beaconIntervalSeconds later (beacon_window { n }), or at once when another flare is fired.
import { DT, TICK_HZ } from '../constants.js';
import { canSave } from '../saveRules.js';
import { flaresCarried } from '../Objectives.js';
import { orderConverge, orderWithdraw, arriveSearching } from '../../entities/ai/converge.js';
import { hash01 } from '../../entities/ai/Route.js';

const ticks = (s) => Math.max(1, Math.round(s * TICK_HZ));

/** the map's signal point (the radio rock), or null */
export function signalPointOf(sim) {
  return sim.map?.byId?.('signal_point') ?? null;
}

/** the player counts as on the plateau */
export function onPlateau(sim, x = sim.player.x, y = sim.player.y) {
  const sp = signalPointOf(sim);
  if (!sp) return false;
  if (sim.map.regionAtWorld(x, y) === 'signal_peak') return true;
  const r = sim.tuning.endings.signal.plateauRadius;
  const dx = x - sp.x;
  const dy = y - sp.y;
  return dx * dx + dy * dy <= r * r;
}

/** places on the plateau a hunter searches (the signal point, the summit, the pool, the climbs' heads) */
function plateauSpots(sim) {
  const out = [];
  for (const id of ['signal_point', 'signal_peak', 'peak_pool', 'peak_climb_south', 'peak_climb_east']) {
    const e = sim.map.byId(id) ?? sim.map.landmark(id);
    if (e) out.push([e.x, e.y]);
  }
  return out;
}

export class SignalEnding {
  constructor() {
    /** a first press asked for confirmation; a second before this tick fires (-1: not armed) */
    this.armedUntil = -1;
    /** the battery is wired into the mast: the beacon runs */
    this.beacon = false;
    this.fired = 0;
    /** windows so far (each a boat's pass) */
    this.vigils = 0;
    /** next tick a boat comes by itself (-1: none due) */
    this.nextWindow = -1;
    /**
     * @type {{ n: number, start: number, end: number, phase: 'holdout'|'extract', extractEnd: number,
     *   called: string[], released: number, boat: boolean }|null}
     */
    this.vigil = null;
    this.lastFiredTick = -1;
  }

  get holdoutActive() {
    return this.vigil !== null && this.vigil.phase === 'holdout';
  }

  get inSequence() {
    return this.vigil !== null;
  }

  /** seconds into the running window, or -1 */
  seconds(sim) {
    return this.vigil ? (sim.tick - this.vigil.start) * DT : -1;
  }

  /**
   * The flare gun's useItem at the signal point (the gun's own checks, place and flares, are done).
   */
  use(sim) {
    const flares = flaresCarried(sim);
    if (flares <= 0) { sim.events.push({ type: 'flare_refused', reason: 'empty' }); return; }
    if (this.vigil) { sim.events.push({ type: 'flare_refused', reason: 'burning' }); return; }
    if (!this.beacon && !sim.inventory.has('radio_battery')) { sim.events.push({ type: 'flare_refused', reason: 'no_battery' }); return; }
    const c = canSave(sim);
    if (!c.ok) {
      this.armedUntil = -1;
      sim.events.push({ type: 'signal_refused', code: c.code, reason: c.reason });
      return;
    }
    const cfg = sim.tuning.endings.signal;
    if (sim.tick > this.armedUntil) {
      this.armedUntil = sim.tick + ticks(cfg.confirmSeconds);
      sim.events.push({ type: 'flare_ready', flares });
      sim.events.push({ type: 'signal_confirm', flares, seconds: cfg.confirmSeconds });
      return;
    }
    this.fire(sim);
  }

  fire(sim) {
    const st = sim.story;
    const c = st.counters;
    this.armedUntil = -1;
    if ((c.flare_gun_rounds ?? 0) > 0) c.flare_gun_rounds -= 1;
    else c.flare_pouch_rounds = Math.max(0, (c.flare_pouch_rounds ?? 0) - 1);
    this.fired += 1;
    this.lastFiredTick = sim.tick;
    st.flags.add('signal_fired');
    const sp = signalPointOf(sim);
    sim.events.push({ type: 'signal_fired', x: sp?.x ?? sim.player.x, y: sp?.y ?? sim.player.y, flaresLeft: flaresCarried(sim), n: this.fired });
    if (!this.beacon) {
      this.beacon = true;
      sim.inventory.spend('radio_battery', 1, 'beacon');
      st.flags.add('beacon_on');
      sim.events.push({ type: 'beacon_on', x: sp?.x ?? sim.player.x, y: sp?.y ?? sim.player.y });
    }
    this.startWindow(sim);
  }

  startWindow(sim) {
    const cfg = sim.tuning.endings.signal;
    this.vigils += 1;
    this.nextWindow = -1;
    const start = sim.tick;
    this.vigil = { n: this.vigils, start, end: start + ticks(cfg.holdoutSeconds), phase: 'holdout', extractEnd: -1, called: this.chooseCalled(sim), released: 0, boat: false };
    sim.resonance.force(cfg.resonanceValue, cfg.holdoutSeconds);
    sim.events.push({ type: 'beacon_window', n: this.vigils });
    sim.events.push({ type: 'holdout_start', seconds: cfg.holdoutSeconds, n: this.vigils, called: this.vigil.called.length });
  }

  /** who the beacon calls: near the peak or on its routes, nearest first, at most maxCalled */
  chooseCalled(sim) {
    const cfg = sim.tuning.endings.signal;
    const sp = signalPointOf(sim);
    if (!sp) return [];
    const routes = new Set(cfg.peakRoutes);
    const r2 = cfg.convergeRadius * cfg.convergeRadius;
    const cand = [];
    for (const s of sim.scouts.list) {
      const dx = s.x - sp.x;
      const dy = s.y - sp.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2 || routes.has(s.routeId)) cand.push({ id: s.id, d2 });
    }
    cand.sort((a, b) => a.d2 - b.d2 || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return cand.slice(0, cfg.maxCalled).map((c) => c.id);
  }

  /** every tick, before the scouts */
  step(sim) {
    const cfg = sim.tuning.endings.signal;
    if (!this.vigil) {
      if (this.beacon && this.nextWindow >= 0 && sim.tick >= this.nextWindow && !sim.player.dead && !sim.ending) this.startWindow(sim);
      return;
    }
    const w = this.vigil;
    const el = sim.tick - w.start;
    if (w.phase === 'extract') {
      this.withdrawNear(sim);
      if (sim.tick >= w.extractEnd && !sim.player.dead) {
        sim.events.push({ type: 'rescued', n: w.n });
        sim.story.flags.add('rescued');
        this.vigil = null;
        sim.endings.finish(sim, 'rescue');
      }
      return;
    }
    if (sim.player.dead) return;
    if (el > 0 && el % TICK_HZ === 0) sim.events.push({ type: 'holdout_tick', second: el / TICK_HZ, left: Math.max(0, (w.end - sim.tick) / TICK_HZ), n: w.n });
    // waves
    // waves: the first after firstWaveSeconds (the flare is still climbing), then one every waveSeconds
    const first = Math.round(cfg.firstWaveSeconds * TICK_HZ);
    const wave = el < first ? -1 : Math.floor((el - first) / ticks(cfg.waveSeconds));
    const due = Math.min(w.called.length, (wave + 1) * cfg.waveSize);
    const cap = this.plateauCap(sim);
    if (w.released < due && this.hunting(sim) < cap) {
      const ids = [];
      while (w.released < due && this.hunting(sim) + ids.length < cap) ids.push(w.called[w.released++]);
      if (ids.length) {
        sim.events.push({ type: 'holdout_wave', n: Math.ceil(w.released / cfg.waveSize), ids });
        for (const id of ids) this.order(sim, sim.scouts.byId(id));
      }
    }
    // the runners: kept running while far from the peak; near it, the ones that have not seen the player slow to a
    // search of the plateau
    const sp = signalPointOf(sim);
    const a2 = cfg.approachPx * cfg.approachPx;
    for (let i = 0; i < w.released; i++) {
      const s = sim.scouts.byId(w.called[i]);
      if (!s || s.state !== 'chase' || s.reason !== 'converge' || s.seen) continue;
      const dx = s.x - sp.x;
      const dy = s.y - sp.y;
      if (dx * dx + dy * dy > a2 || !onPlateau(sim, s.x, s.y)) s.lostTick = sim.tick;
      else {
        const [x, y] = this.searchTarget(sim, s);
        arriveSearching(sim.scouts, sim, s, x, y, sim.tuning.ai.awareness.suspicious);
      }
    }
    // the ones that gave up go back up
    if (el % ticks(cfg.reorderSeconds) === 0) {
      for (let i = 0; i < w.released; i++) {
        const s = sim.scouts.byId(w.called[i]);
        if (s && s.state !== 'chase' && s.state !== 'search') this.order(sim, s);
      }
    }
    if (!w.boat && el >= ticks(cfg.boatArriveSecond)) {
      w.boat = true;
      sim.events.push({ type: 'boat_arrives', n: w.n });
    }
    if (sim.tick >= w.end) this.endHoldout(sim);
  }

  /** how many called scouts may hunt the plateau at once: fewer at night (they cannot find the way up in the dark) */
  plateauCap(sim) {
    const cfg = sim.tuning.endings.signal;
    return sim.world?.dayPhase === 'night' ? cfg.nightPlateauCap : cfg.plateauCap;
  }

  /** called scouts hunting now (released and not back on their routes) */
  hunting(sim) {
    const w = this.vigil;
    let n = 0;
    for (let i = 0; i < w.released; i++) {
      const s = sim.scouts.byId(w.called[i]);
      if (s && (s.state === 'chase' || s.state === 'search')) n += 1;
    }
    return n;
  }

  /**
   * Send a called scout up. While the player is on the plateau the hunters are drawn to roughly where they are
   * (the flare's light, the sounds of someone on bare rock: within searchScatterPx, wider at night); otherwise to
   * one of the plateau's places.
   */
  order(sim, s) {
    if (!s) return;
    const cfg = sim.tuning.endings.signal;
    const sp = signalPointOf(sim);
    if (sp) {
      const dx = s.x - sp.x;
      const dy = s.y - sp.y;
      if (dx * dx + dy * dy > cfg.approachPx * cfg.approachPx) {
        orderConverge(sim.scouts, sim, s, sp.x, sp.y, { approach: true });
        return;
      }
    }
    const t = this.searchTarget(sim, s);
    if (t) orderConverge(sim.scouts, sim, s, t[0], t[1]);
  }

  /**
   * Where a hunter on the plateau searches: while the player is up there, often (trackChance, less at night)
   * within searchScatterPx of them (the flare's light, sounds on bare rock); else one of the plateau's places.
   * @returns {[number, number]|null}
   */
  searchTarget(sim, s) {
    const cfg = sim.tuning.endings.signal;
    const sec = Math.floor(sim.tick / TICK_HZ);
    const p = sim.player;
    const night = sim.world?.dayPhase === 'night';
    if (onPlateau(sim) && hash01(s.n, sec, 13) < (night ? cfg.nightTrackChance : cfg.trackChance)) {
      const r = night ? cfg.nightSearchScatterPx : cfg.searchScatterPx;
      const x = p.x + (hash01(s.n, sec, 11) * 2 - 1) * r;
      const y = p.y + (hash01(s.n, sec, 12) * 2 - 1) * r;
      if (onPlateau(sim, x, y)) return [x, y];
    }
    const spots = plateauSpots(sim);
    if (!spots.length) return null;
    const k = Math.floor(hash01(s.n, this.vigil.n, sec) * spots.length) % spots.length;
    return spots[k];
  }

  endHoldout(sim) {
    const cfg = sim.tuning.endings.signal;
    const w = this.vigil;
    if (onPlateau(sim)) {
      w.phase = 'extract';
      w.extractEnd = sim.tick + ticks(cfg.extractSeconds);
      sim.events.push({ type: 'spotlight_sweep', n: w.n });
      this.withdrawNear(sim);
      return;
    }
    sim.events.push({ type: 'boat_missed', n: w.n });
    sim.resonance.release();
    for (let i = 0; i < w.released; i++) {
      const s = sim.scouts.byId(w.called[i]);
      if (s && s.state === 'chase') sim.scouts.search(sim, s);
    }
    this.vigil = null;
    this.nextWindow = sim.tick + ticks(cfg.beaconIntervalSeconds);
  }

  /** in the light: every scout near the peak lowers its bow and goes back down */
  withdrawNear(sim) {
    const sp = signalPointOf(sim);
    if (!sp) return;
    const r = sim.tuning.endings.signal.plateauRadius * 2;
    for (const s of sim.scouts.list) {
      if (s.state === 'patrol') continue;
      const dx = s.x - sp.x;
      const dy = s.y - sp.y;
      if (dx * dx + dy * dy <= r * r) orderWithdraw(sim.scouts, sim, s);
    }
  }

  snapshot() {
    return {
      armedUntil: this.armedUntil, beacon: this.beacon, fired: this.fired, vigils: this.vigils, nextWindow: this.nextWindow,
      lastFiredTick: this.lastFiredTick, vigil: this.vigil ? { ...this.vigil, called: [...this.vigil.called] } : null,
    };
  }

  static restore(s) {
    const e = new SignalEnding();
    if (!s) return e;
    Object.assign(e, { armedUntil: s.armedUntil, beacon: !!s.beacon, fired: s.fired ?? 0, vigils: s.vigils ?? 0, nextWindow: s.nextWindow ?? -1, lastFiredTick: s.lastFiredTick ?? -1 });
    e.vigil = s.vigil ? { ...s.vigil, called: [...s.vigil.called] } : null;
    return e;
  }
}
