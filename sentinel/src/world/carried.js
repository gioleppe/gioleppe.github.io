// What the player carries, as Resonance (and later the AI) needs to know it, read through one seam.
//
// The inventory (step 3.4, `sim.inventory`) exposes activeElectronics() (ids of electronic items powered on),
// has(id), count(id) and held. Until it exists, or on a Sim built without one, every answer here is "nothing
// carried", so this module works before and after that step is merged. The flashlight's switch also lives on
// `sim.player.lightOn`; it is reported once, whichever of the two says it is on.

const NONE = Object.freeze([]);

/**
 * Ids of the electronic items powered on, never including the flashlight (see flashlightOn).
 * @param {{ inventory?: { activeElectronics?: () => string[] } }} sim
 * @returns {ReadonlyArray<string>}
 */
export function activeElectronics(sim) {
  const list = typeof sim?.inventory?.activeElectronics === 'function' ? sim.inventory.activeElectronics() : null;
  if (!Array.isArray(list) || list.length === 0) return NONE;
  let other = false;
  for (const id of list) if (id !== 'flashlight') { other = true; break; }
  return other ? list.filter((id) => id !== 'flashlight') : NONE;
}

/**
 * The flashlight is on: the player's switch, or the inventory reports it powered.
 * @param {{ player?: { lightOn?: boolean }, inventory?: { activeElectronics?: () => string[] } }} sim
 */
export function flashlightOn(sim) {
  if (sim?.player?.lightOn) return true;
  const list = typeof sim?.inventory?.activeElectronics === 'function' ? sim.inventory.activeElectronics() : null;
  return Array.isArray(list) && list.includes('flashlight');
}

/**
 * The player carries at least one of an item.
 * @param {{ inventory?: { has?: (id: string) => boolean } }} sim
 * @param {string} id
 */
export function carries(sim, id) {
  const inv = sim?.inventory;
  if (!inv) return false;
  if (typeof inv.has === 'function') return !!inv.has(id);
  if (typeof inv.count === 'function') return inv.count(id) > 0;
  return false;
}
