// The Aliens of Vicchio: two full-screen pixel cutscenes behind the dialogue box, in the style of the intro.
//   mantequilla      the first meeting: a moonlit bamboo grove, Mantequilla crouched over a mushroom patch,
//                    picking them into a basket and humming, his guitarron on his back
//   vicchio_landing  the signal: three Glowing Caps in a triangle, Mantequilla playing the guitarron, a saucer
//                    coming down on a green beam, and the bamboo parting to the east. The script sets `phase`:
//                    0 the caps light up, 1 he plays, 2 the saucer comes down, 3 it settles past the bamboo
// Everything is drawn in whole pixels; with reduced motion nothing moves and each phase shows its end state.
import { W, H } from './CanvasRenderer.js';

const VIEW = H - 53;                                 // the dialogue box covers the rest
const SKIN = '#D9A074', SKIN_DK = '#B88058', HAIR = '#20140E', HAT = '#E8C468', HAT_DK = '#B8963A', BAND = '#E0303C';
const PANTS = '#3A3A52', PANTS_DK = '#2A2A3E', BOOTS = '#5A3418', WOOD = '#B5702C', WOOD_DK = '#8A5020', NECK = '#6A4426';
const R = Math.round;
const ease = (k) => 1 - (1 - Math.max(0, Math.min(1, k))) ** 3;
const lerp = (a, b, k) => a + (b - a) * k;

/** a figure drawn in big pixels: art coordinates times s, from an origin */
function pen(g, ox, oy, s) {
  const P = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(R(ox + x * s), R(oy + y * s), R(w * s), R(h * s)); };
  const E = (cx, cy, rx, ry, col) => { for (let y = Math.ceil(-ry); y <= ry; y++) { const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2)) + 0.5); if (half > 0) P(cx - half, cy + y, half * 2, 1, col); } };
  const L = (x0, y0, x1, y1, w, col) => { const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0))); for (let i = 0; i <= n; i++) P(Math.floor(lerp(x0, x1, i / n)), Math.floor(lerp(y0, y1, i / n)), w, w, col); };
  return { P, E, L };
}

