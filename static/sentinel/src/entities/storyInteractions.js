// The dinghy, the shipwreck's cabin hatch, the border totems and the signal point (spec §5.1, §6.4, §8; step 4.7): the handlers that
// replace the stubs of Interactable.js, the flare gun's guard, and the bookkeeping of the wreck's finds.
// Simulation side. Every number is in tuning.story.
//
// The dinghy (action `dinghy`, the map's interactable at the crash site):
//   - not repaired, without the parts: looking at it sets plan_boat and dinghy_inspected, teaches the
//     patched_dinghy recipe and lists what is missing (event dinghy_inspected { id, missing });
//   - with waterproof_tarp + paracord + driftwood: a repair channel of tuning.story.repairSeconds; moving or pressing
//     again breaks it off and nothing is spent; on completion the three are spent (Inventory.spend, purpose
//     dinghy_repair), story flag dinghy_repaired, interactable flag `repaired`, event dinghy_repaired { id, spent }
//     (Marek listens for it) and the prop draws as `dinghy_patched` (propKind);
//   - repaired: event dinghy_waits { id, highTide } (the launch and the ending are step 5.3's).
// The hatch (action `hatch`, the map's `wreck_hatch`, also the container of the cabin's loot):
//   - closed, no crowbar: plan_signal + hatch_inspected, event hatch_inspected ("it will not move by hand");
//   - closed, crowbar carried (held or stowed): a pry channel of tuning.story.prySeconds that is loud (a noise of
//     tuning.story.pryNoiseRadius every tick, kind 'pry'); on completion the hatch is open (interactable flag
//     `open`, story flag hatch_open, event hatch_opened). The crowbar is never consumed;
//   - open: the cabin is a container (lootContainer). The radio battery the first time it is taken is switched on
//     (the sailor left it on): event power, and battery_humming once, so the player learns to switch it off.
// The signal point (action `signal_point`): looking sets plan_signal and signal_point_seen (event
//   signal_point_inspected). Firing is step 5.4's.
// The flare gun: `useItem` with it in hand never fires it anywhere but within tuning.story.signalRadius of the signal
//   point (event flare_refused { reason: 'not_here' | 'empty' }); there it raises flare_ready { flares } for step 5.4.
//   The gun from the wreck holds tuning.story.flareGunRounds; the Cartographer's pouch adds flarePouchRounds (story
//   counters flare_gun_rounds / flare_pouch_rounds, set the first time each is taken).
import { registerInteraction, startChannel, lootContainer } from './Interactable.js';
import { checkCraft, checkIngredients, spendIngredients, countCraft } from './Crafting.js';
import { learnRecipe } from '../sim/Lore.js';
import { flaresCarried } from '../sim/Objectives.js';

export const DINGHY_RECIPE = 'patched_dinghy';

/** the channel ends on this tick (Interactable.updateInteraction decrements after channelTick) */
const lastChannelTick = (sim) => (sim.interactables.channel?.ticksLeft ?? 0) <= 1;

/** the dinghy is patched */
export function dinghyRepaired(sim) {
  return sim.story.flags.has('dinghy_repaired');
}

/** a hatch is open */
export function hatchOpen(sim, id = 'wreck_hatch') {
  return sim.interactables.flag(id, 'open') === true;
}

/**
 * What a map prop looks like now, for the renderer: the patched dinghy once it is repaired, else its own kind.
 * @param {Object} sim
 * @param {{ id: string, kind: string }} prop
 */
export function propKind(sim, prop) {
  if (prop.kind === 'dinghy' && sim.interactables?.flag(prop.id, 'repaired') === true) return 'dinghy_patched';
  return prop.kind;
}

// ---- the dinghy ---------------------------------------------------------------------------------------------------

/** the parts are carried (whether or not the recipe is known yet: the first look teaches it) */
function hasDinghyParts(sim) {
  const r = sim.recipeBook.get(DINGHY_RECIPE);
  return !!r && checkIngredients(sim, r).every((s) => s.ok);
}

registerInteraction('dinghy', {
  icon: (sim) => (dinghyRepaired(sim) || hasDinghyParts(sim) ? 'hand' : 'eye'),
  interact(sim, t) {
    if (dinghyRepaired(sim)) {
      sim.events.push({ type: 'dinghy_waits', id: t.id, highTide: sim.world?.tideState === 'high' });
      return;
    }
    const flags = sim.story.flags;
    flags.add('plan_boat');
    flags.add('dinghy_inspected');
    if (sim.recipeBook.get(DINGHY_RECIPE)) learnRecipe(sim, DINGHY_RECIPE, 'dinghy');
    const c = checkCraft(sim, DINGHY_RECIPE, { at: 'dinghy' });
    if (c.ok) {
      startChannel(sim, t, sim.tuning.story.repairSeconds);
      sim.events.push({ type: 'dinghy_repair_start', id: t.id });
      return;
    }
    sim.events.push({ type: 'dinghy_inspected', id: t.id, missing: c.missing });
  },
  channelTick(sim, t) {
    if (!lastChannelTick(sim)) return false;
    const c = checkCraft(sim, DINGHY_RECIPE, { at: 'dinghy' });
    if (!c.ok) {
      // something was dropped while patching: nothing is spent
      sim.events.push({ type: 'dinghy_repair_failed', id: t.id, missing: c.missing });
      return true;
    }
    const spent = spendIngredients(sim, c.status, 'dinghy_repair');
    countCraft(sim, DINGHY_RECIPE);
    sim.story.flags.add('dinghy_repaired');
    sim.interactables.setFlag(t.id, 'repaired', true);
    sim.events.push({ type: 'dinghy_repaired', id: t.id, spent });
    return true;
  },
});

