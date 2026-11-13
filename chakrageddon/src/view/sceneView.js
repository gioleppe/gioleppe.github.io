// Full-screen backdrops that scripts put behind the dialogue box ({ scene: id } steps).
// 'dream': the opening. You are lying on the beach; Banyan's face hangs over you against the sun,
// your eyelids open slowly, and an Astral can drift in beside him.
// 'crab_rave': the payoff of The Crab Rave. The four crabs dance on the night beach under lasers.
// 'mantequilla', 'vicchio_landing': the Aliens of Vicchio (vicchioScenes.js); the landing follows the script's phase.
import { W, H } from './CanvasRenderer.js';
import { drawText } from './ui.js';
import { drawForage, drawLanding } from './vicchioScenes.js';
import { drawBoss, BOSSES } from './bossScenes.js';
import { overworldView } from './overworldView.js';

// the colours of the eight wristbands, in the order rules.wristbands lists them (as in the Fanny Pack)
const BAND_COLORS = ['#C9A45A', '#C8F4FF', '#7FD6FF', '#FFD23F', '#4FE88A', '#FF4FA8', '#A8AEB6', '#F4FFF0'];
/** the wristband ceremony: the band turning slowly in a burst of light, confetti, the boss who hands it over */
function drawCeremony(game, g, who, by, t, still) {
  const ids = Object.keys(game.data.rules.wristbands || {}), col = BAND_COLORS[Math.max(0, ids.indexOf(who))] || '#FFD23F';
  g.fillStyle = '#14081E'; g.fillRect(0, 0, W, H);
  const rot = still ? 0 : t * 0.4;
  g.save(); g.globalAlpha = 0.35;
  for (let i = 0; i < 18; i++) {
    const a0 = (i / 18) * Math.PI * 2 + rot, a1 = a0 + Math.PI / 18;
    g.fillStyle = i % 2 ? col : '#9A4FE0';
    g.beginPath(); g.moveTo(W / 2 + 40, 58); g.lineTo(W / 2 + 40 + Math.cos(a0) * 320, 58 + Math.sin(a0) * 320); g.lineTo(W / 2 + 40 + Math.cos(a1) * 320, 58 + Math.sin(a1) * 320); g.fill();
  }
  g.restore();
  // the band: a thick ring seen at an angle, turning (its far side darker), with a woven stripe
  const cx = W / 2 + 40, cy = 58, rx = 34, ry = 12 + (still ? 4 : Math.sin(t * 1.2) * 4), grow = Math.min(1, still ? 1 : t * 2.5);
  g.save(); g.translate(cx, cy); g.scale(grow, grow);
  g.lineWidth = 9; g.strokeStyle = '#14101E'; g.beginPath(); g.ellipse(0, 0, rx + 1, ry + 1, 0, 0, 7); g.stroke();
  g.lineWidth = 7; g.strokeStyle = col; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, Math.PI, Math.PI * 2); g.globalAlpha = 0.7; g.stroke(); g.globalAlpha = 1;
  g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI); g.stroke();
  g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI); g.stroke();
  g.fillStyle = '#FFFFFF'; g.fillRect(-rx + 4, -1, 3, 2);
  g.restore();
  // confetti
  const cols = ['#FF4FA8', '#3FD8E8', '#FFE066', '#4FE88A', '#C86BFF'];
  for (let i = 0; i < 40; i++) {
    const k = still ? (i * 0.37) % 1 : (t * 0.35 + i * 0.137) % 1, x = (i * 53) % W + (still ? 0 : Math.sin(t * 2 + i) * 6);
    g.fillStyle = cols[i % cols.length]; g.fillRect(Math.round(x), Math.round(-6 + k * 120), 2, i % 3 ? 2 : 3);
  }
  // the boss who hands it over, sliding in from the left
  const img = by && game.images[`portrait:${by}`];
  if (img) {
    const k = still ? 1 : Math.min(1, t * 2.2), x = Math.round(-90 + 100 * k);
    g.save(); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, 48, 48, x, 8, 96, 96); g.restore();
  }
}

