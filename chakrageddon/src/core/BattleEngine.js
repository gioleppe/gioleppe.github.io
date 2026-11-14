// Deterministic turn resolver. Phases (spec 11.3):
// PHASE_INTRO -> PHASE_AWAIT_COMMAND -> PHASE_TURN_RESOLUTION -> PHASE_END_OF_TURN -> PHASE_FAINT_CHECK
//   -> PHASE_AWAIT_COMMAND | PHASE_AWAIT_SWITCH | PHASE_VICTORY | PHASE_WHITEOUT (+ PHASE_LEARN_MOVE prompts)
//   PHASE_SHIFT_OFFER: a trainer's Astral fainted; before the next comes out you may swap yours for free
//   (only with ctx.options.shift, the "Shift" battle style; SWITCH or STAY answers it)
import { bandOf } from './intox.js';
import { statsOf, snapshot, nameOf, gainXp, evolutionTarget, evolve, createMon, addToCollection, healMon } from './mons.js';
import { selectAction } from './AIController.js';
import { setMode, runScript, gauntletReset } from './ScriptEngine.js';
import { enterZone, zoneOf } from './OverworldEngine.js';
import { applyItem } from './items.js';

const other = (side) => (side === 'p' ? 'e' : 'p');
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const B = (ctx) => ctx.state.battle;
const msg = (ctx, text) => ctx.emit({ type: 'MESSAGE', text });
/** a line to read, not a play-by-play (a boss speaking, your reflection): the view waits for A before going on */
const say = (ctx, text) => ctx.emit({ type: 'MESSAGE', text, read: true });

export function active(ctx, side) { const b = B(ctx); return side === 'p' ? ctx.state.party[b.pi] : b.enemy[b.ei]; }
function label(ctx, side) {
  const n = nameOf(ctx.data, active(ctx, side));
  return side === 'p' ? n : B(ctx).kind === 'wild' ? `Wild ${n}` : B(ctx).kind === 'mirror' ? `Mirror ${n}` : `Foe ${n}`;
}
const newSide = () => ({ stages: {}, loop: 0, trap: 0, trapHeal: 0, last: null, turnsOut: 0, maxHp: 1 });
function refreshSide(ctx, side) { B(ctx).side[side].maxHp = statsOf(ctx.data, active(ctx, side)).maxHp; }

/** a creature's passive ability (data/dex.json "ability"; Nitroxide's old "trait" still counts) */
export const abilityOf = (ctx, mon) => { const sp = ctx.data.dex[mon.speciesId]; return sp.ability || sp.trait || null; };
const holds = (mon, itemId) => mon.held === itemId;
/** hydration a move really costs this creature: Stamina takes one off, the Steel Flask a share (rules.battle.flaskSave,
 *  a third: at least one) */
export function moveCost(ctx, mon, move) {
  const c = move.hydrationCost;
  if (!(c > 0)) return 0;
  const flask = holds(mon, 'steel_flask') ? Math.max(1, Math.round(c * (ctx.data.rules.battle.flaskSave ?? 1 / 3))) : 0;
  return Math.max(0, c - (abilityOf(ctx, mon) === 'STAMINA' ? 1 : 0) - flask);
}
export function usableMoves(ctx, mon) { return mon.moves.filter((id) => mon.hyd >= moveCost(ctx, mon, ctx.data.moves[id])); }

// ---------------------------------------------------------------- start

export function startBattle(ctx, { kind, enemy, trainerId, scripted, restore }) {
  const s = ctx.state, pi = s.party.findIndex((m) => m.hp > 0);
  if (pi < 0) return false;
  const zone = zoneOf(ctx);
  s.battle = {
    kind, trainerId: trainerId || null, enemy, ei: 0, pi, phase: 'PHASE_INTRO', turn: 0, intox: 0, invert: 0, startIntox: s.intox,
    side: { p: newSide(), e: newSide() }, seen: [s.party[pi].uid], pending: [], runTries: 0, scripted: !!scripted, result: null,
    ...(restore ? { restore } : {}),
  };
  const b = s.battle;
  refreshSide(ctx, 'p'); refreshSide(ctx, 'e');
  setMode(ctx, 'ASTRAL_BATTLE', 'BATTLE_INTRO');
  const wP = ctx.data.dex[s.party[pi].speciesId].intoxicationWeight, wE = ctx.data.dex[enemy[0].speciesId].intoxicationWeight;
  b.intox = clamp01(s.intox + ((wP + wE) / 2) * 0.5);
  const trainer = trainerId ? ctx.data.trainers[trainerId] : null;
  const mirror = kind === 'mirror';
  ctx.emit({ type: 'BATTLE_START', kind, trainerName: mirror ? 'You' : trainer?.name || null, trainerSprite: mirror ? s.outfit || 'player' : trainer?.sprite || null, boss: !!trainer?.boss, player: snapshot(ctx.data, s.party[pi]), enemy: snapshot(ctx.data, enemy[0]), enemyCount: enemy.length, paletteId: zone.paletteId });
  ctx.emit({ type: 'INTOXICATION_CHANGED', oldLevel: s.intox, newLevel: b.intox });
  ctx.emit({ type: 'AUDIO_CUE', start: true, trackBpm: (zone.baseBpm || 140) + (trainer?.boss ? 12 : 6), lowPassFilterHz: 20000 - b.intox * 12000, mood: trainer?.boss ? 'BOSS' : 'BATTLE', ...(trainer?.boss ? { theme: `boss:${trainer.cutscene || trainer.id.replace(/_rematch$/, '')}` } : {}) });   // every boss has a theme of their own
  s.dex.seen[enemy[0].speciesId] = 1;
  if (kind === 'wild') msg(ctx, `A wild ${nameOf(ctx.data, enemy[0])} drifts out of the haze!`);
  else if (mirror) { msg(ctx, 'Your reflection wants an astral clash!'); msg(ctx, `Your reflection manifests ${nameOf(ctx.data, enemy[0])}!`); }
  else { msg(ctx, `${trainer.name} wants an astral clash!`); msg(ctx, `${trainer.name} manifests ${nameOf(ctx.data, enemy[0])}!`); }
  msg(ctx, `Go, ${nameOf(ctx.data, s.party[pi])}!`);
  b.phase = 'PHASE_AWAIT_COMMAND';
  return true;
}
export function startWildBattle(ctx, speciesId, level, opts = {}) {
  return startBattle(ctx, { kind: 'wild', enemy: [createMon(ctx, speciesId, level)], scripted: opts.scripted });
}
/** your reflection, at Ego gone: the same Astrals at the same levels. No Vibes, no prize, no whiteout, and afterwards
 *  everyone's stamina, hydration and condition go back to what they were before. */
