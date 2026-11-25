// Resonance (spec §6.3): how loudly the island's anomaly is "listening" to the player, 0..100. Simulation side
// (`sim.resonance`), stepped once per tick by Sim.step after the player, deterministic, plain arithmetic.
//
// ---- the model -----------------------------------------------------------------------------------------------
// Every tick the sources give a TARGET level, and the value walks towards it at a fixed speed: up at
// `riseRate` points/s, down at `fallRate` points/s (rises fast, decays slowly), so switching a light off or
// walking away from the monoliths is a decision that takes time to pay off.
//
//   raw    = flashlight            tuning.resonance.sources.flashlight          while the flashlight is on
//          + electronics           sources.electronicEach x each other electronic item powered on (radio battery)
//          + anomaly               sources.anomalyAtFull x map.anomalyAt(player)  (strongest zone, strength 0..1)
//          + monolith              sources.monolith.near x (1 - d / radius) for the nearest monolith within radius
//   target = min(max, raw) x (1 - totemDampening when a Driftwood Totem is carried)
//
// The totem's 40% is applied after the cap, so whatever the sources, the level the player settles at with the
// totem is exactly 60% of the level without it. With the numbers in data/tuning.json (40 / 35 / 50 / 15 within
// 192 px, rise 8/s, fall 2/s, tiers at 31 and 70, hysteresis 2), from 0:
//
//   sources                                   target   Humming (>= 31)   Agitated (>= 70)
//   flashlight alone                              40    3.9 s             -
//   radio battery alone                           35    3.9 s             -
//   Quiet Meridian core (no monolith near)        50    3.9 s             -
//   core, at the heart monolith                   65    3.9 s             -   (the Meridian alone holds Humming)
//   core + flashlight                         90..100   3.9 s             8.75 s
//   flashlight + radio battery                    75    3.9 s             8.75 s
//   Meridian halo (0.4) + flashlight              60    3.9 s             -
//   heart + flashlight, totem carried             60    3.9 s             -   (the totem keeps it out of Agitated)
//
//   falling back with every source gone: 40 -> Quiet (< 29) 5.5 s; 65 -> Quiet 18 s;
//   100 -> Humming (< 68) 16 s, -> Quiet 35.5 s.
//
// Tiers (spec: 0-30 Quiet, 31-69 Humming, 70-100 Agitated): the tier goes up as soon as the value reaches a
// threshold and comes down only once it is `hysteresis` below it, so it never flickers at a boundary.
//
// What other systems read (and never write): value, tier, target, sources (breakdown for the HUD and debug),
// detectionMultiplier (scout sight/detection radius factor: 1 Quiet, 1.2 Humming, 1.35 Agitated), escalate
// (Agitated: scouts that INVESTIGATE go straight to ALERT, step 4.3), shiftingPaths (Agitated: the fog may
// reset, FogOfWar.js decides where), pulses (per anomaly zone: origin and the tick of its last pulse).
// Events: resonance_tier { from, to }; anomaly_pulse { id, x, y, strength, resonance } from a timer per anomaly
// zone that runs faster the higher the Resonance (step 4.4, "respecting the monolith", keys off it).
// force(value, seconds) pins the value (Signal Peak climax, spec §8); release() ends a pin early.
import { DT, TICK_HZ } from '../sim/constants.js';
import { activeElectronics, flashlightOn, carries } from './carried.js';

export const TIERS = Object.freeze(['quiet', 'humming', 'agitated']);
const RANK = Object.freeze({ quiet: 0, humming: 1, agitated: 2 });

function num(v, what, min = 0, max = Infinity) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new Error(`Resonance: tuning.resonance.${what} must be a number in [${min}, ${max}] (got ${JSON.stringify(v)})`);
  }
  return v;
}

/**
 * Check tuning.resonance.
 * @param {Object} tuning the whole tuning object
 * @returns {Object} frozen config
 */
