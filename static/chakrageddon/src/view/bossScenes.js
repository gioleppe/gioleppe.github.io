// Boss cutscenes (CUTSCENES.md): one full-screen pixel scene per boss, the Four-on-the-Floor, the rival's last stand
// and the VIP Shaman Council, behind the dialogue box. Three beats each: 1. the character in their setting doing the
// thing that defines them; 2. the title card (who, and a one-line epithet) at CARD_AT; 3. a closing gesture at BEAT3.
// A rematch (or a retry after a whiteout) shows only the short card: `card`. With reduced motion every scene holds
// its last key frame; grounded mode (and reduced motion) keeps effects calm: no strobing, no big moves.
import { W, H } from './CanvasRenderer.js';
import { drawText, textWidth } from './font.js';

const VIEW = H - 53;                                   // the dialogue box covers the rest
const CARD_AT = 1.4, BEAT3 = 2.6;
const R = Math.round, clamp01 = (k) => Math.max(0, Math.min(1, k)), lerp = (a, b, k) => a + (b - a) * k;
const ease = (k) => 1 - (1 - clamp01(k)) ** 3;
const PX = 214, PY = VIEW - 96;                        // where a 2x portrait stands, bottom right
const INK = '#14101E';

export const BOSSES = {
  diabolo:   { tag: 'BOSS 1', name: 'DJ DIABOLO', line: 'Nineteen hours. No breaks.', accent: '#3FD8E8', sprite: 'dj', mood: 'BOSS', draw: diabolo },
  svetlana:  { tag: 'BOSS 2', name: 'GURU SVETLANA', line: 'Ask the wristband what it wants.', accent: '#C86BFF', sprite: 'guru', mood: 'BOSS', draw: svetlana },
  keta:      { tag: 'BOSS 3', name: 'CAPTAIN KETA', line: 'I am the ditch.', accent: '#7FB8E0', sprite: 'captain', mood: 'BOSS', draw: keta },
  raju:      { tag: 'BOSS 4', name: 'CHEF RAJU', line: 'I cook while we fight.', accent: '#FFD23F', sprite: 'chef', mood: 'BOSS', draw: raju },
  darkpsy:   { tag: 'BOSS 5', name: 'BARON VON DARKPSY', line: 'Each beat, a small ending.', accent: '#4FE88A', sprite: 'baron', mood: 'BAD_TRIP', draw: darkpsy },
  baksheesh: { tag: 'TEAM UNDERCOVER', name: 'SGT BAKSHEESH', line: 'I had a permit. I wrote it myself.', accent: '#FFD23F', sprite: 'sergeant', mood: 'BOSS', draw: baksheesh },
  chloe:     { tag: 'BOSS 6', name: 'INFLUENCER CHLOE', line: 'Smash that like button.', accent: '#FF4FA8', sprite: 'influencer', mood: 'BOSS', draw: chloe },
  baba:      { tag: 'BOSS 7', name: 'BABA SMOKE', line: '...', accent: '#E8D8C8', sprite: 'baba', mood: 'BOSS', draw: baba, ownCard: true },
  promoter:  { tag: 'BOSS 8', name: 'THE PROMOTER', line: 'I always win negotiations.', accent: '#FFD23F', sprite: 'promoter', mood: 'BOSS', draw: promoter },
  kalyani:   { tag: 'THE FOUR', name: 'KICK KALYANI', line: 'I land on every beat.', accent: '#E0303C', sprite: 'kalyani', mood: 'FOUR_1', draw: kalyani, cardAt: 4 * 60 / 140, cardIn: 0.12 },
  boris:     { tag: 'THE FOUR', name: 'BASSLINE BORIS', line: 'Try to stand up straight.', accent: '#7C8CD9', sprite: 'boris', mood: 'FOUR_2', draw: boris, cardWave: true },
  hana:      { tag: 'THE FOUR', name: 'HI-HAT HANA', line: 'Fast-fast-fast!', accent: '#3FD8E8', sprite: 'hana', mood: 'FOUR_3', draw: hana, cardStamp: true },
  lakshmi:   { tag: 'THE FOUR', name: 'LEAD LAKSHMI', line: "The melody you'll hum at eighty.", accent: '#FFD23F', sprite: 'lakshmi', mood: 'FOUR_4', draw: lakshmi },
  chad:      { tag: 'YOUR RIVAL', name: 'ASTRA-ZERO', line: 'The very well dressed ego.', accent: '#FF8FB8', sprite: 'chad', mood: 'BOSS', draw: chad },
  council:   { tag: 'THE TOP OF THE TEMPLE', name: 'VIP SHAMAN COUNCIL', line: 'Time is not our department.', accent: '#3FD8E8', sprite: 'council_elder', mood: 'CHAI_TENT_WARMTH', draw: council },
};
export const BOSS_IDS = Object.keys(BOSSES);

