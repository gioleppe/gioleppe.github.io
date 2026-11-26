// Player saves (step 5.2): envelopes around Sim snapshots in localStorage. Presentation side: the simulation
// knows nothing about storage; when a moment may be saved is src/sim/saveRules.js.
//
// Keys, all under one prefix (`sentinel.save.`), one per slot plus a small index:
//   sentinel.save.auto.0, sentinel.save.auto.1      two rotating autosaves: each autosave overwrites the older one,
//                                                   so the previous autosave is always kept as a backup
//   sentinel.save.manual.0 .. manual.2              the explicit save slots
//   sentinel.save.index                             { format, version, seq, slots: { key: summary } }; the slot
//                                                   values are the truth, the index only carries the save counter
//                                                   (newest first ordering) and a summary cache for tools
//
// Envelope (a JSON string per slot):
//   { format: 'sentinel-save', saveVersion, snapshotVersion, mapHash, gameVersion, kind: 'auto'|'manual', slot,
//     seq, savedAt (ms since epoch, for "saved 5 minutes ago"), createdAtTick, day, timeOfDay, region,
//     landmarkNearby, playSeconds, checksum, snapshot }
//   checksum = hash64(canonicalJson(snapshot)). The snapshot is the Sim's own (`sim.snapshot()`), opaque here:
//   only `version` is read from it, and its shape is migrated by Sim.restore (READABLE_VERSIONS), not here.
//
// Every storage call is in try/catch. Private mode, a full quota or disabled storage never throw out of here:
// a write reports { ok: false, code, message } and the envelope is kept in memory for this page's life, so Retry
// still works and the run is never lost while the page is open.
import { canonicalJson, hash64 } from '../sim/hash.js';
import { saveSummary } from '../sim/saveRules.js';

export const SAVE_PREFIX = 'sentinel.save.';
export const SAVE_FORMAT = 'sentinel-save';
export const INDEX_FORMAT = 'sentinel-save-index';
/** the envelope's own version (the snapshot inside has its own) */
export const SAVE_VERSION = 1;
export const AUTO_SLOTS = 2;
export const MANUAL_SLOTS = 3;

/** every slot key's suffix, autosaves first */
export const SLOT_IDS = Object.freeze([
  ...Array.from({ length: AUTO_SLOTS }, (_, i) => `auto.${i}`),
  ...Array.from({ length: MANUAL_SLOTS }, (_, i) => `manual.${i}`),
]);

/** why a save could not be read or written: shown to the player as `message` */
export const SAVE_ERRORS = Object.freeze({
  empty: 'This slot is empty.',
  corrupt: 'This save is damaged and cannot be read.',
  foreign: 'This is not a save of this game.',
  newer: 'This save comes from a newer version of the game.',
  version: 'This save is from an older version and cannot be loaded.',
  map: 'The island has changed since this save was made, so it cannot be restored.',
  restore: 'This save could not be restored.',
  quota: 'Saving unavailable: the browser storage is full.',
  unavailable: 'Saving unavailable: this browser does not allow the game to store data (private mode or blocked storage).',
});

/**
 * Envelope migrations: `SAVE_MIGRATIONS[v]` turns a version-v envelope into version v + 1. Version 1 is current.
 * The worked example: version 0, a draft format, kept the slot description in a `meta` object and the map as
 * `map`. Snapshot shapes are not migrated here (Sim.restore does that).
 */
export const SAVE_MIGRATIONS = Object.freeze({
  0: (env) => {
    const { meta = {}, map, ...rest } = env;
    return { ...rest, ...meta, mapHash: map ?? rest.mapHash ?? 'none', saveVersion: 1 };
  },
});

/** apply the migrations up to SAVE_VERSION; throws a coded error for a newer or unknown version */
export function migrateEnvelope(env) {
  let e = env;
  let v = e.saveVersion;
  if (!Number.isInteger(v) || v < 0) throw saveError('foreign');
  if (v > SAVE_VERSION) throw saveError('newer');
  while (v < SAVE_VERSION) {
    const m = SAVE_MIGRATIONS[v];
    if (!m) throw saveError('version');
    e = m(e);
    if (e.saveVersion !== v + 1) throw new Error(`save migration ${v} did not produce version ${v + 1}`);
    v = e.saveVersion;
  }
  return e;
}

/** an Error with `code` (a SAVE_ERRORS key) and the player-facing message */
export function saveError(code, detail = '') {
  const e = new Error(SAVE_ERRORS[code] ?? code);
  e.code = code;
  if (detail) e.detail = detail;
  return e;
}

