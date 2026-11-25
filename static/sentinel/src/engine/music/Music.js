// The music engine: tracks of layers, played by the look-ahead scheduler on the audio clock.
// The same code runs live (AudioContext + timer) and offline (OfflineAudioContext, everything scheduled up front:
// see render.js), so what the render tool measures is what the game plays.
//
//   const music = new Music({ context, output: audio.buses.music });
//   music.load([titleScore, ...]);
//   music.play('title', { fade: 2 });                         // crossfades from whatever plays, on the next bar
//   music.setLayerGain('title', 'bells', 0, { fade: 4, quantise: true });
//   music.setParam('detune', -15, { ramp: 3 });               // global, in cents, smooth, also on held notes
//   music.setLayerParam('title', 'pad', 'brightness', -1200);  // one layer, filter cutoff in cents
//   music.setSection('title', 'tense');                       // from the next bar
//   music.stop({ fade: 3 });
//   music.state();
//
// Graph: note -> layer input -> pan -> layer fader -> track dry fader ----------------------> output
//                                           |-> reverb send -> track reverb fader -> shared reverb -> output
//                                           '-> delay send -> track delay (feedback, low-pass) -> track dry fader
import { LookaheadScheduler, startTimeFor } from './Scheduler.js';
import { TrackTimeline } from './timeline.js';
import { nextBarTime, secondsToBarBeat } from './time.js';
import { validateScore, voiceParams, fxParams } from './schema.js';
import { playNote } from './voices.js';
import { impulseResponse } from './reverb.js';
import { rampParam } from './params.js';

/** a note later than this when its window comes round is dropped, not played late (no bursts after a stall) */
export const LATE_TOLERANCE = 0.05;
/** after a track fades out, its nodes are kept this long for reverb and delay tails, then freed */
const TAIL_SECONDS = 8;

export const GLOBAL_PARAMS = ['detune', 'brightness', 'reverb'];
export const LAYER_PARAMS = ['detune', 'brightness'];

export class Music {
  /**
   * @param {{ context: BaseAudioContext, output: AudioNode, live?: boolean, lookahead?: number, interval?: number,
   *   timers?: object, maxVoices?: number }} opts `live: false` for offline rendering (no timer)
   */
  constructor({ context, output, live = true, lookahead = 0.12, interval = 0.025, timers, maxVoices = 64 }) {
    this.ctx = context;
    this.output = output;
    this.live = live;
    this.maxVoices = maxVoices;
    this.scores = new Map();
    /** every track instance with nodes, including ones fading out */
    this.tracks = [];
    this.stats = { voices: 0, liveNodes: 0, played: 0, dropped: 0, stolen: 0, peakVoices: 0 };

    // shared reverb
    this.reverbIn = context.createGain();
    const conv = context.createConvolver();
    conv.normalize = false;
    conv.buffer = impulseResponse(context);
    this.reverbOut = context.createGain();
    this.reverbIn.connect(conv).connect(this.reverbOut).connect(output);

    // global modulation sources; each layer's own source sums them in
    this.globals = {};
    for (const name of ['detune', 'brightness']) {
      const cs = context.createConstantSource();
      cs.offset.value = 0;
      cs.start();
      this.globals[name] = cs;
    }

    this.scheduler = new LookaheadScheduler({
      now: () => this.ctx.currentTime, lookahead, interval, timers,
      onWindow: (from, to, now) => this.#onWindow(from, to, now),
    });
  }

  /**
   * Add scores (validated; a bad score throws with every problem listed).
   * @param {object|object[]} scores
   */
  load(scores) {
    for (const s of [].concat(scores)) {
      const problems = validateScore(s);
      if (problems.length) throw new Error(`bad score:\n  ${problems.join('\n  ')}`);
      this.scores.set(s.id, s);
    }
    return this;
  }

  /** tracks that are playing and not fading out */
  get current() { return this.tracks.filter((t) => t.stopAt === null); }

  /**
   * Start a track. Whatever else plays fades out over the same time (a crossfade).
   * @param {string} id
   * @param {{ fade?: number, quantise?: boolean, at?: number }} [opts] quantise (default true): start on the next
   *   bar line of the track already playing, so the two stay in step; `at`: exact audio time (offline rendering)
   */
  play(id, { fade = 0, quantise = true, at } = {}) {
    const score = this.scores.get(id);
    if (!score) throw new RangeError(`unknown track "${id}"`);
    const running = this.current;
    if (running.some((t) => t.id === id)) return this;
    const now = this.ctx.currentTime;
    let start = at ?? now + 0.06;
    if (at === undefined && quantise && running.length) start = Math.max(start, running[0].nextBar(start));
    for (const t of running) t.fadeOut(start, fade);
    this.tracks.push(new Track(this, score, start, fade));
    if (this.live) {
      this.scheduler.start();
      this.scheduler.tick();
    }
    return this;
  }