/** draw a boss scene at t seconds; card: the short title card only (a rematch or a retry) */
export function drawBoss(game, g, who, t0, card = false) {
  const b = BOSSES[who];
  if (!b) return;
  const still = !!game.settings.reducedMotion, calm = still || !!game.settings.grounded;
  const t = still ? 3.4 : t0;
  const c = { game, t, still, calm, b, talk: talking(game) };
  g.save(); g.imageSmoothingEnabled = false;
  g.fillStyle = '#0B0314'; g.fillRect(0, 0, W, H);                                    // the whole screen, under the box too
  if (card) cardOnly(g, c); else b.draw(g, c);
  g.restore();
  if (card || !b.ownCard) titleCard(g, b, card ? Math.max(t0, (b.cardAt ?? CARD_AT) + 1) : t, still);
  if (t0 < 0.4) { g.globalAlpha = 1 - t0 / 0.4; g.fillStyle = '#0B0314'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
}

// ---------------------------------------------------------------- shared pieces

function talking(game) {
  const dv = game.dialogue;
  return !!(dv && dv.pages?.length && dv.shown < (dv.pages[dv.page] || []).join('').length && game.engine?.state.dialogue?.speaker);
}

/** the title card: a band that slides in from the left, with the tag, the name (double size when it fits) and the epithet */
function titleCard(g, b, t, still) {
  const at = b.cardAt ?? CARD_AT;
  if (t < at) return;
  const big = textWidth(b.name) * 2 <= 196, nameW = textWidth(b.name) * (big ? 2 : 1);
  const w = Math.min(W - 8, Math.max(nameW, textWidth(b.line), textWidth(b.tag)) + 18);
  const k = still || b.cardStamp ? 1 : ease((t - at) / (b.cardIn ?? 0.35));
  let x = R(-w - 4 + (w + 4) * k), y = 6;
  if (b.cardWave && !still) y += R(Math.sin((t - at) * 5) * 4 * Math.max(0, 1 - (t - at) / 1.6));   // it rides in on the swell
  const parts = b.cardStamp && !still ? Math.min(3, 1 + Math.floor((t - at) / 0.14)) : 3;               // three quick stamps
  g.fillStyle = 'rgba(11,3,20,0.88)'; g.fillRect(x, y, w, 40);
  g.fillStyle = b.accent; g.fillRect(x, y + 38, w, 2); g.fillRect(x + w - 2, y, 2, 40);
  drawText(g, b.tag, x + 8, y + 4, { color: b.accent });
  if (parts >= 2) {
    g.save(); g.translate(x + 8, y + (big ? 13 : 16)); if (big) g.scale(2, 2);
    drawText(g, b.name, 0, 0, { color: '#F4F0E8', shadow: '#3A1A5A' }); g.restore();
  }
  if (parts >= 3) drawText(g, b.line, x + 8, y + 29, { color: '#E8D8F4' });
}

/** the short card for a rematch: their colour, their portrait, the card */
function cardOnly(g, c) {
  const { b } = c;
  sky(g, '#0B0314', '#2A1250', H);
  for (let i = 0; i < 9; i++) { g.fillStyle = b.accent + '22'; g.fillRect(i * 40 - R((c.t * 30) % 40), 0, 18, H); }
  portrait(g, c, b.sprite, PX, PY);
}

function sky(g, top, bottom, h = VIEW) { const s = g.createLinearGradient(0, 0, 0, h); s.addColorStop(0, top); s.addColorStop(1, bottom); g.fillStyle = s; g.fillRect(0, 0, W, h); }
function stars(g, t, still, n = 30, yMax = 80) {
  for (let i = 0; i < n; i++) { if (!still && Math.sin(t * 2.2 + i * 1.7) < -0.6) continue; g.fillStyle = i % 4 ? '#8C7A9A' : '#F4F0E8'; g.fillRect((i * 73) % W, (i * 37) % yMax, 1, 1); }
}
/** a 2x portrait (48 px art): blinks, talks while a line types out; sx/sy squash it (a turn, a flip) */
function portrait(g, c, sprite, x, y, s = 2, o = {}) {
  const img = c.game.images[`portrait:${sprite}`];
  if (!img) return;
  const f = o.frame ?? (c.talk && Math.floor(c.t * 8) % 2 ? 2 : !c.still && (c.t % 3.3) < 0.13 ? 1 : 0);
  const sx = o.sx ?? 1, sy = o.sy ?? 1, half = 24 * s;
  if (Math.abs(sx) < 0.04 || Math.abs(sy) < 0.04) return;
  g.save(); g.translate(R(x + half), R(y + half)); g.scale(sx, sy);
  if (o.alpha !== undefined) g.globalAlpha = o.alpha;
  g.drawImage(img, f * 48, 0, 48, 48, -half, -half, 48 * s, 48 * s);
  g.restore();
}
/** a portrait as a flat silhouette (seen from behind, or against the light); needs a DOM canvas, else a dark veil */
const silCache = new Map();
function silhouette(g, c, sprite, x, y, col, s = 2) {
  const img = c.game.images[`portrait:${sprite}`];
  if (!img) return;
  const key = `${sprite}|${col}`;
  let cv = silCache.get(key);
  if (!cv && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    cv = document.createElement('canvas'); cv.width = 48; cv.height = 48;
    const x2 = cv.getContext('2d'); x2.drawImage(img, 0, 0, 48, 48, 0, 0, 48, 48); x2.globalCompositeOperation = 'source-in'; x2.fillStyle = col; x2.fillRect(0, 0, 48, 48);
    silCache.set(key, cv);
  }
  if (cv) g.drawImage(cv, 0, 0, 48, 48, R(x), R(y), 48 * s, 48 * s);
  else { portrait(g, c, sprite, x, y, s, { frame: 1 }); g.fillStyle = 'rgba(11,3,20,0.85)'; g.fillRect(R(x), R(y), 48 * s, 48 * s); }
}
/** a 64 px Astral frame, bottom-centre at x, y */
function mon(g, c, id, frame, x, y, s = 1, flip = false, alpha = 1) {
  const img = c.game.images[`mon:${id}`];
  if (!img) return;
  g.save(); g.translate(R(x), R(y)); if (flip) g.scale(-1, 1); g.globalAlpha = alpha;
  g.drawImage(img, frame * 64, 0, 64, 64, R(-32 * s), R(-64 * s), 64 * s, 64 * s);
  g.restore();
}
/** draw in big pixels (art units times s) from an origin */
function pen(g, ox, oy, s) {
  const P = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(R(ox + x * s), R(oy + y * s), R(w * s), R(h * s)); };
  const E = (cx, cy, rx, ry, col) => { for (let y = Math.ceil(-ry); y <= ry; y++) { const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2)) + 0.5); if (half > 0) P(cx - half, cy + y, half * 2, 1, col); } };
  const L = (x0, y0, x1, y1, w, col) => { const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0))); for (let i = 0; i <= n; i++) P(Math.floor(lerp(x0, x1, i / n)), Math.floor(lerp(y0, y1, i / n)), w, w, col); };
  return { P, E, L };
}
function speaker(g, x, y, w, h, pump) {
  g.fillStyle = '#1E1E26'; g.fillRect(x, y, w, h); g.fillStyle = '#34343E'; g.fillRect(x + 1, y + 1, w - 2, h - 2);
  for (const cy of [y + h * 0.3, y + h * 0.72]) { g.fillStyle = '#5A5A68'; g.beginPath(); g.arc(x + w / 2, cy, w * 0.32 + pump, 0, 7); g.fill(); g.fillStyle = INK; g.beginPath(); g.arc(x + w / 2, cy, w * 0.12, 0, 7); g.fill(); }
}
function hand(g, x, y, col = '#C98A5A') { g.fillStyle = col; g.fillRect(R(x) - 3, R(y) - 2, 6, 5); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(R(x) - 3, R(y) + 2, 6, 1); }
function arm(g, x0, y0, x1, y1, col = '#C98A5A', w = 3) { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)); g.fillStyle = col; for (let i = 0; i <= n; i++) g.fillRect(R(lerp(x0, x1, i / n)) - 1, R(lerp(y0, y1, i / n)) - 1, w, w); hand(g, x1, y1, col); }
function note(g, x, y, col) { x = R(x); y = R(y); g.fillStyle = col; g.fillRect(x, y, 1, 6); g.fillRect(x - 2, y + 5, 3, 2); g.fillRect(x + 1, y, 2, 1); g.fillRect(x + 2, y + 1, 1, 1); }
function heart(g, x, y, col) { x = R(x); y = R(y); g.fillStyle = col; g.fillRect(x, y, 2, 2); g.fillRect(x + 3, y, 2, 2); g.fillRect(x - 1, y + 1, 7, 2); g.fillRect(x, y + 3, 5, 1); g.fillRect(x + 1, y + 4, 3, 1); g.fillRect(x + 2, y + 5, 1, 1); }
function sparkle(g, x, y, col, s = 2) { x = R(x); y = R(y); g.fillStyle = col; g.fillRect(x - s, y, s * 2 + 1, 1); g.fillRect(x, y - s, 1, s * 2 + 1); }
function crowd(g, y, t, still, beat) {
  for (let i = 0; i < 12; i++) {
    const x = i * 16 + (i % 2) * 5 - 6, up = still ? 0 : ((beat + i) % 2) * 2, yy = y - up + (i % 3) * 3;
    g.fillStyle = '#0B0314'; g.fillRect(x, yy, 12, VIEW - yy); g.fillRect(x + 3, yy - 7, 7, 7);
    if (i % 3 === 0) { g.fillRect(x + 10, yy - 12 + up, 2, 10); g.fillStyle = ['#4FE88A', '#FF4FA8', '#5FF4FF'][(i / 3) % 3]; g.fillRect(x + 10, yy - 16 + up, 3, 5); }
  }
}
/** a pixel bitmap drawn in puffs ('#' cells), wobbling a little: smoke shapes and smoke letters */
function puffs(g, rows, x, y, s, col, t, alpha = 1) {
  g.globalAlpha = clamp01(alpha); g.fillStyle = col;
  rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === '#') g.fillRect(R(x + i * s + Math.sin(t * 2 + j) * 1), R(y + j * s + Math.cos(t * 1.7 + i) * 1), s, s); }));
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------- 1. DJ Diabolo: the decks, the needle off, the point
function diabolo(g, c) {
  const { t, still, calm } = c, frozen = t >= CARD_AT, beat = frozen || still ? 0 : Math.floor(t * 140 / 60) % 2;
  sky(g, '#0B0314', '#2A1250');
  g.save(); g.globalAlpha = 0.5;
  ['#FF4FA8', '#3FD8E8', '#4FE88A', '#FFE066', '#C86BFF'].forEach((col, i) => {
    const a = (calm || frozen ? 0.4 + i * 0.5 : 0.3 + Math.sin(t * 1.3 + i) * 0.6) + Math.PI / 2;
    g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(160, -4); g.lineTo(160 + Math.cos(a) * 260, -4 + Math.abs(Math.sin(a)) * 180); g.stroke();
  });
  g.restore();
  speaker(g, 8, 70, 30, 57, beat); speaker(g, 172, 66, 30, 61, beat);
  // Glowkid dances on the left stack until the record stops
  mon(g, c, 'glowkid', frozen ? 0 : beat ? 6 : 0, 23, 72 - (beat ? 2 : 0));
  // the dancefloor and the crowd
  for (let x = 40; x < 170; x += 13) { g.fillStyle = (x / 13 + beat) % 2 ? '#2A1240' : '#3A1A5A'; g.fillRect(x, 108, 13, 19); }
  crowd(g, 106, t, still || frozen, beat);
  portrait(g, c, 'dj', PX, PY);
  // the decks in front of him: two turntables and a mixer
  g.fillStyle = '#1E1E26'; g.fillRect(196, 104, 124, 23); g.fillStyle = '#34343E'; g.fillRect(196, 104, 124, 3);
  for (const [px, spin] of [[224, 1], [292, -1]]) {
    g.fillStyle = INK; g.beginPath(); g.ellipse(px, 114, 17, 6, 0, 0, 7); g.fill();
    g.fillStyle = '#5A3A7A'; g.beginPath(); g.ellipse(px, 114, 5, 2, 0, 0, 7); g.fill();
    const a = frozen ? 0.5 : t * 9 * spin; g.fillStyle = '#C8C0D8'; g.fillRect(R(px + Math.cos(a) * 12), R(114 + Math.sin(a) * 4), 2, 1);
  }
  g.fillStyle = '#5A5A68'; g.fillRect(250, 107, 18, 12); g.fillStyle = '#4FE88A'; g.fillRect(253, 109, 2, 2 + beat); g.fillStyle = '#FF4FA8'; g.fillRect(262, 109, 2, 3 - beat);
  if (!frozen) hand(g, 224 + (still ? 0 : Math.sin(t * 12) * 6), 112, '#F2C29A');                    // scratching
  // the needle comes off: a scratch across the screen
  if (!calm && t >= CARD_AT && t < CARD_AT + 0.35) { g.strokeStyle = '#F4F0E8'; g.lineWidth = 1; g.beginPath(); for (let x = 0; x <= W; x += 8) g.lineTo(x, 84 + ((x / 8) % 2 ? -3 : 3)); g.stroke(); }
  if (t >= BEAT3) arm(g, 236, 104, 186, 86, '#F2C29A');                                                 // YOU.
}

