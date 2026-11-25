// Synth voices: each builds the nodes for one note, schedules them, and frees every node after the release.
// Parameters come from the score (schema.js lists them with ranges and defaults). Nothing here reads a clock or
// Math.random: noise and the reverb come from a seeded generator, so offline renders are reproducible.
import { midiToFreq } from './theory.js';
import { hashUnit } from './mini.js';
import { VOICES, voiceParams } from './schema.js';

const FLOOR = 1e-4;   // -80 dB: where exponential releases end before the last linear step to silence

/** seeded PRNG (mulberry32) for noise buffers and impulse responses */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noiseBuffers = new WeakMap();

/** 2 s of white noise per context, shared by every percussion note */
function noiseBuffer(ctx) {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 2), ctx.sampleRate);
    const d = buf.getChannelData(0);
    const rnd = mulberry32(0x5e17);
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

/**
 * Gated ADSR on `param` (a gain): attack to `peak`, decay to sustain, release after `dur`. The value at the release
 * is computed, not read, so the whole envelope can be scheduled ahead of time. Returns the time the note is silent.
 */
export function gateEnvelope(param, t, dur, { attack, decay, sustain, release }, peak) {
  const a = Math.max(0.003, attack);
  const off = t + Math.max(dur, 0.01);
  param.setValueAtTime(0, t);
  let vOff;
  if (off <= t + a) {
    vOff = (peak * (off - t)) / a;
    param.linearRampToValueAtTime(vOff, off);
  } else {
    param.linearRampToValueAtTime(peak, t + a);
    const s = peak * sustain;
    const tau = Math.max(decay, 0.005) / 3;
    param.setTargetAtTime(s, t + a, tau);
    vOff = s + (peak - s) * Math.exp(-(off - t - a) / tau);
    param.setValueAtTime(vOff, off);
  }
  const r = Math.max(0.01, release);
  return releaseFrom(param, off, Math.max(vOff, 1e-7), r);
}

/** Percussive envelope: attack, then an exponential fall reaching -60 dB after `decay` seconds. */
export function percEnvelope(param, t, attack, decay, peak) {
  const a = Math.max(0.001, attack);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.exponentialRampToValueAtTime(Math.max(peak * 1e-3, 1e-7), t + a + decay);
  param.linearRampToValueAtTime(0, t + a + decay + 0.01);
  return t + a + decay + 0.015;
}

function releaseFrom(param, off, vOff, r) {
  param.exponentialRampToValueAtTime(Math.min(vOff, FLOOR), off + r);
  param.linearRampToValueAtTime(0, off + r + 0.01);
  return off + r + 0.015;
}

/** One sounding note: its nodes, its sources, and the modulation links to break when it ends. */
class Note {
  constructor(ctx, mods) {
    this.ctx = ctx;
    this.mods = mods;
    this.nodes = [];
    this.sources = [];
    this.links = [];
    this.env = null;
    this.stopTime = 0;
    this.disposed = false;
    this.onDispose = null;
  }

  add(node) { this.nodes.push(node); return node; }

  osc(type, freq) {
    const o = this.add(this.ctx.createOscillator());
    o.type = type;
    o.frequency.value = freq;
    this.sources.push(o);
    return o;
  }

  gain(value = 1) { const g = this.add(this.ctx.createGain()); g.gain.value = value; return g; }

  filter(type, freq, q = 0.7) {
    const f = this.add(this.ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = Math.min(freq, this.ctx.sampleRate * 0.45);
    f.Q.value = q;
    return f;
  }

  panner(pan) {
    if (!this.ctx.createStereoPanner) return null;
    const p = this.add(this.ctx.createStereoPanner());
    p.pan.value = pan;
    return p;
  }

  /** connect a layer modulation source ('detune' or 'brightness', in cents) to a param of this note */
  mod(kind, param) {
    const src = this.mods?.[kind];
    if (!src) return;
    src.connect(param);
    this.links.push([src, param]);
  }

  /** start every source at `t` and stop it at `stopTime`; the note frees itself when they end */
  start(t, stopTime) {
    this.stopTime = stopTime;
    for (const s of this.sources) {
      if (s.offsetHint !== undefined) s.start(t, s.offsetHint); else s.start(t);
      s.stop(stopTime);
    }
    // every source stops at the same time; the first to end frees the whole note
    this.sources[0].onended = () => this.dispose();
  }

  /** cut the note short at `at` (polyphony stealing): a 15 ms fade, then stop */
  steal(at) {
    if (this.disposed || at >= this.stopTime) return;
    if (this.env) {
      this.env.gain.cancelScheduledValues(at);
      this.env.gain.setTargetAtTime(0, at, 0.015);
    }
    const end = at + 0.1;
    for (const s of this.sources) { try { s.stop(end); } catch { /* already stopped */ } }
    this.stopTime = end;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [src, param] of this.links) { try { src.disconnect(param); } catch { /* already gone */ } }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* already gone */ } }
    this.links.length = 0;
    this.onDispose?.(this);
  }
}

