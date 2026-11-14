// An Astral evolving: a full-screen scene, the creature facing you, about thirteen seconds long. The music stops and
// the evolution theme plays (SynthAudio.evolutionTheme): the creature looks at you, goes white, and its old and new
// shapes swap faster and faster while light gathers in, then a white flash and the new form, in colour.
// Started by the battle screen (it drives the scene itself, after a fight) or by an EVOLVED event outside a battle
// (a catalyst from the Fanny Pack: Game runs the scene in place of everything else until it ends).
import { W, H } from './CanvasRenderer.js';
import { drawText, wrap, C, TYPE_COLORS } from './ui.js';
import { tinted } from './anim.js';
import { tl } from '../core/i18n.js';

// the beats of the scene, in seconds
export const EVO = { IN: 0.8, LOOK: 2.6, WHITE: 3.4, FLASH: 10, REVEAL: 10.6, CAN_SKIP: 11.8, END: 13.6, OUT: 0.45 };
const SIZE = 128, CX = W / 2, CY = 74;           // the creature at twice its battle size, in the middle
const ease = (k) => 1 - (1 - Math.max(0, Math.min(1, k))) ** 2;
const quarter = (k) => Math.ceil(Math.max(0, Math.min(1, k)) * 4) / 4;   // white in four steps (cached copies)

