// Astral battle screen. Plays back the engine's event queue (messages, damage, faints...) and
// shows the command menus when the engine is waiting for the player. Decides no rules.
import { W, H } from './CanvasRenderer.js';
import { drawText, wrap, textWidth, panel, list, bar, typeTag, moveName, C, TYPE_COLORS } from './ui.js';
import { statsOf, nameOf } from '../core/mons.js';
import { moveCost } from '../core/BattleEngine.js';
import { isNight } from '../core/OverworldEngine.js';
import { drawBackdrop, backdropOf, SPOT } from './battleFx.js';
import { lookOf, durationOf, drawMoveFx, MARK_SECONDS, WINDUP } from './moveFx.js';
import { tinted } from './anim.js';
import { termRuns } from './glossary.js';

const EVOLVE_SECONDS = 2.6;

const BOX_Y = 132, BOX_H = 46;
const STATUS_TAG = { COTTONMOUTH: ['DRY', '#F4A261'], K_HOLED: ['K-HOLE', '#7FD6FF'], THOUGHT_LOOP: ['LOOP', '#C86BFF'], EGO_DEATH: ['EGO', '#7C8CD9'], JAW_LOCK: ['JAW', '#FFD23F'] };
const MAIN = ['FIGHT', 'BAG', 'ASTRALS', 'RUN'];
const ctxOf = (game) => ({ data: game.data, state: game.engine.state });
/** per-side pose timers, all counting down to 0 (faint counts up): lunge (recoil as it fires), hit, dash (into the
 *  target, dashLen long), crouch (winding up), knock (knocked back), shrug, flip (upside down), ghost (afterimages), gest (a hop) */
const POSE = () => ({ lunge: 0, hit: 0, faint: 0, dash: 0, dashLen: 0.3, crouch: 0, knock: 0, shrug: 0, flip: 0, ghost: 0, gest: 0 });
const TIMERS = ['dash', 'crouch', 'knock', 'shrug', 'flip', 'ghost', 'gest'];
const KNOCK = 0.4, SHRUG = 0.5, CHART_FLIP = 0.9;

