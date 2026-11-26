// Day/night and lights (spec §2.4, step 2.5). Presentation only: reads sim.world, the player and the props near
// the view, never writes the simulation.
//
// Each frame:
//   1. the ambient tint for the moment (ambientAt: keyframes by hour from tuning.lighting.ambient, moonlight lifts
//      the dark, a squall blends storm slate in) fills a low-resolution offscreen canvas at alpha = darkness;
//   2. every light in view is punched out of it with 'destination-out' and a cached soft radial sprite;
//   3. the canvas is drawn over the world (after the scene, before the UI, which lives on #ui);
//   4. coloured lights (supernatural, fire) add a faint 'lighter' glow on the world so their light has colour.
// When darkness is 0 (clear daytime) steps 1-3 are skipped entirely.
//
// Lights: { id, kind, x, y, radius, intensity 0..1, color?, flicker? 0..1, pulse? {speed, depth}, glow? 0..1,
//           angle?, length?, width? (flashlight) } in world pixels. Built-in sources: the player's awareness light
// at night, the flashlight (sim.player.lightOn), and any prop whose kind has tuning.props[kind].light. A later
// step adds its own source with `lighting.addSource((sim, view, out) => { out.push({...}) })`; lights outside
// the view are culled after every source has run.
/** '#rrggbb' -> [r, g, b] */
export function parseHex(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const lerp = (a, b, t) => a + (b - a) * t;

/** keyframes from tuning, parsed once per tuning object */
const keyCache = new WeakMap();
function keyframes(cfg) {
  let k = keyCache.get(cfg);
  if (!k) {
    k = cfg.ambient.map((f) => ({ hour: f.hour, rgb: parseHex(f.color), darkness: f.darkness })).sort((a, b) => a.hour - b.hour);
    keyCache.set(cfg, k);
  }
  return k;
}

/**
 * The ambient tint at the world's moment.
 * @param {{ timeOfDay: number, moonlight: number, weatherIntensity: number }} world
 * @param {Object} cfg tuning.lighting
 * @returns {{ r: number, g: number, b: number, darkness: number }} colour 0..255 (fractional), darkness 0..1
 */
export function ambientAt(world, cfg) {
  const keys = keyframes(cfg);
  const h = world.timeOfDay;
  // the segment around h, wrapping from the last key to the first one 24 h later
  let i = keys.length - 1;
  for (let k = 0; k < keys.length; k++) if (keys[k].hour <= h) i = k;
  const a = keys[i];
  const b = keys[(i + 1) % keys.length];
  const ah = a.hour <= h ? a.hour : a.hour - 24;
  const bh = b.hour > ah ? b.hour : b.hour + 24;
  const t = bh > ah ? (h - ah) / (bh - ah) : 0;
  let r = lerp(a.rgb[0], b.rgb[0], t);
  let g = lerp(a.rgb[1], b.rgb[1], t);
  let bl = lerp(a.rgb[2], b.rgb[2], t);
  let d = lerp(a.darkness, b.darkness, t) - cfg.moonLift * world.moonlight;
  if (d < 0) d = 0;
  const s = world.weatherIntensity;
  if (s > 0) {
    const sc = parseStorm(cfg);
    const m = s * cfg.storm.colorMix;
    r = lerp(r, sc[0], m);
    g = lerp(g, sc[1], m);
    bl = lerp(bl, sc[2], m);
    if (cfg.storm.darkness > d) d += (cfg.storm.darkness - d) * s;
  }
  return { r, g, b: bl, darkness: d > 1 ? 1 : d };
}

const stormCache = new WeakMap();
function parseStorm(cfg) {
  let c = stormCache.get(cfg);
  if (!c) { c = parseHex(cfg.storm.color); stormCache.set(cfg, c); }
  return c;
}

/** a stable number for a light id */
export function hashId(id) {
  const s = String(id);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0) / 4294967296;
}

/**
 * Brightness factor of a light now: flicker (fire-like jitter) and pulse (slow breathing), deterministic in
 * (time, id). 1 for a steady light.
 */
export function lightFactor(l, time) {
  let f = 1;
  const ph = hashId(l.id) * 6.283;
  if (l.flicker) f *= 1 - l.flicker * (0.5 + 0.3 * Math.sin(time * 9.1 + ph) + 0.2 * Math.sin(time * 23.7 + ph * 3));
  if (l.pulse) f *= 1 - l.pulse.depth * (0.5 + 0.5 * Math.sin(time * l.pulse.speed + ph));
  return f < 0 ? 0 : f;
}

/** a light's reach overlaps the world rectangle */
export function lightInView(l, view) {
  const r = l.kind === 'flashlight' ? (l.offset ?? 0) + l.length : l.radius;
  return l.x + r > view.x && l.x - r < view.x + view.w && l.y + r > view.y && l.y - r < view.y + view.h;
}

