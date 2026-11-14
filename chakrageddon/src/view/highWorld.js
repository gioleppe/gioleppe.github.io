// Being high changes the world (IMPROVEMENTS.md, point 1). The overworld view calls in here at a few points:
//   from the Come-up  light sources glow, and encounter tiles shimmer where an Astral waits for you to get higher
//   from Peaking      faint mandalas drift over the ground (two at most), and certain people leave colour trails
//   at Ego gone       each zone's hallucination (zone.hallucinations) shows up: people and things that are not there,
//                     drawn see-through and off-colour, that dissolve with a sound when you come within two tiles
// Grounded mode and reduced motion keep all of it but hold it still. Nothing here changes the rules.
import { bandIndex, egoGone, highOnly } from '../core/intox.js';
import { npcVisible, npcPos, isNight } from '../core/OverworldEngine.js';

const TS = 16;
/** the people who leave trails when you are Peaking: the performers */
export const TRAIL_SPRITES = new Set(['raver', 'firespinner', 'juggler', 'dj']);
// light sources: colour and where the light sits, in pixels from the top of its tile
const GLOW_PROPS = { lamp: ['#FFE066', -11], strobe: ['#F4F8FF', -9], mushroom: ['#4FE88A', -2], totem: ['#C86BFF', -11], chai: ['#FFB347', -6] };
const GLOW_TILES = { bonfire: ['#FF8A3A', 6], fairy: ['#FF4FA8', 8], dancefloor: null };
const GLOW_NPCS = { glowcap: ['#4FE88A', 8], ufo: ['#5FF4FF', 6], glyph: ['#C86BFF', 8], uvjar: ['#C86BFF', 7] };
const RAINBOW = ['#FF4FA8', '#FF9A2A', '#FFE066', '#4FE88A', '#5FF4FF', '#C86BFF'];

const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return (h ^ (h >>> 16)) >>> 0; };
const near = (x, y, px, py, r) => Math.max(Math.abs(x - px), Math.abs(y - py)) <= r;

