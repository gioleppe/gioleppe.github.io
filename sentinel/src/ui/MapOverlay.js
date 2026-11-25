// The island map (spec §3.2 "Journal & Map", §6.3 fog of war): a deliberate stop, not a minimap. Opened by the
// openJournal UI action (Tab / J / the journal icon); step 4.6 builds the Journal around it and embeds this as its
// map tab, so it is self-contained: open(sim) / close() / toggle(sim) / update(dt) / draw(ctx, vp, safe, sim, now)
// / handleInput(event), plus attach({ input, surface, win }) to wire the browser events to handleInput.
//
// The island is drawn from the map's terrain into an offscreen cache at one pixel per tile (480 x 480), built
// lazily on the first open, tuning.mapOverlay.chunkRows rows per frame, so opening never hitches; it is scaled up
// pixelated. The fog (sim.fog, one pixel per fog cell) goes over it, scaled with smoothing so its edges are soft:
// unexplored land is dark parchment, explored land is terrain, cells Shifting Paths took back are a violet smear.
// Discovered landmarks are named (labels that would overlap are left out), the player is an arrow, and the
// corners hold a compass rose, the tide and the time.
//
// Controls: drag (mouse or touch) or arrows / WASD to pan; wheel, + / -, Z or the zoom button for the two zoom
// levels; Esc, Tab / J or the close button to close. The page loop pauses the simulation while it is open.
// Presentation only: it reads sim.map, sim.fog, sim.player and sim.world and never writes them.
import { TILE_W, TILE_H } from '../sim/constants.js';
import { TERRAINS } from '../world/IslandMap.js';
import { tideReadout } from './HUD.js';
import { drawPaperPanel, drawMapMarker, markerForLandmark } from './hud/uiArt.js';
import { activeAssets } from '../engine/AssetManager.js';

/** how far the paper frame reaches outside the map's frame rect (inside tuning.mapOverlay.margin) */
const PAPER_PAD = 6;

/** palette colours (assets/src/palette.gpl) */
export const MAP_COLORS = Object.freeze({
  terrain: Object.freeze({
    sand: '#d2b07c', wet_sand: '#938365', shallow_water: '#379a95', deep_water: '#1a284e',
    jungle_floor: '#2c5230', mud: '#624433', reef_rock: '#6c6570', basalt: '#4f4955',
  }),
  parchment: '#45312a',      // earth_1: what has not been seen
  parchmentEdge: '#2a1e1a',  // earth_0
  paperInk: '#2a1e1a',       // earth_0: writing on the paper frame
  paperDim: '#45312a',       // earth_1
  forgotten: '#8b5cf6',      // violet
  ink: '#0d0b12',
  text: '#e9e2cf',
  dim: '#8f8789',
  landmark: '#f2a33a',       // amber
  player: '#e9e2cf',
  playerEdge: '#a8522b',
  cyan: '#6ff3ff',
});

const HEX = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** RGB per terrain id, blocked tiles darker */
const TERRAIN_RGB = TERRAINS.map((t) => HEX(MAP_COLORS.terrain[t] ?? '#ff00ff'));
const BLOCKED_SHADE = 0.62;

// ---- pure parts ------------------------------------------------------------------------------------------------

/**
 * Rows of the island cache, in chunks to build one per frame.
 * @param {number} rows tiles tall
 * @param {number} chunkRows rows per chunk
 * @returns {Array<{ r0: number, r1: number }>} half-open row ranges covering 0..rows
 */
export function chunkPlan(rows, chunkRows) {
  const n = Math.max(1, Math.floor(chunkRows));
  const out = [];
  for (let r = 0; r < rows; r += n) out.push({ r0: r, r1: Math.min(rows, r + n) });
  return out;
}

/** a world point in map units (tiles; the map is drawn top-down, so a tile is square on it) */
export function worldToMap(x, y) {
  return { x: x / TILE_W, y: y / TILE_H };
}

/** inverse of worldToMap */
export function mapToWorld(mx, my) {
  return { x: mx * TILE_W, y: my * TILE_H };
}

