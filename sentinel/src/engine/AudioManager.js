// The one AudioContext of the page, its buses and the rules browsers impose on it.
//
//   music -\
//           +-> master -> limiter -> destination
//   sfx ---/
//
// - The context is created lazily and unlocked by the first pointerdown, keydown or touchend (iOS Safari only
//   counts touchend as a gesture that may start audio; a silent one-sample buffer is played inside the gesture
//   for old Safari versions that need a sound started there).
// - Hidden page: the context is suspended (no music in a background tab, no battery use); visible: resumed.
// - iOS can put a running context in the 'interrupted' state (phone call, Siri) or back to 'suspended': the
//   unlock listeners are armed again, so the next touch resumes it.
// - Volumes (0..1 sliders, squared to gain) and mute are remembered in Settings; every change is a short ramp.
// Step 5.5 connects sound effects and ambience to `buses.sfx` (or to sub-buses of it); nothing else is needed here.
import { Settings } from './Settings.js';
import { rampParam, sliderToGain } from './music/params.js';

export const BUSES = ['master', 'music', 'sfx'];
export const DEFAULT_VOLUMES = { master: 0.8, music: 0.8, sfx: 0.9 };
const GESTURES = ['pointerdown', 'keydown', 'touchend'];
const RAMP = 0.05;

/** gain that cancels a DynamicsCompressorNode's make-up gain for a hard-knee threshold (dB) and ratio */
export function limiterTrim(threshold, ratio) {
  const fullRangeDb = threshold * (1 - 1 / ratio);   // the curve's output for a 0 dBFS input
  return 10 ** ((0.6 * fullRangeDb) / 20);
}

/**
 * Build the bus graph on any context (live or offline; render.js uses it with `limiter: false` to measure).
 * @param {BaseAudioContext} ctx
 * @param {{ limiter?: boolean }} [opts]
 * @returns {{ master: GainNode, music: GainNode, sfx: GainNode, limiter: DynamicsCompressorNode|null, output: AudioNode }}
 *   `output` is the last node before the destination (tap it for a meter)
 */
export function createBuses(ctx, { limiter = true } = {}) {
  const master = ctx.createGain();
  const music = ctx.createGain();
  const sfx = ctx.createGain();
  music.connect(master);
  sfx.connect(master);
  let lim = null;
  let trim = null;
  if (limiter) {
    // as close to a brick wall as DynamicsCompressorNode goes: hard knee, maximum ratio, fast attack
    lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.002;
    lim.release.value = 0.15;
    // DynamicsCompressorNode adds automatic make-up gain (Web Audio spec: (1 / gain at 0 dBFS) ^ 0.6);
    // a limiter must not make things louder, so it is taken back out
    trim = ctx.createGain();
    trim.gain.value = limiterTrim(lim.threshold.value, lim.ratio.value);
    master.connect(lim).connect(trim).connect(ctx.destination);
  } else {
    master.connect(ctx.destination);
  }
  return { master, music, sfx, limiter: lim, output: trim ?? master };
}

export class AudioManager {
  /**
   * @param {{ settings?: Settings, AudioContextClass?: Function, doc?: Document }} [opts] injectable for tests
   */
  constructor({ settings = new Settings(), AudioContextClass, doc = globalThis.document } = {}) {
    this.settings = settings;
    this.AudioContextClass = AudioContextClass ?? globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null;
    this.doc = doc;
    /** @type {AudioContext|null} */
    this.ctx = null;
    this.buses = null;
    this.hiddenSuspend = false;
    this.listeners = new Set();
    this.unlockTargets = new Set();
    this.onGesture = () => this.unlock();
    this.onVisibility = () => this.#visibility();
    doc?.addEventListener?.('visibilitychange', this.onVisibility);
  }

  /** true when the browser has Web Audio at all */
  get supported() { return Boolean(this.AudioContextClass); }

  /** 'none' before the context exists, else the context state ('suspended', 'running', 'interrupted', 'closed') */
  get state() { return this.ctx ? this.ctx.state : 'none'; }

  get context() { return this.ctx; }