export const highWorld = {
  zoneId: null, gone: new Set(), fading: {}, cow: null, crowd: null, egoT: 0, bursts: [], slots: [],

  reset() { this.zoneId = null; this.gone = new Set(); this.fading = {}; this.cow = null; this.crowd = null; this.egoT = 0; this.bursts = []; this.slots = []; },

  /** the hallucinations of the zone you are in, when your ego is gone */
  list(game) {
    const s = game.engine.state;
    return egoGone(game.data.rules, s.intox) ? (game.data.zones[s.zoneId].hallucinations || []).filter((h) => !(h.unless && s.flags[h.unless])) : [];   // unless: a story flag that ends it (the cow that got up for good)
  },
  has(game, kind) { return this.list(game).find((h) => h.kind === kind); },
  calm(game) { return !!(game.settings.reducedMotion || game.settings.grounded); },

  update(view, game, dt) {
    const s = game.engine.state, zone = game.data.zones[s.zoneId], still = this.calm(game);
    if (this.zoneId !== s.zoneId) { this.reset(); this.zoneId = s.zoneId; }
    for (const b of this.bursts) b.t += dt;
    this.bursts = this.bursts.filter((b) => b.t < 1.4);
    for (const [id, f] of Object.entries(this.fading)) { f.t += dt; if (f.t >= 0.7) { delete this.fading[id]; this.gone.add(id); } }
    const list = this.list(game), p = s.player;
    this.egoT = list.length ? this.egoT + dt : 0;
    for (const h of list) {
      const id = h.id || h.kind;
      if (h.kind === 'person' || h.kind === 'echo') {
        const at = h.kind === 'echo' ? this.echoAt(game, h) : h;
        if (!at || this.gone.has(id) || this.fading[id]) {
          // the lifeguard's chair stays a moment longer than he does
          if (h.chair && this.gone.has(id) && !this.gone.has(id + ':chair') && !this.fading[id + ':chair']) {
            this.chairT = (this.chairT || 0) + dt;
            if (this.chairT > 1) this.dissolve(game, id + ':chair');
          }
          continue;
        }
        if (near(Math.round(at.x), Math.round(at.y), p.x, p.y, 2)) {
          this.dissolve(game, id);
          if (h.say) game.say(`${h.say[0]}: "${h.say[1]}"`);
        }
      } else if (h.kind === 'cow_walk' && !this.gone.has(id)) {
        this.cow ||= { t: 0 };
        if (still) { if (!this.fading[id] && near(h.x - 1, h.y, p.x, p.y, 2)) this.dissolve(game, id); }
        else if (near(h.x, h.y, p.x, p.y, 9)) { this.cow.t += dt; if (this.cow.t > 3.2 && !this.fading[id]) this.dissolve(game, id); }
      } else if (h.kind === 'crowd_turn' && !this.crowd && this.egoT > 3) {
        // for one bar the music stops dead and the whole crowd turns to look at you; then the track drops back in
        const bpm = zone.baseBpm || 140, r = game.audio?.breakdown?.() || { delay: 0, dur: (4 * 60) / bpm };
        this.crowd = { start: view.t + r.delay, end: view.t + r.delay + r.dur };
      }
    }
  },
  dissolve(game, id) { this.fading[id] = { t: 0 }; game.audio?.sfx('dissolve'); },
  /** the memory vendor's rainbow (a script's { fx: 'rainbow_burst', at }) */
  burst(game, e) {
    const zone = game.data.zones[game.engine.state.zoneId], n = (zone.npcs || []).find((x) => x.id === e.npcId);
    const p = n ? npcPos({ data: game.data, state: game.engine.state }, n, zone) : game.engine.state.player;
    this.bursts.push({ x: p.x * TS + 8, y: p.y * TS - 2, t: 0 });
    game.audio?.sfx('burst');
  },

  /** during the crowd's turn: which way a dancer at row y faces (null when they are dancing) */
  crowdPose(view, game, y) {
    if (!this.crowd || view.t < this.crowd.start || view.t > this.crowd.end) return null;
    const meta = game.atlas.dancers || {};
    return y > game.engine.state.player.y ? meta.back ?? 0 : meta.still ?? 0;
  },
  crowdTurning(view) { return !!(this.crowd && view.t >= this.crowd.start && view.t <= this.crowd.end); },
  /** the influencers film the wrong sun */
  face(game, npcId) { return this.has(game, 'two_suns')?.face?.[npcId] || null; },
  treesDance(game) { return !!this.has(game, 'trees_dance'); },
  echoAt(game, h) {
    const zone = game.data.zones[game.engine.state.zoneId], n = (zone.npcs || []).find((x) => x.id === h.npc);
    if (!n || !npcVisible({ data: game.data, state: game.engine.state }, n)) return null;
    return { x: n.x + h.dx, y: n.y + h.dy };
  },

  /** see-through, colour-shifted and shimmering: how anything that is not really there is drawn */
  ghost(view, game, g, fn, fade = 0) {
    // the figure itself, see-through, with a pink copy one pixel left and a cyan one one pixel right that drift apart
    const still = this.calm(game), a = g.globalAlpha, rise = -Math.round(fade * 6);
    const had = 'filter' in g, f = had ? g.filter : null, split = still ? 1 : 1 + Math.round((Math.sin(view.t * 3) + 1) / 2);
    if (had) {
      for (const [hue, dx] of [[300, -split], [170, split]]) { g.globalAlpha = a * 0.3 * (1 - fade); g.filter = `hue-rotate(${hue}deg) saturate(2)`; fn(dx, rise); }
      g.filter = f;
    }
    g.globalAlpha = a * 0.62 * (1 - fade);
    fn(0, rise);
    g.globalAlpha = a;
  },

  /** things that stand in the world and sort with everyone else by row: [{ y, draw }] */
  ents(view, game, g, cx, cy) {
    const out = [], s = game.engine.state, ctx = { data: game.data, state: s }, zone = game.data.zones[s.zoneId];
    for (const h of this.list(game)) {
      const id = h.id || h.kind;
      if (h.kind === 'person') {
        const fade = this.fading[id] ? this.fading[id].t / 0.7 : this.gone.has(id) ? 1 : 0;
        if (h.chair && !this.gone.has(id + ':chair')) {
          const cf = this.fading[id + ':chair'] ? this.fading[id + ':chair'].t / 0.7 : 0;
          out.push({ y: h.y - 0.01, draw: () => this.ghost(view, game, g, (jx, jy) => view.prop(game, g, h.chair, game.images[`prop:${h.chair}`], game.atlas.props[h.chair], h.x * TS + 8 - cx + jx, (h.y + 1) * TS - cy + jy, h.x, h.y), cf) });
        }
        if (fade >= 1) continue;
        out.push({ y: h.y, draw: () => this.ghost(view, game, g, (jx, jy) => {
          if (h.seat) view.tile(game, g, h.seat, h.x * TS - cx + jx, h.y * TS - cy + 3);
          const lift = h.chair ? 14 : h.seat ? -2 : 0;
          view.char(game, g, h.sprite, h.dir || 'DOWN', 0, h.x * TS - cx + jx, h.y * TS - cy - 10 - lift + jy);
        }, fade) });
      } else if (h.kind === 'stall') {
        const n = (zone.npcs || []).find((x) => x.id === h.whileNpc);
        if (n && npcVisible(ctx, n)) out.push({ y: h.y, draw: () => this.ghost(view, game, g, (jx) => view.tile(game, g, 'stall', h.x * TS - cx + jx, h.y * TS - cy)) });
      } else if (h.kind === 'echo') {
        const at = this.echoAt(game, h), fade = this.fading[id] ? this.fading[id].t / 0.7 : 0;
        if (!at || this.gone.has(id)) continue;
        const n = (zone.npcs || []).find((x) => x.id === h.npc), bpm = zone.baseBpm || 140;
        out.push({ y: at.y - 0.02, draw: () => this.ghost(view, game, g, (jx, jy) => {
          const dx = Math.round(at.x * TS - cx) + jx, dy = Math.round(at.y * TS - cy) + jy;
          view.char(game, g, n.sprite, n.dir || 'DOWN', 0, dx, dy - 10);
          view.trick(g, n.sprite, dx, dy - 10, view.t - (h.lag || 0.5) * 60 / bpm, bpm);   // half a beat behind
        }, fade) });
      } else if (h.kind === 'cow_walk' && !this.gone.has(id)) {
        const still = this.calm(game), pr = game.atlas.props.cow_stand, img = game.images['prop:cow_stand'];
        if (!pr || !img) continue;
        const k = still ? 0 : Math.min(1, (this.cow?.t || 0) / 3), fade = this.fading[id] ? this.fading[id].t / 0.7 : 0;
        const wx = (h.x + 1 + (still ? -2.5 : (h.toward || -1) * 4 * k)) * TS, wy = (h.y + 1) * TS;
        const frame = still || k >= 1 || k === 0 ? 0 : 1 + (Math.floor(view.t * 5) % 2);
        out.push({ y: h.y + 0.01, draw: () => this.ghost(view, game, g, (jx, jy) => g.drawImage(img, frame * pr.w, 0, pr.w, pr.h, Math.round(wx - pr.w / 2 - cx) + jx, Math.round(wy - pr.h - cy) + jy, pr.w, pr.h), fade) });
      }
    }
    return out;
  },

  /** over the ground, under everyone: Peaking mandalas, and the shimmer where a high-only Astral waits */
  ground(view, game, g, cx, cy, x0, y0, x1, y1) {
    const s = game.engine.state, zone = game.data.zones[s.zoneId], legend = game.data.legend, band = bandIndex(game.data.rules, s.intox), still = this.calm(game);
    if (band < 1) return;
    const id = (x, y) => legend[zone.rows[y]?.[x]]?.id;
    // the shimmer: a few encounter tiles twinkle while something here needs you higher than you are
    const enc = zone.encounters, waiting = enc && [...(enc.table || []), ...(enc.water || [])].some((e) => e.minIntox > s.intox && !(e.night && !isNight(s)));
    if (waiting) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const t = id(x, y), h = hash(x, y);
        if (!(t === 2 || (t === 3 && enc.water)) || h % 7) continue;
        const on = still || (Math.floor(view.t * 2.5 + (h % 10) / 3) % 4) === 0;
        if (!on) continue;
        const sx = x * TS - cx + 3 + (h >>> 3) % 10, sy = y * TS - cy + 3 + (h >>> 7) % 10;
        g.globalAlpha = still ? 0.45 : 0.8; g.fillStyle = '#F4F0FF';
        g.fillRect(sx - 1, sy, 3, 1); g.fillRect(sx, sy - 1, 1, 3);
        g.fillStyle = '#FFFFFF'; g.fillRect(sx, sy, 1, 1);
        g.globalAlpha = 1;
      }
    }
    if (band < 2) return;
    // two mandalas at most, each fading in and out of a spot near you over six seconds, drifting off when you step on them
    const p = view.camPos || { x: s.player.x * TS, y: s.player.y * TS };
    for (let i = 0; i < 2; i++) {
      const P = 6, tt = view.t + i * 3, c = Math.floor(tt / P), f = (tt % P) / P;
      let sl = this.slots[i];
      if (!sl || sl.c !== c) {
        const h = hash(c * 7 + i, s.steps & 0xffff);
        sl = this.slots[i] = { c, x: s.player.x + ((h % 13) - 6), y: s.player.y + (((h >>> 4) % 9) - 4) };
      }
      const t = id(sl.x, sl.y);
      if (!(t === 0 || t === 2) || (sl.x === s.player.x && sl.y === s.player.y)) continue;
      let mx = sl.x * TS + 8, my = sl.y * TS + 8;
      const d = Math.hypot(mx - (p.x + 8), my - (p.y + 8));
      let a = still ? 0.3 : Math.sin(Math.PI * f) * 0.45;
      if (d < 22) { const k = (22 - d) / 22; mx += Math.sign(mx - p.x - 8 || 1) * k * 10; my += Math.sign(my - p.y - 8 || 1) * k * 6; a *= 1 - k; }
      if (a > 0.02) mandala(g, Math.round(mx - cx), Math.round(my - cy), 7, a, still ? 0 : view.t * 0.6 + i);
    }
  },

  /** over everything in the world, before the night tint: the second sun, the rainbow bursts */
  overlay(view, game, g, cx, cy) {
    const sun = this.has(game, 'two_suns'), still = this.calm(game);
    if (sun) {
      const x = sun.x * TS + 8 - cx, y = sun.y * TS + 4 - cy, pulse = still ? 0 : Math.sin(view.t * 2) * 1.2;
      g.globalAlpha = 0.25; g.fillStyle = '#FFB347'; g.beginPath(); g.arc(x, y, 16 + pulse, 0, 7); g.fill();
      g.globalAlpha = 0.75; g.fillStyle = '#FF9A2A'; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill();
      g.fillStyle = '#FFE066'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
      g.globalAlpha = 0.35; g.fillStyle = '#FF4FA8'; g.fillRect(x - 14, y + 11, 28, 1); g.fillRect(x - 9, y + 14, 18, 1);   // its reflection
      g.globalAlpha = 1;
    }
    for (const b of this.bursts) {
      const k = b.t / 1.4, x = b.x - cx, y = b.y - cy;
      g.globalAlpha = Math.max(0, 1 - k);
      for (let i = 0; i < 24; i++) {
        const ang = (i / 24) * Math.PI * 2, r = 4 + k * (26 + (i % 3) * 8);
        g.fillStyle = RAINBOW[i % RAINBOW.length];
        g.fillRect(Math.round(x + Math.cos(ang) * r), Math.round(y + Math.sin(ang) * r * 0.8 + k * k * 18), 2, 2);
      }
      g.strokeStyle = RAINBOW[Math.floor(b.t * 10) % RAINBOW.length]; g.lineWidth = 1;
      g.beginPath(); g.arc(x, y, 3 + k * 30, 0, 7); g.stroke();
      g.globalAlpha = 1;
    }
  },

  /** from the Come-up, light sources glow: a soft additive halo that grows with the band (after the night tint) */
  glow(view, game, g, cx, cy, x0, y0, x1, y1) {
    const s = game.engine.state, zone = game.data.zones[s.zoneId], legend = game.data.legend, band = bandIndex(game.data.rules, s.intox);
    if (band < 1) return;
    const still = this.calm(game), R = [0, 12, 15, 19][Math.min(3, band)], A = [0, 0.2, 0.26, 0.32][Math.min(3, band)];
    const lights = [];
    for (let y = y0; y <= Math.min(zone.rows.length - 1, y1 + 2); y++) for (let x = x0; x <= x1; x++) {
      const def = legend[zone.rows[y][x]];
      if (!def) continue;
      const pg = def.prop && GLOW_PROPS[def.prop], tg = GLOW_TILES[def.sprite];
      if (pg) lights.push([x, y, pg]); else if (tg) lights.push([x, y, tg]);
    }
    const ctx = { data: game.data, state: s };
    for (const n of zone.npcs || []) if (n.tile && GLOW_NPCS[n.tile] && npcVisible(ctx, n)) { const p = npcPos(ctx, n, zone); lights.push([p.x, p.y, GLOW_NPCS[n.tile]]); }
    if (!lights.length) return;
    const op = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    for (const [x, y, [col, oy]] of lights) {
      const lx = x * TS + 8 - cx, ly = y * TS + oy - cy, k = still ? 1 : 0.85 + 0.15 * Math.sin(view.t * 3 + x * 1.7 + y);
      const grd = g.createRadialGradient(lx, ly, 1, lx, ly, R * k);
      grd.addColorStop(0, col); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = A; g.fillStyle = grd; g.fillRect(lx - R, ly - R, R * 2, R * 2);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = op;
  },

  /** the stairs of light, over the water, at Ego gone */
  lightStep(view, game, g, dx, dy, x, y) {
    const still = this.calm(game), sh = still ? 0 : Math.floor(view.t * 6 + x * 2) % 12;
    g.globalAlpha = 0.65; g.fillStyle = '#FFF6C8'; g.fillRect(dx + 1, dy + 3, 14, 10);
    g.globalAlpha = 0.9; g.fillStyle = '#FFFFFF'; g.fillRect(dx + 1, dy + 3, 14, 1);
    g.fillStyle = '#FFE066'; g.fillRect(dx + 1, dy + 12, 14, 1);
    g.globalAlpha = 0.8; g.fillStyle = '#FFFFFF'; g.fillRect(dx + 2 + sh, dy + 6 + (y % 3), 1, 1);
    g.globalAlpha = 1;
  },

  /** the eye on the map and in the Journal: Astrals here that only come out when you are high */
  hidden(data, zoneId, seen) {
    return Object.entries(highOnly(data)).filter(([sp, at]) => !seen[sp] && at.some((a) => a.zone === zoneId)).map(([sp]) => sp);
  },
};

/** a mandala in single pixels: rings of dots on eight spokes, turning slowly */
export function mandala(g, cx, cy, r, alpha, rot) {
  g.globalAlpha = alpha;
  for (let ring = 2; ring <= r; ring += 2) {
    const n = ring * 2 + 4;
    g.fillStyle = RAINBOW[(ring / 2) % RAINBOW.length];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rot * (ring % 4 ? 1 : -1);
      g.fillRect(Math.round(cx + Math.cos(a) * ring), Math.round(cy + Math.sin(a) * ring * 0.6), 1, 1);
    }
  }
  g.fillStyle = '#FFFFFF'; g.fillRect(cx, cy, 1, 1);
  g.globalAlpha = 1;
}
