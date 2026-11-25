// Debug tools for the Journal, crafting and the shipwreck (steps 4.6, 4.7; `?debug` only): a readout of the story
// (flags, recipes, flares, the dinghy and the hatch), teleport places at the dinghy, the hatch and the signal point,
// and actions to unlock every entry, inspect each site, learn or forget the totem, give each ending's kit, repair
// the dinghy, open the hatch and reset the story. Like cheats.js, this is a sanctioned writer of simulation state
// that exists only under ?debug; its writes are the functions below (storyCheats), which tests can call too.
import { COLORS } from './layers.js';
import * as cheats from './cheats.js';
import { handlerFor } from '../../entities/Interactable.js';
import { unlockEntry, loreAfterStep } from '../../sim/Lore.js';
import { flaresCarried } from '../../sim/Objectives.js';
import { dinghyRepaired, hatchOpen } from '../../entities/storyInteractions.js';

/** the inspectable sites of the island: every container landmark */
export function siteIds(sim) {
  return sim.map ? sim.map.entitiesOfType('landmark').filter((l) => sim.pickups.isContainer(l.id)).map((l) => l.id) : [];
}

/** each ending's kit */
export const KITS = Object.freeze({
  dinghy: [['waterproof_tarp', 1], ['paracord', 1], ['driftwood', 1]],
  signal: [['crowbar', 1], ['radio_battery', 1], ['flare_gun', 1], ['flare_casings', 1]],
  totem: [['driftwood', 1], ['paracord', 1], ['bone', 1]],
});

export const storyCheats = {
  /** every lore entry, at once (with their reveals and teaches) */
  unlockAll(sim) {
    for (const e of sim.lore.list) unlockEntry(sim, e.id, 'debug');
  },
  /** inspect a site as the player would (its loot as space allows), and file what it unlocks now */
  inspect(sim, id) {
    const t = sim.interactables.get(id);
    if (!t) return false;
    handlerFor(t.action).interact(sim, t);
    // events pushed between steps are cleared by the next one: unlock from them right away
    loreAfterStep(sim);
    return true;
  },
  learnRecipe(sim, id = 'driftwood_totem', on = !sim.story.recipes.has(id)) {
    if (on) sim.story.recipes.add(id);
    else sim.story.recipes.delete(id);
    return on;
  },
  giveKit(sim, kit) {
    let n = 0;
    for (const [item, k] of KITS[kit] ?? []) n += cheats.giveItem(sim, item, k);
    const c = sim.story.counters;
    if (kit === 'signal') {
      sim.story.flags.add('got_flare_gun');
      sim.story.flags.add('got_flare_casings');
      c.flare_gun_rounds = sim.tuning.story.flareGunRounds;
      c.flare_pouch_rounds = sim.tuning.story.flarePouchRounds;
    }
    return n;
  },
  repairDinghy(sim) {
    sim.story.flags.add('dinghy_repaired');
    sim.story.flags.add('plan_boat');
    sim.interactables.setFlag('dinghy', 'repaired', true);
  },
  openHatch(sim) {
    sim.story.flags.add('hatch_open');
    sim.story.flags.add('plan_signal');
    sim.interactables.setFlag('wreck_hatch', 'open', true);
  },
  /** the story from scratch, and the dinghy and the hatch as they were */
  reset(sim) {
    cheats.resetStory(sim);
    for (const [id, key] of [['dinghy', 'repaired'], ['wreck_hatch', 'open']]) sim.interactables.setFlag(id, key, false);
  },
};

/** the readout lines */
export function journalLines(sim) {
  const st = sim.story;
  const unread = st.journal.filter((id) => !st.read.has(id)).length;
  const c = st.counters;
  return [
    `journal ${st.journal.length}/${sim.lore.list.length} entries  unread ${unread}  recipes ${[...st.recipes].join(', ') || '-'}`,
    `  dinghy ${dinghyRepaired(sim) ? 'REPAIRED' : st.flags.has('dinghy_inspected') ? 'inspected' : 'untouched'}  hatch ${hatchOpen(sim) ? 'OPEN' : st.flags.has('hatch_inspected') ? 'inspected' : 'closed'}`
      + `  flares ${flaresCarried(sim)} (gun ${c.flare_gun_rounds ?? 0}, pouch ${c.flare_pouch_rounds ?? 0})  totems made ${c.crafted_driftwood_totem ?? 0}`,
    `  channel ${sim.interactables.channel ? `${sim.interactables.channel.action} ${sim.interactables.channel.ticksLeft}t` : '-'}`,
  ];
}

/**
 * Register the journal layer, places and actions.
 * @param {import('./DebugMode.js').DebugMode} debug
 */
export function registerJournalDebug(debug) {
  debug.addLayer({
    id: 'journal', label: 'Journal + crafting', group: 'readouts', default: false,
    drawUi(ctx, sim, vp, env) {
      if (!sim.story || !sim.lore) return;
      env.textBlock(ctx, journalLines(sim).map((text) => ({ text, color: COLORS.text })));
    },
  });
  debug.addPlaces((sim) => {
    const out = [];
    for (const id of ['dinghy', 'wreck_hatch', 'signal_point']) {
      const e = sim.map?.byId(id);
      if (e) out.push({ id: `at_${id}`, label: `At the ${id.replace('_', ' ')}`, x: e.x, y: e.y + 18 });
    }
    return out;
  });
  const act = (id, label, run) => debug.addAction({ id, label, group: 'journal', run });
  act('lore-all', 'Journal: unlock every entry', (sim) => storyCheats.unlockAll(sim));
  for (const id of siteIds(debug.sim)) act(`site-${id}`, `Inspect site: ${id}`, (sim) => storyCheats.inspect(sim, id));
  act('recipe-totem', 'Recipe: learn / forget the totem', (sim) => storyCheats.learnRecipe(sim));
  act('kit-dinghy', 'Give the dinghy kit', (sim) => storyCheats.giveKit(sim, 'dinghy'));
  act('kit-signal', 'Give the signal kit', (sim) => storyCheats.giveKit(sim, 'signal'));
  act('kit-totem', 'Give the totem parts', (sim) => storyCheats.giveKit(sim, 'totem'));
  act('dinghy-repair', 'Repair the dinghy', (sim) => storyCheats.repairDinghy(sim));
  act('hatch-open', 'Open the hatch', (sim) => storyCheats.openHatch(sim));
  act('story-reset-all', 'Story: reset (with dinghy and hatch)', (sim) => storyCheats.reset(sim));
}