/**
 * The map's screen area: the safe area minus a margin, with a header strip on top.
 * @param {{ uiLogicalWidth: number, uiLogicalHeight: number }} vp
 * @param {{ top?: number, right?: number, bottom?: number, left?: number }} safe
 * @param {number} margin logical px
 */
export function overlayFrame(vp, safe, margin) {
  const x = Math.round((safe.left || 0) + margin);
  const y = Math.round((safe.top || 0) + margin);
  const w = Math.floor(vp.uiLogicalWidth - (safe.right || 0) - margin - x);
  const h = Math.floor(vp.uiLogicalHeight - (safe.bottom || 0) - margin - y);
  const header = 14;
  return { x, y, w, h, header, map: { x: x + 2, y: y + header, w: w - 4, h: h - header - 2 } };
}

/**
 * The view transform: `scale` screen px per map unit (tile), the map point at the area's centre.
 * zoom 0 fits the whole island in the area; zoom k multiplies that by zoomLevels[k].
 * @param {{x:number,y:number,w:number,h:number}} area
 * @param {number} mapW tiles
 * @param {number} mapH tiles
 * @param {number[]} zoomLevels
 * @param {number} zoom index
 * @param {{ x: number, y: number }} center map units
 */
export function viewFor(area, mapW, mapH, zoomLevels, zoom, center) {
  const fit = Math.min(area.w / mapW, area.h / mapH);
  const z = Math.max(0, Math.min(zoomLevels.length - 1, zoom | 0));
  const scale = fit * zoomLevels[z];
  const c = clampCenter(center, area, mapW, mapH, scale);
  return { scale, zoom: z, cx: c.x, cy: c.y, ox: area.x + area.w / 2 - c.x * scale, oy: area.y + area.h / 2 - c.y * scale };
}

/**
 * Keep the map on screen: along an axis where the map is smaller than the area it is centred, else its edges never
 * come inside the area.
 */
export function clampCenter(center, area, mapW, mapH, scale) {
  const axis = (c, size, span) => {
    const half = span / (2 * scale);
    if (size <= 2 * half) return size / 2;
    return Math.max(half, Math.min(size - half, c));
  };
  return { x: axis(center.x, mapW, area.w), y: axis(center.y, mapH, area.h) };
}

/** map units -> screen */
export function mapToScreen(view, mx, my) {
  return { x: view.ox + mx * view.scale, y: view.oy + my * view.scale };
}

/** screen -> map units */
export function screenToMap(view, sx, sy) {
  return { x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale };
}

/** two rectangles overlap */
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Which landmark labels to draw: in order, skipping any whose box would overlap one already placed.
 * @param {Array<{ id: string, sx: number, sy: number, w: number }>} items label anchor (left, centre line) and width
 * @param {number} h label height
 * @param {Array<{x:number,y:number,w:number,h:number}>} [reserved] boxes no label may cover (the player marker)
 * @returns {Set<string>} the ids to label
 */
export function placeLabels(items, h, reserved = []) {
  const placed = [...reserved];
  const out = new Set();
  for (const it of items) {
    const r = { x: it.sx, y: it.sy - h / 2, w: it.w, h };
    if (placed.some((p) => overlaps(p, r))) continue;
    placed.push(r);
    out.add(it.id);
  }
  return out;
}

function defaultCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const doc = globalThis.document;
  if (!doc) return null;
  const c = doc.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const PAN_CODES = Object.freeze({
  ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
});
const ZOOM_IN = new Set(['Equal', 'NumpadAdd', 'KeyZ']);
const ZOOM_OUT = new Set(['Minus', 'NumpadSubtract', 'KeyX']);
/** a press that moves less than this (logical px) is a tap, not a drag */
const TAP_SLOP = 4;

