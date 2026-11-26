// Applies the director's mixes (director.js) to the music engine (Music.js): diffs each new mix against the one last
// applied and turns the difference into engine calls.
//
// - New tracks start on the next bar line of what plays (every region track and the tension share a 4 s bar), and
//   are started before the tracks they replace are stopped, so the old ones fade out from that same bar line.
// - Layer moves are quantised to the bar and fade over `layerFade` (one bar); track gains (day/night crossfade, the
//   0.7 duck) ramp over `gainFade`; global params over `paramRamp`.
// - Rate limit: at most one application every `minInterval` seconds of the audio clock (a screen change goes at once),
//   and the set of region tracks must hold for `regionDwell` seconds before the music follows it, so walking along a
//   region border or a flickering state cannot thrash the scheduler.
// - The duck (dialogue, Journal) and the tone (a low-pass on the whole music bus) are ramps on two nodes after the
//   engine, not track gains, so they never fight the director's own faders.
// - Nothing happens while the context is not running (suspended, hidden tab): the last mix waits and is applied on
//   resume. Created after the unlock, the first application simply starts the right music mid-game.
import { rampParam } from './params.js';
import { REGION_TRACKS } from './director.js';

export const MUSIC_DIRECTOR_DEFAULTS = Object.freeze({
  minInterval: 0.25,
  regionDwell: 1.5,
  trackFade: 3,
  stopFade: 4,
  fastStopFade: 0.8,
  layerFade: 4,
  gainFade: 2,
  paramRamp: 3,
  duckRamp: 0.4,
  toneRamp: 1.5,
});

const EPS = 0.005;

export class MusicDirector {
  /**
   * @param {{ music: import('./Music.js').Music, duck?: GainNode, tone?: BiquadFilterNode, cfg?: object }} opts
   *   duck and tone are the nodes between the engine's output and the music bus (GameAudio builds them);
   *   offline: true for OfflineAudioContext renders
   */
  constructor({ music, duck = null, tone = null, cfg = {}, offline = false }) {
    this.music = music;
    /** offline renders drive the context from suspend() callbacks, where its state reads 'suspended' */
    this.offline = offline;
    this.ctx = music.ctx;
    this.duckNode = duck;
    this.toneNode = tone;
    this.cfg = { ...MUSIC_DIRECTOR_DEFAULTS, ...cfg };
    /** what the engine was last told: id -> { gain, layers, section, oneShot } */
    this.applied = new Map();
    this.params = {};
    this.layerParams = new Map();
    this.duck = null;
    this.tone = null;
    this.screen = null;
    this.lastApply = -Infinity;
    this.regionKey = null;
    this.pending = null;   // { key, since }
    /** one-shots already played in the current screen (they end by themselves and must not restart) */
    this.played = new Set();
    this.last = null;
    this.stats = { applies: 0, calls: 0, skipped: 0, errors: 0 };
  }

  get now() { return this.ctx.currentTime; }

  /**
   * Take a new mix. Cheap when nothing changed; safe to call every frame.
   * @param {object} mix from mixFor
   * @returns {boolean} whether anything was applied
   */
  update(mix) {
    this.last = mix;
    if (!this.offline && this.ctx.state !== 'running') { this.stats.skipped++; return false; }
    const now = this.now;
    const screenChanged = mix.screen !== this.screen;
    if (!screenChanged && now - this.lastApply < this.cfg.minInterval) return false;

    // region dwell: the region tracks must hold before the music follows
    const key = mix.region?.length ? mix.region.slice().sort().join('+') : '';
    let effective = mix;
    if (!screenChanged && this.regionKey !== null && key !== this.regionKey && key && this.regionKey) {
      if (!this.pending || this.pending.key !== key) this.pending = { key, since: now };
      if (now - this.pending.since < this.cfg.regionDwell) effective = this.#holdRegion(mix);
      else this.pending = null;
    } else this.pending = null;

    this.#apply(effective, screenChanged);
    this.lastApply = now;
    if (effective === mix) this.regionKey = key;
    return true;
  }