function stars(g, t, still, n, yMax, seed = 0) {
  for (let i = 0; i < n; i++) {
    const x = (i * 73 + seed * 31) % W, y = (i * 37 + seed * 17) % yMax, on = still || (Math.sin(t * 2.2 + i * 1.7) > -0.6);
    if (!on) continue;
    g.fillStyle = i % 4 ? '#8C7A9A' : '#F4F0E8'; g.fillRect(x, y, 1, 1);
  }
}
function moon(g, x, y, r) {
  g.fillStyle = 'rgba(244,240,232,0.12)'; g.beginPath(); g.arc(x, y, r + 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#F4F0E8'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#D8D0C8'; g.fillRect(x - 3, y - 2, 3, 2); g.fillRect(x + 3, y + 3, 2, 2);
}
/** a bamboo stalk, x is its left edge; sway shifts the top in whole pixels */
function stalk(g, x, top, bottom, w, col, node, sway = 0) {
  for (let y = top; y < bottom; y += 4) {
    const k = 1 - (y - top) / Math.max(1, bottom - top), dx = R(sway * k);
    g.fillStyle = col; g.fillRect(x + dx, y, w, Math.min(4, bottom - y));
    if ((y - top) % 16 === 12) { g.fillStyle = node; g.fillRect(x + dx - 1, y, w + 2, 1); }
  }
}
function mushroom(g, x, y, cap, s = 1, glow = false) {
  g.fillStyle = '#F2E8D0'; g.fillRect(x - s, y - 3 * s, 2 * s, 3 * s);
  g.fillStyle = cap; g.fillRect(x - 3 * s, y - 5 * s, 6 * s, 2 * s); g.fillRect(x - 2 * s, y - 6 * s, 4 * s, s);
  g.fillStyle = '#FFFFFF'; g.fillRect(x - 2 * s, y - 5 * s, s, s); g.fillRect(x + s, y - 6 * s, s, s);
  if (glow) { g.fillStyle = '#C8FFE0'; g.fillRect(x - 5 * s, y - 7 * s, 1, 1); g.fillRect(x + 4 * s, y - 8 * s, 1, 1); g.fillRect(x + 5 * s, y - 3 * s, 1, 1); }
}
function note(g, x, y, col) { g.fillStyle = col; g.fillRect(x, y, 1, 6); g.fillRect(x - 2, y + 5, 3, 2); g.fillRect(x + 1, y, 2, 1); g.fillRect(x + 2, y + 1, 1, 1); }
function fadeIn(g, t) { if (t < 0.5) { g.globalAlpha = 1 - t / 0.5; g.fillStyle = '#0B0314'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; } }

// ---------------------------------------------------------------- the first meeting
const PATCH = [[24, 0, '#FF4FA8'], [33, 1, '#FF4FA8'], [38, -1, '#4FE88A'], [44, 1, '#FF9A2A'], [50, 0, '#FF4FA8'], [57, 1, '#4FE88A']];
const CYCLE = 2.6;

export function drawForage(game, g, t0) {
  const still = !!game.settings.reducedMotion, t = still ? 0.9 : t0;
  // night sky, moon, the grove
  const sky = g.createLinearGradient(0, 0, 0, 96); sky.addColorStop(0, '#0B0A1E'); sky.addColorStop(1, '#22284A');
  g.fillStyle = sky; g.fillRect(0, 0, W, 96);
  stars(g, t, still, 30, 60);
  moon(g, 262, 24, 11);
  for (let i = 0; i < 14; i++) stalk(g, 6 + i * 23 + (i % 3) * 4, 0, 98, 4, '#16302A', '#0E2018', still ? 0 : Math.sin(t * 0.8 + i) * 2);
  for (let i = 0; i < 6; i++) stalk(g, 14 + i * 58 + (i % 2) * 9, -4, 104, 6, '#2A5A3A', '#1E4A2E', still ? 0 : Math.sin(t * 1.1 + i * 2) * 3);
  g.fillStyle = '#1E3A24'; g.fillRect(0, 96, W, H - 96);
  g.fillStyle = '#2A4A30'; for (let x = 3; x < W; x += 11) g.fillRect(x, 97 + (x % 3), 2, 1);
  // fireflies
  if (!still) for (let i = 0; i < 9; i++) { const fx = (i * 41 + t * (6 + i)) % W, fy = 50 + ((i * 29) % 45) + Math.sin(t * 2 + i) * 4; if (Math.sin(t * 3 + i * 2) > 0) { g.fillStyle = '#E8FF9A'; g.fillRect(R(fx), R(fy), 1, 1); } }

  // Mantequilla, crouched low over the patch, facing right; big pixels (3 screen px each)
  const s = 3, ox = 64, oy = 18, { P, E, L } = pen(g, ox, oy, s);
  const n = Math.floor(t / CYCLE), ph = (t % CYCLE) / CYCLE;
  // the guitarron on his back
  L(9, 16, 2, 3, 2, NECK); P(0, 0, 3, 4, NECK); P(-1, 1, 1, 1, '#E8D8B8'); P(3, 1, 1, 1, '#E8D8B8'); P(-1, 3, 1, 1, '#E8D8B8');
  E(6, 23, 6.5, 8, WOOD_DK); E(6, 23, 5.5, 7, WOOD); E(6, 22, 1.6, 1.6, '#3A2214');
  // legs, crouched: the far one darker, then the near one, thigh flat and shin down
  P(13, 27, 4, 6, PANTS_DK); P(12, 33, 6, 2, BOOTS);
  P(10, 25, 11, 4, PANTS); P(17, 27, 4, 6, PANTS); P(17, 33, 6, 2, BOOTS);
  // bare torso leaning in, muscles, the strap
  P(9, 15, 8, 10, SKIN); E(16, 17, 3, 3, SKIN); P(9, 24, 9, 1, BOOTS);
  P(12, 18, 3, 1, SKIN_DK); P(13, 21, 2, 1, SKIN_DK); L(9, 15, 15, 24, 1, '#5A3418');
  // head, curls, sombrero
  E(21, 11, 4, 4.5, SKIN); P(25, 11, 1, 2, SKIN_DK);
  const blink = !still && (t % 3.7) < 0.14;
  P(23, 10, 1, blink ? 1 : 2, '#2A1A2E');
  P(22, 14, 2, 1, SKIN_DK);
  for (const [cx, cy, r] of [[17, 9, 2], [17, 12, 1.8], [18, 15, 1.6], [19, 7, 1.6], [16, 14, 1.4]]) E(cx, cy, r, r, HAIR);
  P(10, 5, 22, 2, HAT); P(11, 7, 20, 1, HAT_DK); P(16, 1, 9, 4, HAT); P(17, 0, 7, 1, HAT); P(16, 4, 9, 1, BAND);
  // the basket by his foot, filling up
  P(27, 26, 10, 7, '#A87644'); P(27, 26, 10, 1, '#D8B070'); for (let x = 28; x < 37; x += 2) P(x, 27, 1, 6, '#8A5A32');
  const inBasket = Math.min(5, n % 7);
  for (let i = 0; i < inBasket; i++) P(28 + i * 2, 24 + (i % 2), 2, 2, ['#FF4FA8', '#4FE88A', '#FF9A2A'][i % 3]);
  // the rest of the patch, further on
  for (const [x, dy, cap] of PATCH) mushroom(g, R(ox + (x + 16) * s), R(oy + (35 + dy) * s), cap, 2, cap === '#4FE88A' && !still && Math.sin(t * 3 + x) > 0);
  // the one he is picking, right in front of his foot: reach down, tug, lift it into the basket
  const cap = ['#FF4FA8', '#4FE88A', '#FF9A2A'][n % 3], G = [25, 32], B = [31, 25];
  let hx, hy, carry = false, lift = 0;
  if (still) { hx = G[0]; hy = G[1]; }
  else if (ph < 0.35) { const k = ease(ph / 0.35); hx = lerp(B[0], G[0], k); hy = lerp(B[1], G[1], k); }
  else if (ph < 0.5) { lift = ((ph - 0.35) / 0.15) * 2; hx = G[0]; hy = G[1] - lift; }
  else if (ph < 0.85) { const k = ease((ph - 0.5) / 0.35); hx = lerp(G[0], B[0], k); hy = lerp(G[1] - 2, B[1] - 1, k); carry = true; }
  else { hx = B[0]; hy = B[1] - 1; }
  if (!carry && ph < 0.85) mushroom(g, R(ox + G[0] * s), R(oy + (35 - lift) * s), cap, 2);
  const ex = (17 + hx) / 2 + 1, ey = Math.max(20, (17 + hy) / 2 + 3);
  L(17, 17, ex, ey, 2, SKIN); L(ex, ey, hx, hy, 2, SKIN); P(hx - 0.5, hy - 0.5, 3, 2, SKIN_DK);
  if (carry) mushroom(g, R(ox + (hx + 1) * s), R(oy + (hy + 1) * s), cap, 2);
  // humming: notes drifting up from him
  if (!still) for (let i = 0; i < 3; i++) { const k = (t * 0.45 + i / 3) % 1; g.globalAlpha = 1 - k; note(g, R(ox + 27 * s + k * 30 + i * 4), R(oy + 6 * s - k * 26), ['#FFE066', '#5FF4FF', '#FF8FB8'][i]); g.globalAlpha = 1; }
  fadeIn(g, t0);
}

// ---------------------------------------------------------------- the landing
const CAPS = [[160, 104], [138, 118], [182, 118]];

export function drawLanding(game, g, t0, phase, pt0) {
  const still = !!game.settings.reducedMotion, t = still ? 0 : t0, pt = still ? 9 : pt0;
  const sky = g.createLinearGradient(0, 0, 0, 96); sky.addColorStop(0, '#07051A'); sky.addColorStop(1, '#1E1A44');
  g.fillStyle = sky; g.fillRect(0, 0, W, 96);
  stars(g, t, still, 60, 90, 3);
  moon(g, 44, 20, 9);
  // the bamboo on both sides; it leans in while he plays, and the right side parts at the end
  const lean = phase >= 1 ? (still ? 3 : 3 + Math.sin(t * 1.4) * 2) : 0;
  const part = phase >= 3 ? ease(pt / 2.5) : 0;
  for (let i = 0; i < 5; i++) stalk(g, 4 + i * 14, -2, 100, 5, i % 2 ? '#1E3A2A' : '#2A5A3A', '#16302A', lean);
  for (let i = 0; i < 5; i++) stalk(g, 246 + i * 14 + R(part * (10 + i * 12)), -2, 100, 5, i % 2 ? '#1E3A2A' : '#2A5A3A', '#16302A', -lean + part * 8);
  g.fillStyle = '#16301E'; g.fillRect(0, 96, W, H - 96);
  g.fillStyle = '#20402A'; for (let x = 5; x < W; x += 13) g.fillRect(x, 98 + (x % 4), 2, 1);
  // the path that opens to the east
  if (part > 0) {
    g.globalAlpha = 0.5 * part; g.fillStyle = '#4FE88A';
    g.beginPath(); g.moveTo(200, 112); g.lineTo(W, 96); g.lineTo(W, 108); g.lineTo(206, 120); g.fill(); g.globalAlpha = 1;
  }

  // the three caps, lighting up one after the other, brighter under the beam
  CAPS.forEach(([x, y], i) => {
    const lit = phase > 0 || still || pt > 0.4 + i * 0.6;
    const pulse = still ? 0.5 : (Math.sin(t * 3 + i) + 1) / 2;
    if (lit) { g.fillStyle = `rgba(79,232,138,${(phase >= 2 ? 0.35 : 0.2) + pulse * 0.1})`; g.beginPath(); g.arc(x, y - 5, 6 + pulse * 2, 0, Math.PI * 2); g.fill(); }
    mushroom(g, x, y, lit ? '#4FE88A' : '#3A6A4A', 2);
  });

  // the saucer: comes down, hovers over the caps with a beam, then glides off east past the bamboo
  if (phase >= 2) {
    const down = phase === 2 ? ease(pt / 2.2) : 1, away = phase >= 3 ? ease(pt / 2.5) : 0;
    const sx = R(160 + away * 140), sy = R(lerp(-20, 40, down) + away * 46 + (still ? 0 : Math.sin(t * 2) * 2));
    if (away < 0.6) {
      const a = (phase === 2 ? Math.min(1, pt / 1.2) : 1 - away / 0.6) * 0.32;
      g.globalAlpha = a; g.fillStyle = '#9AFFC8';
      g.beginPath(); g.moveTo(sx - 10, sy + 6); g.lineTo(sx + 10, sy + 6); g.lineTo(sx + 44, 124); g.lineTo(sx - 44, 124); g.fill(); g.globalAlpha = 1;
      if (!still) for (let i = 0; i < 10; i++) { const k = (t * 0.6 + i / 10) % 1; g.fillStyle = i % 2 ? '#C8FFE0' : '#FFFFFF'; g.fillRect(R(sx - 30 + ((i * 23) % 60)), R(lerp(122, sy + 8, k)), 1, 1); }
    }
    g.fillStyle = '#C8F4FF'; g.fillRect(sx - 8, sy - 6, 16, 6); g.fillRect(sx - 6, sy - 8, 12, 2);
    g.fillStyle = '#8E939C'; g.fillRect(sx - 24, sy, 48, 5); g.fillStyle = '#B8C0CC'; g.fillRect(sx - 22, sy, 44, 2);
    g.fillStyle = '#5A5F6A'; g.fillRect(sx - 18, sy + 5, 36, 2);
    for (let i = 0; i < 7; i++) { g.fillStyle = (Math.floor(t * 8) + i) % 2 ? '#4FE88A' : '#FFE066'; g.fillRect(sx - 20 + i * 6, sy + 2, 2, 2); }
    // a lanky shape in the dome
    g.fillStyle = '#9AD8B0'; g.fillRect(sx - 2, sy - 7, 4, 4); g.fillStyle = '#14101E'; g.fillRect(sx - 2, sy - 6, 1, 1); g.fillRect(sx + 1, sy - 6, 1, 1);
  }

  // Mantequilla, standing to the left of the caps, playing the guitarron across his body; 2 screen px each
  const s = 2, ox = 70, oy = 52, { P, E, L } = pen(g, ox, oy, s);
  const strum = phase >= 1 && !still ? Math.floor(t * 6) % 2 : 0;
  P(9, 26, 4, 10, PANTS); P(14, 26, 4, 10, PANTS); P(8, 35, 5, 2, BOOTS); P(14, 35, 5, 2, BOOTS);
  P(8, 13, 11, 13, SKIN); P(8, 25, 11, 1, BOOTS);
  E(6, 15, 3, 3, SKIN); E(21, 15, 3, 3, SKIN);
  P(10, 17, 3, 1, SKIN_DK); P(14, 17, 3, 1, SKIN_DK); P(13, 20, 1, 4, SKIN_DK);
  // the guitarron across him: neck up to the left, body at his right hip
  L(4, 7, 14, 19, 2, NECK); P(1, 4, 4, 4, NECK);
  E(17, 22, 6, 5.5, WOOD_DK); E(17, 22, 5, 4.5, WOOD); E(17, 21, 1.4, 1.4, '#3A2214');
  L(4, 14, 6, 9, 2, SKIN); P(4, 8, 3, 2, SKIN_DK);                // fretting hand on the neck
  L(21, 15, 19, 19 + strum, 2, SKIN); P(17, 20 + strum, 3, 2, SKIN_DK);   // strumming hand
  E(13.5, 8, 4.5, 5, SKIN); P(11, 7, 1, 2, '#2A1A2E'); P(15, 7, 1, 2, '#2A1A2E'); P(12, 11, 3, 1, SKIN_DK);
  for (const [cx, cy, r] of [[8, 6, 1.6], [19, 6, 1.6], [8, 9, 1.5], [19, 9, 1.5], [9, 12, 1.2], [18, 12, 1.2], [11, 4, 1.2], [16, 4, 1.2]]) E(cx, cy, r, r, HAIR);
  P(2, 2, 23, 2, HAT); P(3, 4, 21, 1, HAT_DK); P(9, -2, 9, 4, HAT); P(10, -3, 7, 1, HAT); P(9, 1, 9, 1, BAND);
  // the music
  if (phase >= 1 && !still) for (let i = 0; i < 4; i++) { const k = (t * 0.5 + i / 4) % 1; g.globalAlpha = 1 - k; note(g, R(ox + 22 * s + k * 50), R(oy + 30 - k * 40 - (i % 2) * 6), ['#FFE066', '#5FF4FF', '#FF8FB8', '#4FE88A'][i]); g.globalAlpha = 1; }
  fadeIn(g, t0);
}