export function startMirrorBattle(ctx) {
  const s = ctx.state;
  const restore = s.party.map((m) => ({ uid: m.uid, hp: m.hp, hyd: m.hyd, status: m.status || null }));
  const enemy = s.party.map((m) => createMon(ctx, m.speciesId, m.level, [...m.moves]));
  return startBattle(ctx, { kind: 'mirror', enemy, scripted: true, restore });
}
export function startTrainerBattle(ctx, trainerId) {
  const t = ctx.data.trainers[trainerId];
  return startBattle(ctx, { kind: 'trainer', trainerId, enemy: t.party.map((p) => trained(ctx, createMon(ctx, p.species, p.level, p.moves))), scripted: true });
}
/** a trainer's Astral: festival regulars carry more water than a wild one (rules.stat.trainerWater a level) */
function trained(ctx, mon) {
  const w = ctx.data.rules.stat.trainerWater || 0;
  if (w && mon.gains) { mon.gains.hyd += w * (mon.level - 1); mon.hyd = statsOf(ctx.data, mon).maxHyd; }
  return mon;
}

// ---------------------------------------------------------------- numbers

const STAGE = (n) => (n >= 0 ? (2 + n) / 2 : 2 / (2 - n));
function effStat(ctx, side, key) {
  const b = B(ctx), mon = active(ctx, side);
  let v = statsOf(ctx.data, mon)[key] * STAGE(b.side[side].stages[key] || 0);
  if (key === 'bpmSpeed' && mon.status?.id === 'K_HOLED') v *= ctx.data.rules.battle.kHoleSpeed;
  return Math.max(1, v);
}
export function typeMultiplier(data, moveType, defTypes, inverted) {
  let m = 1;
  for (const t of defTypes) {
    let k = data.typeChart.chart[moveType]?.[t] ?? 1;
    if (inverted && k !== 1) k = 1 / k;
    m *= k;
  }
  return m;
}
/** Goa Astral Damage Formula (spec 4.3). roll=false gives the AI a deterministic estimate. */
function calcDamage(ctx, side, move, roll) {
  const b = B(ctx), R = ctx.data.rules.battle, atk = active(ctx, side), def = active(ctx, other(side));
  const phys = move.category === 'PHYSICAL';
  let A = effStat(ctx, side, phys ? 'vibeAttack' : 'spFractal');
  const D = effStat(ctx, other(side), phys ? 'egoDefense' : 'spGrounded');
  if (phys && atk.status?.id === 'COTTONMOUTH') A *= 0.5;
  const base = (((2 * atk.level) / 5 + 2) * move.power * (A / D)) / 50 + 2;
  const atkSp = ctx.data.dex[atk.speciesId];
  const stab = move.type !== 'NORMAL' && atkSp.types.includes(move.type) ? R.stab : 1;
  const mult = move.type === 'NORMAL' ? 1 : typeMultiplier(ctx.data, move.type, ctx.data.dex[def.speciesId].types, b.invert > 0);
  const ab = abilityOf(ctx, atk), defAb = abilityOf(ctx, def);
  const critChance = R.critBase + (R.critMax - R.critBase) * b.intox + (ab === 'SHARP_EYES' ? 0.0625 : 0) + (holds(atk, 'lucky_rupee') ? 0.06 : 0);
  const crit = roll ? ctx.rng.chance(critChance) && defAb !== 'GROUNDED' : false;
  const rand = roll ? R.randMin + ctx.rng.next() * (1 - R.randMin) : (1 + R.randMin) / 2;
  const burst = ab === 'BURST' && b.side[side].turnsOut === 0 ? R.burstMult : 1;
  const low = atk.hp < statsOf(ctx.data, atk).maxHp / 3;
  const over = ab === 'OVERDRIVE' && low && atkSp.types.includes(move.type) ? 1.3 : 1;
  const skin = defAb === 'THICK_SKIN' && phys ? 0.8 : 1;
  const glow = holds(atk, 'neon_glowstick') ? 1.1 : 1;
  // the difficulty (Options): your moves hit for `dealt`, theirs for `taken`. Once, on the final damage of a move, so the
  // type chart, same-type bonus, crits, abilities and gear stay as they are; recoil and drain follow the damage they come from
  const level = ctx.data.rules.difficulty?.[ctx.options?.difficulty || 'normal'] || { dealt: 1, taken: 1 };
  const diff = side === 'p' ? level.dealt : level.taken;
  return { dmg: Math.max(1, Math.floor(base * stab * mult * (crit ? R.critMult : 1) * rand * burst * over * skin * glow * diff)), crit, mult };
}
export function estimateDamage(ctx, battle, side, moveId) { return calcDamage(ctx, side, ctx.data.moves[moveId], false).dmg; }

