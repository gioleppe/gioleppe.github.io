// Overworld: tiles, characters, camera, smooth steps. Reads engine state, never decides rules.
import { W, H } from './CanvasRenderer.js';
import { drawText, textWidth, wrap, panel, C } from './ui.js';
import { charAt, npcVisible, npcPos, isNight, nightLevel, facing } from '../core/OverworldEngine.js';
import { bandOf, bandIndex, egoGone } from '../core/intox.js';
import { highWorld, TRAIL_SPRITES } from './highWorld.js';
import { liveSet } from '../core/timetable.js';
import { stageFx, shakeOf } from './stageFx.js';
const ARRIVAL = 1.8;   // seconds the camera spends on a boss before their cutscene
import { routeHint } from '../core/goals.js';
import { hashOf } from './anim.js';
import { questMarker } from '../core/quests.js';

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
// The same goes for the yurt's ring, the temple's walls and the cave's rock (1.0.50).
export const WALL_TOPS = {
  inwall: { fill: '#7A5230', grain: '#6A4426', rim: '#D8B48A', line: '#4A2C14' },
  yurt: { fill: '#D8C8A4', grain: '#C9B48A', rim: '#9A4FE0', line: '#7A3AB8' },
  temple_wall: { fill: '#9A7038', grain: '#8A6230', rim: '#F0CC78', line: '#6E4C24' },
  cave_wall: { fill: '#3A2E29', grain: '#2A211D', rim: '#6A5A50', line: '#1E1714' },
};
/** solid tiles that may stack in a column as they are: crates and containers pile up, cliffs and dunes terrace, fences and
 *  cables have an upright piece, water is water. Any other solid tile in a column must be a wall top (tests/walls). */
export const STACKS_FINE = ['container', 'crate', 'stall', 'deep', 'fence', 'wall', 'cliff', 'sand', 'dune', 'wheat', 'bush'];   // a hedge of bushes stacks fine
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

