// The item HUD (step 3.4): the six-slot hotbar at the bottom centre, the item notices above it, and on desktop
// a small "E + icon" prompt over the current interaction target. Reads the simulation; acts only through input
// (slot taps select, a long press drops).
//
// Wiring (src/main.js): `const itemHud = installItemHud({ input, assets, tuning })` once the game has loaded;
// `itemHud.onStep(sim)` after every sim.step; `itemHud.frame(sim)` every frame (context icon of the touch
// button); `itemHud.drawPrompt(ctx, sim, camera)` on #ui. HUD.js draws the hotbar and notices as two widgets.
import { Notices, registerNotice, NOTICE_COLORS } from '../Notices.js';
import { TOUCH_ICONS } from '../../engine/input/icons.js';
import { drawDarkPanel } from './uiArt.js';

/** sizes in logical pixels (slot: the ui sheet's 20 x 20 `slot` frames, item at +2,+2) */
export const HOTBAR = Object.freeze({ slots: 6, slot: 20, gap: 2, margin: 4, clear: 4 });
/** ui-sheet glyph for each context icon id the sim gives (input/icons.js ids) */
export const CONTEXT_GLYPHS = Object.freeze({ hand: 'hand', eye: 'eye_inspect', speech: 'speech', offering: 'offering' });

/** palette colours (assets/src/palette.gpl names) */
const C = Object.freeze({
  ink: '#0d0b12', frame: '#4f4955', frameLit: '#8f8789', selected: '#f2a33a', text: '#e9e2cf', dim: '#8f8789', on: '#6ff3ff',
});

/**
 * Where the six slots go: bottom centre of the safe area; with the touch controls showing, raised above any thumb
 * button or the joystick hint that would overlap it.
 * @param {{ width: number, height: number }} view #ui size in logical pixels
 * @param {{ top?: number, right?: number, bottom?: number, left?: number }} safe
 * @param {import('../../engine/input/touchLayout.js').TouchLayout|null} [touch] the touch layout when it is showing
 * @returns {{ x: number, y: number, w: number, h: number, slots: Array<{x:number,y:number,w:number,h:number}> }}
 */
export function hotbarLayout(view, safe, touch = null) {
  const { slots, slot, gap, margin, clear } = HOTBAR;
  const left = safe?.left || 0;
  const right = view.width - (safe?.right || 0);
  // a window too narrow for one row (a phone held upright) gets two or more rows (step 5.6)
  const cols = Math.max(1, Math.min(slots, Math.floor((right - left - 4 + gap) / (slot + gap))));
  const rows = Math.ceil(slots / cols);
  const w = cols * slot + (cols - 1) * gap;
  const h = rows * slot + (rows - 1) * gap;
  const x = Math.round((left + right - w) / 2);
  let y = Math.round(view.height - (safe?.bottom || 0) - margin - h);
  if (touch) {
    const circles = touch.buttons.map((b) => ({ x: b.x, y: b.y, r: b.r }));
    circles.push({ x: touch.joystickRest.x, y: touch.joystickRest.y, r: touch.joystick.ringRadius });
    for (const c of circles) {
      const nx = Math.max(x, Math.min(x + w, c.x));
      if (Math.abs(nx - c.x) >= c.r + clear) continue;   // beside the bar: no conflict
      if (y > c.y - c.r - clear - h) y = Math.floor(c.y - c.r - clear - h);
    }
  }
  const rects = [];
  for (let i = 0; i < slots; i++) rects.push({ x: x + (i % cols) * (slot + gap), y: y + Math.floor(i / cols) * (slot + gap), w: slot, h: slot });
  return { x, y, w, h, slots: rects };
}

// ---- notices for item events -------------------------------------------------------------------------------