// ---------------------------------------------------------------- 2. Guru Svetlana: levitating, one look, "not there"
function svetlana(g, c) {
  const { t, still } = c, open = t >= CARD_AT;
  for (let x = 0; x < W; x += 10) { g.fillStyle = (x / 10) % 2 ? '#C9583C' : '#E2704F'; g.fillRect(x, 0, 10, 98); }
  g.strokeStyle = '#8A3A2A'; for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(160, -30); g.lineTo(i * 40, 98); g.stroke(); }
  // the mandala on the wall, turning until she looks at you
  const rot = open ? CARD_AT * 0.6 : t * 0.6;
  for (let r = 34; r > 0; r -= 6) { g.fillStyle = ['#9A4FE0', '#FF4FA8', '#FFD23F', '#3FD8E8', '#F4F0E8', '#9A4FE0'][(r / 6) % 6 | 0]; g.beginPath(); g.arc(262, 52, r, 0, 7); g.fill(); }
  for (let i = 0; i < 12; i++) { const a = rot + (i / 12) * Math.PI * 2; g.fillStyle = '#FFE066'; g.fillRect(R(262 + Math.cos(a) * 30), R(52 + Math.sin(a) * 30), 2, 2); }
  g.fillStyle = '#7A2A5A'; g.fillRect(0, 98, W, VIEW - 98); g.fillStyle = '#FFD23F'; g.fillRect(0, 100, W, 1); g.fillRect(0, 124, W, 1);
  for (let x = 4; x < W; x += 12) { g.fillStyle = '#C86BFF'; g.fillRect(x, 110, 4, 4); }
  // incense curling up
  g.fillStyle = '#8A5A32'; g.fillRect(40, 96, 1, 14); g.fillStyle = '#FF6A2A'; g.fillRect(40, 95, 1, 1);
  if (!still) for (let i = 0; i < 9; i++) { const k = ((t * 0.25 + i / 9) % 1); g.globalAlpha = 0.6 * (1 - k); g.fillStyle = '#EADDFB'; g.fillRect(R(40 + Math.sin(t * 1.5 + i) * 6 * k * 2), R(94 - k * 70), 2, 2); } g.globalAlpha = 1;
  // candles and the singing bowl
  for (const cx of [150, 196]) { g.fillStyle = '#F4F0E8'; g.fillRect(cx, 110, 3, 8); g.fillStyle = still || Math.sin(t * 9 + cx) > 0 ? '#FFD23F' : '#FF9A2A'; g.fillRect(cx + 1, 107, 1, 3); }
  g.fillStyle = '#C9A227'; g.beginPath(); g.ellipse(176, 120, 8, 3, 0, 0, 7); g.fill();
  // Fractoad, in lotus, also levitating
  const lev = still ? 4 : 4 + Math.sin(t * 2) * 2;
  mon(g, c, 'fractoad', 0, 100, 122 - lev);
  g.fillStyle = 'rgba(11,3,20,0.3)'; g.beginPath(); g.ellipse(262, 124, 30, 3, 0, 0, 7); g.fill();
  portrait(g, c, 'guru', PX, PY - lev, 2, open ? {} : { frame: 1 });                                     // eyes shut, then open
  if (t >= BEAT3) { const k = t - BEAT3, x = k < 1.2 ? 200 : 200 - (k - 1.2) * 30; hand(g, Math.max(180, x), 118 - (k < 1.2 && !still ? Math.abs(Math.sin(k * 8)) * 3 : 0), '#F7D0B0'); }
}

// ---------------------------------------------------------------- 3. Captain Keta: the ditch, the flip, the wrong salute
function keta(g, c) {
  const { t, still, calm } = c, dy = calm ? 0 : R(Math.sin(t * 1.2) * 2);
  sky(g, '#2A3A6A', '#C86B6B', 90);
  g.save(); g.translate(0, dy);
  g.fillStyle = '#2A5A6A'; g.fillRect(0, 84, W, VIEW + 4 - 84);
  for (let i = 0; i < 12; i++) { g.fillStyle = '#4A8A9A'; g.fillRect((i * 31 + R(t * 6)) % W, 90 + (i % 4) * 9, 10, 1); }
  for (const [x, y] of [[30, 96], [90, 104], [140, 92]]) { g.fillStyle = '#E0303C'; g.fillRect(x, y, 14, 5); g.fillStyle = '#3A3A46'; g.fillRect(x + 11, y - 6, 2, 6); g.fillRect(x + 8, y - 6, 8, 1); g.fillStyle = '#2A5A6A'; g.fillRect(x - 2, y + 4, 18, 3); }
  // his "bridge": a platform, and a steering wheel nailed to a pole
  g.fillStyle = '#8A5A32'; g.fillRect(196, 100, 124, 10); g.fillStyle = '#6A4426'; for (let x = 196; x < W; x += 12) g.fillRect(x, 100, 1, 10);
  g.fillStyle = '#6A4426'; g.fillRect(203, 96, 2, 18);
  const wa = still ? 0 : t * 0.8;
  g.strokeStyle = '#8A5A32'; g.lineWidth = 2; g.beginPath(); g.arc(204, 92, 9, 0, 7); g.stroke();
  for (let i = 0; i < 4; i++) { const a = wa + i * Math.PI / 4; g.fillStyle = '#C99A5A'; g.fillRect(R(204 + Math.cos(a) * 7), R(92 + Math.sin(a) * 7), 2, 2); }
  // upside down for a moment, then back
  const k = t - CARD_AT, sy = calm || k < 0 || k > 2 ? 1 : Math.cos(k * Math.PI);
  portrait(g, c, 'captain', PX, PY - 4, 2, { sy });
  mon(g, c, 'ketacrab', t >= BEAT3 ? 6 : 0, 70, 124, 1, true);
  g.restore();
  if (t >= BEAT3 && sy > 0.9) hand(g, 296, 52 + dy, '#E0A878');                                         // a salute, the wrong way
}