export function resonanceConfig(tuning) {
  const r = tuning?.resonance;
  if (!r) throw new Error('Resonance: tuning.resonance is missing');
  const max = num(r.max, 'max', 1);
  const t = r.tiers ?? {};
  num(t.hummingAt, 'tiers.hummingAt', 0, max);
  num(t.agitatedAt, 'tiers.agitatedAt', t.hummingAt, max);
  num(t.hysteresis, 'tiers.hysteresis', 0, t.hummingAt);
  const s = r.sources ?? {};
  num(s.flashlight, 'sources.flashlight');
  num(s.electronicEach, 'sources.electronicEach');
  num(s.anomalyAtFull, 'sources.anomalyAtFull');
  num(s.monolith?.near, 'sources.monolith.near');
  num(s.monolith.radius, 'sources.monolith.radius', 1);
  num(r.riseRate, 'riseRate', 0.001);
  num(r.fallRate, 'fallRate', 0.001);
  num(r.totemDampening, 'totemDampening', 0, 1);
  if (typeof r.totemItem !== 'string') throw new Error('Resonance: tuning.resonance.totemItem must be an item id');
  const d = r.detectionMultiplier ?? {};
  for (const k of TIERS) num(d[k], `detectionMultiplier.${k}`, 0);
  const p = r.pulse ?? {};
  num(p.baseSeconds, 'pulse.baseSeconds', 0.1);
  num(p.weakExtraSeconds, 'pulse.weakExtraSeconds');
  num(p.speedAtMax, 'pulse.speedAtMax');
  return Object.freeze({
    max, hummingAt: t.hummingAt, agitatedAt: t.agitatedAt, hysteresis: t.hysteresis,
    flashlight: s.flashlight, electronicEach: s.electronicEach, anomalyAtFull: s.anomalyAtFull,
    monolithNear: s.monolith.near, monolithRadius: s.monolith.radius,
    risePerTick: r.riseRate * DT, fallPerTick: r.fallRate * DT,
    totemDampening: r.totemDampening, totemItem: r.totemItem,
    detection: Object.freeze({ ...d }),
    pulseBase: p.baseSeconds, pulseWeakExtra: p.weakExtraSeconds, pulseSpeedAtMax: p.speedAtMax,
  });
}

/**
 * The tier of a value with no history (the spec's table: 0-30 Quiet, 31-69 Humming, 70-100 Agitated).
 * @param {number} value
 * @param {{ hummingAt: number, agitatedAt: number }} cfg resonanceConfig(...)
 */
export function tierOf(value, cfg) {
  if (value >= cfg.agitatedAt) return 'agitated';
  if (value >= cfg.hummingAt) return 'humming';
  return 'quiet';
}

/**
 * The tier after `prev` given the value: up at once, down only `hysteresis` below the threshold.
 * @param {number} value
 * @param {'quiet'|'humming'|'agitated'} prev
 * @param {ReturnType<typeof resonanceConfig>} cfg
 */
export function nextTier(value, prev, cfg) {
  const plain = tierOf(value, cfg);
  if (RANK[plain] >= RANK[prev]) return plain;
  // falling: stay in a tier until the value is clearly below its threshold
  const h = cfg.hysteresis;
  if (prev === 'agitated' && value >= cfg.agitatedAt - h) return 'agitated';
  if (RANK[prev] >= 1 && value >= cfg.hummingAt - h) return 'humming';
  return plain;
}

/**
 * Where each anomaly zone pulses from: the monolith inside it nearest its centre, else the centre of its
 * bounding box. Zones sharing an origin (a halo around a core) pulse as one, the strongest.
 * Built once per map (a one-off query over each zone's rectangle), never per tick.
 * @param {import('./IslandMap.js').IslandMap|null} map
 * @returns {Array<{ id: string, x: number, y: number, strength: number }>}
 */
export function pulseOrigins(map) {
  if (!map) return [];
  const out = [];
  const scratch = [];
  const zones = [...map.anomalyZones].sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
  for (const z of zones) {
    const cx = (z.minX + z.maxX) / 2;
    const cy = (z.minY + z.maxY) / 2;
    let best = null;
    let bestD = Infinity;
    for (const p of map.propsInRect(z.minX, z.minY, z.maxX, z.maxY, scratch)) {
      if (p.kind !== 'monolith') continue;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = dx * dx + dy * dy;
      if (d < bestD && map.anomalyAt(p.x, p.y) > 0) { bestD = d; best = p; }
    }
    const x = best ? best.x : Math.round(cx);
    const y = best ? best.y : Math.round(cy);
    if (out.some((o) => o.x === x && o.y === y)) continue;   // a weaker zone around the same heart
    out.push({ id: z.id, x, y, strength: z.strength });
  }
  return out;
}