export const battleView = {
  on: false, queue: [], cur: null, disp: { p: null, e: null }, t: 0, intro: 0, outro: 0,
  menu: 'main', cursor: { main: 0, moves: 0, bag: 0, party: 0, learn: 0, shift: 0 }, pendingItem: null, learn: null,
  fx: { p: POSE(), e: POSE() }, shake: 0, flash: 0, capture: null, info: null, loop: { p: false, e: false },

  effects: [], portrait: 0, move: null, pending: null, chartFlip: 0,
  reset() { this.on = false; this.queue = []; this.cur = null; this.effects = []; this.portrait = 0; this.move = null; this.pending = null; this.chartFlip = 0; },
  busy() { return this.on; },

  onEvent(game, e) {
    if (e.type === 'BATTLE_START') {
      this.on = true; this.queue = []; this.cur = null; this.intro = 1; this.outro = 0; this.menu = 'main'; this.capture = null; this.learn = null;
      this.disp = { p: { ...e.player }, e: { ...e.enemy } };
      this.info = { kind: e.kind, trainerName: e.trainerName, trainerSprite: e.trainerSprite, boss: e.boss, paletteId: e.paletteId };
      this.effects = []; this.portrait = e.kind === 'trainer' && e.trainerSprite ? 2.2 : 0;   // the trainer shows up before their Astral
      this.fx = { p: POSE(), e: POSE() }; this.move = null; this.pending = null; this.chartFlip = 0;
      this.loop = { p: false, e: false };
      game.audio?.sfx('encounter');
      return;
    }
    if (this.on) this.queue.push(e);
  },

  // ------------------------------------------------------------ playback
  next(game) {
    const e = this.queue.shift();
    if (!e) { this.cur = null; return; }
    const d = this.disp;
    switch (e.type) {
      case 'MESSAGE': this.cur = { type: 'msg', lines: wrap(e.text, W - 28), shown: 0, hold: 0 }; break;
      case 'STAT_DELTA': {
        const t = d[e.targetId];
        if (e.stat === 'SEROTONIN') {
          this.cur = { type: 'tween', side: e.targetId, from: t.hp, to: e.current, t: 0 };
          t.maxHp = e.max;
          if (e.delta < 0) { this.fx[e.targetId].hit = 0.3; this.shake = Math.max(this.shake, 0.18); this.landed(e.targetId); game.audio?.sfx('hit'); }
          else {
            this.mark('sparkle', { side: e.targetId });
            const m = this.move;
            if (m?.drain && m.hits > 0 && e.targetId === m.from) this.mark('drain', { from: m.to, to: m.from });   // serotonin flows back
            game.audio?.sfx('heal');
          }
        } else { t.hyd = e.current; t.maxHyd = e.max; if (e.delta > 0) this.mark('sparkle', { side: e.targetId }); this.next(game); }
        break;
      }
      case 'BATTLE_MOVE_USED': this.startMove(game, e); break;
      case 'MOVE_HIT': this.hitMove(game, e); break;
      case 'STAT_STAGE': this.mark('arrow', { side: e.targetId, delta: e.delta ?? 0 }); this.next(game); break;
      case 'FIELD_EFFECT': if (e.effect === 'INVERT_TYPE_CHART') this.chartFlip = e.turns > 0 ? CHART_FLIP : CHART_FLIP * 0.6; this.next(game); break;
      case 'SWITCH_IN': d[e.side] = { ...e.mon }; this.fx[e.side] = POSE(); this.loop[e.side] = false; this.cur = { type: 'wait', t: 0.25 }; break;
      case 'SYNC': d[e.side] = { ...d[e.side], ...e.mon }; this.next(game); break;
      case 'STATUS_APPLIED': this.mark('status', { side: e.targetId, status: e.status }); if (e.status === 'THOUGHT_LOOP') this.loop[e.targetId] = true; else d[e.targetId].status = e.status; game.audio?.sfx('status'); this.next(game); break;
      case 'STATUS_CLEARED': if (e.status === 'THOUGHT_LOOP') this.loop[e.targetId] = false; else d[e.targetId].status = null; this.next(game); break;
      case 'CRITICAL': this.flash = 0.25; this.next(game); break;
      case 'FAINT': this.fx[e.side].faint = 0.001; this.cur = { type: 'wait', t: 0.5 }; break;
      case 'CAPTURE_THROW': this.capture = { t: 0, shakes: e.shakes, success: e.success }; this.cur = { type: 'capture' }; game.audio?.sfx('throw'); break;
      case 'LEVEL_UP': if (d.p && d.p.uid === e.uid) d.p = { ...d.p, ...e.mon }; this.next(game); break;
      case 'EVOLVED':
        // the creature on screen gets the full sequence; one on the bench just changes
        if (d.p && d.p.uid === e.uid) this.cur = { type: 'evolve', t: 0, from: e.from, to: e.to, name: e.newName };
        else { this.flash = 0.6; this.cur = { type: 'wait', t: 0.6 }; }
        break;
      case 'LEARN_PROMPT': this.learn = e; this.cursor.learn = 0; this.next(game); break;
      case 'BATTLE_END': if (e.result === 'LOST') game.cue?.('WHITEOUT'); if (e.result === 'WON' || e.result === 'CAUGHT') this.happy = 0.9; this.cur = { type: 'outro', t: 0 }; break;
      default: this.next(game);
    }
  },

  /** a move starts: the user winds up while "X used Y!" types out; a status move plays its whole look now */
  startMove(game, e) {
    const mv = game.data.moves[e.moveId] || {}, fx = lookOf(mv), effects = mv.effects || [];
    const self = mv.power === 0 && effects.length > 0 && effects.every((x) => x.target === 'self' || ['HEAL', 'HYDRATE'].includes(x.effectType));
    const kind = mv.power > 0 ? 'windup' : 'status', to = self ? e.actorId : e.actorId === 'p' ? 'e' : 'p';
    this.move = { id: e.moveId, fx, from: e.actorId, to, drain: effects.some((x) => x.effectType === 'DRAIN_SEROTONIN'), hits: 0 };
    this.effects.push({ kind, fx, from: e.actorId, to, t: 0, dur: durationOf(kind, fx) });
    const f = this.fx[e.actorId];
    if (fx.motion === 'ghost') f.ghost = 0.9;
    else if (kind === 'status' || fx.motion === 'gesture') f.gest = 0.5;
    else if (fx.motion === 'contact') f.crouch = WINDUP;
    else f.lunge = 0.28;
    game.cue?.(e.shaderCue); game.audio?.sfx(e.category === 'STATUS' ? 'status' : 'move');
    this.cur = { type: 'wait', t: 0.05 };
  },

  /** a hit: the move travels and lands, and the HP bar waits for it. The user dashes in or recoils; the target reacts. */
  hitMove(game, e) {
    if (this.move?.id !== e.moveId) this.move = { id: e.moveId, fx: lookOf(game.data.moves[e.moveId]), from: e.actorId, to: e.targetId, hits: 0 };
    const m = this.move, fx = m.fx, user = this.fx[e.actorId];
    m.hits++;
    this.effects.push({ kind: 'strike', fx, from: e.actorId, to: e.targetId, hit: e.hit, t: 0, dur: durationOf('strike', fx) });
    if (fx.motion === 'contact') { user.crouch = 0; user.dashLen = user.dash = Math.max(0.2, fx.impact * 2); } else user.lunge = 0.28;
    if (fx.flip) this.fx[e.targetId].flip = fx.impact + 0.45;
    const mult = e.mult ?? 1;
    this.pending = { side: e.targetId, mult, shake: (fx.shake || 0) + (mult > 1 ? 0.25 : 0), flash: fx.flash || 0 };
    this.cur = { type: 'wait', t: fx.impact };
  },

  /** the hit has landed (its damage is showing): knocked back if it resonates, a shrug if it barely registers */
  landed(side) {
    const p = this.pending;
    if (!p || p.side !== side) return;
    this.shake = Math.max(this.shake, p.shake); this.flash = Math.max(this.flash, p.flash);
    if (p.mult > 1) this.fx[side].knock = KNOCK; else if (p.mult < 1) this.fx[side].shrug = SHRUG;
    this.pending = null;
  },

  mark(name, o) { this.effects.push({ kind: 'mark', mark: name, t: 0, dur: MARK_SECONDS[name], ...o }); },

  update(game, dt) {
    if (!this.on) return;
    const input = game.input;
    // battle speed from Options, and hold B to fast-forward
    dt *= [1, 2, 3.5][game.settings.battleSpeed || 0] * (input.held?.b ? 3 : 1);
    if (input.pressed('start')) this.showLog = !this.showLog;
    this.t += dt;
    for (const f of this.effects) f.t += dt;
    this.effects = this.effects.filter((f) => f.t < f.dur);
    if (this.intro > 0) { this.intro = Math.max(0, this.intro - dt * 1.4); return; }
    if (this.portrait > 0) this.portrait = Math.max(0, this.portrait - dt);
    for (const s of ['p', 'e']) {
      const f = this.fx[s];
      f.lunge = Math.max(0, f.lunge - dt); f.hit = Math.max(0, f.hit - dt);
      for (const k of TIMERS) f[k] = Math.max(0, f[k] - dt);
      if (f.faint > 0 && f.faint < 1) f.faint = Math.min(1, f.faint + dt * 2.5);
    }
    this.shake = Math.max(0, this.shake - dt); this.flash = Math.max(0, this.flash - dt); this.chartFlip = Math.max(0, this.chartFlip - dt); this.happy = Math.max(0, (this.happy || 0) - dt);
    if (!this.cur) this.next(game);
    const c = this.cur;
    if (!c) {
      // nothing to play: follow the engine
      const b = game.engine.state.battle;
      if (!b) { this.on = false; return; }
      return;   // menus are driven from draw()
    }
    const press = input.pressed('a') || input.pressed('b') || input.anyTap();
    if (c.type === 'msg') {
      const total = c.lines.join('').length;
      c.shown = Math.min(total, c.shown + dt * 90 * [0.6, 1, 2.5][game.settings.textSpeed ?? 1]);
      if (c.shown >= total) c.hold += dt;
      if (press) { if (c.shown < total) c.shown = total; else this.cur = null; }
      else if (c.hold > 0.85 && this.queue.length) this.cur = null;
      else if (c.hold > 1.3) this.cur = null;
    } else if (c.type === 'tween') {
      c.t += dt * (press ? 8 : 2.8);
      const k = Math.min(1, c.t);
      this.disp[c.side].hp = Math.round(c.from + (c.to - c.from) * k);
      if (k >= 1) this.cur = null;
    } else if (c.type === 'wait') { c.t -= dt * (press ? 4 : 1); if (c.t <= 0) this.cur = null; }
    else if (c.type === 'evolve') {
      c.t += dt * (press ? 3 : 1);
      if (c.t >= EVOLVE_SECONDS) { this.disp.p.speciesId = c.to; this.disp.p.name = c.name; this.flash = 0.7; game.audio?.sfx('evolve'); this.cur = null; }
    }
    else if (c.type === 'capture') {
      this.capture.t += dt * (press ? 3 : 1);
      if (this.capture.t > 0.6 + this.capture.shakes * 0.55 + 0.3) { if (!this.capture.success) this.capture = null; this.cur = null; }
    } else if (c.type === 'outro') { c.t += dt * 2.2; this.outro = Math.min(1, c.t); if (c.t >= 1) { this.on = false; this.cur = null; this.queue = []; this.outro = 0; } }
  },

  // ------------------------------------------------------------ drawing
  /** how the sprite is moved and bent this frame: recoil, a dash into the target, a crouch, knock-back, a shrug, a hop,
   *  upside down. With reduced motion nothing moves. */
  pose(game, side) {
    const f = this.fx[side], dir = side === 'p' ? 1 : -1, out = { ox: 0, oy: 0, sy: 1, lean: 0, flip: false };
    if (game.settings.reducedMotion) return out;
    const other = SPOT[side === 'p' ? 'e' : 'p'], me = SPOT[side], dx = other.x - me.x, dy = other.y - me.y, len = Math.hypot(dx, dy);
    const wave = (v, d) => (v > 0 ? Math.sin((v / d) * Math.PI) : 0);
    const l = wave(f.lunge, 0.28);
    out.ox += l * 10 * dir; out.oy -= side === 'p' ? l * 4 : 0; out.lean += l * 0.22 * dir;
    const d = wave(f.dash, f.dashLen);
    out.ox += dx * 0.42 * d; out.oy += dy * 0.42 * d; out.lean += d * 0.3 * dir;
    const c = wave(f.crouch, WINDUP);
    out.ox -= c * 5 * dir; out.sy -= c * 0.12;
    const k = wave(f.knock, KNOCK);
    out.ox -= (dx / len) * 12 * k; out.oy -= (dy / len) * 12 * k; out.lean -= k * 0.15 * dir;
    if (f.shrug > 0) { const s = Math.sin((f.shrug / SHRUG) * Math.PI * 2); out.oy -= Math.abs(s) * 2; out.sy += s * 0.04; }
    if (f.gest > 0) out.oy -= Math.abs(Math.sin(f.gest * 13)) * 4;
    if (this.happy > 0 && side === 'p') out.oy -= Math.abs(Math.sin(this.happy * 14)) * 6;   // a happy hop after winning
    out.flip = f.flip > 0;
    out.ox = Math.round(out.ox); out.oy = Math.round(out.oy);
    return out;
  },

  /** which frame of the sheet: 0-1 front and its breath, 2-3 back and its breath, 5 blink, 6-7 the creature's own
   *  idle touch (a tail flick, a wing, a glint) front and back, 8 hurt face, 9 attack face. The faces only show on the foe. */
  frameOf(game, side, beat = 0) {
    const f = this.fx[side], still = game.settings.reducedMotion;
    const front = side === 'e', base = front ? 0 : 2;
    if (front && (f.hit > 0 || f.knock > 0)) return 8;
    if (front && (f.crouch > 0 || f.dash > 0 || f.lunge > 0)) return 9;
    if (still) return base;
    const phase = (this.t + (front ? 0 : 2.3)) % 4.7;
    if (phase > 3.9 && phase < 4.45) return front ? 6 : 7;     // its idle touch, now and then
    if (front && (this.t % 3.3) < 0.13) return 5;               // a blink
    return base + beat;
  },

  sprite(game, g, side, x, y) {
    const d = this.disp[side], f = this.fx[side];
    if (!d) return;
    const img = game.images[`mon:${d.speciesId}`];
    if (!img) return;
    if (f.faint >= 1) return;
    const bpm = game.data.zones[game.engine.state.zoneId].baseBpm || 140;
    const beat = game.settings.reducedMotion ? 0 : Math.floor((this.t * bpm) / 120) % 2;
    const frame = this.frameOf(game, side, beat);
    if (f.hit > 0 && Math.floor(f.hit * 30) % 4 === 3) return;   // flicker when hit
    if (this.capture && side === 'e') return;
    const sink = Math.round(f.faint * 64);
    const size = 64, still = game.settings.reducedMotion;
    // evolving: white silhouettes of the old and new forms swap faster and faster
    const ev = side === 'p' && this.cur?.type === 'evolve' ? this.cur : null;
    if (ev) {
      const k = ev.t / EVOLVE_SECONDS, period = Math.max(0.05, 0.45 * (1 - k)), showNew = still ? k > 0.5 : Math.floor(ev.t / period) % 2 === 1;
      const im = game.images[`mon:${showNew ? ev.to : ev.from}`] || img;
      g.drawImage(tinted(im, frame * 64, 0, 64, 64, '#FFFFFF'), x, y, size, size);
      return;
    }
    const { ox, oy, sy, lean, flip } = this.pose(game, side);
    // afterimages: two faded copies either side (Sidestep)
    if (f.ghost > 0 && !still) {
      g.save(); g.globalAlpha = 0.35 * Math.min(1, f.ghost * 3);
      for (const dx of [-16, 16]) g.drawImage(img, frame * 64, 0, 64, 64, x + dx * Math.sin(f.ghost * 4), y, size, size);
      g.restore();
    }
    const hurt = f.hit > 0, fainting = f.faint > 0;
    const src = hurt ? tinted(img, frame * 64, 0, 64, 64, '#FF3040', 0.45) : fainting ? tinted(img, frame * 64, 0, 64, 64, '#6C6A78', 0.55) : null;
    g.save();
    g.translate(x + ox + size / 2, y + oy + size);
    if (lean) g.transform(1, 0, -lean, 1, 0, 0);
    if (sy !== 1) g.scale(1, sy);
    if (flip) { g.translate(0, -size / 2); g.scale(1, -1); g.translate(0, size / 2); }
    if (src) g.drawImage(src, 0, 0, 64, 64 - (side === 'p' ? 0 : sink), -size / 2, -size + sink, size, size - sink);
    else g.drawImage(img, frame * 64, 0, 64, 64 - (side === 'p' ? 0 : sink), -size / 2, -size + sink * (size / 64), size, size - sink * (size / 64));
    g.restore();
  },

  hud(game, g, side, x, y) {
    const d = this.disp[side];
    if (!d) return;
    const w = 128, h = side === 'p' ? 38 : 30;
    panel(g, x, y, w, h, { bg: C.cream, accent: side === 'p' ? C.cyan : C.magenta });
    drawText(g, d.name, x + 6, y + 5, { color: C.ink });
    drawText(g, `Lv${d.level}`, x + w - 6, y + 5, { color: C.ink, align: 'right' });
    // serotonin "lava lamp": a bar with slow blobs
    const ratio = d.maxHp ? d.hp / d.maxHp : 0;
    const col = ratio > 0.5 ? '#FF4FA8' : ratio > 0.2 ? '#FF9A2A' : '#E0303C';
    drawText(g, 'SER', x + 6, y + 16, { color: C.grey });
    bar(g, x + 26, y + 15, w - 34, 8, ratio, col);
    const fill = Math.round((w - 36) * Math.max(0, Math.min(1, ratio)));
    if (!game.settings.reducedMotion) for (let i = 0; i < 3; i++) {
      const bx = Math.floor(((this.t * 9 + i * 31) % (w - 30)));
      if (bx < fill - 2) { g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(x + 27 + bx, y + 17 + (i % 2) * 2, 3, 2); }
    }
    let tx = x + 6;
    if (side === 'p') {
      drawText(g, `${d.hp}/${d.maxHp}`, x + w - 6, y + 26, { color: C.ink, align: 'right' });
      // hydration: a little water bottle
      g.fillStyle = C.ink; g.fillRect(x + 7, y + 25, 4, 2); g.fillRect(x + 6, y + 27, 6, 8);
      g.fillStyle = '#7CC4D8'; const lv = Math.round(6 * (d.maxHyd ? d.hyd / d.maxHyd : 0)); g.fillRect(x + 7, y + 34 - lv, 4, lv);
      bar(g, x + 15, y + 28, 44, 6, d.maxHyd ? d.hyd / d.maxHyd : 0, '#3FB8D8');
      tx = x + 62;
    } else if (game.engine.state.dex.caught[d.speciesId]) { g.fillStyle = C.magenta; g.fillRect(x + w - 30, y + 6, 4, 4); }
    const tag = STATUS_TAG[d.status];
    const ty = side === 'p' ? y + 26 : y + 20;
    if (side === 'e' && (tag || this.loop.e)) { /* drawn under the box */ }
    let sx = side === 'p' ? tx : x + 4;
    const sy = side === 'p' ? ty : y + h;
    for (const tg of [tag, this.loop[side] ? STATUS_TAG.THOUGHT_LOOP : null]) {
      if (!tg) continue;
      const tw = textWidth(tg[0]) + 6;
      g.fillStyle = C.ink; g.fillRect(sx, sy, tw, 10); g.fillStyle = tg[1]; g.fillRect(sx + 1, sy + 1, tw - 2, 8);
      drawText(g, tg[0], sx + 3, sy + 1, { color: C.ink });
      sx += tw + 2;
    }
  },

  /** the trainer's portrait slides in, holds, then slides out as their first Astral appears */
  drawPortrait(game, g) {
    if (this.portrait <= 0 || !this.info?.trainerSprite) return;
    const img = game.images[`portrait:${this.info.trainerSprite}`];
    if (!img) return;
    const total = 2.2, el = total - this.portrait, slideIn = Math.min(1, el / 0.35), slideOut = Math.min(1, this.portrait / 0.5);
    const k = Math.min(slideIn, slideOut), x = Math.round(W + 4 - (W + 4 - 184) * k);
    const blink = !game.settings.reducedMotion && (this.t % 2.7) < 0.12 ? 1 : 0;
    g.save(); g.imageSmoothingEnabled = false; g.drawImage(img, blink * 48, 0, 48, 48, x, -8, 96, 96); g.restore();
  },

  background(game, g) {
    const pal = this.info?.paletteId, b = game.engine.state.battle;
    const intox = game.fxLevel();
    const night = pal === 'UV_BLACKLIGHT' || pal === 'BAD_TRIP' || isNight(game.engine.state);
    g.fillStyle = '#2A1A2E'; g.fillRect(0, 0, W, H);
    drawBackdrop(g, backdropOf(game.data.zones[game.engine.state.zoneId]), BOX_Y, this.t, night, game.settings.reducedMotion);
    // kaleidoscope rays, stronger with intoxication
    const cols = ['#FF4FA8', '#9A4FE0', '#3FD8E8', '#4FE88A', '#FFE066'];
    const n = 16, rot = game.settings.reducedMotion ? 0 : this.t * (0.08 + intox * 0.5);
    g.save(); g.globalAlpha = 0.03 + intox * 0.3;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + rot, a1 = a0 + Math.PI / n;
      g.fillStyle = cols[i % cols.length];
      g.beginPath(); g.moveTo(W / 2, 60); g.lineTo(W / 2 + Math.cos(a0) * 300, 60 + Math.sin(a0) * 300); g.lineTo(W / 2 + Math.cos(a1) * 300, 60 + Math.sin(a1) * 300); g.fill();
    }
    g.restore();
    if (b && b.invert > 0) { g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 0, W, BOX_Y); drawText(g, 'CHART INVERTED', W / 2, 3, { color: C.yellow, align: 'center', shadow: C.ink }); }
    // platforms
    const plat = (x, y, rx, ry) => { g.fillStyle = night ? '#2E1750' : '#C9A878'; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill(); g.fillStyle = night ? '#4A2A7A' : '#E0C494'; g.beginPath(); g.ellipse(x, y - 2, rx - 3, ry - 2, 0, 0, 7); g.fill(); };
    plat(232, 80, 46, 10); plat(84, 132, 62, 12);
  },

  draw(game, g) {
    if (!this.on) return;
    const s = game.engine.state, b = s.battle, input = game.input;
    g.save();
    const fxo = { still: !!game.settings.reducedMotion, calm: !!(game.settings.reducedMotion || game.settings.grounded) };
    if (this.shake > 0 && !fxo.still) g.translate(Math.round(Math.sin(this.t * 90) * (this.shake > 0.3 ? 4 : 2)), 0);
    // the chart inverting: the whole field turns over once
    if (this.chartFlip > 0 && !fxo.calm) { const k = Math.min(1, (1 - this.chartFlip / CHART_FLIP) * 1.2); g.translate(0, BOX_Y / 2); g.scale(1, Math.cos(k * Math.PI * 2) || 0.01); g.translate(0, -BOX_Y / 2); }
    this.background(game, g);
    if (this.portrait <= 0.5) this.sprite(game, g, 'e', 200, 20);
    this.sprite(game, g, 'p', 52, 70);
    this.drawPortrait(game, g);
    for (const f of this.effects) drawMoveFx(g, f, fxo);
    if (this.capture) this.drawCapture(g);
    g.restore();
    this.hud(game, g, 'e', 6, 6);
    this.hud(game, g, 'p', W - 134, 90);
    if (b && b.kind === 'trainer') for (let i = 0; i < b.enemy.length; i++) { g.fillStyle = b.enemy[i].hp > 0 ? C.magenta : C.grey; g.fillRect(140 + i * 7, 9, 5, 5); }
    if (this.flash > 0 && !game.settings.reducedMotion) { g.fillStyle = `rgba(255,255,255,${Math.min(0.6, this.flash * 2)})`; g.fillRect(0, 0, W, H); }

    panel(g, 3, BOX_Y - 2, W - 6, BOX_H + 2, { bg: C.cream, accent: C.purple });
    const c = this.cur;
    if (c && c.type === 'msg') {
      let left = Math.floor(c.shown);
      c.lines.slice(0, 3).forEach((line, i) => { drawText(g, line.slice(0, Math.max(0, left)), 12, BOX_Y + 7 + i * 12, { color: C.ink, scramble: game.fxLevel() > 0.9 ? 0.1 : 0, t: this.t, runs: termRuns(line, game.data) }); left -= line.length; });
    } else if (!c && b && this.intro <= 0) this.menus(game, g, b);

    if (this.intro > 0) {   // iris-style bars in
      const k = this.intro; g.fillStyle = C.void;
      for (let i = 0; i < 9; i++) { const w = Math.round(W * k); g.fillRect(i % 2 ? W - w : 0, i * 20, w, 20); }
    }
    if (this.showLog) this.drawLog(game, g);
    if (this.outro > 0) { g.fillStyle = `rgba(11,3,20,${this.outro})`; g.fillRect(0, 0, W, H); }
    void input;
  },

  /** MENU in battle: the last lines of the fight, over the top of the screen */
  drawLog(game, g) {
    const lines = game.log.flatMap((l) => wrap(l, W - 28)).slice(-10);
    panel(g, 4, 4, W - 8, BOX_Y - 8, { bg: '#FFF4E4', accent: C.cyan });
    drawText(g, 'LOG  (MENU to close)', 10, 8, { color: C.purple });
    lines.forEach((ln, i) => drawText(g, ln, 10, 19 + i * 10, { color: C.ink }));
  },

  drawCapture(g) {
    const c = this.capture, t = c.t;
    let x = 232, y = 52;
    if (t < 0.6) { const k = t / 0.6; x = 60 + (232 - 60) * k; y = 110 + (52 - 110) * k - Math.sin(k * Math.PI) * 40; }
    else { const st = (t - 0.6) / 0.55, n = Math.floor(st); if (n < c.shakes) x += Math.round(Math.sin((st - n) * Math.PI * 4) * 4); y = 62; }
    g.fillStyle = C.ink; g.fillRect(x - 9, y - 11, 18, 22);
    g.fillStyle = '#E8F4FA'; g.fillRect(x - 8, y - 10, 16, 20);
    g.fillStyle = '#3FB8D8'; g.fillRect(x - 8, y - 10, 16, 3);
    g.fillStyle = c.success && t > 0.6 + c.shakes * 0.55 ? C.acid : C.magenta; g.fillRect(x - 3, y - 1, 6, 6);
  },

  // ------------------------------------------------------------ menus
  menus(game, g, b) {
    const s = game.engine.state, d = game.data, input = game.input, cur = this.cursor;
    const mon = s.party[b.pi];
    const back = () => { this.menu = 'main'; this.pendingItem = null; game.audio?.sfx('back'); };
    const send = (cmd) => { this.menu = 'main'; this.pendingItem = null; game.send(cmd); };

    if (b.phase === 'PHASE_LEARN_MOVE' && this.learn) {
      const L = this.learn, mv = d.moves[L.moveId];
      const lm = s.party.find((m) => m.uid === L.uid);
      let ask = `${L.name} can learn ${mv.name}. Forget which move?`;
      if (textWidth(ask) > W - 24) ask = `${L.name} can learn ${moveName(mv, 0)}. Forget which?`;
      if (textWidth(ask) > W - 24) ask = `Learn ${moveName(mv, 0)}? Forget which move?`;
      drawText(g, ask, 12, BOX_Y + 4, { color: C.ink });
      // two columns of 152 px: name, then the type on the right
      const items = lm.moves.map((id) => ({ label: moveName(d.moves[id], 108), right: d.moves[id].type.slice(0, 4), rightColor: C.grey }))
        .concat([{ label: `Skip ${moveName(mv, 130 - textWidth('Skip '))}`, color: C.red }]);
      const r = list(game, g, items, 8, BOX_Y + 14, W - 16, cur.learn, { cols: 2, rowH: 10 });
      cur.learn = r.cursor;
      if (r.chosen >= 0) { this.learn = null; game.send({ type: 'LEARN_MOVE', slot: r.chosen < lm.moves.length ? r.chosen : -1 }); }
      return;
    }
    if (b.phase === 'PHASE_AWAIT_SWITCH') this.menu = 'party';
    const forced = b.phase === 'PHASE_AWAIT_SWITCH';

    // Shift style: the trainer's next Astral is coming; swap yours for free, or keep going
    if (b.phase === 'PHASE_SHIFT_OFFER' && this.menu !== 'party') {
      const next = b.enemy[b.nextEi], who = d.trainers[b.trainerId]?.name || 'They';
      const lines = wrap(`${who} is about to manifest ${nameOf(d, next)}. Swap ${nameOf(d, mon)}?`, 136);
      lines.slice(0, 3).forEach((ln, i) => drawText(g, ln, 12, BOX_Y + 6 + i * 11, { color: C.ink }));
      panel(g, 150, BOX_Y - 2, W - 153, BOX_H + 2, { bg: '#FFF4E4', accent: C.magenta });
      const r = list(game, g, [{ label: 'Swap Astral' }, { label: 'Keep going' }], 154, BOX_Y + 4, W - 160, cur.shift || 0, { rowH: 18 });
      cur.shift = r.cursor;
      if (r.chosen === 0) { this.menu = 'party'; cur.party = s.party.findIndex((m, i) => i !== b.pi && m.hp > 0); }
      else if (r.chosen === 1 || input.pressed('b')) { cur.shift = 0; send({ type: 'BATTLE_ACTION', action: 'STAY' }); }
      return;
    }

    if (this.menu === 'main') {
      drawText(g, `What will`, 12, BOX_Y + 8, { color: C.ink });
      drawText(g, `${nameOf(d, mon)} do?`, 12, BOX_Y + 20, { color: C.ink });
      panel(g, 150, BOX_Y - 2, W - 153, BOX_H + 2, { bg: '#FFF4E4', accent: C.magenta });
      const r = list(game, g, MAIN.map((m) => ({ label: m, disabled: m === 'RUN' && b.kind !== 'wild' })), 154, BOX_Y + 4, W - 160, cur.main, { cols: 2, rowH: 18 });
      cur.main = r.cursor;
      if (r.chosen === 0) this.menu = 'moves';
      else if (r.chosen === 1) this.menu = 'bag';
      else if (r.chosen === 2) this.menu = 'party';
      else if (r.chosen === 3) send({ type: 'BATTLE_ACTION', action: 'RUN' });
      input.pressed('b');
    } else if (this.menu === 'moves') {
      // two columns of 106 px (names up to 94 px), details panel on the right
      const items = mon.moves.map((id) => { const m = d.moves[id]; return { label: moveName(m, 94), disabled: mon.hyd < moveCost(ctxOf(game), mon, m) && mon.moves.some((x) => mon.hyd >= moveCost(ctxOf(game), mon, d.moves[x])) }; });
      const r = list(game, g, items, 6, BOX_Y + 3, 212, cur.moves, { cols: 2, rowH: 20 });
      cur.moves = r.cursor;
      const m = d.moves[mon.moves[cur.moves]];
      if (m) {
        panel(g, 218, BOX_Y - 2, W - 221, BOX_H + 2, { bg: '#FFF4E4', accent: TYPE_COLORS[m.type] || C.magenta });
        typeTag(g, m.type, 223, BOX_Y + 4);
        drawText(g, m.category === 'STATUS' ? 'Status' : `Pow ${m.power}`, 223, BOX_Y + 17, { color: C.ink });
        const cost = moveCost(ctxOf(game), mon, m);
        drawText(g, `Water ${cost}`, W - 10, BOX_Y + 17, { color: mon.hyd >= cost ? '#2A7A9A' : C.red, align: 'right' });
        const foe = d.dex[this.disp.e.speciesId];
        if (m.power > 0 && m.type !== 'NORMAL' && s.dex.seen[foe.id]) {
          let k = 1; for (const t of foe.types) { let v = d.typeChart.chart[m.type]?.[t] ?? 1; if (b.invert > 0 && v !== 1) v = 1 / v; k *= v; }
          if (k !== 1) drawText(g, k > 1 ? 'resonates' : 'weak', 223, BOX_Y + 29, { color: k > 1 ? '#2A8A4A' : C.red });
        }
      }
      if (r.chosen >= 0) send({ type: 'BATTLE_ACTION', action: 'FIGHT', payloadId: mon.moves[r.chosen] });
      else if (input.pressed('b')) back();
    } else if (this.menu === 'bag') {
      const ids = Object.keys(s.bag).filter((id) => s.bag[id] > 0 && ['BAGGING', 'RECOVERY'].includes(d.items[id].category));
      if (!ids.length) { drawText(g, 'Nothing useful in the Stash Tin.', 12, BOX_Y + 8, { color: C.ink }); if (input.pressed('b') || input.pressed('a') || input.anyTap()) back(); return; }
      const r = list(game, g, ids.map((id) => ({ label: d.items[id].name, right: `x${s.bag[id]}` })), 8, BOX_Y + 3, 150, cur.bag, { rowH: 13, maxRows: 3 });
      cur.bag = r.cursor;
      const it = d.items[ids[cur.bag]];
      if (it) wrap(it.desc, 148).slice(0, 4).forEach((ln, i) => drawText(g, ln, 164, BOX_Y + 4 + i * 10, { color: C.chai }));
      if (r.chosen >= 0) {
        const item = d.items[ids[r.chosen]];
        if (item.category === 'BAGGING') send({ type: 'BATTLE_ACTION', action: 'BAG', payloadId: item.id });
        else { this.pendingItem = item.id; this.menu = 'party'; cur.party = b.pi; }
      } else if (input.pressed('b')) back();
    } else if (this.menu === 'party') {
      const items = s.party.map((m, i) => {
        const st = statsOf(d, m);
        return { label: `${nameOf(d, m)} Lv${m.level}`, right: m.hp > 0 ? `${m.hp}/${st.maxHp}` : 'OUT', rightColor: m.hp > 0 ? C.ink : C.red, disabled: this.pendingItem ? false : (m.hp <= 0 || i === b.pi) };
      });
      const r = list(game, g, items, 5, BOX_Y + 3, W - 10, cur.party, { cols: 2, rowH: 14 });   // 155 px columns: longest name + Lv + HP
      cur.party = r.cursor;
      if (forced && !this.pendingItem) drawText(g, 'Choose who goes next', W - 10, BOX_Y - 12, { color: C.yellow, align: 'right', shadow: C.ink });
      if (b.phase === 'PHASE_SHIFT_OFFER') drawText(g, 'Swap in who?', W - 10, BOX_Y - 12, { color: C.yellow, align: 'right', shadow: C.ink });
      if (r.chosen >= 0) {
        if (this.pendingItem) send({ type: 'BATTLE_ACTION', action: 'BAG', payloadId: this.pendingItem, target: r.chosen });
        else send({ type: 'BATTLE_ACTION', action: 'SWITCH', payloadId: r.chosen });
      } else if (input.pressed('b') && !forced) back();
    }
  },
};

export function install(game) { game.register('battle', battleView); }
