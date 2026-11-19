// The note for saves from before 2.0.0 (two new types, five Astrals retyped, new encounters, a rebalance). Shown once,
// when Continue is chosen on a save that has no `seen200`; the player keeps going or starts again. Nothing is deleted
// here: Keep going loads the save as it is (the field is filled in on load), Start again begins a new trip, which
// replaces the save only when it first saves.
import { W, H } from './CanvasRenderer.js';
import { drawText, wrap, panel, list, C } from './ui.js';
import { tl } from '../core/i18n.js';

const TEXT = [
  'Two new types, SONIC and SACRED, and 24 new Astrals on the routes you know. Every fight was rebalanced around them.',
  'Some of yours changed type: Djembe-Monk and Bongo Bishop are now Stimulant and Sonic, Sirenowl is Bummer and Sonic, Bassilisk is Sonic and Downer, Mandalord is Psychedelic and Sacred. They keep their moves.',
  'Your save still works. Or start again and meet it all from the beach.',
];

export const whatsNewView = {
  screen: true, cursor: 0, confirm: false,
  /** true when the stored save was made before 2.0.0 */
  due(game) {
    try { const raw = game.rawSave(); return !!raw && !('seen200' in JSON.parse(raw)); } catch { return false; }
  },
  update() {},
  draw(game, g) {
    g.fillStyle = C.void; g.fillRect(0, 0, W, H);
    panel(g, 10, 6, W - 20, H - 12, { bg: '#FFF4E4', accent: C.magenta });
    drawText(g, tl('WHAT CHANGED IN 2.0'), W / 2, 13, { color: C.purple, align: 'center' });
    let y = 26;
    if (this.confirm) {
      for (const ln of wrap(tl('Start again from the beach? Your old save stays until the new trip first saves, then it is replaced.'), W - 44)) { drawText(g, ln, 22, y + 20, { color: C.chai }); y += 10; }
    } else for (const para of TEXT) { for (const ln of wrap(tl(para), W - 44)) { drawText(g, ln, 22, y, { color: C.chai }); y += 10; } y += 4; }
    const rows = this.confirm ? [{ label: tl('No, keep my save') }, { label: tl('Yes, start again') }] : [{ label: tl('Keep going') }, { label: tl('Start again') }];
    const r = list(game, g, rows, 20, H - 44, W - 40, this.cursor, { rowH: 16 });
    this.cursor = r.cursor;
    if (this.confirm) {
      if (game.input.pressed('b') || r.chosen === 0) { this.confirm = false; this.cursor = 1; }
      else if (r.chosen === 1) { this.confirm = false; this.cursor = 0; game.newGame(); }
    } else if (r.chosen === 0) {
      if (game.loadGame()) game.save();          // the save now carries seen200, so the note does not come back
      else game.screen = 'title';
    } else if (r.chosen === 1) { this.confirm = true; this.cursor = 0; }
    else if (game.input.pressed('b')) game.screen = 'title';
  },
};

export function install(game) {
  game.register('whatsNew', whatsNewView);
}
