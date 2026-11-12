// Flea market stall: buy and sell.
import { W, H } from './CanvasRenderer.js';
import { drawText, wrap, panel, list, C } from './ui.js';

export const shopView = {
  tab: 0, cursor: 0,
  onEvent(game, e) { if (e.type === 'TRANSITION_MODE' && e.to === 'SHOP') { this.tab = 0; this.cursor = 0; } },
  draw(game, g) {
    const s = game.engine.state;
    if (s.mode !== 'SHOP') return;
    const d = game.data, input = game.input, shop = d.rules.shops[s.shop];
    g.fillStyle = 'rgba(11,3,20,0.55)'; g.fillRect(0, 0, W, H);
    panel(g, 6, 6, W - 12, H - 12, { bg: '#FFF4E4', accent: C.marigold });
    // striped awning
    for (let x = 8; x < W - 8; x += 16) { g.fillStyle = (x / 16) % 2 ? C.terracotta : C.cream; g.fillRect(x, 8, Math.min(16, W - 8 - x), 10); }
    drawText(g, shop.name, 14, 22, { color: C.chai });
    drawText(g, `Rs ${s.rupees}`, W - 14, 22, { color: C.chai, align: 'right' });
    const tabs = ['Buy', 'Sell', 'Leave'];
    tabs.forEach((t, i) => {
      const x = 14 + i * 50;
      if (input.tapIn(x, 33, 46, 13)) { if (i === 2) return game.send({ type: 'CLOSE_SHOP' }); this.tab = i; this.cursor = 0; }
      g.fillStyle = i === this.tab ? C.magenta : '#E8D8C0'; g.fillRect(x, 33, 46, 13);
      drawText(g, t, x + 23, 36, { color: i === this.tab ? C.white : C.chai, align: 'center' });
    });
    if (input.pressed('left')) { this.tab = Math.max(0, this.tab - 1); this.cursor = 0; }
    if (input.pressed('right')) { this.tab = Math.min(1, this.tab + 1); this.cursor = 0; }
    const ids = this.tab === 0 ? shop.items : Object.keys(s.bag).filter((id) => s.bag[id] > 0 && d.items[id].price > 0 && d.items[id].category !== 'KEY');
    if (!ids.length) drawText(g, 'Nothing to sell.', 14, 54, { color: C.grey });
    const items = ids.map((id) => {
      const it = d.items[id], price = this.tab === 0 ? it.price : Math.floor(it.price / 2);
      return { label: it.name, right: `${this.tab === 1 ? `x${s.bag[id]}  ` : ''}Rs ${price}`, disabled: this.tab === 0 && s.rupees < price };
    });
    const r = list(game, g, items, 10, 50, 190, this.cursor, { rowH: 13, maxRows: 8 });
    this.cursor = r.cursor;
    const it = d.items[ids[Math.min(this.cursor, ids.length - 1)]];
    if (it) {
      wrap(it.desc, 100).slice(0, 6).forEach((ln, i) => drawText(g, ln, 208, 52 + i * 10, { color: C.chai }));
      drawText(g, `You have ${s.bag[it.id] || 0}`, 208, 120, { color: C.purple });
    }
    drawText(g, 'A: one   B: leave', 14, H - 20, { color: C.grey });
    if (r.chosen >= 0) game.send({ type: this.tab === 0 ? 'BUY' : 'SELL', itemId: ids[r.chosen], n: 1 });
    else if (input.pressed('b') || input.pressed('start')) game.send({ type: 'CLOSE_SHOP' });
  },
};

export function install(game) { game.register('shop', shopView); }