// ---------------------------------------------------------------- 4. Chef Raju (full body): eggs, the flip, the spatula
function raju(g, c) {
  const { t, still } = c;
  sky(g, '#2A1A4A', '#F2A766', 96);
  g.fillStyle = '#E8C39E'; g.fillRect(0, 96, W, VIEW - 96);
  // the queue: sleepy ravers, swaying
  for (let i = 0; i < 4; i++) {
    const x = 16 + i * 26, sway = still ? 0 : Math.sin(t * 1.4 + i) * 1.5;
    g.fillStyle = ['#2A1A3E', '#3A2A5A', '#2A1A3E', '#3A2A5A'][i]; g.fillRect(R(x + sway), 76, 14, 40); g.fillStyle = '#8D5A3A'; g.fillRect(R(x + 3 + sway), 66, 9, 10);
  }
  g.fillStyle = '#F4F0E8'; g.fillRect(36, 84, 14, 3);                                                   // the first one holds out a plate
  // Raju behind the counter, from the waist up, in big pixels: a puffed chef's hat, a stern face, a neckerchief
  const SK = '#8D5A3A', s = 3, ox = 206, oy = 2, { P, E } = pen(g, ox, oy, s);
  E(17, 4, 9, 4, '#FFFFFF'); E(11, 5, 4, 3, '#F4F4FA'); E(23, 5, 4, 3, '#F4F4FA'); P(9, 7, 16, 4, '#F0F0F6'); P(9, 10, 16, 1, '#D0D0DC');
  P(10, 14, 2, 3, SK); P(23, 14, 2, 3, SK); E(17, 15, 7, 6.5, SK);
  P(12, 11, 4, 1, '#2A2A32'); P(18, 11, 4, 1, '#2A2A32');                                                    // stern brows
  P(13, 13, 2, 2, '#FFFFFF'); P(14, 13, 1, 2, INK); P(19, 13, 2, 2, '#FFFFFF'); P(19, 13, 1, 2, INK);
  P(16, 15, 2, 3, '#7A4A2A');                                                                               // nose
  P(13, 18, 8, 2, '#2A2A32'); E(17, 21, 6, 3, '#2A2A32');                                                   // moustache, beard
  P(15, 23, 4, 2, SK); P(12, 24, 10, 2, '#E0303C'); P(16, 26, 2, 2, '#C8203A');                             // neckerchief
  P(5, 25, 24, 10, '#FFFFFF'); P(5, 25, 2, 10, '#E0E0EA');                                                   // the jacket
  for (const by of [27, 30, 33]) { P(13, by, 1, 1, '#B8B8C4'); P(20, by, 1, 1, '#B8B8C4'); }
  // the counter and the griddle
  g.fillStyle = '#8E939C'; g.fillRect(150, 96, 170, 31); g.fillStyle = '#3A3A46'; g.fillRect(156, 90, 150, 7);
  if (!still) { g.globalAlpha = 0.35; g.fillStyle = '#FFFFFF'; for (let i = 0; i < 5; i++) { const k = (t * 0.6 + i / 5) % 1; g.fillRect(R(170 + i * 26 + Math.sin(t + i) * 3), R(88 - k * 26), 2, 2); } g.globalAlpha = 1; }
  // eggs cracked four at a time
  const eggs = still ? 4 : Math.min(4, Math.floor(t / 0.3));
  for (let i = 0; i < eggs; i++) { g.fillStyle = '#FFFFFF'; g.beginPath(); g.ellipse(176 + i * 22, 92, 7, 2.5, 0, 0, 7); g.fill(); g.fillStyle = '#FFD23F'; g.fillRect(175 + i * 22, 91, 3, 2); }
  // arms: the left one cracks eggs over the griddle, the right one holds the spatula (and points it at you at the end)
  const crackX = t < 1.0 && !still ? 180 + (Math.floor(t / 0.3) % 4) * 22 : 200, crackY = t < 1.0 && !still ? 80 - Math.abs(Math.sin(t * 10)) * 4 : 86;
  arm(g, 216, 82, crackX, crackY, SK, 4);
  if (t < BEAT3) { arm(g, 290, 82, 296, 88, SK, 4); g.fillStyle = '#8E939C'; g.fillRect(292, 74, 12, 8); g.fillStyle = '#6A4426'; g.fillRect(297, 82, 3, 6); }
  const fk = (t - 1.0) / 0.6;
  if (fk > 0 && fk < 1 && !still) { g.fillStyle = '#FFD23F'; g.beginPath(); g.ellipse(R(lerp(200, 43, fk)), R(lerp(86, 82, fk) - Math.sin(fk * Math.PI) * 50), 8, 3, fk * 9, 0, 7); g.fill(); }
  if (fk >= 1 || still) { g.fillStyle = '#FFD23F'; g.beginPath(); g.ellipse(43, 82, 7, 2.5, 0, 0, 7); g.fill(); }  // landed on the plate
  if (t >= BEAT3) { arm(g, 290, 82, 236, 64, SK, 4); g.fillStyle = '#6A4426'; g.fillRect(212, 63, 22, 3); g.fillStyle = '#8E939C'; g.fillRect(196, 58, 16, 12); g.fillStyle = '#B8BCC4'; g.fillRect(197, 59, 14, 1); }
  mon(g, c, 'omeletron', 0, 300, 98, 0.5);
}

// ---------------------------------------------------------------- 5. Baron Von Darkpsy: from behind, the turn, a petal
function darkpsy(g, c) {
  const { t, still, calm } = c, turned = t >= CARD_AT;
  sky(g, '#07040E', '#1A0B2E');
  g.fillStyle = '#C8C0D8'; g.beginPath(); g.arc(70, 30, 12, 0, 7); g.fill();
  g.fillStyle = '#1A0B2E'; g.fillRect(50, 28, 44, 5); g.fillRect(58, 36, 36, 4);                        // clouds over the moon
  for (const [x, h] of [[20, 90], [150, 70], [190, 96]]) { g.fillStyle = '#05030A'; g.fillRect(x, VIEW - h, 4, h); g.fillRect(x - 10, VIEW - h + 12, 12, 2); g.fillRect(x + 3, VIEW - h + 24, 14, 2); g.fillRect(x - 6, VIEW - h + 40, 8, 2); }
  speaker(g, 196, 70, 22, 57, 0); g.fillStyle = '#E8E0D4'; g.fillRect(204, 74, 6, 5); g.fillStyle = INK; g.fillRect(205, 75, 1, 2); g.fillRect(208, 75, 1, 2);
  // fog drifting
  g.save(); g.globalAlpha = 0.18; g.fillStyle = '#C86BFF'; for (let i = 0; i < 4; i++) g.fillRect(R(((still ? 0 : t * 8) + i * 90) % (W + 80)) - 80, 104 + i * 5, 90, 4); g.restore();
  // bats
  if (!still) for (let i = 0; i < 4; i++) { const a = t * 1.4 + i * 1.6, x = R(130 + Math.cos(a) * 60), y = R(40 + Math.sin(a * 1.3) * 18), f = Math.floor(t * 8 + i) % 2; g.fillStyle = INK; g.fillRect(x - 3, y - f, 3, 1); g.fillRect(x + 1, y - f, 3, 1); g.fillRect(x, y, 1, 1); }
  // Omnihound, a shadow with eyes
  mon(g, c, 'omnihound', 0, 120, 124, 1, false, 0.55); g.fillStyle = '#4FE88A'; g.fillRect(111, 87, 2, 1); g.fillRect(126, 87, 2, 1);
  // the Baron: from behind (a silhouette conducting the fog), then the slow turn and the green eyes
  const k = (t - CARD_AT) / 0.5, sx = turned && k < 1 && !calm ? Math.cos(k * Math.PI) : 1;
  if (!turned) { silhouette(g, c, 'baron', PX, PY, '#0B0614'); if (!still) arm(g, 246, 96, 236 + Math.sin(t * 2) * 16, 70 + Math.cos(t * 2) * 8, '#D8D8E0', 2); }
  else if (sx < 0) silhouette(g, c, 'baron', PX, PY, '#0B0614');
  else {
    portrait(g, c, 'baron', PX, PY, 2, { sx });
    g.fillStyle = 'rgba(7,4,14,0.55)'; g.fillRect(0, 0, W, VIEW);                                        // only his eyes keep their colour
    g.fillStyle = '#4FE88A'; g.fillRect(PX + 32, PY + 40, 8, 4); g.fillRect(PX + 56, PY + 40, 8, 4);
  }
  if (t >= BEAT3 && !still) { const k3 = t - BEAT3; g.fillStyle = '#05030A'; g.fillRect(R(250 + Math.sin(k3 * 3) * 8), R(30 + k3 * 20), 3, 2); }
}