  /** fade out and stop everything (optionally from the next bar) */
  stop({ fade = 0, quantise = false } = {}) {
    const now = this.ctx.currentTime;
    for (const t of this.current) t.fadeOut(quantise ? t.nextBar(now + 0.02) : now, fade);
    return this;
  }

  #track(id) {
    const t = this.current.find((x) => x.id === id);
    if (!t) throw new RangeError(`track "${id}" is not playing`);
    return t;
  }

  /**
   * Fade one layer to `gain` (relative to its score gain: 1 = as written, 0 = silent).
   * @param {{ fade?: number, quantise?: boolean }} [opts]
   */
  setLayerGain(trackId, layerId, gain, { fade = 0.05, quantise = false } = {}) {
    const t = this.#track(trackId);
    const at = quantise ? t.nextBar(this.ctx.currentTime + 0.02) : this.ctx.currentTime;
    t.layer(layerId).setGain(gain, at, fade);
    return this;
  }

  /** a layer's modulation: 'detune' (cents, all oscillators) or 'brightness' (cents, its filters) */
  setLayerParam(trackId, layerId, name, value, { ramp = 0.1 } = {}) {
    if (!LAYER_PARAMS.includes(name)) throw new RangeError(`unknown layer param "${name}" (${LAYER_PARAMS.join(', ')})`);
    rampParam(this.#track(trackId).layer(layerId).mods[name].offset, value, this.ctx.currentTime, ramp);
    return this;
  }

  /** global modulation: 'detune' and 'brightness' in cents for every layer, 'reverb' the return level (1 = as mixed) */
  setParam(name, value, { ramp = 0.1 } = {}) {
    const now = this.ctx.currentTime;
    if (name === 'reverb') rampParam(this.reverbOut.gain, value, now, ramp);
    else if (this.globals[name]) rampParam(this.globals[name].offset, value, now, ramp);
    else throw new RangeError(`unknown param "${name}" (${GLOBAL_PARAMS.join(', ')})`);
    return this;
  }

  /** switch a track's section (layers with per-section patterns), from the next bar by default */
  setSection(trackId, section, { quantise = true } = {}) {
    const t = this.#track(trackId);
    if (!t.score.sections?.includes(section)) throw new RangeError(`track "${trackId}" has no section "${section}"`);
    const now = this.ctx.currentTime + 0.02;
    const time = quantise ? t.nextBar(now) : now;
    t.timeline.setSection(section, Math.max(0, Math.ceil((time - t.t0) / t.timeline.spb - 1e-6)));
    return this;
  }

  /** schedule everything up to `time` at once (offline rendering) */
  renderUntil(time) {
    this.scheduler.flushUntil(time);
  }

  /** a JSON-friendly picture of what is playing */
  state() {
    const now = this.ctx.currentTime;
    return {
      time: now,
      context: this.ctx.state,
      scheduling: this.scheduler.running,
      tracks: this.tracks.map((t) => ({ id: t.id, ...t.position(now), stopping: t.stopAt !== null,
        section: t.timeline.sectionAt(t.position(now).bar), layers: t.layers.map((l) => ({ id: l.id, gain: l.userGain })) })),
      ...this.stats,
      maxTimerGap: this.scheduler.maxGap,
    };
  }

  /** stop the timer and free every node */
  dispose() {
    this.scheduler.stop();
    for (const t of this.tracks) t.dispose();
    this.tracks = [];
    for (const cs of Object.values(this.globals)) { try { cs.stop(); cs.disconnect(); } catch { /* gone */ } }
    try { this.reverbIn.disconnect(); this.reverbOut.disconnect(); } catch { /* gone */ }
  }

  #onWindow(from, to, now) {
    for (const t of this.tracks) t.schedule(from, to, now);
    // free tracks whose tails are over
    const keep = [];
    for (const t of this.tracks) {
      if (t.disposeAt !== null && now >= t.disposeAt) t.dispose(); else keep.push(t);
    }
    this.tracks = keep;
    if (this.live && !this.tracks.length) this.scheduler.stop();
  }

  /** start one note (called by Track) */
  noteOn(layer, ev, now) {
    const time = startTimeFor(ev.time, now, LATE_TOLERANCE);
    if (time === null) { this.stats.dropped++; return; }
    // polyphony: notes still sounding at `time`; the layer's oldest is stolen when the layer or the engine is full
    let sounding = 0;
    for (const t of this.tracks) {
      for (const l of t.layers) {
        l.active = l.active.filter((n) => !n.disposed && n.stopTime > time);
        sounding += l.active.length;
      }
    }
    while (layer.active.length && (layer.active.length >= layer.params.maxVoices || sounding >= this.maxVoices)) {
      layer.active.shift().steal(time);
      this.stats.stolen++;
      sounding--;
    }
    if (sounding >= this.maxVoices) { this.stats.dropped++; return; }
    const note = playNote(this.ctx, layer.voice, {
      time, duration: ev.duration, note: ev.note, params: layer.params, out: layer.input, mods: layer.mods,
    });
    const count = note.nodes.length;
    this.stats.voices++;
    this.stats.liveNodes += count;
    this.stats.played++;
    this.stats.peakVoices = Math.max(this.stats.peakVoices, this.stats.voices);
    note.onDispose = () => { this.stats.voices--; this.stats.liveNodes -= count; };
    layer.active.push(note);
  }
}

