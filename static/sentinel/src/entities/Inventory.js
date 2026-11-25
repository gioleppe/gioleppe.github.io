// The player's inventory: the spec's compact 6-slot hotbar is the whole of it (§6.4). One slot is selected and
// its item is "in hand" (`held`); every other slot is stowed. The difference is gameplay: scouts react to a
// player *holding* metal (§7.3) and the Mangrove Gatherer wants metal and electronics *stowed*.
//
// Softlock rules kept here (asserted in tests/inventory.test.mjs):
//   - `remove` never deletes a key item; only `spend(id, n, purpose)` does, called by the step that uses the item
//     for its purpose (dinghy repair, firing the signal, crafting).
//   - `add` returns how many fitted; the caller leaves the rest where it was (on the ground, in the container).
//   - `takeSlot` (dropping) moves a whole stack out, to be placed in the world by the caller: nothing is lost.
//
// Electronics carry a power state per slot (`on`); `activeElectronics()` is what the Resonance system reads.

/**
 * @typedef {Object} Slot
 * @property {string} id   item id
 * @property {number} n    count, 1..stack
 * @property {boolean} [on] power, electronics only
 */

export class Inventory {
  /**
   * @param {import('./ItemCatalog.js').ItemCatalog} catalog
   * @param {number} [size] slots (tuning.inventory.slots)
   */
  constructor(catalog, size = 6) {
    this.catalog = catalog;
    /** @type {Array<Slot|null>} */
    this.slots = new Array(size).fill(null);
    /** selected slot 0..size-1, or -1 for empty hands */
    this.selected = -1;
  }

  get size() {
    return this.slots.length;
  }

  // ---- what is in hand --------------------------------------------------------------------------------------

  /** @returns {Slot|null} the item in hand: the selected slot's content (null with empty hands or an empty slot) */
  get held() {
    return this.selected >= 0 ? this.slots[this.selected] : null;
  }

  /** @returns {string|null} id of the item in hand */
  get heldId() {
    return this.held?.id ?? null;
  }

  /** @returns {import('./ItemCatalog.js').ItemDef|null} */
  get heldDef() {
    const h = this.held;
    return h ? this.catalog.get(h.id) : null;
  }

  /** the item in hand is metal (scouts escalate, spec §7.3) */
  get holdingMetal() {
    return this.heldDef?.metal === true;
  }

  /** some carried metal or electronics is in hand (not stowed) */
  get holdingMetalOrElectronics() {
    const d = this.heldDef;
    return !!d && (d.metal === true || d.electronic === true);
  }

  /** any carried electronic device is switched on, held or stowed */
  get carriesActiveElectronics() {
    return this.slots.some((s) => s && s.on === true);
  }

  /** any metal or electronics anywhere in the inventory */
  get carriesMetalOrElectronics() {
    return this.slots.some((s) => {
      const d = s && this.catalog.get(s.id);
      return !!d && (d.metal === true || d.electronic === true);
    });
  }

  /** @returns {string[]} ids of the electronics that are switched on, in slot order (Resonance, spec §6.3) */
  activeElectronics() {
    const out = [];
    for (const s of this.slots) if (s && s.on === true) out.push(s.id);
    return out;
  }

  /** is the first carried `id` switched on? */
  isOn(id) {
    return this.slots.some((s) => s && s.id === id && s.on === true);
  }

