// The sound recipes (step 5.5): every one-shot of the game, synthesised from the pieces in synth.js. A recipe is
// `(voice, t, opts, rnd) => end time`: it builds its nodes into `voice.out` starting at audio time `t`; `rnd` is
// the presentation's random source (Math.random live, seeded in renders), never the simulation's.
//
// SOUND_INFO says which sub-bus each sound goes to, its trim (dB) and how much it ducks music and ambience (dB,
// sidechain-style). The category levels themselves live in tuning.audio.sfx.levels.
import { noise, tone, fm, formants } from './synth.js';

const rr = (rnd, a, b) => a + (b - a) * rnd();

/** @type {Object<string, { bus: string, trim?: number, duck?: number, priority?: number }>} */
export const SOUND_INFO = {
  step_sand: { bus: 'player', trim: 0 },
  step_wet_sand: { bus: 'player', trim: 0 },
  step_jungle: { bus: 'player', trim: 0 },
  step_rock: { bus: 'player', trim: -2 },
  step_mud: { bus: 'player', trim: 0 },
  step_wade: { bus: 'player', trim: -1 },
  swim_stroke: { bus: 'player', trim: -1 },
  breath: { bus: 'player', trim: -6 },
  heartbeat: { bus: 'player', trim: -2, priority: 2 },
  hurt: { bus: 'player', trim: 0, duck: 5, priority: 3 },
  gasp: { bus: 'player', trim: -3, priority: 2 },
  bubbles: { bus: 'player', trim: -8 },
  bleed: { bus: 'player', trim: -10 },
  death: { bus: 'player', trim: -5, duck: 8, priority: 3 },
  cloth: { bus: 'player', trim: -12 },
  pickup: { bus: 'world', trim: -6 },
  drop: { bus: 'world', trim: -6 },
  drink: { bus: 'world', trim: -6 },
  bandage: { bus: 'world', trim: -6 },
  herbs: { bus: 'world', trim: -8 },
  click: { bus: 'world', trim: -8 },
  throw: { bus: 'world', trim: -4 },
  impact_ground: { bus: 'world', trim: 0, duck: 3, priority: 2 },
  impact_rock: { bus: 'world', trim: -1, duck: 3, priority: 2 },
  impact_jungle: { bus: 'world', trim: 0, duck: 3, priority: 2 },
  impact_water: { bus: 'world', trim: 0, duck: 3, priority: 2 },
  impact_mud: { bus: 'world', trim: 0, duck: 3, priority: 2 },
  impact_wood: { bus: 'world', trim: -1, duck: 3, priority: 2 },
  craft: { bus: 'world', trim: -6 },
  pry_groan: { bus: 'world', trim: 0, duck: 5, priority: 2 },
  hatch_open: { bus: 'world', trim: 0, duck: 6, priority: 2 },
  patch: { bus: 'world', trim: -8 },
  electric: { bus: 'world', trim: -10 },
  page: { bus: 'ui', trim: 0 },
  journal_open: { bus: 'ui', trim: 0 },
  journal_close: { bus: 'ui', trim: 0 },
  select: { bus: 'ui', trim: -4 },
  confirm: { bus: 'ui', trim: -2 },
  deny: { bus: 'ui', trim: -2 },
  chime: { bus: 'ui', trim: -2 },
  reversed_swell: { bus: 'world', trim: -4, duck: 3 },
  anomaly_pulse: { bus: 'world', trim: -2, duck: 2 },
  tier_swell: { bus: 'world', trim: -8 },
  thunder: { bus: 'amb', trim: 0, duck: 3, priority: 2 },
  drip: { bus: 'amb', trim: -6, priority: 0 },
  bird: { bus: 'amb', trim: -4, priority: 0 },
  night_bird: { bus: 'amb', trim: -8, priority: 0 },
  plop: { bus: 'amb', trim: -8, priority: 0 },
  shout: { bus: 'alert', trim: 0, duck: 5, priority: 3 },
  whistle: { bus: 'alert', trim: -2, duck: 4, priority: 3 },
  bow_creak: { bus: 'alert', trim: -6, priority: 2 },
  arrow_fired: { bus: 'alert', trim: -2, duck: 4, priority: 3 },
  arrow_land: { bus: 'alert', trim: 0, duck: 4, priority: 3 },
  stinger: { bus: 'alert', trim: 0, duck: 8, priority: 3 },
  release: { bus: 'alert', trim: -8, priority: 1 },
};