// ---- the voices -------------------------------------------------------------------------------------------
// Each takes (note, { t, dur, freq, name, p, out }) and returns the stop time.

const spread = (i, n) => (n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0);

const BUILDERS = {
  pad(n, { t, dur, freq, p, out }) {
    const count = Math.round(p.voices);
    const lp = n.filter('lowpass', p.cutoff, p.q);
    n.mod('brightness', lp.detune);
    const env = n.env = n.gain(0);
    lp.connect(env).connect(out);
    for (let i = 0; i < count; i++) {
      const o = n.osc(p.wave, freq);
      o.detune.value = spread(i, count) * p.detune;
      n.mod('detune', o.detune);
      const pan = p.width > 0 && count > 1 ? n.panner(spread(i, count) * p.width) : null;
      if (pan) o.connect(pan).connect(lp); else o.connect(lp);
    }
    return gateEnvelope(env.gain, t, dur, p, p.level / Math.sqrt(count));
  },

  pluck(n, { t, freq, p, out }) {
    const o = n.osc(p.wave, freq);
    n.mod('detune', o.detune);
    const lp = n.filter('lowpass', p.cutoff, p.q);
    n.mod('brightness', lp.detune);
    const top = Math.min(p.cutoff * (1 + p.envAmount), n.ctx.sampleRate * 0.45);
    lp.frequency.setValueAtTime(top, t);
    lp.frequency.exponentialRampToValueAtTime(Math.min(p.cutoff, top), t + p.attack + p.decay * 0.4);
    const env = n.env = n.gain(0);
    o.connect(lp).connect(env).connect(out);
    return percEnvelope(env.gain, t, p.attack, p.decay, p.level);
  },

  bass(n, { t, dur, freq, p, out }) {
    const lp = n.filter('lowpass', p.cutoff, p.q);
    n.mod('brightness', lp.detune);
    const o = n.osc(p.wave, freq);
    n.mod('detune', o.detune);
    o.connect(lp);
    if (p.sub > 0) {
      const s = n.osc('sine', freq);
      n.mod('detune', s.detune);
      s.connect(n.gain(p.sub)).connect(lp);
    }
    const env = n.env = n.gain(0);
    lp.connect(env).connect(out);
    return gateEnvelope(env.gain, t, dur, p, p.level / (1 + p.sub * 0.5));
  },

  bell(n, { t, freq, p, out }) {
    const lp = n.filter('lowpass', p.cutoff, 0.5);
    n.mod('brightness', lp.detune);
    const env = n.env = n.gain(0);
    lp.connect(env).connect(out);
    const car = n.osc('sine', freq);
    const mod = n.osc('sine', freq * p.ratio);
    n.mod('detune', car.detune);
    n.mod('detune', mod.detune);
    const depth = n.gain(0);
    const peakDepth = freq * p.index;
    const bright = Math.max(0.02, p.decay * p.brightDecay);
    depth.gain.setValueAtTime(peakDepth, t);
    depth.gain.exponentialRampToValueAtTime(Math.max(peakDepth * 0.02, 1e-3), t + bright);
    mod.connect(depth).connect(car.frequency);
    car.connect(lp);
    const end = percEnvelope(env.gain, t, p.attack, p.decay, p.level);
    if (p.partial > 0) {
      const part = n.osc('sine', freq * p.partialRatio);
      n.mod('detune', part.detune);
      const pg = n.gain(0);
      part.connect(pg).connect(lp);
      percEnvelope(pg.gain, t, p.attack, p.decay * 0.45, p.partial);
    }
    return end;
  },

  drone(n, { t, dur, freq, p, out }) {
    const lp = n.filter('lowpass', p.cutoff, p.q);
    n.mod('brightness', lp.detune);
    const lfo = n.osc('sine', p.lfoRate);
    const lfoCut = n.gain(p.lfoDepth);
    lfo.connect(lfoCut).connect(lp.frequency);
    // a second, slower LFO bends the two oscillators against each other: the slow beating of a drone
    const lfo2 = n.osc('sine', p.lfoRate * 0.61);
    const drift = n.gain(p.drift);
    const driftInv = n.gain(-p.drift);
    lfo2.connect(drift);
    lfo2.connect(driftInv);
    for (const [side, d] of [[-1, drift], [1, driftInv]]) {
      const o = n.osc(p.wave, freq);
      o.detune.value = (side * p.detune) / 2;
      n.mod('detune', o.detune);
      d.connect(o.detune);
      const pan = n.panner(side * 0.35);
      if (pan) o.connect(pan).connect(lp); else o.connect(lp);
    }
    if (p.sub > 0) {
      const s = n.osc('sine', freq / 2);
      n.mod('detune', s.detune);
      s.connect(n.gain(p.sub)).connect(lp);
    }
    const env = n.env = n.gain(0);
    lp.connect(env).connect(out);
    return gateEnvelope(env.gain, t, dur, p, p.level);
  },

  perc(n, { t, name, p, out }) {
    const env = n.env = n.gain(0);
    env.connect(out);
    const noise = () => {
      const s = n.add(n.ctx.createBufferSource());
      s.buffer = noiseBuffer(n.ctx);
      s.loop = true;
      n.sources.push(s);
      // a different stretch of the noise for each hit, chosen by time so renders stay reproducible
      s.loopStart = 0;
      s.loopEnd = s.buffer.duration;
      s.offsetHint = (t * 7.31) % 1.5;
      return s;
    };
    if (name === 'thud') {
      const o = n.osc('sine', 85 * p.tone);
      o.frequency.setValueAtTime(85 * p.tone, t);
      o.frequency.exponentialRampToValueAtTime(40 * p.tone, t + 0.14 * p.decay);
      o.connect(env);
      const nz = noise();
      const lp = n.filter('lowpass', 260 * p.tone, 0.7);
      const ng = n.gain(0);
      nz.connect(lp).connect(ng).connect(env);
      percEnvelope(ng.gain, t, 0.001, 0.05 * p.decay, 0.35);
      return percEnvelope(env.gain, t, 0.002, 0.45 * p.decay, p.level);
    }
    if (name === 'shaker') {
      const nz = noise();
      const hp = n.filter('highpass', 5200 * p.tone, 0.8);
      const lp = n.filter('lowpass', Math.min(11000 * p.tone, 16000), 0.5);
      n.mod('brightness', lp.detune);
      nz.connect(hp).connect(lp).connect(env);
      return percEnvelope(env.gain, t, 0.012, 0.08 * p.decay, p.level);
    }
    if (name === 'breath') {
      // a slow swell of band-passed noise: air, wind, someone breathing close by
      const nz = noise();
      const bp = n.filter('bandpass', 900 * p.tone, 0.9);
      const lp = n.filter('lowpass', Math.min(3200 * p.tone, 16000), 0.5);
      n.mod('brightness', bp.detune);
      nz.connect(bp).connect(lp).connect(env);
      return percEnvelope(env.gain, t, 0.35 * p.decay, 0.9 * p.decay, p.level * 1.6);
    }
    if (name === 'tick') {
      // a dry, small, high tick: insects, a clock, a twig
      const nz = noise();
      const bp = n.filter('bandpass', 5200 * p.tone, 6);
      n.mod('brightness', bp.detune);
      nz.connect(bp).connect(env);
      return percEnvelope(env.gain, t, 0.0005, 0.012 * p.decay, p.level * 2.5);
    }
    if (name === 'knock') {
      // wood: a short pitched body plus a burst of mid noise
      const o = n.osc('sine', 340 * p.tone);
      o.frequency.setValueAtTime(380 * p.tone, t);
      o.frequency.exponentialRampToValueAtTime(300 * p.tone, t + 0.05);
      o.connect(env);
      const nz = noise();
      const bp = n.filter('bandpass', 1100 * p.tone, 2);
      n.mod('brightness', bp.detune);
      const ng = n.gain(0);
      nz.connect(bp).connect(ng).connect(env);
      percEnvelope(ng.gain, t, 0.0005, 0.03 * p.decay, 0.5);
      return percEnvelope(env.gain, t, 0.001, 0.12 * p.decay, p.level);
    }
    // click
    const nz = noise();
    const bp = n.filter('bandpass', 2400 * p.tone, 3);
    n.mod('brightness', bp.detune);
    nz.connect(bp).connect(env);
    return percEnvelope(env.gain, t, 0.0005, 0.02 * p.decay, p.level * 2);
  },
};

