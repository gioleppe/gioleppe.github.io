// What things mean, in words: a move's numbers and effects, the stats, the types. Read on an Astral's summary
// (point at anything and press A). Numbers come from the data and the battle rules, so they stay true when those change.
import { moveCost } from '../core/BattleEngine.js';
import { drawText, wrap, typeTag, textWidth, C } from './ui.js';
import { tl, tln } from '../core/i18n.js';

const pct = (r) => `${Math.round(r * 100)}%`;
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const FRACTION = { 0.5: 'half', 0.25: 'a quarter', 0.125: 'an eighth', 0.3: 'nearly a third' };
// the fractions and the other module-level English below are translated where they are shown (the dictionary loads after import)
const part = (r) => (FRACTION[r] ? tl(FRACTION[r]) : tl('{0}%', Math.round(r * 100)));
export const typeName = (t) => { const u = tl(t); return u.charAt(0) + u.slice(1).toLowerCase(); };
/** "Downer", "Downer and Bummer", "Psychedelic, Stimulant and Organic" */
const names = (ts) => { const n = ts.map(typeName); return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')}${tl(' and ')}${n[n.length - 1]}`; };

export const STAT = {
  get vibeAttack() { return tl('Vibe Attack'); }, get egoDefense() { return tl('Ego Defense'); }, get spFractal() { return tl('Fractal'); },
  get spGrounded() { return tl('Groundedness'); }, get bpmSpeed() { return tl('BPM'); },
};

/** the stats and the other words on the summary */
export const TERMS = {
  serotonin: { get title() { return tl('Serotonin'); }, get text() { return tl('Its health. Hits drain it, and at 0 it fades out and cannot fight until it is healed. Rest at a Chai Tent or use a recovery item.'); } },
  hydration: { get title() { return tl('Hydration'); }, get text() { return tl('Water for its moves: each move costs some (point at a move to see how much). A move it cannot afford comes out as Dry Heave, a weak hit that hurts it too. Drinks and a rest at a Chai Tent fill it up. Each peak adds a little more, by luck: nothing, 1 or 2.'); } },
  vibes: { get title() { return tl('Vibes and peaks'); }, get text() { return tl('Vibes are experience. Every Astral that fought in a won battle gets some. With enough it peaks: the next level, with higher stats, and now and then a new move.'); } },
  vibeAttack: { get title() { return tl('Vibe Attack'); }, get text() { return tl('How hard its Physical moves hit. Weighed against the foe\'s Ego Defense.'); } },
  egoDefense: { get title() { return tl('Ego Defense'); }, get text() { return tl('How well it takes Physical moves. Weighed against the attacker\'s Vibe Attack.'); } },
  spFractal: { get title() { return tl('Fractal'); }, get text() { return tl('How hard its Astral moves hit. Weighed against the foe\'s Groundedness.'); } },
  spGrounded: { get title() { return tl('Groundedness'); }, get text() { return tl('How well it takes Astral moves. Weighed against the attacker\'s Fractal.'); } },
  bpmSpeed: { get title() { return tl('BPM'); }, get text() { return tl('Its speed. The faster Astral moves first each turn (a move that goes first beats any BPM). A higher BPM than the wild Astral also makes it easier to run.'); } },
  held: { get title() { return tl('Held item'); }, get text() { return tl('An item it carries into battle. It works by itself, every battle. Give it one from the Stash Tin, or through Hold on this Astral.'); } },
};

/** a status: its name, and what it does to whoever has it (rules.battle for the numbers) */
export function statusText(data, id) {
  const R = data.rules.battle;
  return {
    COTTONMOUTH: [tl('Cottonmouth'), tl('its Physical moves hit half as hard, and it loses {0} Hydration a turn', R.cottonmouthDrain)],
    EGO_DEATH: [tl('an Ego death'), tl('it does nothing for {0} turns, then comes back with Groundedness up 2 stages', R.egoDeathTurns)],
    THOUGHT_LOOP: [tl('a Thought loop'), tl('for {0} to {1} turns, about a third of the time it repeats its last move or hits itself', R.thoughtLoopTurns[0], R.thoughtLoopTurns[1])],
    JAW_LOCK: [tl('Jaw lock'), tl('it loses Serotonin at the end of every turn, a little more each time, until it is cured')],
    K_HOLED: [tl('a K-hole'), tl('for {0} to {1} turns its BPM drops to a quarter, and half the time it cannot move', R.kHoleTurns[0], R.kHoleTurns[1])],
  }[id] || [id, tl('something happens')];
}

/** what a type hits hard and what hits it hard (the type chart) */
export function matchups(data, type) {
  const chart = data.typeChart.chart, row = chart[type] || {};
  const by = (k) => Object.keys(row).filter((t) => row[t] === k);
  const hurtBy = Object.keys(chart).filter((a) => chart[a][type] === 2), shrugs = Object.keys(chart).filter((a) => chart[a][type] === 0.5);
  return { strong: by(2), weak: by(0.5), hurtBy, shrugs };
}

export function typeFacts(data, type) {
  if (type === 'NORMAL') return { title: typeName(type), text: tl('No type: Normal moves hit everyone the same.') };
  const m = matchups(data, type), T = typeName(type);
  return {
    title: T,
    text: tl('{0} moves hit {1} Astrals twice as hard, and {2} ones half as hard. ', T, names(m.strong), names(m.weak))
      + (/^[AEIOU]/.test(T)
        ? tl('An {0} Astral is hit twice as hard by {1} moves, and half as hard by {2} ones. ', T, names(m.hurtBy), names(m.shrugs))
        : tl('A {0} Astral is hit twice as hard by {1} moves, and half as hard by {2} ones. ', T, names(m.hurtBy), names(m.shrugs)))
      + tl('Its own {0} moves get a 1.5x same-type bonus.', T),
  };
}

/** one effect of a move, in words */
function effectText(data, e) {
  const sure = !(e.chance < 1), pc = pct(e.chance);
  switch (e.effectType) {
    case 'HEAL': return sure ? tl('heals {0} of its own Serotonin.', part(e.ratio)) : tl('{0} chance to heal {1} of its own Serotonin.', pc, part(e.ratio));
    case 'HYDRATE': return sure ? tl('drinks: {0} Hydration back.', e.amount) : tl('{0} chance to drink: {1} Hydration back.', pc, e.amount);
    case 'RECOIL': return tl('it takes {0} of the damage it deals back itself.', part(e.ratio));
    case 'DRAIN_SEROTONIN': return tl('it heals by {0} of the damage it deals.', part(e.drainRatio));
    case 'MULTI_HIT': return tl('hits {0} to {1} times in a row (the power is for each hit).', e.min, e.max);
    case 'TRAP': return tl('glues the foe to the couch for {0} turns: it cannot switch out or run, and this Astral heals {1} of its Serotonin each turn.', e.turns, part(e.healRatio));
    case 'INVERT_TYPE_CHART': return tl('turns strengths and weaknesses inside out for {0} turns, for both sides: twice as hard becomes half as hard, and half becomes twice.', e.durationTurns);
    case 'SPIKE_INTOXICATION': return tl('sends you higher: +{0} on your trip meter, whoever uses it. The higher the trip, the more critical hits.', Math.round(e.delta * 100));
    case 'APPLY_STATUS': { const [n, what] = statusText(data, e.status); return sure ? tl('gives the foe {0}: {1}.', n, what) : tl('{0} chance to give the foe {1}: {2}.', pc, n, what); }
    case 'STAT_STAGE': {
      const n = Math.abs(e.stages), up = e.stages > 0, own = e.target === 'self', st = STAT[e.stat] || e.stat, by = tln(n, '{0} stage', '{0} stages');
      if (sure) return up ? (own ? tl('raises its own {0} {1}.', st, by) : tl('raises the foe\'s {0} {1}.', st, by)) : (own ? tl('lowers its own {0} {1}.', st, by) : tl('lowers the foe\'s {0} {1}.', st, by));
      return up ? (own ? tl('{0} chance to raise its own {1} {2}.', pc, st, by) : tl('{0} chance to raise the foe\'s {1} {2}.', pc, st, by)) : (own ? tl('{0} chance to lower its own {1} {2}.', pc, st, by) : tl('{0} chance to lower the foe\'s {1} {2}.', pc, st, by));
    }
    default: return '';
  }
}

/** a move: its numbers (one short line) and what it does (a paragraph); with mon, its water as this Astral pays it */
export function moveFacts(data, mv, mon = null) {
  const cost = mon ? moveCost({ data }, mon, mv) : mv.hydrationCost;
  const numbers = [];
  if (mv.power > 0) numbers.push(tl('Power {0}', mv.power));
  numbers.push(mv.accuracy > 0 ? tl('Accuracy {0}%', mv.accuracy) : tl('Never misses'));
  numbers.push(tl('Water {0}', cost));
  const parts = [];
  parts.push(mv.category === 'PHYSICAL' ? tl('Physical: its Vibe Attack against the foe\'s Ego Defense.')
    : mv.category === 'ASTRAL' ? tl('Astral: its Fractal against the foe\'s Groundedness.') : tl('Status: does no damage.'));
  if (mv.priority > 0) parts.push(tl('Goes first, whatever the BPM.'));
  for (const e of mv.effects || []) { const t = effectText(data, e); if (t) parts.push(cap(t)); }
  if ((mv.effects || []).some((e) => e.effectType === 'STAT_STAGE')) parts.push(tl('(A stage up is half as much again, a stage down a third off, until it switches out.)'));
  if (mv.power > 0 && mv.type !== 'NORMAL') {
    const m = matchups(data, mv.type);
    parts.push(tl('Twice as hard on {0}, half as hard on {1}.', names(m.strong), names(m.weak)));
    if (mon && data.dex[mon.speciesId].types.includes(mv.type)) parts.push(tl('Same type as this Astral: 1.5x.'));
  }
  if (cost < mv.hydrationCost) parts.push(tl('(It pays {0} less water than usual.)', mv.hydrationCost - cost));
  return { title: mv.name, type: mv.type, numbers, text: parts.join(' ') };
}

/** draw a note (a move's, or a term's) at x, y in w px: the title with its type tag on the right, the numbers, then the
 *  words, cut at maxH. Returns the height used. */
export function drawNote(g, n, x, y, w, maxH = 999, opts = {}) {
  drawText(g, n.title, x, y, { color: opts.titleColor || C.purple });
  if (n.type) typeTag(g, n.type, x + w - textWidth(tl(n.type).slice(0, 5)) - 6, y - 1);
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
  if (kind === 'early') return tl(' {0} grows this one early: faster from level {1} to {2}, slower after.', sp.name, from, turn);
  if (kind === 'late') return tl(' {0} grows this one late: slower from level {1} to {2}, faster after.', sp.name, from, turn);
  return tl(' {0} grows this one at a steady pace. Each peak adds a little, by luck.', sp.name);
}
