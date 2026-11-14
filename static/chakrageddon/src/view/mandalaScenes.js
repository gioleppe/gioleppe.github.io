// The Unfinished Mandala: the full-screen scene behind the dialogue box when you lay the sand mandala on the east
// wall of the Sadhu Cave. The script sets `phase`:
//   0 the faded outline on the rock    1-4 a quarter fills with sand, east white, south red, west yellow, north grey
//   5 the last grain: the north blazes purple, the whole pattern turns, and Mandalord steps out of the middle
//   6 after the catch: Baba Smoke sweeps it into a small grey heap
// With reduced motion nothing moves and each phase shows its end state.
import { W, H } from './CanvasRenderer.js';

const VIEW = H - 53;                                 // the dialogue box covers the rest
const CX = W / 2, CY = 62, RO = 46, RI = 9;
const R = Math.round;
const ease = (k) => 1 - (1 - Math.max(0, Math.min(1, k))) ** 3;
const lerp = (a, b, k) => a + (b - a) * k;
// east, south, west, north: the order you lay them in, and the angle each quarter is centred on
const QUARTERS = [
  { a: 0, col: '#F4F0E8', dk: '#C8C0B4' },
  { a: Math.PI / 2, col: '#E0303C', dk: '#9A1E2A' },
  { a: Math.PI, col: '#FFD23F', dk: '#C89A1E' },
  { a: -Math.PI / 2, col: '#A89AB8', dk: '#7A6E8A', glow: '#C86BFF', glowDk: '#7A2EC8' },
];
const FILL_SECONDS = 1.6;

function wall(g, t, still) {
  g.fillStyle = '#2A221E'; g.fillRect(0, 0, W, VIEW);
  // rough rock: a few darker and lighter blotches, and the smoke drifting across the top
  for (let i = 0; i < 70; i++) {
    const x = (i * 97) % W, y = (i * 53) % VIEW, w = 3 + (i % 5) * 2;
    g.fillStyle = i % 3 ? '#342A24' : '#221A16'; g.fillRect(x, y, w, 2 + (i % 3));
  }
  g.fillStyle = 'rgba(200,190,180,0.06)';
  for (let i = 0; i < 4; i++) { const x = R(((still ? 0 : t * 6) + i * 90) % (W + 80)) - 40; g.beginPath(); g.ellipse(x, 10 + i * 6, 40, 6, 0, 0, Math.PI * 2); g.fill(); }
}

/** a quarter of the mandala, out to radius r: a wedge with a petal and a ring of dots drawn in its darker shade */
function quarter(g, q, r, col, dk) {
  if (r <= RI) return;
  g.fillStyle = col;
  g.beginPath(); g.moveTo(Math.cos(q.a - Math.PI / 4) * RI, Math.sin(q.a - Math.PI / 4) * RI);
  g.arc(0, 0, r, q.a - Math.PI / 4, q.a + Math.PI / 4); g.arc(0, 0, RI, q.a + Math.PI / 4, q.a - Math.PI / 4, true); g.fill();
  g.fillStyle = dk;
  const petal = Math.min(r, RO * 0.8);
  if (petal > RI + 6) { g.beginPath(); g.ellipse(Math.cos(q.a) * (RI + petal) / 2, Math.sin(q.a) * (RI + petal) / 2, (petal - RI) / 2, 5, q.a, 0, Math.PI * 2); g.fill(); }
  for (let i = -2; i <= 2; i++) {
    const a = q.a + i * 0.3, rr = Math.min(r - 3, RO - 5);
    if (rr > RI + 2) g.fillRect(R(Math.cos(a) * rr) - 1, R(Math.sin(a) * rr) - 1, 2, 2);
  }
}

/** the outline scratched into the rock: a square, a circle, a cross and the little circle in the middle */
function outline(g, col) {
  g.strokeStyle = col; g.lineWidth = 1;
  g.strokeRect(-RO - 4.5, -RO - 4.5, RO * 2 + 9, RO * 2 + 9);
  g.beginPath(); g.arc(0, 0, RO, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(0, 0, RI, 0, Math.PI * 2); g.stroke();
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    g.beginPath(); g.moveTo(Math.cos(a) * RI, Math.sin(a) * RI); g.lineTo(Math.cos(a) * RO, Math.sin(a) * RO); g.stroke();
  }
  // the T-shaped gates on each side of the square, as on a real one
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const ex = dx * (RO + 4.5), ey = dy * (RO + 4.5);
    g.beginPath(); g.moveTo(ex - dy * 8, ey - dx * 8); g.lineTo(ex - dy * 8 + dx * 4, ey - dx * 8 + dy * 4); g.lineTo(ex + dy * 8 + dx * 4, ey + dx * 8 + dy * 4); g.lineTo(ex + dy * 8, ey + dx * 8); g.stroke();
  }
}