/** the map identity a snapshot carries and Sim.restore compares: 'version/hash', or 'none' for the test field */
export function mapHashOf(mapOrSnapshotMap) {
  const m = mapOrSnapshotMap;
  return m ? `${m.version}/${m.hash}` : 'none';
}

/** checksum of a snapshot object */
export function checksumOf(snapshot) {
  return hash64(canonicalJson(snapshot));
}

/** localStorage if it can be touched, else null (merely reading `localStorage` can throw) */
export function defaultStorage() {
  try {
    const s = globalThis.localStorage ?? null;
    if (!s) return null;
    const probe = `${SAVE_PREFIX}probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch { return null; }
}

/** a storage error as one of our codes */
function storageCode(err) {
  const n = `${err?.name ?? ''} ${err?.message ?? ''}`.toLowerCase();
  return /quota|exceed|full/.test(n) || err?.code === 22 || err?.code === 1014 ? 'quota' : 'unavailable';
}

/**
 * @typedef {Object} SlotInfo
 * @property {string} id        'auto.0' | 'auto.1' | 'manual.0' ..
 * @property {'auto'|'manual'} kind
 * @property {number} slot
 * @property {boolean} empty
 * @property {boolean} ok        readable (format, version and checksum); restoring may still fail (map, snapshot)
 * @property {string|null} error a SAVE_ERRORS code
 * @property {Object|null} env   the (migrated) envelope when ok
 * @property {number} bytes      stored size in characters
 * @property {boolean} memoryOnly kept in memory only (storage refused it)
 */

export class SaveStore {
  /**
   * @param {Object} [opts]
   * @param {{ getItem(k:string): string|null, setItem(k:string, v:string): void, removeItem(k:string): void }|null} [opts.storage]
   *   null: storage unavailable (saves live in memory for the page's life)
   * @param {string} [opts.prefix]
   * @param {string} [opts.gameVersion] written into every envelope ('dev' locally, 'v0.1.0 abc123' published)
   * @param {() => number} [opts.now] ms since epoch (Date.now in the page)
   */
  constructor({ storage = defaultStorage(), prefix = SAVE_PREFIX, gameVersion = 'dev', now = () => Date.now() } = {}) {
    this.storage = storage;
    this.prefix = prefix;
    this.gameVersion = gameVersion;
    this.now = now;
    /** @type {Map<string, string|null>} slot values storage refused (or removals it refused), newest truth for this page */
    this.memory = new Map();
    /** @type {Map<string, { raw: string, result: Object }>} parse results by slot, valid while the text is the same */
    this.parsed = new Map();
    /** the last write problem ({ code, message }), or null after a clean write */
    this.lastError = storage ? null : { code: 'unavailable', message: SAVE_ERRORS.unavailable };
  }

  /** true when saves reach storage (false: private mode, blocked, or a failed probe) */
  get available() { return !!this.storage; }

  key(id) { return this.prefix + id; }

  // ---- raw access (every call guarded) ----------------------------------------------------------------------

  readRaw(id) {
    if (this.memory.has(id)) return this.memory.get(id);
    try { return this.storage?.getItem(this.key(id)) ?? null; } catch { return null; }
  }

  /** @returns {{ ok: boolean, code?: string, message?: string }} */
  writeRaw(id, text) {
    if (!this.storage) {
      this.memory.set(id, text);
      return this.fail('unavailable');
    }
    try {
      this.storage.setItem(this.key(id), text);
      this.memory.delete(id);
      return { ok: true };
    } catch (err) {
      this.memory.set(id, text);   // the previous stored value is untouched; this page still has the new one
      return this.fail(storageCode(err));
    }
  }

  removeRaw(id) {
    try { this.storage?.removeItem(this.key(id)); this.memory.delete(id); } catch { this.memory.set(id, null); }
  }

  fail(code) {
    this.lastError = { code, message: SAVE_ERRORS[code] };
    return { ok: false, code, message: SAVE_ERRORS[code] };
  }

  readIndex() {
    try {
      const raw = this.readRaw('index');
      const v = raw ? JSON.parse(raw) : null;
      if (v && v.format === INDEX_FORMAT && Number.isInteger(v.seq)) return v;
    } catch { /* rebuilt below */ }
    return null;
  }

  /** the next save counter: one more than any seen in the index or in a slot */
  nextSeq() {
    let seq = this.readIndex()?.seq ?? 0;
    for (const s of this.list()) if (s.env && Number.isInteger(s.env.seq)) seq = Math.max(seq, s.env.seq);
    return seq + 1;
  }

  writeIndex(seq) {
    const slots = {};
    for (const s of this.list()) {
      if (s.env) slots[s.id] = { seq: s.env.seq, savedAt: s.env.savedAt, day: s.env.day, region: s.env.region, playSeconds: s.env.playSeconds, bytes: s.bytes };
    }
    // a failed index write loses nothing: the slots are the truth and the counter is rebuilt from them
    const text = JSON.stringify({ format: INDEX_FORMAT, version: 1, seq, slots });
    if (!this.storage) { this.memory.set('index', text); return; }
    try { this.storage.setItem(this.key('index'), text); this.memory.delete('index'); } catch { this.memory.set('index', text); }
  }

  // ---- envelopes ---------------------------------------------------------------------------------------------

  /**
   * Wrap a Sim's present moment.
   * @param {Object} sim
   * @param {{ kind: 'auto'|'manual', slot: number, seq?: number }} where
   */
  envelope(sim, { kind, slot, seq = 0 }) {
    const snapshot = sim.snapshot();
    const sum = saveSummary(sim);
    return {
      format: SAVE_FORMAT,
      saveVersion: SAVE_VERSION,
      snapshotVersion: snapshot.version,
      mapHash: mapHashOf(snapshot.map),
      gameVersion: this.gameVersion,
      kind,
      slot,
      seq,
      savedAt: this.now(),
      createdAtTick: sum.tick,
      day: sum.day,
      timeOfDay: sum.timeOfDay,
      region: sum.region,
      landmarkNearby: sum.landmarkNearby,
      playSeconds: sum.playSeconds,
      checksum: checksumOf(snapshot),
      snapshot,
    };
  }

  /**
   * Parse and check an envelope's text: JSON, format, version (migrated), checksum.
   * @param {string|null} text
   * @returns {Object} the migrated envelope
   * @throws {Error} with `code` (SAVE_ERRORS)
   */
  parse(text) {
    if (text == null || text === '') throw saveError('empty');
    let env;
    try { env = JSON.parse(text); } catch { throw saveError('corrupt'); }
    if (!env || typeof env !== 'object' || Array.isArray(env) || env.format !== SAVE_FORMAT) throw saveError('foreign');
    env = migrateEnvelope(env);
    if (!env.snapshot || typeof env.snapshot !== 'object') throw saveError('corrupt');
    let sum;
    try { sum = checksumOf(env.snapshot); } catch { throw saveError('corrupt'); }
    if (sum !== env.checksum) throw saveError('corrupt', `checksum ${sum} != ${env.checksum}`);
    return env;
  }

  /** @returns {SlotInfo} */
  info(id) {
    const [kind, n] = id.split('.');
    const raw = this.readRaw(id);
    const base = { id, kind, slot: Number(n), empty: raw == null, ok: false, error: null, env: null, bytes: raw ? raw.length : 0, memoryOnly: this.memory.has(id) };
    if (raw == null) return { ...base, error: 'empty' };
    // parsing and hashing a save costs milliseconds: remember the result for the exact same text
    const hit = this.parsed.get(id);
    if (hit && hit.raw === raw) return { ...base, ...hit.result };
    let result;
    try {
      result = { ok: true, env: this.parse(raw) };
    } catch (e) {
      result = { error: e.code ?? 'corrupt' };
    }
    this.parsed.set(id, { raw, result });
    return { ...base, ...result };
  }

  /** every slot, autosaves first @returns {SlotInfo[]} */
  list() {
    return SLOT_IDS.map((id) => this.info(id));
  }

  /** readable saves, newest first */
  newestFirst() {
    return this.list().filter((s) => s.ok).sort((a, b) => (b.env.seq - a.env.seq) || (b.env.savedAt - a.env.savedAt));
  }

  // ---- writing -----------------------------------------------------------------------------------------------

  /**
   * Write an envelope of `sim` into slot `id`.
   * @returns {{ ok: boolean, id: string, env: Object, bytes: number, code?: string, message?: string }}
   */
  writeSlot(id, sim) {
    const [kind, n] = id.split('.');
    const seq = this.nextSeq();
    const env = this.envelope(sim, { kind, slot: Number(n), seq });
    const text = JSON.stringify(env);
    const r = this.writeRaw(id, text);
    this.writeIndex(seq);
    if (r.ok) this.lastError = null;
    return { ...r, id, env, bytes: text.length };
  }

  /** the autosave slot the next autosave overwrites: an empty or unreadable one, else the older one */
  nextAutoId() {
    const autos = this.list().filter((s) => s.kind === 'auto');
    const free = autos.find((s) => !s.ok);
    if (free) return free.id;
    return autos.sort((a, b) => a.env.seq - b.env.seq)[0].id;
  }

  /** autosave: rotates between the two autosave slots, so the previous one stays as a backup */
  writeAuto(sim) {
    return this.writeSlot(this.nextAutoId(), sim);
  }

  /** explicit save into manual slot i (0-based) */
  writeManual(i, sim) {
    if (!Number.isInteger(i) || i < 0 || i >= MANUAL_SLOTS) throw new RangeError(`manual slot ${i} does not exist`);
    return this.writeSlot(`manual.${i}`, sim);
  }

  /** delete a slot */
  remove(id) {
    if (!SLOT_IDS.includes(id)) return;
    this.removeRaw(id);
    this.writeIndex(this.readIndex()?.seq ?? 0);
  }

  /** forget every save (Settings: reset all data) */
  clearAll() {
    for (const id of [...SLOT_IDS, 'index']) this.removeRaw(id);
    this.memory.clear();
  }

  // ---- loading -----------------------------------------------------------------------------------------------

  /**
   * Restore a readable envelope.
   * @param {Object} env a parsed envelope
   * @param {{ restore: (snapshot: Object) => Object, mapHash: string }} game Sim.restore with the loaded data, and
   *   the current island's identity (mapHashOf(map))
   * @returns {Object} the Sim
   * @throws {Error} coded: 'map' (the island changed), 'version' (the Sim cannot read the snapshot), 'restore'
   */
  restoreEnvelope(env, { restore, mapHash }) {
    if (env.mapHash !== mapHash || mapHashOf(env.snapshot.map) !== mapHash) throw saveError('map');
    try {
      // a copy: restored systems may keep arrays of the snapshot, and the parsed envelope is cached
      return restore(structuredClone(env.snapshot));
    } catch (e) {
      if (/unsupported snapshot version/.test(e?.message ?? '')) throw saveError('version');
      if (/was made on map/.test(e?.message ?? '')) throw saveError('map');
      throw saveError('restore', e?.message ?? String(e));
    }
  }

  /**
   * Load one slot.
   * @returns {{ ok: true, sim: Object, info: SlotInfo } | { ok: false, code: string, message: string, info: SlotInfo }}
   */
  load(id, game) {
    const info = this.info(id);
    if (!info.ok) return { ok: false, code: info.error, message: SAVE_ERRORS[info.error], info };
    try {
      return { ok: true, sim: this.restoreEnvelope(info.env, game), info };
    } catch (e) {
      return { ok: false, code: e.code ?? 'restore', message: e.message, info };
    }
  }

  /**
   * The newest save that loads (Continue, Retry). Saves that fail on the way are reported in `skipped`, so the
   * player can be told "the newest autosave was damaged; loaded the backup".
   * @returns {{ ok: boolean, sim?: Object, info?: SlotInfo, skipped: Array<{ info: SlotInfo, code: string, message: string }> }}
   */
  loadNewest(game) {
    const skipped = [];
    // unreadable slots with content are failures too (a damaged newest autosave sorts nowhere: say so)
    for (const s of this.list()) if (!s.ok && !s.empty) skipped.push({ info: s, code: s.error, message: SAVE_ERRORS[s.error] });
    for (const s of this.newestFirst()) {
      const r = this.load(s.id, game);
      if (r.ok) return { ok: true, sim: r.sim, info: r.info, skipped };
      skipped.push({ info: s, code: r.code, message: r.message });
    }
    return { ok: false, skipped };
  }

  // ---- export / import ---------------------------------------------------------------------------------------

  /** a slot's text for a file (the stored envelope, unchanged), or null */
  exportText(id) {
    const info = this.info(id);
    return info.ok ? JSON.stringify(info.env) : null;
  }

  /**
   * Check an imported file: readable, on this island, and restorable. Nothing is written.
   * @returns {{ ok: true, env: Object } | { ok: false, code: string, message: string }}
   */
  checkImport(text, game) {
    try {
      const env = this.parse(text);
      this.restoreEnvelope(env, game);
      return { ok: true, env };
    } catch (e) {
      return { ok: false, code: e.code ?? 'corrupt', message: e.code ? e.message : SAVE_ERRORS.corrupt };
    }
  }

  /** write a checked imported envelope into a manual slot (a fresh counter makes it the newest save) */
  importInto(i, env) {
    const id = `manual.${i}`;
    const seq = this.nextSeq();
    const text = JSON.stringify({ ...env, kind: 'manual', slot: i, seq });
    const r = this.writeRaw(id, text);
    this.writeIndex(seq);
    return { ...r, id };
  }
}
