// Small reusable synthesis pieces for the sound effects (step 5.5): shared noise buffers, a Voice (the nodes of one
// sound, which free themselves when the sound ends), a capped VoicePool, and the primitives the recipes in sounds.js
// are built from: filtered noise, an enveloped oscillator (optionally filtered), and a two-operator FM hit.
// Nothing here reads a clock of its own: every start time is passed in (the audio clock, or an offline render's).
import { mulberry32 } from '../music/voices.js';

const buffers = new WeakMap();
const NOISE_SECONDS = 4;

/**
 * A looping noise buffer per context and colour, seeded (offline renders are reproducible).
 * @param {BaseAudioContext} ctx
 * @param {'white'|'pink'|'brown'} [color]
 */
export function noiseBuffer(ctx, color = 'white') {
  let map = buffers.get(ctx);
  if (!map) { map = {}; buffers.set(ctx, map); }
  if (map[color]) return map[color];
  const len = Math.round(ctx.sampleRate * NOISE_SECONDS);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const rnd = mulberry32(color === 'white' ? 0x51ab : color === 'pink' ? 0x9172 : 0x3b0b);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < len; i++) {
    const w = rnd() * 2 - 1;
    if (color === 'pink') {
      // Paul Kellet's refined pink filter
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else if (color === 'brown') {
      br = (br + 0.02 * w) / 1.02;
      d[i] = br * 3.5;
    } else d[i] = w;
  }
  // a loop must not click at its seam: fade the last 10 ms into the first
  const f = Math.round(ctx.sampleRate * 0.01);
  for (let i = 0; i < f; i++) { const a = i / f; d[len - f + i] = d[len - f + i] * (1 - a) + d[i] * a; }
  map[color] = buf;
  return buf;
}

/** the nodes of one sound: built by a recipe, freed when its sources have ended */
export class Voice {
  constructor(pool, dest, { pan = 0, gain = 1, priority = 1, name = '' } = {}) {
    const ctx = pool.ctx;
    this.pool = pool;
    this.ctx = ctx;
    this.name = name;
    this.priority = priority;
    this.started = ctx.currentTime;
    this.end = ctx.currentTime;
    this.sources = [];
    this.nodes = [];
    this.pending = 0;
    this.disposed = false;
    this.out = ctx.createGain();
    this.out.gain.value = gain;
    this.panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (this.panner) {
      this.panner.pan.value = Math.max(-1, Math.min(1, pan));
      this.out.connect(this.panner).connect(dest);
    } else this.out.connect(dest);
    this.nodes.push(this.out);
    if (this.panner) this.nodes.push(this.panner);
  }

  /** keep a node to free with the voice */
  add(node) { this.nodes.push(node); return node; }

  /** start and stop a source node, and count it */
  run(src, t, end, offset = 0) {
    this.add(src);
    if (offset) src.start(t, offset); else src.start(t);
    src.stop(end);
    this.sources.push(src);
    this.pending++;
    src.onended = () => { if (--this.pending <= 0) this.dispose(); };
    if (end > this.end) this.end = end;
    return src;
  }

  /** cut the voice short (stolen): a 20 ms fade, then stop */
  stop(at = this.ctx.currentTime) {
    if (this.disposed) return;
    const g = this.out.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(0, at, 0.006);
    for (const s of this.sources) { try { s.stop(at + 0.04); } catch { /* already stopped */ } }
    this.end = Math.min(this.end, at + 0.04);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* gone */ } }
    this.pool.release(this);
  }
}

/** a cap on simultaneous one-shot voices; the oldest of the lowest priority is stolen when it is full */
export class VoicePool {
  constructor(ctx, { max = 24 } = {}) {
    this.ctx = ctx;
    this.max = max;
    this.active = [];
    this.stats = { started: 0, stolen: 0, dropped: 0, peak: 0, liveNodes: 0 };
  }

  /** @returns {Voice|null} null when the pool is full of more important sounds */
  voice(dest, opts = {}) {
    this.prune();
    if (this.active.length >= this.max) {
      let victim = null;
      for (const v of this.active) if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.started < victim.started)) victim = v;
      if (!victim || victim.priority > (opts.priority ?? 1)) { this.stats.dropped++; return null; }
      victim.stop();
      victim.dispose();
      this.stats.stolen++;
    }
    const v = new Voice(this, dest, opts);
    this.active.push(v);
    this.stats.started++;
    this.stats.peak = Math.max(this.stats.peak, this.active.length);
    return v;
  }

  /** voices whose `onended` never came (some contexts, or a stopped one) are freed by their end time */
  prune(now = this.ctx.currentTime) {
    for (const v of this.active.slice()) if (now > v.end + 1) v.dispose();
  }

  release(v) {
    const i = this.active.indexOf(v);
    if (i >= 0) this.active.splice(i, 1);
  }

  /** nodes held by live voices right now */
  get liveNodes() { return this.active.reduce((n, v) => n + v.nodes.length, 0); }
}

// ---- envelopes and primitives --------------------------------------------------------------------------------

const FLOOR = 1e-4;

