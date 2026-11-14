// Astral battle screen. Plays back the engine's event queue (messages, damage, faints...) and
// shows the command menus when the engine is waiting for the player. Decides no rules.
import { W, H } from './CanvasRenderer.js';
import { drawText, wrap, textWidth, panel, list, bar, typeTag, moveName, C, TYPE_COLORS } from './ui.js';
import { statsOf, nameOf } from '../core/mons.js';
import { moveCost } from '../core/BattleEngine.js';
import { isNight } from '../core/OverworldEngine.js';
import { drawBackdrop, backdropOf, drawStage, SPOT } from './battleFx.js';
// what flashes up when a boss has their moment at half health
const MOMENT_WORDS = { drop: 'DROP!', chant: 'OMMMM', horns: 'HONK HONK', special: 'SPECIAL!', tempo: '200 BPM', live: 'GOING LIVE', smoke: 'BREATHE', security: 'SECURITY!', kick: 'BOOM', bass: 'WOMMM', hat: 'TSS TSS', lead: 'LA LA LA' };
const MOMENT_SFX = { chant: 'gong', horns: 'horn', drop: 'drop', tempo: 'drop', kick: 'drop', security: 'alert' };
import { lookOf, durationOf, drawMoveFx, MARK_SECONDS, WINDUP } from './moveFx.js';
import { tinted } from './anim.js';
import { termRuns } from './glossary.js';
import { moveFacts, drawNote } from './moveInfo.js';
import { tl } from '../core/i18n.js';

const EVOLVE_SECONDS = 2.6;

const BOX_Y = 132, BOX_H = 46;
const STATUS_TAG = { COTTONMOUTH: ['DRY', '#F4A261'], K_HOLED: ['K-HOLE', '#7FD6FF'], THOUGHT_LOOP: ['LOOP', '#C86BFF'], EGO_DEATH: ['EGO', '#7C8CD9'], JAW_LOCK: ['JAW', '#FFD23F'] };
const MAIN = ['FIGHT', 'BAG', 'ASTRALS', 'RUN'];
const ctxOf = (game) => ({ data: game.data, state: game.engine.state });
/** per-side pose timers, all counting down to 0 (faint counts up): lunge (recoil as it fires), hit, dash (into the
 *  target, dashLen long), crouch (winding up), knock (knocked back), shrug, flip (upside down), ghost (afterimages), gest (a hop) */
const POSE = () => ({ lunge: 0, hit: 0, faint: 0, dash: 0, dashLen: 0.3, crouch: 0, knock: 0, shrug: 0, flip: 0, ghost: 0, gest: 0, summon: 0, owned: true, recall: 0 });
const TIMERS = ['dash', 'crouch', 'knock', 'shrug', 'flip', 'ghost', 'gest', 'summon'];
// coming in and going back: an Astral someone calls (yours, a trainer's) arrives as a point of light from its owner's
// side that bursts open, the creature growing out of it white and taking its colours; a wild one shimmers out of the
// haze. Called back, it goes white, folds into a point and streaks back to its owner. (seconds; summon counts down,
// recall is how far along it is, 0 to 1)
export const SUMMON = 0.7, RECALL = 0.5;
const ORB = 0.35;                                                          // the share of a summon the point of light flies
const ORIGIN = { p: { x: -12, y: 150 }, e: { x: W + 12, y: -12 } };       // where each side's owner stands, off screen
const GLOW = { p: '#5FF4FF', e: '#FF4FA8' };
const ease = (k) => 1 - (1 - Math.max(0, Math.min(1, k))) ** 2;
const quarter = (k) => Math.ceil(Math.max(0, Math.min(1, k)) * 4) / 4;   // white silhouettes in four steps (cached copies)
const KNOCK = 0.4, SHRUG = 0.5, CHART_FLIP = 0.9;