class Layer {
  constructor(track, def) {
    const ctx = track.music.ctx;
    this.id = def.id;
    this.voice = def.voice;
    this.params = voiceParams(def.voice, def.params);
    this.scoreGain = def.gain ?? 1;
    this.userGain = 1;
    this.active = [];
    this.input = ctx.createGain();
    this.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (this.pan) this.pan.pan.value = def.pan ?? 0;
    this.fader = ctx.createGain();
    this.fader.gain.value = this.scoreGain;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = def.reverb ?? 0;
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = def.delay ?? 0;
    (this.pan ? this.input.connect(this.pan) : this.input).connect(this.fader);
    this.fader.connect(track.dry);
    this.fader.connect(this.reverbSend).connect(track.reverbBus);
    this.fader.connect(this.delaySend).connect(track.delayIn);
    this.mods = {};
    for (const name of LAYER_PARAMS) {
      const cs = ctx.createConstantSource();
      cs.offset.value = 0;
      track.music.globals[name].connect(cs.offset);
      cs.start();
      this.mods[name] = cs;
    }
    this.nodes = [this.input, this.pan, this.fader, this.reverbSend, this.delaySend, ...Object.values(this.mods)].filter(Boolean);
  }

  setGain(gain, at, fade) {
    this.userGain = gain;
    rampParam(this.fader.gain, this.scoreGain * gain, at, fade);
  }

  dispose(globals) {
    for (const n of this.active) n.dispose();
    for (const [name, cs] of Object.entries(this.mods)) {
      try { globals[name].disconnect(cs.offset); } catch { /* gone */ }
      try { cs.stop(); } catch { /* gone */ }
    }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* gone */ } }
  }
}

class Track {
  constructor(music, score, t0, fade) {
    const ctx = music.ctx;
    this.music = music;
    this.score = score;
    this.id = score.id;
    this.t0 = t0;
    this.timeline = new TrackTimeline(score);
    this.stopAt = null;
    this.disposeAt = null;
    const fx = fxParams(score.fx);

    this.dry = ctx.createGain();
    this.reverbBus = ctx.createGain();
    this.reverbFader = ctx.createGain();
    this.delayIn = ctx.createGain();
    this.delay = ctx.createDelay(4);
    this.delay.delayTime.value = Math.min(3.9, fx.delayBeats * (60 / score.bpm));
    this.delayTone = ctx.createBiquadFilter();
    this.delayTone.type = 'lowpass';
    this.delayTone.frequency.value = fx.delayTone;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = fx.delayFeedback;
    this.delayIn.connect(this.delay).connect(this.delayTone).connect(this.feedback).connect(this.delay);
    this.delayTone.connect(this.dry);
    this.fader = ctx.createGain();
    this.dry.connect(this.fader).connect(music.output);
    this.reverbBus.connect(this.reverbFader).connect(music.reverbIn);
    for (const f of [this.fader, this.reverbFader]) {
      if (fade > 0) {
        f.gain.setValueAtTime(0, t0);
        f.gain.linearRampToValueAtTime(1, t0 + fade);
      }
    }
    this.layers = score.layers.map((def) => new Layer(this, def));
    this.nodes = [this.dry, this.reverbBus, this.reverbFader, this.delayIn, this.delay, this.delayTone, this.feedback, this.fader];
  }

  layer(id) {
    const l = this.layers.find((x) => x.id === id);
    if (!l) throw new RangeError(`track "${this.id}" has no layer "${id}"`);
    return l;
  }

  /** the first bar line at or after `time` */
  nextBar(time) { return nextBarTime(time, this.t0, this.score.bpm, this.score.beatsPerBar); }

  position(now) {
    const { bar, beat } = secondsToBarBeat(Math.max(0, now - this.t0), this.score.bpm, this.score.beatsPerBar);
    return { bar, beat: Math.round(beat * 1000) / 1000, loopBar: bar % this.score.bars };
  }

  schedule(from, to, now) {
    const end = this.stopAt === null ? to : Math.min(to, this.stopAt);
    for (const ev of this.timeline.eventsInWindow(this.t0, from, end)) this.music.noteOn(this.layers[ev.layer], ev, now);
  }

  /** no new notes after `at + fade`; the faders reach silence by then; nodes are freed after the tails */
  fadeOut(at, fade) {
    this.stopAt = at + fade;
    this.disposeAt = this.stopAt + TAIL_SECONDS;
    for (const f of [this.fader, this.reverbFader]) rampParam(f.gain, 0, at, Math.max(fade, 0.02));
  }

  dispose() {
    for (const l of this.layers) l.dispose(this.music.globals);
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* gone */ } }
  }
}
