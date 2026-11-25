// The world's clocks and sky (spec §5.2): the tide, the day and night, and the weather. Simulation side: stepped
// once per tick by Sim.step, DOM-free, and deterministic in Node and every browser.
//
// Everything is counted in whole ticks and every derived number (tide height, daylight, squall intensity, the
// gameplay multipliers) is a getter computed from those counters with plain arithmetic, so nothing drifts and the
// snapshot holds only integers plus a couple of wind floats. The tide's sine is a polynomial written out here,
// never Math.sin (CLAUDE.md: its last bits differ between engines and the tide state branches on it).
//
// Readers (stealth, Resonance, AI sightlines, the HUD, the music director, lighting and sway, saves) use:
//   tide     tideHeight 0..1, tidePhase 0..1 (0 = low, 0.5 = high), tideRising, tideState, timeToNext('low'|'high'),
//            cycleCount
//   day      timeOfDay 0..24 h, day (1 on the first day), dayPhase, daylight 0..1, moonlight 0..1
//   weather  weather.kind, weather.intensity 0..1, weather.timeLeft s, windStrength 0..1, and the derived
//            noiseMultiplier, visibilityMultiplier, moveMultiplier (1 when clear)
// Events pushed into sim.events: tide_state, day_phase, new_day, weather_start, weather_end.
// The set* / startSquall / clearWeather / setFastTide methods are for debug cheats and tools only.
import { TICK_HZ } from '../sim/constants.js';

export const TIDE_STATES = Object.freeze(['low', 'rising', 'high', 'falling']);
export const DAY_PHASES = Object.freeze(['night', 'dawn', 'day', 'dusk']);
export const WEATHER_KINDS = Object.freeze(['clear', 'squall']);

const HALF_PI = Math.PI / 2;
// Taylor coefficients of sin up to x^13; the series ends on a positive term, so on [0, pi/2] the polynomial is
// never below sin and its derivative never below cos (>= 0): the tide is monotonic on each half cycle.
const S3 = -1 / 6;
const S5 = 1 / 120;
const S7 = -1 / 5040;
const S9 = 1 / 362880;
const S11 = -1 / 39916800;
const S13 = 1 / 6227020800;

/**
 * sin(x) for x in [0, pi/2] in plain arithmetic (Horner form), so it is bit-identical in every JS engine.
 * Error below 1e-9 on the interval.
 * @param {number} x
 * @returns {number}
 */
export function sinQuarter(x) {
  const x2 = x * x;
  return x * (1 + x2 * (S3 + x2 * (S5 + x2 * (S7 + x2 * (S9 + x2 * (S11 + x2 * S13))))));
}

/**
 * Tide height for a tick inside the cycle: sin^2(pi * t / period) = (1 - cos(2 pi t / period)) / 2, a sine wave
 * from 0 (t = 0, low water) to 1 (t = period / 2, high water) and back. Symmetric: t and period - t give the
 * same height exactly.
 * @param {number} t integer tick in [0, period)
 * @param {number} period ticks per cycle (even)
 * @returns {number} 0..1
 */
export function tideHeightAt(t, period) {
  const u = t <= period - t ? t : period - t;   // fold onto the rising half
  const s = sinQuarter((u / period) * Math.PI);
  const h = s * s;
  return h > 1 ? 1 : h < 0 ? 0 : h;
}

/** 0 at a, 1 at b, smooth (3t^2 - 2t^3) in between */
function smoothstep(a, b, v) {
  if (v <= a) return 0;
  if (v >= b) return 1;
  const t = (v - a) / (b - a);
  return t * t * (3 - 2 * t);
}

const sec = (s) => Math.round(s * TICK_HZ);
const mod = (a, n) => ((a % n) + n) % n;

function num(v, what, { min = 0, max = Infinity, strict = false } = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v) || (strict ? v <= min : v < min) || v > max) {
    throw new Error(`WorldState: tuning.${what} must be a number ${strict ? '>' : '>='} ${min}${max < Infinity ? ` and <= ${max}` : ''} (got ${JSON.stringify(v)})`);
  }
  return v;
}