/** cache key of a gradient sprite: whole-pixel radius and colour */
export function gradientKey(radius, color) {
  return `${Math.max(1, Math.round(radius))}|${color}`;
}

const propScratch = [];

/**
 * The built-in lights for the moment: the player's awareness light (when it is dark), the flashlight, and the
 * props near the view with a light in tuning. Not culled; see collectLights.
 * @param {Object} sim
 * @param {{x:number,y:number,w:number,h:number}} view world rect
 * @param {number} darkness current ambient darkness
 * @param {number} [alpha] tick interpolation
 * @param {Object[]} [out]
 */
export function builtinLights(sim, view, darkness, alpha = 1, out = []) {
  const L = sim.tuning.lighting;
  const p = sim.player;
  const px = p.prevX + (p.x - p.prevX) * alpha;
  const py = p.prevY + (p.y - p.prevY) * alpha;
  if (darkness > 0) out.push({ id: 'player', kind: 'player', x: px, y: py - 8, radius: L.player.radius, intensity: L.player.intensity });
  if (p.lightOn) {
    const f = L.flashlight;
    const angle = Math.atan2(p.dirY, p.dirX);
    out.push({ id: 'flashlight', kind: 'flashlight', x: px, y: py - 8, angle, length: f.length, width: f.width, offset: f.offset, radius: f.nearRadius, intensity: f.intensity });
  }
  const props = sim.tuning.props ?? {};
  let reach = 0;
  for (const k in props) if (props[k]?.light) reach = Math.max(reach, props[k].light.radius);
  if (reach > 0) {
    const list = sim.map
      ? sim.map.propsInRect(view.x - reach, view.y - reach, view.x + view.w + reach, view.y + view.h + reach, propScratch)
      : sim.props ?? [];
    for (const pr of list) {
      const lc = props[pr.kind]?.light;
      if (!lc) continue;
      const boost = lc.zoneBoost && sim.map ? 1 + lc.zoneBoost * sim.map.anomalyAt(pr.x, pr.y) : 1;
      out.push({
        id: pr.id, kind: pr.kind, x: pr.x, y: pr.y - 6, radius: lc.radius, intensity: Math.min(1, lc.intensity * boost),
        color: lc.color, flicker: lc.flicker, pulse: lc.pulse, glow: lc.glow,
      });
    }
  }
  return out;
}

/** default canvas factory: an OffscreenCanvas, else a detached <canvas>, else null (Node: lighting is off) */
function defaultCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const doc = globalThis.document;
  if (!doc) return null;
  const c = doc.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** small pre-rendered radial gradients, one per (radius, colour) */
export class GradientCache {
  constructor(createCanvas = defaultCanvas) {
    this.createCanvas = createCanvas;
    this.map = new Map();
  }

