// Overworld: tiles, characters, camera, smooth steps. Reads engine state, never decides rules.
import { W, H } from './CanvasRenderer.js';
import { drawText, textWidth, wrap, panel, C } from './ui.js';
import { charAt, npcVisible, npcPos, isNight, nightLevel } from '../core/OverworldEngine.js';
import { bandOf, bandIndex } from '../core/intox.js';
import { routeHint } from '../core/goals.js';
import { hashOf } from './anim.js';
import { questMarker } from '../core/quests.js';
const SWAY_BAND = 4;   // rows per band when a prop sways (see prop)

const BAND_COLORS = ['#00FF66', '#FFD23F', '#FF4FA8', '#C86BFF'];
// quest markers as little pixel icons: K outline, Y fill, W highlight
const MARKS = {
  '!': ['.KKK.', 'KWYYK', 'KYYYK', 'KYYYK', 'KYYYK', '.KYK.', '..K..', '.KKK.', 'KYYYK', '.KKK.'],
  '?': ['.KKKKK.', 'KWYYYYK', 'KYKKKYK', 'KKK.KYK', '...KYYK', '..KYYK.', '..KYK..', '..KKK..', '.......', '..KKK..', '..KYK..', '..KKK..'],
};
const MARK_COLORS = { K: '#2A1A2E', Y: '#FFD23F', W: '#FFF4B0' };
function drawMarker(g, mark, x, y) {
  const rows = MARKS[mark];
  if (!rows) return;
  x -= Math.floor(rows[0].length / 2) - 2;
  g.fillStyle = 'rgba(20,10,40,0.35)';                                   // soft shadow, one pixel down-right
  rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] !== '.') g.fillRect(x + i + 1, y + j + 1, 1, 1); });
  rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] !== '.') { g.fillStyle = MARK_COLORS[r[i]]; g.fillRect(x + i, y + j, 1, 1); } });
}

const TS = 16, STEP = 0.15;

