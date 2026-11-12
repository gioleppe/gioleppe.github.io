// Move animations. Every move has a look: `fx` in data/moves.json, or a default from its category. A move plays in steps:
//   windup: while "X used Y!" types out, the user gathers itself (a status move plays its whole look here, kind 'status')
//   strike: on each hit (the MOVE_HIT event), the move travels and lands; the HP bar drops `impact` seconds in
//   marks:  what follows: stat arrows, status pictures, heal sparkles, serotonin flowing back on a drain
// Pure drawing: battleView decides when, this file decides how it looks. `o.still` is reduced motion (nothing crosses
// the screen, fewer particles); `o.calm` is reduced motion or grounded mode (no flashes, strobing or darkening).
import { W } from './CanvasRenderer.js';
import { SPOT, FX_COLORS } from './battleFx.js';

const FIELD = 132;                       // the battle field above the text box
export const WINDUP = 0.45, CHARGE = 0.25;

/**
 * motion: what the user's sprite does. 'contact' dashes into the target, 'ranged' recoils as it fires, 'gesture' hops,
 * 'ghost' leaves afterimages. impact: seconds from the strike to the hit landing. dur: length of the strike.
 * shake / flash: extra screen shake and a white flash when the hit lands. flip: the target turns upside down.
 */
export const LOOKS = {
  // the generic looks, picked by what a move does
  rush: { motion: 'contact', impact: 0.14, dur: 0.5 },
  slam: { motion: 'contact', impact: 0.2, dur: 0.55, shake: 0.3 },
  bite: { motion: 'contact', impact: 0.18, dur: 0.55 },
  orb: { motion: 'ranged', impact: 0.28, dur: 0.6 },
  beam: { motion: 'ranged', impact: 0.12, dur: 0.45 },
  spray: { motion: 'ranged', impact: 0.25, dur: 0.6 },
  cloud: { motion: 'ranged', impact: 0.3, dur: 0.8 },
  drop: { motion: 'gesture', impact: 0.28, dur: 0.65, shake: 0.25 },
  wave: { motion: 'ranged', impact: 0.26, dur: 0.6 },
  bubbles: { motion: 'ranged', impact: 0.3, dur: 0.7 },
  aura: { motion: 'gesture', impact: 0.3, dur: 0.75 },
  // signature moves
  vines: { motion: 'gesture', impact: 0.36, dur: 0.85 },
  motormouth: { motion: 'ranged', impact: 0.32, dur: 0.75 },
  tab: { motion: 'ranged', impact: 0.3, dur: 0.95 },
  shell: { motion: 'contact', impact: 0.2, dur: 0.55, shake: 0.25 },
  afterimage: { motion: 'ghost', impact: 0.2, dur: 0.7 },
  liein: { motion: 'gesture', impact: 0.3, dur: 0.9 },
  glowsticks: { motion: 'ranged', impact: 0.2, dur: 0.42 },
  howl: { motion: 'ranged', impact: 0.3, dur: 0.75 },
  sunset: { motion: 'gesture', impact: 0.45, dur: 1.2 },
  bassdrop: { motion: 'contact', impact: 0.4, dur: 1.0, shake: 0.7, flash: 0.15 },
  // the bosses' best moves
  strobe: { motion: 'contact', impact: 0.2, dur: 0.6 },
  eyebeam: { motion: 'ranged', impact: 0.14, dur: 0.55 },
  abduct: { motion: 'gesture', impact: 0.4, dur: 1.0, shake: 0.2 },
  gravity: { motion: 'ranged', impact: 0.35, dur: 0.75, flip: true, shake: 0.3 },
  spores: { motion: 'gesture', impact: 0.3, dur: 0.9 },
  siren: { motion: 'ranged', impact: 0.3, dur: 0.7 },
  trail: { motion: 'ranged', impact: 0.3, dur: 0.7 },
  lasers: { motion: 'ranged', impact: 0.18, dur: 0.6 },
  redline: { motion: 'contact', impact: 0.16, dur: 0.55, shake: 0.35 },
  melt: { motion: 'ranged', impact: 0.26, dur: 0.85 },
  void: { motion: 'ranged', impact: 0.4, dur: 0.9 },
  balloon: { motion: 'ranged', impact: 0.4, dur: 0.7, flash: 0.2, shake: 0.3 },
};
export const LOOK_NAMES = Object.keys(LOOKS);
export const SHAPES = ['weight', 'blanket', 'bomb', 'couch', 'water'];
export const DEFAULT_LOOK = { PHYSICAL: 'rush', ASTRAL: 'orb', STATUS: 'aura' };

/** a move's look: its data `fx` ("rush", or { look, shape, colors }) over the defaults */
export function lookOf(move = {}) {
  const f = typeof move.fx === 'string' ? { look: move.fx } : { ...(move.fx || {}) };
  if (!LOOKS[f.look]) f.look = DEFAULT_LOOK[move.category] || 'orb';
  return { ...LOOKS[f.look], ...f, cols: f.colors || FX_COLORS[move.type] || FX_COLORS.NORMAL, type: move.type || 'NORMAL' };
}

/** how long an effect of this kind lasts */
export function durationOf(kind, fx) {
  if (kind === 'windup') return WINDUP;
  if (kind === 'status') return CHARGE + fx.dur;
  return fx.dur;
}

/** draw one effect: { kind: 'windup'|'strike'|'status'|'mark', fx, from, to, t, dur, hit, ... } */
export function drawMoveFx(g, e, o = {}) {
  g.save();
  g.globalAlpha = 1;
  if (e.kind === 'mark') MARKS[e.mark]?.(g, e, o);
  else if (e.kind === 'windup') windup(g, e, e.t, WINDUP, o);
  else if (e.kind === 'status') { if (e.t < CHARGE) windup(g, e, e.t, CHARGE, o); else strike(g, e, e.t - CHARGE, e.dur - CHARGE, o); }
  else strike(g, e, e.t, e.dur, o);
  g.restore();
}

