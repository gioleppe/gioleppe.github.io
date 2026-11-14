// Reaching the Mainstage Temple (1.2.5): two full-screen scenes behind the dialogue box, by phase.
//   crowdsurf  0 you at the gap in the front barrier, the crowd round you, hands going up
//              1 lifted and passed forward over the heads towards the stage and its lights
//              2 thrown up over the stage lip in a flash
//   ziggurat   0 the temple behind the stage: terraces stepping up into the night, dark
//              1 the terraces light up one after the other, kick, bass, hat, lead
//              2 the summit glows and the Council appear against the stars
//              3 beams sweep out from the summit
// Whole pixels; with reduced motion nothing moves and each phase shows its end state.
import { W, H } from './CanvasRenderer.js';

const VIEW = H - 53;
const R = Math.round;
const ease = (k) => 1 - (1 - Math.max(0, Math.min(1, k))) ** 3;
const COLS = ['#E0303C', '#7C8CD9', '#3FD8E8', '#FFD23F'];        // the Four: kick, bass, hat, lead

function sky(g, t, still, top = '#07051A', bottom = '#2A1440') {
  const gr = g.createLinearGradient(0, 0, 0, VIEW); gr.addColorStop(0, top); gr.addColorStop(1, bottom);
  g.fillStyle = gr; g.fillRect(0, 0, W, VIEW);
  for (let i = 0; i < 50; i++) { if (!still && Math.sin(t * 2 + i * 1.3) < -0.7) continue; g.fillStyle = i % 5 ? '#6A5A8A' : '#F4F0E8'; g.fillRect((i * 67) % W, (i * 31) % 70, 1, 1); }
}

/** a head in the crowd from behind, with an arm up now and then */
function head(g, x, y, i, t, still, up) {
  const skin = ['#D9A074', '#B88058', '#F2C29A', '#8A5A3A'][i % 4], hair = ['#20140E', '#5A3A22', '#C8A060', '#14101E'][i % 4];
  g.fillStyle = hair; g.fillRect(x - 3, y - 3, 7, 6); g.fillStyle = skin; g.fillRect(x - 3, y + 2, 7, 2);
  g.fillStyle = ['#FF4FA8', '#3FD8E8', '#4FE88A', '#FFE066', '#C86BFF'][i % 5]; g.fillRect(x - 4, y + 4, 9, 4);
  if (up) { const k = still ? 0 : Math.round(Math.sin(t * 6 + i) * 1.5); g.fillStyle = skin; g.fillRect(x + 4, y - 8 + k, 2, 8); g.fillRect(x + 3, y - 10 + k, 4, 3); }
}

export function drawCrowdsurf(game, g, t0, phase, pt0) {
  const still = !!game.settings.reducedMotion, t = still ? 0 : t0, pt = still ? 9 : pt0;
  sky(g, t, still, '#0B0314', '#3A1450');
  // the stage ahead: its lip, the LED wall glowing, lasers fanning out over the crowd
  const near = phase >= 1 ? ease(pt / 2.2) : 0, shift = R(near * 24) + (phase >= 2 ? 24 : 0);
  const sy = 26 + shift;
  g.fillStyle = '#2A1A3E'; g.fillRect(40, sy, W - 80, 18); g.fillStyle = '#5E4A78'; g.fillRect(40, sy + 16, W - 80, 3);
  for (let i = 0; i < 24; i++) { const k = (Math.floor(t * 3) + i) % 5; g.fillStyle = ['#FF4FA8', '#3FD8E8', '#FFE066', '#4FE88A', '#C86BFF'][k]; g.fillRect(46 + i * 10, sy + 3, 6, 10); }
  g.globalAlpha = 0.35;
  for (let i = 0; i < 6; i++) {
    const a = (still ? 0.6 : Math.sin(t * 1.4 + i)) * 0.9 + Math.PI / 2;
    g.strokeStyle = COLS[i % 4]; g.lineWidth = 1; g.beginPath(); g.moveTo(W / 2 + (i - 2.5) * 30, sy + 10); g.lineTo(W / 2 + (i - 2.5) * 30 + Math.cos(a) * 200, sy + 10 + Math.sin(a) * 200); g.stroke();
  }
  g.globalAlpha = 1;
  // the crowd: rows of heads from behind, more hands up the further it goes
  for (let row = 0; row < 6; row++) {
    const y = 58 + row * 13 + (phase >= 1 ? R((pt * 18) % 13) * (still ? 0 : 1) : 0);
    for (let i = 0; i < 18; i++) {
      const x = 8 + i * 18 + (row % 2) * 9, bob = still ? 0 : R(Math.sin(t * 8 + i + row) * 1.2);
      head(g, x, y + bob, i + row * 3, t, still, phase >= 1 || (i + row) % 3 === 0);
    }
  }
  // you: standing in the gap, then flat on your back on the hands, then flying up at the stage
  const P = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(R(x), R(y), w, h); };
  if (phase === 0) {
    const x = W / 2 - 4, y = 96;
    P(x, y - 12, 8, 7, '#20140E'); P(x + 1, y - 6, 6, 3, '#D9A074'); P(x - 1, y - 3, 10, 9, '#FF8FB8');
  } else {
    const k = phase === 1 ? ease(pt / 2.2) : 1, fly = phase >= 2 ? ease(pt / 0.9) : 0;
    const x = W / 2 - 12, y = 92 - k * 30 - fly * 34 - (still ? 0 : Math.abs(Math.sin(t * 7)) * 2);
    P(x, y, 24, 6, '#FF8FB8'); P(x + 24, y - 1, 7, 7, '#D9A074'); P(x + 25, y - 2, 7, 3, '#20140E'); P(x - 6, y + 1, 6, 4, '#3A3A52');
    P(x + 8, y - 6, 2, 6, '#D9A074'); P(x + 16, y - 6, 2, 6, '#D9A074');   // arms out, loving it
  }
  if (phase >= 2) { const f = still ? 0 : Math.max(0, 1 - pt * 2.5); if (f > 0) { g.fillStyle = `rgba(255,255,255,${f})`; g.fillRect(0, 0, W, VIEW); } }
}

