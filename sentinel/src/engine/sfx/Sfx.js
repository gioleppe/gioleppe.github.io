// The sound effects and ambience at run time (step 5.5), on the AudioManager's `sfx` bus:
//
//   one-shots -> voice (pan, distance gain) -> category bus (player | world | ui | alert) ------------------> out
//   beds and their grains                    -> amb bus -> amb side-chain gain ------------------------------> out
//   loud one-shots duck the amb side-chain gain and the music's (GameAudio passes it in) for a moment
//
// Events come in after every simulation step (onEvents) and are mapped by eventMap.js; the body sounds (footsteps
// scaled to the player's real noise radius, breath, heartbeat, bleeding, drowning) and the lasting work loops
// (drinking at a spring, prying the hatch, patching the dinghy) are derived once per frame from state (frame).
import { VoicePool, dbToGain } from './synth.js';
import { SOUNDS, SOUND_INFO } from './sounds.js';
import { SFX_EVENTS, SILENT } from './eventMap.js';
import { Ambience, BED_DEFAULTS } from './Ambience.js';
import { spatialise, ambienceFor, footstepGain, footstepSound, FootstepClock, heartRate, SPATIAL_DEFAULTS } from './mixRules.js';

export const SFX_DEFAULTS = Object.freeze({
  levels: { amb: -6, player: -10, world: -4, ui: -14, alert: -3 },
  maxVoices: 28,
  footstepRef: 220,
  duck: { attack: 0.03, hold: 0.25, release: 0.8, maxDb: 9 },
  spatial: {
    world: SPATIAL_DEFAULTS,
    alert: { ...SPATIAL_DEFAULTS, ref: 200, max: 2600 },
    far: { ...SPATIAL_DEFAULTS, ref: 600, max: 7000, panWidth: 1500 },
  },
  beds: BED_DEFAULTS,
  pauseAmbience: 0.5,
  spottedRearmSeconds: 10,
});

const IMPACT_BY_TERRAIN = Object.freeze({
  sand: 'impact_ground', wet_sand: 'impact_ground', jungle_floor: 'impact_jungle', basalt: 'impact_rock', reef_rock: 'impact_rock',
  mud: 'impact_mud', deck: 'impact_wood', wood: 'impact_wood',
});

/** the event with the position of the scout id when it carries none */
const withScout = (e, id, L) => {
  if (Number.isFinite(e.x)) return e;
  const sc = id !== undefined ? L.scoutAt?.(id) : null;
  return sc ? { ...e, x: sc.x, y: sc.y } : e;
};

const pos = (e) => {
  const x = e.x ?? e.x1 ?? e.x0;
  const y = e.y ?? e.y1 ?? e.y0;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
};

/**
 * The handlers eventMap.js names: (sfx, event, listener) where listener is { x, y, terrainAt(x, y) }.
 * @type {Object<string, (s: Sfx, e: object, L: object) => void>}
 */