export class Resonance {
  /**
   * @param {Object} tuning the whole tuning object
   * @param {import('./IslandMap.js').IslandMap|null} [map]
   */
  constructor(tuning, map = null) {
    this.cfg = resonanceConfig(tuning);
    /** 0..max */
    this.value = 0;
    /** the level the sources call for this tick */
    this.target = 0;
    /** @type {'quiet'|'humming'|'agitated'} */
    this.tier = 'quiet';
    /** what made the target, recomputed each tick (not state) */
    this.sources = emptySources();
    /** a pin from force(): the value held, and ticks left (-1 = until release) */
    this.forcedValue = 0;
    this.forcedTicks = 0;
    /** per anomaly zone: where it pulses from, its interval in seconds, progress towards the next pulse, last pulse tick */
    this.pulses = pulseOrigins(map).map((o, i) => {
      const interval = this.cfg.pulseBase + (1 - o.strength) * this.cfg.pulseWeakExtra;
      // spread the first pulses with a fixed fraction per zone (golden ratio), no rng: the stream stays the world's
      const f = (i * 0.6180339887) % 1;
      return { ...o, interval, phase: interval * f, last: -1 };
    });
    this.scratch = [];
  }

  /** scout detection radius factor for the current tier (spec: +20% when Humming) */
  get detectionMultiplier() {
    return this.cfg.detection[this.tier];
  }

  /** Agitated: nearby scouts escalate from INVESTIGATE straight to ALERT (spec §6.3) */
  get escalate() {
    return this.tier === 'agitated';
  }

  /** Agitated: Shifting Paths may reset the fog (FogOfWar applies the region rule) */
  get shiftingPaths() {
    return this.tier === 'agitated';
  }

  /** the value is pinned by force() */
  get forced() {
    return this.forcedTicks !== 0;
  }

  /**
   * Pin the value (scripted moments: the Signal Peak climax spikes it to 100).
   * @param {number} value 0..max
   * @param {number} [seconds] how long; Infinity (default) until release()
   */
  force(value, seconds = Infinity) {
    if (!Number.isFinite(value)) throw new TypeError(`Resonance.force: expected a number, got ${value}`);
    if (!(seconds > 0)) throw new TypeError(`Resonance.force: seconds must be > 0, got ${seconds}`);
    this.forcedValue = Math.max(0, Math.min(this.cfg.max, value));
    this.forcedTicks = seconds === Infinity ? -1 : Math.max(1, Math.round(seconds * TICK_HZ));
    this.value = this.forcedValue;
  }

  /** end a pin now; the value then follows its sources again */
  release() {
    this.forcedTicks = 0;
  }

  /**
   * Debug and tools only: put the value somewhere now (it then moves towards the target as usual). The tier
   * follows at once, without hysteresis; the change is announced on the next step.
   */
  setValue(value) {
    if (!Number.isFinite(value)) throw new TypeError(`Resonance.setValue: expected a number, got ${value}`);
    this.value = Math.max(0, Math.min(this.cfg.max, value));
  }

  /**
   * The sources for the player where they stand now, into this.sources; returns the target.
   * @param {Object} sim
   */
  measure(sim) {
    const c = this.cfg;
    const s = this.sources;
    const p = sim.player;
    s.flashlight = flashlightOn(sim) ? c.flashlight : 0;
    const el = activeElectronics(sim);
    s.electronics = el.length * c.electronicEach;
    s.electronicIds = el;
    const map = sim.map;
    s.anomaly = map ? c.anomalyAtFull * map.anomalyAt(p.x, p.y) : 0;
    s.monolith = c.monolithNear > 0 ? c.monolithNear * this.monolithCloseness(sim, p.x, p.y) : 0;
    s.raw = s.flashlight + s.electronics + s.anomaly + s.monolith;
    s.totem = carries(sim, c.totemItem);
    const capped = s.raw < c.max ? s.raw : c.max;
    s.dampened = s.totem ? capped * c.totemDampening : 0;
    return capped - s.dampened;
  }

