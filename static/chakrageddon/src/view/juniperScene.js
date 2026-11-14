// Meeting Juniper (the first time only): a full-screen scene behind the dialogue. Her tent at the Flea Market by
// candlelight, a velvet cloth, palo santo smoke. She riffles an enormous tarot deck in a bridge over the table, then
// turns one card face up: the Sun, the Moon or the Star, a different one each time round. She talks while her line
// types out, and blinks. With reduced motion she holds still over one card, face up.
import { W, H } from './CanvasRenderer.js';

const VIEW = H - 53;                                 // the dialogue box covers the rest
const R = Math.round;
const CYCLE = 3.2, RIFFLE = 1.4, FLIP = 0.4;
const VELVET = '#2A1040', VELVET_DK = '#1A0B2E', GOLD = '#E8B04A', CARD = '#FFF4E4', BACK = '#5A2A8A';

/** a card: face down (the purple back with a gold eye) or face up with one of three arcana; w can shrink for the flip */
function card(g, cx, y, w, h, faceUp, arcana) {
  if (w < 1) return;
  const x = R(cx - w / 2);
  g.fillStyle = '#14081E'; g.fillRect(x - 1, y - 1, R(w) + 2, h + 2);
  g.fillStyle = faceUp ? CARD : BACK; g.fillRect(x, y, R(w), h);
  if (w < 6) return;
  const mx = R(cx), my = y + R(h / 2);
  if (!faceUp) {
    g.fillStyle = GOLD; g.fillRect(x + 1, y + 1, R(w) - 2, 1); g.fillRect(x + 1, y + h - 2, R(w) - 2, 1);
    g.fillRect(mx - 3, my, 7, 1); g.fillRect(mx - 2, my - 1, 5, 3); g.fillStyle = BACK; g.fillRect(mx, my, 1, 1);
    return;
  }
  g.fillStyle = GOLD; g.fillRect(x + 1, y + 1, R(w) - 2, 1); g.fillRect(x + 1, y + h - 2, R(w) - 2, 1);
  if (arcana === 0) {          // the Sun
    g.fillStyle = '#FFB23F'; g.beginPath(); g.arc(mx, my - 2, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#FFE066'; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.fillRect(R(mx + Math.cos(a) * 8), R(my - 2 + Math.sin(a) * 8), 1, 1); }
  } else if (arcana === 1) {   // the Moon
    g.fillStyle = '#9A8AB8'; g.beginPath(); g.arc(mx, my - 2, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = CARD; g.beginPath(); g.arc(mx + 3, my - 4, 5, 0, Math.PI * 2); g.fill();
  } else {                     // the Star
    g.fillStyle = '#3FD8E8';
    g.fillRect(mx, my - 9, 1, 15); g.fillRect(mx - 7, my - 2, 15, 1); g.fillRect(mx - 2, my - 4, 5, 5);
  }
  g.fillStyle = '#8A6238'; g.fillRect(mx - 4, y + h - 5, 9, 1);   // a title line
}

function candle(g, x, y, t, still) {
  g.fillStyle = '#F4F0E8'; g.fillRect(x, y, 3, 8);
  const f = still ? 0 : Math.sin(t * 13 + x) > 0.3 ? 1 : 0;
  g.fillStyle = '#FFB23F'; g.fillRect(x, y - 3 - f, 3, 3); g.fillStyle = '#FFF6C8'; g.fillRect(x + 1, y - 2 - f, 1, 2);
  g.fillStyle = 'rgba(255,178,63,0.10)'; g.beginPath(); g.arc(x + 1, y - 2, 14, 0, Math.PI * 2); g.fill();
}

export function drawJuniper(game, g, t0) {
  const still = !!game.settings.reducedMotion, t = still ? RIFFLE + FLIP + 0.5 : t0;
  // the tent: dark velvet hangings in folds, a string of fairy lights along the top
  g.fillStyle = VELVET_DK; g.fillRect(0, 0, W, VIEW);
  for (let x = 0; x < W; x += 20) { g.fillStyle = VELVET; g.fillRect(x, 0, 10, VIEW); }
  for (let i = 0; i < 20; i++) {
    const x = 8 + i * 16, y = 6 + R(Math.sin(i * 0.8) * 2) + (i % 2);
    g.fillStyle = still || Math.sin(t * 3 + i) > -0.4 ? ['#FFE066', '#FF8FB8', '#3FD8E8'][i % 3] : '#4A2A6A'; g.fillRect(x, y, 2, 2);
  }
  // palo santo smoke curling up from a stick on the right
  if (!still) for (let i = 0; i < 8; i++) {
    const k = (t * 0.25 + i / 8) % 1;
    g.fillStyle = `rgba(220,210,230,${0.18 * (1 - k)})`;
    g.beginPath(); g.arc(R(262 + Math.sin(k * 7 + i) * 6), R(86 - k * 70), 2 + k * 6, 0, Math.PI * 2); g.fill();
  }
  // Juniper, at double size behind the table; she talks while her line types out and blinks now and then
  const img = game.images['portrait:tarot'];
  if (img) {
    const dv = game.dialogue, typing = dv && dv.pages?.length && dv.shown < (dv.pages[dv.page] || []).join('').length && game.engine.state.dialogue?.speaker;
    const frame = !still && typing && Math.floor(t0 * 8) % 2 ? 2 : !still && (t0 % 3.1) < 0.13 ? 1 : 0;
    g.save(); g.imageSmoothingEnabled = false; g.drawImage(img, frame * 48, 0, 48, 48, W / 2 - 48, 6, 96, 96); g.restore();
  }
  // the table: velvet with a gold fringe, two candles and the stick of palo santo
  g.fillStyle = VELVET; g.fillRect(0, 84, W, VIEW - 84); g.fillStyle = '#3A1A5A'; g.fillRect(0, 84, W, 2);
  g.fillStyle = GOLD; for (let x = 2; x < W; x += 4) g.fillRect(x, VIEW - 3, 2, 3);
  candle(g, 62, 92, t, still); candle(g, 252, 94, t, still);
  g.fillStyle = '#8A6238'; g.fillRect(256, 88, 12, 2); g.fillStyle = '#FF6A2A'; g.fillRect(267, 88, 1, 1);

  // the deck: riffled in a bridge from her left hand to her right, then one card dealt and turned face up
  const n = Math.floor(t / CYCLE), ph = still ? t : t % CYCLE, arcana = n % 3;
  const lx = W / 2 - 34, rx = W / 2 + 34, y0 = 92;
  if (ph < RIFFLE) {
    const k = ph / RIFFLE;
    g.fillStyle = BACK;
    for (let i = 0; i < 18; i++) {
      const c = Math.min(1, Math.max(0, k * 1.3 - i / 18 * 0.3)), a = Math.PI * c;
      const x = R(lx + (rx - lx) * c), y = R(y0 - Math.sin(a) * 18);
      card(g, x, y, 10, 14, false);
    }
  } else {
    card(g, lx, y0, 12, 16, false); card(g, rx, y0, 12, 16, false);                     // the two halves, squared up
    const k = Math.min(1, (ph - RIFFLE) / FLIP), w = 20 * Math.abs(Math.cos(Math.PI * k));
    card(g, W / 2, y0 + 2, w, 26, k > 0.5, arcana);
    if (k >= 1 && !still) {                                                         // it glints
      const gl = (ph - RIFFLE - FLIP) % 1;
      if (gl < 0.3) { g.fillStyle = '#FFFFFF'; g.fillRect(R(W / 2 - 8 + gl * 50), y0 + 4, 1, 1); }
    }
  }
}
