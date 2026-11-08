/**
 * StateStore.js - reactive pub/sub filter state and cross-filter predicate engine
 * (docs/api_contract.md "js/core/StateStore.js (Phase 2)", guideline sections 6 and 8).
 *
 * The constructor pre-encodes every CanonicalPointRecord into small integer codes held in
 * typed arrays. Each recompute is a single pass over those arrays: the global predicate is
 * evaluated once per point, then the per-view predicates of the cross-filter table are
 * applied and counters are accumulated into preallocated Int32Arrays. The four view models
 * (kpi, court, dag, rally) are then built from those counters.
 *
 * Cross-filter semantics (crossfilter style, each view keeps its own dimension visible):
 *   activePoints / kpi : global filters + brush + all three set selections
 *   court              : global filters + brush + selectedThirdShots (NOT serveDir / returnDepth)
 *   dag                : global filters + brush (NOT node selections)
 *   rally              : global filters + all three set selections (NOT brush)
 *   baseline           : the whole dataset
 * "global filters" = playerFilter, surfaceFilter, eventTierFilter, pressureFilter, serveNumberFilter.
 *
 * Notifications are delivered in commit order: a change dispatched from inside a listener is
 * queued and broadcast after the current broadcast finishes, so every listener's last
 * notification always carries the current snapshot.
 *
 * Runs in plain Node and in the browser: no DOM, no D3, no npm dependencies, no console output.
 *
 * @module StateStore
 */

import { EVENT_TIERS } from "./events.js";
import {
  SERVE_DIRS,
  RETURN_DEPTHS,
  THIRD_SHOTS,
  PRESSURE_STATES,
  SURFACES,
  TERMINAL_OUTCOMES,
  RALLY_CAP,
  validateRecord,
} from "./DataAdapter.js";
import {
  computeWilsonCI,
  summarizeOutcomes,
  computeBarycentricOrder,
  computeDeltaVsBaseline,
  LOW_SAMPLE_THRESHOLD,
} from "./StatsEngine.js";

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} FilterState
 * @property {string} playerFilter             server name or "ALL"
 * @property {string} surfaceFilter            "ALL" | "Hard" | "Clay" | "Grass"
 * @property {string} eventTierFilter          "ALL" | one of events.EVENT_TIERS
 * @property {string} pressureFilter           "ALL" | "Baseline" | "BreakPoint" | "GamePoint" | "Tiebreak"
 * @property {"ALL"|1|2} serveNumberFilter
 * @property {Set<string>} selectedServeDirs   empty = all
 * @property {Set<string>} selectedReturnDepths
 * @property {Set<string>} selectedThirdShots
 * @property {[number, number]} rallyRangeBrush inclusive, RALLY_CAP == "13+"
 * @property {object|null} hoveredElement      transient { view, kind, key, ... } | null
 */

/** Keys whose change triggers a recompute of the DAG barycentric order. */
export const GLOBAL_FILTER_KEYS = Object.freeze([
  "playerFilter", "surfaceFilter", "eventTierFilter", "pressureFilter", "serveNumberFilter",
]);

/** Set-valued selection keys and the vocabulary each one accepts. */
export const SET_FILTER_KEYS = Object.freeze([
  "selectedServeDirs", "selectedReturnDepths", "selectedThirdShots", "selectedCells",
]);

/**
 * Court cell keys "serveDir|returnDepth" (12). `selectedCells` holds an explicit set of them:
 * court clicks select arbitrary groups of boxes, which a serveDir x returnDepth product cannot
 * represent (selecting Wide|Short and T|Deep must not also select Wide|Deep and T|Short).
 */
export const CELL_KEYS = Object.freeze(SERVE_DIRS.flatMap((sd) => RETURN_DEPTHS.map((rd) => `${sd}|${rd}`)));

const SET_ENUMS = Object.freeze({
  selectedServeDirs: SERVE_DIRS,
  selectedReturnDepths: RETURN_DEPTHS,
  selectedThirdShots: THIRD_SHOTS,
  selectedCells: CELL_KEYS,
});

const ALL_FILTER_KEYS = Object.freeze([
  ...GLOBAL_FILTER_KEYS, ...SET_FILTER_KEYS, "rallyRangeBrush", "hoveredElement",
]);

/**
 * Fresh default filter state (new Set instances, new brush array).
 * @returns {FilterState}
 */
export function createInitialFilterState() {
  return {
    playerFilter: "ALL",
    surfaceFilter: "ALL",
    eventTierFilter: "ALL",
    pressureFilter: "ALL",
    serveNumberFilter: "ALL",
    selectedServeDirs: new Set(),
    selectedReturnDepths: new Set(),
    selectedThirdShots: new Set(),
    selectedCells: new Set(),
    rallyRangeBrush: [1, RALLY_CAP],
    hoveredElement: null,
  };
}

/**
 * Default filter state (contract compatibility). The store never mutates this object: it
 * always works on copies produced by createInitialFilterState().
 * @type {FilterState}
 */
export const initialFilterState = createInitialFilterState();

/** Reader-facing node labels (plain language; ids stay the canonical vocabulary). */
export const NODE_LABELS = Object.freeze({
  Wide: "Wide",
  Body: "Body",
  T: "T",
  Shallow: "Short",
  Deep: "Deep",
  VeryDeep: "Very deep",
  Unreturned: "Not returned",
  FH_InsideOut: "Forehand inside-out",
  FH_Cross: "Forehand cross-court",
  BH_Cross: "Backhand cross-court",
  BH_Line: "Backhand down the line",
  Net_Drop: "Volley or drop shot",
  Ace_SvcWin: "Won before a third shot",
  Other: "Other",
});

/** Label of the aggregated layer-3 sink when at least one node was merged into it. */
export const OTHER_SINK_LABEL = "Other shots";
/** Layer-3 nodes with a flow share below this fraction are merged into the "Other" sink. */
export const DAG_MERGE_SHARE = 0.03;
/** Links with n below this fraction of dag.n are flagged pruned (1px wireframe). */
export const DAG_PRUNE_SHARE = 0.01;

const N_SD = SERVE_DIRS.length; // 3
const N_RD = RETURN_DEPTHS.length; // 4
const N_TS = THIRD_SHOTS.length; // 7
const N_E12 = N_SD * N_RD; // 12
const N_E23 = N_RD * N_TS; // 28
const N_PATH = N_SD * N_RD * N_TS; // 84 full serve -> return -> third-shot paths
const N_OUTCOME_CLASSES = 4; // serverWinner, serverInducedErr, returnerWinner, returnerInducedErr
const OTHER_INDEX = THIRD_SHOTS.indexOf("Other");

const now = typeof globalThis.performance === "object" && typeof globalThis.performance.now === "function"
  ? () => globalThis.performance.now()
  : () => Date.now();

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Index lookup for a vocabulary list.
 * @param {string[]} list
 * @returns {Map<string, number>}
 */
function indexMap(list) {
  const m = new Map();
  list.forEach((v, i) => m.set(v, i));
  return m;
}

const SD_INDEX = indexMap(SERVE_DIRS);
const RD_INDEX = indexMap(RETURN_DEPTHS);
const TS_INDEX = indexMap(THIRD_SHOTS);
const CELL_INDEX = indexMap(CELL_KEYS);
const SURFACE_INDEX = indexMap(SURFACES);
const TIER_INDEX = indexMap(EVENT_TIERS);
const TIER_OTHER = TIER_INDEX.get("Other");
const PRESSURE_INDEX = indexMap(PRESSURE_STATES);
const OUTCOME_INDEX = indexMap(TERMINAL_OUTCOMES);

