// The pure rules of the sound effects and ambience (step 5.5), tested in Node: where a sound sits in the stereo
// field and how loud it is with distance, the ambience beds' levels for a game state, which footstep a surface
// makes and how loud it is for the player's actual noise radius, and the footstep cadence.

export const SPATIAL_DEFAULTS = Object.freeze({ ref: 96, max: 1200, rolloff: 1.3, panWidth: 360, panMax: 0.85 });

/**
 * Stereo pan and distance gain of a sound at (dx, dy) world px from the player.
 * @returns {{ gain: number, pan: number, distance: number }}
 */
export function spatialise(dx, dy, cfg = SPATIAL_DEFAULTS) {
  const c = cfg === SPATIAL_DEFAULTS ? cfg : { ...SPATIAL_DEFAULTS, ...cfg };
  const d = Math.sqrt(dx * dx + dy * dy);
  let gain = d <= c.ref ? 1 : c.ref / (c.ref + c.rolloff * (d - c.ref));
  // the last quarter before `max` fades to silence: nothing pops in at the edge
  const edge = c.max * 0.75;
  if (d > edge) gain *= Math.max(0, (c.max - d) / (c.max - edge));
  const pan = Math.max(-c.panMax, Math.min(c.panMax, (dx / c.panWidth) * c.panMax));
  return { gain, pan, distance: d };
}

/** how much each region hears the sea (before the coast sampler), the canopy's insects and birds, and the wind */
export const REGION_AMBIENCE = Object.freeze({
  southern_cove: { surf: 1, jungle: 0.15, wind: 1 },
  coast: { surf: 1, jungle: 0.15, wind: 1 },
  reef: { surf: 0.85, jungle: 0, wind: 1 },
  shipwreck: { surf: 0.85, jungle: 0, wind: 1 },
  open_sea: { surf: 0.9, jungle: 0, wind: 1.1 },
  western_mangroves: { surf: 0.3, jungle: 0.35, wind: 0.6, mangrove: 1 },
  interior_jungle: { surf: 0.06, jungle: 1, wind: 0.5 },
  // the Meridian is quiet on purpose: even the insects stop
  quiet_meridian: { surf: 0, jungle: 0, wind: 0.3 },
  signal_peak: { surf: 0.35, jungle: 0.2, wind: 1.3 },
});

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * The ambience beds' levels (0..1, before the bed's own trim in tuning) for a state record (gameAudioState).
 * @returns {{ surf: number, surfRate: number, wind: number, rain: number, jungleDay: number, jungleNight: number,
 *   mangrove: number, hum: number, humInstability: number, thunder: boolean }}
 */
export function ambienceFor(s, cfg = {}) {
  const out = { surf: 0, surfRate: 1, wind: 0, rain: 0, jungleDay: 0, jungleNight: 0, mangrove: 0, hum: 0, humInstability: 0, thunder: false };
  if (s.screen === 'title') { out.surf = 0.5; out.wind = 0.15; return out; }
  if (s.screen !== 'game') return out;
  const r = REGION_AMBIENCE[s.region] ?? REGION_AMBIENCE.coast;
  const weather = clamp01(s.weather ?? 0);
  const wind = clamp01(s.wind ?? 0.2);
  const daylight = clamp01(s.daylight ?? 1);
  const meridian = s.region === 'quiet_meridian' || (s.anomaly ?? 0) >= (cfg.meridianAnomaly ?? 0.6);
  // the sea: the region's share, raised or lowered by how much open water is around (the coast sampler)
  const near = s.coastNear ?? r.surf;
  let surf = meridian ? 0 : Math.max(r.surf * 0.5, Math.min(1, 0.4 * r.surf + 0.8 * near * (r.surf > 0.2 ? 1 : 0.4)));
  if (s.swimming) surf = Math.max(surf, 0.9);
  out.surf = clamp01(surf * (0.8 + 0.2 * (s.tideHeight ?? 0.5)) * (0.85 + 0.3 * wind));
  out.surfRate = 0.8 + 0.4 * wind + 0.2 * (s.tideHeight ?? 0.5);
  out.wind = clamp01(wind ** 1.5 * (r.wind ?? 1));
  out.rain = weather;
  const insects = (meridian ? 0 : r.jungle) * (1 - 0.7 * weather);
  out.jungleDay = clamp01(insects * daylight);
  out.jungleNight = clamp01(insects * (1 - daylight));
  out.mangrove = meridian ? 0 : (r.mangrove ?? 0) * (1 - 0.5 * weather);
  // the Resonance hum: in from Humming, unstable when Agitated
  const tier = s.resonance?.tier ?? 'quiet';
  const v = s.resonance?.value ?? 0;
  const hAt = cfg.hummingAt ?? 31;
  const aAt = cfg.agitatedAt ?? 70;
  if (tier === 'humming') out.hum = 0.3 + 0.4 * clamp01((v - hAt) / (aAt - hAt));
  else if (tier === 'agitated') {
    const k = clamp01((v - aAt) / ((cfg.maxResonance ?? 100) - aAt));
    out.hum = 0.7 + 0.3 * k;
    out.humInstability = 0.5 + 0.5 * k;
  }
  out.thunder = weather > 0.6;
  if (s.paused) for (const k of ['surf', 'wind', 'rain', 'jungleDay', 'jungleNight', 'mangrove', 'hum']) out[k] *= cfg.pauseAmbience ?? 0.5;
  return out;
}

