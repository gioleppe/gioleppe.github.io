// The Journal's escape objectives (spec §6.4 "escape objectives", step 4.6): derived from the game state every
// time they are asked for, never stored, so they can never disagree with the world and a save needs nothing new.
// No quest markers: these are the player's own notes, and a step the player has not learned of shows as "?".
//
//   objectives(sim) -> { plans: [Plan, Plan], hints: [{ id, title, text }] }
//   Plan  = { id: 'boat'|'signal', title, known, steps: [Step] }
//   Step  = { id, text, known, done, count?: { have, need } }   unknown steps carry text '?'
//
// Facts read: story flags (plan_boat, plan_signal, dinghy_inspected, dinghy_repaired, hatch_inspected, hatch_open,
// signal_point_seen, got_flare_gun), journal ids (marek_crowbar, marek_warnings, found_*), the inventory, the
// landmarks discovered, the flare counters (Flares in storyItems.js) and the hints: unlocked `objective` lore.

/** what the dinghy repair needs, in order (the patched_dinghy recipe; kept here so the plan reads without it) */
const BOAT_PARTS = Object.freeze([
  { item: 'waterproof_tarp', text: 'A tarp to cover the split' },
  { item: 'paracord', text: 'Cord to lash it' },
  { item: 'driftwood', text: 'Driftwood to hold its shape' },
]);

const has = (sim, id, n = 1) => !!sim.inventory?.has?.(id, n);
const count = (sim, id) => sim.inventory?.count?.(id) ?? 0;

/**
 * A step: shown as '?' until known.
 * @returns {{ id: string, text: string, known: boolean, done: boolean, count?: { have: number, need: number } }}
 */
function step(id, known, done, text, extra = null) {
  const s = { id, text: known ? text : '?', known: !!known, done: !!(known && done) };
  if (extra && known) s.count = extra;
  return s;
}

/**
 * The flares the player could fire now: the gun's loaded round plus the Cartographer's pouch, while carried.
 * @param {import('./Sim.js').Sim} sim
 */
export function flaresCarried(sim) {
  if (!has(sim, 'flare_gun')) return 0;
  const c = sim.story.counters;
  return (c.flare_gun_rounds ?? 0) + (has(sim, 'flare_casings') ? c.flare_pouch_rounds ?? 0 : 0);
}

/**
 * The two escape plans and the hints learned so far.
 * @param {import('./Sim.js').Sim} sim
 */
export function objectives(sim) {
  const st = sim.story;
  const f = (n) => st.flags.has(n);
  const j = (id) => st.journal.includes(id);
  const seen = (id) => !!sim.fog?.discovered.has(id);

  // ---- the boat (Win A, spec §8) ----
  const repaired = f('dinghy_repaired');
  const looked = f('dinghy_inspected') || st.recipes.has('patched_dinghy');
  const boatSteps = [step('dinghy', looked || repaired, repaired, 'Patch the dinghy at the crash site')];
  for (const p of BOAT_PARTS) {
    const have = count(sim, p.item);
    boatSteps.push(step(p.item, looked || repaired || have > 0, repaired || have >= 1, p.text, repaired ? null : { have: Math.min(have, 1), need: 1 }));
  }
  boatSteps.push(step('launch', repaired || j('hint_high_water'), false, 'Launch on the high water, over the outer reef'));

  // ---- the signal (Win B, spec §8) ----
  const open = f('hatch_open');
  const toldBar = j('marek_crowbar') || j('sailor_flask') || j('sailor_log');
  const hatchKnown = f('hatch_inspected') || toldBar || open;
  const flares = flaresCarried(sim);
  const peakKnown = seen('signal_peak') || f('signal_point_seen') || j('cartographer_map');
  const signalSteps = [
    step('hatch', hatchKnown, open, "Open the wreck's cabin hatch"),
    step('crowbar', hatchKnown || has(sim, 'crowbar'), open || has(sim, 'crowbar'), 'Something to pry it: the sailor\'s bar'),
    step('low_tide', hatchKnown || j('marek_warnings'), open, 'Cross the reef at low water'),
    step('radio_battery', open || has(sim, 'radio_battery'), has(sim, 'radio_battery'), 'The radio battery'),
    step('flare_gun', open || has(sim, 'flare_gun'), flares > 0, 'The flare gun, loaded', has(sim, 'flare_gun') ? { have: flares, need: 1 } : null),
    step('peak', peakKnown, false, 'A high place to signal from: Signal Peak'),
  ];

  const plans = [
    { id: 'boat', title: 'Escape by sea', known: f('plan_boat') || looked || repaired, steps: boatSteps },
    { id: 'signal', title: 'Call for rescue', known: f('plan_signal') || hatchKnown, steps: signalSteps },
  ];
  const hints = [];
  for (const id of st.journal) {
    const e = sim.lore?.get(id);
    if (e?.category === 'objective') hints.push({ id, title: e.title, text: e.text });
  }
  return { plans, hints };
}