  /** @returns {CanvasImageSource|null} a 2r x 2r sprite: colour at the centre fading to transparent at r */
  get(radius, color) {
    const key = gradientKey(radius, color);
    let c = this.map.get(key);
    if (c !== undefined) return c;
    const r = Math.max(1, Math.round(radius));
    c = this.createCanvas(r * 2, r * 2);
    if (c) {
      const g = c.getContext('2d');
      const [R, G, B] = parseHex(color);
      const grad = g.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, `rgba(${R},${G},${B},1)`);
      grad.addColorStop(0.45, `rgba(${R},${G},${B},0.75)`);
      grad.addColorStop(0.75, `rgba(${R},${G},${B},0.3)`);
      grad.addColorStop(1, `rgba(${R},${G},${B},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, r * 2, r * 2);
    }
    if (this.map.size > 256) this.map.clear();   // radii are few; this only guards against a runaway
    this.map.set(key, c);
    return c;
  }
}

export class Lighting {
  /** @param {{ createCanvas?: (w: number, h: number) => any }} [opts] */
  constructor({ createCanvas = defaultCanvas } = {}) {
    this.createCanvas = createCanvas;
    this.gradients = new GradientCache(createCanvas);
    this.canvas = null;
    /** extra light sources registered by later steps */
    this.sources = [];
    this.lights = [];
    /** graphics quality: the darkness canvas at tuning.lighting.resolution times this (Quality.js) */
    this.scale = 1;
    /** what the last frame used, for the debug readout */
    this.last = { ambient: { r: 0, g: 0, b: 0, darkness: 0 }, lights: 0, ms: 0 };
  }

  /**
   * Register a light source: called every frame with (sim, view, out); push lights into out.
   * @returns {() => void} removes it
   */
  addSource(fn) {
    this.sources.push(fn);
    return () => { this.sources = this.sources.filter((s) => s !== fn); };
  }

  /**
   * Every light whose reach touches the view this frame.
   * @returns {Object[]}
   */
  collectLights(sim, view, darkness, alpha) {
    const all = builtinLights(sim, view, darkness, alpha, []);
    for (const s of this.sources) s(sim, view, all);
    this.lights = all.filter((l) => lightInView(l, view));
    return this.lights;
  }

  /**
   * Darken and light the world canvas. Call after the scene is drawn.
   * @param {CanvasRenderingContext2D} ctx #world
   * @param {Object} sim
   * @param {import('./Camera.js').Camera} camera
   * @param {{ time: number, alpha?: number }} opts
   */
  draw(ctx, sim, camera, { time, alpha = 1 }) {
    if (!sim.world || !sim.tuning.lighting) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const cfg = sim.tuning.lighting;
    const amb = ambientAt(sim.world, cfg);
    const view = camera.visibleRect();
    const lights = this.collectLights(sim, view, amb.darkness, alpha);
    const ox = camera.originX;
    const oy = camera.originY;

    const res = cfg.resolution * this.scale;
    if (amb.darkness > 0.002 && this.ensureCanvas(camera.viewW, camera.viewH, res)) {
      const lc = this.lctx;
      const { width: lw, height: lh } = this.canvas;
      lc.globalCompositeOperation = 'source-over';
      lc.globalAlpha = 1;
      lc.clearRect(0, 0, lw, lh);
      lc.fillStyle = `rgba(${Math.round(amb.r)},${Math.round(amb.g)},${Math.round(amb.b)},${amb.darkness.toFixed(3)})`;
      lc.fillRect(0, 0, lw, lh);
      lc.globalCompositeOperation = 'destination-out';
      for (const l of lights) {
        const a = l.intensity * lightFactor(l, time);
        if (a <= 0.01) continue;
        if (l.kind === 'flashlight') this.punchFlashlight(lc, l, a, ox, oy, res);
        else this.punch(lc, (l.x - ox) * res, (l.y - oy) * res, l.radius * res, a);
      }
      lc.globalCompositeOperation = 'source-over';
      lc.globalAlpha = 1;
      ctx.save();
      ctx.imageSmoothingEnabled = !!cfg.smooth;
      ctx.drawImage(this.canvas, 0, 0, lw, lh, 0, 0, lw / res, lh / res);
      ctx.restore();
    }

    // coloured light gets a faint additive glow, so supernatural light reads as colour, not only as less dark
    const glow = cfg.glow;
    const vis = glow.dayFloor + (1 - glow.dayFloor) * amb.darkness;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      if (!l.glow || !l.color) continue;
      const a = l.glow * glow.strength * vis * l.intensity * lightFactor(l, time);
      if (a <= 0.01) continue;
      const g = this.gradients.get(l.radius, l.color);
      if (!g) continue;
      const r = Math.max(1, Math.round(l.radius));
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(g, Math.round(l.x - ox) - r, Math.round(l.y - oy) - r);
    }
    ctx.restore();
    this.last = { ambient: amb, lights: lights.length, ms: typeof performance !== 'undefined' ? performance.now() - t0 : 0 };
  }

  /** a soft round hole */
  punch(lc, x, y, r, a) {
    const g = this.gradients.get(r, '#ffffff');
    if (!g) return;
    const rr = Math.max(1, Math.round(r));
    lc.globalAlpha = a > 1 ? 1 : a;
    lc.drawImage(g, Math.round(x) - rr, Math.round(y) - rr);
  }

  /** the flashlight: a long soft ellipse ahead of the player plus a small pool at the feet */
  punchFlashlight(lc, l, a, ox, oy, res) {
    const cx = (l.x + Math.cos(l.angle) * l.offset - ox) * res;
    const cy = (l.y + Math.sin(l.angle) * l.offset - oy) * res;
    const half = (l.width / 2) * res;
    const g = this.gradients.get(half, '#ffffff');
    if (g) {
      const rr = Math.max(1, Math.round(half));
      lc.save();
      lc.globalAlpha = a > 1 ? 1 : a;
      lc.translate(cx, cy);
      lc.rotate(l.angle);
      lc.scale(l.length / l.width, 1);
      lc.drawImage(g, -rr, -rr);
      lc.restore();
    }
    this.punch(lc, (l.x - ox) * res, (l.y - oy) * res, l.radius * res, a);
  }

  /** the offscreen canvas at the size for this view; false where no canvas can be made (Node) */
  ensureCanvas(viewW, viewH, res) {
    const w = Math.max(1, Math.ceil(viewW * res));
    const h = Math.max(1, Math.ceil(viewH * res));
    if (!this.canvas) {
      this.canvas = this.createCanvas(w, h);
      if (!this.canvas) return false;
      this.lctx = this.canvas.getContext('2d');
    }
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return true;
  }
}
