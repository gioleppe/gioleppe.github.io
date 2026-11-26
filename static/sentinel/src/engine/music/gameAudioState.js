// The small, explicit record of game state that the music director and the ambience read, built from the
// simulation (read only) and the presentation's own state (screen, Journal/pause, holdout). Pure: no audio, no clock.
import { TILE_W, TILE_H } from '../../sim/constants.js';

/** a region name, or 'coast' when there is no island (the open test field) */
const regionOf = (sim, x, y) => (sim.map ? sim.map.regionAtWorld(x, y) : 'coast');

/**
 * @param {object} sim the Sim (read only)
 * @param {{ screen?: string, paused?: boolean, holdout?: { elapsed: number }|null, threat?: string, coastNear?: number }} [ui]
 *   screen: what the shell shows ('game' by default; 'gameover' is also inferred from a dead player);
 *   threat: the smoothed scout level (ThreatTracker) to use instead of the raw one
 * @returns {object} the record mixFor and ambienceFor take
 */
export function gameAudioState(sim, ui = {}) {
  const p = sim.player;
  const w = sim.world;
  const r = sim.resonance;
  let screen = ui.screen ?? 'game';
  // the shell (title, saves, endings) sets the screen; until it shows its game-over screen, death is the cue
  if (screen === 'game' && p?.dead) screen = 'gameover';
  return {
    screen,
    region: p ? regionOf(sim, p.x, p.y) : 'coast',
    anomaly: p && sim.map ? sim.map.anomalyAt(p.x, p.y) : 0,
    inSafeZone: !!(p && sim.safeZones?.inSafeZone(p.x, p.y)),
    daylight: w ? w.daylight : 1,
    dayPhase: w ? w.dayPhase : 'day',
    weather: w ? w.weatherIntensity : 0,
    wind: w ? w.windStrength : 0.2,
    tide: w ? w.tideState : 'rising',
    tideHeight: w ? w.tideHeight : 0.5,
    resonance: { tier: r?.tier ?? 'quiet', value: r?.value ?? 0 },
    threat: ui.threat ?? rawThreat(sim),
    dialogue: !!sim.dialogue?.active,
    paused: !!ui.paused,
    holdout: ui.holdout ?? null,
    swimming: p?.mode === 'swim',
    coastNear: ui.coastNear ?? null,
  };
}

/** the highest scout state near the player as the AI reports it ('none' before the AI exists) */
export function rawThreat(sim) {
  return sim.threat?.level ?? 'none';
}

/**
 * What the player's body sounds like this frame: everything the footsteps, breath and heartbeat read.
 * @param {object} sim
 */
export function playerAudioState(sim) {
  const p = sim.player;
  const moved = Math.sqrt((p.x - p.prevX) ** 2 + (p.y - p.prevY) ** 2);
  return {
    x: p.x, y: p.y,
    moving: moved > 0.05 && !p.dead,
    state: p.state, mode: p.mode, stance: p.stance,
    surface: p.noiseSurface, noiseRadius: p.noiseRadius,
    stamina: p.stamina, staminaMax: p.tuning?.stamina?.max ?? 100,
    health: p.health, healthMax: p.tuning?.health?.max ?? 100,
    bleeding: p.bleedTicks > 0, drowning: !!p.drowning, dead: !!p.dead,
    channel: sim.interactables?.channel?.action ?? null,
    awareness: sim.scouts?.maxAwareness ?? 0,
  };
}

/**
 * How much open water is around a point, 0..1: a ring of samples of the map's water tiles at a few radii.
 * Cheap (36 lookups); the caller runs it a few times a second, not every frame.
 */
export function coastProximity(map, x, y, radii = [96, 256, 480]) {
  if (!map) return 1;
  let hits = 0;
  let total = 0;
  const N = 12;
  for (let ri = 0; ri < radii.length; ri++) {
    const w = radii.length - ri;   // near rings count more
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const tx = Math.floor((x + Math.cos(a) * radii[ri]) / TILE_W);
      const ty = Math.floor((y + Math.sin(a) * radii[ri] * 0.75) / TILE_H);
      total += w;
      if (!map.inBounds(tx, ty) || map.isWater(tx, ty)) hits += w;
    }
  }
  return hits / total;
}
