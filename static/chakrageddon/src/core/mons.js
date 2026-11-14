// Creature instances: stats, levels, moves, evolution. Pure functions over data and state.

export const STAT_KEYS = ['vibeAttack', 'egoDefense', 'spFractal', 'spGrounded', 'bpmSpeed'];
/** what grows at each level-up: Serotonin (hp), Hydration (hyd) and the five stats */
export const GROWN = ['hp', 'hyd', ...STAT_KEYS];

// ---- growth (1.2.0). Each Astral grows a little at every level-up, by chance: Hydration +0, +1 or +2 (rules.stat.hydrationRoll),
// the other stats around their species' rate (2 x base / 100 a level, Serotonin +1), shaped by the species' schedule for
// that stat: early bloomers grow faster up to rules.stat.growthTurn and slower after, late bloomers the other way round.
// An Astral keeps what it rolled (mon.gains, up to mon.grownTo); levels past that, or an Astral from before 1.2.0, count
// at the average. The rolls come from a hash of the Astral's uid, the level and the stat (and the save's salt), so they are
// random per playthrough but do not use up the game's random numbers.
const SHAPES = { early: [1.25, 0.75], steady: [1, 1], late: [0.75, 1.25] };
const hydMean = (r) => { const p = r.hydrationRoll || [0.4, 0.5, 0.1]; return p[1] + 2 * p[2]; };
function schedule(sp, stat, r) {
  const kind = (sp.growth || {})[stat === 'hp' ? 'serotonin' : stat] || 'steady', b = r?.bloom;   // rules.stat.bloom: [early, late] rates before the turn
  return b ? (kind === 'early' ? b : kind === 'late' ? [b[1], b[0]] : SHAPES.steady) : SHAPES[kind] || SHAPES.steady;
}
/** what an Astral of this species gains on average on reaching this level */
export function expectedGain(data, speciesId, stat, level) {
  const sp = data.dex[speciesId], r = data.rules.stat;
  if (stat === 'hyd') return hydMean(r);
  const b = stat === 'hp' ? sp.baseStats.serotonin : sp.baseStats[stat];
  const k = level <= (r.growthFrom ?? 10) ? 1 : schedule(sp, stat, r)[level <= (r.growthTurn ?? 24) ? 0 : 1];   // everyone steady at first
  return ((2 * b) / 100) * (r.growthRate ?? 1) * k + (stat === 'hp' ? 1 : 0);
}
/** the average gain from level `from` to level `to` (negative going down) */
function expectedSum(data, speciesId, stat, from, to) {
  let t = 0;
  for (let L = from + 1; L <= to; L++) t += expectedGain(data, speciesId, stat, L);
  for (let L = to + 1; L <= from; L++) t -= expectedGain(data, speciesId, stat, L);
  return t;
}
/** a level-1 Astral of this species */
function startOf(data, sp) {
  const b = sp.baseStats, r = data.rules.stat, other = (v) => Math.floor((2 * v) / 100) + r.otherBase;
  return { hp: Math.floor((2 * b.serotonin) / 100) + 1 + r.hpBase, hyd: r.hydrationBase, vibeAttack: other(b.vibeAttack), egoDefense: other(b.egoDefense), spFractal: other(b.spFractal), spGrounded: other(b.spGrounded), bpmSpeed: other(b.bpmSpeed) };
}

export function statsOf(data, mon) {
  const sp = data.dex[mon.speciesId], base = startOf(data, sp), g = mon.gains, to = g ? mon.grownTo || 1 : 1;
  // gains rolled as an earlier form (it evolved since): the new form catches up to its own rate, up to where they go
  const as = g && mon.grownAs && mon.grownAs !== mon.speciesId && data.dex[mon.grownAs] ? mon.grownAs : null;
  const catchUp = (stat) => (as ? expectedSum(data, mon.speciesId, stat, 1, to) - expectedSum(data, as, stat, 1, to) : 0);
  const v = (stat) => Math.max(1, Math.floor(base[stat] + (g ? g[stat] || 0 : 0) + catchUp(stat) + expectedSum(data, mon.speciesId, stat, to, mon.level) + 1e-9));
  return { maxHp: v('hp'), maxHyd: v('hyd'), vibeAttack: v('vibeAttack'), egoDefense: v('egoDefense'), spFractal: v('spFractal'), spGrounded: v('spGrounded'), bpmSpeed: v('bpmSpeed') };
}