/** @type {Object<string, (v: import('./synth.js').Voice, t: number, o: object, rnd: () => number) => number>} */
export const SOUNDS = {
  // ---- footsteps: short, dry, varied every step --------------------------------------------------------------
  step_sand: (v, t, o, r) => Math.max(
    noise(v, { t, dur: 0.09, filter: 'lowpass', freq: rr(r, 1100, 1700), q: 0.7, attack: 0.006, peak: 0.6, offset: rr(r, 0, 3) }),
    noise(v, { t: t + 0.008, dur: 0.05, filter: 'highpass', freq: 3500, q: 0.5, peak: 0.16, offset: rr(r, 0, 3) }),
  ),
  step_wet_sand: (v, t, o, r) => Math.max(
    noise(v, { t, dur: 0.11, filter: 'lowpass', freq: rr(r, 600, 850), q: 0.9, attack: 0.008, peak: 0.75, offset: rr(r, 0, 3) }),
    tone(v, { t, dur: 0.06, freq: rr(r, 85, 100), freqEnd: 60, peak: 0.22 }),
  ),
  step_jungle: (v, t, o, r) => {
    let end = noise(v, { t, dur: 0.15, filter: 'bandpass', freq: rr(r, 800, 1100), q: 0.8, attack: 0.01, peak: 0.45, offset: rr(r, 0, 3) });
    end = Math.max(end, noise(v, { t, dur: 0.12, filter: 'bandpass', freq: rr(r, 2000, 2600), q: 1.2, peak: 0.4, offset: rr(r, 0, 3) }));
    for (let i = 0; i < 3; i++) if (r() < 0.7) end = Math.max(end, noise(v, { t: t + rr(r, 0.01, 0.09), dur: 0.014, filter: 'highpass', freq: 4200, peak: rr(r, 0.15, 0.3), offset: rr(r, 0, 3) }));
    return end;
  },
  step_rock: (v, t, o, r) => Math.max(
    noise(v, { t, dur: 0.035, filter: 'bandpass', freq: rr(r, 2500, 3400), q: 3, peak: 0.6, offset: rr(r, 0, 3) }),
    tone(v, { t, dur: 0.06, freq: rr(r, 130, 160), freqEnd: 90, peak: 0.35 }),
  ),
  step_mud: (v, t, o, r) => Math.max(
    noise(v, { t, dur: 0.2, filter: 'bandpass', freq: rr(r, 300, 380), freqEnd: rr(r, 800, 1000), q: 4, attack: 0.02, peak: 0.8, offset: rr(r, 0, 3) }),
    tone(v, { t, dur: 0.08, freq: 170, freqEnd: 110, peak: 0.2 }),
  ),
  step_wade: (v, t, o, r) => Math.max(
    noise(v, { t, dur: 0.24, filter: 'bandpass', freq: rr(r, 1400, 1800), freqEnd: 600, q: 1.5, attack: 0.01, peak: 0.6, offset: rr(r, 0, 3) }),
    noise(v, { t: t + 0.02, dur: 0.12, filter: 'highpass', freq: 3000, peak: 0.2, offset: rr(r, 0, 3) }),
  ),
  swim_stroke: (v, t, o, r) => Math.max(
    noise(v, { t, dur: 0.5, filter: 'lowpass', freq: 1200, freqEnd: 450, q: 0.8, attack: 0.09, peak: 0.5, offset: rr(r, 0, 3) }),
    noise(v, { t: t + 0.12, dur: 0.25, filter: 'bandpass', freq: 2400, q: 1, peak: 0.16, offset: rr(r, 0, 3) }),
  ),

  // ---- the body: breath and heart are not voices (no words), only air and thumps ------------------------------
  breath: (v, t, o, r) => {
    const end = noise(v, { t, dur: 0.55, filter: 'bandpass', freq: 900, freqEnd: 1300, q: 1.6, attack: 0.25, peak: 0.28, color: 'pink', offset: rr(r, 0, 3) });
    return Math.max(end, noise(v, { t: t + 0.6, dur: 0.5, filter: 'bandpass', freq: 850, freqEnd: 650, q: 1.2, attack: 0.04, peak: 0.34, color: 'pink', offset: rr(r, 0, 3) }));
  },
  heartbeat: (v, t) => Math.max(
    tone(v, { t, dur: 0.13, freq: 62, freqEnd: 42, attack: 0.008, peak: 0.9 }),
    tone(v, { t: t + 0.19, dur: 0.12, freq: 56, freqEnd: 40, attack: 0.008, peak: 0.6 }),
  ),
  hurt: (v, t, o, r) => Math.max(
    tone(v, { t, dur: 0.16, freq: 120, freqEnd: 52, attack: 0.004, peak: 0.9 }),
    noise(v, { t: t + 0.02, dur: 0.28, filter: 'bandpass', freq: 650, freqEnd: 500, q: 2.5, attack: 0.01, peak: 0.55, color: 'pink', offset: rr(r, 0, 3) }),
    noise(v, { t: t + 0.02, dur: 0.22, filter: 'bandpass', freq: 1250, q: 4, attack: 0.01, peak: 0.25, offset: rr(r, 0, 3) }),
  ),
  gasp: (v, t, o, r) => Math.max(
    noise(v, { t, dur: 0.38, filter: 'bandpass', freq: 1000, freqEnd: 1900, q: 2, attack: 0.16, peak: 0.5, color: 'pink', offset: rr(r, 0, 3) }),
    noise(v, { t: t + 0.1, dur: 0.25, filter: 'highpass', freq: 3500, attack: 0.1, peak: 0.12, offset: rr(r, 0, 3) }),
  ),
  bubbles: (v, t, o, r) => {
    let end = t;
    for (let i = 0; i < 4; i++) end = Math.max(end, tone(v, { t: t + i * rr(r, 0.04, 0.09), dur: 0.045, freq: rr(r, 380, 520), freqEnd: rr(r, 800, 1100), peak: 0.25 }));
    return end;
  },
  bleed: (v, t, o, r) => tone(v, { t, dur: 0.07, freq: rr(r, 800, 1000), freqEnd: 480, peak: 0.2 }),
  death: (v, t, o, r) => Math.max(
    tone(v, { t, dur: 0.9, freq: 80, freqEnd: 34, attack: 0.005, peak: 1 }),
    noise(v, { t: t + 0.08, dur: 1.8, filter: 'lowpass', freq: 700, freqEnd: 180, q: 0.8, attack: 0.08, peak: 0.5, color: 'pink', offset: rr(r, 0, 3) }),
  ),
  cloth: (v, t, o, r) => noise(v, { t, dur: 0.18, filter: 'bandpass', freq: 2600, q: 0.8, attack: 0.04, peak: 0.3, offset: rr(r, 0, 3) }),

  // ---- items ---------------------------------------------------------------------------------------------------
  pickup: (v, t, o, r) => Math.max(
    noise(v, { t, dur: 0.07, filter: 'bandpass', freq: 2500, q: 1, peak: 0.35, offset: rr(r, 0, 3) }),
    tone(v, { t: t + 0.03, dur: 0.07, type: 'triangle', freq: 520, peak: 0.22 }),
    tone(v, { t: t + 0.09, dur: 0.1, type: 'triangle', freq: 780, peak: 0.18 }),
  ),
  drop: (v, t, o, r) => Math.max(
    tone(v, { t, dur: 0.1, freq: 160, freqEnd: 90, peak: 0.6 }),
    noise(v, { t, dur: 0.12, filter: 'lowpass', freq: 900, peak: 0.4, offset: rr(r, 0, 3) }),
  ),
  drink: (v, t, o, r) => {
    let end = t;
    const n = o.gulps ?? 3;
    for (let i = 0; i < n; i++) {
      const at = t + i * rr(r, 0.32, 0.4);
      end = Math.max(end, tone(v, { t: at, dur: 0.09, freq: rr(r, 280, 330), freqEnd: 170, peak: 0.4 }));
      end = Math.max(end, noise(v, { t: at, dur: 0.08, filter: 'lowpass', freq: 600, peak: 0.3, offset: rr(r, 0, 3) }));
    }
    return end;
  },
  bandage: (v, t, o, r) => Math.max(
    noise(v, { t, dur: 0.36, filter: 'bandpass', freq: 2000, freqEnd: 4500, q: 1.5, attack: 0.02, peak: 0.5, offset: rr(r, 0, 3) }),
    noise(v, { t: t + 0.4, dur: 0.3, filter: 'bandpass', freq: 2800, q: 0.8, attack: 0.05, peak: 0.25, offset: rr(r, 0, 3) }),
  ),
  herbs: (v, t, o, r) => Math.max(
    noise(v, { t, dur: 0.3, filter: 'bandpass', freq: 3000, q: 0.8, attack: 0.05, peak: 0.3, offset: rr(r, 0, 3) }),
    noise(v, { t: t + 0.35, dur: 0.3, filter: 'bandpass', freq: 2600, q: 0.8, attack: 0.05, peak: 0.25, offset: rr(r, 0, 3) }),
  ),
  click: (v, t, o, r) => Math.max(
    noise(v, { t, dur: 0.012, filter: 'highpass', freq: 3000, peak: 0.7, offset: rr(r, 0, 3) }),
    noise(v, { t: t + 0.045, dur: 0.015, filter: 'bandpass', freq: 1800, q: 2, peak: 0.4, offset: rr(r, 0, 3) }),
  ),
  throw: (v, t, o, r) => noise(v, { t, dur: 0.3, filter: 'bandpass', freq: 600, freqEnd: 2200, q: 2, attack: 0.1, peak: 0.6, offset: rr(r, 0, 3) }),

  // ---- impacts: the thrown rock is the player's main tool, so its landing is clear and placed -------------------
  impact_ground: (v, t, o, r) => Math.max(
    tone(v, { t, dur: 0.1, freq: rr(r, 190, 220), freqEnd: 80, attack: 0.002, peak: 1 }),
    noise(v, { t, dur: 0.06, filter: 'bandpass', freq: 1500, q: 1.2, peak: 0.6, offset: rr(r, 0, 3) }),
    noise(v, { t: t + 0.03, dur: 0.2, filter: 'highpass', freq: 2500, peak: 0.2, offset: rr(r, 0, 3) }),
  ),
  impact_rock: (v, t, o, r) => Math.max(
    fm(v, { t, dur: 0.14, freq: rr(r, 1000, 1200), ratio: 1.47, index: 3, attack: 0.001, peak: 0.5 }),
    tone(v, { t, dur: 0.06, freq: 220, freqEnd: 120, attack: 0.001, peak: 0.6 }),
    noise(v, { t: t + 0.02, dur: 0.15, filter: 'highpass', freq: 3000, peak: 0.2, offset: rr(r, 0, 3) }),
  ),
  impact_jungle: (v, t, o, r) => Math.max(
    tone(v, { t, dur: 0.1, freq: 150, freqEnd: 70, attack: 0.002, peak: 0.8 }),
    noise(v, { t, dur: 0.4, filter: 'bandpass', freq: 1300, q: 0.7, attack: 0.01, peak: 0.55, offset: rr(r, 0, 3) }),
  ),
  impact_water: (v, t, o, r) => Math.max(
    tone(v, { t, dur: 0.13, freq: rr(r, 650, 750), freqEnd: 180, peak: 0.6 }),
    noise(v, { t, dur: 0.38, filter: 'bandpass', freq: 1800, freqEnd: 500, q: 1, attack: 0.005, peak: 0.55, offset: rr(r, 0, 3) }),
    SOUNDS.bubbles(v, t + 0.12, o, r),
  ),
  impact_mud: (v, t, o, r) => Math.max(
    noise(v, { t, dur: 0.16, filter: 'bandpass', freq: 400, q: 3, attack: 0.004, peak: 0.85, offset: rr(r, 0, 3) }),
    tone(v, { t, dur: 0.1, freq: 95, freqEnd: 60, peak: 0.5 }),
  ),
  impact_wood: (v, t, o, r) => Math.max(
    tone(v, { t, dur: 0.2, type: 'triangle', freq: rr(r, 300, 340), freqEnd: 270, attack: 0.001, peak: 0.6 }),
    noise(v, { t, dur: 0.1, filter: 'bandpass', freq: 900, q: 4, peak: 0.45, offset: rr(r, 0, 3) }),
  ),

  // ---- work: crafting, the hatch, the dinghy ------------------------------------------------------------------
  craft: (v, t, o, r) => {
    let end = SOUNDS.cloth(v, t, o, r);
    end = Math.max(end, tone(v, { t: t + 0.25, dur: 0.15, type: 'triangle', freq: 330, freqEnd: 290, peak: 0.4 }));
    return Math.max(end, tone(v, { t: t + 0.5, dur: 0.15, type: 'triangle', freq: 310, freqEnd: 270, peak: 0.35 }));
  },
  pry_groan: (v, t, o, r) => Math.max(
    tone(v, { t, dur: 1.4, type: 'sawtooth', freq: rr(r, 65, 75), freqEnd: rr(r, 90, 100), attack: 0.3, peak: 0.55, filter: 'bandpass', cutoff: 550, cutoffEnd: 950, q: 7 }),
    fm(v, { t: t + rr(r, 0.5, 0.8), dur: 0.5, freq: rr(r, 1600, 2000), ratio: 1.03, index: 2, attack: 0.08, peak: 0.12 }),
  ),
  hatch_open: (v, t, o, r) => Math.max(
    tone(v, { t, dur: 0.5, freq: 90, freqEnd: 45, attack: 0.003, peak: 1 }),
    fm(v, { t, dur: 1, freq: 400, ratio: 2.31, index: 2.5, attack: 0.002, peak: 0.35 }),
    noise(v, { t, dur: 0.4, filter: 'lowpass', freq: 1500, peak: 0.4, offset: rr(r, 0, 3) }),
  ),
  patch: (v, t, o, r) => Math.max(
    tone(v, { t, dur: 0.06, type: 'triangle', freq: rr(r, 460, 540), freqEnd: 400, peak: 0.3 }),
    noise(v, { t, dur: 0.05, filter: 'bandpass', freq: 2500, q: 1, peak: 0.3, offset: rr(r, 0, 3) }),
  ),
  electric: (v, t, o, r) => Math.max(
    tone(v, { t, dur: 0.45, type: 'sawtooth', freq: 120, attack: 0.02, peak: 0.25, filter: 'lowpass', cutoff: 900 }),
    noise(v, { t, dur: 0.08, filter: 'highpass', freq: 6000, peak: 0.12, offset: rr(r, 0, 3) }),
  ),

  // ---- the Journal and the UI: small, dry, never musical enough to fight the score ----------------------------
  page: (v, t, o, r) => noise(v, { t, dur: 0.22, filter: 'bandpass', freq: 3500, freqEnd: 2200, q: 0.7, attack: 0.03, peak: 0.35, offset: rr(r, 0, 3) }),
  journal_open: (v, t, o, r) => Math.max(SOUNDS.page(v, t, o, r), tone(v, { t, dur: 0.08, freq: 180, freqEnd: 120, peak: 0.2 })),
  journal_close: (v, t, o, r) => Math.max(
    tone(v, { t, dur: 0.1, freq: 150, freqEnd: 100, peak: 0.35 }),
    noise(v, { t, dur: 0.08, filter: 'lowpass', freq: 2000, peak: 0.3, offset: rr(r, 0, 3) }),
  ),
  select: (v, t) => tone(v, { t, dur: 0.035, freq: 1200, peak: 0.3 }),
  confirm: (v, t) => Math.max(tone(v, { t, dur: 0.09, freq: 660, peak: 0.3 }), tone(v, { t: t + 0.07, dur: 0.18, freq: 990, peak: 0.28 })),
  deny: (v, t) => Math.max(
    tone(v, { t, dur: 0.09, type: 'triangle', freq: 330, peak: 0.35, filter: 'lowpass', cutoff: 1500 }),
    tone(v, { t: t + 0.11, dur: 0.14, type: 'triangle', freq: 247, peak: 0.35, filter: 'lowpass', cutoff: 1500 }),
  ),
  // a landmark: two soft bell partials, far from any of the score's keys' tonic
  chime: (v, t) => Math.max(
    fm(v, { t, dur: 3, freq: 659, ratio: 3.5, index: 0.8, attack: 0.004, peak: 0.22 }),
    fm(v, { t: t + 0.25, dur: 3.5, freq: 988, ratio: 3.5, index: 0.6, attack: 0.004, peak: 0.15 }),
  ),

  // ---- the island's strangeness --------------------------------------------------------------------------------
  reversed_swell: (v, t, o, r) => {
    if (v.panner) { v.panner.pan.setValueAtTime(-0.8, t); v.panner.pan.linearRampToValueAtTime(0.8, t + 1.6); }
    return Math.max(
      noise(v, { t, dur: 1.6, filter: 'bandpass', freq: 300, freqEnd: 2500, q: 2, reverse: true, peak: 0.6, offset: rr(r, 0, 3) }),
      tone(v, { t, dur: 1.6, type: 'triangle', freq: 260, freqEnd: 190, attack: 1.5, peak: 0.25, curve: 'linear' }),
    );
  },
  anomaly_pulse: (v, t, o, r) => Math.max(
    tone(v, { t, dur: 2.2, freq: 44, freqEnd: 32, attack: 0.3, peak: 0.9 }),
    noise(v, { t, dur: 1.8, filter: 'lowpass', freq: 180, q: 0.7, attack: 0.4, peak: 0.45, color: 'brown', offset: rr(r, 0, 3) }),
  ),
  tier_swell: (v, t) => Math.max(
    tone(v, { t, dur: 2.5, freq: 55, attack: 1, peak: 0.3 }),
    tone(v, { t, dur: 2.5, freq: 82.7, attack: 1.2, peak: 0.18 }),
  ),

  // ---- weather and the beds' grains ---------------------------------------------------------------------------
  thunder: (v, t, o, r) => {
    const near = o.near ?? r();
    let end = noise(v, { t, dur: rr(r, 4, 6.5), filter: 'lowpass', freq: 220 + 300 * near, freqEnd: 70, q: 0.6, attack: 0.05 + 0.3 * (1 - near), peak: 0.9, color: 'brown', offset: rr(r, 0, 3) });
    if (near > 0.5) end = Math.max(end, noise(v, { t, dur: 0.45, filter: 'lowpass', freq: 2500, q: 0.5, attack: 0.002, peak: 0.35, offset: rr(r, 0, 3) }));
    return Math.max(end, noise(v, { t: t + rr(r, 0.6, 1.4), dur: rr(r, 2.5, 4), filter: 'lowpass', freq: 160, freqEnd: 60, q: 0.6, attack: 0.3, peak: 0.6, color: 'brown', offset: rr(r, 0, 3) }));
  },
  drip: (v, t, o, r) => (r() < 0.5
    ? tone(v, { t, dur: 0.05, freq: rr(r, 1400, 2600), freqEnd: rr(r, 700, 1200), peak: 0.25 })
    : noise(v, { t, dur: 0.02, filter: 'bandpass', freq: rr(r, 2500, 5000), q: 4, peak: 0.5, offset: rr(r, 0, 3) })),
  bird: (v, t, o, r) => {
    let end = t;
    const base = rr(r, 2400, 4200);
    const n = 2 + Math.floor(r() * 4);
    const gap = rr(r, 0.07, 0.14);
    for (let i = 0; i < n; i++) {
      const f = base * rr(r, 0.85, 1.15);
      end = Math.max(end, tone(v, { t: t + i * gap, dur: rr(r, 0.05, 0.09), freq: f, freqEnd: f * rr(r, 0.7, 1.35), attack: 0.01, peak: rr(r, 0.2, 0.35) }));
    }
    return end;
  },
  night_bird: (v, t, o, r) => {
    const f = rr(r, 420, 540);
    return Math.max(
      tone(v, { t, dur: 0.35, freq: f, freqEnd: f * 0.93, attack: 0.06, peak: 0.3, vibrato: 4, vibratoRate: 6 }),
      tone(v, { t: t + 0.5, dur: 0.45, freq: f * 0.95, freqEnd: f * 0.86, attack: 0.08, peak: 0.25, vibrato: 4, vibratoRate: 6 }),
    );
  },
  plop: (v, t, o, r) => tone(v, { t, dur: 0.09, freq: rr(r, 260, 340), freqEnd: 110, peak: 0.4 }),

  // ---- the Sentinelese: wordless, short, firm, human; never speech, never a caricature ------------------------
  shout: (v, t, o, r) => {
    const ctx = v.ctx;
    const f0 = rr(r, 165, 205);
    const dur = rr(r, 0.36, 0.48);
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0 * 0.92, t);
    src.frequency.linearRampToValueAtTime(f0 * 1.14, t + 0.07);
    src.frequency.linearRampToValueAtTime(f0 * 0.86, t + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vd = v.add(ctx.createGain());
    vd.gain.value = f0 * 0.012;
    vib.connect(vd).connect(src.frequency);
    const env = v.add(ctx.createGain());
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.5, t + 0.025);
    env.gain.setValueAtTime(0.45, t + dur - 0.08);
    env.gain.linearRampToValueAtTime(0, t + dur);
    // an open "o"-like vowel: formants, not a word
    const bank = formants(v, [[rr(r, 520, 600), 6, 1], [rr(r, 900, 1050), 8, 0.55], [2500, 10, 0.15]], env);
    env.connect(v.out);
    src.connect(bank);
    v.run(src, t, t + dur + 0.01);
    v.run(vib, t, t + dur + 0.01);
    return Math.max(t + dur + 0.01, noise(v, { t, dur: dur * 0.9, filter: 'bandpass', freq: 1200, q: 1, attack: 0.02, peak: 0.06, offset: rr(r, 0, 3) }));
  },
  whistle: (v, t, o, r) => {
    const f1 = rr(r, 1700, 1900);
    const up = r() < 0.5;
    const f2 = up ? f1 * 1.33 : f1 * 0.75;
    return Math.max(
      tone(v, { t, dur: 0.22, freq: f1, attack: 0.02, peak: 0.5, vibrato: 8, vibratoRate: 6, curve: 'linear' }),
      tone(v, { t: t + 0.24, dur: 0.32, freq: f2, attack: 0.02, peak: 0.5, vibrato: 10, vibratoRate: 6, curve: 'linear' }),
      noise(v, { t, dur: 0.56, filter: 'highpass', freq: 5000, attack: 0.02, peak: 0.04, offset: rr(r, 0, 3) }),
    );
  },
  bow_creak: (v, t, o, r) => {
    const ctx = v.ctx;
    const dur = 0.7;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(rr(r, 90, 100), t);
    osc.frequency.linearRampToValueAtTime(rr(r, 105, 120), t + dur);
    const f = v.add(ctx.createBiquadFilter());
    f.type = 'bandpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(950, t + dur);
    f.Q.value = 9;
    // stick-slip: the wood's grain as a fast, uneven amplitude flutter
    const am = v.add(ctx.createGain());
    am.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = rr(r, 24, 32);
    const depth = v.add(ctx.createGain());
    depth.gain.value = 0.45;
    lfo.connect(depth).connect(am.gain);
    const env = v.add(ctx.createGain());
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.35, t + 0.2);
    env.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(f).connect(am).connect(env).connect(v.out);
    v.run(osc, t, t + dur + 0.01);
    v.run(lfo, t, t + dur + 0.01);
    return t + dur + 0.01;
  },
  arrow_fired: (v, t, o, r) => Math.max(
    tone(v, { t, dur: 0.25, type: 'triangle', freq: 150, freqEnd: 118, attack: 0.002, peak: 0.5 }),
    noise(v, { t, dur: 0.02, filter: 'highpass', freq: 3000, peak: 0.5, offset: rr(r, 0, 3) }),
    noise(v, { t: t + 0.03, dur: 0.38, filter: 'bandpass', freq: 2600, freqEnd: 800, q: 3, attack: 0.04, peak: 0.45, offset: rr(r, 0, 3) }),
  ),
  arrow_land: (v, t, o, r) => {
    const wood = o.surface === 'wood';
    return Math.max(
      tone(v, { t, dur: wood ? 0.16 : 0.07, type: wood ? 'triangle' : 'sine', freq: wood ? 320 : 260, freqEnd: wood ? 260 : 120, attack: 0.001, peak: 0.8 }),
      noise(v, { t, dur: 0.04, filter: 'bandpass', freq: 1800, q: 2, peak: 0.5, offset: rr(r, 0, 3) }),
      noise(v, { t: t + 0.01, dur: 0.12, filter: 'lowpass', freq: wood ? 1200 : 800, peak: 0.25, offset: rr(r, 0, 3) }),
    );
  },
  stinger: (v, t, o, r) => Math.max(
    fm(v, { t, dur: 1.3, freq: 880, ratio: 1.414, index: 6, indexDecay: 0.3, attack: 0.002, peak: 0.45 }),
    tone(v, { t, dur: 1.6, freq: 55, freqEnd: 49, attack: 0.004, peak: 0.7 }),
    noise(v, { t, dur: 0.15, filter: 'highpass', freq: 4000, peak: 0.3, offset: rr(r, 0, 3) }),
  ),
  release: (v, t, o, r) => Math.max(
    noise(v, { t, dur: 2, filter: 'lowpass', freq: 1200, freqEnd: 300, q: 0.7, attack: 0.4, peak: 0.25, color: 'pink', offset: rr(r, 0, 3) }),
    tone(v, { t, dur: 2, freq: 220, freqEnd: 165, attack: 0.3, peak: 0.08 }),
  ),
};

export const SOUND_NAMES = Object.freeze(Object.keys(SOUNDS));