export class MapOverlay {
  /**
   * @param {Object} opts
   * @param {Object} opts.tuning the whole tuning object (reads tuning.mapOverlay)
   * @param {(w: number, h: number) => any} [opts.createCanvas]
   */
  constructor({ tuning, createCanvas = defaultCanvas }) {
    this.cfg = tuning.mapOverlay;
    this.createCanvas = createCanvas;
    this.isOpen = false;
    this.zoom = 0;
    /** map point at the centre of the view, in tiles */
    this.center = { x: 0, y: 0 };
    /** the island cache and its build progress */
    this.cache = null;
    this.cacheMap = null;
    this.plan = [];
    this.planned = 0;
    /** the fog layer and what it was built from */
    this.fogCanvas = null;
    this.fogKey = null;
    this.drag = null;
    /** last frame's view transform and button rectangles (for input) */
    this.view = null;
    this.buttons = { close: null, zoom: null };
    /** timings, for the debug readout and the smoke check */
    this.stats = { openedAt: 0, firstFrameMs: 0, cacheMs: 0, cacheFrames: 0, cacheReadyMs: null };
    this.cleanup = [];
  }

  /** the cache is complete */
  get ready() {
    return !!this.cache && this.planned >= this.plan.length;
  }

  /**
   * Open on the player (zoomed out).
   * @param {Object} sim
   */
  open(sim) {
    if (!sim?.map) return false;
    this.isOpen = true;
    const p = worldToMap(sim.player.x, sim.player.y);
    this.center = { x: p.x, y: p.y };
    this.zoom = 0;
    this.drag = null;
    this.stats.openedAt = nowMs();
    this.stats.cacheReadyMs = this.ready && this.cacheMap === sim.map ? 0 : null;
    return true;
  }

  close() {
    this.isOpen = false;
    this.drag = null;
  }

  toggle(sim) {
    if (this.isOpen) this.close();
    else this.open(sim);
    return this.isOpen;
  }

  setZoom(z, anchor = null) {
    const next = Math.max(0, Math.min(this.cfg.zoomLevels.length - 1, z));
    if (next === this.zoom) return;
    if (anchor && this.view) {
      // keep the map point under the anchor where it is
      const m = screenToMap(this.view, anchor.x, anchor.y);
      const k = this.cfg.zoomLevels[this.view.zoom] / this.cfg.zoomLevels[next];
      this.center = { x: m.x + (this.view.cx - m.x) * k, y: m.y + (this.view.cy - m.y) * k };
    }
    this.zoom = next;
  }

  /** pan by screen px */
  panBy(dx, dy) {
    const s = this.view?.scale ?? 1;
    this.center = { x: this.center.x - dx / s, y: this.center.y - dy / s };
  }

  /**
   * One input event while open (pure: no DOM objects).
   *   { type: 'key', code }  { type: 'down' | 'move' | 'up', id, x, y }  { type: 'wheel', dy, x, y }
   * @returns {'close'|'zoom'|'pan'|null} what it did
   */
  handleInput(ev) {
    if (!this.isOpen) return null;
    switch (ev.type) {
      case 'key':
        if (ZOOM_IN.has(ev.code)) { this.setZoom(this.zoom === this.cfg.zoomLevels.length - 1 && ev.code === 'KeyZ' ? 0 : this.zoom + 1); return 'zoom'; }
        if (ZOOM_OUT.has(ev.code)) { this.setZoom(this.zoom - 1); return 'zoom'; }
        return null;
      case 'wheel':
        this.setZoom(this.zoom + (ev.dy < 0 ? 1 : -1), { x: ev.x, y: ev.y });
        return 'zoom';
      case 'down':
        if (this.drag) return null;
        this.drag = { id: ev.id, x: ev.x, y: ev.y, startX: ev.x, startY: ev.y, moved: false };
        return null;
      case 'move': {
        const d = this.drag;
        if (!d || d.id !== ev.id) return null;
        if (!d.moved && Math.abs(ev.x - d.startX) + Math.abs(ev.y - d.startY) > TAP_SLOP) d.moved = true;
        if (d.moved) this.panBy(ev.x - d.x, ev.y - d.y);
        d.x = ev.x;
        d.y = ev.y;
        return d.moved ? 'pan' : null;
      }
      case 'up': {
        const d = this.drag;
        if (!d || d.id !== ev.id) return null;
        this.drag = null;
        if (d.moved) return 'pan';
        const hit = (r) => r && ev.x >= r.x && ev.x < r.x + r.w && ev.y >= r.y && ev.y < r.y + r.h;
        if (hit(this.buttons.close)) { this.close(); return 'close'; }
        if (hit(this.buttons.zoom)) { this.setZoom(this.zoom === this.cfg.zoomLevels.length - 1 ? 0 : this.zoom + 1); return 'zoom'; }
        return null;
      }
      default: return null;
    }
  }