  // ---- counting ---------------------------------------------------------------------------------------------

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.n;
    return n;
  }

  has(id, n = 1) {
    return this.count(id) >= n;
  }

  get isFull() {
    return this.slots.every((s) => s !== null);
  }

  /**
   * How many of `id` would fit right now (0 for an unknown item).
   * @returns {number}
   */
  canAdd(id, n = 1) {
    if (!this.catalog.has(id) || !(n > 0)) return 0;
    const stack = this.catalog.stackOf(id);
    let room = 0;
    for (const s of this.slots) room += s === null ? stack : s.id === id ? stack - s.n : 0;
    return Math.min(n, room);
  }

  /**
   * Put up to `n` of `id` in: topping up stacks of the same item first, then empty slots, the selected (in-hand)
   * slot last so picking something up does not put it in the player's hand while another slot is free.
   * @returns {number} how many went in; the caller keeps the rest in the world
   */
  add(id, n = 1) {
    if (!this.catalog.has(id) || !(n > 0)) return 0;
    const stack = this.catalog.stackOf(id);
    const electronic = this.catalog.get(id).electronic === true;
    let left = n;
    for (const s of this.slots) {
      if (left === 0) break;
      if (s && s.id === id && s.n < stack) {
        const k = Math.min(stack - s.n, left);
        s.n += k;
        left -= k;
      }
    }
    const order = [];
    for (let i = 0; i < this.slots.length; i++) if (i !== this.selected) order.push(i);
    if (this.selected >= 0) order.push(this.selected);
    for (const i of order) {
      if (left === 0) break;
      if (this.slots[i] !== null) continue;
      const k = Math.min(stack, left);
      this.slots[i] = electronic ? { id, n: k, on: false } : { id, n: k };
      left -= k;
    }
    return n - left;
  }

  /**
   * Remove up to `n` ordinary items (eaten, thrown, offered). A key item is never removed this way.
   * @returns {number} how many were removed (0 for a key item)
   */
  remove(id, n = 1) {
    if (this.catalog.isKey(id)) return 0;
    return this.removeAny(id, n);
  }

  /**
   * The only way a key item leaves the game: spent by the step that uses it for its purpose (the dinghy repair,
   * firing the signal, crafting). Ordinary items may be spent too.
   * @param {string} purpose what it was spent on, for the event log
   * @returns {number} how many were removed (all or nothing)
   */
  spend(id, n, purpose) {
    if (typeof purpose !== 'string' || !purpose) throw new Error('Inventory.spend: a purpose is required');
    if (this.count(id) < n) return 0;
    return this.removeAny(id, n);
  }

  /** later slots first, so the stack in hand goes last */
  removeAny(id, n) {
    let left = n;
    const order = [];
    for (let i = this.slots.length - 1; i >= 0; i--) if (i !== this.selected) order.push(i);
    if (this.selected >= 0) order.push(this.selected);
    for (const i of order) {
      const s = this.slots[i];
      if (left === 0) break;
      if (!s || s.id !== id) continue;
      const k = Math.min(s.n, left);
      s.n -= k;
      left -= k;
      if (s.n === 0) this.slots[i] = null;
    }
    return n - left;
  }

  /**
   * Remove one ordinary item from a slot (the one in hand that was thrown or eaten). Never a key item.
   * @returns {boolean}
   */
  removeOneFromSlot(i) {
    const s = this.slots[i];
    if (!s || this.catalog.isKey(s.id)) return false;
    s.n -= 1;
    if (s.n === 0) this.slots[i] = null;
    return true;
  }

  /**
   * Take a whole stack out of a slot so it can be placed in the world (dropping). A device is switched off.
   * @returns {Slot|null} what was in it
   */
  takeSlot(i) {
    const s = this.slots[i];
    if (!s) return null;
    this.slots[i] = null;
    return { id: s.id, n: s.n };
  }

  // ---- selection and power ---------------------------------------------------------------------------------

  /**
   * Hotbar input: select a slot; selecting the selected slot again empties the hands.
   * @param {number} slot 0..size-1 (anything else is ignored)
   * @returns {boolean} the selection changed
   */
  select(slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.slots.length) return false;
    this.selected = this.selected === slot ? -1 : slot;
    return true;
  }

  /**
   * Switch an electronic device in a slot on or off.
   * @param {number} i slot
   * @param {boolean} [on] default: flip
   * @returns {boolean|null} the new state, or null when the slot holds no electronics
   */
  setPower(i, on) {
    const s = this.slots[i];
    if (!s || this.catalog.get(s.id)?.electronic !== true) return null;
    s.on = on === undefined ? !s.on : !!on;
    return s.on;
  }

  /** @returns {number} slot of the first `id`, or -1 */
  slotOf(id) {
    return this.slots.findIndex((s) => s && s.id === id);
  }

  /** empty every slot (debug) */
  clear() {
    this.slots.fill(null);
  }

  // ---- state ------------------------------------------------------------------------------------------------

  snapshot() {
    return { selected: this.selected, slots: this.slots.map((s) => (s ? { ...s } : null)) };
  }

  /**
   * @param {{ selected: number, slots: Array<Slot|null> }} snap
   * @param {import('./ItemCatalog.js').ItemCatalog} catalog
   * @param {number} [size]
   */
  static restore(snap, catalog, size = 6) {
    const inv = new Inventory(catalog, size);
    snap.slots.forEach((s, i) => { if (i < size) inv.slots[i] = s ? { ...s } : null; });
    inv.selected = Number.isInteger(snap.selected) && snap.selected < size ? snap.selected : -1;
    return inv;
  }
}
