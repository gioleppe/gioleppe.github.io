// Full-screen backdrops that scripts put behind the dialogue box ({ scene: id } steps).
// 'dream': the opening. You are lying on the beach; Banyan's face hangs over you against the sun,
// your eyelids open slowly, and an Astral can drift in beside him.
// 'crab_rave': the payoff of The Crab Rave. The four crabs dance on the night beach under lasers.
import { W, H } from './CanvasRenderer.js';

export const SCENES = ['dream', 'crab_rave'];
const CRABS = ['crabcake', 'lobsterlad', 'ketacrab', 'wonkrab'];

export const sceneView = {
  t: 0, id: null, showT: 0, show: null,

  reset() { this.id = null; this.t = 0; },
  update(game, dt) {
    const sc = game.engine?.state.scene;
    if (!sc) { this.id = null; return; }
    if (sc.id !== this.id) { this.id = sc.id; this.t = 0; }
    if ((sc.show || null) !== this.show) { this.show = sc.show || null; this.showT = 0; }
    this.t += dt; this.showT += dt;
  },

  draw(game, g) {
    const sc = game.engine?.state.scene;
    if (sc?.id === 'crab_rave') return this.crabRave(game, g);
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