// ---------------------------------------------------------------- 6. Sergeant Baksheesh: stamps, a bottle, the permit
function baksheesh(g, c) {
  const { t, still } = c;
  sky(g, '#FF8A5A', '#FFC08A', 86);
  g.fillStyle = '#3F96B0'; g.fillRect(0, 80, W, 14); g.fillStyle = '#C8603A'; g.fillRect(0, 94, W, VIEW - 94);
  // the checkpoint: a cordon, a crate of bottled dopamine
  for (const x of [12, 112]) { g.fillStyle = '#FFD23F'; g.fillRect(x, 82, 3, 24); }
  for (let x = 15; x < 112; x += 8) { g.fillStyle = (x / 8) % 2 ? '#E0303C' : '#FFD23F'; g.fillRect(x, 88, 8, 3); }
  g.fillStyle = '#A87644'; g.fillRect(124, 104, 40, 20);
  for (let i = 0; i < 4; i++) { g.fillStyle = '#4FE88A'; g.fillRect(128 + i * 9, 96, 5, 9); g.fillStyle = '#C8FFE0'; g.fillRect(129 + i * 9, 97, 1, 4); }
  mon(g, c, 'shadowcop', 0, 60, 124);
  portrait(g, c, 'sergeant', PX, PY);
  // the desk, the papers and the stamp
  g.fillStyle = '#7E5632'; g.fillRect(196, 102, 124, 25); g.fillStyle = '#A87644'; g.fillRect(196, 102, 124, 3);
  for (let i = 0; i < 4; i++) { g.fillStyle = '#F4F0E8'; g.fillRect(204 + i * 26, 104, 20, 14); }
  const stamps = still ? 4 : Math.min(4, Math.floor(t * 3));
  for (let i = 0; i < stamps; i++) { g.fillStyle = '#E0303C'; g.fillRect(208 + i * 26, 108, 10, 5); }
  if (t < CARD_AT && !still) { const sx = 212 + Math.min(3, Math.floor(t * 3)) * 26, up = Math.abs(Math.sin(t * Math.PI * 3)) * 10; g.fillStyle = '#5A5A68'; g.fillRect(sx, 90 - up, 4, 10); g.fillStyle = '#E0303C'; g.fillRect(sx - 3, 99 - up, 10, 4); }
  const nk = (t - 0.6) / 0.6;
  if (nk > 0 && nk < 1 && !still) { g.fillStyle = '#4FA85A'; g.fillRect(R(lerp(290, 304, nk)), R(lerp(104, 80, nk)), 10, 5); }  // into the pocket
  if (t >= CARD_AT && t < BEAT3) { const y = R(lerp(104, 64, ease((t - CARD_AT) / 0.5))); g.fillStyle = 'rgba(79,232,138,0.3)'; g.beginPath(); g.arc(292, y + 6, 10, 0, 7); g.fill(); g.fillStyle = '#4FE88A'; g.fillRect(288, y, 8, 14); g.fillStyle = '#C8FFE0'; g.fillRect(290, y + 2, 1, 8); g.fillStyle = '#3A3A46'; g.fillRect(290, y - 3, 4, 3); }
  if (t >= BEAT3) { g.fillStyle = '#F4F0E8'; g.fillRect(206, 64, 54, 34); g.fillStyle = '#C8C0B0'; g.fillRect(206, 96, 54, 2); drawText(g, 'PERMIT', 213, 68, { color: INK }); drawText(g, 'YES', 222, 82, { color: '#E0303C' }); }
}

// ---------------------------------------------------------------- 7. Influencer Chloe (full body): live, a "?", the phone at you
function chloe(g, c) {
  const { t, still, calm } = c, stopped = t >= CARD_AT && t < BEAT3;
  sky(g, '#FF8FB8', '#FFB347', 84);
  g.fillStyle = '#FFE066'; g.beginPath(); g.arc(250, 84, 30, Math.PI, 0); g.fill(); g.fillStyle = '#FFF0A0'; g.beginPath(); g.arc(250, 84, 20, Math.PI, 0); g.fill();
  g.fillStyle = '#3F6B8A'; g.fillRect(0, 84, W, VIEW - 84);
  for (let i = 0; i < 6; i++) { g.fillStyle = '#FFD23F'; g.fillRect(250 - 24 + i * 2 + (i % 2) * 6, 88 + i * 6, 48 - i * 8, 2); }
  // her private sunset: a velvet rope, a ring light
  for (const x of [104, 176]) { g.fillStyle = '#C9A227'; g.fillRect(x, 96, 3, 26); }
  g.strokeStyle = '#C8203A'; g.lineWidth = 2; g.beginPath(); g.moveTo(106, 100); g.quadraticCurveTo(141, 114, 177, 100); g.stroke();
  g.strokeStyle = '#FFF6C8'; g.lineWidth = 3; g.beginPath(); g.arc(34, 52, 14, 0, 7); g.stroke(); g.fillStyle = '#3A3A46'; g.fillRect(33, 66, 2, 56);
  mon(g, c, 'selfiend', 0, 76, 124);
  // Chloe, full figure, phone up for a selfie (or at you, at the end)
  const s = 2, ox = 226, oy = 20, { P, E } = pen(g, ox, oy, s);
  E(14, 12, 8, 9, '#FFD23F'); P(6, 12, 16, 22, '#FFD23F');                                                // long blonde hair behind
  E(14, 12, 6, 6, '#F7D0B0'); P(9, 10, 10, 3, '#FF4FA8'); P(10, 11, 3, 1, INK); P(15, 11, 3, 1, INK);     // face, pink shades
  P(12, 16, 4, 1, '#C8503A');
  P(8, 19, 12, 13, '#FF8FB8'); P(8, 31, 12, 9, '#FFFFFF'); P(10, 40, 3, 10, '#F7D0B0'); P(15, 40, 3, 10, '#F7D0B0');
  const atYou = t >= BEAT3;
  if (!atYou) { P(19, 10, 3, 11, '#F7D0B0'); P(19, 4, 6, 9, INK); P(20, 5, 4, 6, '#5FF4FF'); }           // selfie arm
  else { P(19, 20, 3, 6, '#F7D0B0'); }
  // what her phone sees: the recording frame, REC, the live likes, hearts
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1; g.strokeRect(4.5, 4.5, W - 9, VIEW - 9);
  if (still || Math.floor(t * 2) % 2) { g.fillStyle = '#E0303C'; g.fillRect(10, 112, 4, 4); }
  drawText(g, 'REC', 17, 111, { color: '#F4F0E8', shadow: INK });
  const likes = 12480 + R((stopped ? CARD_AT : t) * 137);
  drawText(g, `${likes.toLocaleString('en')} likes`, 210, 111, { color: '#F4F0E8', shadow: INK });
  if (!stopped && !calm) for (let i = 0; i < 6; i++) { const k = (t * 0.5 + i / 6) % 1; heart(g, 296 + Math.sin(t * 2 + i) * 5, 104 - k * 80, ['#FF4FA8', '#FF8FB8', '#E0303C'][i % 3]); }
  if (stopped) { g.fillStyle = '#FFFFFF'; g.fillRect(270, 4, 16, 14); g.fillRect(274, 18, 3, 3); drawText(g, '?', 275, 7, { color: INK }); }
  if (atYou) { g.fillStyle = INK; g.fillRect(168, 54, 24, 40); g.fillStyle = '#3A3A46'; g.fillRect(170, 56, 20, 36); g.fillStyle = '#5FF4FF'; g.beginPath(); g.arc(180, 62, 3, 0, 7); g.fill(); g.fillStyle = '#F4F0E8'; g.fillRect(179, 61, 1, 1); }
}

