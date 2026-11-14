// Item effects shared by battle and overworld use.
import { tl, tln } from './i18n.js';
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
    if (opts.inBattle) return no(tl('That is no use right now.'));
    if (!opts.dryRun) s.repel = e.repel;
    return { ok: true, text: tln(e.repel, 'The smoke keeps wild Astrals away for 1 step.', 'The smoke keeps wild Astrals away for {0} steps.') };
  }
  if (e.passive) return no(tl('{0} works just by being in your Stash Tin.', item.name));
  if (e.dose) {
    if (opts.inBattle) return no(tl('Not in the middle of a clash.'));
    if (s.intox >= 1) return no(tl('There is no higher. There is barely a you.'));
    if (!opts.dryRun) s.intox = Math.min(1, s.intox + e.dose);
    return { ok: true, trip: true, text: tl('You lick a corner of the {0}. The festival leans in closer.', item.name) };
  }
  if (e.evolve) {
    if (opts.inBattle) return no(tl('Not in the middle of a clash.'));
    const target = mon && mon.hp > 0 ? evolutionTarget(ctx.data, mon, item.id) : null;
    if (!target) return no(tl('It has no effect on {0}.', name || tl('that')));
    if (!opts.dryRun) { evolve(ctx, mon, target); if (e.intox) s.intox = Math.max(0, Math.min(1, s.intox + e.intox)); }
    return { ok: true, text: tl('{0} drinks it down... and becomes {1}!', name, ctx.data.dex[target].name) };
  }
  if (!mon) return no(tl('Use it on whom?'));

  if (e.revive) {
    if (mon.hp > 0) return no(tl('{0} is still standing.', name));
    if (!opts.dryRun) { mon.hp = Math.max(1, Math.floor(st.maxHp * e.revive)); mon.status = null; }
    return { ok: true, text: tl('{0} is back with us.', name) };
  }
  if (mon.hp <= 0) return no(tl('{0} has faded out. It needs a Weighted Blanket or a Chai Tent.', name));
  if (e.heal && mon.hp < st.maxHp) { if (!opts.dryRun) mon.hp = Math.min(st.maxHp, mon.hp + e.heal); done.push('serotonin'); }
  if (e.hydrate && mon.hyd < st.maxHyd) { if (!opts.dryRun) mon.hyd = Math.min(st.maxHyd, mon.hyd + e.hydrate); done.push('hydration'); }
  if (e.cure) {
    const loop = opts.inBattle && s.battle && s.party[s.battle.pi] === mon && s.battle.side.p.loop > 0;
    if (mon.status && (e.cure === 'ANY' || e.cure === mon.status.id)) { if (!opts.dryRun) mon.status = null; done.push('status'); }
    if (loop && e.cure === 'ANY') { if (!opts.dryRun) s.battle.side.p.loop = 0; done.push('status'); }
  }
  if (e.intox < 0 && s.intox > 0) done.push('sober');     // a sip for yourself always helps
  if (!done.length) return no(tl('It would do nothing for {0}.', name));
  if (e.intox && !opts.dryRun) {
    if (s.battle) s.battle.intox = Math.max(0, Math.min(1, s.battle.intox + e.intox));
    s.intox = Math.max(0, Math.min(1, s.intox + e.intox));
  }
  if (done.length === 1 && done[0] === 'sober') return { ok: true, text: tl('You take a long drink yourself. The edges come back.') };
  const text = done.includes('status') && done.length === 1 ? tl('{0} is feeling normal again.', name) : done.includes('serotonin') ? tl('{0} perks up.', name) : tl('{0} rehydrates.', name);
  return { ok: true, text: text + (done.includes('sober') ? ' ' + tl('You have a sip too.') : '') };
}

/** clothes and things to hold are one of a kind: while you own one (in the bag, or held by any of your Astrals) the shop
 *  has none left. Sell it back, or lose it on a whiteout, and it is in stock again. */
export const ONE_OF_A_KIND = ['OUTFIT', 'HELD'];
export const soldOut = (state, item) => ONE_OF_A_KIND.includes(item?.category)
  && (state.bag[item.id] > 0 || [...state.party, ...state.box].some((m) => m.held === item.id));