  /**
   * Per frame while open: key panning.
   * @param {number} dt seconds
   * @param {{ heldCodes?: Set<string> }|null} input
   */
  update(dt, input) {
    if (!this.isOpen || !input?.heldCodes) return;
    let dx = 0;
    let dy = 0;
    for (const code of input.heldCodes) {
      const d = PAN_CODES[code];
      if (d) { dx += d[0]; dy += d[1]; }
    }
    if (dx || dy) {
      const step = this.cfg.panSpeed * Math.min(dt, 0.1);
      this.panBy(-dx * step, -dy * step);
    }
  }

  /**
   * Wire browser events: a full-screen hit region (so presses on the map never reach the game's controls), pointer
   * and wheel on the surface, zoom keys on the window. Returns a function that removes them.
   * @param {{ input: import('../engine/InputManager.js').InputManager, surface: EventTarget, win?: EventTarget }} env
   */
  attach({ input, surface, win = globalThis.window }) {
    const on = (target, type, fn, opts) => {
      if (!target) return;
      target.addEventListener(type, fn, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn, opts));
    };
    this.cleanup.push(input.addHitRegion('map-overlay', () => (this.isOpen ? { x: -1e4, y: -1e4, w: 2e4, h: 2e4 } : null), () => {}));
    const pos = (e) => input.toLogical(e);
    on(surface, 'pointerdown', (e) => { if (this.isOpen) { const p = pos(e); this.handleInput({ type: 'down', id: e.pointerId, x: p.x, y: p.y }); } });
    on(surface, 'pointermove', (e) => { if (this.isOpen) { const p = pos(e); this.handleInput({ type: 'move', id: e.pointerId, x: p.x, y: p.y }); } });
    on(surface, 'pointerup', (e) => { if (this.isOpen) { const p = pos(e); this.handleInput({ type: 'up', id: e.pointerId, x: p.x, y: p.y }); } });
    on(surface, 'pointercancel', () => { this.drag = null; });
    on(surface, 'wheel', (e) => {
      if (!this.isOpen) return;
      const p = pos(e);
      this.handleInput({ type: 'wheel', dy: e.deltaY, x: p.x, y: p.y });
      e.preventDefault();
    }, { passive: false });
    on(win, 'keydown', (e) => { if (this.isOpen && !e.repeat && this.handleInput({ type: 'key', code: e.code })) e.preventDefault(); });
    return () => { for (const fn of this.cleanup.splice(0)) fn(); };
  }

  // ---- caches ------------------------------------------------------------------------------------------------

  /** build the next chunk of the island cache (one per frame) */
  buildStep(map) {
    if (this.cacheMap !== map) {
      this.cacheMap = map;
      this.cache = this.createCanvas(map.width, map.height);
      this.plan = chunkPlan(map.height, this.cfg.chunkRows);
      this.planned = 0;
      this.stats.cacheMs = 0;
      this.stats.cacheFrames = 0;
    }
    if (!this.cache || this.planned >= this.plan.length) return;
    const t0 = nowMs();
    const { r0, r1 } = this.plan[this.planned++];
    const g = this.cache.getContext('2d');
    const img = g.createImageData(map.width, r1 - r0);
    const d = img.data;
    let k = 0;
    for (let r = r0; r < r1; r++) {
      for (let c = 0; c < map.width; c++) {
        const rgb = TERRAIN_RGB[map.terrainIdAt(c, r)];
        const shade = map.isBlocked(c, r) ? BLOCKED_SHADE : 1;
        d[k] = rgb[0] * shade; d[k + 1] = rgb[1] * shade; d[k + 2] = rgb[2] * shade; d[k + 3] = 255;
        k += 4;
      }
    }
    g.putImageData(img, 0, r0);
    this.stats.cacheMs += nowMs() - t0;
    this.stats.cacheFrames++;
    if (this.planned >= this.plan.length && this.stats.cacheReadyMs === null) this.stats.cacheReadyMs = nowMs() - this.stats.openedAt;
  }

  /** the fog layer (one pixel per cell), rebuilt when the fog changes */
  fogLayer(fog) {
    if (this.fogKey && this.fogKey.fog === fog && this.fogKey.revision === fog.revision && this.fogKey.explored === fog.explored) return this.fogCanvas;
    if (!this.fogCanvas || this.fogCanvas.width !== fog.cols || this.fogCanvas.height !== fog.rows) this.fogCanvas = this.createCanvas(fog.cols, fog.rows);
    if (!this.fogCanvas) return null;
    const g = this.fogCanvas.getContext('2d');
    const img = g.createImageData(fog.cols, fog.rows);
    const d = img.data;
    const [pr, pg, pb] = HEX(MAP_COLORS.parchment);
    const [vr, vg, vb] = HEX(MAP_COLORS.forgotten);
    let k = 0;
    for (let cy = 0; cy < fog.rows; cy++) {
      for (let cx = 0; cx < fog.cols; cx++) {
        const i = cy * fog.cols + cx;
        if ((fog.bits[i >> 3] >> (i & 7)) & 1) { d[k + 3] = 0; } else if ((fog.forgottenBits[i >> 3] >> (i & 7)) & 1) {
          // a violet smear over a little of the old ground: you knew this once
          d[k] = (pr + vr) >> 1; d[k + 1] = (pg + vg) >> 1; d[k + 2] = (pb + vb) >> 1; d[k + 3] = 215;
        } else {
          d[k] = pr; d[k + 1] = pg; d[k + 2] = pb; d[k + 3] = 255;
        }
        k += 4;
      }
    }
    g.putImageData(img, 0, 0);
    this.fogKey = { fog, revision: fog.revision, explored: fog.explored };
    return this.fogCanvas;
  }

  // ---- drawing -----------------------------------------------------------------------------------------------

  /**
   * Draw the map on #ui (logical pixels). Builds one chunk of the island cache per call until it is complete.
   * @param {CanvasRenderingContext2D} ctx
   * @param {{ uiLogicalWidth: number, uiLogicalHeight: number }} vp
   * @param {{ top?: number, right?: number, bottom?: number, left?: number }} safe
   * @param {Object} sim
   * @param {number} now ms, for the animations
   */
  draw(ctx, vp, safe, sim, now = 0) {
    if (!this.isOpen || !sim?.map) return;
    const t0 = nowMs();
    const map = sim.map;
    this.buildStep(map);
    const C = MAP_COLORS;
    const frame = overlayFrame(vp, safe, this.cfg.margin);
    const area = frame.map;
    const view = viewFor(area, map.width, map.height, this.cfg.zoomLevels, this.zoom, this.center);
    this.view = view;
    // zoomed in, the clamp is real (dragging past an edge does not build up); zoomed out the whole island is
    // centred, and the wanted centre (the player, or where the viewer panned to) is kept for the next zoom in
    if (view.zoom > 0) this.center = { x: view.cx, y: view.cy };
    const shifting = !!sim.fog?.shifting;
    const time = now / 1000;

    ctx.save();
    ctx.fillStyle = 'rgba(13, 11, 18, 0.92)';
    ctx.fillRect(0, 0, vp.uiLogicalWidth, vp.uiLogicalHeight);
    // the weathered paper 9-slice as the frame, reaching a little past the map on every side
    drawPaperPanel(ctx, frame.x - PAPER_PAD, frame.y - PAPER_PAD, frame.w + PAPER_PAD * 2, frame.h + PAPER_PAD * 2);
    ctx.fillStyle = C.parchmentEdge;
    ctx.fillRect(area.x - 1, area.y - 1, area.w + 2, area.h + 2);
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.w, area.h);
    ctx.clip();
    // around the island and under what is unknown alike: parchment, so the grid's square edge never shows
    ctx.fillStyle = C.parchment;
    ctx.fillRect(area.x, area.y, area.w, area.h);

    const mw = map.width * view.scale;
    const mh = map.height * view.scale;
    if (this.cache) {
      ctx.imageSmoothingEnabled = false;
      // only the rows built so far
      const rows = this.ready ? map.height : (this.plan[this.planned - 1]?.r1 ?? 0);
      if (rows > 0) ctx.drawImage(this.cache, 0, 0, map.width, rows, view.ox, view.oy, mw, rows * view.scale);
    }
    const fog = sim.fog;
    if (fog) {
      const layer = this.fogLayer(fog);
      if (layer) {
        ctx.imageSmoothingEnabled = true;
        const fw = fog.cols * fog.cfg.cellTiles * view.scale;
        const fh = fog.rows * fog.cfg.cellTiles * view.scale;
        ctx.drawImage(layer, view.ox, view.oy, fw, fh);
        if (shifting) {
          // the map itself will not hold still: violet ghosts of the fog sliding on either side
          const off = 1.5 + Math.sin(time * 2.3) * 1.5;
          ctx.globalAlpha = 0.22;
          ctx.globalCompositeOperation = 'screen';
          ctx.drawImage(layer, view.ox + off, view.oy, fw, fh);
          ctx.drawImage(layer, view.ox - off, view.oy + off * 0.5, fw, fh);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 0.08 + 0.06 * Math.sin(time * 3.1);
          ctx.fillStyle = C.forgotten;
          ctx.fillRect(area.x, area.y, area.w, area.h);
          ctx.globalAlpha = 1;
        }
        ctx.imageSmoothingEnabled = false;
      }
    }
    if (!this.ready) {
      ctx.font = '7px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = C.dim;
      ctx.fillText(`charting… ${Math.round((this.planned / Math.max(1, this.plan.length)) * 100)}%`, area.x + area.w / 2, area.y + area.h - 8);
    }
    this.drawLandmarks(ctx, sim, view);
    this.drawPlayer(ctx, sim, view, time);
    ctx.restore();

    this.drawCompassRose(ctx, area);
    this.drawHeader(ctx, frame, sim, shifting, time);
    this.stats.lastFrameMs = nowMs() - t0;
    if (!this.stats.firstFrameMs) this.stats.firstFrameMs = this.stats.lastFrameMs;
  }

  drawLandmarks(ctx, sim, view) {
    const fog = sim.fog;
    if (!fog) return;
    const C = MAP_COLORS;
    ctx.font = '6px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const items = [];
    for (const l of sim.map.entitiesOfType('landmark')) {
      if (!fog.discovered.has(l.id)) continue;
      const m = worldToMap(l.x, l.y);
      const s = mapToScreen(view, m.x, m.y);
      const name = l.name ?? l.id;
      items.push({ id: l.id, sx: Math.round(s.x) + 5, sy: Math.round(s.y), w: ctx.measureText(name).width + 2, name, x: Math.round(s.x), y: Math.round(s.y) });
    }
    const pm = worldToMap(sim.player.x, sim.player.y);
    const ps = mapToScreen(view, pm.x, pm.y);
    const labelled = placeLabels(items, 7, [{ x: ps.x - 7, y: ps.y - 7, w: 14, h: 14 }]);
    // every marker first, then the labels over them
    for (const it of items) drawMapMarker(ctx, markerForLandmark(it.id), it.x, it.y);
    for (const it of items) {
      if (!labelled.has(it.id)) continue;
      ctx.fillStyle = 'rgba(13, 11, 18, 0.6)';
      ctx.fillRect(it.sx - 1, it.sy - 4, it.w, 8);
      ctx.fillStyle = C.text;
      ctx.fillText(it.name, it.sx, it.sy);
    }
    this.lastLabels = labelled.size;
  }

  drawPlayer(ctx, sim, view, time) {
    const C = MAP_COLORS;
    const p = sim.player;
    const m = worldToMap(p.x, p.y);
    const s = mapToScreen(view, m.x, m.y);
    const dx = p.dirX;
    const dy = p.dirY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const fx = dx / len;
    const fy = dy / len;
    const ring = 4 + 2 * (0.5 + 0.5 * Math.sin(time * 4));
    ctx.strokeStyle = C.player;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(s.x, s.y, ring, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (activeAssets()?.hasIcon('ui', 'marker_player')) {
      // the amber arrowhead, turned to the facing (presentation-only angle, clockwise from up)
      drawMapMarker(ctx, 'player', s.x, s.y, Math.atan2(fx, -fy));
      return;
    }
    ctx.beginPath();
    ctx.moveTo(s.x + fx * 5, s.y + fy * 5);
    ctx.lineTo(s.x - fx * 3 - fy * 3, s.y - fy * 3 + fx * 3);
    ctx.lineTo(s.x - fx * 1.5, s.y - fy * 1.5);
    ctx.lineTo(s.x - fx * 3 + fy * 3, s.y - fy * 3 - fx * 3);
    ctx.closePath();
    ctx.fillStyle = C.playerEdge;
    ctx.fill();
    ctx.strokeStyle = C.player;
    ctx.stroke();
  }

  drawCompassRose(ctx, area) {
    const C = MAP_COLORS;
    const cx = Math.round(area.x + 16);
    const cy = Math.round(area.y + area.h - 18);
    ctx.save();
    ctx.fillStyle = 'rgba(13, 11, 18, 0.55)';
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.text;
    const star = (ax, ay, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx + ax * 9, cy + ay * 9);
      ctx.lineTo(cx + ay * 2.2, cy - ax * 2.2);
      ctx.lineTo(cx - ay * 2.2, cy + ax * 2.2);
      ctx.closePath();
      ctx.fill();
    };
    star(0, -1, C.playerEdge);
    star(0, 1, C.dim);
    star(1, 0, C.dim);
    star(-1, 0, C.dim);
    ctx.font = '6px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = C.text;
    ctx.fillText('N', cx, cy - 10);
    ctx.restore();
  }

  drawHeader(ctx, frame, sim, shifting, time) {
    const C = MAP_COLORS;
    const { x, y, w, header } = frame;
    ctx.save();
    // the header is written on the paper frame, in its dark ink
    ctx.font = '7px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = shifting ? C.forgotten : C.paperInk;
    const fog = sim.fog;
    const share = fog ? fog.exploredFraction * 100 : 0;
    const pct = fog ? ` · ${share < 10 ? share.toFixed(1) : Math.round(share)}% charted` : '';
    ctx.fillText(shifting ? 'THE PATHS ARE SHIFTING' : `ISLAND MAP${pct}`, x + 4, y + header / 2);
    // tide and time, right of centre
    const parts = [];
    if (sim.world) {
      const t = tideReadout(sim.world);
      const h = sim.world.timeOfDay;
      parts.push(`day ${sim.world.day} ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`);
      parts.push(`${t.line1.replace(/\s+/g, ' ')} ${t.rising ? '↑' : '↓'} ${t.line2}`);
    }
    // buttons: zoom and close, right-aligned and finger-sized
    const bw = header + 6;
    this.buttons.close = { x: x + w - bw, y: y - 2, w: bw, h: header + 4 };
    this.buttons.zoom = { x: x + w - 2 * bw - 2, y: y - 2, w: bw, h: header + 4 };
    ctx.fillStyle = C.paperDim;
    ctx.textAlign = 'right';
    ctx.fillText(parts.join('   '), this.buttons.zoom.x - 6, y + header / 2);
    for (const [k, label] of [['zoom', this.zoom ? '−' : '+'], ['close', '×']]) {
      const b = this.buttons[k];
      ctx.fillStyle = '#24212c';
      ctx.fillRect(b.x + 1, y + 1, b.w - 2, header - 2);
      ctx.fillStyle = C.text;
      ctx.textAlign = 'center';
      ctx.fillText(label, b.x + b.w / 2, y + header / 2);
    }
    if (shifting) {
      ctx.strokeStyle = C.forgotten;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 3);
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, frame.h - 1);
    }
    ctx.restore();
  }
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}