/** number of nodes (sources, gains, filters, panners) a note of this voice allocates, for the leak checks */
export const noteNodeCount = (note) => note.nodes.length;

/**
 * Build and schedule one note.
 * @param {BaseAudioContext} ctx
 * @param {string} voice a key of VOICES
 * @param {{ time: number, duration: number, note: { midi?: number, name?: string }, params: object,
 *   out: AudioNode, mods?: { detune?: AudioNode, brightness?: AudioNode } }} opts params already merged with defaults
 * @returns {Note} with `stopTime`, `steal(at)`, `onDispose`, `nodes`
 */
export function playNote(ctx, voice, { time, duration, note, params, out, mods }) {
  const build = BUILDERS[voice];
  if (!build) throw new RangeError(`unknown voice "${voice}"`);
  const n = new Note(ctx, mods);
  // per-note variation, seeded by the note's time so renders stay reproducible: a little out of tune, a little
  // uneven in level, never the same twice in a row
  const h1 = hashUnit(Math.round(time * 1e4), 1);
  const h2 = hashUnit(Math.round(time * 1e4), 2);
  const cents = (params.tune ?? 0) + (h1 * 2 - 1) * (params.jitter ?? 0);
  const freq = note.midi !== undefined ? midiToFreq(note.midi) * 2 ** (cents / 1200) : 0;
  const p = params.humanise ? { ...params, level: params.level * (1 - params.humanise * h2) } : params;
  n.start(time, build(n, { t: time, dur: duration, freq, name: note.name, p, out }));
  return n;
}

export { VOICES, voiceParams };