  /** the new mix, but with the region tracks of the last applied mix (while the dwell runs) */
  #holdRegion(mix) {
    const tracks = {};
    for (const [id, spec] of Object.entries(mix.tracks)) if (!REGION_TRACKS.includes(id)) tracks[id] = spec;
    for (const [id, spec] of this.applied) if (REGION_TRACKS.includes(id)) tracks[id] = spec;
    return { ...mix, tracks };
  }

  #call(fn) {
    this.stats.calls++;
    try { fn(); } catch (e) { this.stats.errors++; if (this.stats.errors < 5) console.warn('music director:', e.message); }
  }

  #apply(mix, screenChanged) {
    const m = this.music;
    const c = this.cfg;
    this.stats.applies++;
    if (screenChanged) {
      this.played.clear();
      this.screen = mix.screen;
    }
    const playing = new Set(m.current.map((t) => t.id));
    const fast = screenChanged && Object.values(mix.tracks).some((t) => t.oneShot && t.quantise === false);

    // 1. start what is new (before stopping anything, so the bar grid is still there to quantise to)
    for (const [id, spec] of Object.entries(mix.tracks)) {
      const was = this.applied.get(id);
      if (spec.oneShot) {
        if (this.played.has(id)) continue;
        this.played.add(id);
      } else if (was && playing.has(id)) continue;
      this.#call(() => m.play(id, { fade: spec.fade ?? c.trackFade, quantise: spec.quantise ?? true, exclusive: false, gain: spec.gain }));
      for (const [layer, g] of Object.entries(spec.layers ?? {})) if (Math.abs(g - 1) > EPS) this.#call(() => m.setLayerGain(id, layer, g, { fade: 0.01 }));
      if (spec.section) this.#call(() => m.setSection(id, spec.section, { quantise: false }));
      this.applied.set(id, { ...spec, layers: { ...(spec.layers ?? {}) } });
    }

    // 2. stop what left the mix
    for (const id of [...this.applied.keys()]) {
      if (id in mix.tracks) continue;
      this.applied.delete(id);
      if (!playing.has(id) && !m.current.some((t) => t.id === id)) continue;
      this.#call(() => m.stopTrack(id, fast ? { fade: c.fastStopFade, quantise: false } : { fade: c.stopFade, quantise: true }));
    }
    if (fast) {
      // whatever else still sounds (a track the director did not start) goes too
      for (const t of m.current) if (!(t.id in mix.tracks)) this.#call(() => m.stopTrack(t.id, { fade: c.fastStopFade }));
    }

    // 3. move what stays
    for (const [id, spec] of Object.entries(mix.tracks)) {
      const was = this.applied.get(id);
      if (!was || was === spec) continue;
      if (spec.oneShot) continue;
      if (Math.abs((was.gain ?? 1) - spec.gain) > EPS) {
        this.#call(() => m.setTrackGain(id, spec.gain, { fade: c.gainFade }));
        was.gain = spec.gain;
      }
      for (const [layer, g] of Object.entries(spec.layers ?? {})) {
        const before = was.layers[layer] ?? 1;
        if (Math.abs(before - g) > EPS) {
          this.#call(() => m.setLayerGain(id, layer, g, { fade: c.layerFade, quantise: true }));
          was.layers[layer] = g;
        }
      }
      if (spec.section && spec.section !== was.section) {
        this.#call(() => m.setSection(id, spec.section));
        was.section = spec.section;
      }
    }

    // 4. global params, layer params, duck, tone
    for (const [name, v] of Object.entries(mix.params ?? {})) {
      if (this.params[name] === v) continue;
      this.params[name] = v;
      this.#call(() => m.setParam(name, v, { ramp: c.paramRamp }));
    }
    for (const lp of mix.layerParams ?? []) {
      const k = `${lp.track}/${lp.layer}/${lp.name}`;
      if (this.layerParams.get(k) === lp.value || !(lp.track in mix.tracks)) continue;
      this.layerParams.set(k, lp.value);
      this.#call(() => m.setLayerParam(lp.track, lp.layer, lp.name, lp.value, { ramp: c.paramRamp }));
    }
    // a track restarted later starts with its layer params at 0: forget the ones of tracks that left
    for (const k of [...this.layerParams.keys()]) if (!(k.split('/')[0] in mix.tracks)) this.layerParams.delete(k);
    if (this.duckNode && mix.duck !== this.duck) {
      this.duck = mix.duck;
      rampParam(this.duckNode.gain, mix.duck, this.now, c.duckRamp);
    }
    if (this.toneNode && mix.tone !== this.tone) {
      this.tone = mix.tone;
      rampParam(this.toneNode.frequency, mix.tone, this.now, c.toneRamp);
    }
  }

  /** a JSON-friendly picture for the debug readout */
  state() {
    return {
      screen: this.screen,
      tracks: Object.fromEntries([...this.applied].map(([id, s]) => [id, { gain: s.gain, section: s.section, layers: s.layers }])),
      params: { ...this.params }, duck: this.duck, tone: this.tone,
      pending: this.pending ? { ...this.pending } : null, ...this.stats,
    };
  }
}
