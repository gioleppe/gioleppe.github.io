// The one adapter between Marek's dialogue and the rest of the simulation (inventory, interactables,
// Resonance). Kept small on purpose: everything another system provides is reached through here, guarded, so
// this step works on its own and the merge with the inventory/interaction step touches only this file.
//
// Integration points:
//  1. Starting a talk: the interaction registry's `talk` action (Interactable.js builds it from the map's
//     `npc { npc: 'marek' }`, with the speech icon); its handler is registered here, at module load.
//  2. Story facts from events, read from `sim.events` at the end of every step: `site_inspected { id, landmark }`
//     (a Fallen Outsider site), `dinghy_repaired`, and `interact`/inspect/use events naming the dinghy, the wreck
//     hatch or the signal point (the plan flags).
// Items: `sim.inventory.has/add/remove(id)`.
import { registerInteraction } from './Interactable.js';

/** Fallen Outsider sites (spec §7.2), by landmark id */
export const OUTSIDER_SITES = Object.freeze(['missionary_camp', 'sailor_remains', 'cartographer_camp']);
/** carrying any of these (or having looked at the dinghy) means the player has the boat plan */
export const BOAT_ITEMS = Object.freeze(['waterproof_tarp']);
/** carrying any of these (or having looked at the hatch or the peak) means the player has the signal plan */
export const SIGNAL_ITEMS = Object.freeze(['crowbar', 'radio_battery', 'flare_gun', 'flare_casings']);
const BOAT_TARGETS = new Set(['dinghy']);
const SIGNAL_TARGETS = new Set(['wreck_hatch', 'signal_point']);

/** does the player carry an item (false without an inventory) */
export function hasItem(sim, id) {
  return !!sim.inventory?.has?.(id);
}

/**
 * Scouts are warning or hunting the player (sim.threat, steps 4.1-4.3): no conversation then, since a conversation
 * pauses the world and would otherwise be a pause button in a chase.
 */
export function huntedNow(sim) {
  const level = sim.threat?.level;
  return level === 'warn' || level === 'chase';
}

registerInteraction('talk', {
  icon: 'speech',
  // only Marek talks (the Sentinelese never speak); not while a conversation is already open, nor while hunted
  canInteract: (sim, t) => !!sim.marek && t.id === sim.marek.id && !sim.dialogue?.active && !huntedNow(sim),
  interact: (sim) => { talkToMarek(sim); },
});

/** start the conversation with Marek; false if there is no Marek, no dialogue data, one is already open, or scouts hunt the player */
export function talkToMarek(sim) {
  if (!sim.marek || !sim.dialogue || sim.dialogue.active || huntedNow(sim)) return false;
  return sim.dialogue.start('marek');
}

/** the Fallen Outsider site an event id refers to: the landmark itself, or an entity placed at it */
export function siteOf(sim, id, landmark = null) {
  if (OUTSIDER_SITES.includes(id)) return id;
  if (OUTSIDER_SITES.includes(landmark)) return landmark;
  const e = sim.map?.byId(id);
  const at = e?.container ?? e?.landmark ?? null;
  return OUTSIDER_SITES.includes(at) ? at : null;
}

/** record a Fallen Outsider site as inspected (story state); returns the site id or null */
export function markInspected(sim, id, landmark = null) {
  const site = siteOf(sim, id, landmark);
  if (site) sim.story.inspected.add(site);
  return site;
}

/**
 * End of every (unpaused) step: read this step's events into story facts and keep the plan flags current.
 * @param {import('../sim/Sim.js').Sim} sim
 */
export function afterStep(sim) {
  const flags = sim.story.flags;
  for (const e of sim.events) {
    if (e.type === 'site_inspected') markInspected(sim, e.id, e.landmark);
    else if (e.type === 'dinghy_repaired') flags.add('dinghy_repaired');
    if (/inspect|interact|use/.test(e.type)) {
      const target = e.id ?? e.target;
      if (BOAT_TARGETS.has(target)) flags.add('plan_boat');
      if (SIGNAL_TARGETS.has(target)) flags.add('plan_signal');
    }
  }
  if (sim.inventory) {
    if (BOAT_ITEMS.some((i) => hasItem(sim, i))) flags.add('plan_boat');
    if (SIGNAL_ITEMS.some((i) => hasItem(sim, i))) flags.add('plan_signal');
  }
}

/**
 * What the dialogue engine asks of the world.
 * @returns {import('../sim/Dialogue.js').DialogueHost}
 */
export function dialogueHost(sim) {
  return {
    has: (id) => hasItem(sim, id),
    state(kind) {
      const w = sim.world;
      switch (kind) {
        case 'time': return w?.dayPhase ?? 'day';
        case 'tide': return w?.tideState ?? 'low';
        case 'weather': return w?.weather?.kind ?? 'clear';
        case 'light': return sim.player.lightOn ? 'on' : 'off';
        case 'tier': return sim.resonance?.tier ?? 'quiet';
        default: return '';
      }
    },
    number(name) {
      if (name === 'hour') return Math.floor(sim.world?.timeOfDay ?? 0);
      if (name === 'day') return sim.world?.day ?? 1;
      if (name === 'resonance') return Math.floor(sim.resonance?.value ?? 0);
      return undefined;
    },
    give: (id) => { if (sim.inventory?.add) sim.inventory.add(id); else sim.events.push({ type: 'item_given', id, source: 'dialogue' }); },
    take: (id) => { if (sim.inventory?.remove) sim.inventory.remove(id); else sim.events.push({ type: 'item_taken', id, source: 'dialogue' }); },
    emit(e) {
      // Marek asks for the light to go off and the player agrees: the one world write a line of dialogue makes
      // It goes through the inventory, the light's single owner (ItemUse.syncLight): writing player.lightOn alone
      // was undone on the next unpaused step, and a save during the conversation restored the light on.
      if (e.type === 'light_off') {
        const inv = sim.inventory;
        if (inv) {
          for (let i = 0; i < inv.slots.length; i++) {
            if (inv.slots[i]?.id === 'flashlight' && inv.slots[i].on) {
              inv.setPower(i, false);
              sim.events.push({ type: 'power', item: 'flashlight', on: false, slot: i });
            }
          }
          sim.player.lightOn = inv.isOn('flashlight');
        } else sim.player.lightOn = false;
      }
      sim.events.push(e);
    },
  };
}
