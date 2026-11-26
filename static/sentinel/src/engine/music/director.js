// The music director's rules (step Mu3): a pure function from a small game-state record to a declarative mix.
// No audio here and no clock: MusicDirector.js applies mixes to the engine, ThreatTracker below smooths the scouts'
// state with an explicit clock, and gameAudioState.js builds the record from the simulation.
//
// The rules follow data/music/README.md (the composer's notes). Where the README leaves a choice, it is made here:
//
// - Signal Peak (before the holdout) plays the coast pair with only its "always" layers: the summit is bare rock
//   above the sea, the coast material is the island's "open air" music, it shares the 4 s bar (the tension can join
//   it), and its A dorian/aeolian sits a fifth above the holdout's D phrygian, so the holdout's entry does not clash.
// - Open sea / swimming far out: the coast pair thinned to its "always" layers at gain 0.6.
// - Region tracks are crossfaded day/night with an equal-power law on `daylight` (quantised to 0.05 so a slow dawn
//   moves the faders in a few dozen steps, not every frame). At the ends only one coast track plays.
// - The Resonance colours every region (not only the Meridian), scaled within its tier by `value`:
//   humming detune -4..-8 cents, reverb 1..1.2; agitated detune -8..-25, brightness +300..+600, reverb 0.9..0.8.
//   In the Meridian the README's tier table is used exactly (quiet: brightness -600 and reverb 1.4: the near-silence).
//   During the holdout and on the title, endings and game over the params are neutral (0, 0, 1): those cues carry
//   their own colour.
// - A gentle low-pass on the whole music bus (`tone`, Hz) is the Resonance hum "ducking the high end": open at
//   quiet, 16 kHz..12 kHz humming, 12 kHz..9 kHz agitated. Under the Journal/pause the music is also muffled (3 kHz).
// - Optional layers: on by default; off in a squall (weatherIntensity >= squallThin), off under WARN/CHASE. Extra
//   per-track choices: coast `low` off when the surf is loud (high tide or wind > 0.6 on the coast and cove);
//   coast_day `buoy` off at night-ish light (< 0.35); marek `unease` off while Marek talks; jungle `heart` only under
//   a threat or at night, `insects` at 0.5 by day; reef `undertow` off at low tide (the sea has gone out).
// - Squalls also lower the region track (1 - 0.25 x intensity): the rain is loud.
// - Ducking (`duck`, applied on a gain after the engine, not on the track faders): dialogue 0.55, Journal/pause 0.4.
// - Tension (README table) over any region track except the holdout; the region at 0.7 under WARN and CHASE.
// - Game over: `gameover` one-shot, cut in at once (fade 0.3, not quantised), everything else fades in 0.8 s.
//   Endings: `ending_dinghy` / `ending_rescue`, fade 1.5, quantised. Title: `title`.
//
// Hook names other steps use (see GameAudio.js): audio.setScreen('title'|'game'|'gameover'|'ending_dinghy'|
// 'ending_rescue'), audio.holdout.start() / .stop() (the state record's `holdout.elapsed` steps s1..s4 at 0/15/30/45 s),
// audio.volume.get/set/mute.

export const SCREENS = Object.freeze(['title', 'game', 'gameover', 'ending_dinghy', 'ending_rescue']);
export const REGIONS = Object.freeze(['southern_cove', 'coast', 'western_mangroves', 'reef', 'shipwreck', 'interior_jungle',
  'quiet_meridian', 'signal_peak', 'open_sea']);
export const THREATS = Object.freeze(['none', 'search', 'investigate', 'warn', 'chase']);
/** escalation order: higher wins at once, lower waits for the hold (ThreatTracker) */
export const THREAT_RANK = Object.freeze({ none: 0, search: 1, investigate: 2, warn: 3, chase: 4 });
export const TIERS = Object.freeze(['quiet', 'humming', 'agitated']);
export const DAY_PHASES = Object.freeze(['night', 'dawn', 'day', 'dusk']);
export const TIDES = Object.freeze(['low', 'rising', 'high', 'falling']);

/** README "Region tracks": the layers always on and the ones the director may drop */
export const REGION_LAYERS = Object.freeze({
  coast_day: { always: ['bed', 'swell', 'glints'], optional: ['low', 'buoy'] },
  coast_night: { always: ['bed', 'swell', 'stars'], optional: ['low', 'insects'] },
  mangroves: { always: ['murk', 'mud', 'drips'], optional: ['frogs', 'mist'] },
  marek: { always: ['guitar', 'warmth'], optional: ['musicbox', 'unease', 'creak'] },
  jungle: { always: ['canopy', 'marimba', 'knocks'], optional: ['insects', 'heart', 'low'] },
  reef: { always: ['hull', 'metal', 'pings'], optional: ['creaks', 'undertow'] },
});