export const HANDLERS = {
  playerState(s, e) {
    if (e.change === 'exhausted') { s.play('gasp'); s.breathUntil = s.now + 4; } else if (e.change === 'drowning_start') { s.play('gasp'); s.play('bubbles', { at: s.now + 0.3 }); } else if (e.change === 'crouch' || e.change === 'stand') s.play('cloth', { gain: 0.6 });
  },
  playerMode(s, e) {
    if (e.to === 'swim' || e.from === 'swim' || e.to === 'wade') s.play('step_wade', { gain: e.to === 'swim' ? 1.1 : 0.7 });
  },
  hurt(s, e, L) { if (!L.arrowHit) s.play('hurt'); },
  death(s) { s.play('death'); },
  cover(s, e) { if (e.inCover) s.play('cloth', { gain: 0.5 }); },
  pickup(s) { s.play('pickup'); },
  drop(s, e, L) { s.playAt('drop', e, L); },
  deny(s) { s.play('deny'); },
  select(s) { s.play('select'); },
  confirm(s) { s.play('confirm'); },
  page(s) { s.play('page'); },
  click(s) { s.play('click'); },
  electric(s) { s.play('electric'); },
  itemUsed(s, e) {
    if (e.use === 'drink') s.play('drink', { gulps: 3 });
    else if (e.use === 'heal') s.play(e.item === 'bandage' ? 'bandage' : 'herbs');
    else s.play('select');
  },
  power(s, e) { s.play(e.item === 'flashlight' ? 'click' : 'electric'); },
  throw(s) { s.play('throw'); },
  impact(s, e, L) {
    const terrain = e.water ? null : L.terrainAt?.(e.x, e.y);
    s.playAt(e.water ? 'impact_water' : IMPACT_BY_TERRAIN[terrain] ?? 'impact_ground', e, L);
  },
  crafted(s) { s.play('craft'); s.play('confirm', { at: s.now + 0.75 }); },
  hatchOpened(s) { s.play('hatch_open'); },
  weatherStart(s) { s.play('thunder', { gain: 0.45, near: 0.1, pan: s.rnd() * 1.2 - 0.6 }); },
  resonanceTier(s, e) { if (e.to === 'agitated' || (e.to === 'humming' && e.from === 'quiet')) s.play('tier_swell'); },
  anomalyPulse(s, e, L) { s.playAt('anomaly_pulse', e, L, { gain: 0.5 + 0.5 * (e.strength ?? 1), spatial: 'far' }); },
  landmark(s) { s.play('chime'); },
  shiftingPaths(s, e) { if (e.active) s.play('reversed_swell'); },
  shout(s, e, L) { s.playAt('shout', e, L, { spatial: 'alert' }); },
  whistle(s, e, L) { s.playAt('whistle', e, L, { spatial: 'alert' }); },
  // scout_draw { id } and arrow_fired { scout } carry no position: the scout's own is used
  bowDraw(s, e, L) { s.playAt('bow_creak', withScout(e, e.id, L), L, { spatial: 'alert', gain: e.warning ? 0.8 : 1 }); },
  arrowFired(s, e, L) { s.playAt('arrow_fired', withScout(e, e.scout, L), L, { spatial: 'alert' }); },
  arrowLand(s, e, L) {
    const t = L.terrainAt?.(e.x, e.y);
    s.playAt('arrow_land', e, L, { spatial: 'alert', surface: e.surface ?? (t === 'deck' || t === 'wood' ? 'wood' : 'ground') });
  },
  arrowHit(s) { s.play('arrow_land', { surface: 'body' }); s.play('hurt', { at: s.now + 0.03 }); },
  spotted(s) {
    if (!s.spottedArmed) return;
    s.spottedArmed = false;
    s.play('stinger');
  },
  chaseLost(s) { s.play('release'); s.spottedArmed = true; },
  // a warning that ends with the scout retreating, or a hunter standing down after a hit: the tension lets go
  warnEnd(s, e) {
    s.spottedArmed = true;
    if (e.outcome === 'retreat' || e.outcome === 'driven_off') s.play('release', { gain: e.outcome === 'driven_off' ? 1 : 0.7 });
  },
  // quiet contact (offerings, gatherers): soft, placed, wordless; the stinger stays armed as it was
  offeringPlaced(s, e, L) { s.playAt('drop', e, L, { gain: 0.5 }); },
  offeringTakenBack(s) { s.play('pickup', { gain: 0.5 }); },
  offeringAccepted(s) { s.play('release', { gain: 0.45 }); },
  gathererGift(s, e, L) { s.playAt('drop', e, L, { gain: 0.45 }); },
  gathererStartled(s, e, L) { s.playAt('cloth', e, L, { gain: 0.9 }); },
};