/** a terrace of the ziggurat, front face and top, centred; lit: 0..1 with the colour of its layer */
function terrace(g, cx, y, w, h, lit, col) {
  g.fillStyle = '#6E5442'; g.fillRect(R(cx - w / 2), y, w, h);
  g.fillStyle = '#8A6E54'; g.fillRect(R(cx - w / 2), y, w, 2);
  for (let x = R(cx - w / 2) + 3; x < cx + w / 2 - 2; x += 6) { g.fillStyle = '#5A4434'; g.fillRect(x, y + 4, 1, h - 5); }
  g.fillStyle = '#C99A58'; g.fillRect(R(cx - w / 2), y, w, 1);
  if (lit > 0) {
    g.globalAlpha = 0.55 * lit; g.fillStyle = col; g.fillRect(R(cx - w / 2), y + h - 3, w, 2);
    for (let x = R(cx - w / 2) + 4; x < cx + w / 2 - 2; x += 10) g.fillRect(x, y + 3, 2, 2);
    g.globalAlpha = 0.12 * lit; g.fillRect(R(cx - w / 2) - 6, y - 6, w + 12, h + 8);
    g.globalAlpha = 1;
  }
  g.fillStyle = '#3A2A20'; g.fillRect(R(cx - 2), y + 1, 4, h - 1);                   // the stairs up the middle
}

export function drawZiggurat(game, g, t0, phase, pt0) {
  const still = !!game.settings.reducedMotion, t = still ? 0 : t0, pt = still ? 9 : pt0;
  sky(g, t, still);
  // the stage at the foot, and the crowd's phones far below
  g.fillStyle = '#14081E'; g.fillRect(0, VIEW - 14, W, 14);
  for (let i = 0; i < 60; i++) { if (!still && Math.sin(t * 3 + i * 2.1) < 0) continue; g.fillStyle = i % 3 ? '#C8F4FF' : '#FFE066'; g.fillRect((i * 53) % W, VIEW - 10 + (i % 3) * 3, 1, 1); }
  const cx = W / 2, tiers = [[200, 96, 0], [168, 80, 1], [136, 64, 2], [104, 48, 3], [76, 32, -1]];
  tiers.forEach(([w, y, layer], i) => {
    const lit = layer < 0 ? (phase >= 2 ? 1 : 0) : phase >= 2 ? 1 : phase === 1 ? Math.max(0, Math.min(1, (pt - i * 0.7) / 0.5)) : 0;
    terrace(g, cx, y, w, 16, lit, layer < 0 ? '#F4F0E8' : COLS[layer]);
  });
  // the summit and the Council, three figures against the stars
  g.fillStyle = '#8A6E54'; g.fillRect(cx - 26, 22, 52, 10); g.fillStyle = '#C99A58'; g.fillRect(cx - 26, 22, 52, 1);
  if (phase >= 2) {
    const k = still ? 1 : Math.min(1, (phase === 2 ? pt : 9) / 1.5);
    g.globalAlpha = 0.25 * k; g.fillStyle = '#FFD23F'; g.beginPath(); g.arc(cx, 14, 30, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
    for (const [dx, h] of [[-12, 14], [0, 18], [12, 14]]) {
      g.fillStyle = '#0B0814'; g.fillRect(cx + dx - 3, 22 - h, 7, h); g.fillRect(cx + dx - 2, 22 - h - 5, 5, 5);
      g.fillStyle = '#FFD23F'; g.fillRect(cx + dx, 22 - h - 3, 1, 1);
    }
  }
  if (phase >= 3) {
    g.globalAlpha = 0.3;
    for (let i = 0; i < 8; i++) {
      const a = Math.PI + (i / 7) * Math.PI + (still ? 0 : Math.sin(t + i) * 0.15);
      g.strokeStyle = ['#FF4FA8', '#3FD8E8', '#FFE066', '#C86BFF'][i % 4]; g.beginPath(); g.moveTo(cx, 10); g.lineTo(cx + Math.cos(a) * 260, 10 + Math.sin(a) * 260); g.stroke();
    }
    g.globalAlpha = 1;
  }
  // you, small at the foot of the stairs, looking up
  g.fillStyle = '#FF8FB8'; g.fillRect(cx - 2, VIEW - 8, 4, 5); g.fillStyle = '#20140E'; g.fillRect(cx - 2, VIEW - 12, 4, 4);
}