  /** create the context and buses if needed (call from a gesture handler on iOS) */
  ensureContext() {
    if (this.ctx || !this.supported) return this.ctx;
    this.ctx = new this.AudioContextClass({ latencyHint: 'interactive' });
    this.buses = createBuses(this.ctx);
    for (const bus of BUSES) this.buses[bus].gain.value = this.#gainFor(bus);
    this.ctx.addEventListener?.('statechange', () => this.#stateChanged());
    this.#emit();
    return this.ctx;
  }

  /**
   * Resume audio on the first user gesture on `target` (window by default). Listeners stay armed until the
   * context runs, and are armed again if the context is interrupted. Returns a function that detaches them.
   */
  attachUnlock(target = globalThis.window) {
    if (!target?.addEventListener) return () => {};
    this.unlockTargets.add(target);
    if (this.state !== 'running') this.#arm(target);
    return () => { this.#disarm(target); this.unlockTargets.delete(target); };
  }

  /** what the gesture handlers call; also callable directly from a "tap to enable audio" button */
  unlock() {
    const ctx = this.ensureContext();
    if (!ctx) return Promise.resolve(false);
    try {
      // a silent sound started inside the gesture unlocks output on older iOS Safari
      const b = ctx.createBufferSource();
      b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      b.connect(ctx.destination);
      b.start(0);
      b.onended = () => b.disconnect();
    } catch { /* not needed elsewhere */ }
    if (ctx.state === 'running') { this.#disarmAll(); return Promise.resolve(true); }
    if (this.doc?.visibilityState === 'hidden') return Promise.resolve(false);
    return ctx.resume().then(() => {
      if (ctx.state === 'running') this.#disarmAll();
      this.#emit();
      return ctx.state === 'running';
    }, () => false);
  }

  /** @param {'master'|'music'|'sfx'} bus @param {number} value 0..1 (slider position) */
  setVolume(bus, value) {
    if (!BUSES.includes(bus)) throw new RangeError(`unknown bus "${bus}"`);
    const v = Math.min(1, Math.max(0, Number(value) || 0));
    this.settings.set(`audio.${bus}`, v);
    this.#apply(bus);
    this.#emit();
  }

  getVolume(bus) {
    const v = this.settings.get(`audio.${bus}`, DEFAULT_VOLUMES[bus]);
    return typeof v === 'number' && v >= 0 && v <= 1 ? v : DEFAULT_VOLUMES[bus];
  }

  setMuted(muted) {
    this.settings.set('audio.muted', Boolean(muted));
    this.#apply('master');
    this.#emit();
  }

  get muted() { return this.settings.get('audio.muted', false) === true; }

  /** listen to state, volume and mute changes; returns an unsubscribe function */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** close the context and remove every listener */
  async dispose() {
    this.#disarmAll();
    this.doc?.removeEventListener?.('visibilitychange', this.onVisibility);
    if (this.ctx && this.ctx.state !== 'closed') await this.ctx.close().catch(() => {});
  }

  #gainFor(bus) {
    if (bus === 'master' && this.muted) return 0;
    return sliderToGain(this.getVolume(bus));
  }

  #apply(bus) {
    if (!this.ctx) return;
    rampParam(this.buses[bus].gain, this.#gainFor(bus), this.ctx.currentTime, RAMP);
  }

  #arm(target) {
    for (const g of GESTURES) target.addEventListener(g, this.onGesture, { capture: true, passive: true });
  }

  #disarm(target) {
    for (const g of GESTURES) target.removeEventListener(g, this.onGesture, { capture: true });
  }

  #disarmAll() { for (const t of this.unlockTargets) this.#disarm(t); }

  #stateChanged() {
    const s = this.ctx.state;
    // interrupted (iOS) or suspended by the system while we wanted it running: resume on the next gesture
    if ((s === 'interrupted' || s === 'suspended') && !this.hiddenSuspend) for (const t of this.unlockTargets) this.#arm(t);
    if (s === 'running') this.#disarmAll();
    this.#emit();
  }

  #visibility() {
    if (!this.ctx) return;
    if (this.doc.visibilityState === 'hidden') {
      if (this.ctx.state === 'running') {
        this.hiddenSuspend = true;
        this.ctx.suspend().catch(() => {});
      }
    } else if (this.hiddenSuspend) {
      this.hiddenSuspend = false;
      // some browsers refuse to resume without a gesture: then the next touch does it
      const rearm = () => { if (this.ctx.state !== 'running') for (const t of this.unlockTargets) this.#arm(t); };
      this.ctx.resume().then(rearm, rearm);
    }
  }

  #emit() {
    const info = { state: this.state, muted: this.muted, volumes: Object.fromEntries(BUSES.map((b) => [b, this.getVolume(b)])) };
    for (const fn of this.listeners) { try { fn(info); } catch { /* a listener bug must not break audio */ } }
  }
}