// ---------------------------------------------------------------- 8. Baba Smoke (full body): the smoke speaks for him
const SMOKE_Q = ['.###.', '#...#', '...#.', '..#..', '..#..', '.....', '..#..'];
const SMOKE_BAND = ['..###..', '.#...#.', '#.....#', '#.....#', '#.....#', '.#...#.', '..###..'];
const SMOKE_RUDE = ['..#..', '..#..', '..#..', '.###.', '#####', '#####', '.###.'];
const SMOKE_THUMB = ['.#...', '.#...', '.####', '#####', '#####', '.###.'];
const LETTERS = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], K: ['#.#', '##.', '#..', '##.', '#.#'],
  M: ['#.#', '###', '#.#', '#.#', '#.#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'], S: ['.##', '#..', '.#.', '..#', '##.'], ' ': ['...', '...', '...', '...', '...'],
};
function baba(g, c) {
  const { t, still, game } = c;
  g.fillStyle = '#1E1714'; g.fillRect(0, 0, W, VIEW);
  for (let i = 0; i < 40; i++) { g.fillStyle = i % 2 ? '#2A211D' : '#352A26'; g.fillRect((i * 47) % W, (i * 29) % 100, 14, 8); }
  // cave paintings, flickering in the firelight
  const flick = still ? 0.7 : 0.55 + Math.sin(t * 11) * 0.15;
  g.globalAlpha = flick; g.fillStyle = '#C8603A';
  for (const x of [20, 60, 100]) { g.fillRect(x + 4, 60, 2, 2); g.fillRect(x + 4, 62, 1, 6); g.fillRect(x + 1, 63, 7, 1); g.fillRect(x + 2, 68, 1, 4); g.fillRect(x + 6, 68, 1, 4); }
  g.strokeStyle = '#C8603A'; g.beginPath(); g.arc(150, 40, 8, 0, 5.5); g.stroke(); g.globalAlpha = 1;
  g.fillStyle = '#4A3A30'; g.fillRect(0, 108, W, VIEW - 108); g.fillStyle = '#8E8680'; for (let x = 0; x < W; x += 9) g.fillRect(x, 110 + (x % 4), 3, 1);
  // the fire
  g.fillStyle = '#6A4426'; g.fillRect(140, 116, 26, 4);
  for (let i = 0; i < 3; i++) { const h = still ? 12 : 10 + Math.sin(t * 13 + i * 2) * 4; g.fillStyle = ['#FF6A2A', '#FFB23F', '#FFF0A0'][i]; g.beginPath(); g.moveTo(144 + i * 4, 117); g.lineTo(153, 117 - h + i * 3); g.lineTo(162 - i * 4, 117); g.fill(); }
  mon(g, c, 'chillem', 0, 70, 124);
  // Baba, seated cross-legged: saffron robe and turban, ash-grey dreads and beard, ash on his brow, the chillum at his lips
  const SK = '#B07A5A', s = 2, ox = 226, oy = 42, { P, E, L } = pen(g, ox, oy, s);
  P(5, 8, 4, 20, '#8E939C'); P(27, 8, 4, 20, '#8E939C'); P(6, 8, 2, 20, '#A8AEB6'); P(28, 8, 2, 20, '#A8AEB6');    // dreads
  E(18, 37, 17, 4.5, '#E2903A'); P(1, 37, 5, 2, SK); P(30, 37, 5, 2, SK);                                       // crossed legs, feet
  P(8, 24, 20, 13, '#F2A766'); P(10, 24, 2, 13, '#E2903A'); P(22, 26, 1, 10, '#E2903A');                        // robe
  for (let i = 0; i < 7; i++) P(12 + i * 2, 27 + (i % 2), 1, 1, '#6A4426');                                     // rudraksha beads
  E(18, 14, 7, 7, SK);
  E(18, 5, 10, 5, '#F2A766'); P(9, 6, 18, 1, '#E2903A'); P(17, 3, 2, 2, '#E0303C');                             // turban
  P(15, 10, 6, 1, '#F4F0E8'); P(17, 11, 2, 1, '#E0303C');                                                       // ash, and a red dot
  P(14, 13, 3, 1, '#8A5A3A'); P(19, 13, 3, 1, '#8A5A3A'); P(14, 14, 3, 1, INK); P(19, 14, 3, 1, INK);           // half-shut eyes
  P(17, 15, 2, 2, '#8A5A3A');
  P(13, 18, 10, 2, '#C8CCD4'); E(18, 22, 6, 4, '#C8CCD4'); P(17, 25, 2, 3, '#C8CCD4');                          // moustache and long beard
  L(26, 30, 23, 20, 2, SK); P(22, 18, 3, 3, SK);                                                                 // the arm up to his lips
  P(23, 17, 7, 2, '#C8603A'); P(29, 15, 2, 5, '#8A3A1E'); if (!still && Math.floor(t * 4) % 2) P(30, 14, 1, 1, '#FF6A2A');   // the chillum, glowing
  // the smoke: an exhale; a question mark; a wristband; his name; then the gesture
  if (!still) for (let i = 0; i < 10; i++) { const k = (t * 0.4 + i / 10) % 1; g.globalAlpha = 0.5 * (1 - k); g.fillStyle = '#D8D0C8'; g.fillRect(R(286 - k * 80 + Math.sin(t + i) * 4), R(72 - k * 46), 3, 3); } g.globalAlpha = 1;
  const SM = '#D8D0C8';
  if (!still && t > 0.5 && t < 1.5) puffs(g, SMOKE_Q, 180, 22, 4, SM, t, Math.min(1, (t - 0.5) * 3, (1.5 - t) * 3));
  if (!still && t > 1.3 && t < 2.3) puffs(g, SMOKE_BAND, 176, 20, 4, SM, t, Math.min(1, (t - 1.3) * 3, (2.3 - t) * 3));
  // the title, written in smoke: BOSS 7 / BABA SMOKE / ...
  if (t > 2.1 || still) {
    const a = still ? 1 : clamp01((t - 2.1) * 2);
    drawText(g, 'BOSS 7', 12, 10, { color: c.b.accent });
    let x = 12;
    for (const ch of 'BABA SMOKE') { puffs(g, LETTERS[ch], x, 22, 3, SM, t, a); x += 12; }
    puffs(g, ['.....', '.....', '.....', '.....', '#.#.#'], 12, 40, 3, SM, t, a);
  }
  if (t >= 3.2 || still) puffs(g, game.settings.grounded || game.settings.reducedMotion ? SMOKE_THUMB : SMOKE_RUDE, 150, 56, 3, SM, t, still ? 1 : clamp01((t - 3.2) * 2));
}

// ---------------------------------------------------------------- 9. The Promoter: feet up, the spin and the glint, the contract
function promoter(g, c) {
  const { t, still, calm } = c, spun = t >= CARD_AT;
  for (let x = 0; x < W; x += 8) { g.fillStyle = (x / 8) % 2 ? '#3A6484' : '#2F5674'; g.fillRect(x, 0, 8, 102); }
  g.fillStyle = '#5A6070'; g.fillRect(0, 102, W, VIEW - 102);
  // the sales chart on the wall: up, and up
  g.fillStyle = '#F4F0E8'; g.fillRect(24, 16, 76, 46); g.strokeStyle = '#E0303C'; g.lineWidth = 2; g.beginPath(); g.moveTo(30, 56); g.lineTo(46, 50); g.lineTo(58, 52); g.lineTo(74, 36); g.lineTo(94, 22); g.stroke();
  g.fillStyle = '#E0303C'; g.fillRect(91, 20, 5, 2);
  mon(g, c, 'bribe_asaurus', 0, 110, 124);
  if (!still) for (let i = 0; i < 3; i++) { const k = (t * 1.5 + i / 3) % 1; g.fillStyle = '#4FA85A'; g.fillRect(R(118 + k * 10), R(84 - k * 12), 3, 2); }
  const k = (t - CARD_AT) / 0.6, sx = spun && k < 1 && !calm ? Math.cos(k * Math.PI * 2) : 1;
  portrait(g, c, 'promoter', PX, PY + (spun ? 0 : 6), 2, { sx });
  if (!spun) { g.fillStyle = '#2A2A32'; g.fillRect(PX + 2, PY + 42, 6, 16); g.fillRect(PX + 86, PY + 42, 6, 16); }                    // a phone at each ear
  // the desk: cash, a phone; feet up on it until he spins round
  g.fillStyle = '#4A2E1A'; g.fillRect(180, 100, 140, 27); g.fillStyle = '#6A4426'; g.fillRect(180, 100, 140, 3);
  for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? '#4FA85A' : '#3E9A4E'; g.fillRect(286 + i * 3, 94 - i, 14, 6); }
  if (!spun) { g.fillStyle = INK; g.fillRect(200, 92, 14, 8); g.fillRect(216, 94, 14, 6); }
  if (spun && t > CARD_AT + 0.6 && t < CARD_AT + 1.0 && !calm) { const gx = PX + 26 + (t - CARD_AT - 0.6) * 120; g.fillStyle = '#FFFFFF'; g.fillRect(R(gx), PY + 36, 2, 10); }  // the glint
  if (t >= BEAT3) { const ck = ease((t - BEAT3) / 0.6); const x = R(lerp(250, 186, ck)), y = R(lerp(104, 106, ck)); g.fillStyle = '#F4F0E8'; g.fillRect(x, y, 34, 18); for (let i = 0; i < 4; i++) { g.fillStyle = '#C8C0B0'; g.fillRect(x + 4, y + 4 + i * 3, 24 - i * 4, 1); } g.fillStyle = '#FFD23F'; g.fillRect(x + 26, y + 12, 8, 2); }
}