/** README "The Quiet Meridian": tier -> layers at gain 1 (others 0) and the global params */
export const MERIDIAN_LAYERS = Object.freeze(['q_bell', 'q_air', 'h_drone', 'h_choir', 'h_bells', 'a_cluster', 'a_bells', 'a_pulse']);
export const MERIDIAN_TIERS = Object.freeze({
  quiet: { layers: ['q_bell', 'q_air'], detune: 0, brightness: -600, reverb: 1.4 },
  humming: { layers: ['q_bell', 'q_air', 'h_drone', 'h_choir', 'h_bells'], detune: -8, brightness: 0, reverb: 1.2 },
  agitated: { layers: MERIDIAN_LAYERS, detune: -25, brightness: 600, reverb: 0.8, choirDetune: 18 },
});

/** README "Stealth tension": highest scout state -> tension layers at gain 1 (others 0) */
export const TENSION_LAYERS = Object.freeze(['watched', 'warned', 'hunted', 'search']);
export const TENSION_STACK = Object.freeze({
  investigate: ['watched'],
  warn: ['watched', 'warned'],
  chase: ['watched', 'warned', 'hunted'],
  search: ['search'],
});
/** README: the region track while `warned` or `hunted` play */
export const TENSION_DUCK = 0.7;
export const DUCKED_THREATS = Object.freeze(['warn', 'chase']);

/** README "Signal Peak holdout": sections and when they start (seconds after the signal) */
export const HOLDOUT_SECTIONS = Object.freeze([['s1', 0], ['s2', 15], ['s3', 30], ['s4', 45]]);

/** every track id a mix may name */
export const REGION_TRACKS = Object.freeze(Object.keys(REGION_LAYERS).concat('meridian'));
export const ONE_SHOTS = Object.freeze(['gameover', 'ending_dinghy', 'ending_rescue']);

/** defaults for the feel numbers; tuning.audio.director overrides them */
export const DIRECTOR_DEFAULTS = Object.freeze({
  meridianAnomaly: 0.6,
  squallThin: 0.35,
  squallDuck: 0.25,
  dialogueDuck: 0.55,
  pauseDuck: 0.4,
  pauseTone: 3000,
  openSeaGain: 0.6,
  hummingAt: 31,
  agitatedAt: 70,
  maxResonance: 100,
});

export const NEUTRAL_PARAMS = Object.freeze({ detune: 0, brightness: 0, reverb: 1 });
export const OPEN_TONE = 20000;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const q = (x, step) => Math.round(x / step) * step;
const r2 = (x) => Math.round(x * 100) / 100;

/**
 * Where the music comes from for a region (no day/night yet): a track family name.
 * @returns {'coast'|'coast_thin'|'mangroves'|'marek'|'jungle'|'meridian'|'reef'}
 */
export function regionFamily(state, cfg = DIRECTOR_DEFAULTS) {
  if (state.inSafeZone) return 'marek';
  if (state.region === 'quiet_meridian' || (state.anomaly ?? 0) >= cfg.meridianAnomaly) return 'meridian';
  switch (state.region) {
    case 'western_mangroves': return 'mangroves';
    case 'interior_jungle': return 'jungle';
    case 'reef': case 'shipwreck': return 'reef';
    case 'signal_peak': case 'open_sea': return 'coast_thin';
    default: return 'coast';   // southern_cove, coast, and anything unknown (the open test field)
  }
}

/** the Resonance's global colour outside the Meridian, scaled within the tier by `value` */
export function resonanceColour(tier, value, cfg = DIRECTOR_DEFAULTS) {
  if (tier === 'humming') {
    const s = clamp01((value - cfg.hummingAt) / (cfg.agitatedAt - cfg.hummingAt));
    return { detune: Math.round(-4 - 4 * s), brightness: 0, reverb: r2(1 + 0.2 * s), tone: Math.round(q(16000 - 4000 * s, 500)) };
  }
  if (tier === 'agitated') {
    const s = clamp01((value - cfg.agitatedAt) / (cfg.maxResonance - cfg.agitatedAt));
    return { detune: Math.round(-8 - 17 * s), brightness: Math.round(q(300 + 300 * s, 50)), reverb: r2(0.9 - 0.1 * s), tone: Math.round(q(12000 - 3000 * s, 500)) };
  }
  return { ...NEUTRAL_PARAMS, tone: OPEN_TONE };
}

