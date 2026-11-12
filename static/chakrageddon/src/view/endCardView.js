// After the credits: your festival on one card, to keep or share (IMPROVEMENTS.md point 6). A saves it as a picture,
// B (or a tap on the right) goes back to the festival.
import { W, H } from './CanvasRenderer.js';
import { drawText, panel, C } from './ui.js';
import { festivalStats, festivalTime } from '../core/stats.js';

const COLS = ['#FF4FA8', '#9A4FE0', '#3FD8E8', '#4FE88A', '#FFE066'];

/** the card itself, on any 320x180 canvas */
export function drawCard(game, g, t = 0, prompt = true) {
  const s = game.engine.state, st = festivalStats(game.data, s), still = game.settings.reducedMotion;
  g.fillStyle = C.void; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + (still ? 0 : t * 0.08);
    g.strokeStyle = COLS[i % COLS.length] + '33'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 + Math.cos(a) * 260, H / 2 + Math.sin(a) * 260); g.stroke();
  }
  g.lineWidth = 1;
  panel(g, 8, 8, W - 16, H - 16, { bg: '#1E0B30', accent: C.magenta, border: C.ink });
  // you, big, on the left
  const me = game.images[`char:${s.outfit || 'player'}`];
  if (me) { g.save(); g.imageSmoothingEnabled = false; g.drawImage(me, 0, 0, 16, 24, 22, 40, 48, 72); g.restore(); }
  g.fillStyle = 'rgba(11,3,20,0.4)'; g.fillRect(28, 110, 36, 4);
  drawText(g, st.name, 46, 122, { color: C.cream, align: 'center' });
  // the title
  g.save(); g.scale(2, 2); drawText(g, 'MY FESTIVAL', W / 4 + 20, 9, { color: C.yellow, align: 'center', shadow: C.magenta }); g.restore();
  const rows = [
    ['At the festival', festivalTime(st)],
    ['Walked', `${st.km.toFixed(1)} km`],
    ['Highest high', st.peak],
    ['Astrals bagged', `${st.caught} / ${st.species}`],
    ['Wristbands', `${st.bosses} / ${st.bossTotal}`],
    ['Rematches won', `${st.rematches} / ${st.rematchTotal}`],
    ['Side quests', `${st.quests} / ${st.questTotal}`],
  ];
  rows.forEach(([k, v], i) => { drawText(g, k, 92, 42 + i * 13, { color: C.sand }); drawText(g, v, W - 20, 42 + i * 13, { color: COLS[i % COLS.length], align: 'right' }); });
  drawText(g, 'CHAKRA-GEDDON   gioleppe.github.io/chakrageddon', W / 2, H - 26, { color: '#7A6AA0', align: 'center' });
  if (prompt) drawText(g, 'A: save picture    B: back to the festival', W / 2, H - 13, { color: C.cream, align: 'center' });
}

export const endCardView = {
  screen: true, t: 0, saved: 0,
  update(game, dt) {
    this.t += dt; if (this.saved > 0) this.saved -= dt;
    const input = game.input, tap = input.taps?.[0];
    if (input.pressed('a') || (tap && tap.x < W / 2)) this.save(game);
    else if (input.pressed('b') || input.pressed('start') || (tap && tap.x >= W / 2)) { game.screen = 'play'; game.startZoneAudio(); }
  },
  draw(game, g) {
    drawCard(game, g, this.t, true);
    if (this.saved > 0) drawText(g, 'Saved!', W / 2, 26, { color: C.acid, align: 'center' });
  },
  /** the card at three times the size, without the prompt, as a PNG download */
  save(game) {
    if (typeof document === 'undefined') return false;
    try {
      const small = document.createElement('canvas'); small.width = W; small.height = H;
      drawCard(game, small.getContext('2d'), this.t, false);
      const big = document.createElement('canvas'); big.width = W * 3; big.height = H * 3;
      const bg = big.getContext('2d'); bg.imageSmoothingEnabled = false; bg.drawImage(small, 0, 0, W * 3, H * 3);
      const a = document.createElement('a'); a.download = 'my-festival-chakrageddon.png'; a.href = big.toDataURL('image/png');
      document.body.appendChild(a); a.click(); a.remove();
      this.saved = 1.5; game.audio?.sfx('select');
      return true;
    } catch { return false; }
  },
};

export function install(game) { game.register('endcard', endCardView); }
