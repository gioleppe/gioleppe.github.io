// The continuous ambience beds (step 5.5): surf, wind, rain, the jungle by day and by night, the mangrove water,
// and the Resonance hum. Each bed is a handful of long-lived nodes built once (a few dozen in all, no churn); its
// level follows ambienceFor() (mixRules.js) with slow ramps, so beds crossfade as the player moves and the day turns.
// What makes a bed sound alive rather than looped is scheduled on the audio clock with the presentation's own random
// source: surf swells, gusting filters, cricket bursts, birds, drips, plops and the rare thunder.
import { noiseBuffer, dbToGain } from './synth.js';

const RAMP = 1.2;   // seconds: bed level changes (the region crossfade)

export const BED_DEFAULTS = Object.freeze({
  surf: -6, wind: -14, rain: -8, rainDrips: 7, jungleDay: -16, birds: 0.25, jungleNight: -20, mangrove: -14,
  hum: -10, thunderEvery: [25, 70],
});

const rr = (rnd, a, b) => a + (b - a) * rnd();

export class Ambience {
  /**
   * @param {{ ctx: BaseAudioContext, out: AudioNode, play: (name: string, opts: object) => any, random?: () => number,
   *   cfg?: object }} opts `play` starts a one-shot recipe (the Sfx's), used for the beds' grains
   */
  constructor({ ctx, out, play, random = Math.random, cfg = {} }) {
    this.ctx = ctx;
    this.play = play;
    this.rnd = random;
    this.cfg = { ...BED_DEFAULTS, ...cfg };
    this.nodes = [];
    this.sources = [];
    this.levels = {};
    this.target = {};
    const now = ctx.currentTime;
    this.next = { swellL: now + 0.5, swellR: now + 2.5, gust: now, cricketA: now + 0.3, cricketB: now + 0.8, bird: now + 2,
      nightBird: now + 15, drip: now + 0.2, lap: now + 1, plop: now + 4, thunder: now + rr(this.rnd, ...this.cfg.thunderEvery) };

    const bus = (name) => {
      const g = this.#node(ctx.createGain());
      g.gain.value = 0;
      g.connect(out);
      this.levels[name] = 0;
      return g;
    };
    this.bus = {
      surf: bus('surf'), wind: bus('wind'), rain: bus('rain'), jungleDay: bus('jungleDay'), jungleNight: bus('jungleNight'),
      mangrove: bus('mangrove'), hum: bus('hum'),
    };
    this.#buildSurf();
    this.#buildWind();
    this.#buildRain();
    this.#buildJungle();
    this.#buildMangrove();
    this.#buildHum();
  }

  #node(n) { this.nodes.push(n); return n; }