/** surface (player.noiseSurface) -> footstep recipe */
export const FOOTSTEP_SOUNDS = Object.freeze({
  sand: 'step_sand', wet_sand: 'step_wet_sand', jungle_floor: 'step_jungle', basalt: 'step_rock', reef_rock: 'step_rock',
  mud: 'step_mud', water: 'step_wade', swim: 'swim_stroke',
});

/** seconds between steps (or strokes) for an animation state */
export const STEP_INTERVAL = Object.freeze({ walk: 0.5, sneak: 0.72, sprint: 0.31, swim: 1.05 });

/**
 * A footstep's gain from the player's actual noise radius, so what the player hears matches what the scouts hear:
 * linear in the radius against the reference (220 px: a sprint in brush), so a sneak on sand (20) is about 21 dB
 * under that and a walk on sand (60) about 11 dB under it.
 */
export function footstepGain(noiseRadius, ref = 220) {
  return Math.max(0, Math.min(1.2, noiseRadius / ref));
}

/** the footstep recipe for a surface (sand when unknown) */
export const footstepSound = (surface) => FOOTSTEP_SOUNDS[surface] ?? 'step_sand';

/**
 * Cadence of footsteps from the player's state, on the simulation's clock (so a paused game makes no steps and a
 * fast-forwarded one makes them faster, never more than one per update).
 */
export class FootstepClock {
  constructor() { this.phase = 0; this.wasMoving = false; }

  /**
   * @param {{ moving: boolean, state: string, noiseRadius: number }} p
   * @param {number} dt simulation seconds since the last update
   * @returns {boolean} a step falls in this update
   */
  update(p, dt) {
    const interval = STEP_INTERVAL[p.state];
    if (!p.moving || !interval || !(dt > 0)) {
      this.wasMoving = false;
      this.phase = 0.6;   // the first step comes soon after starting to move, not at once
      return false;
    }
    if (!this.wasMoving) { this.wasMoving = true; this.phase = Math.max(this.phase, 0.6); }
    this.phase += dt / interval;
    if (this.phase >= 1) {
      this.phase = this.phase >= 2 ? 0 : this.phase - 1;
      return true;
    }
    return false;
  }
}

/**
 * The heart rate the player hears (0 = no heartbeat): low health, or scouts close to seeing the player (the highest
 * scout awareness, 0..1, sim.scouts.maxAwareness) or already after them.
 * @param {{ health: number, healthMax: number, awareness?: number }} p
 * @param {string} threat smoothed level
 */
export function heartRate(p, threat) {
  const h = p.healthMax > 0 ? p.health / p.healthMax : 1;
  let bpm = 0;
  if (h < 0.35) bpm = 70 + (0.35 - h) * 140;
  const a = p.awareness ?? 0;
  if (a > 0.4) bpm = Math.max(bpm, Math.round(72 + 50 * (a - 0.4) / 0.6));
  if (threat === 'chase') bpm = Math.max(bpm, 118);
  else if (threat === 'warn') bpm = Math.max(bpm, 96);
  return p.dead ? 0 : Math.round(bpm);
}