const nameOf = (sim, id) => sim?.catalog?.get(id)?.name ?? id;
const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
registerNotice('item_picked', (e, sim) => (e.n > 1 ? `Took ${e.n} x ${lower(nameOf(sim, e.item))}` : `Took the ${lower(nameOf(sim, e.item))}`));
registerNotice('inventory_full', (e, sim) => ({ text: `No room: the ${lower(nameOf(sim, e.item))} stays here`, color: NOTICE_COLORS.warn, key: 'full' }));
registerNotice('item_dropped', (e, sim) => `Dropped the ${lower(nameOf(sim, e.item))}`);
registerNotice('drop_refused', (e) => (e.reason === 'swimming' ? { text: 'Not here: it would sink', color: NOTICE_COLORS.warn } : null));
registerNotice('item_used', (e, sim) => (e.use === 'drink' ? `Drank the ${lower(nameOf(sim, e.item))}` : `Used the ${lower(nameOf(sim, e.item))}`));
registerNotice('item_cannot_use', (e, sim) => {
  if (e.reason === 'empty_hands') return { text: 'Nothing in hand', color: NOTICE_COLORS.dim, key: 'use' };
  if (e.reason === 'not_carried') return { text: 'No flashlight', color: NOTICE_COLORS.dim, key: 'use' };
  return { text: `The ${lower(nameOf(sim, e.item))} has no use here`, color: NOTICE_COLORS.dim, key: 'use' };
});
registerNotice('power', (e, sim) => ({ text: `${nameOf(sim, e.item)} ${e.on ? 'on' : 'off'}`, key: `power:${e.item}` }));
registerNotice('site_inspected', () => 'You search the place');
registerNotice('container_empty', () => ({ text: 'Nothing more here', color: NOTICE_COLORS.dim }));
registerNotice('channel_start', (e) => (e.action === 'spring' ? 'You drink from the spring' : null));
registerNotice('channel_end', (e) => (e.action === 'spring' && e.reason === 'done' ? 'Water, cold and clean' : null));
registerNotice('interact', (e) => (e.stub ? { text: 'Nothing happens yet', color: NOTICE_COLORS.dim, key: 'stub' } : null));

// ---- the HUD object -----------------------------------------------------------------------------------------

/** short verb for the desktop prompt */
export function promptLabel(sim, target) {
  if (!target) return '';
  switch (target.action) {
    case 'pickup': return target.n > 1 ? `${nameOf(sim, target.item)} x${target.n}` : nameOf(sim, target.item);
    case 'container': return sim.interactables.flag(target.id, 'inspected') ? 'Search' : 'Inspect';
    case 'spring': return 'Drink';
    case 'talk': return 'Talk';
    case 'totem': return 'Totem';
    default: return target.action.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }
}

/**
 * Top of the desktop prompt (step 5.6): above a standing figure (48 px) for sites and people, just above the item
 * for pickups; but never over the player: a prompt that would cover the player's sprite (a pickup at their feet)
 * goes above their head instead.
 * @param {{ action: string }} t the target
 * @param {{x:number,y:number}} s the target on screen
 * @param {{x:number,y:number}|null} p the player's feet on screen
 * @param {number} w @param {number} h the prompt's size
 * @param {number} [gapAbove] how far above the target a site's prompt sits (66 with art, 40 without)
 */
export function promptTop(t, s, p, w, h, gapAbove = 66, gapPickup = 38) {
  let y = Math.round(s.y - (t.action === 'pickup' ? gapPickup : gapAbove));
  if (p) {
    const PLAYER = { halfW: 10, h: 50 };
    const overlapX = Math.abs(s.x - p.x) < w / 2 + PLAYER.halfW;
    const overlapY = y < p.y && y + h > p.y - PLAYER.h;
    if (overlapX && overlapY) y = Math.min(y, Math.round(p.y - PLAYER.h - h - 2));
  }
  return y;
}

let active = null;

export class ItemHud {
  /**
   * @param {{ input: import('../../engine/InputManager.js').InputManager, assets: { drawIcon: Function }, tuning: Object }} opts
   */
  constructor({ input, assets, tuning }) {
    this.input = input;
    this.assets = assets;
    this.notices = new Notices();
    this.layout = null;
    /** @type {import('../../sim/Sim.js').Sim|null} the sim last drawn (for the hit regions' long press) */
    this.sim = null;
    const longPressMs = tuning.inventory.dropLongPressMs;
    for (let i = 0; i < HOTBAR.slots; i++) {
      input.addHitRegion(`hotbar${i}`, () => this.layout?.slots[i] ?? null, () => input.selectHotbar(i), {
        longPressMs,
        onLongPress: () => {
          // drop that slot's stack: select it first unless it is already in hand (selecting it again would deselect)
          if (this.sim?.inventory.selected !== i) input.selectHotbar(i);
          input.trigger('drop');
        },
      });
    }
  }