function hurt(ctx, side, amount) {
  const mon = active(ctx, side), max = statsOf(ctx.data, mon).maxHp;
  const d = Math.min(mon.hp, Math.max(0, Math.floor(amount)));
  mon.hp -= d;
  ctx.emit({ type: 'STAT_DELTA', targetId: side, stat: 'SEROTONIN', delta: -d, current: mon.hp, max });
  return d;
}
function mend(ctx, side, amount) {
  const mon = active(ctx, side), max = statsOf(ctx.data, mon).maxHp;
  const d = Math.max(0, Math.min(max - mon.hp, Math.floor(amount)));
  mon.hp += d;
  if (d) ctx.emit({ type: 'STAT_DELTA', targetId: side, stat: 'SEROTONIN', delta: d, current: mon.hp, max });
  return d;
}
function hydrate(ctx, side, delta) {
  const mon = active(ctx, side), max = statsOf(ctx.data, mon).maxHyd;
  const before = mon.hyd;
  mon.hyd = Math.max(0, Math.min(max, mon.hyd + delta));
  if (mon.hyd !== before) ctx.emit({ type: 'STAT_DELTA', targetId: side, stat: 'HYDRATION', delta: mon.hyd - before, current: mon.hyd, max });
}
function setIntox(ctx, v) {
  const b = B(ctx), old = b.intox;
  b.intox = clamp01(v);
  if (b.intox !== old) ctx.emit({ type: 'INTOXICATION_CHANGED', oldLevel: old, newLevel: b.intox });
}

const STATUS_TEXT = {
  COTTONMOUTH: 'has cottonmouth!', K_HOLED: 'fell into a K-hole!', THOUGHT_LOOP: 'is caught in a thought loop!',
  EGO_DEATH: 'dissolves into ego death!', JAW_LOCK: 'has its jaw locked!',
};
export function applyStatus(ctx, side, status) {
  const b = B(ctx), R = ctx.data.rules.battle, mon = active(ctx, side), sd = b.side[side];
  if (mon.hp <= 0) return false;
  if (abilityOf(ctx, mon) === 'CLEAR_HEAD' && (status === 'THOUGHT_LOOP' || status === 'K_HOLED')) { msg(ctx, `${label(ctx, side)}'s Clear Head keeps it together.`); return false; }
  if (holds(mon, 'sand_mala') && (status === 'THOUGHT_LOOP' || status === 'K_HOLED')) { msg(ctx, `${label(ctx, side)}'s Sand Mala keeps it together.`); return false; }   // the Unfinished Mandala's reward
  if (status === 'THOUGHT_LOOP') {
    if (sd.loop > 0) { msg(ctx, `${label(ctx, side)} is already going in circles.`); return false; }
    sd.loop = ctx.rng.int(R.thoughtLoopTurns[0], R.thoughtLoopTurns[1]) + 1;
    if (side === 'p' && (ctx.state.bag.earplugs || 0) > 0) sd.loop = Math.max(2, sd.loop - 1);
  } else {
    if (mon.status) { msg(ctx, `${label(ctx, side)} is already ${mon.status.id.toLowerCase().replace('_', ' ')}.`); return false; }
    mon.status = { id: status };
    if (status === 'EGO_DEATH') mon.status.turns = R.egoDeathTurns;
    if (status === 'K_HOLED') mon.status.turns = ctx.rng.int(R.kHoleTurns[0], R.kHoleTurns[1]) + 1;
    if (status === 'JAW_LOCK') mon.status.n = 0;
  }
  ctx.emit({ type: 'STATUS_APPLIED', targetId: side, status });
  msg(ctx, `${label(ctx, side)} ${STATUS_TEXT[status]}`);
  return true;
}
const STAT_NAMES = { vibeAttack: 'Vibe Attack', egoDefense: 'Ego Defense', spFractal: 'Fractal power', spGrounded: 'Groundedness', bpmSpeed: 'BPM' };
function stage(ctx, side, stat, n) {
  const st = B(ctx).side[side].stages, cur = st[stat] || 0, next = Math.max(-6, Math.min(6, cur + n));
  if (next === cur) { msg(ctx, `${label(ctx, side)}'s ${STAT_NAMES[stat]} cannot go any ${n > 0 ? 'higher' : 'lower'}.`); return; }
  st[stat] = next;
  ctx.emit({ type: 'STAT_STAGE', targetId: side, stat, stages: next, delta: next - cur });
  msg(ctx, `${label(ctx, side)}'s ${STAT_NAMES[stat]} ${n > 0 ? (n > 1 ? 'rose sharply!' : 'rose!') : (n < -1 ? 'dropped hard!' : 'dropped!')}`);
}

// ---------------------------------------------------------------- one move

