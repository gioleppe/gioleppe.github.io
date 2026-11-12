// Boot sequence, played when the page opens: the GIOLEPPESOFT logo, then a short intro in the spirit of the old
// handheld openings (a night beach, the festival, a face-off, a legend), then the title drops in and the game
// moves on to the title screen. Any button or tap skips it. Nothing flashes (the content notice comes after);
// with reduced motion the scenes hold still and only fade.
import { W, H } from './CanvasRenderer.js';
import { drawText, textWidth } from './font.js';
import { C } from './ui.js';
import { drawBackdrop, SPOT } from './battleFx.js';
import { drawMoveFx, lookOf, durationOf } from './moveFx.js';

export const SCENES = [
  { id: 'logo', dur: 3.6 },
  { id: 'beach', dur: 4.2 },
  { id: 'festival', dur: 4.2 },
  { id: 'faceoff', dur: 4.8 },
  { id: 'legend', dur: 4.4 },
  { id: 'title', dur: 2.4 },
];
export const INTRO_SECONDS = SCENES.reduce((a, s) => a + s.dur, 0);
const FADE = 0.35;
const WORD = 'GIOLEPPESOFT';

// the emblem: an open third eye, 13 x 9 (# outline, i iris, o pupil)
const EYE = [
  '....#####....',
  '..##.....##..',
  '.#...iii...#.',
  '#...iiiii...#',
  '#...iiooi...#',
  '#...iiiii...#',
  '.#...iii...#.',
  '..##.....##..',
  '....#####....',
];

