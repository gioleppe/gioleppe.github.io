// Weather on screen and wind in the foliage (spec §2.3, §5.2; step 2.6). Presentation only.
//
// Rain: a pool of streaks in screen space. Nothing is stored per drop: drop i's position at time t is a pure
// hash of (i, t), so rain costs no state, never needs saving, and looks the same in a replay. The number of
// drops follows world.weatherIntensity, their slant world.windStrength. Splash specks on land and small rings on
// water live for tuning.weatherFx.splashSeconds each, at hashed places. A soft slate veil darkens the screen
// edges during a squall (the storm tint itself is the lighting's job).
//
// Sway: a horizontal shear of a sprite's upper part, drawn as a few horizontal slices each moved by whole
// pixels (the bottom slice, holding the anchor, never moves). Amplitude per kind is tuning.props[kind].sway
// (absent or 0 = rigid); tall grass also leans away from a player passing through it (swayPush).
import { TILE_W, TILE_H } from '../sim/constants.js';

/** integer hash of (i, salt) to [0, 1) */
export function hash01(i, salt = 0) {
  let h = Math.imul(i ^ Math.imul(salt + 1, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fmod = (a, n) => ((a % n) + n) % n;

/** how many drops fall at this intensity */
export function dropCount(cfg, intensity) {
  return Math.round(cfg.drops * (intensity < 0 ? 0 : intensity > 1 ? 1 : intensity));
}

/**
 * Drop i at time t on a w x h screen: its head (x, y) in logical pixels and its length. Drops fall at
 * fallSpeed (+-20% each) and drift sideways by `slant` px per px of fall; they wrap around the screen.
 * @returns {{ x: number, y: number, len: number, dim: boolean }}
 */
export function dropAt(i, time, w, h, cfg, slant) {
  const [l0, l1] = cfg.dropLength;
  const len = l0 + Math.floor(hash01(i, 4) * (l1 - l0 + 1));
  const fall = time * cfg.fallSpeed * (0.8 + 0.4 * hash01(i, 3));
  const span = h + len;
  const y = fmod(hash01(i, 2) * span + fall, span) - len;
  const x = fmod(hash01(i, 1) * w + slant * fall, w);
  return { x, y, len, dim: hash01(i, 5) < 0.4 };
}

/**
 * Splash j at time t: where it is and how far through its short life (0..1). Each splash slot jumps to a new
 * hashed place every splashSeconds, with its own phase so they do not all blink together.
 * @returns {{ x: number, y: number, age: number }}
 */
export function splashAt(j, time, w, h, cfg) {
  const life = cfg.splashSeconds;
  const t = time / life + hash01(j, 6);
  const gen = Math.floor(t);
  const key = (j * 7919 + gen) | 0;
  return { x: Math.floor(hash01(key, 7) * w), y: Math.floor(hash01(key, 8) * h), age: t - gen };
}

/** wind slant for drawing: px sideways per px of fall */
export function rainSlant(cfg, wind) {
  return cfg.slant * wind;
}

/**
 * Sway offsets of a prop now, in whole pixels per slice from the bottom (index 0, always 0) to the top.
 * |offset| <= amplitude (+ push). Pure function of (amplitude, wind, time, position).
 * @param {number} amp tuning.props[kind].sway, px at the top at full wind
 * @param {number} wind world.windStrength 0..1
 * @param {number} time seconds
 * @param {number} x prop world x (its phase)
 * @param {number} y prop world y
 * @param {number} slices
 * @param {{ swaySpeed: number, gustSpeed: number }} cfg tuning.weatherFx
 * @param {number} [push] extra lean px (signed) at the top, e.g. from a player walking through
 * @param {number[]} [out]
 * @returns {number[]}
 */
export function swayOffsets(amp, wind, time, x, y, slices, cfg, push = 0, out = []) {
  out.length = slices;
  const ph = hash01((Math.round(x) * 73856093) ^ (Math.round(y) * 19349663), 9) * 6.283;
  // lean with the wind plus two oscillations; the weights sum to 1 so the top stays within amp
  const s = wind * (0.55 + 0.3 * Math.sin(time * cfg.swaySpeed + ph) + 0.15 * Math.sin(time * cfg.gustSpeed + ph * 1.7));
  const top = amp * s + push;
  for (let k = 0; k < slices; k++) out[k] = k === 0 ? 0 : Math.round((top * k) / (slices - 1));
  return out;
}

/**
 * Extra lean of tall grass away from a player within `radius`: up to `amount` px, signed away from the player.
 * @returns {number}
 */
export function grassPush(prop, px, py, push) {
  if (!push) return 0;
  const dx = prop.x - px;
  const dy = prop.y - py;
  const d2 = dx * dx + dy * dy;
  if (d2 >= push.radius * push.radius) return 0;
  const k = 1 - Math.sqrt(d2) / push.radius;
  return (dx >= 0 ? 1 : -1) * push.amount * k;
}

/** default canvas factory (none in Node: the veil is skipped there) */
function defaultCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const doc = globalThis.document;
  if (!doc) return null;
  const c = doc.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export class WeatherFx {
  constructor({ createCanvas = defaultCanvas } = {}) {
    this.createCanvas = createCanvas;
    this.veil = null;
    this.veilKey = '';
    this.last = { drops: 0, splashes: 0 };
  }

  /**
   * Rain, splashes and the edge veil over the scene (call before the lighting, so the night darkens the rain).
   * @param {CanvasRenderingContext2D} ctx #world
   * @param {Object} sim
   * @param {import('./Camera.js').Camera} camera
   * @param {number} time seconds
   * @param {(tx: number, ty: number) => boolean} [isWater] whether a splash at a tile lands in water
   */
  draw(ctx, sim, camera, time, isWater) {
    const world = sim.world;
    const cfg = sim.tuning.weatherFx;
    if (!world || !cfg) return;
    const intensity = world.weatherIntensity;
    if (intensity <= 0) { this.last = { drops: 0, splashes: 0 }; return; }
    const w = camera.viewW;
    const h = camera.viewH;
    const C = cfg.colors;
    const slant = rainSlant(cfg, world.windStrength);

    // the veil first, so the drops stay crisp on top of it
    const veil = this.veilCanvas(w, h, C.veil);
    if (veil) {
      ctx.save();
      ctx.globalAlpha = cfg.veil * intensity;
      ctx.drawImage(veil, 0, 0);
      ctx.restore();
    }

    // splashes: specks on land, small rings on water
    const ns = Math.round(cfg.splashes * intensity);
    ctx.fillStyle = C.splash;
    for (let j = 0; j < ns; j++) {
      const s = splashAt(j, time, w, h, cfg);
      const tx = Math.floor((s.x + camera.originX) / TILE_W);
      const ty = Math.floor((s.y + camera.originY) / TILE_H);
      if (isWater?.(tx, ty)) {
        const r = s.age < 0.5 ? 1 : 2;
        ctx.fillRect(s.x - r, s.y, 1, 1);
        ctx.fillRect(s.x + r, s.y, 1, 1);
        ctx.fillRect(s.x, s.y - 1, 1, 1);
        ctx.fillRect(s.x, s.y + 1, 1, 1);
      } else if (s.age < 0.6) {
        ctx.fillRect(s.x, s.y, 1, 1);
        if (s.age < 0.3) { ctx.fillRect(s.x - 1, s.y - 1, 1, 1); ctx.fillRect(s.x + 1, s.y - 1, 1, 1); }
      }
    }

    // streaks: 1 px wide, stepped two pixels at a time along the slant, so they stay on whole pixels
    const n = dropCount(cfg, intensity);
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass ? C.dropDim : C.drop;
      ctx.globalAlpha = pass ? 0.55 : 0.7;
      for (let i = 0; i < n; i++) {
        const d = dropAt(i, time, w, h, cfg, slant);
        if (d.dim !== !!pass) continue;
        for (let k = 0; k < d.len; k += 2) ctx.fillRect(Math.round(d.x - slant * k), Math.round(d.y - k), 1, 2);
      }
    }
    ctx.globalAlpha = 1;
    this.last = { drops: n, splashes: ns };
  }

  /** a cached screen-sized veil: clear in the middle, the colour toward the edges */
  veilCanvas(w, h, color) {
    const key = `${w}x${h}|${color}`;
    if (this.veilKey === key) return this.veil;
    this.veilKey = key;
    this.veil = this.createCanvas(w, h);
    if (!this.veil) return null;
    const g = this.veil.getContext('2d');
    const n = parseInt(color.slice(1), 16);
    const rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.65);
    grad.addColorStop(0, `rgba(${rgb},0)`);
    grad.addColorStop(1, `rgba(${rgb},1)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    return this.veil;
  }
}