/** the holdout section for seconds since the signal was fired */
export function holdoutSection(elapsed) {
  let out = HOLDOUT_SECTIONS[0][0];
  for (const [name, at] of HOLDOUT_SECTIONS) if (elapsed >= at) out = name;
  return out;
}

function layerSet(def, { optional = 1, drop = [], set = {} } = {}) {
  const layers = {};
  for (const id of def.always) layers[id] = 1;
  for (const id of def.optional) layers[id] = drop.includes(id) ? 0 : optional;
  for (const [id, g] of Object.entries(set)) if (id in layers) layers[id] = g;
  return layers;
}

function emptyMix(screen) {
  return { screen, tracks: {}, params: { ...NEUTRAL_PARAMS }, layerParams: [], duck: 1, tone: OPEN_TONE, region: [], tension: 'none' };
}

/**
 * The mix for a game state.
 * @param {{ screen?: string, region?: string|null, anomaly?: number, inSafeZone?: boolean, daylight?: number,
 *   dayPhase?: string, weather?: number, wind?: number, tide?: string, resonance?: { tier: string, value: number },
 *   threat?: string, dialogue?: boolean, paused?: boolean, holdout?: { elapsed: number }|null }} state
 *   `threat` is the smoothed level (ThreatTracker), not the raw scout state
 * @param {object} [cfg] DIRECTOR_DEFAULTS overridden by tuning.audio.director
 * @returns {{ screen: string, tracks: Object<string, { gain: number, layers: Object<string, number>, oneShot?: boolean,
 *   section?: string, fade?: number, quantise?: boolean }>, params: { detune: number, brightness: number, reverb: number },
 *   layerParams: { track: string, layer: string, name: string, value: number }[], duck: number, tone: number,
 *   region: string[], tension: string }}
 */