/** attack to `peak`, then an exponential fall to silence at `t + dur` */
export function envelope(param, t, { attack = 0.005, peak = 1, dur = 0.2, curve = 'exp' } = {}) {
  const a = Math.max(0.002, Math.min(attack, dur * 0.9));
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  if (curve === 'linear') param.linearRampToValueAtTime(0, t + dur);
  else {
    param.exponentialRampToValueAtTime(Math.max(FLOOR, peak * FLOOR), t + dur);
    param.setValueAtTime(0, t + dur + 0.001);
  }
  return t + dur + 0.002;
}

/** a rising envelope that cuts off: a reversed sound */
export function reverseEnvelope(param, t, { peak = 1, dur = 1.5, cut = 0.05 } = {}) {
  param.setValueAtTime(FLOOR, t);
  param.exponentialRampToValueAtTime(peak, t + dur);
  param.linearRampToValueAtTime(0, t + dur + cut);
  return t + dur + cut + 0.002;
}

function glide(param, t, from, to, dur) {
  param.setValueAtTime(from, t);
  if (to !== undefined && to !== from) param.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
}

/**
 * Filtered noise through an envelope into the voice.
 * @param {Voice} v
 * @param {{ t: number, dur: number, color?: string, filter?: BiquadFilterType, freq?: number, freqEnd?: number, q?: number,
 *   attack?: number, peak?: number, curve?: string, reverse?: boolean, offset?: number, rate?: number, dest?: AudioNode }} o
 * @returns {number} the end time
 */
export function noise(v, o) {
  const ctx = v.ctx;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, o.color ?? 'white');
  src.loop = true;
  if (o.rate) src.playbackRate.value = o.rate;
  const f = v.add(ctx.createBiquadFilter());
  f.type = o.filter ?? 'bandpass';
  glide(f.frequency, o.t, o.freq ?? 1000, o.freqEnd, o.dur);
  f.Q.value = o.q ?? 1;
  const g = v.add(ctx.createGain());
  const end = o.reverse ? reverseEnvelope(g.gain, o.t, o) : envelope(g.gain, o.t, o);
  src.connect(f).connect(g).connect(o.dest ?? v.out);
  // offset: where in the buffer to start, so two hits never sound identical
  v.run(src, o.t, end, o.offset ?? 0);
  return end;
}

/**
 * An enveloped oscillator, with an optional pitch glide, vibrato and filter.
 * @param {Voice} v
 * @param {{ t: number, dur: number, type?: OscillatorType, freq: number, freqEnd?: number, attack?: number, peak?: number,
 *   curve?: string, filter?: BiquadFilterType, cutoff?: number, cutoffEnd?: number, q?: number, vibrato?: number,
 *   vibratoRate?: number, detune?: number, dest?: AudioNode }} o
 */
export function tone(v, o) {
  const ctx = v.ctx;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  glide(osc.frequency, o.t, o.freq, o.freqEnd, o.dur);
  if (o.detune) osc.detune.value = o.detune;
  const g = v.add(ctx.createGain());
  const end = envelope(g.gain, o.t, o);
  let head = osc;
  if (o.filter) {
    const f = v.add(ctx.createBiquadFilter());
    f.type = o.filter;
    glide(f.frequency, o.t, o.cutoff ?? 1000, o.cutoffEnd, o.dur);
    f.Q.value = o.q ?? 1;
    head.connect(f);
    head = f;
  }
  head.connect(g).connect(o.dest ?? v.out);
  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.vibratoRate ?? 5.5;
    const depth = v.add(ctx.createGain());
    depth.gain.value = o.vibrato;
    lfo.connect(depth).connect(osc.frequency);
    v.run(lfo, o.t, end);
  }
  v.run(osc, o.t, end);
  return end;
}

/**
 * A two-operator FM hit: inharmonic metal, bells, stingers.
 * @param {Voice} v
 * @param {{ t: number, dur: number, freq: number, ratio?: number, index?: number, indexDecay?: number, attack?: number,
 *   peak?: number, dest?: AudioNode }} o
 */
export function fm(v, o) {
  const ctx = v.ctx;
  const car = ctx.createOscillator();
  car.frequency.value = o.freq;
  const mod = ctx.createOscillator();
  mod.frequency.value = o.freq * (o.ratio ?? 1.4);
  const depth = v.add(ctx.createGain());
  const idx = o.freq * (o.index ?? 2);
  depth.gain.setValueAtTime(idx, o.t);
  depth.gain.exponentialRampToValueAtTime(Math.max(1, idx * 0.05), o.t + o.dur * (o.indexDecay ?? 0.5));
  mod.connect(depth).connect(car.frequency);
  const g = v.add(ctx.createGain());
  const end = envelope(g.gain, o.t, o);
  car.connect(g).connect(o.dest ?? v.out);
  v.run(mod, o.t, end);
  v.run(car, o.t, end);
  return end;
}

/** a bandpass "formant" bank fed by one source: returns the node to connect the source into */
export function formants(v, list, dest) {
  const ctx = v.ctx;
  const input = v.add(ctx.createGain());
  for (const [freq, q, gain] of list) {
    const f = v.add(ctx.createBiquadFilter());
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = v.add(ctx.createGain());
    g.gain.value = gain;
    input.connect(f).connect(g).connect(dest);
  }
  return input;
}

/** dB to gain */
export const dbToGain = (db) => 10 ** (db / 20);
