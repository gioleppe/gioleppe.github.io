// What things mean, in words: a move's numbers and effects, the stats, the types. Read on an Astral's summary
// (point at anything and press A). Numbers come from the data and the battle rules, so they stay true when those change.
import { moveCost } from '../core/BattleEngine.js';
import { drawText, wrap, typeTag, textWidth, C } from './ui.js';

const pct = (r) => `${Math.round(r * 100)}%`;
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const FRACTION = { 0.5: 'half', 0.25: 'a quarter', 0.125: 'an eighth', 0.3: 'nearly a third' };
const part = (r) => FRACTION[r] || pct(r);
export const typeName = (t) => t.charAt(0) + t.slice(1).toLowerCase();
/** "Downer", "Downer and Bummer", "Psychedelic, Stimulant and Organic" */
const names = (ts) => { const n = ts.map(typeName); return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`; };
const an = (w) => (/^[AEIOU]/.test(w) ? `an ${w}` : `a ${w}`);

export const STAT = {
  vibeAttack: 'Vibe Attack', egoDefense: 'Ego Defense', spFractal: 'Fractal', spGrounded: 'Groundedness', bpmSpeed: 'BPM',
};

/** the stats and the other words on the summary */
export const TERMS = {
  serotonin: { title: 'Serotonin', text: 'Its health. Hits drain it, and at 0 it fades out and cannot fight until it is healed. Rest at a Chai Tent or use a recovery item.' },
  hydration: { title: 'Hydration', text: 'Water for its moves: each move costs some (point at a move to see how much). A move it cannot afford comes out as Dry Heave, a weak hit that hurts it too. Drinks and a rest at a Chai Tent fill it up. Each peak adds a little more, by luck: nothing, 1 or 2.' },
  vibes: { title: 'Vibes and peaks', text: 'Vibes are experience. Every Astral that fought in a won battle gets some. With enough it peaks: the next level, with higher stats, and now and then a new move.' },
  vibeAttack: { title: 'Vibe Attack', text: 'How hard its Physical moves hit. Weighed against the foe\'s Ego Defense.' },
  egoDefense: { title: 'Ego Defense', text: 'How well it takes Physical moves. Weighed against the attacker\'s Vibe Attack.' },
  spFractal: { title: 'Fractal', text: 'How hard its Astral moves hit. Weighed against the foe\'s Groundedness.' },
  spGrounded: { title: 'Groundedness', text: 'How well it takes Astral moves. Weighed against the attacker\'s Fractal.' },
  bpmSpeed: { title: 'BPM', text: 'Its speed. The faster Astral moves first each turn (a move that goes first beats any BPM). A higher BPM than the wild Astral also makes it easier to run.' },
  held: { title: 'Held item', text: 'An item it carries into battle. It works by itself, every battle. Give it one from the Stash Tin, or through Hold on this Astral.' },
};

/** a status: its name, and what it does to whoever has it (rules.battle for the numbers) */
export function statusText(data, id) {
  const R = data.rules.battle;
  return {
    COTTONMOUTH: ['Cottonmouth', `its Physical moves hit half as hard, and it loses ${R.cottonmouthDrain} Hydration a turn`],
    EGO_DEATH: ['an Ego death', `it does nothing for ${R.egoDeathTurns} turns, then comes back with Groundedness up 2 stages`],
    THOUGHT_LOOP: ['a Thought loop', `for ${R.thoughtLoopTurns[0]} to ${R.thoughtLoopTurns[1]} turns, about a third of the time it repeats its last move or hits itself`],
    JAW_LOCK: ['Jaw lock', 'it loses Serotonin at the end of every turn, a little more each time, until it is cured'],
    K_HOLED: ['a K-hole', `for ${R.kHoleTurns[0]} to ${R.kHoleTurns[1]} turns its BPM drops to a quarter, and half the time it cannot move`],
  }[id] || [id, 'something happens'];
}

/** what a type hits hard and what hits it hard (the type chart) */
export function matchups(data, type) {
  const chart = data.typeChart.chart, row = chart[type] || {};
  const by = (k) => Object.keys(row).filter((t) => row[t] === k);
  const hurtBy = Object.keys(chart).filter((a) => chart[a][type] === 2), shrugs = Object.keys(chart).filter((a) => chart[a][type] === 0.5);
  return { strong: by(2), weak: by(0.5), hurtBy, shrugs };
}

export function typeFacts(data, type) {
  if (type === 'NORMAL') return { title: 'Normal', text: 'No type: Normal moves hit everyone the same.' };
  const m = matchups(data, type), T = typeName(type);
  return {
    title: T,
    text: `${T} moves hit ${names(m.strong)} Astrals twice as hard, and ${names(m.weak)} ones half as hard. `
      + `${cap(an(T))} Astral is hit twice as hard by ${names(m.hurtBy)} moves, and half as hard by ${names(m.shrugs)} ones. `
      + `Its own ${T} moves get a 1.5x same-type bonus.`,
  };
}

/** one effect of a move, in words */
function effectText(data, e) {
  const sure = !(e.chance < 1), odds = `${pct(e.chance)} chance to`;
  switch (e.effectType) {
    case 'HEAL': return `${sure ? 'heals' : `${odds} heal`} ${part(e.ratio)} of its own Serotonin.`;
    case 'HYDRATE': return `${sure ? 'drinks' : `${odds} drink`}: ${e.amount} Hydration back.`;
    case 'RECOIL': return `it takes ${part(e.ratio)} of the damage it deals back itself.`;
    case 'DRAIN_SEROTONIN': return `it heals by ${part(e.drainRatio)} of the damage it deals.`;
    case 'MULTI_HIT': return `hits ${e.min} to ${e.max} times in a row (the power is for each hit).`;
    case 'TRAP': return `glues the foe to the couch for ${e.turns} turns: it cannot switch out or run, and this Astral heals ${part(e.healRatio)} of its Serotonin each turn.`;
    case 'INVERT_TYPE_CHART': return `turns strengths and weaknesses inside out for ${e.durationTurns} turns, for both sides: twice as hard becomes half as hard, and half becomes twice.`;
    case 'SPIKE_INTOXICATION': return `sends you higher: +${Math.round(e.delta * 100)} on your trip meter, whoever uses it. The higher the trip, the more critical hits.`;
    case 'APPLY_STATUS': { const [n, what] = statusText(data, e.status); return `${sure ? 'gives' : `${odds} give`} the foe ${n}: ${what}.`; }
    case 'STAT_STAGE': {
      const n = Math.abs(e.stages), verb = e.stages > 0 ? 'raise' : 'lower';
      const what = `${e.target === 'self' ? 'its own' : 'the foe\'s'} ${STAT[e.stat] || e.stat} ${n} stage${n > 1 ? 's' : ''}`;
      return sure ? `${verb}s ${what}.` : `${odds} ${verb} ${what}.`;
    }
    default: return '';
  }
}

/** a move: its numbers (one short line) and what it does (a paragraph); with mon, its water as this Astral pays it */
export function moveFacts(data, mv, mon = null) {
  const cost = mon ? moveCost({ data }, mon, mv) : mv.hydrationCost;
  const numbers = [];
  if (mv.power > 0) numbers.push(`Power ${mv.power}`);
  numbers.push(mv.accuracy > 0 ? `Accuracy ${mv.accuracy}%` : 'Never misses');
  numbers.push(`Water ${cost}`);
  const parts = [];
  parts.push(mv.category === 'PHYSICAL' ? 'Physical: its Vibe Attack against the foe\'s Ego Defense.'
    : mv.category === 'ASTRAL' ? 'Astral: its Fractal against the foe\'s Groundedness.' : 'Status: does no damage.');
  if (mv.priority > 0) parts.push('Goes first, whatever the BPM.');
  for (const e of mv.effects || []) { const t = effectText(data, e); if (t) parts.push(cap(t)); }
  if ((mv.effects || []).some((e) => e.effectType === 'STAT_STAGE')) parts.push('(A stage up is half as much again, a stage down a third off, until it switches out.)');
  if (mv.power > 0 && mv.type !== 'NORMAL') {
    const m = matchups(data, mv.type);
    parts.push(`Twice as hard on ${names(m.strong)}, half as hard on ${names(m.weak)}.`);
    if (mon && data.dex[mon.speciesId].types.includes(mv.type)) parts.push('Same type as this Astral: 1.5x.');
  }
  if (cost < mv.hydrationCost) parts.push(`(It pays ${mv.hydrationCost - cost} less water than usual.)`);
  return { title: mv.name, type: mv.type, numbers, text: parts.join(' ') };
}

/** draw a note (a move's, or a term's) at x, y in w px: the title with its type tag on the right, the numbers, then the
 *  words, cut at maxH. Returns the height used. */
export function drawNote(g, n, x, y, w, maxH = 999, opts = {}) {
  drawText(g, n.title, x, y, { color: opts.titleColor || C.purple });
  if (n.type) typeTag(g, n.type, x + w - textWidth(n.type.slice(0, 5)) - 6, y - 1);
  let yy = y + 12;
  if (n.numbers) {                                             // one line, or as many as a narrow page needs (whole items only)
    const rows = [];
    for (const part of n.numbers) { const last = rows[rows.length - 1]; if (last && textWidth(`${last}  ${part}`) <= w) rows[rows.length - 1] = `${last}  ${part}`; else rows.push(part); }
    rows.forEach((r) => { drawText(g, r, x, yy, { color: C.ink }); yy += 10; });
    yy += 2;
  }
  const lines = wrap(n.text, w), room = Math.max(0, Math.floor((y + maxH - yy) / 9));
  lines.slice(0, room).forEach((ln, k) => drawText(g, ln, x, yy + k * 9, { color: C.chai }));
  return yy - y + Math.min(lines.length, room) * 9;
}

/** how an Astral grows a stat (its species' schedule, dex growth), in words for its note */
export function growthWords(data, speciesId, stat, rules = data.rules.stat) {
  const sp = data.dex[speciesId], kind = (sp.growth || {})[stat] || 'steady', turn = rules.growthTurn ?? 24, from = rules.growthFrom ?? 10;
  if (kind === 'early') return ` ${sp.name} grows this one early: faster from level ${from} to ${turn}, slower after.`;
  if (kind === 'late') return ` ${sp.name} grows this one late: slower from level ${from} to ${turn}, faster after.`;
  return ` ${sp.name} grows this one at a steady pace. Each peak adds a little, by luck.`;
}