// Vehicles come in colours without extra sprites: the sprite's body shades (light, base, dark) are swapped at run time
// for a ramp built from the chosen colour, outline shades too. Each vehicle's colour comes from where it is parked.
export const VEHICLE_KEYS = { tuktuk: ['#F4D03F', '#E0B020', '#A87C10'], scooter: ['#F2705A', '#E0303C', '#A8202A'] };
export const VEHICLE_COLORS = {
  tuktuk: ['#E0B020', '#2FA84F', '#2A6FD0', '#D8402A', '#5A5A68'],
  scooter: ['#E0303C', '#2A6FD0', '#E8E8E8', '#3A3A44', '#FF4FA8', '#2FC8B0', '#F28C28'],
};
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const clampByte = (v) => Math.min(255, Math.max(0, Math.round(v)));
const outlineOf = (n) => [clampByte(n[0] * 0.42), clampByte(n[1] * 0.36), clampByte(n[2] * 0.5 + 14)];   // as render.lua's 'auto' outline
/** the colour swap for one vehicle kind and colour: [[from rgb, to rgb], ...] */
export function vehicleSwap(kind, color) {
  const keys = VEHICLE_KEYS[kind].map(hexRgb), base = hexRgb(color);
  const ramp = [mix(base, [255, 255, 255], 0.35), base, mix(base, [0, 0, 0], 0.3)];
  return [...keys.map((k, i) => [k, ramp[i]]), ...keys.map((k, i) => [outlineOf(k), outlineOf(ramp[i])])];
}
export const vehicleColor = (kind, zoneId, x, y) => { const list = VEHICLE_COLORS[kind]; let h = 7; for (const ch of `${zoneId}:${x}:${y}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return list[h % list.length]; };
const tintCache = new Map();
/** the sprite with its body recoloured (cached); falls back to the sprite as drawn where there is no canvas to paint on */
function tinted(img, pr, kind, color) {
  const key = `${kind}:${color}`;
  if (tintCache.has(key)) return tintCache.get(key);
  let out = img;
  try {
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(pr.w, pr.h) : document.createElement('canvas');
    cv.width = pr.w; cv.height = pr.h;
    const c = cv.getContext('2d');
    c.drawImage(img, 0, 0, pr.w, pr.h, 0, 0, pr.w, pr.h);
    const d = c.getImageData(0, 0, pr.w, pr.h), px = d.data, swap = vehicleSwap(kind, color);
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      const hit = swap.find(([f]) => f[0] === px[i] && f[1] === px[i + 1] && f[2] === px[i + 2]);
      if (hit) { px[i] = hit[1][0]; px[i + 1] = hit[1][1]; px[i + 2] = hit[1][2]; }
    }
    c.putImageData(d, 0, 0);
    out = cv;
  } catch { out = img; }
  tintCache.set(key, out);
  return out;
}
export const IDLE_DANCE = 4;   // seconds standing still before you start dancing

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
    else if (e.type === 'PLAYER_PLACED') this.anim = null;
    else if (e.type === 'BOSS_ARRIVAL') {
      // the music drops, the crowd turns to look, the camera slides over to the boss; then their cutscene
      this.arrival = { t: 0, x: e.x, y: e.y };
      game.audio?.duck?.(ARRIVAL);
      highWorld.crowd = { start: this.t, end: this.t + ARRIVAL };
    } else if (e.type === 'BATTLE_END' && e.boss && e.result === 'WON') { this.cheer = 3; game.audio?.sfx('cheer'); }                      // set down somewhere else (coming down off the stairs of light)
    else if (e.type === 'FX' && e.fx === 'rainbow_burst') highWorld.burst(game, e);
    else if (e.type === 'ZONE_CHANGED') { highWorld.reset(); this.anim = null; this.fade = 1; this.banner = e.name; this.bannerT = 3.2; this.npcDir = {}; this.npcAnim = {}; this.leaving = []; this.hint = routeHint(game.data, game.engine.state)?.text || null; }
    else if (e.type === 'EYE_CONTACT') { this.alert = { x: e.x, y: e.y, t: 0.8 }; }
    else if (e.type === 'NPC_FACE') this.npcDir[e.npcId] = e.dir;
    else if (e.type === 'NPC_WALK_OFF') (this.leaving ||= []).push({ id: e.npcId, sprite: e.sprite, path: e.path, t: 0 });   // beaten, they walk away
    else if (e.type === 'NPC_MOVED') { (this.npcAnim ||= {})[e.npcId] = { from: e.from, to: e.to, t: 0, dist: Math.abs(e.to[0] - e.from[0]) + Math.abs(e.to[1] - e.from[1]), walkUp: !!e.walkUp }; this.npcDir[e.npcId] = e.dir; }
  },

  update(game, dt) {
    this.t += dt;
    highWorld.update(this, game, dt);
    if (this.arrival && (this.arrival.t += dt) >= ARRIVAL) this.arrival = null;
    if (this.cheer > 0) this.cheer -= dt;
    // a set starting where you are (or you arriving during one): say what is on
    const st0 = game.engine.state, live = st0.mode === 'OVERWORLD' ? liveSet(game.data, st0) : null, key = live ? `${st0.zoneId}:${live.id}` : '';
    if (key !== this.liveKey) { if (key && this.liveKey !== undefined) game.say(`Live now: ${live.name}`); this.liveKey = key; }
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
    // someone walking off (Astra-Zero after your second fight): a tile at a walking pace, gone at the end of the path
    for (const l of this.leaving || []) l.t += dt / (STEP * 1.6);
    if (this.leaving) this.leaving = this.leaving.filter((l) => l.t < l.path.length - 1);
    for (const [id, a] of Object.entries(this.npcAnim || {})) { a.t += dt / (STEP * (a.walkUp ? 1.2 : 1.6) * Math.max(1, a.dist || 1)); if (a.t >= 1) delete this.npcAnim[id]; }
    // rainbow trails behind you when your ego is gone (not in grounded mode, not with reduced motion)
    const st = game.engine.state, trails = bandIndex(game.data.rules, st.intox) >= 3 && !game.settings.grounded && !game.settings.reducedMotion;
    if (!trails) this.trail = [];
    else if (this.anim && this.camPos) { (this.trail ||= []).push({ ...this.camPos, dir: st.player.dir, t: this.t }); if (this.trail.length > 8) this.trail.shift(); }
    const s = game.engine.state, input = game.input;
    document?.documentElement?.classList?.toggle?.('has-blotter', s.bag.glowing_blotter > 0);   // the phone's LICK button
    // how long you have stood still with nothing going on (see the idle dance in draw)
    // (not indoors: nobody starts dancing in a guesthouse, or licks the blotter out of boredom in someone's living room)
    const indoor = !!game.data.zones[s.zoneId]?.indoor;
    this.idleT = s.mode === 'OVERWORLD' && !indoor && !this.anim && !s.dialogue && !game.busy() && !input.dir() ? (this.idleT || 0) + dt : 0;
    // and if you stand there long enough, you get bored and lick the blotter (then the count starts again)
    this.boredT = this.idleT > 0 ? (this.boredT || 0) + dt : 0;
    const bored = game.data.rules.boredom?.seconds;
    if (bored && this.boredT >= bored) { this.boredT = 0; game.send({ type: 'BORED_LICK' }); }
    if (s.mode !== 'OVERWORLD' || this.anim || game.busy()) return;
    if (input.pressed('a') || input.anyTap()) return game.send({ type: 'INTERACT_TILE' });
    if (input.pressed('start')) return game.send({ type: 'TOGGLE_MENU' });
    if (input.pressed('lick') && s.bag.glowing_blotter > 0) return game.send({ type: 'USE_ITEM', itemId: 'glowing_blotter' });   // L, Y on a pad, LICK on the phone
    input.pressed('b');
    const d = input.dir();
    if (d && this.bumpT <= 0) game.send({ type: 'MOVE_STEP', direction: DIR_OF[d] });
  },

  /** a tall prop, with a little life: palms and bamboo sway, flags flutter, lamps glow, speakers pump to the beat */
  prop(game, g, name, img, pr, bx, by, tx, ty) {
    const still = game.settings.reducedMotion, t = this.t;
    const bpm = game.data.zones[game.engine.state.zoneId]?.baseBpm || 140, beat = Math.max(0, 1 - (((t * bpm) / 60) % 1) * 4);
    // Palms, trees and bamboo lean in the wind and flags flutter by swapping hand-drawn frames (frame 0 at rest, then
    // the poses): the sprite is always drawn whole and unscaled, so nothing is resampled and nothing stripes.
    // Each one keeps its own rhythm, from where it stands; a speaker hops 1 pixel on the beat.
    const frames = pr.frames || 1, rate = { palm: 0.9, tree: 0.6, bamboo: 1.1, flag: 4 }[name] || 0;
    const step = still || frames < 2 || !rate ? 0 : Math.floor(t * rate + ((tx * 7 + ty * 13) % 10) / 10 * 4) % 4;
    // at Ego gone on the Forest Stage the trees dance: a lean on every beat, a hop on each (a hallucination)
    const treeDance = !still && rate && frames >= 3 && name !== 'flag' && this.treesDance, beats = (t * bpm) / 60 + ((tx + ty) % 2) / 2;
    const frame = treeDance ? 1 + (Math.floor(beats) % 2) : frames >= 3 ? [0, 1, 0, 2][step] : frames === 2 ? step % 2 : 0;
    const x0 = Math.round(bx - pr.w / 2), y0 = Math.round(by - pr.h) - (!still && name === 'speaker' && beat > 0.5 ? 1 : 0) - (treeDance && beats % 1 < 0.3 ? 1 : 0);
    g.drawImage(img, frame * pr.w, 0, pr.w, pr.h, x0, y0, pr.w, pr.h);
    if (name === 'lamp' && !still) { g.globalAlpha = 0.18 + 0.08 * Math.sin(t * 9 + tx * 3); g.fillStyle = '#FFE066'; g.beginPath(); g.arc(bx, by - pr.h + 5, 8, 0, 7); g.fill(); g.globalAlpha = 1; }
  },
  /** a dancer bouncing to the zone's BPM on a dancefloor tile */
  /** a dancer on a dancefloor tile: one of the festival's people (assets dancers.png), changing pose on the beat
   *  (both hands up, left up, both up, right up) with a hop; each one off-beat from its neighbours */
  dancer(game, g, dx, dy, x, y, fixed = null) {
    const img = game.images.dancers, meta = game.atlas.dancers || { looks: 1, poses: 1 };
    const still = game.settings.reducedMotion, bpm = game.data.zones[game.engine.state.zoneId]?.baseBpm || 140;
    const beats = (this.t * bpm) / 60 + ((x * 3 + y * 5) % 4) / 4;
    const turned = highWorld.crowdPose(this, game, y);          // the crowd stops and stares at you (Ego gone, the Poi Pit)
    if (this.cheer > 0 && !still) {                              // a boss has fallen: arms up, jumping
      const jump = Math.round(Math.abs(Math.sin((this.t * 9) + x + y)) * 3);
      g.fillStyle = 'rgba(11,3,20,0.3)'; g.fillRect(dx + 4, dy + 13, 8, 2);
      if (img) g.drawImage(img, 0, ((x * 7 + y * 13) % meta.looks) * 24, 16, 24, dx, dy - 10 - jump, 16, 24);
      return;
    }
    const p = game.engine.state.player;
    if (game.data.zones[game.engine.state.zoneId].parting && Math.abs(x - p.x) <= 1 && Math.abs(y - p.y) <= 1 && !(x === p.x && y === p.y)) dx += x < p.x ? -5 : x > p.x ? 5 : 0;   // they make way for you
    const look = (x * 7 + y * 13) % meta.looks, pose = turned ?? fixed ?? (still ? 0 : [0, 1, 0, 2][Math.floor(beats) % 4] % meta.poses);
    const hop = turned === null && fixed === null && !still && beats % 1 < 0.3 ? 1 : 0;
    g.fillStyle = 'rgba(11,3,20,0.3)'; g.fillRect(dx + 4, dy + 13, 8, 2);
    if (img) g.drawImage(img, pose * 16, look * 24, 16, 24, dx, dy - 10 - hop, 16, 24);
  },
  /** small loops for people with something in their hands */
  trick(g, sprite, x, y, t, bpm = 140) {
    if (sprite === 'chef') { const k = ((t * bpm) / 60) % 1, up = Math.round(Math.sin(k * Math.PI) * 5); g.fillStyle = '#3A3A46'; g.fillRect(x + 10, y + 15, 5, 1); g.fillStyle = '#FFE066'; g.fillRect(x + 11, y + 13 - up, 3, 2); }
    if (sprite === 'juggler') for (let i = 0; i < 3; i++) { const a = t * 5 + i * 2.1; g.fillStyle = ['#FF4FA8', '#FFE066', '#5FF4FF'][i]; g.fillRect(Math.round(x + 7 + Math.cos(a) * 6), Math.round(y - 2 - Math.abs(Math.sin(a)) * 7), 2, 2); }
    if (sprite === 'firespinner') for (let i = 0; i < 2; i++) { const a = t * 8 + i * Math.PI; g.fillStyle = i ? '#FFD23F' : '#FF6A2A'; g.fillRect(Math.round(x + 7 + Math.cos(a) * 9), Math.round(y + 12 + Math.sin(a) * 5), 2, 2); }
  },

  /** a trainer who spotted you is still walking over, or a boss's arrival is playing: hold their dialogue till then */
  walking() { return Object.values(this.npcAnim || {}).some((a) => a.walkUp) || this.arriving(); },
  arriving() { return !!this.arrival; },

  camera(game) {
    const s = game.engine.state, zone = game.data.zones[s.zoneId];
    let px = s.player.x * TS, py = s.player.y * TS;
    if (this.anim) {
      const a = this.anim;
      px = (a.from[0] + (a.to[0] - a.from[0]) * a.t) * TS; py = (a.from[1] + (a.to[1] - a.from[1]) * a.t) * TS;
    }
    const zw = zone.rows[0].length * TS, zh = zone.rows.length * TS;
    let fx = px, fy = py;
    if (this.arrival) {
      const k = Math.min(1, this.arrival.t / 0.7), e = k * k * (3 - 2 * k);
      fx = px + (this.arrival.x * TS - px) * e; fy = py + (this.arrival.y * TS - py) * e;
    }
    const cx = zw <= W ? -Math.floor((W - zw) / 2) : Math.max(0, Math.min(zw - W, Math.round(fx + 8 - W / 2)));
    const cy = zh <= H ? -Math.floor((H - zh) / 2) : Math.max(0, Math.min(zh - H, Math.round(fy + 8 - H / 2)));
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
    const wave = game.settings.reducedMotion ? 0 : Math.floor(this.t * 2) % 2;   // water ripples (held still with reduced motion)
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
        const ego = egoGone(game.data.rules, s.intox);
        if (def.egoFloor && ego && def.under) sp = resolve(def.under);                 // the sacred cow has walked off
        if (sp === 'water' && wave) sp = 'water_b';
        if (sp === 'cordon' && zone.cordonFlag && s.flags[zone.cordonFlag]) sp = zone.ground2 || zone.ground;   // taken down once it opens
        // fences and cable runs: a north-south run gets its own upright piece, not a ladder of east-west segments
        if (VERTICAL[sp]) { const f = (fx, fy) => classOf(fx, fy) === sp; if ((f(x, y - 1) || f(x, y + 1)) && !f(x - 1, y) && !f(x + 1, y)) sp = VERTICAL[sp]; }
        const top = WALL_TOPS[sp];
        if (top && isWall(classOf(x, y + 1), sp)) wallTop(g, top, dx, dy, [classOf(x, y - 1), classOf(x + 1, y), classOf(x, y + 1), classOf(x - 1, y)].map((c) => !isWall(c, sp)));
        else if (sp !== zone.ground) this.tile(game, g, sp, dx, dy);
        if (def.light && ego) highWorld.lightStep(this, game, g, dx, dy, x, y);
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
    highWorld.ground(this, game, g, cx, cy, x0, y0, x1, y1);
    this.treesDance = highWorld.treesDance(game) || !!zone.treesPulse;   // the Forest Stage's trees pulse at 190 BPM
    stageFx(this, game, g, cx, cy, 'ground');
    // row-sorted pass: props, characters, pickups (lower rows overlap upper ones)
    const ents = highWorld.ents(this, game, g, cx, cy);
    const px0 = Math.max(0, x0 - 2), px1 = Math.min(zone.rows[0].length - 1, x1 + 2), py1 = Math.min(zone.rows.length - 1, y1 + 3);
    const taken = new Set([`${s.player.x},${s.player.y}`, ...(this.anim ? [`${this.anim.from[0]},${this.anim.from[1]}`] : [])]);
    for (const n of zone.npcs || []) if (npcVisible(ctx, n)) { const p = npcPos(ctx, n, zone); taken.add(`${p.x},${p.y}`); }
    const set = liveSet(game.data, s);
    for (let y = y0; y <= py1; y++) for (let x = px0; x <= px1; x++) {
      const def = legend[charAt(ctx, x, y, zone)];
      if (def?.prop) ents.push({ y: y - 0.01, prop: def.prop, x, span: def.propSpan || 1, tint: def.tint });
      // dancers: on every crowd tile, every few dancefloor tiles; none where you or someone else is standing
      if (def && (def.crowd || (resolve(def.sprite) === 'dancefloor' && (x * 7 + y * 3) % 5 === 0)) && !taken.has(`${x},${y}`)) ents.push({ y: y - 0.02, dancer: true, x, ty: y });
      // people who are always there (zone.crowd: the omelette queue, Chloe's fans)
      else if (def && (def.id === 0 || def.id === 2) && !taken.has(`${x},${y}`) && (zone.crowd || []).some((c) => x >= c.rect[0] && x <= c.rect[2] && y >= c.rect[1] && y <= c.rect[3] && (x * 5 + y * 3) % (c.every || 2) === 0)) {
        const c = zone.crowd.find((q) => x >= q.rect[0] && x <= q.rect[2] && y >= q.rect[1] && y <= q.rect[3]);
        ents.push({ y: y - 0.02, dancer: true, x, ty: y, pose: c.pose === 'back' ? game.atlas.dancers?.back : c.pose === 'still' ? game.atlas.dancers?.still : null });
      }
      // a set is on: the dancefloor fills up, and a crowd gathers in its spot (the festival timetable)
      else if (set && def && (def.id === 0 || def.id === 2) && !taken.has(`${x},${y}`) && ((set.fill && resolve(def.sprite) === 'dancefloor') || (set.crowd && x >= set.crowd[0] && x <= set.crowd[2] && y >= set.crowd[1] && y <= set.crowd[3] && (x * 5 + y * 3) % 3 !== 1))) {
        ents.push({ y: y - 0.02, dancer: true, x, ty: y, pose: set.pose === 'back' ? game.atlas.dancers?.back : set.pose === 'still' ? game.atlas.dancers?.still : null });
      }
    }
    for (const n of zone.npcs || []) if (npcVisible(ctx, n) && !(s.visitor && n.sprite === s.visitor)) {   // the visitor came over: not in two places
      const p = npcPos(ctx, n, zone), a = this.npcAnim?.[n.id];
      const fx = a ? a.from[0] + (a.to[0] - a.from[0]) * a.t : p.x, fy = a ? a.from[1] + (a.to[1] - a.from[1]) * a.t : p.y;
      ents.push({ y: fy, npc: n, nx: fx, ny: fy, walking: !!a });
    }
    for (const l of this.leaving || []) {
      const i = Math.min(l.path.length - 2, Math.floor(l.t)), k = l.t - i, [ax, ay] = l.path[i], [bx, by] = l.path[i + 1];
      const lx = ax + (bx - ax) * k, ly = ay + (by - ay) * k, dir = bx > ax ? 'RIGHT' : bx < ax ? 'LEFT' : by > ay ? 'DOWN' : 'UP';
      ents.push({ y: ly, draw: () => { g.fillStyle = 'rgba(20,10,40,0.27)'; g.fillRect(Math.round(lx * TS - cx) + 4, Math.round(ly * TS - cy) + 11, 8, 4); this.char(game, g, l.sprite, dir, Math.floor(l.t * 2) % 2, Math.round(lx * TS - cx), Math.round(ly * TS - cy) - 10); } });
    }
    const flash = game.canFlash();
    for (const p of zone.pickups || []) if (!s.picked[p.id] && (!p.hidden || flash) && !(p.minIntox > s.intox)) ents.push({ y: p.y, pickup: p });
    ents.push({ y: py / TS, player: true });
    // someone who came to find you (Banyan with the timetable) stands beside you while they talk
    if (s.visitor) { const vx = s.player.x + (s.player.x > 1 ? -1 : 1); ents.push({ y: s.player.y, draw: () => { g.fillStyle = 'rgba(20,10,40,0.27)'; g.fillRect(vx * TS - cx + 4, s.player.y * TS - cy + 11, 8, 4); this.char(game, g, s.visitor, vx < s.player.x ? 'RIGHT' : 'LEFT', 0, vx * TS - cx, s.player.y * TS - cy - 10); } }); }
    ents.sort((a, b) => a.y - b.y);
    const shadow = (x, y) => { g.fillStyle = 'rgba(20,10,40,0.27)'; g.fillRect(x + 3, y + 21, 10, 3); g.fillRect(x + 4, y + 20, 8, 5); };
    for (const e of ents) {
      if (e.draw) { e.draw(); continue; }
      if (e.dancer) { this.dancer(game, g, e.x * TS - cx, e.ty * TS - cy, e.x, e.ty, e.pose ?? null); continue; }
      if (e.prop) {
        const pr = game.atlas.props[e.prop], ty = Math.round(e.y + 0.01), mid = (e.span || 1) * TS / 2;   // a wide prop (a tuk-tuk) is centred on its span
        let img = game.images[`prop:${e.prop}`];
        if (img && pr && e.tint) img = tinted(img, pr, e.tint, vehicleColor(e.tint, s.zoneId, e.x, ty));
        if (pr && img) {
          // a tall prop in front of you (a palm, a tree, the bamboo) goes see-through, so you never vanish behind it
          const left = e.x * TS + mid - pr.w / 2, top = (ty + 1) * TS - pr.h;
          const ox = Math.min(px + 13, left + pr.w) - Math.max(px + 3, left), oy = Math.min(py + 14, top + pr.h) - Math.max(py - 9, top);
          const behind = ty * TS > py && ox > 0 && oy > 0 && ox * oy > 40;
          if (behind) g.globalAlpha = 0.45;
          this.prop(game, g, e.prop, img, pr, e.x * TS - cx + mid, ty * TS - cy + 16, e.x, ty);
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
        // left standing a while, you turn round and dance to the zone's beat (a step on every other beat, a hop on each)
        const dancing = !game.settings.reducedMotion && !onWater && (this.idleT || 0) > IDLE_DANCE;
        const beats = this.t * (zone.baseBpm || 140) / 60, hop = dancing && beats % 1 < 0.3 ? 1 : 0;
        this.char(game, g, s.outfit || 'player', dancing ? 'DOWN' : s.player.dir, dancing ? Math.floor(beats / 2) % 2 : this.anim ? this.walkFlip : 0, px - cx, py - cy - 10 - (onWater ? 4 : 0) - hop);
      } else if (e.npc) {
        const n = e.npc, dx = Math.round(e.nx * TS - cx), dy = Math.round(e.ny * TS - cy);
        if (n.tile) {
          this.tile(game, g, n.tile, dx + shakeOf(this, game, n.id), dy);
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
          const bpm = game.data.zones[s.zoneId].baseBpm || 140, beats = this.t * bpm / 60, turned = highWorld.crowdTurning(this);
          const dancing = n.dance && !still && !turned && !e.walking && !(this.alert && this.alert.x === e.nx && this.alert.y === e.ny);
          const hop = dancing && beats % 1 < 0.3 ? 1 : 0;
          const sprite = n.mirror ? s.outfit || 'player' : n.sprite;
          const dir = dancing ? 'DOWN' : turned && n.dance ? (e.ny < s.player.y ? 'DOWN' : 'UP') : highWorld.face(game, n.id) || this.npcDir[n.id] || facing(ctx, n);
          const step = dancing ? Math.floor(beats / 2) % 2 : e.walking ? Math.floor(this.t * 8) % 2 : fidget ? 1 : 0;
          // the performers leave trails of colour when you are Peaking
          if (TRAIL_SPRITES.has(n.sprite) && bandIndex(game.data.rules, s.intox) >= 2 && !still && !game.settings.grounded) {
            for (const k of [2, 1]) {
              const off = Math.round(Math.sin(beats * Math.PI + k) * k * 2);
              g.globalAlpha = 0.14 * k; const f = 'filter' in g ? g.filter : null;
              if (f !== null) g.filter = `hue-rotate(${k * 120}deg) saturate(1.6)`;
              this.char(game, g, sprite, dir, step, dx + off, dy - 10 + nod - hop + k);
              if (f !== null) g.filter = f;
              g.globalAlpha = 1;
            }
          }
          if (n.ghost) highWorld.ghost(this, game, g, (jx, jy) => this.char(game, g, sprite, dir, step, dx + jx, dy - 10 + jy));
          else { shadow(dx, dy - 10); this.char(game, g, sprite, dir, step, dx, dy - 10 + nod - hop); }
          if (!still && !n.ghost) this.trick(g, n.sprite, dx, dy - 10, this.t + (h % 13), bpm);
        }
        // a quest to pick up (!) or a step to hand in (?)
        const mark = questMarker(game.data, s, zone.zoneId, n.id);
        if (mark) drawMarker(g, mark, dx + 5, dy - 23 - (mark === '?' ? 1 : 0) + (game.settings.reducedMotion ? 0 : Math.round(Math.abs(Math.sin(this.t * 3.5)) * -2)));
      } else this.tile(game, g, 'stash', e.pickup.x * TS - cx, e.pickup.y * TS - cy);
    }
    highWorld.overlay(this, game, g, cx, cy);
    stageFx(this, game, g, cx, cy, 'air');
    if (this.alert) drawText(g, '!', this.alert.x * TS - cx + 6, this.alert.y * TS - cy - 20, { color: C.red, shadow: C.white });

    // strobes on the stage: on each beat one of them throws a cone of white light onto the floor, the corners taking
    // turns; with reduced motion or grounded mode they just glow, steady and dim
    const strobes = ((this.strobes ||= {})[s.zoneId] ||= zone.rows.flatMap((r, y) => [...r].flatMap((ch, x) => (legend[ch]?.prop === 'strobe' ? [[x, y]] : []))));
    if (strobes.length) {
      const calm = game.settings.reducedMotion || game.settings.grounded, beats = this.t * (zone.baseBpm || 140) / 60, n = calm ? 0 : Math.floor(beats), on = beats % 1 < 0.22;
      strobes.forEach(([x, y], i) => {
        const hx = x * TS + 8 - cx, hy = y * TS - 10 - cy, lit = calm || (on && n % strobes.length === i);
        if (!lit) return;
        const tx = (x < zone.rows[0].length / 2 ? 1 : -1) * (60 + ((n * 37 + i * 53) % 90)), ty = 90 + ((n * 23) % 40);
        g.globalAlpha = calm ? 0.07 : 0.28; g.fillStyle = calm ? '#C8A8FF' : '#F4F8FF';
        g.beginPath(); g.moveTo(hx - 3, hy); g.lineTo(hx + 3, hy); g.lineTo(hx + tx + 26, hy + ty); g.lineTo(hx + tx - 26, hy + ty); g.fill();
        g.globalAlpha = 1;
      });
    }

    // light: night tint, dark zones lit only around the player
    const lit = zone.dark && !game.canFlash();
    if (lit) {
      const grd = g.createRadialGradient(px - cx + 8, py - cy + 4, 14, px - cx + 8, py - cy + 4, 46);
      grd.addColorStop(0, 'rgba(5,2,12,0)'); grd.addColorStop(1, 'rgba(5,2,12,0.97)');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
    } else if (zone.dark) { g.fillStyle = 'rgba(40,10,90,0.25)'; g.fillRect(0, 0, W, H); }
    else if (zone.indoor !== true) daylight(g, s.clock + (s.clockSteps || 0) / (game.data.rules.stepsPerMinute || 1));
    highWorld.glow(this, game, g, cx, cy, x0, y0, x1, y1);
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
