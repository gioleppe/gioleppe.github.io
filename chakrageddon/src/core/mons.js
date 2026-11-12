// Creature instances: stats, levels, moves, evolution. Pure functions over data and state.

export const STAT_KEYS = ['vibeAttack', 'egoDefense', 'spFractal', 'spGrounded', 'bpmSpeed'];

export function statsOf(data, mon) {
  const sp = data.dex[mon.speciesId], b = sp.baseStats, L = mon.level, r = data.rules.stat;
  const other = (v) => Math.floor((2 * v * L) / 100) + r.otherBase;
  return {
    maxHp: Math.floor((2 * b.serotonin * L) / 100) + L + r.hpBase,
    maxHyd: r.hydrationBase + r.hydrationPerLevel * L,
    vibeAttack: other(b.vibeAttack), egoDefense: other(b.egoDefense),
    spFractal: other(b.spFractal), spGrounded: other(b.spGrounded), bpmSpeed: other(b.bpmSpeed),
  };
}
export const xpForLevel = (L) => L * L * L;
export const MAX_LEVEL = 60;

/** The four most recent moves a species knows at a level. */
export function movesAtLevel(species, level) {
  const known = [];
  for (const l of species.learnset) if (l.level <= level && !known.includes(l.moveId)) known.push(l.moveId);
  return known.slice(-4);
}

export function createMon(ctx, speciesId, level, moves) {
  const sp = ctx.data.dex[speciesId];
  if (!sp) throw new Error(`unknown species ${speciesId}`);
  const mon = { uid: ctx.state.nextUid++, speciesId, level, xp: xpForLevel(level), hp: 0, hyd: 0, moves: moves ? [...moves] : movesAtLevel(sp, level), status: null };
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
    mon.level++;
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
  mon.speciesId = targetId;
  const after = statsOf(ctx.data, mon);
  if (mon.hp > 0) mon.hp += after.maxHp - before.maxHp;
  ctx.state.dex.seen[targetId] = 1; ctx.state.dex.caught[targetId] = 1;
  ctx.emit({ type: 'EVOLVED', uid: mon.uid, from, to: targetId, oldName, newName: ctx.data.dex[targetId].name });
  ctx.emit({ type: 'AUDIO_CUE', sfxId: 'evolve' });
}

/** Adds a creature to the party, or to the stash when the party is full. */
export function addToCollection(ctx, mon) {
  const s = ctx.state;
  s.dex.seen[mon.speciesId] = 1; s.dex.caught[mon.speciesId] = 1;
  if (s.party.length < (ctx.data.rules.partyMax || 6)) { s.party.push(mon); return 'party'; }
  s.box.push(mon); return 'box';
}