function executeMove(ctx, side, moveId) {
  const b = B(ctx), R = ctx.data.rules.battle, mon = active(ctx, side), sd = b.side[side], foeSide = other(side);
  if (mon.hp <= 0 || active(ctx, foeSide).hp <= 0) return;
  const who = label(ctx, side);

  // pre-move status gates
  if (mon.status?.id === 'EGO_DEATH') {
    if (mon.status.turns > 0) { mon.status.turns--; msg(ctx, `${who} is deep in an ego death.`); return; }
    mon.status = null; ctx.emit({ type: 'STATUS_CLEARED', targetId: side, status: 'EGO_DEATH' });
    msg(ctx, `${who} comes back, a little wiser.`); stage(ctx, side, 'spGrounded', 2);
  }
  if (mon.status?.id === 'K_HOLED') {
    mon.status.turns--;
    if (mon.status.turns <= 0) { mon.status = null; ctx.emit({ type: 'STATUS_CLEARED', targetId: side, status: 'K_HOLED' }); msg(ctx, `${who} climbs out of the K-hole.`); }
    else if (ctx.rng.chance(R.kHoleSkip)) { msg(ctx, `${who} has forgotten what limbs are.`); return; }
  }
  if (sd.loop > 0) {
    sd.loop--;
    if (sd.loop === 0) { ctx.emit({ type: 'STATUS_CLEARED', targetId: side, status: 'THOUGHT_LOOP' }); msg(ctx, `${who} snaps out of the thought loop.`); }
    else if (ctx.rng.chance(R.thoughtLoopChance)) {
      if (sd.last && ctx.rng.chance(0.5)) { msg(ctx, `${who} is looping and repeats itself!`); moveId = sd.last; }
      else {
        msg(ctx, `${who} wonders why hands have fingers, and hits itself.`);
        const st = statsOf(ctx.data, mon);
        hurt(ctx, side, Math.max(1, Math.floor((((2 * mon.level) / 5 + 2) * R.selfHitPower * (st.vibeAttack / st.egoDefense)) / 50 + 2)));
        return;
      }
    }
  }

  let move = ctx.data.moves[moveId];
  if (mon.hyd < moveCost(ctx, mon, move)) { msg(ctx, `${who} is too parched for ${move.name}!`); move = ctx.data.moves.dry_heave; }
  else if (move.id !== 'dry_heave') sd.last = move.id;
  if (moveCost(ctx, mon, move) > 0) hydrate(ctx, side, -moveCost(ctx, mon, move));
  ctx.emit({ type: 'BATTLE_MOVE_USED', actorId: side, moveId: move.id, shaderCue: move.shaderCue || 'NONE', moveType: move.type, category: move.category });
  msg(ctx, `${who} used ${move.name}!`);

  const effects = move.effects || [];
  const selfOnly = move.power === 0 && effects.length > 0 && effects.every((e) => e.target === 'self' || ['HEAL', 'HYDRATE'].includes(e.effectType));
  if (!selfOnly && move.accuracy > 0 && !ctx.rng.chance(move.accuracy / 100)) { msg(ctx, 'It drifts wide.'); return; }
  if (!selfOnly && move.power > 0 && abilityOf(ctx, active(ctx, foeSide)) === 'DREAMER' && ctx.rng.chance(1 / 7)) { msg(ctx, `${label(ctx, foeSide)} drifts somewhere else for a moment. It misses.`); return; }

  let total = 0;
  if (move.power > 0) {
    const multi = effects.find((e) => e.effectType === 'MULTI_HIT');
    const hits = multi ? ctx.rng.int(multi.min, multi.max) : 1;
    let n = 0, mult = 1;
    for (let i = 0; i < hits && active(ctx, foeSide).hp > 0; i++) {
      const r = calcDamage(ctx, side, move, true);
      ctx.emit({ type: 'MOVE_HIT', actorId: side, targetId: foeSide, moveId: move.id, hit: i + 1, mult: r.mult, crit: !!r.crit });   // for the view: each hit lands
      total += hurt(ctx, foeSide, r.dmg); n++; mult = r.mult;
      if (r.crit) { ctx.emit({ type: 'CRITICAL', targetId: foeSide }); msg(ctx, 'A critical hit!'); }
    }
    if (multi) msg(ctx, `It landed ${n} time${n === 1 ? '' : 's'}!`);
    afterHit(ctx, side, foeSide, move, total);
    if (mult > 1) msg(ctx, 'It really resonates!'); else if (mult < 1) msg(ctx, 'It barely registers...');
  }
  for (const e of effects) {
    if (e.effectType === 'MULTI_HIT') continue;
    if ((e.chance ?? 1) < 1 && !ctx.rng.chance(e.chance)) continue;
    const target = e.target === 'self' ? side : foeSide;
    switch (e.effectType) {
      case 'APPLY_STATUS': applyStatus(ctx, target, e.status); break;
      case 'DRAIN_SEROTONIN': if (total > 0 && mend(ctx, side, Math.max(1, total * e.drainRatio))) msg(ctx, `${who} soaks up some serotonin.`); break;
      case 'RECOIL': if (total > 0 && mon.hp > 0) { hurt(ctx, side, Math.max(1, total * e.ratio)); msg(ctx, `${who} is shaken by the effort.`); } break;
      case 'INVERT_TYPE_CHART': b.invert = e.durationTurns + 1; ctx.emit({ type: 'FIELD_EFFECT', effect: 'INVERT_TYPE_CHART', turns: e.durationTurns }); msg(ctx, 'Strengths and weaknesses turn inside out!'); break;
      case 'SPIKE_INTOXICATION': setIntox(ctx, b.intox + e.delta); break;
      case 'TRAP': if (active(ctx, foeSide).hp > 0) { const fs = b.side[foeSide]; fs.trap = e.turns; fs.trapHeal = e.healRatio; msg(ctx, `${label(ctx, foeSide)} sinks into the couch and cannot leave.`); } break;
      case 'STAT_STAGE': if (active(ctx, target).hp > 0) stage(ctx, target, e.stat, e.stages); break;
      case 'HEAL': if (mend(ctx, side, sd.maxHp * e.ratio)) msg(ctx, `${who} feels restored.`); else msg(ctx, 'Nothing happened.'); break;
      case 'HYDRATE': hydrate(ctx, side, e.amount); msg(ctx, `${who} rehydrates.`); break;
      default: throw new Error(`unknown effect ${e.effectType}`);
    }
  }
  mirrorCopy(ctx, foeSide, move);
}

/** MIRROR (Mirrorling): the first move used on it, it copies into its last slot for the rest of the battle */
function mirrorCopy(ctx, side, move) {
  const b = B(ctx), mon = active(ctx, side), sd = b.side[side];
  if (sd.mirrored || mon.hp <= 0 || abilityOf(ctx, mon) !== 'MIRROR' || move.id === 'dry_heave' || mon.moves.includes(move.id)) return;
  sd.mirrored = true;
  (b.mirrorMoves ||= {})[mon.uid] ||= [...mon.moves];                  // given back when the battle ends
  mon.moves = mon.moves.length < 4 ? [...mon.moves, move.id] : [...mon.moves.slice(0, 3), move.id];
  msg(ctx, `${label(ctx, side)} watches closely, and copies ${move.name}!`);
}

// ---------------------------------------------------------------- turn