// ---------------------------------------------------------------- helpers
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const R = Math.round;
const lerp = (a, b, k) => a + (b - a) * k;
/** a point along an arc from a to b, lifted by `lift` at the middle */
const arc = (a, b, k, lift = 18) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) - Math.sin(k * Math.PI) * lift });
function dot(g, x, y, s, col, alpha = 1) { g.globalAlpha = clamp(alpha); g.fillStyle = col; g.fillRect(R(x - s / 2), R(y - s / 2), s, s); g.globalAlpha = 1; }
function ring(g, x, y, r, col, alpha = 1, w = 2) { if (r <= 0) return; g.globalAlpha = clamp(alpha); g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1; }
function blob(g, x, y, rx, ry, col, alpha = 1) { g.globalAlpha = clamp(alpha); g.fillStyle = col; g.beginPath(); g.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
function line(g, x0, y0, x1, y1, col, w = 1, alpha = 1) { g.globalAlpha = clamp(alpha); g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.globalAlpha = 1; }
function star(g, x, y, r, col, alpha = 1) { g.globalAlpha = clamp(alpha); g.fillStyle = col; g.beginPath(); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); g.globalAlpha = 1; }
function leaf(g, x, y, col) { g.fillStyle = col; x = R(x); y = R(y); g.fillRect(x, y - 1, 3, 1); g.fillRect(x - 1, y, 5, 1); g.fillRect(x, y + 1, 3, 1); }
function zee(g, x, y, col) { g.fillStyle = col; x = R(x); y = R(y); g.fillRect(x, y, 5, 1); g.fillRect(x + 3, y + 1, 1, 1); g.fillRect(x + 2, y + 2, 1, 1); g.fillRect(x + 1, y + 3, 1, 1); g.fillRect(x, y + 4, 5, 1); }
function sparkle(g, x, y, s, col, alpha = 1) { g.globalAlpha = clamp(alpha); g.fillStyle = col; x = R(x); y = R(y); g.fillRect(x - s, y, s * 2 + 1, 1); g.fillRect(x, y - s, 1, s * 2 + 1); g.globalAlpha = 1; }
function veil(g, col, alpha) { if (alpha <= 0) return; g.globalAlpha = clamp(alpha); g.fillStyle = col; g.fillRect(0, 0, W, FIELD); g.globalAlpha = 1; }
const env = (k) => Math.sin(clamp(k) * Math.PI);   // 0 -> 1 -> 0
const RAINBOW = ['#FF4FA8', '#FFE066', '#4FE88A', '#3FD8E8', '#C86BFF'];

/** the impact itself, flavoured by type: rings, sparks, leaves, Zs, glitch bars, grey rain, a star */
function burst(g, c, x, y, h) {
  if (h <= 0 || h >= 1) return;
  const { cols, n, t } = c;
  switch (c.type) {
    case 'PSYCHEDELIC': for (let i = 0; i < 4; i++) ring(g, x, y, 6 + h * 30 - i * 6, cols[i % cols.length], 1 - h); break;
    case 'STIMULANT': for (let i = 0; i < n; i++) { const a = (i / n) * 6.28 + t * 6; dot(g, x + Math.cos(a) * h * 26, y + Math.sin(a) * h * 26, 2, cols[i % 2]); } break;
    case 'ORGANIC': for (let i = 0; i < n; i++) { const a = (i / n) * 6.28 + 0.4; leaf(g, x + Math.cos(a) * h * 24, y + Math.sin(a) * h * 20 + h * h * 10, cols[i % cols.length]); } break;
    case 'DOWNER': blob(g, x, y - 6, 14 + h * 8, 8 + h * 4, cols[1], 0.6 * (1 - h)); for (let i = 0; i < 3; i++) zee(g, x + 10 + i * 7, y - 16 - i * 7 - h * 10, cols[2]); break;
    case 'DISSOCIATIVE': for (let i = 0; i < n + 2; i++) { const jx = ((i * 37 + R(h * 30) * 11) % 50) - 25, jy = ((i * 23 + R(h * 30) * 7) % 40) - 20; g.globalAlpha = 0.8 * (1 - h); g.fillStyle = cols[i % cols.length]; g.fillRect(R(x + jx), R(y + jy), 6 + (i % 3) * 3, 2); } g.globalAlpha = 1; break;
    case 'BUMMER': blob(g, x, y - 30, 20, 7, cols[1], 1 - h); for (let i = 0; i < n; i++) dot(g, x - 16 + i * 5, y - 24 + ((i * 9 + h * 40) % 30), 1, cols[2]); break;
    default: star(g, x, y, 6 + h * 14, cols[0], 1 - h * 0.6); star(g, x + 8, y - 6, 3 + h * 6, cols[2] || cols[0], 1 - h);
  }
}
/** a white impact star with lines flying out: every hit gets one */
function impact(g, x, y, h, col = '#FFFFFF') {
  if (h <= 0 || h >= 0.6) return;
  const k = h / 0.6;
  star(g, x, y, 4 + k * 10, col, 1 - k);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28 + 0.3; line(g, x + Math.cos(a) * (6 + k * 10), y + Math.sin(a) * (6 + k * 10), x + Math.cos(a) * (10 + k * 16), y + Math.sin(a) * (10 + k * 16), col, 1, 1 - k); }
}
function dust(g, x, y, h, col = '#E8D8B8') { if (h <= 0 || h >= 1) return; g.globalAlpha = 0.7 * (1 - h); g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y, 8 + h * 30, 3 + h * 6, 0, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1; }