function range(v, what, min = 0) {
  if (!Array.isArray(v) || v.length !== 2) throw new Error(`WorldState: tuning.${what} must be [min, max]`);
  num(v[0], `${what}[0]`, { min });
  num(v[1], `${what}[1]`, { min: v[0] });
  return v;
}

/**
 * Check tuning.world and tuning.water and turn seconds into ticks.
 * @param {Object} tuning the whole tuning object
 * @returns {Object} frozen config in ticks
 */
export function worldConfig(tuning) {
  const w = tuning?.world;
  if (!w) throw new Error('WorldState: tuning.world is missing');
  const { tide, day, weather } = w;
  const periodTicks = sec(num(tide?.periodSeconds, 'world.tide.periodSeconds', { strict: true }));
  if (periodTicks % 2 || periodTicks < 4) throw new Error('WorldState: world.tide.periodSeconds must give an even number of ticks');
  const fastTicks = sec(num(tide.debugFastPeriodSeconds, 'world.tide.debugFastPeriodSeconds', { strict: true }));
  if (fastTicks % 2 || fastTicks < 4) throw new Error('WorldState: world.tide.debugFastPeriodSeconds must give an even number of ticks');
  num(tide.startPhase, 'world.tide.startPhase', { max: 1 });
  num(tide.lowBelow, 'world.tide.lowBelow', { max: 1 });
  num(tide.highAbove, 'world.tide.highAbove', { min: tide.lowBelow, strict: true, max: 1 });

  const dayTicks = sec(num(day?.lengthSeconds, 'world.day.lengthSeconds', { strict: true }));
  num(day.startHour, 'world.day.startHour', { max: 24 });
  num(day.dawnStart, 'world.day.dawnStart', { max: 24 });
  num(day.dawnEnd, 'world.day.dawnEnd', { min: day.dawnStart, strict: true, max: 24 });
  num(day.duskStart, 'world.day.duskStart', { min: day.dawnEnd, max: 24 });
  num(day.duskEnd, 'world.day.duskEnd', { min: day.duskStart, strict: true, max: 24 });
  num(day.moonCycleDays, 'world.day.moonCycleDays', { strict: true });
  num(day.moonStartPhase, 'world.day.moonStartPhase', { max: 1 });
  num(day.moonlightMin, 'world.day.moonlightMin', { max: 1 });
  num(day.moonlightMax, 'world.day.moonlightMax', { min: day.moonlightMin, max: 1 });

  num(weather?.firstSquallSeconds, 'world.weather.firstSquallSeconds', { strict: true });
  range(weather.clearSeconds, 'world.weather.clearSeconds', 1);
  range(weather.squallSeconds, 'world.weather.squallSeconds', 1);
  num(weather.rampInSeconds, 'world.weather.rampInSeconds', { strict: true });
  num(weather.rampOutSeconds, 'world.weather.rampOutSeconds', { strict: true });
  if (weather.squallSeconds[0] < weather.rampInSeconds + weather.rampOutSeconds) {
    throw new Error('WorldState: world.weather.squallSeconds[0] must cover rampInSeconds + rampOutSeconds');
  }
  const sq = weather.squall ?? {};
  for (const k of ['noiseMultiplier', 'visibilityMultiplier', 'moveMultiplier']) num(sq[k], `world.weather.squall.${k}`, { max: 1 });
  const wind = weather.wind ?? {};
  num(wind.calm, 'world.weather.wind.calm', { max: 1 });
  num(wind.squall, 'world.weather.wind.squall', { max: 1 });
  num(wind.gustAmplitude, 'world.weather.wind.gustAmplitude', { max: 1 });
  num(wind.gustRate, 'world.weather.wind.gustRate', { strict: true });
  range(wind.gustSeconds, 'world.weather.wind.gustSeconds', 1 / TICK_HZ);

  const water = tuning.water;
  num(water?.wetMargin, 'water.wetMargin', { max: 1 });
  num(water.deepMargin, 'water.deepMargin', { strict: true, max: 1 });

  const hour = (h) => Math.round((h / 24) * dayTicks);
  return Object.freeze({
    periodTicks, fastTicks, startPhase: tide.startPhase, lowBelow: tide.lowBelow, highAbove: tide.highAbove,
    dayTicks, startTick: mod(hour(day.startHour), dayTicks),
    dawnStart: hour(day.dawnStart), dawnEnd: hour(day.dawnEnd), duskStart: hour(day.duskStart), duskEnd: hour(day.duskEnd),
    dawnStartH: day.dawnStart, dawnEndH: day.dawnEnd, duskStartH: day.duskStart, duskEndH: day.duskEnd,
    moonCycleDays: day.moonCycleDays, moonStartPhase: day.moonStartPhase, moonlightMin: day.moonlightMin, moonlightMax: day.moonlightMax,
    firstSquallTicks: sec(weather.firstSquallSeconds),
    clearTicks: [sec(weather.clearSeconds[0]), sec(weather.clearSeconds[1])],
    squallTicks: [sec(weather.squallSeconds[0]), sec(weather.squallSeconds[1])],
    rampInTicks: sec(weather.rampInSeconds), rampOutTicks: sec(weather.rampOutSeconds),
    squall: Object.freeze({ noise: sq.noiseMultiplier, visibility: sq.visibilityMultiplier, move: sq.moveMultiplier }),
    wind: Object.freeze({
      calm: wind.calm, squall: wind.squall, gustAmplitude: wind.gustAmplitude, gustStep: wind.gustRate / TICK_HZ,
      gustTicks: [Math.max(1, sec(wind.gustSeconds[0])), Math.max(1, sec(wind.gustSeconds[1]))],
    }),
    water: Object.freeze({ wetMargin: water.wetMargin, deepMargin: water.deepMargin }),
  });
}