export function mixFor(state, cfg = DIRECTOR_DEFAULTS) {
  const c = cfg === DIRECTOR_DEFAULTS ? cfg : { ...DIRECTOR_DEFAULTS, ...cfg };
  const screen = SCREENS.includes(state.screen) ? state.screen : 'game';
  const mix = emptyMix(screen);

  if (screen === 'title') {
    mix.tracks.title = { gain: 1, layers: {} };
    return mix;
  }
  if (screen === 'gameover') {
    mix.tracks.gameover = { gain: 1, layers: {}, oneShot: true, fade: 0.3, quantise: false };
    return mix;
  }
  if (screen === 'ending_dinghy' || screen === 'ending_rescue') {
    mix.tracks[screen] = { gain: 1, layers: {}, oneShot: true, fade: 1.5, quantise: true };
    return mix;
  }

  // ---- in game ----
  const paused = !!state.paused;
  mix.duck = paused ? c.pauseDuck : state.dialogue ? c.dialogueDuck : 1;
  if (paused) mix.tone = c.pauseTone;

  if (state.holdout) {
    mix.tracks.holdout = { gain: 1, layers: {}, section: holdoutSection(state.holdout.elapsed ?? 0) };
    return mix;
  }

  const weather = clamp01(state.weather ?? 0);
  const squall = weather >= c.squallThin;
  const threat = THREATS.includes(state.threat) ? state.threat : 'none';
  const ducked = DUCKED_THREATS.includes(threat);
  const thin = squall || ducked;
  const daylight = q(clamp01(state.daylight ?? 1), 0.05);
  const tier = TIERS.includes(state.resonance?.tier) ? state.resonance.tier : 'quiet';
  const value = Number.isFinite(state.resonance?.value) ? state.resonance.value : 0;
  const regionGain = r2((ducked ? TENSION_DUCK : 1) * (1 - c.squallDuck * q(weather, 0.1)));
  const family = regionFamily(state, c);
  const optional = thin ? 0 : 1;

  if (family === 'coast' || family === 'coast_thin') {
    const exposed = family === 'coast_thin';
    const surfLoud = !exposed && (state.tide === 'high' || (state.wind ?? 0) > 0.6);
    const g = exposed ? r2(regionGain * c.openSeaGain) : regionGain;
    const day = r2(Math.sin((daylight * Math.PI) / 2));
    const night = r2(Math.cos((daylight * Math.PI) / 2));
    const opt = exposed ? 0 : optional;
    if (day > 0.005) {
      mix.tracks.coast_day = { gain: r2(g * day), layers: layerSet(REGION_LAYERS.coast_day, { optional: opt, drop: [...(surfLoud ? ['low'] : []), ...(daylight < 0.35 ? ['buoy'] : [])] }) };
    }
    if (night > 0.005) {
      mix.tracks.coast_night = { gain: r2(g * night), layers: layerSet(REGION_LAYERS.coast_night, { optional: opt, drop: surfLoud ? ['low'] : [] }) };
    }
  } else if (family === 'meridian') {
    const t = MERIDIAN_TIERS[tier];
    const layers = {};
    for (const id of MERIDIAN_LAYERS) layers[id] = t.layers.includes(id) ? 1 : 0;
    mix.tracks.meridian = { gain: regionGain, layers };
    mix.params = { detune: t.detune, brightness: t.brightness, reverb: t.reverb };
    mix.layerParams.push({ track: 'meridian', layer: 'h_choir', name: 'detune', value: t.choirDetune ?? 0 });
  } else {
    const night = daylight < 0.5;
    const set = {};
    const drop = [];
    if (family === 'marek' && state.dialogue) drop.push('unease');
    if (family === 'jungle') {
      if (!(night || threat !== 'none')) drop.push('heart');
      if (!night && !thin) set.insects = 0.5;
    }
    if (family === 'reef' && state.tide === 'low') drop.push('undertow');
    mix.tracks[family] = { gain: regionGain, layers: layerSet(REGION_LAYERS[family], { optional, drop, set }) };
  }
  mix.region = Object.keys(mix.tracks);

  if (family !== 'meridian') {
    const col = resonanceColour(tier, value, c);
    mix.params = { detune: col.detune, brightness: col.brightness, reverb: col.reverb };
    if (!paused) mix.tone = col.tone;
  } else if (!paused) {
    mix.tone = resonanceColour(tier, value, c).tone;
  }

  if (threat !== 'none') {
    const layers = {};
    for (const id of TENSION_LAYERS) layers[id] = TENSION_STACK[threat].includes(id) ? 1 : 0;
    mix.tracks.tension = { gain: 1, layers };
    mix.tension = threat;
  }
  return mix;
}

/**
 * Smooths the raw scout state so the tension stack does not flap: a higher level is taken at once; a lower one only
 * after the current level has been held `hold[level]` seconds and the raw level has stayed lower for `release`
 * seconds. Leaving WARN or CHASE for nothing passes through SEARCH for `tail` seconds (the decay of the README).
 * The clock is whatever the caller passes (simulation seconds in the game, a fake clock in tests).
 */
export class ThreatTracker {
  constructor({ hold = { investigate: 3, search: 3, warn: 4, chase: 6 }, release = 1.5, tail = 6 } = {}) {
    this.hold = hold;
    this.release = release;
    this.tail = tail;
    this.reset();
  }

  reset() {
    this.level = 'none';
    this.since = -Infinity;
    this.lowerSince = null;
    this.tailUntil = null;
  }

  /**
   * @param {string} raw the highest scout state near the player ('none' when no AI)
   * @param {number} now seconds
   * @returns {string} the smoothed level
   */
  update(raw, now) {
    const r = THREAT_RANK[raw] === undefined ? 'none' : raw;
    if (THREAT_RANK[r] > THREAT_RANK[this.level]) {
      this.#set(r, now);
      return this.level;
    }
    if (THREAT_RANK[r] === THREAT_RANK[this.level]) {
      this.lowerSince = null;
      if (this.tailUntil !== null && r !== 'none') this.tailUntil = null;
    } else {
      this.lowerSince ??= now;
      const held = now - this.since >= (this.hold[this.level] ?? 0);
      const settled = now - this.lowerSince >= this.release;
      if (this.tailUntil !== null) {
        if (now >= this.tailUntil) this.#set(r, now);
      } else if (held && settled) {
        if ((this.level === 'warn' || this.level === 'chase') && r === 'none') {
          this.#set('search', now);
          this.tailUntil = now + this.tail;
        } else this.#set(r, now);
      }
    }
    return this.level;
  }

  #set(level, now) {
    this.level = level;
    this.since = now;
    this.lowerSince = null;
    this.tailUntil = null;
  }
}
