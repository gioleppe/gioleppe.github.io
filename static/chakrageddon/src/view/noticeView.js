// First-launch content notice: what this is, the flashing-effects warning, and grounded mode up front.
import { W, H } from './CanvasRenderer.js';
import { drawText, wrap, panel, list, C } from './ui.js';

const TEXT = [
  'This is a satire about a festival. It is full of jokes about drugs and the people who take them. It is fiction, not advice, and it is meant for adults.',
  'Some scenes use moving, wobbling and flashing screen effects. Grounded mode keeps the picture steady. You can change it any time in Options.',
];

export const noticeView = {
  screen: true, cursor: 0,
  update() {},
  draw(game, g) {
    g.fillStyle = C.void; g.fillRect(0, 0, W, H);
    panel(g, 10, 6, W - 20, H - 12, { bg: '#FFF4E4', accent: C.magenta });
    drawText(g, 'BEFORE YOU GO IN', W / 2, 13, { color: C.purple, align: 'center' });
    let y = 27;
    for (const para of TEXT) { for (const ln of wrap(para, W - 44)) { drawText(g, ln, 22, y, { color: C.chai }); y += 10; } y += 5; }
    const r = list(game, g, [{ label: 'Play with effects' }, { label: 'Play in grounded mode (steady picture)' }], 20, H - 46, W - 40, this.cursor, { rowH: 17 });
    this.cursor = r.cursor;
    if (r.chosen >= 0) {
      game.settings.grounded = r.chosen === 1;
      game.settings.noticeSeen = true;
      game.saveSettings();
      game.screen = 'title';
    }
  },
};

export function install(game) {
  game.register('notice', noticeView);
  if (!game.settings.noticeSeen) game.screen = 'notice';
}