/** a duration in whole ticks drawn from [lo, hi] */
const drawTicks = (rng, [lo, hi]) => lo + Math.floor(rng.next() * (hi - lo + 1));

export class WorldState {
  /**
   * The world at the start of a new game. Takes no randomness: the first squall is at a fixed time, so a new
   * game never depends on the seed for its sky.
   * @param {Object} tuning the whole tuning object (reads tuning.world and tuning.water)
   */
  constructor(tuning) {
    /** @type {ReturnType<typeof worldConfig>} */
    this.cfg = worldConfig(tuning);
    const c = this.cfg;
    /** debug fast tide: the period in ticks while it is on, else null (tuning's period) */
    this.periodOverride = null;
    /** tick inside the tide cycle, 0 = low water, period/2 = high water */
    this.tideTick = mod(Math.round(c.startPhase * c.periodTicks), c.periodTicks);
    /** low waters passed since the game began */
    this.cycleCount = 0;
    /** tick inside the day, 0 = midnight */
    this.dayTick = c.startTick;
    /** day number, 1 on the first day; goes up at midnight */
    this.day = 1;
    /** squall state; ticksLeft counts down to the next change (end of the clear spell or of the squall) */
    this.weatherKind = 'clear';
    this.weatherTicks = c.firstSquallTicks;   // length of the current spell
    this.weatherTicksLeft = c.firstSquallTicks;
    /** wind gust: current offset, the offset it eases towards, ticks until a new target is drawn */
    this.gust = 0;
    this.gustTarget = 0;
    this.gustTicksLeft = c.wind.gustTicks[0];
    /** states last announced by an event (a transition is a change of these) */
    this.lastTideState = this.tideState;
    this.lastDayPhase = this.dayPhase;
  }

  // ---- tide ---------------------------------------------------------------------------------------------------

