// Item effects shared by battle and overworld use.
import { statsOf, nameOf, evolutionTarget, evolve } from './mons.js';

/**
 * Applies a RECOVERY / CATALYST / GEAR item to a creature (or to the player for gear).
 * opts.dryRun only checks whether it would do anything. Returns { ok, text }.
 */
export function applyItem(ctx, item, mon, opts = {}) {
  const e = item.effect || {}, s = ctx.state;
  const name = mon ? nameOf(ctx.data, mon) : '';
  const st = mon ? statsOf(ctx.data, mon) : null;
  const done = [];
  const no = (text) => ({ ok: false, text });

  if (e.repel) {
    if (opts.inBattle) return no('That is no use right now.');
    if (!opts.dryRun) s.repel = e.repel;
    return { ok: true, text: `The smoke keeps wild Astrals away for ${e.repel} steps.` };
  }
  if (e.passive) return no(`${item.name} works just by being in your Stash Tin.`);
  if (e.dose) {
    if (opts.inBattle) return no('Not in the middle of a clash.');
    if (s.intox >= 1) return no('There is no higher. There is barely a you.');
    if (!opts.dryRun) s.intox = Math.min(1, s.intox + e.dose);
    return { ok: true, text: `You lick a corner of the ${item.name}. The festival leans in closer.` };
  }
  if (e.evolve) {
    if (opts.inBattle) return no('Not in the middle of a clash.');
    const target = mon && mon.hp > 0 ? evolutionTarget(ctx.data, mon, item.id) : null;
    if (!target) return no(`It has no effect on ${name || 'that'}.`);
    if (!opts.dryRun) { evolve(ctx, mon, target); if (e.intox) s.intox = Math.max(0, Math.min(1, s.intox + e.intox)); }
    return { ok: true, text: `${name} drinks it down... and becomes ${ctx.data.dex[target].name}!` };
  }
  if (!mon) return no('Use it on whom?');

  if (e.revive) {
    if (mon.hp > 0) return no(`${name} is still standing.`);
    if (!opts.dryRun) { mon.hp = Math.max(1, Math.floor(st.maxHp * e.revive)); mon.status = null; }
    return { ok: true, text: `${name} is back with us.` };
  }
  if (mon.hp <= 0) return no(`${name} has faded out. It needs a Weighted Blanket or a Chai Tent.`);
  if (e.heal && mon.hp < st.maxHp) { if (!opts.dryRun) mon.hp = Math.min(st.maxHp, mon.hp + e.heal); done.push('serotonin'); }
  if (e.hydrate && mon.hyd < st.maxHyd) { if (!opts.dryRun) mon.hyd = Math.min(st.maxHyd, mon.hyd + e.hydrate); done.push('hydration'); }
  if (e.cure) {
    const loop = opts.inBattle && s.battle && s.party[s.battle.pi] === mon && s.battle.side.p.loop > 0;
    if (mon.status && (e.cure === 'ANY' || e.cure === mon.status.id)) { if (!opts.dryRun) mon.status = null; done.push('status'); }
    if (loop && e.cure === 'ANY') { if (!opts.dryRun) s.battle.side.p.loop = 0; done.push('status'); }
  }
  if (e.intox < 0 && s.intox > 0) done.push('sober');     // a sip for yourself always helps
  if (!done.length) return no(`It would do nothing for ${name}.`);
  if (e.intox && !opts.dryRun) {
    if (s.battle) s.battle.intox = Math.max(0, Math.min(1, s.battle.intox + e.intox));
    s.intox = Math.max(0, Math.min(1, s.intox + e.intox));
  }
  if (done.length === 1 && done[0] === 'sober') return { ok: true, text: 'You take a long drink yourself. The edges come back.' };
  const what = done.includes('status') && done.length === 1 ? 'is feeling normal again' : done.includes('serotonin') ? 'perks up' : 'rehydrates';
  return { ok: true, text: `${name} ${what}.${done.includes('sober') ? ' You have a sip too.' : ''}` };
}