export function battleAction(ctx, cmd) {
  const b = B(ctx), s = ctx.state;
  if (!b) return;
  if (b.phase === 'PHASE_AWAIT_SWITCH') {
    const idx = Number(cmd.payloadId);
    if (cmd.action !== 'SWITCH' || !s.party[idx] || s.party[idx].hp <= 0) return;
    switchIn(ctx, 'p', idx);
    b.phase = 'PHASE_AWAIT_COMMAND';
    return;
  }
  if (b.phase === 'PHASE_SHIFT_OFFER') {
    // a free swap before the trainer's next Astral comes out, or STAY to keep yours in
    if (cmd.action === 'SWITCH') {
      const idx = Number(cmd.payloadId);
      if (!s.party[idx] || idx === b.pi || s.party[idx].hp <= 0) return;
      switchIn(ctx, 'p', idx);
    } else if (cmd.action !== 'STAY') return;
    const next = b.nextEi; b.nextEi = null;
    switchIn(ctx, 'e', next);
    b.phase = 'PHASE_AWAIT_COMMAND';
    return;
  }
  if (b.phase !== 'PHASE_AWAIT_COMMAND') return;
  const mon = active(ctx, 'p'), sd = b.side.p;
  let act;
  if (cmd.action === 'FIGHT') {
    let moveId = cmd.payloadId;
    const usable = usableMoves(ctx, mon);
    if (!usable.length) moveId = 'dry_heave';
    else if (!mon.moves.includes(moveId)) return;
    else if (!usable.includes(moveId)) return msg(ctx, 'Not enough Hydration for that.');
    act = { action: 'FIGHT', moveId };
  } else if (cmd.action === 'SWITCH') {
    const idx = Number(cmd.payloadId);
    if (!s.party[idx] || idx === b.pi || s.party[idx].hp <= 0) return;
    if (sd.trap > 0) return msg(ctx, `${label(ctx, 'p')} is stuck to the couch!`);
    act = { action: 'SWITCH', idx };
  } else if (cmd.action === 'BAG') {
    const item = ctx.data.items[cmd.payloadId];
    if (!item || !(s.bag[item.id] > 0)) return;
    if (item.category === 'BAGGING') { if (b.kind !== 'wild') return msg(ctx, 'You cannot bag somebody else\'s trip.'); act = { action: 'BAG', item }; }
    else if (item.category === 'RECOVERY') {
      const target = s.party[cmd.target ?? b.pi];
      if (!target) return;
      const res = applyItem(ctx, item, target, { dryRun: true });
      if (!res.ok) return msg(ctx, res.text);
      act = { action: 'BAG', item, target };
    } else return msg(ctx, 'That is no use right now.');
  } else if (cmd.action === 'RUN') {
    if (b.kind !== 'wild') return msg(ctx, 'There is no walking away from eye contact.');
    if (sd.trap > 0) return msg(ctx, `${label(ctx, 'p')} is stuck to the couch!`);
    act = { action: 'RUN' };
  } else return;
  resolveTurn(ctx, act);
}

function switchIn(ctx, side, idx) {
  const b = B(ctx);
  if (side === 'p') { b.pi = idx; if (!b.seen.includes(ctx.state.party[idx].uid)) b.seen.push(ctx.state.party[idx].uid); }
  else { b.ei = idx; ctx.state.dex.seen[b.enemy[idx].speciesId] = 1; }
  b.side[side] = newSide();
  refreshSide(ctx, side);
  b.side[other(side)].trap = 0;
  ctx.emit({ type: 'SWITCH_IN', side, mon: snapshot(ctx.data, active(ctx, side)) });
  msg(ctx, side === 'p' ? `Go, ${nameOf(ctx.data, active(ctx, 'p'))}!` : `${b.kind === 'mirror' ? 'Your reflection' : ctx.data.trainers[b.trainerId].name} manifests ${nameOf(ctx.data, active(ctx, 'e'))}!`);
}

function resolveTurn(ctx, pAct) {
  const b = B(ctx), s = ctx.state;
  b.phase = 'PHASE_TURN_RESOLUTION'; b.turn++;
  const eAct = selectAction(ctx, b);

  if (pAct.action === 'RUN') {
    const chance = 0.5 + 0.2 * b.runTries++ + (effStat(ctx, 'p', 'bpmSpeed') >= effStat(ctx, 'e', 'bpmSpeed') ? 0.3 : 0);
    if (ctx.rng.chance(chance)) { msg(ctx, 'You slip away into the crowd.'); return finish(ctx, 'RAN'); }
    msg(ctx, 'You cannot get away!');
  } else if (pAct.action === 'SWITCH') {
    msg(ctx, `${nameOf(ctx.data, active(ctx, 'p'))}, come back!`);
    switchIn(ctx, 'p', pAct.idx);
  } else if (pAct.action === 'BAG') {
    s.bag[pAct.item.id]--;
    if (pAct.item.category === 'BAGGING') { if (tryCapture(ctx, pAct.item)) return; }
    else { const res = applyItem(ctx, pAct.item, pAct.target, { inBattle: true }); msg(ctx, res.text); syncActive(ctx); }
  }

  const order = [];
  if (pAct.action === 'FIGHT') order.push({ side: 'p', moveId: pAct.moveId });
  order.push({ side: 'e', moveId: eAct.moveId });
  if (order.length === 2) {
    const pr = (o) => ctx.data.moves[o.moveId].priority || 0;
    const sp = { p: effStat(ctx, 'p', 'bpmSpeed'), e: effStat(ctx, 'e', 'bpmSpeed') };
    const tie = ctx.rng.next() < 0.5 ? 1 : -1;
    order.sort((a, c) => pr(c) - pr(a) || sp[c.side] - sp[a.side] || tie);
  }
  for (const o of order) executeMove(ctx, o.side, o.moveId);

  b.phase = 'PHASE_END_OF_TURN';
  endOfTurn(ctx);
  b.phase = 'PHASE_FAINT_CHECK';
  faintCheck(ctx);
  if (ctx.state.battle === b && !b.result) bossMoment(ctx);
}