export class Sfx {
  /**
   * @param {{ ctx: BaseAudioContext, out: AudioNode, musicSide?: GainNode|null, cfg?: object, random?: () => number }} opts
   *   musicSide: a gain on the music path the loud one-shots duck; random: Math.random live, seeded in renders
   */
  constructor({ ctx, out, musicSide = null, cfg = {}, random = Math.random }) {
    this.ctx = ctx;
    this.cfg = { ...SFX_DEFAULTS, ...cfg, levels: { ...SFX_DEFAULTS.levels, ...(cfg.levels ?? {}) }, duck: { ...SFX_DEFAULTS.duck, ...(cfg.duck ?? {}) },
      spatial: { ...SFX_DEFAULTS.spatial, ...(cfg.spatial ?? {}) } };
    this.rnd = random;
    this.musicSide = musicSide;
    this.ambSide = ctx.createGain();
    this.ambSide.connect(out);
    this.bus = {};
    for (const [name, db] of Object.entries(this.cfg.levels)) {
      const g = ctx.createGain();
      g.gain.value = dbToGain(db);
      g.connect(name === 'amb' ? this.ambSide : out);
      this.bus[name] = g;
    }
    this.pool = new VoicePool(ctx, { max: this.cfg.maxVoices });
    this.ambience = new Ambience({ ctx, out: this.bus.amb, random, cfg: { ...BED_DEFAULTS, ...(cfg.beds ?? {}) },
      play: (name, o) => this.play(name, o) });
    this.steps = new FootstepClock();
    this.timers = { breath: 0, heart: 0, bleed: 0, drown: 0, channel: 0 };
    this.breathUntil = -Infinity;
    this.spottedArmed = true;
    this.calmSince = null;
    this.duckLevel = 1;
    this.duckUntil = -Infinity;
    this.stats = { events: 0, unknown: {}, played: 0, skipped: 0 };
    this.amb = null;
  }

  get now() { return this.ctx.currentTime; }

  /**
   * Start a recipe.
   * @param {string} name a key of SOUNDS
   * @param {{ at?: number, gain?: number, pan?: number }} [o] the rest goes to the recipe
   */
  play(name, o = {}) {
    const recipe = SOUNDS[name];
    if (!recipe) throw new RangeError(`unknown sound "${name}"`);
    const info = SOUND_INFO[name] ?? { bus: 'world' };
    const gain = (o.gain ?? 1) * dbToGain(info.trim ?? 0);
    if (gain < 0.002) { this.stats.skipped++; return null; }
    const v = this.pool.voice(this.bus[info.bus] ?? this.bus.world, { pan: o.pan ?? 0, gain, priority: info.priority ?? 1, name });
    if (!v) return null;
    const at = Math.max(o.at ?? this.now + 0.01, this.now);
    try {
      recipe(v, at, o, this.rnd);
    } catch (e) {
      v.stop();
      v.dispose();
      throw e;
    }
    this.stats.played++;
    if (info.duck) this.duck(info.duck * Math.min(1, gain / dbToGain(info.trim ?? 0)), at);
    return v;
  }

  /** a recipe placed at the event's world position relative to the listener (the player) */
  playAt(name, e, L, o = {}) {
    const p = pos(e);
    if (!p || !L) return this.play(name, o);
    const sp = spatialise(p.x - L.x, p.y - L.y, this.cfg.spatial[o.spatial ?? 'world'] ?? SPATIAL_DEFAULTS);
    return this.play(name, { ...o, gain: (o.gain ?? 1) * sp.gain, pan: sp.pan });
  }

  /** sidechain-style dip of the ambience and the music under a loud one-shot */
  duck(db, at = this.now) {
    const d = this.cfg.duck;
    const g = dbToGain(-Math.min(Math.max(0, db), d.maxDb));
    this.duckLevel = at < this.duckUntil ? Math.min(this.duckLevel, g) : g;
    this.duckUntil = at + d.hold;
    for (const node of [this.ambSide, this.musicSide]) {
      if (!node) continue;
      node.gain.cancelScheduledValues(at);
      node.gain.setTargetAtTime(this.duckLevel, at, d.attack / 3);
      node.gain.setTargetAtTime(1, this.duckUntil, d.release / 3);
    }
  }

