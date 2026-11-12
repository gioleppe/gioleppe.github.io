// Opponent move selection. Wild creatures pick at random; trainers weigh expected damage.
import { estimateDamage, usableMoves } from './BattleEngine.js';

export function selectAction(ctx, battle) {
  const me = battle.enemy[battle.ei];
  const moves = usableMoves(ctx, me);
  if (!moves.length) return { action: 'FIGHT', moveId: 'dry_heave' };
  const trainer = battle.trainerId ? ctx.data.trainers[battle.trainerId] : null;
  const smart = trainer ? (trainer.boss ? 0.95 : 0.7) : 0.15;
  if (!ctx.rng.chance(smart)) return { action: 'FIGHT', moveId: ctx.rng.pick(moves) };

  const foe = ctx.state.party[battle.pi];
  let best = moves[0], bestScore = -1;
  for (const id of moves) {
    const m = ctx.data.moves[id];
    let score;
    if (m.power > 0) {
      score = estimateDamage(ctx, battle, 'e', id) * ((m.accuracy || 100) / 100);
      if (score >= foe.hp) score += 1000 + m.priority * 100;      // take the knockout
    } else {
      score = 12;
      for (const e of m.effects || []) {
        if (e.effectType === 'APPLY_STATUS') score = (e.status === 'THOUGHT_LOOP' ? battle.side.p.loop > 0 : !!foe.status) ? 0 : 30;
        if (e.effectType === 'HEAL') score = me.hp < 0.45 * battle.side.e.maxHp ? 45 : 0;
        if (e.effectType === 'STAT_STAGE') {
          const side = e.target === 'self' ? battle.side.e : battle.side.p;
          if (Math.abs(side.stages[e.stat] || 0) >= 2) score = 2;
        }
        if (e.effectType === 'HYDRATE') score = me.hyd < 10 ? 40 : 0;
      }
    }
    score *= 0.85 + ctx.rng.next() * 0.3;
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return { action: 'FIGHT', moveId: best };
}