export const battleView = {
  on: false, queue: [], cur: null, disp: { p: null, e: null }, t: 0, intro: 0, outro: 0,
  menu: 'main', cursor: { main: 0, moves: 0, bag: 0, party: 0, learn: 0, shift: 0 }, pendingItem: null, learn: null,
  fx: { p: POSE(), e: POSE() }, hidden: { p: false, e: false }, opening: null, shake: 0, flash: 0, capture: null, info: null, loop: { p: false, e: false },

  effects: [], portrait: 0, move: null, pending: null, chartFlip: 0,
  reset() { this.hidden = { p: false, e: false }; this.opening = null; this.on = false; this.queue = []; this.cur = null; this.effects = []; this.portrait = 0; this.move = null; this.pending = null; this.chartFlip = 0; },
  busy() { return this.on; },

  onEvent(game, e) {
    if (e.type === 'BATTLE_START') {
      this.on = true; this.queue = []; this.cur = null; this.worldTrack = null; this.intro = 1; this.outro = 0; this.menu = 'main'; this.capture = null; this.learn = null;
      this.disp = { p: { ...e.player }, e: { ...e.enemy } };
      this.info = { kind: e.kind, trainerName: e.trainerName, trainerSprite: e.trainerSprite, boss: e.boss, paletteId: e.paletteId };
      this.effects = []; this.portrait = (e.kind === 'trainer' || e.kind === 'mirror') && e.trainerSprite ? 2.2 : 0;   // the trainer shows up before their Astral
      this.fx = { p: POSE(), e: POSE() }; this.move = null; this.pending = null; this.chartFlip = 0;
      this.loop = { p: false, e: false };
      this.moment = null; this.momentShown = false;
      // nobody is on the field yet: the foe comes in with its first line ("A wild X drifts out", "Y manifests X"), yours
      // with "Go, X!", the last line of the opening
      this.hidden = { p: true, e: true };
      this.opening = { n: 0, enemyAt: e.kind === 'wild' ? 0 : 1, last: e.kind === 'wild' ? 1 : 2 };
      game.audio?.sfx('encounter');
      const tr = game.engine.state.battle?.trainerId && game.data.trainers[game.engine.state.battle.trainerId];
      if (tr?.stage === 'yurt') game.audio?.sfx('gong');                       // Svetlana's battles start with a gong
      return;
    }
    if (this.on && e.type === 'AUDIO_CUE' && e.after) { this.worldTrack = e; return; }   // the world's music: kept for the end of the screen
    if (!this.on) return;
    const o = this.opening;
    if (o && e.type === 'MESSAGE') {
      if (o.n === o.enemyAt) this.queue.push({ type: 'ENTER', side: 'e', owned: this.info?.kind !== 'wild' });
      if (o.n === o.last) { this.queue.push({ type: 'ENTER', side: 'p', owned: true }); this.opening = null; }
      o.n++;
    }
    this.queue.push(e);
  },

  /** an Astral comes onto the field (it plays alongside the line that names it) */
  summon(game, side, owned) {
    this.hidden[side] = false;
    const f = this.fx[side];
    f.owned = owned; f.recall = 0; f.summon = game.settings.reducedMotion ? 0 : SUMMON;
    game.audio?.sfx(owned ? 'summon' : 'manifest');
  },

  /** the Astral on that side is swapped: the new one is called in (after the old one has gone back, see recall) */
  switchIn(game, side, mon) {
    this.disp[side] = { ...mon }; this.fx[side] = POSE(); this.loop[side] = false;
    this.summon(game, side, true);
    this.cur = { type: 'wait', t: game.settings.reducedMotion ? 0.25 : SUMMON * 0.7 };
  },

  /** the battle is over on screen: its music fades out as the screen goes dark, and the world's comes in after */
  worldMusic(game) { if (this.worldTrack) { game.playCue?.(this.worldTrack, 0.6); this.worldTrack = null; } },

  // ------------------------------------------------------------ playback
  next(game) {
    const e = this.queue.shift();
    if (!e) { this.cur = null; return; }
    const d = this.disp;
    switch (e.type) {
      // a line to read (a boss's words, how high you are now) waits for A; the play-by-play goes on by itself
      case 'MESSAGE': this.cur = { type: 'msg', lines: wrap(e.text, W - 28), shown: 0, hold: 0, read: !!(e.read || e.kind === 'intox') }; break;
      case 'AUDIO_CUE':
        if (e.sfxId) game.audio?.sfx(e.sfxId);
        if (e.trackBpm && !e.start) game.playCue?.(e);                    // a boss's moment: the music speeds up with their line
        this.next(game); break;   // a sound in its place in the queue: the fanfare after the capture, not over it
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
      case 'SWITCH_IN': {
        // one still standing goes back first; one that fainted is already gone
        const gone = !d[e.side] || this.fx[e.side].faint > 0 || this.hidden?.[e.side];
        if (!gone && !game.settings.reducedMotion) { this.cur = { type: 'recall', side: e.side, t: 0, mon: e.mon }; this.fx[e.side].recall = 0.001; game.audio?.sfx('recall'); }
        else this.switchIn(game, e.side, e.mon);
        break;
      }
      case 'ENTER':                                            // the opening: the trainer's portrait goes before their Astral
        if (e.side === 'e' && this.portrait > 0.5) { this.queue.unshift(e); this.cur = { type: 'wait', t: 0.05 }; break; }
        this.summon(game, e.side, e.owned); this.next(game); break;
      case 'SYNC': d[e.side] = { ...d[e.side], ...e.mon }; this.next(game); break;
      case 'STATUS_APPLIED': this.mark('status', { side: e.targetId, status: e.status }); if (e.status === 'THOUGHT_LOOP') this.loop[e.targetId] = true; else d[e.targetId].status = e.status; game.audio?.sfx('status'); this.next(game); break;
      case 'STATUS_CLEARED': if (e.status === 'THOUGHT_LOOP') this.loop[e.targetId] = false; else d[e.targetId].status = null; this.next(game); break;
      case 'CRITICAL': this.flash = 0.25; this.next(game); break;
      case 'BOSS_MOMENT':                                                       // the boss's moment at half health
        this.moment = { t: 0, word: MOMENT_WORDS[e.fx] || '!!', fx: e.fx }; this.momentShown = true;
        this.flash = 0.45; this.shake = Math.max(this.shake, 0.3); game.audio?.sfx(MOMENT_SFX[e.fx] || 'alert');
        this.cur = { type: 'wait', t: 0.7 };
        break;
      case 'FAINT': this.fx[e.side].faint = 0.001; this.cur = { type: 'wait', t: 0.5 }; break;
      case 'CAPTURE_THROW': this.capture = { t: 0, shakes: e.shakes, success: e.success, item: e.itemId }; this.cur = { type: 'capture' }; game.audio?.sfx('throw'); break;
      case 'LEVEL_UP': if (d.p && d.p.uid === e.uid) d.p = { ...d.p, ...e.mon }; this.next(game); break;
      case 'EVOLVED':
        // the creature on screen gets the full sequence; one on the bench just changes
        if (d.p && d.p.uid === e.uid) this.cur = { type: 'evolve', t: 0, from: e.from, to: e.to, name: e.newName };
        else { this.flash = 0.6; this.cur = { type: 'wait', t: 0.6 }; }
        break;
      case 'LEARN_PROMPT': this.learn = e; this.forget = null; this.cursor.learn = 0; this.next(game); break;
      case 'BATTLE_END': if (e.result === 'LOST') game.cue?.('WHITEOUT'); if (e.result === 'WON' || e.result === 'CAUGHT') this.happy = 0.9; this.cur = { type: 'outro', t: 0 }; this.worldMusic(game); break;
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
    if (this.moment && (this.moment.t += dt) > 1.6) this.moment = null;
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
      if (!b) { this.on = false; this.worldMusic(game); return; }
      return;   // menus are driven from draw()
    }
    const pressA = input.pressed('a'), tapped = input.anyTap(), press = pressA || input.pressed('b') || tapped;
    if (c.type === 'msg' && c.read) {                       // only A (or a tap) moves on: B and fast-forward do not skip it
      const total = c.lines.join('').length, ok = pressA || tapped;
      c.shown = Math.min(total, c.shown + dt * 90 * [0.6, 1, 2.5][game.settings.textSpeed ?? 1]);
      if (ok) { if (c.shown < total) c.shown = total; else this.cur = null; }
    } else if (c.type === 'msg') {
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
    else if (c.type === 'recall') {
      c.t += dt * (press ? 3 : 1);
      this.fx[c.side].recall = Math.min(1, c.t / RECALL);
      if (c.t >= RECALL) this.switchIn(game, c.side, c.mon);
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
    if (!d || this.hidden?.[side]) return;
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
    // coming in or going back: how big, how white, how solid, how much it shimmers
    let sc = 1, white = 0, alpha = 1, haze = 0;
    if (f.summon > 0 && !still) {
      const k = 1 - f.summon / SUMMON;
      if (f.owned) {
        if (k < ORB) return;                                  // still a point of light on its way (entranceFx)
        sc = 0.15 + 0.85 * ease((k - ORB) / 0.4); white = quarter(1 - (k - 0.75) / 0.25);
      } else { alpha = Math.min(1, k / 0.6); haze = (1 - k) * 7; }
    }
    if (f.recall > 0 && !still) {
      const k = f.recall;
      if (k >= 0.8) return;                                   // gone: a streak of light home (entranceFx)
      white = quarter(k / 0.3); sc = k < 0.3 ? 1 : 1 - ease((k - 0.3) / 0.5) * 0.95;
    }
    // afterimages: two faded copies either side (Sidestep)
    if (f.ghost > 0 && !still) {
      g.save(); g.globalAlpha = 0.35 * Math.min(1, f.ghost * 3);
      for (const dx of [-16, 16]) g.drawImage(img, frame * 64, 0, 64, 64, x + dx * Math.sin(f.ghost * 4), y, size, size);
      g.restore();
    }
    const hurt = f.hit > 0, fainting = f.faint > 0;
    const src = white > 0 ? tinted(img, frame * 64, 0, 64, 64, '#FFFFFF', white) : hurt ? tinted(img, frame * 64, 0, 64, 64, '#FF3040', 0.45) : fainting ? tinted(img, frame * 64, 0, 64, 64, '#6C6A78', 0.55) : null;
    g.save();
    g.translate(x + ox + size / 2, y + oy + size);
    if (sc !== 1) { g.translate(0, -size / 2); g.scale(sc, sc); g.translate(0, size / 2); }   // grows from (folds to) its middle
    if (alpha < 1) g.globalAlpha = alpha;
    if (lean) g.transform(1, 0, -lean, 1, 0, 0);
    if (sy !== 1) g.scale(1, sy);
    if (flip) { g.translate(0, -size / 2); g.scale(1, -1); g.translate(0, size / 2); }
    if (haze > 0) for (let r = 0; r < 64; r += 4) g.drawImage(img, frame * 64, r, 64, 4, -size / 2 + Math.round(Math.sin(r * 0.4 + this.t * 20) * haze), -size + r, size, 4);   // out of the haze, line by line
    else if (src) g.drawImage(src, 0, 0, 64, 64 - (side === 'p' ? 0 : sink), -size / 2, -size + sink, size, size - sink);
    else g.drawImage(img, frame * 64, 0, 64, 64 - (side === 'p' ? 0 : sink), -size / 2, -size + sink * (size / 64), size, size - sink * (size / 64));
    g.restore();
  },

  /** the light of an Astral coming in or going back: the point of light flying in from its owner and bursting open,
   *  the haze a wild one comes out of, sparks folding in and the streak home when it is called back */
  entranceFx(game, g, side) {
    const f = this.fx[side], at = SPOT[side], from = ORIGIN[side], col = GLOW[side];
    if (game.settings.reducedMotion || this.hidden?.[side] || !(f.summon > 0 || f.recall > 0)) return;
    const dot = (x, y, r, c, a) => { g.globalAlpha = Math.max(0, Math.min(1, a)); g.fillStyle = c; g.fillRect(Math.round(x - r), Math.round(y - r), r * 2, r * 2); };
    const arc = (p, a, b) => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p - Math.sin(p * Math.PI) * 30 });
    const orb = (p, a, b) => {
      for (let i = 4; i >= 1; i--) { const q = arc(Math.max(0, p - i * 0.07), a, b); dot(q.x, q.y, 1, i % 2 ? col : '#FFFFFF', 0.7 - i * 0.12); }   // its trail
      const q = arc(p, a, b);
      g.globalAlpha = 0.35; g.fillStyle = col; g.beginPath(); g.ellipse(q.x, q.y, 6, 6, 0, 0, 7); g.fill();
      dot(q.x, q.y, 2, '#FFFFFF', 1);
    };
    if (f.summon > 0) {
      const k = 1 - f.summon / SUMMON;
      if (f.owned) {
        if (k < ORB) orb(ease(k / ORB), from, at);
        else if (k < ORB + 0.4) {                             // it bursts open: a ring and eight sparks
          const h = (k - ORB) / 0.4;
          g.globalAlpha = 1 - h; g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.ellipse(at.x, at.y, 4 + h * 34, 3 + h * 24, 0, 0, 7); g.stroke();
          for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; dot(at.x + Math.cos(a) * h * 30, at.y + Math.sin(a) * h * 22, 1, i % 2 ? '#FFFFFF' : col, 1 - h); }
        }
      } else for (let i = 0; i < 8; i++) {                    // a wild one: motes of haze rising round it as it firms up
        const p = (k * 1.4 + i / 8) % 1;
        dot(at.x - 26 + ((i * 23) % 52), at.y + 24 - p * 44, 1, i % 2 ? '#EADDFB' : col, (1 - k) * (1 - p));
      }
    }
    if (f.recall > 0) {
      const k = f.recall;
      if (k > 0.25 && k < 0.85) { const h = (k - 0.25) / 0.6; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + h * 2; dot(at.x + Math.cos(a) * (1 - h) * 30, at.y + Math.sin(a) * (1 - h) * 22, 1, i % 2 ? '#FFFFFF' : col, h); } }
      if (k >= 0.7) orb(ease((k - 0.7) / 0.3), at, from);
    }
    g.globalAlpha = 1;
  },

  hud(game, g, side, x, y) {
    const d = this.disp[side];
    if (!d) return;
    const w = 128, h = side === 'p' ? 38 : 30;
    panel(g, x, y, w, h, { bg: C.cream, accent: side === 'p' ? C.cyan : C.magenta });
    drawText(g, d.name, x + 6, y + 5, { color: C.ink });
    drawText(g, tl('Lv{0}', d.level), x + w - 6, y + 5, { color: C.ink, align: 'right' });
    // serotonin "lava lamp": a bar with slow blobs
    const ratio = d.maxHp ? d.hp / d.maxHp : 0;
    const col = ratio > 0.5 ? '#FF4FA8' : ratio > 0.2 ? '#FF9A2A' : '#E0303C';
    drawText(g, tl('SER'), x + 6, y + 16, { color: C.grey });
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
      const tag0 = tl(tg[0]), tw = textWidth(tag0) + 6;
      g.fillStyle = C.ink; g.fillRect(sx, sy, tw, 10); g.fillStyle = tg[1]; g.fillRect(sx + 1, sy + 1, tw - 2, 8);
      drawText(g, tag0, sx + 3, sy + 1, { color: C.ink });
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
    // a boss fights on their own stage: the decks and strobes behind Diabolo, Svetlana's candles, Chloe's live count...
    const tr = b?.trainerId && game.data.trainers[b.trainerId];
    if (tr?.stage) {
      const max = b.enemy.reduce((a, m) => a + statsOf(game.data, m).maxHp, 0), now = b.enemy.reduce((a, m) => a + Math.max(0, m.hp), 0);
      drawStage(g, tr.stage, BOX_Y, this.t, game.settings.reducedMotion || game.settings.grounded, max ? now / max : 1, this.momentShown, (game.data.zones[game.engine.state.zoneId].baseBpm || 140) + 12);
    }
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
    if (b && b.invert > 0) { g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 0, W, BOX_Y); drawText(g, tl('CHART INVERTED'), W / 2, 3, { color: C.yellow, align: 'center', shadow: C.ink }); }
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
    this.entranceFx(game, g, 'e'); this.entranceFx(game, g, 'p');
    this.drawPortrait(game, g);
    // the boss's moment: one word, big, over the field
    if (this.moment) {
      const k = this.moment.t, a = Math.max(0, Math.min(1, k * 6, (1.6 - k) * 3)), rise = fxo.still ? 0 : Math.round(Math.max(0, 0.25 - k) * 24);
      g.save(); g.globalAlpha = a; g.scale(2, 2);
      drawText(g, tl(this.moment.word), W / 4, 10 + rise, { color: C.yellow, align: 'center', shadow: C.magenta });
      g.restore();
    }
    for (const f of this.effects) drawMoveFx(g, f, fxo);
    if (this.capture) this.drawCapture(g);
    g.restore();
    const learning = b?.phase === 'PHASE_LEARN_MOVE' && this.learn && !this.cur && !this.queue.length;   // the move page covers them
    if (!learning) { this.hud(game, g, 'e', 6, 6); this.hud(game, g, 'p', W - 134, 90); }
    if (!learning && b && (b.kind === 'trainer' || b.kind === 'mirror')) for (let i = 0; i < b.enemy.length; i++) { g.fillStyle = b.enemy[i].hp > 0 ? C.magenta : C.grey; g.fillRect(140 + i * 7, 9, 5, 5); }
    if (this.flash > 0 && !game.settings.reducedMotion) { g.fillStyle = `rgba(255,255,255,${Math.min(0.6, this.flash * 2)})`; g.fillRect(0, 0, W, H); }

    panel(g, 3, BOX_Y - 2, W - 6, BOX_H + 2, { bg: C.cream, accent: C.purple });
    const c = this.cur;
    if (c && c.type === 'msg') {
      let left = Math.floor(c.shown);
      c.lines.slice(0, 3).forEach((line, i) => { drawText(g, line.slice(0, Math.max(0, left)), 12, BOX_Y + 7 + i * 12, { color: C.ink, scramble: game.fxLevel() > 0.9 ? 0.1 : 0, t: this.t, runs: termRuns(line, game.data) }); left -= line.length; });
      // waiting for A: a blinking arrow, as in the dialogue box
      if (c.read && c.shown >= c.lines.join('').length && Math.floor(this.t * 2.5) % 2 === 0) { g.fillStyle = C.magenta; g.fillRect(W - 18, BOX_Y + 36, 7, 2); g.fillRect(W - 17, BOX_Y + 38, 5, 1); g.fillRect(W - 16, BOX_Y + 39, 3, 1); g.fillRect(W - 15, BOX_Y + 40, 1, 1); }
    } else if (!c && b && this.intro <= 0) { if (!this.queue.length) this.hidden = { p: false, e: false }; this.menus(game, g, b); }

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
    drawText(g, tl('LOG  (MENU to close)'), 10, 8, { color: C.purple });
    lines.forEach((ln, i) => drawText(g, ln, 10, 19 + i * 10, { color: C.ink }));
  },

  drawCapture(g) {
    const c = this.capture, t = c.t;
    let x = 232, y = 52;
    if (t < 0.6) { const k = t / 0.6; x = 60 + (232 - 60) * k; y = 110 + (52 - 110) * k - Math.sin(k * Math.PI) * 40; }
    else { const st = (t - 0.6) / 0.55, n = Math.floor(st); if (n < c.shakes) x += Math.round(Math.sin((st - n) * Math.PI * 4) * 4); y = 62; }
    const flying = t < 0.6, held = c.success && t > 0.6 + c.shakes * 0.55;
    const st = (t - 0.6) / 0.55, n = Math.floor(st), rocking = !flying && n < c.shakes ? Math.sin((st - n) * Math.PI * 4) : 0;
    const R = (col, rx, ry, w, h) => { g.fillStyle = col; g.fillRect(Math.round(rx), Math.round(ry), w, h); };
    if (c.item === 'rizla_paper') {
      // a rolling paper: a sheet fluttering through the air, then rolled tight round the Astral like a joint, rocking;
      // when it holds, the tip glows like an ember
      if (flying) {
        const flap = Math.abs(Math.sin(t * 28)), w = Math.max(2, Math.round(16 * flap));
        R(C.ink, x - w / 2 - 1, y - 6, w + 2, 12); R('#FBF6EA', x - w / 2, y - 5, w, 10); R('#E2D8C2', x - w / 2, y + 3, w, 1);
      } else {
        const tilt = Math.round(rocking * 3);
        for (let i = 0; i < 22; i++) {                      // the roll, leaning as it rocks
          const yy = y + Math.round(((i - 11) / 11) * tilt);
          R(C.ink, x - 11 + i, yy - 4, 1, 9); R('#FBF6EA', x - 11 + i, yy - 3, 1, 7); R('#E2D8C2', x - 11 + i, yy + 2, 1, 1);
        }
        R('#C9B48A', x - 12, y - 2 - tilt, 2, 5);                                 // the twist at one end
        R(held ? '#FF7A2A' : '#9A8F80', x + 10, y - 2 + tilt, 3, 5);              // the tip: an ember when it holds
        if (held) { R('#FFE066', x + 11, y - 1 + tilt, 1, 2); g.globalAlpha = 0.5; R('#C8C0B8', x + 13, y - 6 + tilt - Math.round((t * 10) % 4), 2, 2); g.globalAlpha = 1; }
      }
      return;
    }
    if (c.item === 'amber_vial') {
      // a lab vial: brown glass and a cork, tumbling end over end, then tipping side to side with the liquid sloshing;
      // when it holds, the cork seals with a flash of light
      const sideways = flying && Math.floor(t * 12) % 2 === 1;
      const w = sideways ? 18 : 10, h = sideways ? 10 : 18, lean = Math.round(rocking * 3);
      for (let row = 0; row < h; row++) {                   // the glass, leaning as it tips
        const dx = sideways ? 0 : Math.round(((row - h / 2) / h) * -lean * 2);
        R(C.ink, x - w / 2 - 1 + dx, y - h / 2 + row, w + 2, 1);
        R(row > h * 0.35 ? '#C8741E' : '#E8A050', x - w / 2 + dx, y - h / 2 + row, w, 1);
      }
      R('#FFE8C0', x - w / 2 + 1, y - h / 2 + 2, 1, Math.max(2, h - 6));              // a glint down the glass
      if (sideways) { R(C.ink, x + w / 2 + 1, y - 3, 4, 6); R('#B08458', x + w / 2 + 1, y - 2, 3, 4); }
      else { R(C.ink, x - 4 + lean, y - h / 2 - 5, 8, 6); R(held ? C.acid : '#B08458', x - 3 + lean, y - h / 2 - 4, 6, 4); }
      if (held) { g.globalAlpha = 0.6; R('#FFFFFF', x - 1 + lean, y - h / 2 - 9, 2, 2); R('#FFFFFF', x + 5 + lean, y - h / 2 - 6, 1, 1); g.globalAlpha = 1; }
      return;
    }
    // the ziploc baggie
    g.fillStyle = C.ink; g.fillRect(x - 9, y - 11, 18, 22);
    g.fillStyle = '#E8F4FA'; g.fillRect(x - 8, y - 10, 16, 20);
    g.fillStyle = '#3FB8D8'; g.fillRect(x - 8, y - 10, 16, 3);
    g.fillStyle = held ? C.acid : C.magenta; g.fillRect(x - 3, y - 1, 6, 6);
  },

  /** learning a move: a page above the text box with the new move's numbers, then the note of the one being looked at */
  compare(game, g, mon, mv, shown) {
    const d = game.data, x = 4, y = 4, w = W - 8, h = BOX_Y - 8;
    panel(g, x, y, w, h, { bg: '#FFF4E4', accent: C.purple });
    const nf = moveFacts(d, mv, mon);
    const newTxt = tl('New');
    drawText(g, newTxt, x + 6, y + 5, { color: C.magenta });
    drawNote(g, { title: nf.title, type: nf.type, numbers: nf.numbers, text: '' }, x + 6 + textWidth(newTxt) + 6, y + 5, w - 18 - textWidth(newTxt));
    g.fillStyle = '#E8D8C0'; g.fillRect(x + 6, y + 30, w - 12, 1);
    const sf = moveFacts(d, shown, mon);
    drawNote(g, shown === mv ? { ...sf, title: tl('{0}: what it does', sf.title) } : sf, x + 6, y + 35, w - 12, h - 37, { titleColor: shown === mv ? C.magenta : C.purple });
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
      // over the battle: the new move's numbers, and the whole note of the move under the cursor (Skip: the new one),
      // so you can see what each does before you give one up
      const shownIdx = this.forget ?? cur.learn;
      this.compare(game, g, lm, mv, lm.moves[shownIdx] ? d.moves[lm.moves[shownIdx]] : mv);
      // forgetting a move asks first, No by default; No goes back to the choice, until you skip or replace one
      if (this.forget !== null && this.forget !== undefined && lm.moves[this.forget]) {
        const old = d.moves[lm.moves[this.forget]];
        let q = tl('Forget {0} for {1}?', old.name, mv.name);
        if (textWidth(q) > W - 24) q = tl('Forget {0} for {1}?', moveName(old, 0), moveName(mv, 0));
        drawText(g, q, 12, BOX_Y + 4, { color: C.ink });
        const c = list(game, g, [{ label: tl('No, keep it') }, { label: tl('Yes, forget {0}', moveName(old, 150)), color: C.red }], 8, BOX_Y + 16, W - 16, cur.forget || 0, { rowH: 12 });
        cur.forget = c.cursor;
        if (c.chosen === 1) { const slot = this.forget; this.forget = null; this.learn = null; game.send({ type: 'LEARN_MOVE', slot }); }
        else if (c.chosen === 0 || input.pressed('b')) { this.forget = null; game.audio?.sfx('back'); }
        return;
      }
      let ask = tl('{0} can learn {1}. Forget which move?', L.name, mv.name);
      if (textWidth(ask) > W - 24) ask = tl('{0} can learn {1}. Forget which?', L.name, moveName(mv, 0));
      if (textWidth(ask) > W - 24) ask = tl('Learn {0}? Forget which move?', moveName(mv, 0));
      drawText(g, ask, 12, BOX_Y + 4, { color: C.ink });
      // two columns of 152 px: name, then the type on the right
      const items = lm.moves.map((id) => ({ label: moveName(d.moves[id], 108), right: tl(d.moves[id].type).slice(0, 4), rightColor: C.grey }))
        .concat([{ label: tl('Skip {0}', moveName(mv, 130 - textWidth(tl('Skip {0}', '')))) , color: C.red }]);
      const r = list(game, g, items, 8, BOX_Y + 14, W - 16, cur.learn, { cols: 2, rowH: 10 });
      cur.learn = r.cursor;
      if (r.chosen >= 0 && r.chosen < lm.moves.length) { this.forget = r.chosen; cur.forget = 0; game.audio?.sfx('select'); }
      else if (r.chosen >= 0) { this.learn = null; game.send({ type: 'LEARN_MOVE', slot: -1 }); }   // skip: no harm done, no question
      return;
    }
    if (b.phase === 'PHASE_AWAIT_SWITCH') this.menu = 'party';
    const forced = b.phase === 'PHASE_AWAIT_SWITCH';

    // Shift style: the trainer's next Astral is coming; swap yours for free, or keep going
    if (b.phase === 'PHASE_SHIFT_OFFER' && this.menu !== 'party') {
      const next = b.enemy[b.nextEi], who = d.trainers[b.trainerId]?.name || tl('They');
      const lines = wrap(tl('{0} is about to manifest {1}. Swap {2}?', who, nameOf(d, next), nameOf(d, mon)), 136);
      lines.slice(0, 3).forEach((ln, i) => drawText(g, ln, 12, BOX_Y + 6 + i * 11, { color: C.ink }));
      panel(g, 150, BOX_Y - 2, W - 153, BOX_H + 2, { bg: '#FFF4E4', accent: C.magenta });
      const r = list(game, g, [{ label: tl('Swap Astral') }, { label: tl('Keep going') }], 154, BOX_Y + 4, W - 160, cur.shift || 0, { rowH: 18 });
      cur.shift = r.cursor;
      if (r.chosen === 0) { this.menu = 'party'; cur.party = s.party.findIndex((m, i) => i !== b.pi && m.hp > 0); }
      else if (r.chosen === 1 || input.pressed('b')) { cur.shift = 0; send({ type: 'BATTLE_ACTION', action: 'STAY' }); }
      return;
    }

    if (this.menu === 'main') {
      drawText(g, tl('What will'), 12, BOX_Y + 8, { color: C.ink });
      drawText(g, tl('{0} do?', nameOf(d, mon)), 12, BOX_Y + 20, { color: C.ink });
      panel(g, 150, BOX_Y - 2, W - 153, BOX_H + 2, { bg: '#FFF4E4', accent: C.magenta });
      const r = list(game, g, MAIN.map((m) => ({ label: tl(m), disabled: m === 'RUN' && b.kind !== 'wild' })), 154, BOX_Y + 4, W - 160, cur.main, { cols: 2, rowH: 18 });
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
        drawText(g, m.category === 'STATUS' ? tl('Status') : tl('Pow {0}', m.power), 223, BOX_Y + 17, { color: C.ink });
        const cost = moveCost(ctxOf(game), mon, m);
        drawText(g, tl('Water {0}', cost), W - 10, BOX_Y + 17, { color: mon.hyd >= cost ? '#2A7A9A' : C.red, align: 'right' });
        const foe = d.dex[this.disp.e.speciesId];
        if (m.power > 0 && m.type !== 'NORMAL' && s.dex.seen[foe.id]) {
          let k = 1; for (const t of foe.types) { let v = d.typeChart.chart[m.type]?.[t] ?? 1; if (b.invert > 0 && v !== 1) v = 1 / v; k *= v; }
          if (k !== 1) drawText(g, k > 1 ? tl('resonates') : tl('weak'), 223, BOX_Y + 29, { color: k > 1 ? '#2A8A4A' : C.red });
        }
      }
      if (r.chosen >= 0) send({ type: 'BATTLE_ACTION', action: 'FIGHT', payloadId: mon.moves[r.chosen] });
      else if (input.pressed('b')) back();
    } else if (this.menu === 'bag') {
      const ids = Object.keys(s.bag).filter((id) => s.bag[id] > 0 && ['BAGGING', 'RECOVERY'].includes(d.items[id].category));
      if (!ids.length) { drawText(g, tl('Nothing useful in the Stash Tin.'), 12, BOX_Y + 8, { color: C.ink }); if (input.pressed('b') || input.pressed('a') || input.anyTap()) back(); return; }
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
        return { label: tl('{0} Lv{1}', nameOf(d, m), m.level), right: m.hp > 0 ? `${m.hp}/${st.maxHp}` : tl('OUT'), rightColor: m.hp > 0 ? C.ink : C.red, disabled: this.pendingItem ? false : (m.hp <= 0 || i === b.pi) };
      });
      const r = list(game, g, items, 5, BOX_Y + 3, W - 10, cur.party, { cols: 2, rowH: 14 });   // 155 px columns: longest name + Lv + HP
      cur.party = r.cursor;
      // on the left, over your Astral's back: the right side holds your Serotonin panel
      if (forced && !this.pendingItem) drawText(g, tl('Choose who goes next'), 10, BOX_Y - 12, { color: C.yellow, shadow: C.ink });
      if (b.phase === 'PHASE_SHIFT_OFFER') drawText(g, tl('Swap in who?'), 10, BOX_Y - 12, { color: C.yellow, shadow: C.ink });
      if (r.chosen >= 0) {
        if (this.pendingItem) send({ type: 'BATTLE_ACTION', action: 'BAG', payloadId: this.pendingItem, target: r.chosen });
        else send({ type: 'BATTLE_ACTION', action: 'SWITCH', payloadId: r.chosen });
      } else if (input.pressed('b') && !forced) back();
    }
  },
};

export function install(game) { game.register('battle', battleView); }