// ---------------------------------------------------------------- 10. Kick Kalyani: every beat lands
function kalyani(g, c) {
  const { t, still, calm } = c, beatLen = 60 / 140, ph = (t / beatLen) % 1, hit = !still && ph < 0.18;
  const nudge = calm ? 0 : hit ? 1 : 0;
  g.save(); g.translate(0, nudge);
  sky(g, '#1A0608', '#3A0A10', H);
  for (let y = 10; y < 100; y += 22) for (let x = 6; x < 200; x += 22) { g.fillStyle = '#2A0A10'; g.beginPath(); g.arc(x + 9, y + 9, 10, 0, 7); g.fill(); g.fillStyle = hit ? '#8A1A24' : '#5A1018'; g.beginPath(); g.arc(x + 9, y + 9, 7 + (hit ? 1 : 0), 0, 7); g.fill(); g.fillStyle = INK; g.fillRect(x + 8, y + 8, 2, 2); }
  g.fillStyle = 'rgba(224,48,60,0.25)'; g.beginPath(); g.ellipse(262, 70, 60, 50, 0, 0, 7); g.fill();
  g.fillStyle = '#2A2A32'; g.fillRect(0, 104, W, VIEW - 104 + 4);
  for (let x = 0; x < W; x += 40) { g.fillStyle = 'rgba(224,48,60,0.2)'; g.fillRect(x + 6, 108, 26, 3); }
  mon(g, c, 'charagolem', 0, 110, 124 - (hit ? 2 : 0));
  portrait(g, c, 'kalyani', PX, PY);
  if (t >= BEAT3) { const press = hit ? 1 : 0; for (const x of [230 - press, 270 + press]) { g.fillStyle = '#8D5A3A'; g.fillRect(x, 98, 16, 11); g.fillStyle = '#6A4426'; for (let i = 0; i < 4; i++) g.fillRect(x + 2 + i * 4, 98, 1, 3); } if (hit) { sparkle(g, 258, 94, '#FFE066'); } }
  g.restore();
}

// ---------------------------------------------------------------- 11. Bassline Boris: the floor rolls, he doesn't
function boris(g, c) {
  const { t, still, calm } = c, amp = calm ? 1 : 4, tt = still ? 0 : t;
  sky(g, '#140B2E', '#2A1A5A', H);
  for (let k = 0; k < 3; k++) { g.fillStyle = ['#7C8CD9', '#5A6AC0', '#3A4A9A'][k]; for (let x = 0; x < W; x += 2) g.fillRect(x, R(26 + k * 10 + Math.sin(x * 0.05 + tt * (2 + k)) * (6 - k * 2)), 2, 1); }
  for (let x = 0; x < W; x += 4) { const top = R(94 + Math.sin(x * 0.03 + tt * 2) * amp); g.fillStyle = (x / 4) % 4 < 2 ? '#3A2A6A' : '#2A1A5A'; g.fillRect(x, top, 4, VIEW - top + 4); g.fillStyle = '#7C8CD9'; g.fillRect(x, top, 4, 1); }
  const bob = still ? 0 : Math.sin(tt * 2) * 3;
  mon(g, c, 'neighbula', 0, 96, 118 + R(Math.sin(tt * 2 + 1) * amp));
  portrait(g, c, 'boris', PX + R(still ? 0 : Math.sin(tt * 2 + 1) * 3), PY + R(bob));
  if (t >= BEAT3) { const k = t - BEAT3, reach = k < 0.8 ? ease(k / 0.6) : Math.max(0, 1 - (k - 0.8) / 0.4); arm(g, 226, 104, lerp(226, 186, reach), lerp(104, 94, reach), '#C98A5A'); }
}

// ---------------------------------------------------------------- 12. Hi-Hat Hana: zip-zip-zip, stop, the tapping foot
function hana(g, c) {
  const { t, still, calm } = c, zipping = !still && t < CARD_AT;
  sky(g, '#061A1E', '#0E2E36', H);
  for (const [x, y] of [[20, 40], [120, 30], [170, 60], [70, 70]]) { g.fillStyle = '#5A5A68'; g.fillRect(x + 9, y + 4, 2, VIEW - y); g.fillStyle = '#E8C468'; g.beginPath(); g.ellipse(x + 10, y + 3, 12, 3, 0, 0, 7); g.fill(); g.fillStyle = '#FFF0A0'; g.fillRect(x + 4, y + 2, 6, 1); }
  // ticks on the off-beat
  const off = ((t * 140 / 60) + 0.5) % 1 < 0.15;
  if (!calm && off) { g.fillStyle = 'rgba(95,244,255,0.35)'; for (let x = 10; x < W; x += 50) g.fillRect(x, 0, 1, VIEW); }
  if (calm) { g.fillStyle = 'rgba(95,244,255,0.12)'; for (let x = 10; x < W; x += 50) g.fillRect(x, 0, 1, VIEW); }
  g.fillStyle = '#123A42'; g.fillRect(0, 108, W, VIEW - 108 + 4);
  const SPOTS = [[20, PY], [110, PY], [PX, PY]];
  if (zipping) {
    const i = Math.floor(t / 0.16);
    for (let back = 2; back >= 1; back--) portrait(g, c, 'hana', SPOTS[(i - back + 30) % 3][0], PY, 2, { alpha: 0.12 * (3 - back) });
    portrait(g, c, 'hana', SPOTS[i % 3][0], PY);
    mon(g, c, 'amphetadragon', 0, SPOTS[(i + 2) % 3][0] + 48, 124, 0.75, false, 0.6);
  } else {
    mon(g, c, 'amphetadragon', 0, 120, 124, 0.75);
    portrait(g, c, 'hana', PX, PY);
  }
  if (t >= BEAT3) { const up = !still && Math.floor(t * 6) % 2; g.fillStyle = '#FFFFFF'; g.fillRect(232, 118 - up * 2, 12, 5); g.fillStyle = '#C8C0D8'; g.fillRect(232, 122 - up * 2, 12, 1); }
}