/**
 * A boss's moment (trainer "moment"): the first time their team is down to half its Serotonin, they say a line and
 * change something. { line, effects: [{ type: STAT, target, stat, stages } | { type: INVERT, turns } | { type: INTOX,
 * delta } | { type: HEAL, ratio }], bpm?: the music speeds up to this, fx?: what the view shows }
 */
function bossMoment(ctx) {
  const b = B(ctx), t = b.trainerId && ctx.data.trainers[b.trainerId], m = t?.moment;
  if (!m || b.moment) return;
  const max = b.enemy.reduce((a, mon) => a + statsOf(ctx.data, mon).maxHp, 0), now = b.enemy.reduce((a, mon) => a + Math.max(0, mon.hp), 0);
  if (!(now > 0 && now <= max / 2)) return;
  b.moment = true;
  ctx.emit({ type: 'BOSS_MOMENT', trainerId: t.id, name: t.name, line: m.line, fx: m.fx || null });
  say(ctx, `${t.name}: "${m.line}"`);
  for (const e of m.effects || []) {
    if (e.type === 'STAT' && active(ctx, e.target || 'e').hp > 0) stage(ctx, e.target || 'e', e.stat, e.stages);
    else if (e.type === 'INVERT') { b.invert = e.turns + 1; ctx.emit({ type: 'FIELD_EFFECT', effect: 'INVERT_TYPE_CHART', turns: e.turns }); msg(ctx, 'Strengths and weaknesses turn inside out!'); }
    else if (e.type === 'INTOX') setIntox(ctx, b.intox + e.delta);
    else if (e.type === 'HEAL' && mend(ctx, 'e', b.side.e.maxHp * e.ratio)) msg(ctx, `${label(ctx, 'e')} feels restored.`);
  }
  if (m.bpm) ctx.emit({ type: 'AUDIO_CUE', trackBpm: m.bpm, mood: 'BOSS', theme: `boss:${t.cutscene || t.id.replace(/_rematch$/, '')}` });
}

/** After an item, tell the view the active creature's fresh numbers. */
function syncActive(ctx) { ctx.emit({ type: 'SYNC', side: 'p', mon: snapshot(ctx.data, active(ctx, 'p')) }); }

/** abilities that react to being hit */
function afterHit(ctx, side, foeSide, move, total) {
  const b = B(ctx), foe = active(ctx, foeSide), fs = b.side[foeSide], ab = abilityOf(ctx, foe);
  if (total > 0 && foe.hp > 0 && ab === 'SECOND_WIND' && !fs.secondWind && foe.hp < statsOf(ctx.data, foe).maxHp / 3) {
    fs.secondWind = true; msg(ctx, `${label(ctx, foeSide)} catches its Second Wind!`); mend(ctx, foeSide, statsOf(ctx.data, foe).maxHp / 4);
  }
  if (total > 0 && ab === 'STATIC_CLING' && move.category === 'PHYSICAL' && active(ctx, side).hp > 0 && !active(ctx, side).status && ctx.rng.chance(0.25)) {
    msg(ctx, `${label(ctx, foeSide)}'s Static Cling leaves a bad taste.`); applyStatus(ctx, side, 'COTTONMOUTH');
  }
}

function endOfTurn(ctx) {
  const b = B(ctx), R = ctx.data.rules.battle;
  for (const side of ['p', 'e']) {
    const mon = active(ctx, side), sd = b.side[side];
    if (mon.hp <= 0) continue;
    if (mon.status?.id === 'JAW_LOCK') {
      mon.status.n++;
      hurt(ctx, side, Math.max(1, Math.floor((sd.maxHp * mon.status.n) / 16)));
      msg(ctx, `${label(ctx, side)} grinds its teeth.`);
    }
    if (mon.status?.id === 'COTTONMOUTH' && mon.hyd > 0) hydrate(ctx, side, -R.cottonmouthDrain);
    if (sd.trap > 0 && mon.hp > 0 && active(ctx, other(side)).hp > 0) {
      mend(ctx, other(side), b.side[other(side)].maxHp * sd.trapHeal);
      if (--sd.trap === 0) msg(ctx, `${label(ctx, side)} peels itself off the couch.`);
    }
    if (holds(mon, 'friendship_band') && mon.hp > 0 && mend(ctx, side, sd.maxHp / 16)) msg(ctx, `${label(ctx, side)}'s Friendship Band keeps it going.`);
    sd.turnsOut++;
    if (abilityOf(ctx, mon) === 'BURST' && sd.turnsOut >= 2 && mon.hp > 0) { msg(ctx, `${label(ctx, side)} is completely spent. Pop.`); hurt(ctx, side, mon.hp); }
  }
  if (b.invert > 0 && --b.invert === 0) { ctx.emit({ type: 'FIELD_EFFECT', effect: 'INVERT_TYPE_CHART', turns: 0 }); msg(ctx, 'Strengths and weaknesses settle back.'); }
}