  /** ticks per tide cycle right now */
  get tidePeriod() {
    return this.periodOverride ?? this.cfg.periodTicks;
  }

  /** 0..1 through the cycle: 0 low water, 0.5 high water */
  get tidePhase() {
    return this.tideTick / this.tidePeriod;
  }

  /** 0 (lowest) .. 1 (highest): what IslandMap.isFlooded takes */
  get tideHeight() {
    return tideHeightAt(this.tideTick, this.tidePeriod);
  }

  /** true on the way from low to high water (low water itself counts as rising) */
  get tideRising() {
    return this.tideTick < this.tidePeriod / 2;
  }

  /** 'low' | 'rising' | 'high' | 'falling', by tuning.world.tide.lowBelow / highAbove */
  get tideState() {
    const h = this.tideHeight;
    if (h <= this.cfg.lowBelow) return 'low';
    if (h >= this.cfg.highAbove) return 'high';
    return this.tideRising ? 'rising' : 'falling';
  }

  /**
   * Seconds until the tide next reaches low or high water (always in the future: at low water itself the next
   * low is a whole period away).
   * @param {'low'|'high'} which
   */
  timeToNext(which) {
    const P = this.tidePeriod;
    let target;
    if (which === 'low') target = 0;
    else if (which === 'high') target = P / 2;
    else throw new Error(`WorldState.timeToNext: expected 'low' or 'high', got ${which}`);
    return (mod(target - this.tideTick - 1, P) + 1) / TICK_HZ;
  }

  /** seconds per full tide cycle right now */
  get tidePeriodSeconds() {
    return this.tidePeriod / TICK_HZ;
  }

  // ---- day ------------------------------------------------------------------------------------------------------

  /** hours since midnight, 0..24 */
  get timeOfDay() {
    return (this.dayTick / this.cfg.dayTicks) * 24;
  }

  /** 'night' | 'dawn' | 'day' | 'dusk' */
  get dayPhase() {
    const t = this.dayTick;
    const c = this.cfg;
    if (t < c.dawnStart || t >= c.duskEnd) return 'night';
    if (t < c.dawnEnd) return 'dawn';
    if (t < c.duskStart) return 'day';
    return 'dusk';
  }

  /** 0 at night, 1 by day, smooth ramps through dawn and dusk */
  get daylight() {
    const h = this.timeOfDay;
    const c = this.cfg;
    return Math.min(smoothstep(c.dawnStartH, c.dawnEndH, h), 1 - smoothstep(c.duskStartH, c.duskEndH, h));
  }

  /** 0..1 through the moon's cycle (0.5 = full), continuous across days */
  get moonPhase() {
    const days = this.day - 1 + this.dayTick / this.cfg.dayTicks;
    const f = days / this.cfg.moonCycleDays + this.cfg.moonStartPhase;
    return f - Math.floor(f);
  }

  /** the moon's light: small, larger near full moon, and only when the sun is down */
  get moonlight() {
    const fullness = 1 - Math.abs(2 * this.moonPhase - 1);
    const c = this.cfg;
    return (c.moonlightMin + (c.moonlightMax - c.moonlightMin) * fullness) * (1 - this.daylight);
  }

  // ---- weather --------------------------------------------------------------------------------------------------

  /** squall strength 0..1: ramps in over rampInSeconds from its start and out over rampOutSeconds before its end */
  get weatherIntensity() {
    if (this.weatherKind !== 'squall') return 0;
    const c = this.cfg;
    const elapsed = this.weatherTicks - this.weatherTicksLeft;
    return Math.min(1, elapsed / c.rampInTicks, this.weatherTicksLeft / c.rampOutTicks);
  }

  /** { kind, intensity, timeLeft }: timeLeft is seconds until the weather next changes */
  get weather() {
    return { kind: this.weatherKind, intensity: this.weatherIntensity, timeLeft: this.weatherTicksLeft / TICK_HZ };
  }