export const evolveView = {
  on: false, owner: null, t: 0, ev: null, queue: [],
  busy() { return this.on; },
  reset() { if (this.on) this.stop(null); this.queue = []; },

  /** outside a battle, an evolution plays the scene at once (in a battle the battle screen starts it in turn) */
  onEvent(game, e) {
    if (e.type !== 'EVOLVED' || game.extra?.battle?.on) return;
    if (this.on) this.queue.push(e); else this.start(game, e, 'world');
  },

  /** e: the EVOLVED event. owner: 'battle' (the battle screen drives it) or 'world' (Game does) */
  start(game, e, owner = 'world') {
    this.on = true; this.owner = owner; this.t = 0; this.ev = e; this.ended = false;
    const sp = game.data.dex[e.to];
    this.color = TYPE_COLORS[sp?.types?.[0]] || C.cyan;
    game.audio?.pauseMusic?.();
    game.audio?.evolutionTheme?.(EVO);
  },
  stop(game) {
    this.on = false; this.ev = null;
    if (game) { game.audio?.resumeMusic?.(); if (this.queue.length) this.start(game, this.queue.shift(), this.owner); }
  },

  update(game, dt) {
    if (!this.on) return;
    this.t += dt;
    const input = game.input;
    // nothing hurries the change; once the new form is there, A (or a tap) moves on
    if (!this.ended && this.t >= EVO.CAN_SKIP && (input.pressed('a') || input.pressed('b') || input.anyTap?.())) this.ended = this.t;
    if (!this.ended && this.t >= EVO.END) this.ended = this.t;
    if (this.ended && this.t - this.ended >= EVO.OUT) this.stop(game);
  },

  draw(game, g) {
    if (!this.on) return;
    const t = this.t, e = this.ev, still = !!game.settings.reducedMotion, calm = still || !!game.settings.grounded;
    const imgOld = game.images[`mon:${e.from}`], imgNew = game.images[`mon:${e.to}`];
    // the screen behind fades to night (in a battle, the field; elsewhere it starts dark)
    const dark = this.owner === 'battle' ? Math.min(1, t / EVO.IN) : 1;
    g.fillStyle = `rgba(11,3,20,${dark})`; g.fillRect(0, 0, W, H);
    if (t < EVO.IN * 0.6 && this.owner === 'battle') return;

    const build = Math.max(0, Math.min(1, (t - EVO.WHITE) / (EVO.FLASH - EVO.WHITE)));   // 0..1 through the change
    const after = t >= EVO.REVEAL;
    g.save();
    // a little shake as it peaks
    if (!still && !after && build > 0.8) g.translate(Math.round(Math.sin(t * 70) * (build > 0.93 ? 2 : 1)), 0);
    // rays turning behind it: few and dim at first, more and brighter as the change builds; the new form's colour after
    const rays = after ? 16 : 6 + Math.round(build * 10), spin = still ? 0 : t * (0.2 + build * 1.4);
    g.globalAlpha = after ? 0.35 : 0.1 + build * 0.2;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + spin, w = 0.07;
      g.fillStyle = i % 2 ? this.color : '#8F00FF';
      g.beginPath(); g.moveTo(CX, CY);
      g.lineTo(CX + Math.cos(a - w) * 260, CY + Math.sin(a - w) * 260); g.lineTo(CX + Math.cos(a + w) * 260, CY + Math.sin(a + w) * 260);
      g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
    // light gathering in: rings closing on it, and motes drawn to the middle
    if (!after && t > EVO.LOOK * 0.6) {
      for (let k = 0; k < 3; k++) {
        const p = still ? (k + 1) / 4 : ((t * (0.5 + build)) + k / 3) % 1, r = 150 * (1 - p) + 20;
        g.strokeStyle = k % 2 ? this.color : '#FFFFFF'; g.globalAlpha = 0.25 + 0.5 * p * (0.4 + build); g.lineWidth = 1 + Math.round(build * 2);
        g.beginPath(); g.arc(CX, CY, r, 0, Math.PI * 2); g.stroke();
      }
      for (let i = 0; i < 18; i++) {
        const a = i * 2.39996, p = still ? 0.5 : ((t * (0.35 + build * 0.9)) + i / 18) % 1, r = 170 * (1 - ease(p));
        g.globalAlpha = Math.min(1, p * 2) * (0.5 + build * 0.5);
        g.fillStyle = i % 3 ? '#FFFFFF' : this.color;
        g.fillRect(Math.round(CX + Math.cos(a) * r), Math.round(CY + Math.sin(a) * r * 0.7), 2, 2);
      }
      g.globalAlpha = 1;
    }
    // the creature, facing you
    const breathe = still ? 0 : Math.floor(t * 2) % 2;
    if (!after) {
      if (imgOld || imgNew) {
        let img = imgOld || imgNew, white = 0, sc = 1;
        if (t >= EVO.LOOK) {
          white = quarter((t - EVO.LOOK) / (EVO.WHITE - EVO.LOOK));
          if (t >= EVO.WHITE) {
            // old and new shapes swap, slowly and then faster and faster; with reduced motion, at a steady pace
            const k = build, elapsed = t - EVO.WHITE;
            const n = Math.floor(still ? elapsed / 0.6 : swaps(elapsed, EVO.FLASH - EVO.WHITE));
            img = (n % 2 === 1 ? imgNew : imgOld) || img;
            sc = still ? 1 : 1 + Math.sin(t * (4 + k * 18)) * 0.04 * (0.5 + k);
          }
        }
        // a glow behind it as the change peaks
        if (build > 0.5 && !calm) { g.globalAlpha = (build - 0.5) * 0.3; g.fillStyle = this.color; g.beginPath(); g.arc(CX, CY, 30 + build * 20, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
        const s = Math.round(SIZE * sc), dx = Math.round(CX - s / 2), dy = Math.round(CY - s / 2);
        if (white > 0) g.drawImage(tinted(img, breathe * 64, 0, 64, 64, '#FFFFFF', white), dx, dy, s, s);
        else g.drawImage(img, breathe * 64, 0, 64, 64, dx, dy, s, s);
      }
    } else if (imgNew) {
      // the new form, in colour; it settles in from a little bigger
      const k = Math.min(1, (t - EVO.REVEAL) / 0.5), s = Math.round(SIZE * (still ? 1 : 1.12 - 0.12 * ease(k)));
      g.drawImage(imgNew, breathe * 64, 0, 64, 64, Math.round(CX - s / 2), Math.round(CY - s / 2), s, s);
      // sparkles flying out
      if (!still) {
        for (let i = 0; i < 22; i++) {
          const a = i * 2.39996, p = Math.min(1, (t - EVO.REVEAL) * 0.7 + (i % 5) * 0.04), r = 30 + ease(p) * 130;
          g.globalAlpha = Math.max(0, 1 - p); g.fillStyle = i % 2 ? this.color : C.yellow;
          const sx = Math.round(CX + Math.cos(a) * r), sy = Math.round(CY + Math.sin(a) * r * 0.75);
          g.fillRect(sx - 1, sy, 3, 1); g.fillRect(sx, sy - 1, 1, 3);
        }
        g.globalAlpha = 1;
      }
    }
    g.restore();
    // the flash: white floods in and drains away (reduced motion: a soft fade instead)
    if (t >= EVO.FLASH - 0.4 && t < EVO.REVEAL + 0.9) {
      const k = t < EVO.FLASH ? (t - (EVO.FLASH - 0.4)) / 0.4 : t < EVO.REVEAL ? 1 : 1 - (t - EVO.REVEAL) / 0.9;
      g.fillStyle = `rgba(255,255,255,${Math.max(0, Math.min(1, k)) * (calm ? 0.6 : 1)})`; g.fillRect(0, 0, W, H);
    }
    // the words, at the bottom
    const text = after ? tl('{0} became {1}!', e.oldName, e.newName) : t >= EVO.WHITE ? tl('What? {0} is changing!', e.oldName) : t >= EVO.IN ? tl('Huh? {0} is looking at you strangely...', e.oldName) : '';
    if (text) {
      const lines = wrap(text, W - 40), y0 = H - 8 - lines.length * 10;
      g.fillStyle = 'rgba(11,3,20,0.75)'; g.fillRect(0, y0 - 5, W, H - y0 + 5);
      lines.forEach((ln, i) => drawText(g, ln, CX, y0 + i * 10, { color: after ? C.yellow : C.cream, align: 'center' }));
      if (t >= EVO.CAN_SKIP && !this.ended && Math.floor(t * 2.5) % 2 === 0) { g.fillStyle = C.magenta; g.fillRect(W - 14, H - 9, 5, 1); g.fillRect(W - 13, H - 8, 3, 1); g.fillRect(W - 12, H - 7, 1, 1); }
    }
    // and out
    if (this.ended) { g.fillStyle = `rgba(11,3,20,${Math.min(1, (t - this.ended) / EVO.OUT)})`; g.fillRect(0, 0, W, H); }
  },
};

/** how many times the shapes have swapped after `elapsed` seconds of a change lasting `span`: the swap rate climbs
 *  from about one a second to about twenty (the integral of the rate, so the count only ever goes up) */
export function swaps(elapsed, span) {
  const k = Math.max(0, Math.min(1, elapsed / span));
  return span * (1.3 * k + 5 * k ** 4);
}

export function install(game) { game.register('evolve', evolveView); }