/** a number in [0, 1) from a few integers (the growth rolls) */
function roll(...xs) { let h = 2166136261; for (const x of xs) { h ^= x >>> 0; h = Math.imul(h, 16777619) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; } h ^= h >>> 13; return (h >>> 0) / 4294967296; }
/** what this Astral gains on reaching this level: Hydration by rules.stat.hydrationRoll, the rest around their rate */
function gainAt(data, salt, mon, stat, level) {
  const i = GROWN.indexOf(stat), r = roll(salt, mon.uid, level, i, 1);
  if (stat === 'hyd') { const p = data.rules.stat.hydrationRoll || [0.4, 0.5, 0.1]; return r < p[0] ? 0 : r < p[0] + p[1] ? 1 : 2; }
  const e = expectedGain(data, mon.speciesId, stat, level), j = roll(salt, mon.uid, level, i, 2);
  let gain = Math.floor(e) + (r < e % 1 ? 1 : 0);
  if (j < 0.15) gain -= 1; else if (j < 0.3) gain += 1;
  return Math.max(0, gain);
}
/** roll this Astral's growth up to its level (an Astral from before 1.2.0 starts from the average at the level it had) */
export function growTo(data, salt, mon, level = mon.level) {
  if (!mon.gains) { mon.gains = {}; for (const st of GROWN) mon.gains[st] = expectedSum(data, mon.speciesId, st, 1, Math.min(level, mon.level)); mon.grownTo = Math.min(level, mon.level); mon.grownAs = mon.speciesId; }
  // it evolved since the last roll: fold the catch-up in, and go on as the new form
  if (mon.grownAs && mon.grownAs !== mon.speciesId && data.dex[mon.grownAs]) for (const st of GROWN) mon.gains[st] += expectedSum(data, mon.speciesId, st, 1, mon.grownTo || 1) - expectedSum(data, mon.grownAs, st, 1, mon.grownTo || 1);
  mon.grownAs = mon.speciesId;
  for (let L = (mon.grownTo || 1) + 1; L <= level; L++) for (const st of GROWN) mon.gains[st] += gainAt(data, salt, mon, st, L);
  if (level > (mon.grownTo || 1)) mon.grownTo = level;
}
const saltOf = (ctx) => ctx.state?.salt ?? 1;
export const xpForLevel = (L) => L * L * L;
export const MAX_LEVEL = 60;

/** The four most recent moves a species knows at a level. */
export function movesAtLevel(species, level) {
  const known = [];
  for (const l of species.learnset) if (l.level <= level && !known.includes(l.moveId)) known.push(l.moveId);
  return known.slice(-4);
}

/** Moves an Astral could remember (the tarot reader, from six wristbands): everything its line learns by its level
 *  (its own learnset and its earlier forms'), less what it knows now. In the order they come. */
export function rememberable(data, mon) {
  const line = [mon.speciesId];
  for (let i = 0; i < line.length; i++) for (const sp of Object.values(data.dex)) if ((sp.evolutions || []).some((e) => e.targetId === line[i]) && !line.includes(sp.id)) line.push(sp.id);
  const out = [];
  for (const id of line) for (const l of data.dex[id].learnset) if (l.level <= mon.level && !mon.moves.includes(l.moveId) && !out.some((o) => o.moveId === l.moveId)) out.push({ moveId: l.moveId, level: l.level });
  return out.sort((a, b) => a.level - b.level).map((o) => o.moveId);
}

export function createMon(ctx, speciesId, level, moves) {
  const sp = ctx.data.dex[speciesId];
  if (!sp) throw new Error(`unknown species ${speciesId}`);
  const mon = { uid: ctx.state.nextUid++, speciesId, level, xp: xpForLevel(level), hp: 0, hyd: 0, moves: moves ? [...moves] : movesAtLevel(sp, level), status: null };
  mon.gains = Object.fromEntries(GROWN.map((st) => [st, 0])); mon.grownTo = 1; mon.grownAs = speciesId;
  growTo(ctx.data, saltOf(ctx), mon, level);                          // its own growth, level by level
  const st = statsOf(ctx.data, mon);
  mon.hp = st.maxHp; mon.hyd = st.maxHyd;
  return mon;
}