function faintCheck(ctx) {
  const b = B(ctx), s = ctx.state;
  const e = active(ctx, 'e'), p = active(ctx, 'p');
  let enemyOut = false;
  if (e.hp <= 0) {
    ctx.emit({ type: 'FAINT', side: 'e' }); ctx.emit({ type: 'AUDIO_CUE', sfxId: 'faint' });
    msg(ctx, `${label(ctx, 'e')} fades out.`);
    e.status = null;
    if (b.kind !== 'mirror') awardXp(ctx, e);                       // nothing to learn from yourself
    enemyOut = !b.enemy.some((m) => m.hp > 0);
  }
  if (p.hp <= 0) {
    ctx.emit({ type: 'FAINT', side: 'p' }); ctx.emit({ type: 'AUDIO_CUE', sfxId: 'faint' });
    msg(ctx, `${nameOf(ctx.data, p)} fades out.`);
    p.status = null;
    if (!s.party.some((m) => m.hp > 0)) return b.kind === 'mirror' ? (b.phase = 'PHASE_VICTORY', say(ctx, 'Your reflection wins. It does not seem to mind.'), finish(ctx, 'LOST')) : whiteout(ctx);
  }
  if (enemyOut) return victory(ctx);
  if (e.hp <= 0) {
    const next = b.enemy.findIndex((m) => m.hp > 0);
    // Shift style: say who is coming and let the player swap first (only when theirs is still standing and has company)
    if (ctx.options?.shift && b.kind === 'trainer' && p.hp > 0 && s.party.some((m, i) => i !== b.pi && m.hp > 0)) {
      b.nextEi = next; b.phase = 'PHASE_SHIFT_OFFER';
      ctx.emit({ type: 'SHIFT_OFFER', next: snapshot(ctx.data, b.enemy[next]) });
      msg(ctx, `${ctx.data.trainers[b.trainerId].name} is about to manifest ${nameOf(ctx.data, b.enemy[next])}.`);
      return;
    }
    switchIn(ctx, 'e', next);
  }
  b.phase = p.hp <= 0 ? 'PHASE_AWAIT_SWITCH' : 'PHASE_AWAIT_COMMAND';
}

function awardXp(ctx, fallen) {
  const b = B(ctx), s = ctx.state, R = ctx.data.rules.battle;
  const sp = ctx.data.dex[fallen.speciesId];
  const bst = Object.values(sp.baseStats).reduce((a, v) => a + v, 0);
  const takers = s.party.filter((m) => b.seen.includes(m.uid) && m.hp > 0);
  if (takers.length) {
    const xpMult = bandOf(ctx.data.rules, b.startIntox ?? 0).xp ?? 1;   // the higher you went into it, the more you learn
    const each = Math.max(1, Math.floor((((bst / 4) * fallen.level * (b.kind === 'trainer' ? R.trainerXpMult : 1)) / R.xpDivisor / takers.length) * xpMult));
    for (const m of takers) {
      msg(ctx, `${nameOf(ctx.data, m)} gained ${each} Vibes.`);
      const before = m.level;
      const wants = gainXp(ctx, m, each);
      if (m.level > before) msg(ctx, `${nameOf(ctx.data, m)} peaked to level ${m.level}!`);
      b.pending.push(...wants);
      if (m === active(ctx, 'p')) refreshSide(ctx, 'p');
    }
  }
  b.seen = [active(ctx, 'p').uid];
}

function tryCapture(ctx, item) {
  const b = B(ctx), s = ctx.state, mon = active(ctx, 'e'), sp = ctx.data.dex[mon.speciesId];
  const max = statsOf(ctx.data, mon).maxHp;
  const band = bandOf(ctx.data.rules, b.startIntox ?? 0);
  if (band.fumble && ctx.rng.chance(band.fumble)) {
    msg(ctx, `You open a ${item.name}...`);
    ctx.emit({ type: 'CAPTURE_THROW', itemId: item.id, shakes: 0, success: false, fumble: true });
    msg(ctx, 'Your hands are not your hands. The bag flutters off into the night.');
    return false;
  }
  const a = ((3 * max - 2 * mon.hp) / (3 * max)) * sp.catchRate * item.effect.catch * (mon.status ? ctx.data.rules.capture.statusBonus : 1) * (band.catch ?? 1);
  const p = Math.min(1, a / 255);
  const success = ctx.rng.chance(p);
  const shakes = success ? 3 : ctx.rng.int(0, 2);
  msg(ctx, `You open a ${item.name}...`);
  ctx.emit({ type: 'CAPTURE_THROW', itemId: item.id, shakes, success });
  if (!success) { msg(ctx, shakes === 2 ? 'So close! It wriggles free.' : 'It slips straight out.'); return false; }
  const where = addToCollection(ctx, mon);
  ctx.emit({ type: 'AUDIO_CUE', sfxId: 'fanfare' });
  msg(ctx, `Bagged! ${sp.name} is stabilised.`);
  if (where === 'box') msg(ctx, 'Your party is full, so it went to the Chai Tent stash.');
  b.enemy = [];
  finish(ctx, 'CAUGHT');
  return true;
}

function victory(ctx) {
  const b = B(ctx), s = ctx.state;
  b.phase = 'PHASE_VICTORY';
  if (b.trainerId) {
    const t = ctx.data.trainers[b.trainerId];
    s.defeated[t.id] = 1;
    s.rupees += t.reward || 0;
    msg(ctx, `You out-vibed ${t.name}!`);
    if (t.reward) { msg(ctx, `You got Rs ${t.reward}.`); ctx.emit({ type: 'RUPEES_CHANGED', rupees: s.rupees }); }
  } else if (b.kind === 'mirror') say(ctx, 'You out-vibed yourself. Nobody else saw.');
  else wildDrop(ctx);
  finish(ctx, 'WON');
}

/** a beaten wild Astral now and then leaves something behind (rules.battle.wildDrop: chance, item weights) */
function wildDrop(ctx) {
  const D = ctx.data.rules.battle.wildDrop, s = ctx.state;
  if (!D || !ctx.rng.chance(D.chance)) return;
  const table = Object.entries(D.items).filter(([id]) => ctx.data.items[id]);
  let roll = ctx.rng.next() * table.reduce((a, [, w]) => a + w, 0), id = table[0][0];
  for (const [k, w] of table) { roll -= w; if (roll <= 0) { id = k; break; } }
  s.bag[id] = (s.bag[id] || 0) + 1;
  msg(ctx, `The wild ${nameOf(ctx.data, B(ctx).enemy[0])} left something behind: a ${ctx.data.items[id].name}!`);
  ctx.emit({ type: 'ITEM_FOUND', itemId: id, n: 1 });
  ctx.emit({ type: 'AUDIO_CUE', sfxId: 'item' });
}