  /** 0..1: 1 standing on a monolith, falling linearly to 0 at sources.monolith.radius; nearest monolith only */
  monolithCloseness(sim, x, y) {
    const r = this.cfg.monolithRadius;
    const list = sim.map ? sim.map.propsNear(x, y, r, this.scratch) : sim.props ?? [];
    let best = r * r;
    let found = false;
    for (const pr of list) {
      if (pr.kind !== 'monolith') continue;
      const dx = pr.x - x;
      const dy = pr.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= best) { best = d2; found = true; }
    }
    return found ? 1 - Math.sqrt(best) / r : 0;
  }

  /**
   * Advance one tick (after the player has moved and switched lights).
   * @param {Object} sim the Sim (player, map, props, inventory, tick)
   * @param {Array<Object>} events this step's events
   */
  step(sim, events) {
    const c = this.cfg;
    this.target = this.measure(sim);
    if (this.forcedTicks !== 0) {
      this.value = this.forcedValue;
      if (this.forcedTicks > 0) this.forcedTicks--;
    } else if (this.value < this.target) {
      this.value = this.value + c.risePerTick < this.target ? this.value + c.risePerTick : this.target;
    } else if (this.value > this.target) {
      this.value = this.value - c.fallPerTick > this.target ? this.value - c.fallPerTick : this.target;
    }
    const tier = nextTier(this.value, this.tier, c);
    if (tier !== this.tier) {
      events.push({ type: 'resonance_tier', from: this.tier, to: tier, value: this.value });
      this.tier = tier;
    }
    this.stepPulses(sim.tick + 1, events);
  }

  /** the anomaly zones' pulse timers: each zone pulses every `interval` s, sped up by (1 + speedAtMax x value/max) */
  stepPulses(tick, events) {
    const speed = DT * (1 + this.cfg.pulseSpeedAtMax * (this.value / this.cfg.max));
    for (const z of this.pulses) {
      z.phase += speed;
      if (z.phase >= z.interval) {
        z.phase -= z.interval;
        z.last = tick;
        events.push({ type: 'anomaly_pulse', id: z.id, x: z.x, y: z.y, strength: z.strength, resonance: this.value });
      }
    }
  }

  /** seconds between two pulses of a zone of this strength at this Resonance (for tests, debug and audio) */
  pulseInterval(strength, value = this.value) {
    const base = this.cfg.pulseBase + (1 - strength) * this.cfg.pulseWeakExtra;
    return base / (1 + this.cfg.pulseSpeedAtMax * (value / this.cfg.max));
  }

  /** @returns {Object} plain JSON */
  snapshot() {
    return {
      value: this.value, target: this.target, tier: this.tier, forcedValue: this.forcedValue, forcedTicks: this.forcedTicks,
      pulses: this.pulses.map((z) => ({ id: z.id, phase: z.phase, last: z.last })),
    };
  }

  /**
   * @param {Object} snap from snapshot()
   * @param {Object} tuning
   * @param {import('./IslandMap.js').IslandMap|null} map
   */
  static restore(snap, tuning, map = null) {
    const r = new Resonance(tuning, map);
    r.value = snap.value;
    r.target = snap.target;
    r.tier = TIERS.includes(snap.tier) ? snap.tier : tierOf(snap.value, r.cfg);
    r.forcedValue = snap.forcedValue ?? 0;
    r.forcedTicks = snap.forcedTicks ?? 0;
    const byId = new Map((snap.pulses ?? []).map((p) => [p.id, p]));
    for (const z of r.pulses) {
      const s = byId.get(z.id);
      if (s) { z.phase = s.phase; z.last = s.last; }
    }
    return r;
  }
}

function emptySources() {
  return { flashlight: 0, electronics: 0, electronicIds: [], anomaly: 0, monolith: 0, raw: 0, totem: false, dampened: 0 };
}