// 'boss': a boss's cutscene (bossScenes.js), who = which one; card = the short title card of a rematch
export const SCENES = ['dream', 'crab_rave', 'mantequilla', 'vicchio_landing', 'boss', 'wristband', 'alley_lock'];
const CRABS = ['crabcake', 'lobsterlad', 'ketacrab', 'wonkrab'];

export const sceneView = {
  t: 0, id: null, showT: 0, show: null, phase: 0, phaseT: 0,

  reset() { this.id = null; this.t = 0; },
  update(game, dt) {
    const sc = game.engine?.state.scene;
    if (!sc) { this.id = null; return; }
    if (overworldView.arriving()) return;                         // a boss's arrival plays first, then their cutscene
    const key = sc.id === 'boss' ? `boss:${sc.who}:${sc.card ? 1 : 0}` : sc.id === 'wristband' ? `wristband:${sc.who}` : sc.id;
    if (key !== this.id) {
      this.id = key; this.t = 0;
      const mood = sc.id === 'boss' && BOSSES[sc.who]?.mood;
      // the boss's own theme (the same one their battle plays, so the fight carries on the cutscene's song, not another)
      if (mood) game.audio?.setTrack({ mood, zone: mood === 'BOSS' ? `boss:${sc.who}` : undefined });
    }
    if ((sc.show || null) !== this.show) { this.show = sc.show || null; this.showT = 0; }
    if ((sc.phase || 0) !== this.phase) { this.phase = sc.phase || 0; this.phaseT = 0; }
    this.t += dt; this.showT += dt; this.phaseT += dt;
  },

  draw(game, g) {
    const sc = game.engine?.state.scene;
    if (sc && overworldView.arriving()) return;
    if (sc?.id === 'wristband') return drawCeremony(game, g, sc.who, sc.by, this.t, game.settings.reducedMotion);
    if (sc?.id === 'crab_rave') return this.crabRave(game, g);
    if (sc?.id === 'alley_lock') return this.alleyLock(game, g);
    if (sc?.id === 'boss') return drawBoss(game, g, sc.who, this.t, !!sc.card);
    if (sc?.id === 'mantequilla') return drawForage(game, g, this.t);
    if (sc?.id === 'vicchio_landing') return drawLanding(game, g, this.t, this.phase, this.phaseT);
    if (!sc || sc.id !== 'dream') return;
    const still = game.settings.reducedMotion, t = still ? 2 : this.t;
    // sky: deep violet at the edges, warm in the middle where the sun is
    const bands = ['#1A0A2A', '#3A1440', '#6A2450', '#A84A50', '#E08A5A', '#F4C07A'];
    for (let i = 0; i < bands.length; i++) { const r = 200 - i * 30; g.fillStyle = bands[i]; g.beginPath(); g.arc(W / 2, 56, r, 0, Math.PI * 2); g.fill(); }
    // the sun as a halo behind his head
    g.fillStyle = '#FFE6A8'; g.beginPath(); g.arc(W / 2, 54, 34 + Math.sin(t * 1.3) * 1.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#FFF6D8'; g.beginPath(); g.arc(W / 2, 54, 24, 0, Math.PI * 2); g.fill();

    // Banyan's portrait at double size, leaning over you against the sun
    const img = game.images['portrait:banyan'];
    const sway = Math.round(Math.sin(t * 0.7) * 3), bob = Math.round(Math.sin(t * 0.45) * 2);
    if (img) {
      // he talks while his line types out, and blinks now and then
      const dv = game.dialogue, typing = dv && dv.pages?.length && dv.shown < (dv.pages[dv.page] || []).join('').length && game.engine.state.dialogue?.speaker;
      const frame = !still && typing && Math.floor(this.t * 8) % 2 ? 2 : !still && (this.t % 3.3) < 0.13 ? 1 : 0;
      g.save(); g.imageSmoothingEnabled = false;
      g.drawImage(img, frame * 48, 0, 48, 48, W / 2 - 48 + sway, 6 + bob, 96, 96);
      g.restore();
    }
    // an Astral drifting in from the side
    if (sc.show) {
      const mon = game.images[`mon:${sc.show}`];
      const k = Math.min(1, this.showT / 1.2), x = Math.round(W - 30 - 70 * k), y = Math.round(40 + Math.sin(t * 1.7) * 4);
      if (mon) { g.globalAlpha = 0.85 * k; g.drawImage(mon, 0, 0, 64, 64, x - 32, y, 64, 64); g.globalAlpha = 1; }
    }
    // the edge of your vision, and eyelids that open over the first seconds and droop now and then
    g.fillStyle = 'rgba(11,3,20,0.55)';
    g.fillRect(0, 0, 18, H); g.fillRect(W - 18, 0, 18, H);
    const open = still ? 1 : Math.min(1, t / 2.5), droop = still ? 0 : Math.max(0, Math.sin(t * 0.9 + 1) - 0.92) * 6;
    const lid = Math.round((1 - open) * (H / 2) + droop * 20);
    g.fillStyle = '#0B0314';
    if (lid > 0) { g.fillRect(0, 0, W, lid); g.fillRect(0, H - lid, W, lid); }
  },
};

/** the night beach, a moon, lasers, and four crabs dancing sideways to the beat; with reduced motion they pose */
sceneView.crabRave = function (game, g) {
  const still = game.settings.reducedMotion, calm = still || game.settings.grounded, t = still ? 1 : this.t;
  const beat = still ? 0 : Math.floor(t * 2.4) % 2;
  const sky = g.createLinearGradient(0, 0, 0, 110);
  sky.addColorStop(0, '#0B0314'); sky.addColorStop(1, '#2A1250');
  g.fillStyle = sky; g.fillRect(0, 0, W, 110);
  g.fillStyle = '#F4F0E8'; g.beginPath(); g.arc(262, 26, 13, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2A3A6A'; g.fillRect(0, 70, W, 22);
  g.fillStyle = '#4A5A9A';
  for (let x = 0; x < W; x += 22) g.fillRect((x + Math.round(t * 10)) % W, 74 + ((x / 22) % 2) * 8, 10, 1);
  g.fillStyle = '#6A5A6A'; g.fillRect(0, 92, W, H - 92);
  // lasers from the speakers at the edges, sweeping (steady with grounded mode or reduced motion)
  const cols = ['#FF4FA8', '#3FD8E8', '#4FE88A', '#FFE066'];
  g.save(); g.globalAlpha = 0.55; g.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const from = i % 2 ? W - 6 : 6, ang = calm ? 0.25 + i * 0.12 : 0.2 + Math.sin(t * 1.5 + i) * 0.5;
    g.strokeStyle = cols[i % cols.length]; g.beginPath(); g.moveTo(from, 60); g.lineTo(from + (i % 2 ? -1 : 1) * Math.cos(ang) * 340, 60 - Math.sin(ang) * 120); g.stroke();
  }
  g.restore();
  for (const x of [0, W - 14]) { g.fillStyle = '#14101E'; g.fillRect(x, 54, 14, 40); g.fillStyle = '#5A5F6A'; g.beginPath(); g.arc(x + 7, 66 + (beat ? 1 : 0), 4 + beat, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(x + 7, 83, 5, 0, Math.PI * 2); g.fill(); }
  // the four crabs: sideways shuffles, claws up on the beat (their idle frame), one bobbing behind the other
  CRABS.forEach((id, i) => {
    const img = game.images[`mon:${id}`];
    if (!img) return;
    const side = still ? 0 : Math.sin(t * 2.4 * Math.PI / 2 + i * 1.6) * 10, hop = still ? 0 : Math.abs(Math.sin(t * 2.4 * Math.PI + i)) * 5;
    const frame = (beat + i) % 2 ? 6 : 0;
    g.drawImage(img, frame * 64, 0, 64, 64, Math.round(22 + i * 72 + side), Math.round(52 - hop - (i % 2) * 4), 64, 64);
  });
};

export function install(game) { game.register('scene', sceneView); }

/** the back alley: at the end of a passage of containers the market glows, until a shutter rattles down over it with a
 *  CLANG; Constable Shah, in a tourist shirt and a stuck-on moustache, dusts off his hands in front (1.1.3) */
sceneView.alleyLock = function (game, g) {
  const still = game.settings.reducedMotion, t = still ? 3 : this.t, VIEW = H - 53;
  const R = (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  R('#0B0314', 0, 0, W, H);
  // the far end: the market behind, warm, with string lights
  R('#F4A261', 116, 36, 88, 72); R('#E76F51', 116, 86, 88, 22);
  for (let i = 0; i < 9; i++) R(i % 3 === 0 ? '#FFE066' : i % 3 === 1 ? '#FF4FA8' : '#5FF4FF', 120 + i * 10, 42 + (i % 2) * 2, 3, 3);
  R('#3B2314', 130, 70, 10, 38); R('#3B2314', 172, 64, 12, 44);                       // people over there, going about their evening
  // the shutter, coming down
  const k = Math.min(1, t / 1.1), drop = Math.round(72 * k * k);
  R('#8E939C', 116, 36, 88, drop);
  for (let y = 36; y < 36 + drop; y += 4) R('#6C727C', 116, y, 88, 1);
  if (drop > 2) R('#4A4F58', 116, 36 + drop - 2, 88, 2);
  // the walls of the passage: shipping containers in perspective, ribbed, with posters
  g.fillStyle = '#3A1E4A'; g.beginPath(); g.moveTo(0, 0); g.lineTo(116, 30); g.lineTo(116, 110); g.lineTo(0, VIEW); g.fill();
  g.fillStyle = '#1E3A5A'; g.beginPath(); g.moveTo(W, 0); g.lineTo(204, 30); g.lineTo(204, 110); g.lineTo(W, VIEW); g.fill();
  for (let i = 1; i < 7; i++) { const x = i * 18; R('#2A1438', x, 6 + x * 0.21, 2, VIEW - 12 - x * 0.55); R('#14284A', W - x - 2, 6 + x * 0.21, 2, VIEW - 12 - x * 0.55); }
  R('#FF4FA8', 30, 40, 22, 30); R('#FFE066', 33, 44, 16, 3); R('#FFE066', 33, 50, 12, 2);          // GOA TRANCE poster
  R('#4FE88A', 252, 46, 24, 26); R('#14101E', 256, 52, 16, 2); R('#14101E', 256, 58, 12, 2);        // WANTED (blank)
  R('#2A1A2E', 0, VIEW - 8, W, 8);                                                                    // the ground
  // CLANG
  if (!still && t > 1.1 && t < 1.9) { const a = 1 - (t - 1.1) / 0.8; g.globalAlpha = a; drawText(g, 'CLANG!', 160, 18, { color: '#FFE066', align: 'center' }); g.globalAlpha = 1; }
  else if (still) drawText(g, 'CLANG!', 160, 18, { color: '#FFE066', align: 'center' });
  // Constable Shah: the guard, in a tourist shirt, with a moustache that is not quite on straight
  const img = game.images['portrait:guard'];
  const px = 208, py = VIEW - 96 + (still ? 0 : Math.round(Math.sin(t * 2) * 1));
  if (img) { g.save(); g.imageSmoothingEnabled = false; g.drawImage(img, (!still && t % 3.1 < 0.12 ? 1 : 0) * 48, 0, 48, 48, px, py, 96, 96); g.restore(); }
  R('#FF8FB8', px + 14, py + 78, 68, 18); for (let i = 0; i < 6; i++) R('#FFE066', px + 18 + i * 11, py + 82 + (i % 2) * 6, 4, 4);   // the shirt, hibiscus
  R('#1E140E', px + 34, py + 56, 28, 4); R('#1E140E', px + 30, py + 58, 6, 3); R('#1E140E', px + 60, py + 55, 6, 3);              // the moustache, a bit crooked
};