  /** 0..1, gusting around a base that rises with the squall; what foliage sway reads */
  get windStrength() {
    const w = this.cfg.wind;
    const v = w.calm + (w.squall - w.calm) * this.weatherIntensity + this.gust;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  /** footstep noise factor: 1 clear, tuning's squall value (0.5, spec §5.2) in a full squall */
  get noiseMultiplier() {
    return 1 + (this.cfg.squall.noise - 1) * this.weatherIntensity;
  }

  /** sight range factor for watchers: 1 clear, lower in a squall */
  get visibilityMultiplier() {
    return 1 + (this.cfg.squall.visibility - 1) * this.weatherIntensity;
  }

  /** movement speed factor: 1 clear, slightly lower in a squall */
  get moveMultiplier() {
    return 1 + (this.cfg.squall.move - 1) * this.weatherIntensity;
  }

  /** what IslandMap/water queries need besides the tide height */
  get waterConfig() {
    return this.cfg.water;
  }

  // ---- step -----------------------------------------------------------------------------------------------------

  /**
   * Advance one tick.
   * @param {import('../sim/rng.js').Rng} rng the sim's generator (squall timing and wind gusts)
   * @param {Array<object>} events the step's event list
   */
  step(rng, events) {
    const P = this.tidePeriod;
    if (++this.tideTick >= P) { this.tideTick = 0; this.cycleCount++; }

    if (++this.dayTick >= this.cfg.dayTicks) {
      this.dayTick = 0;
      this.day++;
      events.push({ type: 'new_day', day: this.day });
    }

    this.stepWeather(rng, events);
    this.stepWind(rng);
    this.announce(events);
  }

  stepWeather(rng, events) {
    if (--this.weatherTicksLeft > 0) return;
    const c = this.cfg;
    if (this.weatherKind === 'clear') {
      this.weatherKind = 'squall';
      this.weatherTicks = this.weatherTicksLeft = drawTicks(rng, c.squallTicks);
      events.push({ type: 'weather_start', kind: 'squall', duration: this.weatherTicks / TICK_HZ });
    } else {
      events.push({ type: 'weather_end', kind: this.weatherKind });
      this.weatherKind = 'clear';
      this.weatherTicks = this.weatherTicksLeft = drawTicks(rng, c.clearTicks);
    }
  }

  stepWind(rng) {
    const w = this.cfg.wind;
    if (--this.gustTicksLeft <= 0) {
      // stronger gusts in a squall
      this.gustTarget = (rng.next() * 2 - 1) * w.gustAmplitude * (1 + this.weatherIntensity);
      this.gustTicksLeft = drawTicks(rng, w.gustTicks);
    }
    const d = this.gustTarget - this.gust;
    this.gust = d > w.gustStep ? this.gust + w.gustStep : d < -w.gustStep ? this.gust - w.gustStep : this.gustTarget;
  }

  /** push tide_state / day_phase events for states that changed since they were last announced */
  announce(events) {
    const ts = this.tideState;
    if (ts !== this.lastTideState) {
      events.push({ type: 'tide_state', state: ts, prev: this.lastTideState });
      this.lastTideState = ts;
    }
    const dp = this.dayPhase;
    if (dp !== this.lastDayPhase) {
      events.push({ type: 'day_phase', phase: dp, prev: this.lastDayPhase });
      this.lastDayPhase = dp;
    }
  }

  // ---- debug and tools only -------------------------------------------------------------------------------------
  // Gameplay never calls these. Changed states are announced by the next step's events.

  /** @param {number} phase 0..1 through the cycle (0 low water, 0.5 high water); wraps */
  setTidePhase(phase) {
    if (!Number.isFinite(phase)) throw new TypeError(`setTidePhase: expected a number, got ${phase}`);
    const P = this.tidePeriod;
    this.tideTick = mod(Math.round(mod(phase, 1) * P), P);
  }

  /** @param {boolean} on run the tide at tuning.world.tide.debugFastPeriodSeconds per cycle, keeping its phase */
  setFastTide(on) {
    const phase = this.tidePhase;
    this.periodOverride = on ? this.cfg.fastTicks : null;
    this.setTidePhase(phase);
  }

  get fastTide() {
    return this.periodOverride !== null;
  }

  /** @param {number} hour 0..24 (wraps); the day number is unchanged */
  setTimeOfDay(hour) {
    if (!Number.isFinite(hour)) throw new TypeError(`setTimeOfDay: expected a number, got ${hour}`);
    const D = this.cfg.dayTicks;
    this.dayTick = mod(Math.round((mod(hour, 24) / 24) * D), D);
  }

  /**
   * Start a squall now, of the middle length of tuning's range (no randomness, so the rng stream is untouched).
   * @param {{ instant?: boolean }} [opts] instant: skip the ramp in (full intensity at once)
   */
  startSquall({ instant = false } = {}) {
    const c = this.cfg;
    this.weatherKind = 'squall';
    this.weatherTicks = Math.round((c.squallTicks[0] + c.squallTicks[1]) / 2);
    this.weatherTicksLeft = instant ? this.weatherTicks - c.rampInTicks : this.weatherTicks;
  }

  /** end the weather now: clear sky for the middle length of tuning's clear range */
  clearWeather() {
    const c = this.cfg;
    this.weatherKind = 'clear';
    this.weatherTicks = this.weatherTicksLeft = Math.round((c.clearTicks[0] + c.clearTicks[1]) / 2);
  }

  // ---- snapshot -------------------------------------------------------------------------------------------------

  /** @returns {Object} plain JSON */
  snapshot() {
    return {
      tideTick: this.tideTick, periodOverride: this.periodOverride, cycleCount: this.cycleCount,
      dayTick: this.dayTick, day: this.day,
      weather: { kind: this.weatherKind, ticks: this.weatherTicks, ticksLeft: this.weatherTicksLeft },
      wind: { gust: this.gust, target: this.gustTarget, ticksLeft: this.gustTicksLeft },
      announced: { tide: this.lastTideState, day: this.lastDayPhase },
    };
  }

  /**
   * @param {Object} snap from snapshot()
   * @param {Object} tuning
   * @returns {WorldState}
   */
  static restore(snap, tuning) {
    const w = new WorldState(tuning);
    w.periodOverride = snap.periodOverride ?? null;
    w.tideTick = snap.tideTick;
    w.cycleCount = snap.cycleCount;
    w.dayTick = snap.dayTick;
    w.day = snap.day;
    w.weatherKind = snap.weather.kind;
    w.weatherTicks = snap.weather.ticks;
    w.weatherTicksLeft = snap.weather.ticksLeft;
    w.gust = snap.wind.gust;
    w.gustTarget = snap.wind.target;
    w.gustTicksLeft = snap.wind.ticksLeft;
    w.lastTideState = snap.announced.tide;
    w.lastDayPhase = snap.announced.day;
    return w;
  }

  /**
   * The world of a snapshot made before the world existed (snapshot version 2): the clocks are where a new game's
   * would be after `tick` ticks; the weather is a new game's (its rng draws cannot be replayed).
   * @param {number} tick
   * @param {Object} tuning
   * @returns {WorldState}
   */
  static atTick(tick, tuning) {
    const w = new WorldState(tuning);
    const t = w.tideTick + tick;
    w.tideTick = t % w.cfg.periodTicks;
    w.cycleCount = Math.floor(t / w.cfg.periodTicks);
    const d = w.dayTick + tick;
    w.dayTick = d % w.cfg.dayTicks;
    w.day = 1 + Math.floor(d / w.cfg.dayTicks);
    w.weatherTicksLeft = Math.max(1, w.weatherTicksLeft - tick);
    w.lastTideState = w.tideState;
    w.lastDayPhase = w.dayPhase;
    return w;
  }
}
