// The Chill-Out Dome (1.7.0, Arambol Sweetwater Lake): leave an Astral on a cushion and it gains Vibes as you walk.
//   state.dome: [{ mon, vibes, from }]   vibes: gathered since it was left; from: the level it came in at
//   rules.dome: { slots, perStep, perLevels, feePerLevel }
// Each step of yours is perStep Vibes, plus one more for every perLevels levels the Astral has. It never passes the level of
// the strongest Astral walking with you, it learns nothing and does not evolve while it is there: the levels land when you
// pick it up (collect), for feePerLevel Rupees each. A move it has no room for comes back as "wants" (the keeper asks).
import { xpForLevel, MAX_LEVEL, gainXp, healMon, addToCollection } from './mons.js';

export const domeRules = (data) => ({ slots: 2, perStep: 1, perLevels: 8, feePerLevel: 60, ...(data.rules.dome || {}) });

const levelFor = (xp) => { let L = 1; while (L < MAX_LEVEL && xp >= xpForLevel(L + 1)) L++; return L; };

/** one step of yours: everyone in the Dome gains a little, up to the level of your strongest */
export function domeTick(ctx) {
  const s = ctx.state;
  if (!s.dome?.length) return;
  const R = domeRules(ctx.data), cap = xpForLevel(Math.min(MAX_LEVEL, Math.max(1, ...s.party.map((m) => m.level))));
  for (const e of s.dome) {
    const room = cap - (e.mon.xp + e.vibes);
    if (room > 0) e.vibes += Math.min(room, R.perStep + Math.floor(levelFor(e.mon.xp + e.vibes) / R.perLevels));
  }
}

/** what picking this one up would come to: the level it has reached, how many levels that is, and the fee */
export function domeBill(data, entry) {
  const level = Math.max(entry.mon.level, levelFor(entry.mon.xp + entry.vibes)), levels = level - entry.mon.level;
  return { level, levels, fee: levels * domeRules(data).feePerLevel };
}

/** why this party member cannot be left, or null: 'full' (no cushion free), 'alone' (nobody else could fight) */
export function domeRefusal(ctx, partyIndex) {
  const s = ctx.state;
  if ((s.dome || []).length >= domeRules(ctx.data).slots) return 'full';
  if (!s.party.some((m, i) => i !== partyIndex && m.hp > 0)) return 'alone';
  return null;
}

export function domeLeave(ctx, partyIndex) {
  const s = ctx.state;
  if (!s.party[partyIndex] || domeRefusal(ctx, partyIndex)) return null;
  const [mon] = s.party.splice(partyIndex, 1);
  healMon(ctx.data, mon);                                             // a cushion and a cup of something
  (s.dome = s.dome || []).push({ mon, vibes: 0, from: mon.level });
  return mon;
}

/** pick one up: pay, take the levels, back to the party (or the stash). Returns null if you cannot pay. */
export function domeCollect(ctx, index) {
  const s = ctx.state, entry = s.dome?.[index];
  if (!entry) return null;
  const bill = domeBill(ctx.data, entry);
  if (s.rupees < bill.fee) return null;
  s.rupees -= bill.fee;
  if (bill.fee) ctx.emit({ type: 'RUPEES_CHANGED', rupees: s.rupees });
  s.dome.splice(index, 1);
  const mon = entry.mon;
  const wants = entry.vibes > 0 ? gainXp({ ...ctx, emit() {} }, mon, entry.vibes) : [];   // quietly: no battle screen to show it on
  healMon(ctx.data, mon);
  const where = addToCollection(ctx, mon);
  return { mon, where, wants: wants.map((w) => w.moveId), ...bill };
}
