// The tuk-tuk ride (fast travel with the VIP Press Pass): a full-screen beat between the two places. The night road
// scrolls past, palms and festival lights going by, and the tuk-tuk bounces along with you in the back, horn and all.
// It fades in over the old place and out onto the new one; with reduced motion it holds one frame, briefly.
import { W, H } from './CanvasRenderer.js';

export const RIDE = 2.4, RIDE_STILL = 1.1;
const R = Math.round;
const FADE = 0.3;

function palm(g, x, base, h, col) {
  g.fillStyle = col;
  for (let y = 0; y < h; y += 2) g.fillRect(R(x + Math.sin(y / 9) * 2), base - y, 3, 2);
  const tx = R(x + Math.sin(h / 9) * 2) + 1, ty = base - h;
  for (const [dx, dy] of [[-12, 3], [-8, -3], [0, -6], [8, -3], [12, 3], [-5, 5], [5, 5]]) {
    const n = 6;
    for (let i = 0; i <= n; i++) g.fillRect(R(tx + (dx * i) / n), R(ty + (dy * i) / n + (i * i) / 6), 2, 2);
  }
}

/** the tuk-tuk, side on, facing right, its body at (x, y) top-left; bounce in px; spin turns the wheels */
function tuktuk(g, x, y, spin) {
  const P = (px, py, w, h, c) => { g.fillStyle = c; g.fillRect(R(x + px), R(y + py), w, h); };
  P(4, 0, 44, 4, '#2A2A32');                 // the canvas roof
  P(2, 3, 48, 2, '#1A1A22');
  P(6, 5, 2, 14, '#5A5A68'); P(44, 5, 2, 14, '#5A5A68');   // posts
  P(4, 18, 46, 10, '#E0B020'); P(4, 18, 46, 2, '#F4D03F');  // the body, yellow on top
  P(4, 26, 46, 4, '#2FA84F');                                // the green skirt
  P(46, 12, 6, 8, '#F4D03F'); P(50, 14, 2, 2, '#FFF6C8');   // the nose and its headlamp
  // the headlamp's beam on the road
  g.fillStyle = 'rgba(255,246,200,0.12)'; g.beginPath(); g.moveTo(x + 52, y + 15); g.lineTo(x + 110, y + 26); g.lineTo(x + 110, y + 36); g.fill();
  // the driver up front, and you in the back, waving
  P(36, 8, 6, 6, '#B88058'); P(35, 7, 8, 2, '#1A1A22'); P(36, 14, 6, 4, '#E8E0D4');
  P(14, 7, 6, 6, '#D9A074'); P(13, 6, 8, 2, '#FF4FA8'); P(14, 13, 6, 5, '#FF8FB8');
  P(20, 9 + (spin % 2), 4, 2, '#D9A074');                    // a waving hand
  // the wheels: three, spinning
  for (const wx of [10, 40]) {
    P(wx - 4, 28, 9, 9, '#14101E'); P(wx - 2, 30, 5, 5, '#5A5A68');
    const a = spin * 1.3;
    P(R(wx + Math.cos(a) * 2), R(32 + Math.sin(a) * 2), 1, 1, '#C8C0B0');
  }
  // tassels and a string of flowers along the roof
  for (let i = 0; i < 6; i++) P(6 + i * 7, 5, 2, 2, ['#FF9A2A', '#FFD23F', '#FF4FA8'][i % 3]);
}

/** draw the ride at t seconds since it started */
export function drawRide(g, t, still) {
  const dur = still ? RIDE_STILL : RIDE, tt = still ? 0.6 : t;
  // the night road
  const sky = g.createLinearGradient(0, 0, 0, 110); sky.addColorStop(0, '#0B0A2A'); sky.addColorStop(1, '#3A1A50');
  g.fillStyle = sky; g.fillRect(0, 0, W, 110);
  for (let i = 0; i < 40; i++) { g.fillStyle = i % 5 ? '#6A5A8A' : '#F4F0E8'; g.fillRect((i * 83) % W, (i * 29) % 70, 1, 1); }
  g.fillStyle = '#F4F0E8'; g.beginPath(); g.arc(258, 26, 9, 0, Math.PI * 2); g.fill();
  // far hills, then festival lights strung along them, then palms going by
  g.fillStyle = '#1E1236'; for (let x = 0; x < W; x += 4) g.fillRect(x, R(86 + Math.sin((x + tt * 10) / 31) * 6), 4, 30);
  for (let i = 0; i < 24; i++) {
    const x = ((i * 23 - tt * 30) % (W + 20) + W + 20) % (W + 20) - 10;
    g.fillStyle = ['#FF4FA8', '#FFD23F', '#3FD8E8', '#4FE88A'][i % 4];
    if (still || Math.sin(tt * 6 + i) > -0.3) g.fillRect(R(x), R(80 + Math.sin(i * 1.7) * 3), 2, 2);
  }
  for (let i = 0; i < 6; i++) {
    const x = ((i * 67 - tt * 110) % (W + 60) + W + 60) % (W + 60) - 30;
    palm(g, x, 112, 34 + (i % 3) * 6, '#120A20');
  }
  // the road, its dashes rushing past, the verge
  g.fillStyle = '#2A2A36'; g.fillRect(0, 110, W, H - 110);
  g.fillStyle = '#C8603A'; g.fillRect(0, 108, W, 3);
  g.fillStyle = '#E8E0D4';
  for (let x = -40; x < W + 40; x += 40) g.fillRect(R(x - ((tt * 220) % 40)), 140, 20, 2);
  // the near verge: red earth, tufts of grass and the odd coconut whipping past
  g.fillStyle = '#B5502C'; g.fillRect(0, 158, W, H - 158); g.fillStyle = '#C8603A'; g.fillRect(0, 158, W, 2);
  for (let i = 0; i < 16; i++) {
    const x = ((i * 41 - tt * 260) % (W + 30) + W + 30) % (W + 30) - 15, y = 164 + (i * 7) % 12;
    g.fillStyle = i % 4 ? '#3F8A3F' : '#7E5632';
    if (i % 4) { g.fillRect(R(x), y, 1, 3); g.fillRect(R(x) + 2, y - 1, 1, 4); g.fillRect(R(x) + 4, y, 1, 3); } else { g.beginPath(); g.arc(R(x), y + 2, 3, 0, Math.PI * 2); g.fill(); }
  }
  // the tuk-tuk, bouncing over the potholes, with a puff of dust behind it
  const bounce = still ? 0 : (Math.sin(tt * 18) > 0.6 ? -1 : 0) + (Math.sin(tt * 5.3) > 0.9 ? -2 : 0);
  const x = still ? 120 : R(-60 + Math.min(1, tt / 0.5) * 180 + Math.max(0, tt - (dur - 0.6)) * 400);
  if (!still) for (let i = 0; i < 5; i++) {
    const k = (tt * 2 + i / 5) % 1;
    g.globalAlpha = 0.5 * (1 - k); g.fillStyle = '#B8A890';
    g.beginPath(); g.arc(x - 4 - k * 30, 136 - k * 6, 2 + k * 5, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  tuktuk(g, x, 104 + bounce, Math.floor(tt * 12));
  // in and out through black
  const a = Math.max(0, 1 - tt / FADE, (tt - (dur - FADE)) / FADE);
  if (a > 0) { g.fillStyle = `rgba(11,3,20,${Math.min(1, a)})`; g.fillRect(0, 0, W, H); }
}