  #loop(color, offset = 0) {
    const s = this.#node(this.ctx.createBufferSource());
    s.buffer = noiseBuffer(this.ctx, color);
    s.loop = true;
    s.start(this.ctx.currentTime, offset);
    this.sources.push(s);
    return s;
  }

  #filter(type, freq, q = 0.7) {
    const f = this.#node(this.ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  #gain(v = 0) {
    const g = this.#node(this.ctx.createGain());
    g.gain.value = v;
    return g;
  }

  #pan(v) {
    const ctx = this.ctx;
    if (!ctx.createStereoPanner) return this.#gain(1);
    const p = this.#node(ctx.createStereoPanner());
    p.pan.value = v;
    return p;
  }

  #osc(type, freq) {
    const o = this.#node(this.ctx.createOscillator());
    o.type = type;
    o.frequency.value = freq;
    o.start();
    this.sources.push(o);
    return o;
  }

  // surf: two sides of pink noise whose low-pass and level swell on their own clocks, and a foam hiss on the crests
  #buildSurf() {
    this.surf = [-0.55, 0.55].map((pan, i) => {
      const f = this.#filter('lowpass', 500, 0.5);
      const g = this.#gain(0.15);
      this.#loop('pink', i * 1.7).connect(f).connect(g).connect(this.#pan(pan)).connect(this.bus.surf);
      return { f, g };
    });
    this.foamF = this.#filter('highpass', 2500, 0.5);
    this.foam = this.#gain(0);
    this.#loop('white', 0.9).connect(this.foamF).connect(this.foam).connect(this.bus.surf);
  }

  #buildWind() {
    this.windF = this.#filter('bandpass', 500, 0.9);
    this.windG = this.#gain(0.7);
    this.#loop('pink', 2.3).connect(this.windF).connect(this.windG).connect(this.bus.wind);
  }

  // rain: dense broadband hiss plus a darker body; the close drips are scheduled grains
  #buildRain() {
    const hp = this.#filter('highpass', 1200, 0.5);
    const lp = this.#filter('lowpass', 9000, 0.5);
    this.#loop('white', 3.1).connect(hp).connect(lp).connect(this.#gain(0.55)).connect(this.bus.rain);
    const body = this.#filter('lowpass', 1400, 0.5);
    this.#loop('pink', 0.4).connect(body).connect(this.#gain(0.6)).connect(this.bus.rain);
  }

  // jungle by day: two narrow insect bands buzzing at different rates; birds are grains. By night: two crickets,
  // a sine each, chopped by a square LFO into chirps, with bursts scheduled at uneven intervals.
  #buildJungle() {
    for (const [freq, q, rate, pan] of [[4800, 12, 32, -0.4], [7200, 15, 41, 0.45]]) {
      const f = this.#filter('bandpass', freq, q);
      const am = this.#gain(0.6);
      const lfo = this.#osc('sine', rate);
      const depth = this.#gain(0.4);
      lfo.connect(depth).connect(am.gain);
      this.#loop('white', freq / 3000).connect(f).connect(am).connect(this.#gain(1.6)).connect(this.#pan(pan)).connect(this.bus.jungleDay);
    }
    this.crickets = [[4300, 14, -0.5], [4750, 17, 0.5]].map(([freq, rate, pan]) => {
      const osc = this.#osc('sine', freq);
      const chop = this.#gain(0.5);
      const lfo = this.#osc('square', rate);
      const depth = this.#gain(0.5);
      lfo.connect(depth).connect(chop.gain);
      const burst = this.#gain(0);
      osc.connect(chop).connect(burst).connect(this.#pan(pan)).connect(this.bus.jungleNight);
      return burst;
    });
    // a low, distant night drone of frogs and insects under the crickets
    const f = this.#filter('bandpass', 2400, 3);
    this.#loop('pink', 1.1).connect(f).connect(this.#gain(0.25)).connect(this.bus.jungleNight);
  }

  // mangroves: water lapping at roots (the music has the drips and frogs: this only adds the water and plops)
  #buildMangrove() {
    this.lapF = this.#filter('lowpass', 450, 0.6);
    this.lap = this.#gain(0.2);
    this.#loop('pink', 2.7).connect(this.lapF).connect(this.lap).connect(this.bus.mangrove);
  }

  // the Resonance hum (spec §6.3): near-harmonic partials on A1; a second, detuned set beats against them when
  // Agitated; a very slow LFO drifts the pitch of everything
  #buildHum() {
    const lp = this.#filter('lowpass', 600, 0.5);
    lp.connect(this.bus.hum);
    const drift = this.#osc('sine', 0.07);
    this.humDrift = this.#gain(0);
    drift.connect(this.humDrift);
    const stable = this.#gain(1);
    this.humBeat = this.#gain(0);
    stable.connect(lp);
    this.humBeat.connect(lp);
    for (const [freq, g, set] of [[55, 0.6, stable], [110.6, 0.3, stable], [165.2, 0.15, stable], [55.7, 0.5, this.humBeat], [111.9, 0.3, this.humBeat], [83.1, 0.2, this.humBeat]]) {
      const o = this.#osc('sine', freq);
      this.humDrift.connect(o.detune);
      o.connect(this.#gain(g)).connect(set);
    }
  }

  /**
   * Follow the levels for this frame and schedule the beds' grains up to a short horizon ahead.
   * @param {ReturnType<import('./mixRules.js').ambienceFor>} amb
   * @param {number} [now] audio-clock seconds
   */
  update(amb, now = this.ctx.currentTime) {
    const c = this.cfg;
    const set = (name, level) => {
      const v = Math.round(level * 100) / 100;
      if (this.target[name] === v) return;
      this.target[name] = v;
      const g = this.bus[name].gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(v * dbToGain(c[name]), now, RAMP / 3);
    };
    set('surf', amb.surf);
    set('wind', amb.wind);
    set('rain', amb.rain);
    set('jungleDay', amb.jungleDay);
    set('jungleNight', amb.jungleNight);
    set('mangrove', amb.mangrove);
    set('hum', amb.hum);
    this.levels = { ...this.target };
    if (this.target.instability !== amb.humInstability) {
      this.target.instability = amb.humInstability;
      this.humBeat.gain.setTargetAtTime(amb.humInstability, now, 1);
      this.humDrift.gain.setTargetAtTime(4 + 14 * amb.humInstability, now, 1);
    }
    this.#grains(amb, now);
  }

  #due(key, now, horizon, interval, active) {
    if (!active) { this.next[key] = Math.max(this.next[key], now + interval() * 0.3); return null; }
    if (this.next[key] < now) this.next[key] = now + 0.02 + this.rnd() * 0.1;   // a stall or a wake-up: no burst
    if (this.next[key] > now + horizon) return null;
    const at = this.next[key];
    this.next[key] = at + interval();
    return at;
  }

  #grains(amb, now) {
    const H = 0.25;
    const r = this.rnd;
    // surf swells, each side on its own uneven clock
    for (const [i, key] of [[0, 'swellL'], [1, 'swellR']]) {
      const at = this.#due(key, now, H, () => rr(r, 4, 8) / amb.surfRate, amb.surf > 0.01);
      if (at === null) continue;
      const { f, g } = this.surf[i];
      const rise = rr(r, 1.6, 2.6);
      const crest = rr(r, 0.6, 1);
      g.gain.setTargetAtTime(crest, at, rise / 3);
      g.gain.setTargetAtTime(rr(r, 0.12, 0.22), at + rise, rr(r, 1, 1.8));
      f.frequency.setTargetAtTime(rr(r, 1100, 1600), at, rise / 3);
      f.frequency.setTargetAtTime(rr(r, 380, 520), at + rise, 1.2);
      if (i === 0 || r() < 0.5) {
        this.foam.gain.setTargetAtTime(0.12 * crest, at + rise * 0.7, 0.3);
        this.foam.gain.setTargetAtTime(0, at + rise + 0.4, 0.8);
      }
    }
    // wind: the band wanders
    const gust = this.#due('gust', now, H, () => rr(r, 1.5, 3.5), amb.wind > 0.01);
    if (gust !== null) {
      this.windF.frequency.setTargetAtTime(rr(r, 280, 900), gust, 0.8);
      this.windG.gain.setTargetAtTime(rr(r, 0.5, 1), gust, 0.9);
    }
    // crickets: bursts of chirping at uneven intervals
    for (const [i, key] of [[0, 'cricketA'], [1, 'cricketB']]) {
      const at = this.#due(key, now, H, () => rr(r, 0.6, 1.6), amb.jungleNight > 0.01);
      if (at === null) continue;
      const b = this.crickets[i].gain;
      const len = rr(r, 0.2, 0.5);
      b.setTargetAtTime(rr(r, 0.5, 1), at, 0.02);
      b.setTargetAtTime(0, at + len, 0.03);
    }
    const bird = this.#due('bird', now, H, () => rr(r, 1.5, 7) / Math.max(0.3, amb.jungleDay), amb.jungleDay > 0.05);
    if (bird !== null) this.play('bird', { at: bird, gain: amb.jungleDay * this.cfg.birds * 4, pan: rr(r, -0.8, 0.8) });
    const owl = this.#due('nightBird', now, H, () => rr(r, 18, 45), amb.jungleNight > 0.2);
    if (owl !== null) this.play('night_bird', { at: owl, gain: amb.jungleNight * 0.6, pan: rr(r, -0.7, 0.7) });
    // rain drips close by: density with the intensity
    const drip = this.#due('drip', now, H, () => 1 / Math.max(0.5, this.cfg.rainDrips * amb.rain) * rr(r, 0.3, 1.7), amb.rain > 0.08);
    if (drip !== null) this.play('drip', { at: drip, gain: 0.6 * amb.rain, pan: rr(r, -0.9, 0.9) });
    // mangrove laps and plops
    const lap = this.#due('lap', now, H, () => rr(r, 1.4, 3.4), amb.mangrove > 0.01);
    if (lap !== null) {
      this.lap.gain.setTargetAtTime(rr(r, 0.5, 1), lap, 0.25);
      this.lap.gain.setTargetAtTime(0.15, lap + 0.5, 0.5);
      this.lapF.frequency.setTargetAtTime(rr(r, 350, 650), lap, 0.3);
    }
    const plop = this.#due('plop', now, H, () => rr(r, 3, 9), amb.mangrove > 0.1);
    if (plop !== null) this.play('plop', { at: plop, gain: amb.mangrove, pan: rr(r, -0.8, 0.8) });
    // thunder: rare, only in a strong squall
    const th = this.#due('thunder', now, H, () => rr(r, ...this.cfg.thunderEvery), amb.thunder);
    if (th !== null) this.play('thunder', { at: th, gain: amb.rain, pan: rr(r, -0.6, 0.6), near: r() });
  }

  /** stop and free every bed */
  dispose() {
    for (const s of this.sources) { try { s.stop(); } catch { /* gone */ } }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* gone */ } }
    this.nodes = [];
    this.sources = [];
  }

  get nodeCount() { return this.nodes.length; }
}