// ---------------------------------------------------------------- windup
function windup(g, e, t, dur, o) {
  const f = e.fx, a = SPOT[e.from], k = clamp(t / dur), cols = f.cols, n = o.still ? 3 : 8;
  const dir = e.from === 'p' ? 1 : -1;
  if (f.look === 'eyebeam') return eye(g, a, k);
  const b = SPOT[e.to];
  if (f.look === 'abduct') { saucer(g, b.x, lerp(-12, b.y - 46, k), o.still ? 0 : t, k); return; }   // a saucer glides in over the target
  if (f.look === 'sunset') {   // the sky warms and the sun comes down towards the target
    veil(g, '#FF8A3D', (o.calm ? 0.06 : 0.18) * k);
    const sy = lerp(-14, b.y - 44, k);
    blob(g, b.x, sy, 13, 13, '#FF8A3D', k); blob(g, b.x, sy - 1, 11, 11, '#FFD23F', k);
    return;
  }
  if (f.look === 'bassdrop') {   // the lights go down and a speaker cone rises out of the ground
    veil(g, '#0A0612', (o.calm ? 0.08 : 0.35) * k);
    for (let i = 0; i < 3; i++) blob(g, b.x, b.y + 26, (18 - i * 6) * k, (5 - i * 1.5) * k, ['#2A2A3A', '#5A5F6A', '#14101E'][i]);
    return;
  }
  if (f.look === 'motormouth') return megaphone(g, a, dir, k);
  if (f.motion === 'contact') {
    // dust kicked up behind the feet as it gets ready to charge
    for (let i = 0; i < 3; i++) blob(g, a.x - dir * (14 + i * 6 + k * 6), a.y + 26 - i * 2 - k * 4, 3 + k * 3, 2 + k * 2, '#E8D8B8', 0.6 * (1 - k));
  } else if (f.motion === 'ranged') {
    // energy gathering on the user
    for (let i = 0; i < n; i++) { const ang = (i / n) * 6.28 + (o.still ? 0 : t * 5), r = 30 * (1 - k) + 4; dot(g, a.x + Math.cos(ang) * r, a.y - 4 + Math.sin(ang) * r, 2, cols[i % cols.length], 0.4 + k * 0.6); }
  } else {
    ring(g, a.x, a.y, 6 + k * 22, cols[0], 1 - k);
    for (let i = 0; i < 3; i++) sparkle(g, a.x - 16 + i * 16, a.y - 20 - k * 8, 2, cols[(i + 1) % cols.length], 1 - k);
  }
}
function eye(g, at, k) {
  const x = at.x, y = at.y - 30, open = clamp(k * 1.4);
  blob(g, x, y, 11, 1 + open * 6, '#FAFAF2');
  blob(g, x, y, 4, Math.min(4, 0.5 + open * 4), '#C86BFF');
  blob(g, x, y, 1.6, Math.min(1.6, open * 2), '#14101E');
  g.strokeStyle = '#2A1A2E'; g.lineWidth = 1; g.beginPath(); g.ellipse(x, y, 11, 1 + open * 6, 0, 0, Math.PI * 2); g.stroke();
}
function megaphone(g, at, dir, k) {
  // it slides out of the user and opens up
  const x = at.x + dir * (10 + clamp(k * 1.5) * 12), y = at.y - 8, len = 4 + clamp(k * 1.5) * 10, mouth = 3 + clamp(k * 1.5) * 6;
  g.globalAlpha = clamp(k * 3); g.fillStyle = '#FFE066';
  g.beginPath(); g.moveTo(x, y - 3); g.lineTo(x + dir * len, y - mouth); g.lineTo(x + dir * len, y + mouth); g.lineTo(x, y + 3); g.fill();
  g.fillStyle = '#C8A030'; g.fillRect(R(x + dir * len - (dir > 0 ? 0 : 2)), R(y - mouth), 2, R(mouth * 2));
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------- strike
function strike(g, e, t, dur, o) {
  const f = e.fx, a = SPOT[e.from], b = SPOT[e.to];
  const imp = Math.min(f.impact, dur * 0.8);
  const c = { a, b, t, dur, imp, tr: clamp(t / imp), h: t < imp ? 0 : clamp((t - imp) / Math.max(0.01, dur - imp)), k: clamp(t / dur), cols: f.cols, type: f.type, f, hit: e.hit || 1, still: !!o.still, calm: !!o.calm, n: o.still ? 3 : 8, dir: e.from === 'p' ? 1 : -1 };
  (STRIKES[f.look] || STRIKES.orb)(g, c);
}

const STRIKES = {
  rush(g, c) {
    const { b, tr, h } = c;
    // a swipe across the target as the user arrives (also shown when reduced motion keeps the sprite still)
    if (tr < 1) { g.globalAlpha = 0.8; g.strokeStyle = c.cols[0]; g.lineWidth = 2; g.beginPath(); g.arc(b.x, b.y, 18, -2.2 + (c.hit % 2) * 0.6, -2.2 + tr * 2.4 + (c.hit % 2) * 0.6); g.stroke(); g.globalAlpha = 1; }
    impact(g, b.x, b.y, h); burst(g, c, b.x, b.y, h);
  },
  slam(g, c) {
    const { b, tr, h } = c;
    if (tr < 1) line(g, b.x, b.y - 40 + tr * 30, b.x, b.y - 30 + tr * 34, '#FFFFFF', 3, 0.8);
    dust(g, b.x, b.y + 24, h); impact(g, b.x, b.y + 6, h); burst(g, c, b.x, b.y, h);
  },
  bite(g, c) {
    const { b, tr, h } = c;
    const gap = 22 * (1 - tr), fade = 1 - clamp((h - 0.4) / 0.6);
    g.globalAlpha = fade; g.fillStyle = '#FAFAF2';
    for (let i = 0; i < 4; i++) {
      const x = b.x - 14 + i * 8;
      g.beginPath(); g.moveTo(x, b.y - 4 - gap); g.lineTo(x + 7, b.y - 4 - gap); g.lineTo(x + 3.5, b.y + 3 - gap); g.fill();
      g.beginPath(); g.moveTo(x, b.y + 10 + gap); g.lineTo(x + 7, b.y + 10 + gap); g.lineTo(x + 3.5, b.y + 3 + gap); g.fill();
    }
    g.globalAlpha = 1;
    impact(g, b.x, b.y + 3, h); burst(g, c, b.x, b.y, h);
  },
  orb(g, c) {
    const { a, b, tr, h, cols } = c;
    if (tr < 1) {
      for (let i = 3; i >= 0; i--) { const p = arc(a, b, clamp(tr - i * 0.07)); blob(g, p.x, p.y, 5 - i, 5 - i, cols[i % cols.length], 1 - i * 0.22); }
      const p = arc(a, b, tr); blob(g, p.x, p.y, 2, 2, '#FFFFFF');
    }
    impact(g, b.x, b.y, h, cols[0]); burst(g, c, b.x, b.y, h);
  },
  beam(g, c) {
    const { a, b, t, tr, h, cols } = c;
    beamLine(g, { x: a.x + c.dir * 10, y: a.y - 6 }, b, tr, h, cols, t, c.f.thin ? 1 : 3, c.calm);
    burst(g, c, b.x, b.y, h);
  },
  spray(g, c) {
    const { a, b, t, imp, h, cols } = c, m = c.still ? 6 : 16;
    for (let i = 0; i < m; i++) {
      const p = clamp((t - (i / m) * imp * 1.3) / 0.22);
      if (p <= 0 || p >= 1) continue;
      const spread = Math.sin(i * 1.7) * 10 * p;
      dot(g, lerp(a.x, b.x, p), lerp(a.y, b.y, p) + spread - Math.sin(p * Math.PI) * 8, 2 + (i % 2), cols[i % cols.length]);
    }
    burst(g, c, b.x, b.y, h);
  },
  cloud(g, c) {
    const { a, b, tr, h, cols } = c;
    const cx = lerp(a.x, b.x, tr), cy = lerp(a.y, b.y, tr) - Math.sin(tr * Math.PI) * 10;
    for (let i = 0; i < 5; i++) {
      const ang = i * 1.26 + c.t * (c.still ? 0 : 2), r = 6 + h * 14;
      blob(g, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * 0.6, 7 + h * 6, 5 + h * 4, cols[i % cols.length], 0.75 * (1 - h * 0.8));
    }
    if (h > 0) burst(g, c, b.x, b.y, h);
  },
  drop(g, c) {
    const { b, tr, h, cols } = c, shape = c.f.shape;
    const slow = shape === 'blanket' ? 0.7 : 1;
    const y = lerp(-24, b.y - (shape === 'blanket' ? 10 : 4), Math.pow(tr, 2 * slow));
    const fade = shape === 'blanket' ? 1 - clamp((h - 0.5) / 0.5) : tr < 1 ? 1 : 0;
    g.globalAlpha = fade;
    if (shape === 'weight') { g.fillStyle = '#3A3A4A'; g.beginPath(); g.moveTo(b.x - 18, y + 10); g.lineTo(b.x + 18, y + 10); g.lineTo(b.x + 12, y - 8); g.lineTo(b.x - 12, y - 8); g.fill(); g.fillStyle = '#5A5F6A'; g.fillRect(R(b.x - 5), R(y - 13), 10, 5); g.fillStyle = '#C8D0FF'; g.fillRect(R(b.x - 6), R(y - 1), 12, 2); }
    else if (shape === 'blanket') { g.fillStyle = cols[0]; g.fillRect(R(b.x - 24), R(y - 8), 48, 18); g.fillStyle = cols[2] || '#FFFFFF'; for (let i = 0; i < 4; i++) g.fillRect(R(b.x - 22 + i * 12), R(y - 8), 4, 18); }
    else if (shape === 'bomb') { blob(g, b.x, y, 8, 8, '#6E4C24', fade); g.globalAlpha = fade; line(g, b.x + 4, y - 7, b.x + 8, y - 12, '#C8A030', 1, fade); dot(g, b.x + 9, y - 13, 2, (R(c.t * 20) % 2) ? '#FFE066' : '#FF4FA8', fade); }
    else if (shape === 'couch') { g.fillStyle = '#8A3A5A'; g.fillRect(R(b.x - 20), R(y - 4), 40, 12); g.fillRect(R(b.x - 22), R(y - 8), 5, 16); g.fillRect(R(b.x + 17), R(y - 8), 5, 16); g.fillStyle = '#B85A7A'; g.fillRect(R(b.x - 16), R(y - 8), 15, 5); g.fillRect(R(b.x + 1), R(y - 8), 15, 5); }
    else if (shape === 'water') { blob(g, b.x, y, 4, 5, '#7FD6FF', fade); g.globalAlpha = fade; g.fillStyle = '#7FD6FF'; g.beginPath(); g.moveTo(b.x - 4, y - 1); g.lineTo(b.x, y - 9); g.lineTo(b.x + 4, y - 1); g.fill(); }
    else blob(g, b.x, y, 7, 7, cols[0], fade);
    g.globalAlpha = 1;
    if (shape === 'water') { for (let i = 0; i < 6; i++) { const ang = Math.PI + (i / 5) * Math.PI; dot(g, b.x + Math.cos(ang) * h * 16, b.y - 4 + Math.sin(ang) * h * 12 + h * h * 10, 2, '#C8F0FF', 1 - h); } return; }
    if (shape === 'blanket') { for (let i = 0; i < 3; i++) zee(g, b.x + 14 + i * 7, b.y - 24 - i * 7 - h * 10, '#C8D0FF'); return; }
    dust(g, b.x, b.y + 24, h); impact(g, b.x, b.y, h); burst(g, c, b.x, b.y, h);
  },
  wave(g, c) {
    const { a, b, t, imp, h, cols } = c;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    for (let i = 0; i < 3; i++) {
      const p = clamp((t - i * imp * 0.3) / imp);
      if (p <= 0 || p >= 1) continue;
      g.globalAlpha = 1 - p * 0.3; g.strokeStyle = cols[i % cols.length]; g.lineWidth = 2;
      g.beginPath(); g.arc(lerp(a.x, b.x, p), lerp(a.y, b.y, p), 8 + i * 3, ang - 0.9, ang + 0.9); g.stroke();
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 3; i++) ring(g, b.x, b.y, 4 + h * 28 - i * 7, cols[i % cols.length], 1 - h);
    if (c.type !== 'PSYCHEDELIC') burst(g, c, b.x, b.y, h);
  },
  bubbles(g, c) {
    const { a, b, t, imp, h, cols } = c, m = c.still ? 3 : 6;
    for (let i = 0; i < m; i++) {
      const p = clamp((t - (i / m) * imp) / (imp * 0.9));
      if (p <= 0) continue;
      const q = arc(a, b, p, 14 + (i % 3) * 6);
      if (p >= 1) { if (h < 0.5) ring(g, b.x - 10 + (i % 3) * 10, b.y - 14 + (i % 2) * 8, 4 + h * 10, '#FFFFFF', 1 - h * 2, 1); continue; }
      bubble(g, q.x, q.y, cols[i % cols.length]);
    }
    burst(g, c, b.x, b.y, h);
  },
  aura(g, c) {
    const { b, t, k, cols, n } = c;
    // particles orbit and rise around whoever it lands on, then the type's own flourish
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * 6.28 + (c.still ? 0 : t * 4), r = 24 - k * 6;
      const y = b.y + Math.sin(ang) * r * 0.45 - k * 14;
      dot(g, b.x + Math.cos(ang) * r, y, 2, cols[i % cols.length], 1 - k * 0.6);
    }
    burst(g, c, b.x, b.y, k);
  },

  // ---- signature moves
  vines(g, c) {
    const { b, tr, h } = c, squeeze = h > 0 ? Math.min(1, h * 3) : 0, fade = 1 - clamp((h - 0.7) / 0.3);
    for (let i = 0; i < 4; i++) {
      const bx = b.x - 18 + i * 12, len = 44 * tr, segs = 8;
      g.globalAlpha = fade; g.strokeStyle = i % 2 ? '#3E9A4E' : '#4FE88A'; g.lineWidth = 2; g.beginPath();
      let tip = { x: bx, y: b.y + 24 };
      for (let j = 0; j <= segs; j++) {
        const p = j / segs, sway = Math.sin(j * 0.8 + i * 1.3) * 8 * (1 - squeeze * 0.7);
        const x = lerp(bx, b.x, squeeze * p * 0.6) + sway, y = b.y + 24 - len * p;
        if (j === 0) g.moveTo(x, y); else g.lineTo(x, y);
        tip = { x, y };
      }
      g.stroke(); g.globalAlpha = 1;
      if (tr > 0.3) leaf(g, tip.x, tip.y, '#B8F4A0');
    }
    if (h > 0 && h < 0.5) for (let i = 0; i < 4; i++) sparkle(g, b.x - 12 + i * 8, b.y - 4 + (i % 2) * 6, 2, '#FF8FB8', 1 - h * 2);
  },
  motormouth(g, c) {
    const { a, b, t, imp, h } = c, m = c.still ? 5 : 12;
    megaphone(g, a, c.dir, 1 - h);
    for (let i = 0; i < m; i++) {
      const p = clamp((t - (i / m) * imp * 1.6) / (imp * 0.8));
      if (p <= 0) continue;
      const x = p >= 1 ? b.x - 14 + (i % 4) * 8 : lerp(a.x + c.dir * 36, b.x, p), y = p >= 1 ? b.y - 22 + Math.floor(i / 4) * 6 : lerp(a.y - 8, b.y, p) + Math.sin(i * 2.3) * 8 * p;
      squiggle(g, x, y, RAINBOW[i % RAINBOW.length], p >= 1 ? 1 - h : 1);
    }
    burst(g, { ...c, type: 'STIMULANT' }, b.x, b.y, h);
  },
  tab(g, c) {
    const { a, b, tr, h } = c, top = { x: b.x, y: b.y - 22 };
    if (h <= 0) { const p = arc(a, top, tr, 26); paperTab(g, p.x, p.y, 1); return; }
    // the tab dissolves: its sixteen squares drift apart and fall in rainbow colours
    for (let i = 0; i < 16; i++) {
      const gx = (i % 4) - 1.5, gy = Math.floor(i / 4) - 1.5;
      dot(g, top.x + gx * (2 + h * 14), top.y + gy * (2 + h * 8) + h * h * 26, 2, RAINBOW[i % RAINBOW.length], 1 - h);
    }
    for (let i = 0; i < 3; i++) ring(g, b.x, b.y, 4 + h * 34 - i * 8, RAINBOW[i], (1 - h) * 0.8);
  },
  shell(g, c) {
    const { a, b, t, tr, h } = c;
    if (tr < 1) { const x = lerp(a.x, b.x, tr), y = lerp(a.y, b.y, tr); spiral(g, x, y, 9, c.still ? 0 : t * 30, '#E8C39E', '#C8382A'); }
    if (h > 0 && h < 0.6) for (let i = 0; i < 5; i++) { const ang = i * 1.25 + 0.2; let x = b.x, y = b.y; g.strokeStyle = '#FFFFFF'; g.globalAlpha = 1 - h / 0.6; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); for (let j = 1; j <= 3; j++) { x = b.x + Math.cos(ang + (j % 2) * 0.3) * j * 7; y = b.y + Math.sin(ang + (j % 2) * 0.3) * j * 7; g.lineTo(x, y); } g.stroke(); g.globalAlpha = 1; }
    impact(g, b.x, b.y, h); burst(g, c, b.x, b.y, h);
  },
  afterimage(g, c) {
    const { b, k, cols } = c;
    for (let i = 0; i < 5; i++) { const y = b.y - 18 + i * 9, len = 10 + (i % 2) * 8; line(g, b.x - 34 - k * 10, y, b.x - 34 - k * 10 + len, y, cols[i % cols.length], 1, 1 - k); line(g, b.x + 34 + k * 10, y, b.x + 34 + k * 10 - len, y, cols[(i + 1) % cols.length], 1, 1 - k); }
  },
  liein(g, c) {
    STRIKES.drop(g, { ...c, f: { ...c.f, shape: 'blanket' }, cols: ['#7C8CD9', '#2A2A4A', '#C8D0FF'] });
  },
  glowsticks(g, c) {
    const { a, b, t, tr, h } = c;
    const tint = ['#4FE88A', '#FF4FA8', '#3FD8E8', '#FFE066'];
    if (tr < 1) for (let i = 0; i < 2; i++) {
      const p = arc(a, b, tr, 16 + i * 10), ang = (c.still ? 0.6 : t * 22) + i * Math.PI / 2, col = tint[(c.hit + i) % tint.length];
      const dx = Math.cos(ang) * 7, dy = Math.sin(ang) * 7;
      line(g, p.x - dx, p.y - dy, p.x + dx, p.y + dy, col, 4, 0.35);
      line(g, p.x - dx, p.y - dy, p.x + dx, p.y + dy, col, 2);
    }
    if (h > 0) for (let i = 0; i < c.n; i++) { const ang = (i / c.n) * 6.28 + c.hit; dot(g, b.x + Math.cos(ang) * h * 22, b.y + Math.sin(ang) * h * 22, 2, tint[i % tint.length], 1 - h); }
  },
  howl(g, c) {
    const { a, b, t, imp, h } = c, cols = ['#C86BFF', '#3FD8E8', '#FFE066'];
    const ang = Math.atan2(b.y - a.y, b.x - a.x), nx = -Math.sin(ang), ny = Math.cos(ang);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const p = clamp((t - i * imp * 0.25) / imp);
      if (p <= 0 || p >= 1) continue;
      const off = (j - 1) * 16 * (1 - p);
      g.globalAlpha = 1 - p * 0.3; g.strokeStyle = cols[j]; g.lineWidth = 2;
      g.beginPath(); g.arc(lerp(a.x, b.x, p) + nx * off, lerp(a.y, b.y, p) + ny * off, 6 + i * 3, ang - 0.8, ang + 0.8); g.stroke();
    }
    g.globalAlpha = 1;
    for (let j = 0; j < 3; j++) ring(g, b.x, b.y, 6 + h * 30 - j * 6, cols[j], 1 - h);
  },
  sunset(g, c) {
    const { b, k, h, t } = c;
    veil(g, '#FF8A3D', (c.calm ? 0.06 : 0.22) * (1 - h * 0.7));
    const sx = b.x, sy = b.y - 44 + k * 22;
    for (let i = 0; i < 8; i++) { const ang = (i / 8) * 6.28 + (c.still ? 0 : t * 1.5); line(g, sx + Math.cos(ang) * 16, sy + Math.sin(ang) * 16, sx + Math.cos(ang) * 26, sy + Math.sin(ang) * 26, '#FFE066', 2, 0.8 * (1 - h)); }
    blob(g, sx, sy, 13, 13, '#FF8A3D', 1 - h * 0.5); blob(g, sx, sy - 1, 11, 11, '#FFD23F', 1 - h * 0.5);
    if (h > 0) for (let i = 0; i < 10; i++) { const ang = (i / 10) * 6.28; sparkle(g, b.x + Math.cos(ang) * (8 + h * 24), b.y + Math.sin(ang) * (6 + h * 16), 2, i % 2 ? '#FFE066' : '#FFFFFF', 1 - h); }
  },
  bassdrop(g, c) {
    const { b, t, tr, h } = c;
    veil(g, '#0A0612', (c.calm ? 0.08 : 0.35) * (1 - h));
    const pump = c.still ? 0 : Math.abs(Math.sin(t * 18)) * 3;
    for (let i = 0; i < 3; i++) blob(g, b.x, b.y + 26, 18 - i * 6 + pump, 5 - i * 1.5 + pump * 0.3, ['#2A2A3A', '#5A5F6A', '#14101E'][i], tr);
    if (h > 0) for (let i = 0; i < 4; i++) { const r = clamp(h * 1.3 - i * 0.15); if (r > 0 && r < 1) { g.globalAlpha = 1 - r; g.strokeStyle = i % 2 ? '#7C8CD9' : '#C8D0FF'; g.lineWidth = 3; g.beginPath(); g.ellipse(b.x, b.y + 26, 10 + r * 130, 3 + r * 22, 0, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1; } }
    if (h > 0) for (let i = 0; i < c.n; i++) dot(g, b.x - 30 + i * 9, b.y + 22 - Math.sin(clamp(h * 2) * Math.PI) * (8 + (i % 3) * 6), 2, '#8E939C');
  },
  strobe(g, c) {
    const { b, t, h, k } = c;
    if (!c.calm && k < 0.8 && Math.floor(t * 16) % 2 === 0) { veil(g, RAINBOW[Math.floor(t * 16) % RAINBOW.length], 0.22); for (let i = 0; i < 5; i++) { g.globalAlpha = 0.3; g.fillStyle = '#FFFFFF'; g.fillRect(i * 70 + (Math.floor(t * 16) % 3) * 12, 0, 6, FIELD); } g.globalAlpha = 1; }
    if (c.calm) for (let i = 0; i < 3; i++) ring(g, b.x, b.y, 10 + i * 8, RAINBOW[i], 0.6 * (1 - k));
    impact(g, b.x, b.y, h); burst(g, c, b.x, b.y, h);
  },
  abduct(g, c) {
    // the saucer hangs over the target, a green beam comes down, and the target floats up in it, then drops
    const { b, t, tr, h, k } = c, sy = b.y - 46;
    veil(g, '#0A1A12', (c.calm ? 0.06 : 0.22) * (1 - h));
    const open = clamp(tr * 1.6), w = 10 + open * 16;
    g.globalAlpha = 0.45 * (1 - h); g.fillStyle = '#9AFFC8';
    g.beginPath(); g.moveTo(b.x - 8, sy + 4); g.lineTo(b.x + 8, sy + 4); g.lineTo(b.x + w, b.y + 26); g.lineTo(b.x - w, b.y + 26); g.fill(); g.globalAlpha = 1;
    for (let i = 0; i < c.n; i++) { const p = ((c.still ? 0.5 : t * 1.4) + i / c.n) % 1; sparkle(g, b.x - w * 0.6 + ((i * 37) % 10) / 10 * w * 1.2, lerp(b.y + 24, sy + 6, p), 1, i % 2 ? '#C8FFE0' : '#FFFFFF', 1 - h); }
    saucer(g, b.x, sy, c.still ? 0 : t, 1 - clamp((h - 0.6) / 0.4));
    if (h > 0) for (let i = 0; i < 3; i++) ring(g, b.x, b.y, 6 + h * 26 - i * 6, ['#4FE88A', '#C8FFE0', '#5FF4FF'][i], 1 - h);
    if (k > 0.98) burst(g, c, b.x, b.y, h);
  },
  eyebeam(g, c) {
    const { a, b, t, tr, h } = c, from = { x: a.x, y: a.y - 30 };
    eye(g, a, 1 - clamp((h - 0.6) / 0.4));
    beamLine(g, from, b, tr, h, RAINBOW, t, 4, c.calm);
    burst(g, c, b.x, b.y, h);
  },
  gravity(g, c) {
    const { b, t, tr, h, cols } = c;
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * 6.28 + (c.still ? 0 : t * 3), x = b.x + Math.cos(ang) * 26, y = b.y + Math.sin(ang) * 14 - tr * 10 + h * 18;
      g.globalAlpha = 1 - h; g.strokeStyle = cols[i % cols.length]; g.lineWidth = 1; g.beginPath(); g.moveTo(x - 3, y + 2); g.lineTo(x, y - 2); g.lineTo(x + 3, y + 2); g.stroke(); g.globalAlpha = 1;
    }
    dust(g, b.x, b.y + 24, h); burst(g, c, b.x, b.y, h);
  },
  spores(g, c) {
    const { b, t, k, cols } = c, m = c.still ? 6 : 14;
    blob(g, b.x, b.y - 38, 10, 6, '#B5502C', 1 - k * 0.5); blob(g, b.x - 4, b.y - 40, 2, 2, '#E6906A', 1 - k * 0.5); blob(g, b.x + 5, b.y - 37, 2, 1.5, '#E6906A', 1 - k * 0.5);
    for (let i = 0; i < m; i++) { const p = clamp(k * 1.5 - (i / m) * 0.5); if (p <= 0 || p >= 1) continue; dot(g, b.x - 14 + (i * 7) % 28 + Math.sin(t * 4 + i) * (c.still ? 0 : 3), b.y - 34 + p * 40, 2, cols[i % cols.length], 1 - p * 0.5); }
    if (k > 0.6) for (let i = 0; i < 2; i++) zee(g, b.x + 14 + i * 7, b.y - 22 - i * 7 - (k - 0.6) * 20, '#C8D0FF');
  },
  siren(g, c) {
    const { a, b, t, imp, h } = c, red = '#E0303C', blue = '#2A6AE8';
    const swap = c.calm ? 0 : Math.floor(t * 12) % 2;
    for (let i = 0; i < 4; i++) {
      const p = clamp((t - i * imp * 0.22) / imp);
      if (p <= 0 || p >= 1) continue;
      ring(g, lerp(a.x, b.x, p), lerp(a.y, b.y, p), 6 + i * 2, (i + swap) % 2 ? red : blue, 1 - p * 0.4);
    }
    for (let i = 0; i < 3; i++) ring(g, b.x, b.y, 4 + h * 32 - i * 8, (i + swap) % 2 ? red : blue, 1 - h);
  },
  trail(g, c) {
    const { a, b, tr, h } = c, steps = 14, fade = 1 - h;
    for (let band = 0; band < RAINBOW.length; band++) {
      g.globalAlpha = fade; g.strokeStyle = RAINBOW[band]; g.lineWidth = 2; g.beginPath();
      for (let i = 0; i <= steps; i++) { const p = arc(a, b, (i / steps) * tr, 34); if (i === 0) g.moveTo(p.x, p.y - 4 + band * 2); else g.lineTo(p.x, p.y - 4 + band * 2); }
      g.stroke();
    }
    g.globalAlpha = 1;
    burst(g, c, b.x, b.y, h);
  },
  lasers(g, c) {
    const { a, b, t, tr, h } = c, from = { x: a.x + c.dir * 8, y: a.y - 10 };
    for (let i = 0; i < 5; i++) {
      if (!c.calm && (Math.floor(t * 20) + i) % 3 === 0) continue;
      const jx = c.still ? (i - 2) * 6 : Math.sin(i * 2.1 + t * 6) * 16, jy = c.still ? (i % 2) * 6 - 3 : Math.cos(i * 1.3 + t * 5) * 10;
      const to = { x: lerp(from.x, b.x + jx, tr), y: lerp(from.y, b.y + jy, tr) };
      line(g, from.x, from.y, to.x, to.y, RAINBOW[i], 1, 1 - h);
      if (tr >= 1) dot(g, to.x, to.y, 3, '#FFFFFF', 1 - h);
    }
    burst(g, { ...c, type: 'STIMULANT' }, b.x, b.y, h);
  },
  redline(g, c) {
    const { a, b, tr, h } = c;
    if (tr < 1) for (let i = 0; i < 6; i++) { const p = clamp(tr - i * 0.08), x = lerp(a.x, b.x, p), y = lerp(a.y, b.y, p) - 14 + i * 6; line(g, x - c.dir * 18, y, x - c.dir * 4, y, i % 2 ? '#FF3040' : '#FFB23F', 2, 0.9); }
    impact(g, b.x, b.y, h, '#FFB23F'); if (h > 0) star(g, b.x, b.y, 8 + h * 16, '#FF3040', 0.8 * (1 - h)); burst(g, c, b.x, b.y, h);
  },
  melt(g, c) {
    STRIKES.orb(g, c);
    const { b, h } = c;
    if (h > 0) for (let i = 0; i < 6; i++) { const x = b.x - 15 + i * 6, len = h * (12 + (i % 3) * 8), col = RAINBOW[i % RAINBOW.length]; line(g, x, b.y - 18 + (i % 2) * 4, x, b.y - 18 + (i % 2) * 4 + len, col, 2, 1 - h * 0.5); blob(g, x, b.y - 18 + (i % 2) * 4 + len, 1.6, 2, col, 1 - h * 0.5); }
  },
  void(g, c) {
    const { b, k, h } = c, r = lerp(150, 26, clamp(k * 1.6));
    g.globalAlpha = (c.calm ? 0.25 : 0.6) * (1 - h);
    g.fillStyle = '#0A0612'; g.beginPath(); g.rect(0, 0, W, FIELD); g.arc(b.x, b.y, r, 0, Math.PI * 2, true); g.fill('evenodd');
    g.globalAlpha = 1;
    sparkle(g, b.x + 20, b.y - 26, 1, '#FFFFFF', 1 - h);
    burst(g, { ...c, type: 'BUMMER' }, b.x, b.y, h);
  },
  balloon(g, c) {
    const { b, tr, h, cols } = c;
    if (h <= 0) {
      const r = 3 + tr * 15;
      line(g, b.x, b.y - 12 + r, b.x + 2, b.y + 14, '#FFFFFF', 1);
      blob(g, b.x, b.y - 12, r, r * 1.15, cols[0]); blob(g, b.x - r * 0.35, b.y - 12 - r * 0.4, r * 0.2, r * 0.25, '#FFFFFF', 0.8);
      return;
    }
    for (let i = 0; i < 8; i++) { const ang = (i / 8) * 6.28; line(g, b.x + Math.cos(ang) * (6 + h * 10), b.y - 12 + Math.sin(ang) * (6 + h * 10), b.x + Math.cos(ang) * (12 + h * 22), b.y - 12 + Math.sin(ang) * (12 + h * 22), '#FFFFFF', 2, 1 - h); }
    for (let i = 0; i < 10; i++) { const ang = i * 0.63; dot(g, b.x + Math.cos(ang) * h * 34, b.y - 12 + Math.sin(ang) * h * 24 + h * h * 20, 2, RAINBOW[i % RAINBOW.length], 1 - h); }
  },
};