export const introView = {
  screen: true, t: 0, next: 'title',

  /** play it now, then carry on to whatever screen was due (the content notice on a first launch, or the title) */
  start(game) { this.t = 0; this.next = game.screen === 'intro' ? 'title' : game.screen; game.screen = 'intro'; },
  finish(game) { game.screen = this.next || 'title'; },

  update(game, dt) {
    this.t += dt;
    const input = game.input;
    if (input.pressed('a') || input.pressed('b') || input.pressed('start') || input.pressed('item') || input.anyTap()) return this.finish(game);
    if (this.t >= INTRO_SECONDS) this.finish(game);
  },

  /** which scene is on, how far into it (seconds and 0..1) */
  scene() {
    let t = this.t;
    for (const s of SCENES) { if (t < s.dur) return { id: s.id, t, k: t / s.dur, dur: s.dur }; t -= s.dur; }
    const last = SCENES[SCENES.length - 1];
    return { id: last.id, t: last.dur, k: 1, dur: last.dur };
  },

  draw(game, g) {
    const sc = this.scene(), still = !!game.settings.reducedMotion;
    g.save();
    g.imageSmoothingEnabled = false;
    g.fillStyle = C.void; g.fillRect(0, 0, W, H);
    DRAW[sc.id](game, g, sc, still);
    g.restore();
    // every cut is a fade through black (no white flashes before the content notice)
    const f = Math.max(0, Math.min(1, sc.t / FADE, (sc.dur - sc.t) / FADE));
    if (f < 1 && !(sc.id === 'title' && sc.t > FADE)) { g.globalAlpha = 1 - f; g.fillStyle = C.void; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    if (sc.id !== 'logo') drawText(g, 'A: skip', W - 4, H - 10, { color: '#8C7A9A', align: 'right' });
  },
};

const mon = (game, id) => game.images[`mon:${id}`];
/** a 64 px creature frame (0 front, 1 breath, 2 back, 5 blink, 6 idle touch), scaled s, bottom-centre at x, y */
function creature(g, img, frame, x, y, s = 1, flip = false) {
  if (!img) return;
  g.save(); g.translate(Math.round(x), Math.round(y));
  if (flip) g.scale(-1, 1);
  g.drawImage(img, frame * 64, 0, 64, 64, Math.round(-32 * s), Math.round(-64 * s), 64 * s, 64 * s);
  g.restore();
}
function stars(g, t, still, n = 40, yMax = 90) {
  for (let i = 0; i < n; i++) {
    const x = (i * 73) % W, y = (i * 37) % yMax, tw = still ? 1 : (Math.sin(t * 3 + i) + 1) / 2;
    g.fillStyle = tw > 0.5 ? '#F4F0E8' : '#8C7A9A'; g.fillRect(x, y, 1, 1);
  }
}
const ease = (k) => 1 - (1 - Math.max(0, Math.min(1, k))) ** 3;

const DRAW = {
  // GIOLEPPESOFT: the eye opens, the letters type in, a shine sweeps across, "presents"
  logo(game, g, sc, still) {
    const t = sc.t, px = 3, ex = W / 2 - (13 * px) / 2, ey = 34;
    const open = still ? 1 : Math.min(1, t / 0.8), blink = !still && t > 2.5 && t < 2.62;
    EYE.forEach((row, y) => {
      const lid = Math.abs(y - 4) > 4 * (blink ? 0.1 : open);   // the lids open from the middle row out
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        if (lid && ch !== '#') return;
        const col = ch === '#' ? C.cream : ch === 'o' ? C.void : (y + x) % 2 ? C.magenta : C.purple;
        g.fillStyle = lid ? C.cream : col;
        g.fillRect(ex + x * px, ey + (lid ? 4 : y) * px, px, px);
      });
    });
    // the wordmark at double size, typed in from 0.7 s
    const shown = still ? WORD.length : Math.max(0, Math.min(WORD.length, Math.floor((t - 0.7) / 0.06)));
    const word = WORD.slice(0, shown), wx = Math.round(W / 2 - textWidth(WORD)), wy = 76;   // centred at double size
    g.save(); g.translate(wx, wy); g.scale(2, 2);
    drawText(g, word, 0, 0, { color: C.cream, shadow: C.magenta });
    g.restore();
    // the shine: a bright band sweeping left to right across the letters
    if (!still && t > 1.6 && t < 2.3) {
      const bx = wx - 20 + ((t - 1.6) / 0.7) * 200;
      g.save(); g.beginPath(); g.rect(bx, wy - 2, 14, 20); g.clip();
      g.translate(wx, wy); g.scale(2, 2); drawText(g, word, 0, 0, { color: '#FFFFFF' });
      g.restore();
    }
    if (still || t > 2.3) drawText(g, 'presents', W / 2, 104, { color: C.yellow, align: 'center' });
  },

  // a night beach: moon, stars, rolling waves, palms; a Wooklet bounces along the sand, a Crabcake scuttles past
  beach(game, g, sc, still) {
    const t = sc.t;
    const sky = g.createLinearGradient(0, 0, 0, 100); sky.addColorStop(0, '#0B0314'); sky.addColorStop(1, '#2A1250');
    g.fillStyle = sky; g.fillRect(0, 0, W, 100);
    stars(g, t, still);
    g.fillStyle = '#F4F0E8'; g.beginPath(); g.arc(250, 30 - (still ? 0 : t * 2), 14, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2A3A6A'; g.fillRect(0, 96, W, 30);
    g.fillStyle = '#4A5A9A';
    for (let x = 0; x < W; x += 24) g.fillRect((x + Math.round(still ? 0 : t * 14)) % W, 102 + ((x / 24) % 3) * 7, 12, 1);
    g.fillStyle = '#6A5A6A'; g.fillRect(0, 126, W, H - 126);
    const palm = game.images['prop:palm'], pw = game.atlas?.props?.palm;
    if (palm && pw) for (const x of [28, 292]) g.drawImage(palm, 0, 0, pw.w, pw.h, x - pw.w / 2, 128 - pw.h, pw.w, pw.h);
    const k = still ? 0.5 : sc.k, hop = still ? 0 : Math.abs(Math.sin(t * 7)) * 6;
    creature(g, mon(game, 'wooklet'), (Math.floor(t * 4) % 2), -40 + k * (W + 80), 150 - hop);
    creature(g, mon(game, 'crabcake'), Math.floor(t * 6) % 2 ? 6 : 0, W + 30 - k * (W + 60) * 0.8, 166, 0.75);
  },

  // the festival: a stage, pumping speakers, slow lasers, a bouncing crowd; Jawling and Glowkid dance in front
  festival(game, g, sc, still) {
    const t = sc.t, beat = still ? 0 : Math.floor(t * 140 / 60) % 2;
    const bg = g.createLinearGradient(0, 0, 0, 110); bg.addColorStop(0, '#14081F'); bg.addColorStop(1, '#3A1A50');
    g.fillStyle = bg; g.fillRect(0, 0, W, 110);
    g.save(); g.globalAlpha = 0.45; g.lineWidth = 1;
    ['#FF4FA8', '#3FD8E8', '#4FE88A', '#FFE066', '#C86BFF', '#FF4FA8'].forEach((col, i) => {
      const a = (still ? 0.3 + i * 0.12 : 0.2 + Math.sin(t * 0.9 + i) * 0.45) + Math.PI / 2;
      g.strokeStyle = col; g.beginPath(); g.moveTo(W / 2, 40); g.lineTo(W / 2 + Math.cos(a + 1.2) * 300, 40 - Math.sin(a + 1.2) * 200); g.stroke();
    });
    g.restore();
    g.fillStyle = '#2A1A3E'; g.fillRect(70, 52, 180, 10);
    g.fillStyle = '#4A2A6A'; g.fillRect(60, 62, 200, 44);
    for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? '#5A3A7A' : '#3A1A5A'; g.fillRect(60 + i * 22, 62, 22, 44); }
    const sp = game.images['prop:speaker'], sw = game.atlas?.props?.speaker;
    for (const x of [44, 276]) if (sp && sw) g.drawImage(sp, 0, 0, sw.w, sw.h, x - sw.w, 106 - sw.h * 2 - beat, sw.w * 2, sw.h * 2);
    // the dancefloor below the stage, in purple checks that light up on the beat
    for (let y = 106; y < H; y += 12) for (let x = 0; x < W; x += 20) {
      const lit = !still && ((x / 20 + (y - 106) / 12 + Math.floor(t * 140 / 60)) % 5 === 0);
      g.fillStyle = lit ? '#6A3A9A' : ((x / 20 + (y - 106) / 12) % 2 ? '#2A1240' : '#1E0B30'); g.fillRect(x, y, 20, 12);
    }
    // the crowd in front: heads and raised arms bobbing to the beat, some waving glowsticks
    for (let i = 0; i < 15; i++) {
      const x = i * 22 + (i % 2) * 6 - 4, up = still ? 0 : (Math.floor(t * 140 / 60 + i * 0.5) % 2) * 2, y = 150 - up + (i % 3) * 4;
      g.fillStyle = '#0B0314'; g.fillRect(x, y, 14, H - y); g.fillRect(x + 3, y - 8, 8, 8);
      if (i % 3 === 0) { g.fillRect(x + (i % 2 ? -2 : 13), y - 12 + up, 3, 12); g.fillStyle = ['#4FE88A', '#FF4FA8', '#5FF4FF'][i % 3 === 0 ? (i / 3) % 3 : 0]; g.fillRect(x + (i % 2 ? -3 : 13), y - 18 + up, 4, 6); }
    }
    creature(g, mon(game, 'jawling'), beat ? 6 : 0, 128, 108 - (still ? 0 : Math.abs(Math.sin(t * 7.3)) * 5));
    creature(g, mon(game, 'glowkid'), beat ? 0 : 6, 194, 108 - (still ? 0 : Math.abs(Math.cos(t * 7.3)) * 5));
  },

  // a face-off on the beach: Jawling (from behind) and a wild Crabcake slide in, and Jawling's Strobe Rush lands
  faceoff(game, g, sc, still) {
    const t = sc.t;
    drawBackdrop(g, 'beach', 132, t, true, still);
    const plat = (x, y, rx, ry) => { g.fillStyle = '#2E1750'; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill(); g.fillStyle = '#4A2A7A'; g.beginPath(); g.ellipse(x, y - 2, rx - 3, ry - 2, 0, 0, 7); g.fill(); };
    const inK = still ? 1 : ease(t / 1.1);
    plat(232 + (1 - inK) * 160, 80, 46, 10); plat(84 - (1 - inK) * 160, 132, 62, 12);
    const hitAt = 2.2, fx = lookOf(game.data.moves.strobe_rush || {}), dur = durationOf('strike', fx), e = t - hitAt;
    const hit = e > fx.impact && e < fx.impact + 0.5 && Math.floor(e * 30) % 4 === 3;
    if (!hit) creature(g, mon(game, 'crabcake'), Math.floor(t * 2) % 2, SPOT.e.x + (1 - inK) * 160 + (e > fx.impact && e < fx.impact + 0.4 && !still ? 6 : 0), SPOT.e.y + 32);
    const lunge = !still && e > 0 && e < 0.4 ? Math.sin((e / 0.4) * Math.PI) * 30 : 0;
    creature(g, mon(game, 'jawling'), 2 + (Math.floor(t * 2) % 2), SPOT.p.x - (1 - inK) * 160 + lunge, SPOT.p.y + 32 - lunge * 0.4);
    if (e > 0 && e < dur) drawMoveFx(g, { kind: 'strike', fx, from: 'p', to: 'e', t: e, dur, hit: 1 }, { still, calm: true });
    g.fillStyle = C.cream; g.fillRect(0, 132, W, H - 132);
    g.fillStyle = C.terracotta; g.fillRect(0, 132, W, 2);
    const line = t < hitAt ? 'A wild Crabcake drifts out of the incense!' : 'Jawling used Strobe Rush!';
    drawText(g, line, 12, 146, { color: C.ink });
  },

  // a legend: out of the dark, Mandalord rises in a glow, its rays turning
  legend(game, g, sc, still) {
    const t = sc.t, k = still ? 1 : ease(t / 2.6);
    stars(g, t, still, 60, H);
    const y = 240 - k * 108, S = 1.5;                     // rises from below the screen and stops in full view
    const glow = g.createRadialGradient(W / 2, y - 48, 4, W / 2, y - 48, 30 + k * 60);
    glow.addColorStop(0, 'rgba(200,107,255,0.55)'); glow.addColorStop(1, 'rgba(200,107,255,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    const frame = still ? 0 : t > 3.6 && t < 3.75 ? 5 : Math.floor(t * 2) % 2 ? 6 : 0;   // rays turn, then it blinks at you
    creature(g, mon(game, 'mandalord'), frame, W / 2, y, S);
    if (t > 2.8) drawText(g, 'Something is watching the festival.', W / 2, 160, { color: C.yellow, align: 'center' });
  },

  // the title drops in over the kaleidoscope, exactly where the title screen keeps it
  title(game, g, sc, still) {
    const t = sc.t, cols = [C.magenta, C.purple, C.cyan, C.acid];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + (still ? 0 : (game.t || 0) * 0.15);
      g.strokeStyle = cols[i % 4] + '55'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(W / 2, 62); g.lineTo(W / 2 + Math.cos(a) * 260, 62 + Math.sin(a) * 260); g.stroke();
    }
    g.fillStyle = '#E8C39E'; g.fillRect(0, 128, W, 52);
    g.fillStyle = '#4FA4B8'; g.fillRect(0, 118, W, 10);
    const drop = still ? 1 : ease(t / 0.9), bounce = still ? 0 : Math.max(0, Math.sin(Math.min(1, (t - 0.9) / 0.4) * Math.PI)) * 3;
    const title = game.data.manifest.title || 'CHAKRA-GEDDON';
    for (let i = 3; i >= 0; i--) {
      g.save(); g.translate(W / 2 + i, -40 + drop * 74 + i - bounce); g.scale(3, 3);
      drawText(g, title, 0, 0, { color: i ? [C.purple, C.cyan, C.magenta][i - 1] : C.cream, align: 'center' });
      g.restore();
    }
  },
};

export function install(game) { game.register('intro', introView); }
