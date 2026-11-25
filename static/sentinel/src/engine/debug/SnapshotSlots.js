// A few numbered save slots for debug snapshots: kept in memory and, when storage allows, in localStorage so
// they survive a reload. Pure (storage is passed in). The snapshot format is the Sim's own (`sim.snapshot()`).
import { snapshotHash } from '../../sim/hash.js';

export const SLOT_STORAGE_PREFIX = 'sentinel.debug.slot.';
export const SLOT_COUNT = 3;

/** @typedef {{ snapshot: object, hash: string, tick: number, seed: number|string, label: string }} SlotEntry */

export class SnapshotSlots {
  /**
   * @param {Object} [opts]
   * @param {{ getItem(k: string): string|null, setItem(k: string, v: string): void, removeItem?(k: string): void }|null} [opts.storage]
   * @param {number} [opts.count]
   * @param {string} [opts.prefix]
   */
  constructor({ storage = null, count = SLOT_COUNT, prefix = SLOT_STORAGE_PREFIX } = {}) {
    this.storage = storage;
    this.count = count;
    this.prefix = prefix;
    /** @type {Array<SlotEntry|null>} */
    this.memory = Array.from({ length: count }, (_, i) => this.read(i));
    /** whether the last save also reached storage */
    this.persisted = false;
  }

  check(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this.count) throw new RangeError(`snapshot slot ${i} does not exist (0..${this.count - 1})`);
  }

  read(i) {
    try {
      const raw = this.storage?.getItem(this.prefix + i);
      const v = raw ? JSON.parse(raw) : null;
      return v && v.snapshot ? v : null;
    } catch {
      return null;
    }
  }

  /**
   * Keep a snapshot in slot i (a deep copy, so later play cannot change it).
   * @param {number} i
   * @param {object} snapshot from sim.snapshot()
   * @param {string} [label]
   * @returns {SlotEntry}
   */
  save(i, snapshot, label = '') {
    this.check(i);
    const copy = JSON.parse(JSON.stringify(snapshot));
    const entry = { snapshot: copy, hash: snapshotHash(copy), tick: copy.tick ?? 0, seed: copy.seed, label };
    this.memory[i] = entry;
    try {
      this.storage?.setItem(this.prefix + i, JSON.stringify(entry));
      this.persisted = !!this.storage;
    } catch {
      this.persisted = false;   // too big or storage blocked: the slot still works until the page closes
    }
    return entry;
  }

  /** @returns {SlotEntry|null} a deep copy, safe to restore from more than once */
  load(i) {
    this.check(i);
    const e = this.memory[i];
    return e ? JSON.parse(JSON.stringify(e)) : null;
  }

  clear(i) {
    this.check(i);
    this.memory[i] = null;
    try { this.storage?.removeItem?.(this.prefix + i); } catch { /* ignore */ }
  }

  /** @returns {Array<{ tick: number, hash: string, label: string }|null>} what each slot holds, for the panel */
  summary() {
    return this.memory.map((e) => (e ? { tick: e.tick, hash: e.hash, label: e.label } : null));
  }
}