// ---- the cabin hatch ----------------------------------------------------------------------------------------------

/** prying steel is not quiet: a noise at the hatch, refreshed every tick of the channel */
function pryNoise(sim, t) {
  sim.noise.emit({ x: t.x, y: t.y, radius: sim.tuning.story.pryNoiseRadius, kind: 'pry', sourceId: t.id });
}

/** take what the open cabin holds; the battery is found switched on */
function lootHatch(sim, t) {
  const from = sim.events.length;
  if (sim.pickups.contents(t.id).length === 0) {
    sim.events.push({ type: 'container_empty', id: t.id });
    return;
  }
  lootContainer(sim, t.id);
  const to = sim.events.length;
  for (let i = from; i < to; i++) {
    const e = sim.events[i];
    if (e.type !== 'item_picked' || e.item !== 'radio_battery' || sim.story.flags.has('battery_found')) continue;
    sim.story.flags.add('battery_found');
    const inv = sim.inventory;
    const slot = inv.slots.findIndex((s) => s && s.id === 'radio_battery' && s.on !== true);
    if (slot >= 0 && inv.setPower(slot, true)) {
      sim.events.push({ type: 'power', item: 'radio_battery', on: true, slot });
      sim.events.push({ type: 'battery_humming', id: t.id, slot });
    }
  }
}

registerInteraction('hatch', {
  icon: (sim, t) => (hatchOpen(sim, t.id) || sim.inventory.has('crowbar') ? 'hand' : 'eye'),
  // open and emptied: nothing left to do here
  canInteract: (sim, t) => !hatchOpen(sim, t.id) || sim.pickups.contents(t.id).length > 0,
  interact(sim, t) {
    if (hatchOpen(sim, t.id)) {
      lootHatch(sim, t);
      return;
    }
    const flags = sim.story.flags;
    flags.add('plan_signal');
    flags.add('hatch_inspected');
    if (sim.inventory.has('crowbar')) {
      startChannel(sim, t, sim.tuning.story.prySeconds);
      pryNoise(sim, t);
      sim.events.push({ type: 'hatch_pry_start', id: t.id });
      return;
    }
    sim.events.push({ type: 'hatch_inspected', id: t.id });
  },
  channelTick(sim, t) {
    if (!sim.inventory.has('crowbar')) {
      sim.events.push({ type: 'hatch_pry_failed', id: t.id });
      return true;
    }
    pryNoise(sim, t);
    if (!lastChannelTick(sim)) return false;
    sim.interactables.setFlag(t.id, 'open', true);
    sim.story.flags.add('hatch_open');
    sim.events.push({ type: 'hatch_opened', id: t.id });
    return true;
  },
});

// ---- the border totems (step 4.4) --------------------------------------------------------------------------------
// Holding a fish, a coconut or a reef shell (catalog.canOffer), the totem takes it at its foot; pressing again before
// a scout has lifted it takes it back; empty-handed, the totem is looked at. The rest is the scouts'
// (ai/offering.js).

registerInteraction('totem', {
  icon: 'offering',
  interact(sim, t) {
    sim.scouts.offerings.interact(sim, t);
  },
});

// ---- the signal point and the flare gun -----------------------------------------------------------------------

registerInteraction('signal_point', {
  icon: 'eye',
  interact(sim, t) {
    sim.story.flags.add('plan_signal');
    sim.story.flags.add('signal_point_seen');
    sim.events.push({ type: 'signal_point_inspected', id: t.id, flares: flaresCarried(sim) });
  },
});

/** the map's signal point (an interactable entity), or null */
export function signalPoint(sim) {
  return sim.map?.entitiesOfType('interactable').find((e) => e.action === 'signal_point') ?? null;
}

/** the player stands where a flare may be fired */
export function atSignalPoint(sim) {
  const sp = signalPoint(sim);
  if (!sp) return false;
  const r = sim.tuning.story.signalRadius;
  const dx = sp.x - sim.player.x;
  const dy = sp.y - sim.player.y;
  return dx * dx + dy * dy <= r * r;
}

/**
 * `useItem` with the flare gun in hand. It can never be wasted: away from the signal point it refuses; at the point
 * it announces flare_ready for the signal step (5.4), which does the firing. Nothing is spent here.
 */
export function useFlareGun(sim) {
  if (!atSignalPoint(sim)) {
    sim.events.push({ type: 'flare_refused', reason: 'not_here' });
    return;
  }
  const flares = flaresCarried(sim);
  if (flares <= 0) {
    sim.events.push({ type: 'flare_refused', reason: 'empty' });
    return;
  }
  sim.events.push({ type: 'flare_ready', flares });
}

/**
 * End of every unpaused step: the first time the flare gun and the Cartographer's pouch are taken, their rounds are
 * counted into the story (the gun comes loaded).
 * @param {import('../sim/Sim.js').Sim} sim
 */
export function storyItemsAfterStep(sim) {
  const st = sim.story;
  const cfg = sim.tuning.story;
  for (const e of sim.events) {
    if (e.type !== 'item_picked') continue;
    if (e.item === 'flare_gun' && !st.flags.has('got_flare_gun')) {
      st.flags.add('got_flare_gun');
      st.counters.flare_gun_rounds = cfg.flareGunRounds;
    } else if (e.item === 'flare_casings' && !st.flags.has('got_flare_casings')) {
      st.flags.add('got_flare_casings');
      st.counters.flare_pouch_rounds = cfg.flarePouchRounds;
    }
  }
}