// Interior walls: a wall tile shows its front (the panelled face) only where open floor lies right below it,
// as the back wall of a room. Side and bottom walls are seen from above: the top of the wall, with a lit rim
// on each edge that faces the room. (They used to repeat the face, so side walls read as stacked panels.)
const WALL_TOPS = {
  inwall: { fill: '#7A5230', grain: '#6A4426', rim: '#D8B48A', line: '#4A2C14' },
};
const isWall = (cls, sp) => cls === sp || cls === 'out';
const VERTICAL = { fence: 'fence_v', cable: 'cable_v' };
/** the top of a wall at dx, dy; open[i] (up, right, down, left) says that side faces the room and gets a rim */
function wallTop(g, c, dx, dy, open) {
  g.fillStyle = c.fill; g.fillRect(dx, dy, TS, TS);
  g.fillStyle = c.grain; g.fillRect(dx, dy + 5, TS, 1); g.fillRect(dx, dy + 11, TS, 1);
  const [up, right, , left] = open;
  g.fillStyle = c.rim;
  if (up) g.fillRect(dx, dy, TS, 2);
  if (left) g.fillRect(dx, dy, 2, TS);
  if (right) g.fillRect(dx + TS - 2, dy, 2, TS);
  g.fillStyle = c.line;
  if (up) g.fillRect(dx + (left ? 2 : 0), dy + 2, TS - (left ? 2 : 0) - (right ? 2 : 0), 1);
  if (left) g.fillRect(dx + 2, dy + (up ? 2 : 0), 1, TS - (up ? 2 : 0));
  if (right) g.fillRect(dx + TS - 3, dy + (up ? 2 : 0), 1, TS - (up ? 2 : 0));
}
const DIR_OF = { up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT' };

/** outdoor light for the clock: a night tint that deepens through dusk and lifts through dawn, and a warm glow
 *  at the turn (orange at dusk, pink at dawn) */
function daylight(g, clock) {
  const k = nightLevel(clock);
  if (k > 0) { g.fillStyle = `rgba(20,6,60,${+(0.42 * k).toFixed(3)})`; g.fillRect(0, 0, W, H); }
  const warm = 4 * k * (1 - k);
  if (warm > 0.02) {
    const dusk = ((clock % 1440) + 1440) % 1440 >= 12 * 60;
    g.fillStyle = dusk ? `rgba(255,110,50,${+(0.16 * warm).toFixed(3)})` : `rgba(255,160,140,${+(0.12 * warm).toFixed(3)})`;
    g.fillRect(0, 0, W, H);
  }
}

export const SKY_T = 2.6;
const BAND_Y = 6, BAND_H = 50;
/** a band across the top of the screen (night sky with stars, or blue sky) with the moon or the sun sweeping
 *  through it at double size, and a word on what just happened */
function drawSky(g, sky, still) {
  const k = sky.t / SKY_T, a = Math.max(0, Math.min(1, sky.t / 0.3, (SKY_T - sky.t) / 0.3));
  const moon = sky.icon === 'moon';
  const x = Math.round(still ? W / 2 : -24 + k * (W + 48)), y = BAND_Y + 20 - (still ? 0 : Math.round(Math.sin(k * Math.PI) * 2));
  g.save(); g.globalAlpha = a;
  g.fillStyle = moon ? 'rgba(11,3,20,0.82)' : 'rgba(63,150,176,0.82)'; g.fillRect(0, BAND_Y, W, BAND_H);
  g.fillStyle = moon ? '#6A4A9A' : '#BDE8F0'; g.fillRect(0, BAND_Y, W, 1); g.fillRect(0, BAND_Y + BAND_H - 1, W, 1);
  if (moon) for (let i = 0; i < 26; i++) {           // stars all along the band, twinkling
    const sx = (i * 53 + 7) % W, sy = BAND_Y + 3 + ((i * 29) % (BAND_H - 6)), on = still || (Math.floor(sky.t * 6) + i) % 4;
    if (!on || (Math.abs(sx - W / 2) < 44 && sy > BAND_Y + BAND_H - 15)) continue;   // none on the caption
    g.fillStyle = i % 3 ? '#C8C0E8' : '#FFF4C8'; g.fillRect(sx, sy, 1, 1);
    if (i % 5 === 0) { g.fillRect(sx - 1, sy, 3, 1); g.fillRect(sx, sy - 1, 1, 3); }
  }
  g.translate(x, y); g.scale(2, 2);                  // the icon in big, whole pixels
  if (moon) {
    // a crescent: a disc minus an offset disc
    for (let py = -7; py <= 7; py++) for (let px = -7; px <= 7; px++) {
      if (px * px + py * py > 46) continue;
      if ((px - 3) ** 2 + (py + 2) ** 2 <= 30) continue;
      g.fillStyle = px * px + py * py > 30 ? '#C8C0E8' : '#F4F0E8'; g.fillRect(px, py, 1, 1);
    }
  } else {
    // a sun with eight rays that turn in whole steps
    const turn = still ? 0 : Math.floor(sky.t * 6) % 2;
    g.fillStyle = '#FFE066';
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + turn * (Math.PI / 8);
      for (let r = 7; r <= 8; r++) g.fillRect(Math.round(Math.cos(ang) * r), Math.round(Math.sin(ang) * r), 1, 1);
    }
    for (let py = -6; py <= 6; py++) for (let px = -6; px <= 6; px++) {
      const d = px * px + py * py;
      if (d > 38) continue;
      g.fillStyle = d > 24 ? '#FFB347' : d < 6 ? '#FFF6C8' : '#FFE066'; g.fillRect(px, py, 1, 1);
    }
  }
  g.restore(); g.save(); g.globalAlpha = a;
  drawText(g, moon ? 'Night falls' : 'The sun comes up', W / 2, BAND_Y + BAND_H - 11, { color: moon ? '#F4F0E8' : '#FFF6C8', align: 'center', shadow: moon ? '#3A1A5A' : '#1E5A70' });
  g.restore();
}