/**
 * Rally bucket label: "1".."12", "13+".
 * @param {number} r
 * @returns {string}
 */
function rallyLabel(r) {
  return r >= RALLY_CAP ? `${RALLY_CAP}+` : String(r);
}

/**
 * Wilson interval without the point estimate (contract ci shape).
 * @param {number} wins
 * @param {number} n
 * @returns {{ low: number, high: number }}
 */
function ciOf(wins, n) {
  const c = computeWilsonCI(wins, n);
  return { low: c.low, high: c.high };
}

/**
 * Win share of a group; NaN for an empty group (nothing to show).
 * @param {number} wins
 * @param {number} n
 * @returns {number}
 */
function rateOf(wins, n) {
  return n > 0 ? wins / n : NaN;
}

/**
 * Set equality by membership.
 * @param {Set<unknown>} a
 * @param {Set<unknown>} b
 * @returns {boolean}
 */
function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * Read-only copy of a Set handed out in snapshots: has / size / iteration work, add / delete /
 * clear throw a TypeError. The prototype stays Set.prototype (deep-equal to a plain Set).
 * @param {Iterable<string>} iterable
 * @returns {Set<string>}
 */
function readonlySet(iterable) {
  const set = new Set(iterable);
  const deny = () => {
    throw new TypeError("snapshot.state Sets are read-only: build a new Set and call setFilter()");
  };
  for (const name of ["add", "delete", "clear"]) {
    Object.defineProperty(set, name, { value: deny, enumerable: false, writable: false, configurable: false });
  }
  return Object.freeze(set);
}

/**
 * Normalize a brush value: clamp both ends to [1, RALLY_CAP], sort ascending.
 * Non-finite ends fall back to the corresponding bound.
 * @param {unknown} range
 * @returns {[number, number]}
 */
function normalizeBrush(range) {
  if (!Array.isArray(range) || range.length < 2) {
    throw new TypeError("rallyRangeBrush must be an array [min, max]");
  }
  const clampR = (v, fallback) => {
    const x = typeof v === "string" ? Number(v) : v;
    if (typeof x !== "number" || !Number.isFinite(x)) return fallback;
    return Math.min(RALLY_CAP, Math.max(1, Math.round(x)));
  };
  let lo = clampR(range[0], 1);
  let hi = clampR(range[1], RALLY_CAP);
  if (lo > hi) [lo, hi] = [hi, lo];
  return [lo, hi];
}

/**
 * Normalize a set-valued selection: accepts a Set, an array or any iterable of strings.
 * Throws on an item outside the dimension vocabulary.
 * @param {string} key
 * @param {unknown} value
 * @returns {Set<string>}
 */
function normalizeSet(key, value) {
  const vocab = SET_ENUMS[key];
  if (value === null || value === undefined) return new Set();
  if (typeof value === "string") value = [value];
  if (typeof value[Symbol.iterator] !== "function") {
    throw new TypeError(`${key} must be a Set, an array or an iterable of strings`);
  }
  const out = new Set();
  for (const item of value) {
    if (!vocab.includes(item)) {
      throw new RangeError(`${key}: "${String(item)}" is not one of ${vocab.join("|")}`);
    }
    out.add(item);
  }
  return out;
}

/**
 * Validate / coerce one filter value. Throws on an unknown key or an invalid value.
 * @param {string} key
 * @param {unknown} value
 * playerFilter accepts any string (an unknown player simply matches no point).
 * @returns {unknown} normalized value
 */
function normalizeFilterValue(key, value) {
  switch (key) {
    case "playerFilter": {
      if (value === null || value === undefined || value === "") return "ALL";
      if (typeof value !== "string") throw new TypeError("playerFilter must be a string");
      return value;
    }
    case "surfaceFilter": {
      if (value === null || value === undefined || value === "ALL" || value === "") return "ALL";
      if (!SURFACES.includes(value)) throw new RangeError(`surfaceFilter must be ALL|${SURFACES.join("|")}`);
      return value;
    }
    case "eventTierFilter": {
      if (value === null || value === undefined || value === "ALL" || value === "") return "ALL";
      if (!EVENT_TIERS.includes(value)) throw new RangeError(`eventTierFilter must be ALL|${EVENT_TIERS.join("|")}`);
      return value;
    }
    case "pressureFilter": {
      if (value === null || value === undefined || value === "ALL" || value === "") return "ALL";
      if (!PRESSURE_STATES.includes(value)) {
        throw new RangeError(`pressureFilter must be ALL|${PRESSURE_STATES.join("|")}`);
      }
      return value;
    }
    case "serveNumberFilter": {
      if (value === null || value === undefined || value === "ALL" || value === "") return "ALL";
      const n = typeof value === "string" ? Number(value.trim()) : value;
      if (n !== 1 && n !== 2) throw new RangeError("serveNumberFilter must be ALL, 1 or 2");
      return n;
    }
    case "selectedServeDirs":
    case "selectedReturnDepths":
    case "selectedThirdShots":
    case "selectedCells":
      return normalizeSet(key, value);
    case "rallyRangeBrush":
      return normalizeBrush(value);
    case "hoveredElement":
      return value === undefined ? null : value;
    default:
      throw new RangeError(`Unknown filter key "${String(key)}"`);
  }
}

/**
 * Whether two normalized filter values are equal (no-op detection).
 * @param {string} key
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function filterValuesEqual(key, a, b) {
  if (SET_FILTER_KEYS.includes(key)) return setsEqual(a, b);
  if (key === "rallyRangeBrush") return a[0] === b[0] && a[1] === b[1];
  return a === b;
}

// ---------------------------------------------------------------------------
// Query-string (de)serialization
// ---------------------------------------------------------------------------

const QUERY_KEYS = Object.freeze({
  playerFilter: "player",
  surfaceFilter: "surface",
  eventTierFilter: "event",
  pressureFilter: "pressure",
  serveNumberFilter: "serve",
  selectedServeDirs: "serveDirs",
  selectedReturnDepths: "returnDepths",
  selectedThirdShots: "thirdShots",
  selectedCells: "cells",
  rallyRangeBrush: "rally",
});

/**
 * Encode the persistent part of a filter state (hoveredElement excluded) as a URL-sharable
 * query string: `key=value` pairs joined by "&", Sets as comma lists, brush as "a-b".
 * Only values differing from the defaults are emitted; the empty string means "defaults".
 * Keys: player, surface, event, pressure, serve, serveDirs, returnDepths, thirdShots, rally.
 *
 * @param {Partial<FilterState>} state
 * @returns {string}
 */
export function encodeFilterStateToQuery(state) {
  const s = state && typeof state === "object" ? state : {};
  const parts = [];
  const push = (key, value) => parts.push(`${QUERY_KEYS[key]}=${encodeURIComponent(value)}`);

  for (const key of GLOBAL_FILTER_KEYS) {
    const v = s[key];
    if (v === undefined || v === null || v === "ALL" || v === "") continue;
    push(key, String(v));
  }
  for (const key of SET_FILTER_KEYS) {
    const v = s[key];
    if (!v) continue;
    const items = [...v].filter((x) => SET_ENUMS[key].includes(x));
    // Deterministic order: vocabulary order.
    items.sort((a, b) => SET_ENUMS[key].indexOf(a) - SET_ENUMS[key].indexOf(b));
    if (items.length > 0) push(key, items.join(","));
  }
  const brush = s.rallyRangeBrush;
  if (Array.isArray(brush) && brush.length >= 2) {
    const [lo, hi] = normalizeBrush(brush);
    if (lo !== 1 || hi !== RALLY_CAP) push("rallyRangeBrush", `${lo}-${hi}`);
  }
  return parts.join("&");
}