/** Ends the battle, first asking about any moves that need a slot. */
function finish(ctx, result) {
  const b = B(ctx);
  b.result = result;
  if (b.pending.length) { b.phase = 'PHASE_LEARN_MOVE'; promptLearn(ctx); return; }
  finalize(ctx);
}
function promptLearn(ctx) {
  const b = B(ctx), p = b.pending[0], mon = ctx.state.party.find((m) => m.uid === p.uid);
  ctx.emit({ type: 'LEARN_PROMPT', uid: p.uid, name: nameOf(ctx.data, mon), moveId: p.moveId, moves: [...mon.moves] });
}
export function learnMove(ctx, slot) {
  const b = B(ctx);
  if (!b || b.phase !== 'PHASE_LEARN_MOVE' || !b.pending.length) return;
  const p = b.pending.shift(), mon = ctx.state.party.find((m) => m.uid === p.uid);
  const mv = ctx.data.moves[p.moveId];
  if (mon && slot >= 0 && slot < mon.moves.length) {
    const old = ctx.data.moves[mon.moves[slot]].name;
    mon.moves[slot] = p.moveId;
    msg(ctx, `${nameOf(ctx.data, mon)} forgot ${old} and learned ${mv.name}!`);
    ctx.emit({ type: 'MOVE_LEARNED', uid: mon.uid, name: nameOf(ctx.data, mon), moveId: p.moveId });
  } else msg(ctx, `${mon ? nameOf(ctx.data, mon) : 'It'} did not learn ${mv.name}.`);
  if (b.pending.length) promptLearn(ctx); else finalize(ctx);
}

function finalize(ctx) {
  const b = B(ctx), s = ctx.state, R = ctx.data.rules.battle, result = b.result;
  // the mirror fight never happened, as far as your Astrals are concerned
  if (b.restore) for (const r of b.restore) { const m = s.party.find((x) => x.uid === r.uid); if (m) { m.hp = r.hp; m.hyd = r.hyd; m.status = r.status; } }
  if (b.mirrorMoves) for (const [uid, moves] of Object.entries(b.mirrorMoves)) { const m = [...s.party, ...s.box].find((x) => String(x.uid) === uid); if (m) m.moves = moves; }
  if ((result === 'WON' || result === 'CAUGHT') && b.kind !== 'mirror') {
    for (const m of s.party) {
      const target = m.hp > 0 ? evolutionTarget(ctx.data, m) : null;
      if (target) { const old = nameOf(ctx.data, m); evolve(ctx, m, target); msg(ctx, `What? ${old} is changing... it became ${ctx.data.dex[target].name}!`); }
    }
  }
  const old = s.intox;
  s.intox = clamp01(s.intox + R.intoxPerBattle + (b.intox - s.intox) * (R.intoxPull ?? 0.25));   // a fixed drift, plus a pull towards how high the fight ran
  ctx.emit({ type: 'INTOXICATION_CHANGED', oldLevel: old, newLevel: s.intox });
  ctx.emit({ type: 'BATTLE_END', result, boss: !!(b.trainerId && ctx.data.trainers[b.trainerId]?.boss) });
  s.battle = null;
  const zone = zoneOf(ctx);
  ctx.emit({ type: 'AUDIO_CUE', trackBpm: zone.baseBpm, lowPassFilterHz: 20000 - s.intox * 8000, mood: zone.paletteId, after: true });   // the view plays it once the battle screen closes
  if (s.script) runScript(ctx); else setMode(ctx, 'OVERWORLD');
}

function whiteout(ctx) {
  const b = B(ctx), s = ctx.state, R = ctx.data.rules.battle;
  b.phase = 'PHASE_WHITEOUT';
  const loss = Math.floor(s.rupees * R.whiteoutRupeeLoss * (bandOf(ctx.data.rules, s.intox).whiteoutLoss ?? 1));
  // and one random piece of cosmetic clothing walks off with somebody (spec: White Out / K-Hole)
  const outfits = Object.keys(s.bag).filter((id) => s.bag[id] > 0 && ctx.data.items[id]?.category === 'OUTFIT');
  let lostOutfit = null;
  if (outfits.length) {
    lostOutfit = ctx.data.items[outfits[ctx.rng.int(0, outfits.length - 1)]];
    s.bag[lostOutfit.id]--;
    if (s.outfit === lostOutfit.effect.outfit && !(s.bag[lostOutfit.id] > 0)) s.outfit = null;
  }
  s.rupees -= loss;
  msg(ctx, 'You have nobody left standing. Everything goes white...');
  ctx.emit({ type: 'BATTLE_END', result: 'LOST' });
  for (const m of [...s.party, ...s.box]) healMon(ctx.data, m);
  const runLost = gauntletReset(ctx);                                  // lost halfway up the Four: the climb starts over
  s.clock = (s.clock + R.whiteoutHours * 60) % 1440;
  s.battle = null; s.script = null; s.scriptMode = null; s.intox = 0;
  ctx.emit({ type: 'INTOXICATION_CHANGED', oldLevel: b.intox, newLevel: 0 });
  enterZone(ctx, s.lastTent.zone, s.lastTent.x, s.lastTent.y, 'DOWN');
  // the tent's music, once the battle screen has closed (the zone's own cue above lands in the battle queue, which the outro drops)
  const tent = ctx.data.zones[s.zoneId];
  ctx.emit({ type: 'AUDIO_CUE', trackBpm: tent.baseBpm, lowPassFilterHz: 20000, mood: tent.paletteId, after: true });
  s.dialogue = { speaker: '', text: `You white out. ${R.whiteoutHours} hours later you wake at ${s.lastTent.place || 'the Chai Tent'}${loss ? `, Rs ${loss} lighter` : ''}. Somebody has tucked you in.${lostOutfit ? ` Your ${lostOutfit.name} is gone.` : ''}${runLost ? ' The Four are back at their posts: the climb starts over.' : ''}`, style: 'DOWNER', choices: null };
  ctx.emit({ type: 'RUPEES_CHANGED', rupees: s.rupees });
  setMode(ctx, 'K_HOLE_WHITEOUT', 'WHITEOUT');
}