export const overworldView = {
  anim: null, bumpT: 0, fade: 0, banner: null, bannerT: 0, alert: null, npcDir: {}, t: 0, walkFlip: 0,

  onEvent(game, e) {
    if (e.type === 'ENTITY_MOVED' && e.entityId === 'player') { this.anim = { from: e.from, to: e.to, t: 0 }; this.walkFlip ^= 1; }
    else if (e.type === 'BUMP') { this.bumpT = 0.18; game.audio?.sfx('bump'); }
    else if (e.type === 'ZONE_CHANGED') { this.anim = null; this.fade = 1; this.banner = e.name; this.bannerT = 3.2; this.npcDir = {}; this.npcAnim = {}; this.hint = routeHint(game.data, game.engine.state)?.text || null; }
    else if (e.type === 'EYE_CONTACT') { this.alert = { x: e.x, y: e.y, t: 0.8 }; }
    else if (e.type === 'NPC_FACE') this.npcDir[e.npcId] = e.dir;
    else if (e.type === 'NPC_MOVED') { (this.npcAnim ||= {})[e.npcId] = { from: e.from, to: e.to, t: 0, dist: Math.abs(e.to[0] - e.from[0]) + Math.abs(e.to[1] - e.from[1]), walkUp: !!e.walkUp }; this.npcDir[e.npcId] = e.dir; }
  },

  update(game, dt) {
    this.t += dt;
    // when the day turns (half way through dusk or dawn), a sun or a moon sweeps across the top of the screen
    const night = isNight(game.engine.state);
    if (this.dayFor !== game.engine) { this.dayFor = game.engine; this.wasNight = night; this.sky = null; }
    else if (night !== this.wasNight) { this.wasNight = night; this.sky = { icon: night ? 'moon' : 'sun', t: 0 }; }
    if (this.sky && (this.sky.t += dt) > SKY_T) this.sky = null;
    if (this.fade > 0) this.fade = Math.max(0, this.fade - dt * 3);
    if (this.bannerT > 0) this.bannerT -= dt;
    if (this.alert) { this.alert.t -= dt; if (this.alert.t <= 0) this.alert = null; }
    if (this.bumpT > 0) this.bumpT -= dt;
    if (this.anim) { this.anim.t += dt / STEP; if (this.anim.t >= 1) this.anim = null; }
    for (const [id, a] of Object.entries(this.npcAnim || {})) { a.t += dt / (STEP * (a.walkUp ? 1.2 : 1.6) * Math.max(1, a.dist || 1)); if (a.t >= 1) delete this.npcAnim[id]; }
    // rainbow trails behind you when your ego is gone (not in grounded mode, not with reduced motion)
    const st = game.engine.state, trails = bandIndex(game.data.rules, st.intox) >= 3 && !game.settings.grounded && !game.settings.reducedMotion;
    if (!trails) this.trail = [];
    else if (this.anim && this.camPos) { (this.trail ||= []).push({ ...this.camPos, dir: st.player.dir, t: this.t }); if (this.trail.length > 8) this.trail.shift(); }
    const s = game.engine.state, input = game.input;
    if (s.mode !== 'OVERWORLD' || this.anim || game.busy()) return;
    if (input.pressed('a') || input.anyTap()) return game.send({ type: 'INTERACT_TILE' });
    if (input.pressed('start')) return game.send({ type: 'TOGGLE_MENU' });
    input.pressed('b');
    const d = input.dir();
    if (d && this.bumpT <= 0) game.send({ type: 'MOVE_STEP', direction: DIR_OF[d] });
  },

  /** a tall prop, with a little life: palms and bamboo sway, flags flutter, lamps glow, speakers pump to the beat */
  prop(game, g, name, img, pr, bx, by, tx, ty) {
    const still = game.settings.reducedMotion, t = this.t;
    const bpm = game.data.zones[game.engine.state.zoneId]?.baseBpm || 140, beat = Math.max(0, 1 - (((t * bpm) / 60) % 1) * 4);
    const sway = still ? 0 : name === 'palm' || name === 'tree' ? Math.sin(t * 1.3 + tx * 0.9 + ty * 0.4) * 0.05 : name === 'bamboo' ? Math.sin(t * 1.7 + tx) * 0.08 : name === 'flag' ? Math.sin(t * 6 + tx) * 0.14 : 0;
    // Whole pixels only: a skew or a fractional scale resamples every row differently and shows as stripes.
    // A sway shifts 4-pixel bands of the sprite, more towards the top; a speaker hops 1 pixel on the beat.
    const x0 = Math.round(bx - pr.w / 2), y0 = Math.round(by - pr.h) - (!still && name === 'speaker' && beat > 0.5 ? 1 : 0);
    if (!sway) g.drawImage(img, 0, 0, pr.w, pr.h, x0, y0, pr.w, pr.h);
    else for (let y = 0; y < pr.h; y += SWAY_BAND) {
      const h = Math.min(SWAY_BAND, pr.h - y), shift = Math.round(sway * (pr.h - y - h / 2));
      g.drawImage(img, 0, y, pr.w, h, x0 + shift, y0 + y, pr.w, h);
    }
    if (name === 'lamp' && !still) { g.globalAlpha = 0.18 + 0.08 * Math.sin(t * 9 + tx * 3); g.fillStyle = '#FFE066'; g.beginPath(); g.arc(bx, by - pr.h + 5, 8, 0, 7); g.fill(); g.globalAlpha = 1; }
  },
  /** a dancer bouncing to the zone's BPM on a dancefloor tile */
  dancer(game, g, dx, dy, x, y) {
    const bpm = game.data.zones[game.engine.state.zoneId]?.baseBpm || 140, ph = ((this.t * bpm) / 60 + (x + y) * 0.25) % 1, up = ph < 0.5 ? 1 : 0;
    const col = ['#FF4FA8', '#5FF4FF', '#4FE88A', '#FFE066', '#C86BFF'][(x * 3 + y) % 5], skin = ['#F2C29A', '#C98A5A', '#8D5A3A'][(x + y * 2) % 3];
    g.fillStyle = 'rgba(11,3,20,0.3)'; g.fillRect(dx + 5, dy + 13, 6, 2);
    g.fillStyle = col; g.fillRect(dx + 6, dy + 6 - up, 4, 6); g.fillRect(dx + (ph < 0.25 || ph > 0.75 ? 4 : 10), dy + 3 - up, 2, 4);
    g.fillStyle = skin; g.fillRect(dx + 6, dy + 2 - up, 4, 4);
  },
  /** small loops for people with something in their hands */
  trick(g, sprite, x, y, t) {
    if (sprite === 'juggler') for (let i = 0; i < 3; i++) { const a = t * 5 + i * 2.1; g.fillStyle = ['#FF4FA8', '#FFE066', '#5FF4FF'][i]; g.fillRect(Math.round(x + 7 + Math.cos(a) * 6), Math.round(y - 2 - Math.abs(Math.sin(a)) * 7), 2, 2); }
    if (sprite === 'firespinner') for (let i = 0; i < 2; i++) { const a = t * 8 + i * Math.PI; g.fillStyle = i ? '#FFD23F' : '#FF6A2A'; g.fillRect(Math.round(x + 7 + Math.cos(a) * 9), Math.round(y + 12 + Math.sin(a) * 5), 2, 2); }
  },

  /** a trainer who spotted you is still walking over: hold their dialogue until they arrive */
  walking() { return Object.values(this.npcAnim || {}).some((a) => a.walkUp); },

  camera(game) {
    const s = game.engine.state, zone = game.data.zones[s.zoneId];
    let px = s.player.x * TS, py = s.player.y * TS;
    if (this.anim) {
      const a = this.anim;
      px = (a.from[0] + (a.to[0] - a.from[0]) * a.t) * TS; py = (a.from[1] + (a.to[1] - a.from[1]) * a.t) * TS;
    }
    const zw = zone.rows[0].length * TS, zh = zone.rows.length * TS;
    const cx = zw <= W ? -Math.floor((W - zw) / 2) : Math.max(0, Math.min(zw - W, Math.round(px + 8 - W / 2)));
    const cy = zh <= H ? -Math.floor((H - zh) / 2) : Math.max(0, Math.min(zh - H, Math.round(py + 8 - H / 2)));
    return { cx, cy, px: Math.round(px), py: Math.round(py) };
  },

  tile(game, g, name, x, y) {
    const i = game.atlas.tiles[name];
    if (i === undefined) return;
    g.drawImage(game.images.tiles, (i % game.atlas.tileCols) * TS, Math.floor(i / game.atlas.tileCols) * TS, TS, TS, x, y, TS, TS);
  },

  char(game, g, sprite, dir, step, x, y) {
    const img = game.images[`char:${sprite}`] || game.images['char:local'];
    const base = dir === 'DOWN' ? 0 : dir === 'UP' ? 2 : 4;
    const f = base + (step ? 1 : 0);
    if (dir === 'RIGHT') { g.save(); g.translate(x + 16, y); g.scale(-1, 1); g.drawImage(img, f * 16, 0, 16, 24, 0, 0, 16, 24); g.restore(); }
    else g.drawImage(img, f * 16, 0, 16, 24, x, y, 16, 24);
  },

  draw(game, g) {
    const s = game.engine.state, zone = game.data.zones[s.zoneId], ctx = { data: game.data, state: s };
    const { cx, cy, px, py } = this.camera(game);
    g.fillStyle = '#0B0314'; g.fillRect(0, 0, W, H);
    const legend = game.data.legend;
    const x0 = Math.max(0, Math.floor(cx / TS)), y0 = Math.max(0, Math.floor(cy / TS));
    const x1 = Math.min(zone.rows[0].length - 1, Math.floor((cx + W) / TS)), y1 = Math.min(zone.rows.length - 1, Math.floor((cy + H) / TS));
    const wave = Math.floor(this.t * 2) % 2;
    const gi = game.atlas.tiles[zone.ground], cols = game.atlas.tileCols;
    const resolve = (sp) => (sp[0] === '@' ? zone[sp.slice(1)] || (sp === '@ground2' ? zone.ground : sp === '@wall' ? 'cliff' : sp === '@encounter' ? 'incense' : 'sand') : sp);
    const classOf = (x, y) => {
      const ch = charAt(ctx, x, y, zone); if (ch === null) return 'out';
      const sp = resolve((legend[ch] || legend['#']).sprite);
      return sp === 'water' || sp === 'deep' ? 'water' : sp;
    };
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ch = charAt(ctx, x, y, zone), def = legend[ch] || legend['#'];
        let sp = resolve(def.sprite);
        const dx = x * TS - cx, dy = y * TS - cy;
        this.tile(game, g, zone.ground, dx, dy);
        if (sp === 'water' && wave) sp = 'water_b';
        // fences and cable runs: a north-south run gets its own upright piece, not a ladder of east-west segments
        if (VERTICAL[sp]) { const f = (fx, fy) => classOf(fx, fy) === sp; if ((f(x, y - 1) || f(x, y + 1)) && !f(x - 1, y) && !f(x + 1, y)) sp = VERTICAL[sp]; }
        const top = WALL_TOPS[sp];
        if (top && isWall(classOf(x, y + 1), sp)) wallTop(g, top, dx, dy, [classOf(x, y - 1), classOf(x + 1, y), classOf(x, y + 1), classOf(x - 1, y)].map((c) => !isWall(c, sp)));
        else if (sp !== zone.ground) this.tile(game, g, sp, dx, dy);
        if (sp === 'dancefloor' && (x * 7 + y * 3) % 5 === 0 && !game.settings.reducedMotion) this.dancer(game, g, dx, dy, x, y);
        if (sp === 'bonfire' && !game.settings.reducedMotion) for (let i = 0; i < 3; i++) {   // sparks rising off the fire
          const k = (this.t * 0.9 + i / 3 + x * 0.17) % 1;
          g.globalAlpha = 1 - k; g.fillStyle = i % 2 ? '#FFD23F' : '#FF6A2A';
          g.fillRect(dx + 6 + ((i * 3 + Math.floor(this.t * 2)) % 5), Math.round(dy + 3 - k * 14), 1, 1); g.globalAlpha = 1;
        }
        // soft edges: the base ground rounds off paths, shorelines get a foam line
        const cls = sp === 'water_b' || sp === 'deep' ? 'water' : sp;
        if (cls === zone.ground2 || cls === 'water') {
          const n = [classOf(x, y - 1), classOf(x + 1, y), classOf(x, y + 1), classOf(x - 1, y)].map((c) => c !== cls && c !== 'out');
          const water = cls === 'water';
          const edge = (ex, ey, ew, eh) => {
            if (water) { g.fillStyle = '#E4F6FA'; g.fillRect(dx + ex, dy + ey, ew, eh); }
            else g.drawImage(game.images.tiles, (gi % cols) * TS + ex, Math.floor(gi / cols) * TS + ey, ew, eh, dx + ex, dy + ey, ew, eh);
          };
          const E = water ? 1 : 2;
          if (n[0]) edge(0, 0, 16, E); if (n[2]) edge(0, 16 - E, 16, E);
          if (n[3]) edge(0, 0, E, 16); if (n[1]) edge(16 - E, 0, E, 16);
          const R = 4;   // rounded outer corners
          if (n[0] && n[3]) { edge(0, 0, R, R - 1); edge(0, 0, R - 1, R); }
          if (n[0] && n[1]) { edge(16 - R, 0, R, R - 1); edge(17 - R, 0, R - 1, R); }
          if (n[2] && n[3]) { edge(0, 17 - R, R, R - 1); edge(0, 16 - R, R - 1, R); }
          if (n[2] && n[1]) { edge(16 - R, 17 - R, R, R - 1); edge(17 - R, 16 - R, R - 1, R); }
          if (!water) {
            g.fillStyle = 'rgba(90,50,20,0.16)';
            if (n[0]) g.fillRect(dx, dy + E, 16, 1); if (n[3]) g.fillRect(dx + E, dy, 1, 16);
          }
        }
      }
    }
    // row-sorted pass: props, characters, pickups (lower rows overlap upper ones)
    const ents = [];
    const px0 = Math.max(0, x0 - 2), px1 = Math.min(zone.rows[0].length - 1, x1 + 2), py1 = Math.min(zone.rows.length - 1, y1 + 3);
    for (let y = y0; y <= py1; y++) for (let x = px0; x <= px1; x++) {
      const def = legend[charAt(ctx, x, y, zone)];
      if (def?.prop) ents.push({ y: y - 0.01, prop: def.prop, x });
    }
    for (const n of zone.npcs || []) if (npcVisible(ctx, n)) {
      const p = npcPos(ctx, n, zone), a = this.npcAnim?.[n.id];
      const fx = a ? a.from[0] + (a.to[0] - a.from[0]) * a.t : p.x, fy = a ? a.from[1] + (a.to[1] - a.from[1]) * a.t : p.y;
      ents.push({ y: fy, npc: n, nx: fx, ny: fy, walking: !!a });
    }
    const flash = game.canFlash();
    for (const p of zone.pickups || []) if (!s.picked[p.id] && (!p.hidden || flash)) ents.push({ y: p.y, pickup: p });
    ents.push({ y: py / TS, player: true });
    ents.sort((a, b) => a.y - b.y);
    const shadow = (x, y) => { g.fillStyle = 'rgba(20,10,40,0.27)'; g.fillRect(x + 3, y + 21, 10, 3); g.fillRect(x + 4, y + 20, 8, 5); };
    for (const e of ents) {
      if (e.prop) {
        const pr = game.atlas.props[e.prop], img = game.images[`prop:${e.prop}`], ty = Math.round(e.y + 0.01);
        if (pr && img) {
          // a tall prop in front of you (a palm, a tree, the bamboo) goes see-through, so you never vanish behind it
          const left = e.x * TS + 8 - pr.w / 2, top = (ty + 1) * TS - pr.h;
          const ox = Math.min(px + 13, left + pr.w) - Math.max(px + 3, left), oy = Math.min(py + 14, top + pr.h) - Math.max(py - 9, top);
          const behind = ty * TS > py && ox > 0 && oy > 0 && ox * oy > 40;
          if (behind) g.globalAlpha = 0.45;
          this.prop(game, g, e.prop, img, pr, e.x * TS - cx + 8, ty * TS - cy + 16, e.x, ty);
          if (behind) g.globalAlpha = 1;
        }
      } else if (e.player) {
        const onWater = legend[charAt(ctx, s.player.x, s.player.y, zone)]?.id === 3;
        if (onWater) this.tile(game, g, 'flamingo', px - cx, py - cy + 2); else shadow(px - cx, py - cy - 10);
        this.camPos = { x: px, y: py };
        for (const [k, tr] of (this.trail || []).entries()) {
          const age = (this.t - tr.t) * 3; if (age > 1) continue;
          g.globalAlpha = Math.max(0, 0.35 - age * 0.35) * (k + 1) / (this.trail.length + 1);
          g.fillStyle = ['#FF4FA8', '#FFE066', '#4FE88A', '#5FF4FF', '#C86BFF'][k % 5]; g.fillRect(tr.x - cx + 3, tr.y - cy + 10, 10, 4);
          this.char(game, g, s.outfit || 'player', tr.dir, k % 2, tr.x - cx, tr.y - cy - 10);
          g.globalAlpha = 1;
        }
        this.char(game, g, s.outfit || 'player', s.player.dir, this.anim ? this.walkFlip : 0, px - cx, py - cy - 10 - (onWater ? 4 : 0));
      } else if (e.npc) {
        const n = e.npc, dx = Math.round(e.nx * TS - cx), dy = Math.round(e.ny * TS - cy);
        if (n.tile) {
          this.tile(game, g, n.tile, dx, dy);
          // a Glowing Cap (or the saucer) gives off motes of green light, so it can be spotted from across the zone
          if ((n.tile === 'glowcap' || n.tile === 'ufo') && !game.settings.reducedMotion) {
            for (let i = 0; i < 4; i++) {
              const k = (this.t * 0.7 + i / 4) % 1;
              g.globalAlpha = 1 - k; g.fillStyle = i % 2 ? '#C8FFE0' : '#4FE88A';
              g.fillRect(dx + 3 + ((i * 5) % 11), Math.round(dy + 10 - k * 18), 1, 1);
            }
            g.globalAlpha = 1;
          }
        } else {
          // standing people shift their weight now and then; a few have a loop of their own
          const still = game.settings.reducedMotion, h = hashOf(n.id), fidget = !still && !e.walking && ((this.t + (h % 97) / 10) % 4.5) < 0.25;
          const nod = !still && n.sprite === 'dj' ? Math.floor(this.t * (game.data.zones[s.zoneId].baseBpm || 140) / 60) % 2 : 0;
          shadow(dx, dy - 10); this.char(game, g, n.sprite, this.npcDir[n.id] || n.dir || 'DOWN', e.walking ? Math.floor(this.t * 8) % 2 : fidget ? 1 : 0, dx, dy - 10 + nod);
          if (!still) this.trick(g, n.sprite, dx, dy - 10, this.t + (h % 13));
        }
        // a quest to pick up (!) or a step to hand in (?)
        const mark = questMarker(game.data, s, zone.zoneId, n.id);
        if (mark) drawMarker(g, mark, dx + 5, dy - 23 - (mark === '?' ? 1 : 0) + Math.round(Math.abs(Math.sin(this.t * 3.5)) * -2));
      } else this.tile(game, g, 'stash', e.pickup.x * TS - cx, e.pickup.y * TS - cy);
    }
    if (this.alert) drawText(g, '!', this.alert.x * TS - cx + 6, this.alert.y * TS - cy - 20, { color: C.red, shadow: C.white });

    // light: night tint, dark zones lit only around the player
    const lit = zone.dark && !game.canFlash();
    if (lit) {
      const grd = g.createRadialGradient(px - cx + 8, py - cy + 4, 14, px - cx + 8, py - cy + 4, 46);
      grd.addColorStop(0, 'rgba(5,2,12,0)'); grd.addColorStop(1, 'rgba(5,2,12,0.97)');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
    } else if (zone.dark) { g.fillStyle = 'rgba(40,10,90,0.25)'; g.fillRect(0, 0, W, H); }
    else if (zone.indoor !== true) daylight(g, s.clock + (s.clockSteps || 0) / (game.data.rules.stepsPerMinute || 1));
    if (this.sky) drawSky(g, this.sky, game.settings.reducedMotion);

    if (this.bannerT > 0 && this.banner) {
      const a = Math.min(1, this.bannerT * 2);
      const y = Math.round(-14 + 18 * a);
      panel(g, 4, y, Math.min(W - 8, textWidth(this.banner) + 14), 15, { bg: C.void, accent: C.magenta, border: C.ink });
      drawText(g, this.banner, 10, y + 4, { color: C.cream });
      // which way to go for the current goal, under the zone name
      if (this.hint) {
        const lines = wrap(this.hint, W - 30);
        panel(g, 4, y + 16, Math.max(...lines.map((l) => textWidth(l))) + 14, lines.length * 10 + 5, { bg: C.void, accent: C.marigold, border: C.ink });
        lines.forEach((l, i) => drawText(g, l, 10, y + 19 + i * 10, { color: C.yellow }));
      }
    }
    // which intoxication band you are in, bottom right, from the come-up on (hidden while someone talks)
    const bi = bandIndex(game.data.rules, s.intox);
    if (bi > 0 && !s.dialogue && s.mode === 'OVERWORLD') {
      const name = bandOf(game.data.rules, s.intox).name, w = textWidth(name) + 17;
      panel(g, W - w - 4, H - 17, w, 13, { bg: C.void, accent: BAND_COLORS[bi] || C.magenta, border: C.ink });
      g.fillStyle = BAND_COLORS[bi] || C.magenta; g.fillRect(W - w + 1, H - 12, 4, 4);
      drawText(g, name, W - w + 8, H - 14, { color: C.cream });
    }
    if (this.fade > 0) { g.fillStyle = `rgba(11,3,20,${this.fade})`; g.fillRect(0, 0, W, H); }
  },
};