  /** after every sim.step: notices from its events */
  onStep(sim) {
    this.notices.fromEvents(sim.events, sim);
  }

  /** every frame: the touch context button follows the interaction target */
  frame(sim) {
    this.sim = sim;
    this.input.setContext(sim.interactIcon ?? null);
  }

  /** the hotbar and the notices (from HUD.js) */
  draw(ctx, sim, vp, safe) {
    this.sim = sim;
    const touch = this.input.touchVisible ? this.input.layout : null;
    const L = (this.layout = hotbarLayout({ width: vp.uiLogicalWidth, height: vp.uiLogicalHeight }, safe, touch));
    this.noticeW = vp.uiLogicalWidth - (safe?.left || 0) - (safe?.right || 0) - 8;
    const inv = sim.inventory;
    if (!inv) return;
    ctx.save();
    ctx.font = '5px ui-monospace, Consolas, monospace';
    const art = this.assets?.hasIcon?.('ui', 'slot') ? this.assets : null;
    for (let i = 0; i < L.slots.length; i++) {
      const r = L.slots[i];
      const s = inv.slots[i];
      const sel = inv.selected === i;
      if (art) {
        this.drawSlotArt(ctx, art, r, s, sel, i);
        continue;
      }
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = C.ink;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = sel ? C.selected : s ? C.frameLit : C.frame;
      const t = sel ? 2 : 1;
      ctx.fillRect(r.x, r.y, r.w, t);
      ctx.fillRect(r.x, r.y + r.h - t, r.w, t);
      ctx.fillRect(r.x, r.y, t, r.h);
      ctx.fillRect(r.x + r.w - t, r.y, t, r.h);
      if (s) {
        this.assets.drawIcon(ctx, 'items', s.id, r.x + 1, r.y + 1);
        if (s.n > 1) {
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = C.ink;
          ctx.fillText(String(s.n), r.x + r.w - 1, r.y + r.h);
          ctx.fillStyle = C.text;
          ctx.fillText(String(s.n), r.x + r.w - 2, r.y + r.h - 1);
        }
        if (s.on) {
          ctx.fillStyle = C.ink;
          ctx.fillRect(r.x + r.w - 6, r.y + 2, 4, 4);
          ctx.fillStyle = C.on;
          ctx.fillRect(r.x + r.w - 5, r.y + 3, 2, 2);
        }
      }
      if (!this.input.touchVisible) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = sel ? C.selected : C.dim;
        ctx.fillText(String(i + 1), r.x + 2, r.y + 1);
      }
    }
    // the name of what is in hand, just above the bar
    const held = inv.held;
    ctx.font = '6px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    if (held) {
      ctx.fillStyle = C.text;
      ctx.fillText(nameOf(sim, held.id), L.x + L.w / 2, L.y - 1);
    } else if (inv.slots.some(Boolean)) {
      // step 5.6: say so when nothing is in hand (holding metal provokes the scouts; tapping the selected slot again
      // empties the hands)
      const tw = Math.ceil(ctx.measureText('empty hands').width) + 6;
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = C.ink;
      ctx.fillRect(Math.round(L.x + L.w / 2 - tw / 2), L.y - 8, tw, 7);
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.text;
      ctx.fillText('empty hands', L.x + L.w / 2, L.y - 1);
    }
    ctx.restore();
  }

  /**
   * One slot from the ui sheet (ICONS.md "Hotbar"): `slot` / `slot_selected` / `slot_empty`, the item at +2,+2,
   * its count in the 4 x 6 digits right-aligned in the item's clear corner, an amber "on" dot for powered
   * electronics, and on desktop the slot's key in the top-left corner.
   */
  drawSlotArt(ctx, art, r, s, sel, i) {
    art.drawIcon(ctx, 'ui', s ? (sel ? 'slot_selected' : 'slot') : sel ? 'slot_selected' : 'slot_empty', r.x, r.y);
    if (s) {
      art.drawIcon(ctx, 'items', s.id, r.x + 2, r.y + 2);
      if (s.n > 1) {
        const t = String(s.n);
        art.drawGlyphs(ctx, t, r.x + 19 - t.length * 4, r.y + 13);
      }
      if (s.on) {
        ctx.fillStyle = C.ink;
        ctx.fillRect(r.x + 14, r.y + 14, 4, 4);
        ctx.fillStyle = C.selected;
        ctx.fillRect(r.x + 15, r.y + 15, 2, 2);
      }
    }
    if (!this.input.touchVisible && !s) art.drawGlyphs(ctx, String(i + 1), r.x + 8, r.y + 7);
  }

  /** the item notices, just above the hotbar (and its held-item name) drawn this frame */
  drawNotices(ctx, sim) {
    const L = this.layout;
    if (!L) return;
    this.notices.draw(ctx, L.x + L.w / 2, L.y - (sim.inventory?.held || sim.inventory?.slots?.some(Boolean) ? 9 : 2), undefined, this.noticeW ?? Infinity);
  }

  /**
   * Desktop only: "E" and the context icon over the interaction target, with a short label.
   * @param {CanvasRenderingContext2D} ctx #ui context in logical pixels
   */
  drawPrompt(ctx, sim, camera) {
    const t = sim.interactTarget;
    if (!t || this.input.touchVisible || !camera) return;
    const s = camera.worldToScreen(t.x, t.y);
    const label = promptLabel(sim, t);
    const glyph = CONTEXT_GLYPHS[sim.interactIcon ?? 'hand'] ?? 'hand';
    if (this.assets?.hasIcon?.('ui', glyph)) {
      this.drawPromptArt(ctx, s, t, label, glyph, camera.worldToScreen(sim.player.x, sim.player.y));
      return;
    }
    ctx.save();
    ctx.font = '6px ui-monospace, Consolas, monospace';
    const tw = Math.ceil(ctx.measureText(label).width);
    const w = 7 + 10 + tw + 4;
    const h = 10;
    const x = Math.round(s.x - w / 2);
    const y = promptTop(t, s, camera.worldToScreen(sim.player.x, sim.player.y), w, h, 40, 32);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = C.ink;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.selected;
    ctx.fillRect(x + 1, y + 1, 7, 8);
    ctx.fillStyle = C.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('E', x + 4.5, y + 5.5);
    ctx.fillStyle = C.text;
    TOUCH_ICONS[sim.interactIcon ?? 'hand']?.(ctx, x + 13, y + 5, 8);
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 18, y + 5.5);
    ctx.restore();
  }

  /** the prompt on the dark plate: an amber key chip, the context glyph (24 px art at half size) and the label */
  drawPromptArt(ctx, s, t, label, glyph, player = null) {
    ctx.save();
    ctx.font = '6px ui-monospace, Consolas, monospace';
    const tw = Math.ceil(ctx.measureText(label).width);
    const h = 16;
    const w = 26 + tw + 6;
    const x = Math.round(s.x - w / 2);
    const y = promptTop(t, s, player, w, h);
    drawDarkPanel(ctx, x, y, w, h, this.assets);
    ctx.fillStyle = C.ink;
    ctx.fillRect(x + 3, y + 3, 9, 10);
    ctx.fillStyle = C.selected;
    ctx.fillRect(x + 4, y + 4, 7, 8);
    ctx.fillStyle = C.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('E', x + 7.5, y + 8.5);
    this.assets.drawIcon(ctx, 'ui', glyph, x + 13, y + 2, 12, 12);
    ctx.fillStyle = C.text;
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 27, y + 8.5);
    ctx.restore();
  }
}

/**
 * Create the item HUD (once the input exists) and make it the one HUD.js draws.
 * @returns {ItemHud}
 */
export function installItemHud(opts) {
  active = new ItemHud(opts);
  return active;
}

/** the hotbar and notices, when installed (the two HUD widgets below in one call) */
export function drawHotbar(ctx, sim, vp, safe) {
  active?.draw(ctx, sim, vp, safe);
  active?.drawNotices(ctx, sim);
}

/** HUD widget (see HUD.js): the six slots, when the item HUD is installed */
export const hotbarWidget = Object.freeze({
  id: 'hotbar',
  draw(ctx, sim, { vp, safe }) {
    if (sim) active?.draw(ctx, sim, vp, safe);
  },
});

/** HUD widget: the item notices above the hotbar (after hotbarWidget, which lays the bar out) */
export const noticesWidget = Object.freeze({
  id: 'notices',
  draw(ctx, sim) {
    if (sim) active?.drawNotices(ctx, sim);
  },
});
