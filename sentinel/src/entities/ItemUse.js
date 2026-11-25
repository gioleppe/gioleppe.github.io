// What the player does with the items they carry, one tick at a time: select a hotbar slot, use the item in hand
// by its `use` descriptor (data/items.json), switch devices on and off, and drop the stack in hand.
//
// Events: hotbar {slot, item}, item_used {item, use, amount?}, item_cannot_use {item, reason}, power {item, on, slot},
//         item_dropped {id, item, n, x, y}, drop_refused {reason}
//
// Softlock rules here: a key item is never consumed (Inventory.remove refuses it, and the data validator forbids
// a key item from being consumable); a drop places the whole stack in the world, and a drop is refused while
// swimming, where the item would sink out of reach for good.

/**
 * Hotbar input: select a slot, or empty the hands by selecting the selected slot again.
 * @param {import('../sim/Sim.js').Sim} sim
 * @param {number} slot -1 for none this tick
 */
export function selectHotbar(sim, slot) {
  if (slot < 0) return;
  if (sim.inventory.select(slot)) sim.events.push({ type: 'hotbar', slot: sim.inventory.selected, item: sim.inventory.heldId });
}

/**
 * Switch a carried device on or off.
 * @returns {boolean|null} new state, or null when the slot holds no electronics
 */
export function togglePower(sim, slot) {
  const on = sim.inventory.setPower(slot, undefined);
  if (on !== null) sim.events.push({ type: 'power', item: sim.inventory.slots[slot].id, on, slot });
  return on;
}

/** the light key (F): switch the carried flashlight on or off, held or stowed */
export function toggleLight(sim) {
  const slot = sim.inventory.slotOf('flashlight');
  if (slot < 0) {
    sim.events.push({ type: 'item_cannot_use', item: 'flashlight', reason: 'not_carried' });
    return;
  }
  togglePower(sim, slot);
}

/**
 * Keep the player's light (drawn by the lighting system, read by Resonance) in step with the flashlight's power.
 * The inventory is the single owner: nothing else (the player included) sets `player.lightOn`.
 */
export function syncLight(sim) {
  sim.player.lightOn = sim.inventory.isOn('flashlight');
}

/**
 * Use the item in hand (the `useItem` input). Throwables are thrown by `throwHeld` (Projectile.js); the
 * caller decides that before calling this.
 * @param {import('../sim/Sim.js').Sim} sim
 */
export function useHeld(sim) {
  const inv = sim.inventory;
  const held = inv.held;
  if (!held) {
    sim.events.push({ type: 'item_cannot_use', item: null, reason: 'empty_hands' });
    return;
  }
  const def = inv.heldDef;
  const use = def?.use ?? { type: 'none' };
  switch (use.type) {
    case 'drink':
    case 'heal': {
      if (!sim.catalog.canConsume(held.id)) break;
      if (use.type === 'drink') sim.player.drink(use.amount);
      else {
        sim.player.heal(use.amount);
        if (use.stopsBleed) sim.player.stopBleeding();
      }
      const item = held.id;
      inv.removeOneFromSlot(inv.selected);
      sim.events.push({ type: 'item_used', item, use: use.type, amount: use.amount });
      return;
    }
    case 'toggle':
      togglePower(sim, inv.selected);
      return;
    default:
      break;
  }
  sim.events.push({ type: 'item_cannot_use', item: held.id, reason: 'no_use' });
}

/**
 * Drop the stack in hand at the player's feet (the `drop` input). It becomes a ground pickup that persists.
 * @param {import('../sim/Sim.js').Sim} sim
 */
export function dropHeld(sim) {
  const inv = sim.inventory;
  if (!inv.held) {
    sim.events.push({ type: 'drop_refused', reason: 'empty_hands' });
    return;
  }
  if (sim.player.mode === 'swim') {
    sim.events.push({ type: 'drop_refused', reason: 'swimming', item: inv.heldId });
    return;
  }
  const s = inv.takeSlot(inv.selected);
  const p = sim.pickups.drop(s.id, s.n, sim.player.x, sim.player.y);
  sim.events.push({ type: 'item_dropped', id: p.id, item: s.id, n: s.n, x: p.x, y: p.y });
}

/**
 * Put the starting kit (tuning.inventory.startingKit) in a new inventory.
 * @param {import('./Inventory.js').Inventory} inv
 * @param {Array<{ item: string, n?: number }>} kit
 */
export function giveStartingKit(inv, kit = []) {
  for (const k of kit) inv.add(k.item, k.n ?? 1);
}