export function healMon(data, mon) {
  const st = statsOf(data, mon);
  mon.hp = st.maxHp; mon.hyd = st.maxHyd; mon.status = null;
}

export function nameOf(data, mon) { return mon.nickname || data.dex[mon.speciesId].name; }

export function snapshot(data, mon) {
  const st = statsOf(data, mon);
  return { uid: mon.uid, speciesId: mon.speciesId, name: nameOf(data, mon), level: mon.level, hp: mon.hp, maxHp: st.maxHp, hyd: mon.hyd, maxHyd: st.maxHyd, status: mon.status?.id || null };
}

/**
 * Adds XP, levelling as needed. Emits XP_GAINED / LEVEL_UP / MOVE_LEARNED.
 * Returns moves the creature wants to learn but has no free slot for.
 */
export function gainXp(ctx, mon, amount) {
  const wants = [];
  if (mon.level >= MAX_LEVEL) return wants;
  mon.xp += amount;
  ctx.emit({ type: 'XP_GAINED', uid: mon.uid, name: nameOf(ctx.data, mon), amount });
  while (mon.level < MAX_LEVEL && mon.xp >= xpForLevel(mon.level + 1)) {
    const before = statsOf(ctx.data, mon);
    if (!mon.gains || (mon.grownTo || 1) < mon.level) growTo(ctx.data, saltOf(ctx), mon, mon.level);   // (set straight to a level by a tool)
    mon.level++;
    growTo(ctx.data, saltOf(ctx), mon, mon.level);
    const after = statsOf(ctx.data, mon);
    if (mon.hp > 0) mon.hp += after.maxHp - before.maxHp;
    mon.hyd += after.maxHyd - before.maxHyd;
    ctx.emit({ type: 'LEVEL_UP', uid: mon.uid, name: nameOf(ctx.data, mon), level: mon.level, mon: snapshot(ctx.data, mon) });
    ctx.emit({ type: 'AUDIO_CUE', sfxId: 'levelup' });
    for (const l of ctx.data.dex[mon.speciesId].learnset) {
      if (l.level !== mon.level || mon.moves.includes(l.moveId)) continue;
      if (mon.moves.length < 4) { mon.moves.push(l.moveId); ctx.emit({ type: 'MOVE_LEARNED', uid: mon.uid, name: nameOf(ctx.data, mon), moveId: l.moveId }); }
      else wants.push({ uid: mon.uid, moveId: l.moveId });
    }
  }
  return wants;
}

/** Species this creature should evolve into now (by level, or by the given catalyst item), or null. */
export function evolutionTarget(data, mon, itemId) {
  for (const ev of data.dex[mon.speciesId].evolutions || []) {
    if (itemId) { if (ev.trigger === 'ITEM' && ev.itemId === itemId) return ev.targetId; }
    else if (ev.trigger === 'LEVEL' && mon.level >= ev.level) return ev.targetId;
  }
  return null;
}

export function evolve(ctx, mon, targetId) {
  const from = mon.speciesId, oldName = nameOf(ctx.data, mon);
  const before = statsOf(ctx.data, mon);
  // what it grew so far stays its own; the new form catches up to its own rate (statsOf, growTo: mon.grownAs)
  mon.speciesId = targetId;
  const after = statsOf(ctx.data, mon);
  if (mon.hp > 0) mon.hp += after.maxHp - before.maxHp;
  ctx.state.dex.seen[targetId] = 1; ctx.state.dex.caught[targetId] = 1;
  ctx.emit({ type: 'EVOLVED', uid: mon.uid, from, to: targetId, oldName, newName: ctx.data.dex[targetId].name });   // the view plays the scene and its music
}

/** Adds a creature to the party, or to the stash when the party is full. */
export function addToCollection(ctx, mon) {
  const s = ctx.state;
  s.dex.seen[mon.speciesId] = 1; s.dex.caught[mon.speciesId] = 1;
  if (s.party.length < (ctx.data.rules.partyMax || 6)) { s.party.push(mon); return 'party'; }
  healMon(ctx.data, mon);                                     // Chai Mama looks after the ones that go to her stash
  s.box.push(mon); return 'box';
}