/**
 * Decode a query string produced by encodeFilterStateToQuery (a leading "?" or "#" is
 * tolerated) into a complete fresh FilterState. Unknown keys and invalid values are
 * ignored (invalid Set items are dropped individually); hoveredElement is always null.
 *
 * @param {string} str
 * @returns {FilterState}
 */
export function decodeFilterStateFromQuery(str) {
  const state = createInitialFilterState();
  if (typeof str !== "string") return state;
  let q = str.trim();
  if (q.startsWith("?") || q.startsWith("#")) q = q.slice(1);
  if (q.length === 0) return state;

  const keyOf = new Map(Object.entries(QUERY_KEYS).map(([k, v]) => [v, k]));
  const decode = (v) => {
    try { return decodeURIComponent(v.replace(/\+/g, " ")); } catch { return null; }
  };

  for (const pair of q.split("&")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const key = keyOf.get(decode(pair.slice(0, eq)));
    const raw = decode(pair.slice(eq + 1));
    if (!key || raw === null) continue;

    if (SET_FILTER_KEYS.includes(key)) {
      const vocab = SET_ENUMS[key];
      const items = raw.split(",").map((x) => x.trim()).filter((x) => vocab.includes(x));
      state[key] = new Set(items);
    } else if (key === "rallyRangeBrush") {
      const m = /^(\d+)\s*-\s*(\d+)$/.exec(raw.trim());
      if (m) state[key] = normalizeBrush([Number(m[1]), Number(m[2])]);
    } else {
      try {
        state[key] = normalizeFilterValue(key, raw);
      } catch {
        /* invalid value: keep the default */
      }
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// StateStore
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} StoreChange
 * @property {"init"|"filter"|"reset"|"hover"} type
 * @property {string[]} keys   filter keys whose value changed (empty for "init")
 */

/**
 * @typedef {Object} Snapshot
 * @property {FilterState} state            frozen copy shared by every consumer of this snapshot:
 *   the Sets are read-only copies (add/delete/clear throw) and the brush array is frozen
 * @property {ReadonlyArray<object>} activePoints  frozen records passing all filters
 * @property {object} baseline              summarizeOutcomes over the whole dataset
 * @property {{ kpi: object, court: object, dag: object, rally: object }} viewModels
 * @property {{ filterMs: number }} timing
 */

/**
 * Reactive pub/sub store holding the filter state, the encoded dataset and the memoized
 * cross-filtered view models.
 */
export class StateStore {
  /**
   * @param {ReadonlyArray<object>} points  CanonicalPointRecord[] (records are frozen; an unfrozen
   *   record is replaced by a frozen shallow copy). Every record is validated with validateRecord()
   *   and a TypeError is thrown on the first invalid one.
   * @param {object} [options] reserved, no options yet
   */
  constructor(points, options = {}) {
    if (!Array.isArray(points)) throw new TypeError("StateStore: points must be an array");
    const opts = options && typeof options === "object" ? options : {};
    /** Last error thrown by a subscriber (swallowed so other listeners still run). @type {Error|null} */
    this.lastListenerError = null;

    this._encode(points);

    /** @type {FilterState} */
    this._state = createInitialFilterState();
    /** @type {Set<Function>} */
    this._listeners = new Set();
    this._snapshot = null;
    /** @type {{ l2: string[], l3: string[] }|null} cached barycentric layer orders */
    this._layerOrder = null;
    /** @type {StoreChange[]} changes waiting to be broadcast (re-entrant dispatch) */
    this._pending = [];
    this._notifying = false;
    this._allocateCounters();
    const baseline = summarizeOutcomes(this._points);
    this._baseline = Object.freeze({
      ...baseline,
      ci: Object.freeze({ ...baseline.ci }),
    });
    this._recompute(true);
  }

  // ---- encoding -----------------------------------------------------------

  /**
   * Validate and encode the records into typed arrays.
   * @param {ReadonlyArray<object>} points
   * @private
   */
  _encode(points) {
    const n = points.length;
    const frozen = new Array(n);
    const playerNames = new Set();
    for (let i = 0; i < n; i += 1) {
      const rec = points[i];
      const check = validateRecord(rec);
      if (!check.ok) {
        throw new TypeError(`StateStore: invalid record at index ${i}: ${check.errors.join("; ")}`);
      }
      frozen[i] = Object.isFrozen(rec) ? rec : Object.freeze({ ...rec });
      playerNames.add(rec.serverName);
    }
    /** @type {string[]} */
    this._players = [...playerNames].sort();
    const playerIndex = indexMap(this._players);

    this._n = n;
    this._points = Object.freeze(frozen);
    this._sdC = new Uint8Array(n);
    this._rdC = new Uint8Array(n);
    this._tsC = new Uint8Array(n);
    this._rlC = new Uint8Array(n); // clamped to RALLY_CAP
    this._rlRaw = new Float64Array(n); // raw (uncapped, exact) rally length for meanRally
    this._wonC = new Uint8Array(n);
    this._outC = new Uint8Array(n); // terminal outcome index
    this._clsC = new Uint8Array(n); // outcome class 0..3 (see contract rally shape)
    this._surfC = new Uint8Array(n);
    this._tierC = new Uint8Array(n); // event tier index (records without a tier count as "Other")
    const tiersPresent = new Set();
    this._presC = new Uint8Array(n);
    this._snC = new Uint8Array(n); // 1 | 2
    this._plC = new Int32Array(n);

    for (let i = 0; i < n; i += 1) {
      const r = frozen[i];
      this._sdC[i] = SD_INDEX.get(r.serveDirection);
      this._rdC[i] = RD_INDEX.get(r.returnDepth);
      this._tsC[i] = TS_INDEX.get(r.thirdShotArchetype);
      this._rlC[i] = r.rallyLength >= RALLY_CAP ? RALLY_CAP : r.rallyLength;
      this._rlRaw[i] = r.rallyLength;
      const won = r.serverWon ? 1 : 0;
      this._wonC[i] = won;
      const out = OUTCOME_INDEX.get(r.terminalOutcome);
      this._outC[i] = out;
      // 0 serverWinner, 1 serverInducedErr, 2 returnerWinner, 3 returnerInducedErr
      this._clsC[i] = won ? (out === 0 ? 0 : 1) : (out === 0 ? 2 : 3);
      this._surfC[i] = SURFACE_INDEX.get(r.surface);
      const tier = TIER_INDEX.get(r.eventTier);
      this._tierC[i] = tier === undefined ? TIER_OTHER : tier;
      tiersPresent.add(EVENT_TIERS[this._tierC[i]]);
      this._presC[i] = PRESSURE_INDEX.get(r.pressureState);
      this._snC[i] = r.serveNumber;
      this._plC[i] = playerIndex.get(r.serverName);
    }
    /** @type {string[]} tiers with at least one point, in EVENT_TIERS order */
    this._tiers = EVENT_TIERS.filter((t) => tiersPresent.has(t));
  }

  /** Preallocate every counter used by _recompute. @private */
  _allocateCounters() {
    this._courtN = new Int32Array(N_E12);
    this._courtW = new Int32Array(N_E12);
    this._pathN = new Int32Array(N_PATH); // dag predicate (global + brush), full paths
    this._pathW = new Int32Array(N_PATH);
    this._gE12 = new Int32Array(N_E12); // global-filtered flow (barycentric order)
    this._gE23 = new Int32Array(N_E23);
    this._rallyC = new Int32Array(RALLY_CAP * N_OUTCOME_CLASSES);
    // Rally context: global filters only (no set selection, no brush), per bucket n and wins.
    this._rallyCtxN = new Int32Array(RALLY_CAP);
    this._rallyCtxW = new Int32Array(RALLY_CAP);
    this._surfMask = new Uint8Array(SURFACES.length);
    this._tierMask = new Uint8Array(EVENT_TIERS.length);
    this._presMask = new Uint8Array(PRESSURE_STATES.length);
    this._snMask = new Uint8Array(3);
    this._sdMask = new Uint8Array(N_SD);
    this._rdMask = new Uint8Array(N_RD);
    this._tsMask = new Uint8Array(N_TS);
    this._cellMask = new Uint8Array(N_E12);
  }

  // ---- public API ---------------------------------------------------------

  /**
   * Frozen copy of the filter state: the Sets are read-only copies (add/delete/clear throw) and
   * the brush array is frozen, so no consumer can corrupt what another one sees.
   * @returns {FilterState}
   */
  getState() {
    return StateStore._copyState(this._state);
  }

  /**
   * @param {FilterState} s
   * @returns {FilterState}
   * @private
   */
  static _copyState(s) {
    return Object.freeze({
      playerFilter: s.playerFilter,
      surfaceFilter: s.surfaceFilter,
      eventTierFilter: s.eventTierFilter,
      pressureFilter: s.pressureFilter,
      serveNumberFilter: s.serveNumberFilter,
      selectedServeDirs: readonlySet(s.selectedServeDirs),
      selectedReturnDepths: readonlySet(s.selectedReturnDepths),
      selectedThirdShots: readonlySet(s.selectedThirdShots),
      selectedCells: readonlySet(s.selectedCells),
      rallyRangeBrush: Object.freeze([s.rallyRangeBrush[0], s.rallyRangeBrush[1]]),
      hoveredElement: s.hoveredElement,
    });
  }

  /**
   * Set one filter. Unknown keys throw; serveNumberFilter "1"/"2" strings are coerced to
   * numbers; Set keys accept a Set / array / iterable (items outside the vocabulary throw);
   * rallyRangeBrush is clamped and sorted. A value equal to the current one is a no-op
   * (no recompute, no notification). hoveredElement is routed to setHovered().
   * @param {string} key
   * @param {unknown} value
   */
  setFilter(key, value) {
    this.setFilters({ [key]: value });
  }

  /**
   * Batch update: every key is validated first (an unknown key or invalid value throws before
   * anything is applied), then changed keys are applied, the view models are recomputed once
   * and subscribers are notified once with change.type "filter". A patch that only changes
   * hoveredElement notifies with type "hover" and does not recompute.
   * @param {Partial<FilterState>} patch
   */
  setFilters(patch) {
    if (patch === null || typeof patch !== "object") throw new TypeError("setFilters: patch must be an object");
    const normalized = [];
    for (const key of Object.keys(patch)) {
      const value = normalizeFilterValue(key, patch[key]);
      if (!filterValuesEqual(key, value, this._state[key])) normalized.push([key, value]);
    }
    if (normalized.length === 0) return;
    this._applyChanges(normalized, "filter");
  }

  /**
   * Apply already-normalized changes, recompute if needed, notify once.
   * @param {Array<[string, unknown]>} changes
   * @param {"filter"|"reset"} type
   * @private
   */
  _applyChanges(changes, type) {
    const keys = [];
    let globalChanged = false;
    let needRecompute = false;
    for (const [key, value] of changes) {
      this._state[key] = value;
      keys.push(key);
      if (key !== "hoveredElement") needRecompute = true;
      if (GLOBAL_FILTER_KEYS.includes(key)) globalChanged = true;
    }
    if (needRecompute) {
      this._recompute(globalChanged);
      this._notify({ type, keys });
    } else {
      this._refreshSnapshotState();
      this._notify({ type: type === "reset" ? "reset" : "hover", keys });
    }
  }

  /**
   * Toggle an item in one of the three set selections. Throws on an unknown setKey or an
   * item outside that dimension's vocabulary. Always notifies (the set always changes).
   *
   * Clicking the DAG's aggregated "Other" sink (toggleSetItem("selectedThirdShots", "Other")
   * while viewModels.dag.mergedIds is non-empty) toggles the whole sink as one category: "Other"
   * plus every currently merged member id are added together when any of them is missing and
   * removed together when all are present, so activePoints / kpi / court / rally are filtered
   * to exactly the flow the sink displays. The stored state stays a literal subset of the
   * vocabulary (URL-serializable, independent of later brush changes).
   * @param {"selectedServeDirs"|"selectedReturnDepths"|"selectedThirdShots"} setKey
   * @param {string} item
   */
  toggleSetItem(setKey, item) {
    if (!SET_FILTER_KEYS.includes(setKey)) {
      throw new RangeError(`toggleSetItem: "${String(setKey)}" is not one of ${SET_FILTER_KEYS.join("|")}`);
    }
    if (!SET_ENUMS[setKey].includes(item)) {
      throw new RangeError(`toggleSetItem: "${String(item)}" is not one of ${SET_ENUMS[setKey].join("|")}`);
    }
    const group = setKey === "selectedThirdShots" && item === "Other"
      ? ["Other", ...this._snapshot.viewModels.dag.mergedIds]
      : [item];
    const next = new Set(this._state[setKey]);
    const allPresent = group.every((id) => next.has(id));
    for (const id of group) {
      if (allPresent) next.delete(id);
      else next.add(id);
    }
    this._applyChanges([[setKey, next]], "filter");
  }

  /**
   * Set the rally brush; clamps both ends to [1, RALLY_CAP] and sorts them. No-op when unchanged.
   * @param {[number, number]} range
   */
  setRallyRange(range) {
    this.setFilter("rallyRangeBrush", range);
  }

  /**
   * Update the transient hover state without recomputing; notifies with change.type "hover".
   * No-op when the same reference is set again.
   * @param {object|null} el
   */
  setHovered(el) {
    const value = el === undefined ? null : el;
    if (value === this._state.hoveredElement) return;
    this._applyChanges([["hoveredElement", value]], "filter");
  }

  /**
   * Restore every filter (hoveredElement included) to its default with fresh Sets. Notifies
   * once with change.type "reset" listing the keys that actually changed; no-op when the
   * state already equals the defaults.
   */
  resetFilters() {
    const defaults = createInitialFilterState();
    const changes = [];
    for (const key of ALL_FILTER_KEYS) {
      if (!filterValuesEqual(key, defaults[key], this._state[key])) changes.push([key, defaults[key]]);
    }
    if (changes.length === 0) return;
    this._applyChanges(changes, "reset");
  }

  /**
   * Subscribe to store changes. The listener is invoked synchronously once right away with
   * the current snapshot and { type: "init", keys: [] }, then after every change as
   * listener(snapshot, change). A throwing listener never breaks the others: the error is
   * swallowed and stored in store.lastListenerError.
   *
   * Delivery semantics: a change dispatched from inside a listener (re-entrant setFilter /
   * setHovered / ...) is applied to the store immediately but its broadcast is queued until the
   * current broadcast has reached every listener, so listeners always receive notifications in
   * commit order and the last one they receive carries the current snapshot. unsubscribe() takes
   * effect immediately, even in the middle of a broadcast: a listener removed by an earlier
   * listener of the same broadcast is not invoked.
   * @param {(snapshot: Snapshot, change: StoreChange) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("subscribe: listener must be a function");
    this._listeners.add(listener);
    this._invoke(listener, this.getSnapshot(), { type: "init", keys: [] });
    return () => { this._listeners.delete(listener); };
  }

  /**
   * Memoized snapshot: the same object is returned until the next recompute or hover change.
   * On a hover change only `state` is replaced; activePoints, baseline and viewModels keep
   * their identity so views can skip work.
   * @returns {Snapshot}
   */
  getSnapshot() {
    return this._snapshot;
  }

  /** @returns {ReadonlyArray<object>} frozen records passing all filters */
  getActivePoints() {
    return this._snapshot.activePoints;
  }

  /**
   * The whole (unfiltered) dataset. Used by consumers that compare the active subset with a
   * reference group computed live, e.g. the story headlines.
   * @returns {ReadonlyArray<object>} frozen array of frozen records
   */
  getAllPoints() {
    return this._points;
  }

  /** @returns {string[]} sorted unique server names (fresh array) */
  /**
   * Event tiers present in the dataset, in EVENT_TIERS order.
   * @returns {string[]}
   */
  getEventTiers() {
    return [...this._tiers];
  }

  getPlayers() {
    return this._players.slice();
  }

  /** @returns {object} summarizeOutcomes over the whole dataset (computed once) */
  getBaseline() {
    return this._baseline;
  }

  // ---- notification -------------------------------------------------------

  /**
   * @param {Function} listener
   * @param {Snapshot} snapshot
   * @param {StoreChange} change
   * @private
   */
  _invoke(listener, snapshot, change) {
    try {
      listener(snapshot, change);
    } catch (err) {
      this.lastListenerError = err instanceof Error ? err : new Error(String(err));
    }
  }

  /**
   * @param {StoreChange} change
   * @private
   */
  _notify(change) {
    this._pending.push(Object.freeze({ type: change.type, keys: Object.freeze(change.keys.slice()) }));
    if (this._notifying) return; // re-entrant dispatch: broadcast after the current one finishes
    this._notifying = true;
    try {
      while (this._pending.length > 0) {
        const next = this._pending.shift();
        const snapshot = this._snapshot;
        for (const listener of [...this._listeners]) {
          if (!this._listeners.has(listener)) continue; // unsubscribed during this broadcast
          this._invoke(listener, snapshot, next);
        }
      }
    } finally {
      this._notifying = false;
    }
  }

  /** Replace only snapshot.state (hover change). @private */
  _refreshSnapshotState() {
    this._snapshot = Object.freeze({ ...this._snapshot, state: StateStore._copyState(this._state) });
  }

  // ---- recompute ----------------------------------------------------------

  /**
   * Fill a 0/1 mask from a global filter value.
   * @param {Uint8Array} mask
   * @param {Map<string, number>} index
   * @param {string} value
   * @private
   */
  static _fillMask(mask, index, value) {
    if (value === "ALL") { mask.fill(1); return; }
    mask.fill(0);
    const i = index.get(value);
    if (i !== undefined) mask[i] = 1;
  }

  /**
   * Fill a 0/1 mask from a set selection (empty set = all).
   * @param {Uint8Array} mask
   * @param {Map<string, number>} index
   * @param {Set<string>} selection
   * @private
   */
  static _fillSetMask(mask, index, selection) {
    if (selection.size === 0) { mask.fill(1); return; }
    mask.fill(0);
    for (const item of selection) {
      const i = index.get(item);
      if (i !== undefined) mask[i] = 1;
    }
  }

  /**
   * Single pass over the encoded points: evaluates the global predicate once per point, then
   * the per-view predicates (court: + brush + thirdShot selection; dag: + brush; rally:
   * + all three selections; active: everything) and accumulates typed counters. Then builds
   * the view models and the memoized snapshot.
   * @param {boolean} globalChanged  when true the DAG barycentric order is recomputed from the
   *   global-filtered flow; otherwise the cached order is reused (mental-map preservation)
   * @private
   */
  _recompute(globalChanged) {
    const t0 = now();
    const s = this._state;
    const n = this._n;

    const playerIdx = s.playerFilter === "ALL" ? -1 : this._players.indexOf(s.playerFilter);
    const playerMiss = s.playerFilter !== "ALL" && playerIdx < 0; // unknown player => nothing passes
    StateStore._fillMask(this._surfMask, SURFACE_INDEX, s.surfaceFilter);
    StateStore._fillMask(this._tierMask, TIER_INDEX, s.eventTierFilter);
    StateStore._fillMask(this._presMask, PRESSURE_INDEX, s.pressureFilter);
    this._snMask.fill(0);
    if (s.serveNumberFilter === "ALL") { this._snMask[1] = 1; this._snMask[2] = 1; } else this._snMask[s.serveNumberFilter] = 1;
    StateStore._fillSetMask(this._sdMask, SD_INDEX, s.selectedServeDirs);
    StateStore._fillSetMask(this._rdMask, RD_INDEX, s.selectedReturnDepths);
    StateStore._fillSetMask(this._tsMask, TS_INDEX, s.selectedThirdShots);
    StateStore._fillSetMask(this._cellMask, CELL_INDEX, s.selectedCells);
    const lo = s.rallyRangeBrush[0];
    const hi = s.rallyRangeBrush[1];

    const courtN = this._courtN.fill(0);
    const courtW = this._courtW.fill(0);
    const pathN = this._pathN.fill(0);
    const pathW = this._pathW.fill(0);
    const rallyC = this._rallyC.fill(0);
    const rallyCtxN = this._rallyCtxN.fill(0);
    const rallyCtxW = this._rallyCtxW.fill(0);
    const needOrder = globalChanged || this._layerOrder === null;
    const gE12 = this._gE12;
    const gE23 = this._gE23;
    if (needOrder) { gE12.fill(0); gE23.fill(0); }

    const { _sdC: sdC, _rdC: rdC, _tsC: tsC, _rlC: rlC, _rlRaw: rlRaw, _wonC: wonC, _clsC: clsC,
      _surfC: surfC, _tierC: tierC, _presC: presC, _snC: snC, _plC: plC, _points: points,
      _surfMask: surfMask, _tierMask: tierMask, _presMask: presMask, _snMask: snMask,
      _sdMask: sdMask, _rdMask: rdMask, _tsMask: tsMask, _cellMask: cellMask } = this;

    const active = [];
    let kpiN = 0;
    let kpiW = 0;
    let rallySum = 0;
    let killNum = 0;
    let killDen = 0;

    if (!playerMiss) {
      for (let i = 0; i < n; i += 1) {
        if (surfMask[surfC[i]] === 0 || tierMask[tierC[i]] === 0 || presMask[presC[i]] === 0 || snMask[snC[i]] === 0) continue;
        if (playerIdx >= 0 && plC[i] !== playerIdx) continue;
        // --- global predicate passed ---
        const sd = sdC[i];
        const rd = rdC[i];
        const ts = tsC[i];
        const rl = rlC[i];
        const w = wonC[i];
        const e12 = sd * N_RD + rd;
        if (needOrder) { gE12[e12] += 1; gE23[rd * N_TS + ts] += 1; }

        rallyCtxN[rl - 1] += 1; rallyCtxW[rl - 1] += w; // rally context: no selection, no brush
        const selOk = sdMask[sd] === 1 && rdMask[rd] === 1 && tsMask[ts] === 1 && cellMask[e12] === 1;
        if (selOk) rallyC[(rl - 1) * N_OUTCOME_CLASSES + clsC[i]] += 1; // rally: no brush

        if (rl < lo || rl > hi) continue;
        // --- brush passed: dag (full path counter; node and link counts derive from it) ---
        const path = e12 * N_TS + ts;
        pathN[path] += 1; pathW[path] += w;
        if (tsMask[ts] === 1) { courtN[e12] += 1; courtW[e12] += w; } // court: + thirdShot selection
        if (selOk) {
          active.push(points[i]);
          kpiN += 1; kpiW += w;
          rallySum += rlRaw[i];
          if (rl >= 3) { killDen += 1; if (rl === 3) killNum += w; }
        }
      }
    }

    if (needOrder) this._layerOrder = this._computeLayerOrder();

    const viewModels = Object.freeze({
      kpi: this._buildKpi(kpiN, kpiW, rallySum, killNum, killDen),
      court: this._buildCourt(),
      dag: this._buildDag(),
      rally: this._buildRally(),
    });

    this._snapshot = Object.freeze({
      state: StateStore._copyState(s),
      activePoints: Object.freeze(active),
      baseline: this._baseline,
      viewModels,
      timing: Object.freeze({ filterMs: now() - t0 }),
    });
  }

  /**
   * Barycentric order of layers 2 and 3 from the global-filtered flow. Layer 1 keeps the
   * fixed order Wide, Body, T (y = index); layer 2 is ordered by the barycenter of layer 1;
   * layer 3 by the barycenter of layer 2 using the ordered layer-2 ranks as y.
   * @returns {{ l2: string[], l3: string[] }}
   * @private
   */
  _computeLayerOrder() {
    const links12 = [];
    for (let sd = 0; sd < N_SD; sd += 1) {
      for (let rd = 0; rd < N_RD; rd += 1) {
        const v = this._gE12[sd * N_RD + rd];
        if (v > 0) links12.push({ source: SERVE_DIRS[sd], target: RETURN_DEPTHS[rd], value: v });
      }
    }
    const layer1 = SERVE_DIRS.map((id, y) => ({ id, y }));
    const l2 = computeBarycentricOrder(layer1, RETURN_DEPTHS.map((id) => ({ id })), links12);

    const links23 = [];
    for (let rd = 0; rd < N_RD; rd += 1) {
      for (let ts = 0; ts < N_TS; ts += 1) {
        const v = this._gE23[rd * N_TS + ts];
        if (v > 0) links23.push({ source: RETURN_DEPTHS[rd], target: THIRD_SHOTS[ts], value: v });
      }
    }
    const layer2 = l2.map((id, y) => ({ id, y }));
    const l3 = computeBarycentricOrder(layer2, THIRD_SHOTS.map((id) => ({ id })), links23);
    return { l2, l3 };
  }

  /**
   * KPI strip model. thirdShotKillRate = P(rallyLength === 3 && serverWon | rallyLength >= 3),
   * 0 when the denominator is 0; thirdShotKillN is that denominator (points with
   * rallyLength >= 3) and thirdShotKillWins the numerator. meanRally uses raw (uncapped)
   * rally lengths like the baseline; NaN when n = 0.
   * @private
   */
  _buildKpi(n, wins, rallySum, killNum, killDen) {
    const kpi = {
      n,
      wins,
      rawRate: n > 0 ? wins / n : NaN,
      ci: Object.freeze(ciOf(wins, n)),
      thirdShotKillRate: killDen > 0 ? killNum / killDen : 0,
      thirdShotKillN: killDen,
      thirdShotKillWins: killNum,
      meanRally: n > 0 ? rallySum / n : NaN,
      deltaVsBaseline: NaN,
    };
    kpi.deltaVsBaseline = computeDeltaVsBaseline(kpi, this._baseline);
    return Object.freeze(kpi);
  }

  /**
   * Court lattice model: 12 cells (3 serveDirs x 4 returnDepths, the "Unreturned" lane
   * included). A cell is `selected` when at least one of selectedServeDirs /
   * selectedReturnDepths is non-empty and the cell matches every non-empty one.
   * @private
   */
  _buildCourt() {
    const s = this._state;
    const sdSel = s.selectedServeDirs;
    const rdSel = s.selectedReturnDepths;
    const cellSel = s.selectedCells;
    const hasSelection = sdSel.size > 0 || rdSel.size > 0 || cellSel.size > 0;
    let total = 0;
    for (let i = 0; i < N_E12; i += 1) total += this._courtN[i];
    const cells = [];
    for (let sd = 0; sd < N_SD; sd += 1) {
      for (let rd = 0; rd < N_RD; rd += 1) {
        const k = sd * N_RD + rd;
        const n = this._courtN[k];
        const wins = this._courtW[k];
        const serveDir = SERVE_DIRS[sd];
        const returnDepth = RETURN_DEPTHS[rd];
        cells.push(Object.freeze({
          key: `${serveDir}|${returnDepth}`,
          serveDir,
          returnDepth,
          n,
          wins,
          rawRate: n > 0 ? wins / n : NaN,
          ci: Object.freeze(ciOf(wins, n)),
          volumeShare: total > 0 ? n / total : 0,
          lowSample: n < LOW_SAMPLE_THRESHOLD,
          selected: hasSelection
            && (sdSel.size === 0 || sdSel.has(serveDir))
            && (rdSel.size === 0 || rdSel.has(returnDepth))
            && (cellSel.size === 0 || cellSel.has(`${serveDir}|${returnDepth}`)),
        }));
      }
    }
    return Object.freeze({ n: total, hasSelection, cells: Object.freeze(cells) });
  }

  /**
   * Tactical DAG model.
   *
   * Nodes: layer 1 (serve directions), layer 2 (return depths), layer 3 (third-shot
   * archetypes). Node and link counts are derived from the full-path counters
   * (serveDir x returnDepth x thirdShot) accumulated over the DAG predicate (global filters +
   * brush). Layer-3 nodes other than "Other" whose share (n / dag.n) is below DAG_MERGE_SHARE,
   * empty nodes included, are merged into the "Other" sink (id "Other", aggregated: true, label
   * OTHER_SINK_LABEL, `members` listing the merged ids) together with their E23 links,
   * conserving n and wins; when nothing is merged the natural "Other" node keeps label "Other"
   * and aggregated: false. When dag.n is 0 shares are undefined and nothing is merged, so the
   * complete node structure stays visible.
   *
   * `order` is the barycentric vertical rank within the layer, taken from the cached order
   * computed on the global-filtered flow (recomputed only when a global filter changes) and
   * compacted to 0..k-1 over the nodes present, so merging never reorders surviving nodes.
   *
   * Links: E12 (serveDir -> returnDepth) and E23 (returnDepth -> thirdShot) with n > 0;
   * `pruned` when n < DAG_PRUNE_SHARE * dag.n. Every node and link also carries `nActive`
   * (links: `winsActive` too): the flow restricted to the points passing ALL node selections,
   * i.e. the active set. Guideline 6.2 asks View 2 to "recompute DAG edge widths strictly for
   * points passing through [a clicked court cell]" while fading non-intersecting ribbons: views
   * draw the context ribbon (n) faded and the emphasized ribbon at width nActive on top.
   *
   * Emphasis rule ("ribbons intersecting the selection are emphasized, others faded"): when no
   * node selection exists (all three sets empty) hasSelection is false and every link has
   * emphasized === false. Otherwise a link is emphasized iff at least one point flowing through
   * it belongs to the active set, i.e. passes all three selections (serveDir, returnDepth and
   * third shot; an empty selection matches everything) on top of the DAG predicate. The full
   * path counters make this exact: an E12 ribbon (sd -> rd) is emphasized only when some
   * sd -> rd -> ts path with a selected ts exists, and an E23 ribbon (rd -> ts) only when some
   * selected sd feeds it, so the active path can be traced upstream and downstream. Merged
   * members contribute their flow to the sink's ribbons. Node `selected` is a membership test
   * on the node's own dimension; the aggregated sink is selected when the selection contains
   * "Other" or any merged member id.
   * @private
   */
  _buildDag() {
    const s = this._state;
    const sdSel = s.selectedServeDirs;
    const rdSel = s.selectedReturnDepths;
    const tsSel = s.selectedThirdShots;
    const hasSelection = sdSel.size > 0 || rdSel.size > 0 || tsSel.size > 0 || s.selectedCells.size > 0;
    const cellMask = this._cellMask;
    const pathN = this._pathN;
    const pathW = this._pathW;
    const sdMask = this._sdMask; // selection masks, empty selection = all ones (filled by _recompute)
    const rdMask = this._rdMask;
    const tsMask = this._tsMask;

    // Node and link counters derived from the path counters.
    const n1 = new Int32Array(N_SD); const w1 = new Int32Array(N_SD);
    const n2 = new Int32Array(N_RD); const w2 = new Int32Array(N_RD);
    const n3 = new Int32Array(N_TS); const w3 = new Int32Array(N_TS);
    const e12N = new Int32Array(N_E12); const e12W = new Int32Array(N_E12);
    const e23N = new Int32Array(N_E23); const e23W = new Int32Array(N_E23);
    let total = 0;
    for (let sd = 0; sd < N_SD; sd += 1) {
      for (let rd = 0; rd < N_RD; rd += 1) {
        const e12 = sd * N_RD + rd;
        for (let ts = 0; ts < N_TS; ts += 1) {
          const c = pathN[e12 * N_TS + ts];
          if (c === 0) continue;
          const w = pathW[e12 * N_TS + ts];
          const e23 = rd * N_TS + ts;
          n1[sd] += c; w1[sd] += w;
          n2[rd] += c; w2[rd] += w;
          n3[ts] += c; w3[ts] += w;
          e12N[e12] += c; e12W[e12] += w;
          e23N[e23] += c; e23W[e23] += w;
          total += c;
        }
      }
    }

    // Layer-3 merge into the "Other" sink (share < DAG_MERGE_SHARE, empty nodes included).
    const mergedInto = new Int32Array(N_TS); // natural index -> effective index
    const members = [];
    for (let ts = 0; ts < N_TS; ts += 1) {
      mergedInto[ts] = ts;
      if (ts === OTHER_INDEX || total === 0) continue;
      if (n3[ts] / total < DAG_MERGE_SHARE) { mergedInto[ts] = OTHER_INDEX; members.push(THIRD_SHOTS[ts]); }
    }
    const aggregated = members.length > 0;
    const n3m = new Int32Array(N_TS); const w3m = new Int32Array(N_TS);
    for (let ts = 0; ts < N_TS; ts += 1) { n3m[mergedInto[ts]] += n3[ts]; w3m[mergedInto[ts]] += w3[ts]; }
    const otherSelected = tsSel.has("Other") || members.some((id) => tsSel.has(id));
    /** Node membership test for an effective (post-merge) layer-3 index. */
    const tsMatches = (ts) => (ts === OTHER_INDEX && aggregated ? otherSelected : tsSel.has(THIRD_SHOTS[ts]));

    // Active flow per link (ribbon emphasis): points passing all three selections, i.e. the
    // active set restricted to this ribbon. e12Flow[sd,rd]; e23Flow[rd,ts*] with ts* effective
    // (merged members summed into the sink).
    const e12Flow = new Int32Array(N_E12); const e12FlowW = new Int32Array(N_E12);
    const e23Flow = new Int32Array(N_E23); const e23FlowW = new Int32Array(N_E23);
    const n1a = new Int32Array(N_SD); const n2a = new Int32Array(N_RD); const n3a = new Int32Array(N_TS);
    for (let sd = 0; sd < N_SD; sd += 1) {
      if (sdMask[sd] === 0) continue;
      for (let rd = 0; rd < N_RD; rd += 1) {
        if (rdMask[rd] === 0) continue;
        const e12 = sd * N_RD + rd;
        if (cellMask[e12] === 0) continue;
        for (let ts = 0; ts < N_TS; ts += 1) {
          if (tsMask[ts] === 0) continue;
          const c = pathN[e12 * N_TS + ts];
          if (c === 0) continue;
          const w = pathW[e12 * N_TS + ts];
          const tsm = mergedInto[ts];
          e12Flow[e12] += c; e12FlowW[e12] += w;
          e23Flow[rd * N_TS + tsm] += c; e23FlowW[rd * N_TS + tsm] += w;
          n1a[sd] += c; n2a[rd] += c; n3a[tsm] += c;
        }
      }
    }

    // Orders (cached, compacted to present nodes).
    const order = this._layerOrder;
    const rank2 = new Map(order.l2.map((id, i) => [id, i]));
    const present3 = order.l3.filter((id) => mergedInto[TS_INDEX.get(id)] === TS_INDEX.get(id));
    const rank3 = new Map(present3.map((id, i) => [id, i]));

    const share = (v) => (total > 0 ? v / total : 0);
    const nodes = [];
    for (let sd = 0; sd < N_SD; sd += 1) {
      const id = SERVE_DIRS[sd];
      nodes.push(Object.freeze({
        id, layer: 1, label: NODE_LABELS[id], n: n1[sd], wins: w1[sd], rawRate: rateOf(w1[sd], n1[sd]),
        share: share(n1[sd]), nActive: n1a[sd], order: sd, selected: sdSel.has(id), aggregated: false,
      }));
    }
    for (let rd = 0; rd < N_RD; rd += 1) {
      const id = RETURN_DEPTHS[rd];
      nodes.push(Object.freeze({
        id, layer: 2, label: NODE_LABELS[id], n: n2[rd], wins: w2[rd], rawRate: rateOf(w2[rd], n2[rd]),
        share: share(n2[rd]), nActive: n2a[rd], order: rank2.get(id), selected: rdSel.has(id), aggregated: false,
      }));
    }
    for (let ts = 0; ts < N_TS; ts += 1) {
      if (mergedInto[ts] !== ts) continue;
      const id = THIRD_SHOTS[ts];
      const isSink = ts === OTHER_INDEX && aggregated;
      nodes.push(Object.freeze({
        id, layer: 3, label: isSink ? OTHER_SINK_LABEL : NODE_LABELS[id], n: n3m[ts], wins: w3m[ts],
        rawRate: rateOf(w3m[ts], n3m[ts]), share: share(n3m[ts]), nActive: n3a[ts], order: rank3.get(id),
        selected: tsMatches(ts), aggregated: isSink,
        members: isSink ? Object.freeze(members.slice()) : Object.freeze([]),
      }));
    }

    const pruneBelow = DAG_PRUNE_SHARE * total;
    const links = [];
    for (let sd = 0; sd < N_SD; sd += 1) {
      for (let rd = 0; rd < N_RD; rd += 1) {
        const k = sd * N_RD + rd;
        const ln = e12N[k];
        if (ln === 0) continue;
        const source = SERVE_DIRS[sd];
        const target = RETURN_DEPTHS[rd];
        links.push(Object.freeze({
          source, target, layerPair: "12", n: ln, wins: e12W[k], rawRate: rateOf(e12W[k], ln),
          share: share(ln), pruned: ln < pruneBelow,
          nActive: e12Flow[k], winsActive: e12FlowW[k],
          emphasized: hasSelection && e12Flow[k] > 0,
        }));
      }
    }
    // E23 with merged targets (conserving totals).
    const m23N = new Int32Array(N_E23); const m23W = new Int32Array(N_E23);
    for (let rd = 0; rd < N_RD; rd += 1) {
      for (let ts = 0; ts < N_TS; ts += 1) {
        const k = rd * N_TS + ts;
        const mk = rd * N_TS + mergedInto[ts];
        m23N[mk] += e23N[k]; m23W[mk] += e23W[k];
      }
    }
    for (let rd = 0; rd < N_RD; rd += 1) {
      for (let ts = 0; ts < N_TS; ts += 1) {
        if (mergedInto[ts] !== ts) continue;
        const k = rd * N_TS + ts;
        const ln = m23N[k];
        if (ln === 0) continue;
        const source = RETURN_DEPTHS[rd];
        const target = THIRD_SHOTS[ts];
        links.push(Object.freeze({
          source, target, layerPair: "23", n: ln, wins: m23W[k], rawRate: rateOf(m23W[k], ln),
          share: share(ln), pruned: ln < pruneBelow,
          nActive: e23Flow[k], winsActive: e23FlowW[k],
          emphasized: hasSelection && e23Flow[k] > 0,
        }));
      }
    }

    return Object.freeze({
      n: total,
      hasSelection,
      aggregated,
      mergedIds: Object.freeze(members.slice()),
      nodes: Object.freeze(nodes),
      links: Object.freeze(links),
    });
  }

  /**
   * Rally horizon model: 13 buckets (r = 1..RALLY_CAP, the last one "13+"), no brush
   * applied; `inBrush` marks the brushed range. wins = serverWinner + serverInducedErr.
   * contextN / contextWins / contextRate (raw) are the same bucket under the global filters
   * only (no set selection): View 3 draws them as a reference line when hasSelection is true.
   * @private
   */
  _buildRally() {
    const [lo, hi] = this._state.rallyRangeBrush;
    const c = this._rallyC;
    const s = this._state;
    const hasSelection = s.selectedServeDirs.size > 0 || s.selectedReturnDepths.size > 0 || s.selectedThirdShots.size > 0
      || s.selectedCells.size > 0;
    const buckets = [];
    let total = 0;
    for (let r = 1; r <= RALLY_CAP; r += 1) {
      const base = (r - 1) * N_OUTCOME_CLASSES;
      const serverWinner = c[base];
      const serverInducedErr = c[base + 1];
      const returnerWinner = c[base + 2];
      const returnerInducedErr = c[base + 3];
      const wins = serverWinner + serverInducedErr;
      const n = wins + returnerWinner + returnerInducedErr;
      total += n;
      buckets.push(Object.freeze({
        r,
        label: rallyLabel(r),
        n,
        serverWinner,
        serverInducedErr,
        returnerWinner,
        returnerInducedErr,
        wins,
        rawRate: n > 0 ? wins / n : NaN,
        ci: Object.freeze(ciOf(wins, n)),
        inBrush: r >= lo && r <= hi,
        contextN: this._rallyCtxN[r - 1],
        contextWins: this._rallyCtxW[r - 1],
        contextRate: this._rallyCtxN[r - 1] > 0 ? this._rallyCtxW[r - 1] / this._rallyCtxN[r - 1] : NaN,
      }));
    }
    return Object.freeze({
      n: total,
      hasSelection,
      brush: Object.freeze([lo, hi]),
      buckets: Object.freeze(buckets),
      pairs: Object.freeze(pairBuckets(buckets, lo, hi)),
    });
  }
}

/**
 * Rally-length pairs drawn by View 3: [1-2], [3-4], ..., [11-12], [13+].
 * MCP counts the final error as a shot, so odd lengths end on the server's shot and even
 * lengths on the returner's: the exact-length win rate zig-zags for recording reasons alone.
 * Pairing one odd with one even length removes that artefact (guideline section 4.3).
 * @param {ReadonlyArray<object>} buckets exact-length buckets (r = 1..RALLY_CAP)
 * @param {number} lo brush start
 * @param {number} hi brush end
 * @returns {object[]}
 */
export function pairBuckets(buckets, lo, hi) {
  const out = [];
  for (let start = 1; start <= RALLY_CAP; start += 2) {
    const end = Math.min(start + 1, RALLY_CAP);
    const members = buckets.filter((b) => b.r >= start && (start === RALLY_CAP ? true : b.r <= end));
    const sum = (key) => members.reduce((acc, b) => acc + b[key], 0);
    const n = sum("n");
    const wins = sum("wins");
    const contextN = sum("contextN");
    const contextWins = sum("contextWins");
    out.push(Object.freeze({
      r: start,
      lo: start,
      hi: end,
      label: start >= RALLY_CAP ? `${RALLY_CAP}+` : `${start}–${end}`,
      n,
      wins,
      serverWinner: sum("serverWinner"),
      serverInducedErr: sum("serverInducedErr"),
      returnerWinner: sum("returnerWinner"),
      returnerInducedErr: sum("returnerInducedErr"),
      rawRate: n > 0 ? wins / n : NaN,
      ci: Object.freeze(ciOf(wins, n)),
      inBrush: start <= hi && end >= lo,
      contextN,
      contextWins,
      contextRate: contextN > 0 ? contextWins / contextN : NaN,
    }));
  }
  return out;
}

/**
 * Filter patch for a click on court cell `key`: the boxes currently selected (as the court shows
 * them) with `key` added or removed, written back in the simplest form. A selection that is a
 * full product of serve directions x return depths (a row, a column, a block) is stored as
 * `selectedServeDirs` / `selectedReturnDepths` (empty = all), so the flow chart keeps marking those
 * nodes; any other group of boxes is stored as `selectedCells`. Removing the last box clears the
 * court selection. Third-shot selections are left untouched.
 *
 * Examples: row Short (3 boxes) minus T|Short -> Wide|Short + Body|Short, not two whole columns;
 * Wide|Short then T|Deep -> exactly those two boxes, not the 2 x 2 block.
 * @param {object} state  store.getState()
 * @param {string} key    "serveDir|returnDepth"
 * @returns {{ selectedServeDirs: Set<string>, selectedReturnDepths: Set<string>, selectedCells: Set<string> }}
 */
export function courtCellToggle(state, key) {
  if (!CELL_KEYS.includes(key)) throw new RangeError(`courtCellToggle: unknown cell "${String(key)}"`);
  const S = state.selectedServeDirs || new Set();
  const R = state.selectedReturnDepths || new Set();
  const C = state.selectedCells || new Set();
  const hasSelection = S.size > 0 || R.size > 0 || C.size > 0;
  const current = new Set(hasSelection ? CELL_KEYS.filter((k) => {
    const [sd, rd] = k.split("|");
    return (S.size === 0 || S.has(sd)) && (R.size === 0 || R.has(rd)) && (C.size === 0 || C.has(k));
  }) : []);
  if (current.has(key)) current.delete(key); else current.add(key);

  const empty = { selectedServeDirs: new Set(), selectedReturnDepths: new Set(), selectedCells: new Set() };
  if (current.size === 0 || current.size === CELL_KEYS.length) return empty;
  const sds = new Set([...current].map((k) => k.split("|")[0]));
  const rds = new Set([...current].map((k) => k.split("|")[1]));
  if (sds.size * rds.size === current.size) {
    return {
      selectedServeDirs: sds.size === SERVE_DIRS.length ? new Set() : sds,
      selectedReturnDepths: rds.size === RETURN_DEPTHS.length ? new Set() : rds,
      selectedCells: new Set(),
    };
  }
  return { ...empty, selectedCells: current };
}
