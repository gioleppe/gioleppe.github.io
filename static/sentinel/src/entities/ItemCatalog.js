// The item definitions of data/items.json (spec §6.4) as the simulation reads them. Data only: the rules that
// keep key items safe live where items move (Inventory.js, Interactable.js, Projectile.js), and the file itself is
// checked by tools/lib/validate-items.mjs.

/** the ids the game code names; data/items.json must define every one */
export const ITEM_IDS = Object.freeze([
  'paracord', 'waterproof_tarp', 'driftwood', 'crowbar', 'radio_battery', 'flare_gun', 'flare_casings', 'coconut',
  'reef_shell', 'bone', 'fish', 'healing_herbs', 'bandage', 'rock', 'flashlight', 'tin_flask', 'driftwood_totem',
]);

/** the kinds of `use` an item can have */
export const USE_TYPES = Object.freeze(['drink', 'heal', 'toggle', 'throw', 'none']);

/**
 * @typedef {Object} ItemDef
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {boolean} key         needed for an ending
 * @property {boolean} metal
 * @property {boolean} electronic  has a power state (on/off)
 * @property {boolean} throwable
 * @property {boolean} offering    a scout accepts it at a border totem
 * @property {boolean} consumable  used up by `use`
 * @property {number} stack        most per slot
 * @property {{ type: string, amount?: number, stopsBleed?: boolean }} use
 */

export class ItemCatalog {
  /**
   * @param {{ items: ItemDef[] }|ItemDef[]|null|undefined} data contents of data/items.json; missing gives an
   *   empty catalog (a Sim built without item data has no items, no pickups and an empty starting kit)
   */
  constructor(data) {
    const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    /** @type {Map<string, ItemDef>} */
    this.byId = new Map();
    for (const def of list) if (def && typeof def.id === 'string') this.byId.set(def.id, Object.freeze({ ...def, use: Object.freeze({ ...(def.use ?? { type: 'none' }) }) }));
  }

  /** @returns {ItemDef|null} */
  get(id) {
    return this.byId.get(id) ?? null;
  }

  has(id) {
    return this.byId.has(id);
  }

  /** @returns {string[]} every id, in file order */
  ids() {
    return [...this.byId.keys()];
  }

  isKey(id) {
    return this.byId.get(id)?.key === true;
  }

  /** most of this item one slot holds (1 for an unknown id) */
  stackOf(id) {
    const s = this.byId.get(id)?.stack;
    return Number.isInteger(s) && s >= 1 ? s : 1;
  }

  /**
   * Can this item be laid at a totem as an offering? Never a key item, never metal or electronic.
   * @param {string} id
   */
  canOffer(id) {
    const d = this.byId.get(id);
    return !!d && d.offering === true && !d.key && !d.metal && !d.electronic;
  }

  /** can it be thrown? Never a key item. */
  canThrow(id) {
    const d = this.byId.get(id);
    return !!d && d.throwable === true && !d.key;
  }

  /** is it used up by `use`? Never a key item. */
  canConsume(id) {
    const d = this.byId.get(id);
    return !!d && d.consumable === true && !d.key;
  }
}
