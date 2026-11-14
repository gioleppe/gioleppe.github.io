// End credits: a slow scroll over the kaleidoscope. Shown when the engine emits CREDITS.
import { W, H } from './CanvasRenderer.js';
import { drawText, C } from './ui.js';
import { tl } from '../core/i18n.js';

const LINES = [
  ['CHAKRA-GEDDON', C.yellow], ['The Infinite 7-Day Festival', C.cream], '', '',
  ['You got your passport back.', C.cream], ['You never did find your shoes.', C.cream], '', '',
  ['CAST', C.magenta], 'Prof. Banyan  -  in Goa since 1994, for two weeks', 'Astra-Zero  -  Chad, from the charter flight', 'Chai Mama  -  tired, kind, crochet',
  'DJ Diabolo', 'Guru Svetlana', 'Captain Keta', 'Chef Raju', 'Baron Von Darkpsy', 'Influencer Chloe', 'Baba Smoke', 'The Promoter', 'The Four-on-the-Floor', 'The VIP Shaman Council', '', '',
  ['ASTRALS', C.magenta], 'Forty-one of them. Check your Journal.', '', '',
  ['A SATIRE', C.magenta], 'Nothing here is advice.', 'Drink water. Wear sunscreen.', 'Look after the person next to you.', 'Harm reduction tents are real, and they are heroes.', '', '',
  ['MADE WITH', C.magenta], 'A headless deterministic core, plain JSON,', 'a canvas, one shader, and a synth with no samples.', 'Every sprite drawn by script in Aseprite.', '', '', '',
  ['Thank you for playing.', C.yellow], '', ['The festival goes on.', C.cream],
];

export const creditsView = {
  screen: true, y: 0, t: 0,
  onEvent(game, e) { if (e.type === 'CREDITS') { this.pending = true; } },
  // credits start once the ending dialogue box that triggered them has been dismissed
  poll(game) { if (this.pending && game.screen === 'play') { this.pending = false; this.y = 0; this.t = 0; game.screen = 'credits'; game.audio?.setTrack({ mood: 'CHAI_TENT_WARMTH', bpm: 110 }); game.save(false); } },
  update(game, dt) {
    this.t += dt;
    const fast = game.input.held.a || game.input.held.b;
    this.y += dt * (fast ? 90 : 16);
    const end = LINES.length * 13 + H;
    if (this.y > end + 30 || (this.y > end - 60 && (game.input.pressed('a') || game.input.anyTap()))) {
      // then your festival on one card, to keep (endCardView.js)
      if (game.extra.endcard) { game.input.endFrame?.(); game.extra.endcard.t = 0; game.screen = 'endcard'; } else { game.screen = 'play'; game.startZoneAudio(); }
    }
  },
  draw(game, g) {
    g.fillStyle = C.void; g.fillRect(0, 0, W, H);
    const cols = [C.magenta, C.purple, C.cyan, C.acid];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2 + (game.settings.reducedMotion ? 0 : this.t * 0.1);
      g.strokeStyle = cols[i % 4] + '44'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 + Math.cos(a) * 260, H / 2 + Math.sin(a) * 260); g.stroke();
    }
    LINES.forEach((ln, i) => {
      const y = Math.round(H + i * 13 - this.y);
      if (y < -10 || y > H) return;
      const [text, color] = Array.isArray(ln) ? ln : [ln, C.sand];
      drawText(g, tl(text), W / 2, y, { color, align: 'center', shadow: C.void });
    });
    drawText(g, tl('hold A to hurry'), W - 4, H - 10, { color: '#4A3A80', align: 'right' });
  },
};

export function install(game) {
  game.register('credits', creditsView);
  const update = game.update.bind(game);
  game.update = (dt) => { creditsView.poll(game); update(dt); };
}