// ---------------------------------------------------------------- 13. Lead Lakshmi: the notes orbit, lock into a mandala, one comes for you
function lakshmi(g, c) {
  const { t, still } = c;
  sky(g, '#1E0B3A', '#4A1A6A', H);
  g.fillStyle = '#2A1250'; g.fillRect(0, 108, W, VIEW - 108 + 4);
  mon(g, c, 'mandalord', !still && Math.floor(t * 2) % 2 ? 6 : 0, 84, 124);
  const cx = 262, cy = 74, n = 10, lock = still ? 1 : ease((t - (CARD_AT - 0.4)) / 0.5);
  for (let i = 0; i < n; i++) {
    const a = (still ? 0 : t * 0.7) + (i / n) * Math.PI * 2, b = (i / n) * Math.PI * 2;
    const x = lerp(cx + Math.cos(a) * 58, cx + Math.cos(b) * 46, lock), y = lerp(cy + Math.sin(a) * 34, cy + Math.sin(b) * 46, lock);
    if (t >= BEAT3 && i === 0 && !still) continue;
    note(g, x, y, ['#FFD23F', '#FF8FB8', '#5FF4FF', '#C86BFF'][i % 4]);
  }
  if (lock >= 1) { g.strokeStyle = 'rgba(255,210,63,0.35)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy + 3, 46, 0, 7); g.stroke(); }
  portrait(g, c, 'lakshmi', PX, PY);
  if (t >= BEAT3 && !still) { const k = clamp01((t - BEAT3) / 1.4); g.save(); g.translate(R(lerp(cx + 46, 60, k)), R(lerp(cy, 40, k))); g.scale(1 + k * 2, 1 + k * 2); g.globalAlpha = 1 - k * 0.7; note(g, 0, 0, '#FFD23F'); g.restore(); }
}

// ---------------------------------------------------------------- 14. Astra-Zero (Chad): the mirror, the turn, the hair flick
const CHAD_ACE = { starter_ganjapod: 'amphetadragon', starter_jawling: 'hoffmanite', starter_blottertot: 'charagolem' };
function chad(g, c) {
  const { t, still, game } = c;
  const flags = game.engine?.state.flags || {}, ace = Object.entries(CHAD_ACE).find(([f]) => flags[f])?.[1] || 'ravelord';
  g.fillStyle = '#C99A58'; g.fillRect(0, 0, W, VIEW);
  for (let y = 0; y < VIEW; y += 10) for (let x = (y / 10) % 2 * 10; x < W; x += 20) { g.fillStyle = '#B8894A'; g.fillRect(x, y, 19, 9); }
  // the doorway behind him, dawn light through it
  const s = g.createLinearGradient(0, 10, 0, 104); s.addColorStop(0, '#FF8FB8'); s.addColorStop(1, '#FFD23F'); g.fillStyle = s;
  g.beginPath(); g.moveTo(222, 104); g.lineTo(222, 40); g.arc(262, 40, 40, Math.PI, 0); g.lineTo(302, 104); g.fill();
  g.fillStyle = '#A8202A'; g.fillRect(150, 104, 170, VIEW - 104); g.fillStyle = '#FFD23F'; g.fillRect(150, 104, 170, 1);
  mon(g, c, ace, 0, 100, 124);
  const flick = t >= BEAT3 && !still && (t - BEAT3) < 0.3 ? 2 : 0;
  portrait(g, c, 'chad', PX, PY - flick);
  // admiring himself in a hand mirror, then he lowers it for you
  const lower = still ? 1 : ease((t - CARD_AT) / 0.5), my = R(lerp(56, 140, lower));
  if (my < VIEW) { g.fillStyle = '#C8C0D8'; g.beginPath(); g.ellipse(196, my, 11, 14, 0, 0, 7); g.fill(); g.fillStyle = '#A8E0F0'; g.beginPath(); g.ellipse(196, my, 8, 11, 0, 0, 7); g.fill(); g.fillStyle = '#FFFFFF'; g.fillRect(192, my - 6, 2, 4); g.fillStyle = '#C8C0D8'; g.fillRect(195, my + 14, 3, 12); }
  if (!still) for (let i = 0; i < 4; i++) { const a = t * 2 + i * 1.6; sparkle(g, 262 + Math.cos(a) * 46, 60 + Math.sin(a) * 30, i % 2 ? '#FFF6C8' : '#FF8FB8', 2); }
  if (flick) sparkle(g, 250, 36, '#FFFFFF', 3);
}

// ---------------------------------------------------------------- 15. The VIP Shaman Council (full bodies): dawn, the eight wristbands, the passport
const BANDS = ['#4FA85A', '#C8E8F4', '#8A7FE0', '#FFD23F', '#E8ECF4', '#FF8FB8', '#B5502C', '#C86BFF'];
function shaman(g, x, y, s, kind, t, still) {
  const { P, E } = pen(g, x, y, s);
  const robe = { elder: '#3FD8E8', seer: '#9A4FE0', beads: '#2FB8C8' }[kind], skin = { elder: '#B07A5A', seer: '#C98A5A', beads: '#8D5A3A' }[kind];
  P(4, 16, 16, 22, robe); P(2, 34, 20, 6, robe); P(4, 16, 3, 22, 'rgba(0,0,0,0.15)');
  E(12, 10, 6, 6.5, skin);
  if (kind === 'elder') { E(12, 15, 6, 6, '#FFFFFF'); E(12, 4, 8, 5, '#9A4FE0'); P(11, 2, 2, 2, '#FFE066'); P(12, -4, 1, 4, '#4FE88A'); P(16, -2, 1, 3, '#FF4FA8'); P(7, -2, 1, 3, '#FFD23F'); P(22, 4, 2, 36, '#D8A060'); E(23, 3, 2.5, 2.5, '#FFD23F'); }
  if (kind === 'seer') { P(11, 7, 2, 1, '#FF4FA8'); }
  if (kind === 'beads') { E(12, 15, 5.5, 5, '#A8AEB6'); E(12, 5, 7, 3.5, '#3FD8E8'); P(9, 16, 1, 1, '#FF4FA8'); P(12, 18, 1, 1, '#FFD23F'); P(15, 16, 1, 1, '#3FD8E8'); }
  P(9, 10, 1, 1, INK); P(14, 10, 1, 1, INK);
}
function council(g, c) {
  const { t, still } = c;
  sky(g, '#1E2A6A', '#FF9A6A', 104);
  const CX = 210;                                                                                         // right of the title card
  g.fillStyle = '#FFD23F'; g.beginPath(); g.arc(CX, 104, 46, Math.PI, 0); g.fill(); g.fillStyle = '#FFF0A0'; g.beginPath(); g.arc(CX, 104, 32, Math.PI, 0); g.fill();
  g.fillStyle = '#DCCBA4'; g.fillRect(0, 104, W, VIEW - 104); g.fillStyle = '#C2AF86'; for (let x = 0; x < W; x += 16) g.fillRect(x, 104, 1, VIEW - 104);
  for (let i = 0; i < 14; i++) { g.fillStyle = ['#FF4FA8', '#5FF4FF', '#FFE066'][i % 3]; g.fillRect(8 + i * 23, 102, 1, 1); }   // the festival, far below
  const lev = (i) => (still ? 0 : Math.sin(t * 1.5 + i) * 2);
  shaman(g, CX - 92, R(48 + lev(0)), 2, 'seer', t, still);
  shaman(g, CX - 24, R(36 + lev(1)), 2, 'elder', t, still);
  shaman(g, CX + 44, R(50 + lev(2)), 2, 'beads', t, still);
  // the eight wristbands circle above them, then line up into a crown over the Elder
  const lock = still ? 1 : ease((t - (CARD_AT - 0.3)) / 0.6);
  BANDS.forEach((col, i) => {
    const a = (still ? 0 : t * 0.9) + (i / 8) * Math.PI * 2, ca = Math.PI + (i / 7) * Math.PI;
    const x = lerp(CX + Math.cos(a) * 64, CX + Math.cos(ca) * 22, lock), y = lerp(24 + Math.sin(a) * 10, 30 + Math.sin(ca) * 8, lock);
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.ellipse(R(x), R(y), 5, 2, 0, 0, 7); g.stroke();
  });
  // humming
  if (!still) for (let i = 0; i < 3; i++) { const k = (t * 0.35 + i / 3) % 1; g.globalAlpha = 1 - k; drawText(g, 'm', CX - 70 + i * 68, R(58 - k * 30), { color: '#F4F0E8' }); g.globalAlpha = 1; }
  if (t >= BEAT3) { const px = CX + 22; g.fillStyle = '#8A1A2A'; g.fillRect(px, 40, 12, 16); g.fillStyle = '#FFD23F'; g.fillRect(px + 3, 44, 6, 1); g.fillRect(px + 5, 47, 2, 4); if (!still && Math.floor(t * 3) % 2) sparkle(g, px + 14, 40, '#FFFFFF'); }
}