function beamLine(g, from, to, tr, h, cols, t, w, calm) {
  if (h >= 1) return;
  const x = lerp(from.x, to.x, tr), y = lerp(from.y, to.y, tr);
  const col = cols[(calm ? 0 : Math.floor(t * 20)) % cols.length];
  line(g, from.x, from.y, x, y, col, w + 2 + (calm ? 0 : Math.sin(t * 40)), 0.35 * (1 - h));
  line(g, from.x, from.y, x, y, col, w, 1 - h);
  line(g, from.x, from.y, x, y, '#FFFFFF', 1, 1 - h);
  if (tr >= 1) blob(g, to.x, to.y, 4 + w, 4 + w, col, 0.8 * (1 - h));
}
/** a small flying saucer with chasing lights */
function saucer(g, x, y, t, alpha = 1) {
  if (alpha <= 0) return;
  blob(g, x, y - 3, 7, 5, '#C8F4FF', alpha);
  blob(g, x, y, 18, 5, '#8E939C', alpha); blob(g, x, y - 1, 16, 3, '#B8C0CC', alpha);
  for (let i = 0; i < 5; i++) dot(g, x - 12 + i * 6, y + 2, 2, (Math.floor(t * 10) + i) % 2 ? '#4FE88A' : '#FFE066', alpha);
}
function bubble(g, x, y, col) {
  x = R(x); y = R(y);
  g.fillStyle = '#2A1A2E'; g.fillRect(x - 7, y - 5, 14, 10);
  g.fillStyle = '#FAFAF2'; g.fillRect(x - 6, y - 4, 12, 8); g.fillRect(x - 4, y + 4, 3, 2);
  g.fillStyle = col; g.fillRect(x - 4, y - 2, 8, 1); g.fillRect(x - 4, y + 1, 5, 1);
}
function squiggle(g, x, y, col, alpha) {
  g.globalAlpha = clamp(alpha); g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(x - 5, y);
  for (let i = 1; i <= 5; i++) g.lineTo(x - 5 + i * 2, y + (i % 2 ? -2 : 2));
  g.stroke(); g.globalAlpha = 1;
}
function paperTab(g, x, y, alpha) {
  x = R(x); y = R(y); g.globalAlpha = alpha;
  g.fillStyle = '#2A1A2E'; g.fillRect(x - 5, y - 5, 10, 10);
  const q = ['#FF4FA8', '#FFE066', '#3FD8E8', '#4FE88A'];
  for (let i = 0; i < 4; i++) { g.fillStyle = q[i]; g.fillRect(x - 4 + (i % 2) * 4, y - 4 + Math.floor(i / 2) * 4, 4, 4); }
  g.fillStyle = '#2A1A2E'; g.fillRect(x - 2, y - 2, 1, 1); g.fillRect(x + 1, y - 2, 1, 1); g.fillRect(x - 2, y + 1, 4, 1);
  g.globalAlpha = 1;
}
function spiral(g, x, y, r, rot, fill, ink) {
  blob(g, x, y, r, r, fill);
  g.strokeStyle = ink; g.lineWidth = 1; g.beginPath();
  for (let i = 0; i <= 24; i++) { const a = rot + i * 0.5, rr = (i / 24) * r; if (i === 0) g.moveTo(x, y); else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.stroke();
}

// ---------------------------------------------------------------- marks
export const MARK_SECONDS = { arrow: 0.9, status: 1.1, sparkle: 0.8, drain: 0.9 };
const STATUS_ICONS = {
  COTTONMOUTH(g, x, y) { blob(g, x, y + 2, 5, 5, '#7FD6FF'); g.fillStyle = '#7FD6FF'; g.beginPath(); g.moveTo(x - 5, y + 1); g.lineTo(x, y - 8); g.lineTo(x + 5, y + 1); g.fill(); line(g, x - 7, y - 6, x + 7, y + 8, '#E0303C', 2); line(g, x + 7, y - 6, x - 7, y + 8, '#E0303C', 2); },
  THOUGHT_LOOP(g, x, y, t, still) { const r0 = still ? 0 : t * 5; g.strokeStyle = '#C86BFF'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 7, r0, r0 + 4.8); g.stroke(); const ax = x + Math.cos(r0 + 4.8) * 7, ay = y + Math.sin(r0 + 4.8) * 7; dot(g, ax, ay, 4, '#C86BFF'); },
  K_HOLED(g, x, y, t, still) { for (let i = 0; i < 4; i++) blob(g, x, y, 10 - i * 2.5, 5 - i * 1.2, ['#7FD6FF', '#5A3A8A', '#2A1A50', '#0A0612'][i]); if (!still) sparkle(g, x + Math.cos(t * 6) * 6, y + Math.sin(t * 6) * 3, 1, '#FFFFFF'); },
  JAW_LOCK(g, x, y) { g.fillStyle = '#2A1A2E'; g.fillRect(x - 9, y - 6, 18, 12); g.fillStyle = '#FAFAF2'; g.fillRect(x - 8, y - 5, 16, 10); g.fillStyle = '#2A1A2E'; g.fillRect(x - 8, y, 16, 1); for (let i = -4; i <= 4; i += 4) g.fillRect(x + i, y - 5, 1, 10); },
  EGO_DEATH(g, x, y) { blob(g, x, y, 8, 9, '#F4F0E8'); dot(g, x - 3, y - 2, 2, '#2A1A2E'); dot(g, x + 3, y - 2, 2, '#2A1A2E'); g.strokeStyle = '#2A1A2E'; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 1, y - 9); g.lineTo(x - 2, y - 3); g.lineTo(x + 2, y + 1); g.lineTo(x - 1, y + 9); g.stroke(); },
};
const MARKS = {
  /** stat stages: chevrons rising in green, or sinking in red; two rows for a sharp change */
  arrow(g, e, o) {
    const s = SPOT[e.side], k = clamp(e.t / e.dur), up = e.delta > 0, rows = Math.min(2, Math.abs(e.delta || 1));
    const col = up ? '#4FE88A' : '#FF5A6A', drift = o.still ? 0 : (k * 18) * (up ? -1 : 1);
    if (o.still && Math.floor(e.t * 6) % 2) return;
    for (let col_i = 0; col_i < 3; col_i++) for (let r = 0; r < rows; r++) {
      const x = s.x - 16 + col_i * 16, y = s.y + (up ? 8 : -16) + drift + r * 6 + (col_i % 2) * 5;
      g.globalAlpha = 1 - k * 0.7; g.strokeStyle = col; g.lineWidth = 2; g.beginPath();
      if (up) { g.moveTo(x - 4, y + 3); g.lineTo(x, y - 1); g.lineTo(x + 4, y + 3); } else { g.moveTo(x - 4, y - 3); g.lineTo(x, y + 1); g.lineTo(x + 4, y - 3); }
      g.stroke();
    }
    g.globalAlpha = 1;
  },
  /** a picture of the status over the head: a dry mouth, a loop, a K-hole, locked teeth, a cracked mask */
  status(g, e, o) {
    const s = SPOT[e.side], k = clamp(e.t / e.dur), pop = Math.min(1, e.t * 8), bob = o.still ? 0 : Math.sin(e.t * 8) * 2;
    const draw = STATUS_ICONS[e.status];
    g.globalAlpha = (1 - clamp((k - 0.75) / 0.25)) * pop;
    if (draw) draw(g, R(s.x), R(s.y - 34 + bob), e.t, o.still); else star(g, s.x, s.y - 34 + bob, 7, '#FFE066');
    g.globalAlpha = 1;
  },
  /** healing: little sparkles rising around the sprite */
  sparkle(g, e, o) {
    const s = SPOT[e.side], k = clamp(e.t / e.dur), m = o.still ? 4 : 9;
    for (let i = 0; i < m; i++) {
      const p = clamp(k * 1.4 - (i / m) * 0.4);
      if (p <= 0 || p >= 1) continue;
      sparkle(g, s.x - 20 + ((i * 13) % 40), s.y + 14 - (o.still ? 10 : p * 34), 2, ['#B8F4A0', '#FFFFFF', '#FFE066'][i % 3], 1 - p);
    }
  },
  /** a drain: pink serotonin flows from the target back to the user */
  drain(g, e, o) {
    const a = SPOT[e.from], b = SPOT[e.to], k = clamp(e.t / e.dur), m = o.still ? 4 : 10;
    for (let i = 0; i < m; i++) {
      const p = clamp(k * 1.5 - (i / m) * 0.5);
      if (p <= 0 || p >= 1) continue;
      const q = arc(a, b, p, (i % 2 ? 1 : -1) * (10 + (i % 3) * 8));
      dot(g, q.x, q.y, 3, i % 3 ? '#FF8FB8' : '#FFFFFF', 1 - p * 0.4);
    }
  },
};
export const MARK_NAMES = Object.keys(MARKS);
export const STATUS_PICTURES = Object.keys(STATUS_ICONS);