export function drawMandala(game, g, t0, phase, pt0) {
  const still = !!game.settings.reducedMotion, t = still ? 0 : t0, pt = still ? 9 : pt0;
  wall(g, t, still);
  const sweep = phase >= 6 ? ease(pt / 2.6) : 0;
  const lit = phase >= 5;                                          // the north blazes once the last grain drops
  const turn = phase === 5 && !still ? pt * 0.2 : 0;
  // a glow behind it once it wakes
  if (lit && phase < 6) {
    const k = still ? 1 : Math.min(1, pt / 1.2);
    for (let i = 4; i > 0; i--) { g.fillStyle = `rgba(200,107,255,${0.06 * k})`; g.beginPath(); g.arc(CX, CY, RO + 4 + i * 6, 0, Math.PI * 2); g.fill(); }
  }
  g.save(); g.translate(CX, CY); g.rotate(turn);
  QUARTERS.forEach((q, i) => {
    const laid = phase > i + 1 || (phase === i + 1 && (still || pt >= FILL_SECONDS));
    const filling = phase === i + 1 && !laid;
    if (!laid && !filling) return;
    let r = filling ? lerp(RI, RO, ease(pt / FILL_SECONDS)) : RO;
    let col = lit && q.glow ? q.glow : q.col, dk = lit && q.glowDk ? q.glowDk : q.dk;
    if (sweep > 0) { r = lerp(RO, RI, sweep); col = mix(col, '#8A8278', sweep); dk = mix(dk, '#6E665E', sweep); }
    quarter(g, q, r, col, dk);
  });
  outline(g, phase >= 5 && phase < 6 ? '#E8C8FF' : '#8A7A6E');
  g.restore();

  // the sand running off your fingertips into the quarter being laid
  const q = QUARTERS[phase - 1];
  if (q && !still && pt < FILL_SECONDS + 0.3) {
    const fx = R(CX + Math.cos(q.a) * 28), fy = R(CY + Math.sin(q.a) * 28);
    for (let i = 0; i < 12; i++) {
      const k = (t * 1.8 + i / 12) % 1;
      g.fillStyle = i % 2 ? q.col : q.dk;
      g.fillRect(fx + ((i * 5) % 7) - 3, R(lerp(fy - 26, fy, k)), 1, 1);
    }
    g.fillStyle = '#D9A074'; g.fillRect(fx - 3, fy - 30, 6, 4); g.fillRect(fx - 1, fy - 27, 2, 2);   // a hand, pinching
  }

  // Mandalord steps out of the middle, the way you would step through a door
  if (phase === 5) {
    const img = game.images['mon:mandalord'], k = still ? 1 : ease((pt - 1.2) / 1.8);
    if (img && k > 0) {
      const frame = !still && Math.floor(t * 2) % 2 ? 1 : 0;
      g.save(); g.imageSmoothingEnabled = false; g.globalAlpha = k;
      g.drawImage(img, frame * 64, 0, 64, 64, R(CX - 32), R(CY - 36 - 6 * k), 64, 64);
      g.restore();
    }
  }

  // the sweep: Baba Smoke with his little broom, and the heap of grey sand that is left
  if (phase >= 6) {
    const heap = sweep;
    g.fillStyle = '#8A8278'; g.beginPath(); g.ellipse(CX, CY + RO + 2, 4 + 14 * heap, 2 + 5 * heap, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#A09888'; g.beginPath(); g.ellipse(CX - 2, CY + RO, 2 + 8 * heap, 1 + 3 * heap, 0, 0, Math.PI * 2); g.fill();
    const bx = R(CX + Math.cos(t * 3) * 30 * (1 - heap)), by = R(CY + 10 + 20 * heap);
    g.strokeStyle = '#8E6634'; g.lineWidth = 2; g.beginPath(); g.moveTo(bx + 18, by - 22); g.lineTo(bx, by); g.stroke();
    g.fillStyle = '#C9A45A'; g.fillRect(bx - 5, by - 1, 10, 4);
    const img = game.images['portrait:baba'];
    if (img) {
      const k = still ? 1 : Math.min(1, pt * 1.8);
      g.save(); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, 48, 48, R(-90 + 96 * k), VIEW - 96, 96, 96); g.restore();
    }
  }
}

/** a colour part of the way to another (both #RRGGBB) */
function mix(a, b, k) {
  const p = (c, i) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => R(lerp(p(a, i), p(b, i), k)).toString(16).padStart(2, '0')).join('')}`;
}