  /**
   * The events of one simulation step.
   * @param {object[]} events
   * @param {{ x: number, y: number, terrainAt?: (x: number, y: number) => string|null }} listener
   */
  onEvents(events, listener) {
    if (!events.length) return;
    const L = { ...listener, arrowHit: events.some((e) => e.type === 'arrow_hit') };
    for (const e of events) {
      this.stats.events++;
      const h = SFX_EVENTS[e.type];
      if (h === undefined) { this.stats.unknown[e.type] = (this.stats.unknown[e.type] ?? 0) + 1; continue; }
      if (h === SILENT) continue;
      try { HANDLERS[h](this, e, L); } catch (err) { if (!this.warned) { this.warned = true; console.warn('sfx:', err.message); } }
    }
  }

  /**
   * Once per frame: the beds, and the sounds derived from the player's state.
   * @param {object} record gameAudioState
   * @param {object|null} p playerAudioState (null on the title)
   * @param {number} simDt simulation seconds since the last frame (0 while paused)
   * @param {object} [amb] precomputed ambienceFor(record)
   */
  frame(record, p, simDt, amb = ambienceFor(record, this.cfg)) {
    const now = this.now;
    this.amb = amb;
    this.ambience.update(amb, now);
    if (record.threat === 'none') {
      this.calmSince ??= now;
      if (now - this.calmSince > this.cfg.spottedRearmSeconds) this.spottedArmed = true;
    } else this.calmSince = null;
    if (!p || record.screen !== 'game' || record.paused || p.dead) return;

    if (this.steps.update(p, simDt)) {
      this.play(footstepSound(p.state === 'swim' ? 'swim' : p.surface), { gain: footstepGain(p.noiseRadius, this.cfg.footstepRef) });
    }
    const T = this.timers;
    const every = (key, seconds, fn) => {
      if (T[key] < now - 1) T[key] = now;   // after a pause or a stall: start again from now, no burst
      if (T[key] <= now + 0.05) { fn(Math.max(T[key], now)); T[key] = Math.max(T[key], now) + seconds; }
    };
    const staminaShare = p.staminaMax > 0 ? p.stamina / p.staminaMax : 1;
    if (now < this.breathUntil || staminaShare < 0.12) {
      every('breath', 1.25, (at) => this.play('breath', { at, gain: staminaShare < 0.3 ? 1 : 0.6 }));
      if (staminaShare < 0.3) this.breathUntil = Math.max(this.breathUntil, now + 0.5);
    } else T.breath = now;
    const bpm = heartRate(p, record.threat);
    if (bpm > 0) every('heart', 60 / bpm, (at) => this.play('heartbeat', { at, gain: Math.min(1, bpm / 110) }));
    else T.heart = now;
    if (p.bleeding) every('bleed', 2.2, (at) => this.play('bleed', { at })); else T.bleed = now;
    if (p.drowning) every('drown', 0.8, (at) => this.play('bubbles', { at })); else T.drown = now;
    if (p.channel === 'spring') every('channel', 1.1, (at) => this.play('drink', { at, gulps: 2 }));
    else if (p.channel === 'hatch') every('channel', 1.5, (at) => this.play('pry_groan', { at }));
    else if (p.channel === 'dinghy') every('channel', 0.45, (at) => this.play('patch', { at }));
    else T.channel = now;
  }

  /** a JSON-friendly picture for the debug readout and the soak */
  info() {
    return {
      voices: this.pool.active.length, voiceNodes: this.pool.liveNodes, bedNodes: this.ambience.nodeCount, ...this.pool.stats,
      played: this.stats.played, events: this.stats.events, unknown: this.stats.unknown,
      beds: this.ambience.levels, duck: this.duckLevel, spottedArmed: this.spottedArmed,
    };
  }

  dispose() {
    for (const v of this.pool.active.slice()) { v.stop(); v.dispose(); }
    this.ambience.dispose();
    for (const g of [...Object.values(this.bus), this.ambSide]) { try { g.disconnect(); } catch { /* gone */ } }
  }
}
