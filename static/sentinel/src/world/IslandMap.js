// The handcrafted island (spec §5) as the simulation sees it: decoded once from data/island_map.json into typed
// arrays, then answered by O(1), allocation-free queries. Data and queries only: movement, collision and the tide
// clock are other systems that ask this one.
//
// ---- data/island_map.json (format version 2) --------------------------------------------------------------------
// Baked by `node tools/map/build.mjs <name>` from tools/map/sources/<name>.src.mjs; never edited by hand
// (`build.mjs --check` fails when the JSON and its source disagree). Checked by tools/lib/validate-map.mjs.
//
// {
//   "format": "sentinel-island-map", "version": 2, "name": "sample",
//   "width": 48, "height": 40,                 tiles; a tile is TILE_W x TILE_H = 32 x 24 world px
//   "tile": [32, 24],                          informational, must equal the constants
//   "legend": {                                one character per value, never a digit
//     "terrain":   { "s": "sand", "w": "wet_sand", "h": "shallow_water", "d": "deep_water",
//                    "j": "jungle_floor", "m": "mud", "r": "reef_rock", "b": "basalt" },
//     "collision": { ".": 0, "#": 1 },         1 = impassable (cliff, dense trunks, hull); NOT water depth
//     "tide":      { ".": 0, "a": 1, ..., "i": 9 },   flood level, see below
//     "region":    { ".": "open_sea", "c": "southern_cove", ... }   must include open_sea
//     "sector":    { ".": null, "s": "south_beach", ... }            beach sectors; null = none
//   },
//   "layers": {                                one string per row (north first), run-length encoded:
//     "terrain": ["d12h3s20..."], ...          a legend character + optional count ("d12" = 12 deep water)
//     "collision": [...], "tide": [...], "region": [...],
//     "sector": [...]                          optional (absent = no sectors)
//   },
// Regions of the island: southern_cove, western_mangroves, reef, shipwreck, interior_jungle, quiet_meridian,
// signal_peak, coast (beaches outside the cove), open_sea. A beach sector is the stretch of coast a coastal
// offering at its border totem clears of patrols (spec §7.3); routes and totems name theirs.
//   "anomalyZones": [ { "id": "meridian", "strength": 1, "points": [[x, y], ...] } ],   world px, >= 3 points
//   "entities": [ { "id": "...", "type": "...", ... }, ... ]     one per line, ids unique across the file
//   "propSets": [                              scattered scenery, compact: one line per set
//     { "id": "banyan", "kind": "banyan", "blocker"?: true, "cover"?: true, "radius"?, "coverRadius"?,
//       "variant"?: "0210...",                 one digit per prop
//       "xy": [x0, y0, x1, y1, ...] }          world px; prop n (1-based) has id "<set id>_<n>"
//   ]
// }
//
// Entity types (x, y are world px of the ground point; every entity has a stable unique `id`):
//   spawn          { x, y, facing? }                                 exactly one: the player's start (facing N/E/S/W)
//   prop           { kind, x, y, radius?, cover?, coverRadius?, variant?, blocker? }
//                  kind = a sprite kind of assets/manifest.json. radius (collision) and coverRadius default to
//                  tuning.props[kind].radius / .coverRadius. cover: true = hides a crouched player (spec §6.1).
//                  blocker: true = this prop is what makes its tile blocked (allowed on a collision tile).
//   landmark       { name, x, y, region }                            named place (journal, teleport, audits)
//   loot           { item, x, y, container? }                        container = id of a landmark or interactable
//   npc            { npc: 'marek'|'gatherer'|'scout', x, y, route? } scouts name their patrol_route
//   patrol_route   { mode: 'loop'|'pingpong', sector?, points: [[x, y], ...] }   sector = beach sector id
//   totem          { kind: 'totem', x, y, sector? }                  border totem; sector it can clear
//   spring         { x, y }                                          fresh water
//   interactable   { action, x, y, kind?, landmark? }                dinghy, hatch, signal_point, ...
// Any entity with a `kind` is scenery drawn by the renderer and becomes a sim prop (same id).
//
// Tide: the tide clock (step 2.4) gives a height h in 0..1 (0 = lowest, 1 = highest). A tile of flood level L
// is under water when h > tuning.tide.floodThresholds[L - 1]; level 0 never floods. The thresholds fall as L
// rises, so level 9 is the lowest ground (almost always wet) and level 1 floods only at the top of high tide.
//
// Out of bounds every query answers "open sea": deep water, not blocked, flood level 9 and always flooded,
// region open_sea, no sector, no anomaly. Queries never throw.
//
// Loot items are ids of data/items.json.
import { TILE_W, TILE_H } from '../sim/constants.js';
import { hashSeed } from '../sim/rng.js';
import { decodeLayer } from './mapCodec.js';

export const MAP_FORMAT = 'sentinel-island-map';
export const MAP_VERSION = 2;

/** terrain names in their fixed internal order (terrainIdAt returns these indices) */
export const TERRAINS = Object.freeze(['sand', 'wet_sand', 'shallow_water', 'deep_water', 'jungle_floor', 'mud', 'reef_rock', 'basalt']);
export const TERRAIN_ID = Object.freeze(Object.fromEntries(TERRAINS.map((t, i) => [t, i])));
export const DEEP_WATER = TERRAIN_ID.deep_water;
export const SHALLOW_WATER = TERRAIN_ID.shallow_water;

export const ENTITY_TYPES = Object.freeze(['spawn', 'prop', 'landmark', 'loot', 'npc', 'patrol_route', 'totem', 'spring', 'interactable']);
export const NPC_KINDS = Object.freeze(['marek', 'gatherer', 'scout']);
export const ROUTE_MODES = Object.freeze(['loop', 'pingpong']);
export const MAX_FLOOD_LEVEL = 9;
export const OPEN_SEA = 'open_sea';

/** fixed legends of the collision and tide layers */
export const COLLISION_LEGEND = Object.freeze({ '.': 0, '#': 1 });
export const TIDE_LEGEND = Object.freeze({ '.': 0, a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 });

/** side of a prop index cell in world px */
const PROP_CELL = 64;
const EMPTY = Object.freeze([]);

/**
 * Even-odd point-in-polygon test.
 * @param {number} x
 * @param {number} y
 * @param {ArrayLike<number>} flat polygon as x0, y0, x1, y1, ...
 */
export function pointInPolygon(x, y, flat) {
  let inside = false;
  const n = flat.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = flat[i];
    const yi = flat[i + 1];
    const xj = flat[j];
    const yj = flat[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Flood thresholds by level from tuning: index 0 is +Infinity (never floods), 1..9 from tuning.tide.floodThresholds.
 * @param {Object} [tuning]
 * @returns {Float64Array}
 */
export function floodThresholdTable(tuning) {
  const src = tuning?.tide?.floodThresholds;
  if (!Array.isArray(src) || src.length !== MAX_FLOOD_LEVEL) throw new Error(`IslandMap: tuning.tide.floodThresholds must list ${MAX_FLOOD_LEVEL} numbers`);
  const t = new Float64Array(MAX_FLOOD_LEVEL + 1);
  t[0] = Infinity;
  for (let i = 0; i < MAX_FLOOD_LEVEL; i++) t[i + 1] = src[i];
  return t;
}

const lookupOf = (legend, toValue) => {
  const m = new Map();
  for (const [ch, v] of Object.entries(legend ?? {})) m.set(ch, toValue(v, ch));
  return m;
};

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

export class IslandMap {
  /**
   * Decode a map. Throws on a map whose layers cannot be decoded (the validator reports the details).
   * @param {Object} json contents of data/island_map.json
   * @param {Object} tuning the whole tuning object (tide thresholds, default prop radii)
   * @returns {IslandMap}
   */
  static fromJSON(json, tuning) {
    return new IslandMap(json, tuning);
  }

  constructor(json, tuning) {
    if (!json || json.format !== MAP_FORMAT) throw new Error(`IslandMap: not a ${MAP_FORMAT} file`);
    if (json.version !== MAP_VERSION) throw new Error(`IslandMap: unsupported version ${json.version}`);
    const { width, height } = json;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('IslandMap: bad width/height');
    this.width = width;
    this.height = height;
    this.version = json.version;
    this.name = json.name ?? '';
    /** content hash (FNV-1a of the JSON text as parsed); snapshots carry it to refuse a save made on another map */
    this.hash = hashSeed(JSON.stringify(json)).toString(16).padStart(8, '0');
    /** world rectangle in px */
    this.bounds = Object.freeze({ x: 0, y: 0, w: width * TILE_W, h: height * TILE_H });

    const legend = json.legend ?? {};
    const L = json.layers ?? {};
    const terrainLookup = lookupOf(legend.terrain, (name, ch) => {
      if (!(name in TERRAIN_ID)) throw new Error(`IslandMap: legend.terrain "${ch}" is unknown terrain "${name}"`);
      return TERRAIN_ID[name];
    });
    /** region names by id, in legend order */
    this.regionNames = Object.freeze(Object.values(legend.region ?? {}));
    const openSea = this.regionNames.indexOf(OPEN_SEA);
    if (openSea < 0) throw new Error('IslandMap: legend.region must include open_sea');
    this.openSeaRegion = openSea;
    const regionLookup = lookupOf(legend.region, (name) => this.regionNames.indexOf(name));

    this.terrain = decodeLayer(L.terrain, terrainLookup, width, height, 'terrain');
    this.collision = decodeLayer(L.collision, lookupOf(COLLISION_LEGEND, (v) => v), width, height, 'collision');
    this.tide = decodeLayer(L.tide, lookupOf(TIDE_LEGEND, (v) => v), width, height, 'tide');
    this.region = decodeLayer(L.region, regionLookup, width, height, 'region');
    // beach sectors (optional layer): null = not a beach sector
    const sectorLegend = legend.sector ?? { '.': null };
    /** sector names by id, null for "none" */
    this.sectorNames = Object.freeze(Object.values(sectorLegend));
    this.noSector = Math.max(0, this.sectorNames.indexOf(null));
    this.sector = L.sector
      ? decodeLayer(L.sector, lookupOf(sectorLegend, (name) => this.sectorNames.indexOf(name)), width, height, 'sector')
      : new Uint8Array(width * height).fill(this.noSector);
    this.floodThresholds = floodThresholdTable(tuning);

    /** anomaly zones with flat point arrays and bounding boxes */
    this.anomalyZones = Object.freeze((json.anomalyZones ?? []).map((z) => {
      const flat = new Float64Array(z.points.length * 2);
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      z.points.forEach(([x, y], i) => {
        flat[i * 2] = x; flat[i * 2 + 1] = y;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      });
      return Object.freeze({ id: z.id, strength: z.strength, points: deepFreeze(z.points.map((p) => [p[0], p[1]])), flat, minX, minY, maxX, maxY });
    }));

    const propCfg = tuning?.props ?? {};
    const named = (json.entities ?? []).map((e) => {
      const out = { ...e };
      if (typeof e.kind === 'string') {
        out.radius = e.radius ?? propCfg[e.kind]?.radius ?? 0;
        if (e.cover) out.coverRadius = e.coverRadius ?? propCfg[e.kind]?.coverRadius ?? 0;
      }
      return deepFreeze(out);
    });
    // scattered props, stored compactly per set, become ordinary prop entities with ids <set id>_<n>
    const scattered = [];
    for (const set of json.propSets ?? []) {
      const radius = set.radius ?? propCfg[set.kind]?.radius ?? 0;
      const coverRadius = set.cover ? set.coverRadius ?? propCfg[set.kind]?.coverRadius ?? 0 : undefined;
      for (let i = 0, n = set.xy.length >> 1; i < n; i++) {
        const p = { id: `${set.id}_${i + 1}`, type: 'prop', kind: set.kind, x: set.xy[i * 2], y: set.xy[i * 2 + 1], radius };
        if (set.cover) { p.cover = true; p.coverRadius = coverRadius; }
        if (set.variant) p.variant = set.variant.charCodeAt(i) - 48;
        if (set.blocker) p.blocker = true;
        scattered.push(Object.freeze(p));
      }
    }
    /** every entity, frozen: the named ones in file order, then the scattered props set by set */
    this.entities = Object.freeze(named.concat(scattered));
    this.idIndex = new Map();
    this.typeIndex = new Map();
    for (const e of this.entities) {
      this.idIndex.set(e.id, e);
      if (!this.typeIndex.has(e.type)) this.typeIndex.set(e.type, []);
      this.typeIndex.get(e.type).push(e);
    }
    for (const [k, list] of this.typeIndex) this.typeIndex.set(k, Object.freeze(list));

    const sp = this.entitiesOfType('spawn')[0];
    /** the player's start in world px */
    this.spawn = Object.freeze(sp ? { x: sp.x, y: sp.y, facing: sp.facing ?? 'S' } : { x: this.bounds.w / 2, y: this.bounds.h / 2, facing: 'S' });

    /** scenery the renderer draws and later systems collide with / hide in: every entity with a `kind` */
    this.props = Object.freeze(this.entities.filter((e) => typeof e.kind === 'string'));
    this.buildPropIndex();
  }

  // ---- tiles ------------------------------------------------------------------------------------------------

  inBounds(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height && (tx | 0) === tx && (ty | 0) === ty;
  }

  /** tile column of a world x (may be out of bounds) */
  tileX(x) { return Math.floor(x / TILE_W); }
  /** tile row of a world y */
  tileY(y) { return Math.floor(y / TILE_H); }
  /** world x of a tile column's centre */
  tileCenterX(tx) { return (tx + 0.5) * TILE_W; }
  /** world y of a tile row's centre */
  tileCenterY(ty) { return (ty + 0.5) * TILE_H; }

  /** @returns {number} index into TERRAINS */
  terrainIdAt(tx, ty) {
    return this.inBounds(tx, ty) ? this.terrain[ty * this.width + tx] : DEEP_WATER;
  }

  /** @returns {string} terrain name */
  terrainAt(tx, ty) {
    return TERRAINS[this.terrainIdAt(tx, ty)];
  }

  terrainAtWorld(x, y) {
    return TERRAINS[this.terrainIdAt(Math.floor(x / TILE_W), Math.floor(y / TILE_H))];
  }

  /** true for shallow or deep water terrain */
  isWater(tx, ty) {
    const t = this.terrainIdAt(tx, ty);
    return t === DEEP_WATER || t === SHALLOW_WATER;
  }

  /** impassable by the collision layer; deep water is not "blocked" (it is swum) */
  isBlocked(tx, ty) {
    return this.inBounds(tx, ty) ? this.collision[ty * this.width + tx] === 1 : false;
  }

  isBlockedWorld(x, y) {
    return this.isBlocked(Math.floor(x / TILE_W), Math.floor(y / TILE_H));
  }

  /** 0 (never floods) .. 9 (lowest ground) */
  floodLevel(tx, ty) {
    return this.inBounds(tx, ty) ? this.tide[ty * this.width + tx] : MAX_FLOOD_LEVEL;
  }

  /** tide height below which a level never floods: +Infinity for 0 */
  floodThreshold(level) {
    return this.floodThresholds[level];
  }

  /**
   * @param {number} tideHeight 0 (lowest) .. 1 (highest), from the tide clock
   * @returns {boolean} the tile is under the tide right now
   */
  isFlooded(tx, ty, tideHeight) {
    if (!this.inBounds(tx, ty)) return true;
    return tideHeight > this.floodThresholds[this.tide[ty * this.width + tx]];
  }

  isFloodedWorld(x, y, tideHeight) {
    return this.isFlooded(Math.floor(x / TILE_W), Math.floor(y / TILE_H), tideHeight);
  }

  /** @returns {number} index into regionNames */
  regionIdAt(tx, ty) {
    return this.inBounds(tx, ty) ? this.region[ty * this.width + tx] : this.openSeaRegion;
  }

  /** @returns {string} region name */
  regionAt(tx, ty) {
    return this.regionNames[this.regionIdAt(tx, ty)];
  }

  regionAtWorld(x, y) {
    return this.regionNames[this.regionIdAt(Math.floor(x / TILE_W), Math.floor(y / TILE_H))];
  }

  /** @returns {string|null} the beach sector of a tile (the unit a coastal offering clears), or null */
  sectorAt(tx, ty) {
    return this.inBounds(tx, ty) ? this.sectorNames[this.sector[ty * this.width + tx]] ?? null : null;
  }

  sectorAtWorld(x, y) {
    return this.sectorAt(Math.floor(x / TILE_W), Math.floor(y / TILE_H));
  }

  // ---- anomaly zones -----------------------------------------------------------------------------------------

  /** strength of the strongest anomaly zone containing the world point, 0 outside all zones */
  anomalyAt(x, y) {
    let best = 0;
    for (let i = 0; i < this.anomalyZones.length; i++) {
      const z = this.anomalyZones[i];
      if (z.strength > best && x >= z.minX && x <= z.maxX && y >= z.minY && y <= z.maxY && pointInPolygon(x, y, z.flat)) best = z.strength;
    }
    return best;
  }

  /** the strongest zone containing the point, or null */
  anomalyZoneAt(x, y) {
    let best = null;
    for (const z of this.anomalyZones) {
      if ((!best || z.strength > best.strength) && x >= z.minX && x <= z.maxX && y >= z.minY && y <= z.maxY && pointInPolygon(x, y, z.flat)) best = z;
    }
    return best;
  }

  // ---- entities ----------------------------------------------------------------------------------------------

  /** @returns {ReadonlyArray<Object>} the entities of a type in file order (empty for none) */
  entitiesOfType(type) {
    return this.typeIndex.get(type) ?? EMPTY;
  }

  /** @returns {Object|null} */
  byId(id) {
    return this.idIndex.get(id) ?? null;
  }

  /** @returns {Object|null} the landmark with this id */
  landmark(id) {
    const e = this.idIndex.get(id);
    return e && e.type === 'landmark' ? e : null;
  }

  // ---- prop spatial index -----------------------------------------------------------------------------------

  buildPropIndex() {
    const cols = Math.max(1, Math.ceil(this.bounds.w / PROP_CELL));
    const rows = Math.max(1, Math.ceil(this.bounds.h / PROP_CELL));
    const count = new Int32Array(cols * rows + 1);
    const cellOf = new Int32Array(this.props.length);
    let reach = 0;
    this.props.forEach((p, i) => {
      const cx = Math.min(cols - 1, Math.max(0, Math.floor(p.x / PROP_CELL)));
      const cy = Math.min(rows - 1, Math.max(0, Math.floor(p.y / PROP_CELL)));
      cellOf[i] = cy * cols + cx;
      count[cellOf[i] + 1]++;
      reach = Math.max(reach, p.radius ?? 0, p.coverRadius ?? 0);
    });
    for (let c = 0; c < cols * rows; c++) count[c + 1] += count[c];
    const items = new Int32Array(this.props.length);
    const fill = count.slice(0, cols * rows);
    for (let i = 0; i < this.props.length; i++) items[fill[cellOf[i]]++] = i;
    this.propCols = cols;
    this.propRows = rows;
    this.propCellStart = count;
    this.propCellItems = items;
    /** largest collision or cover radius of any prop: add it to a query radius to find every overlapping prop */
    this.maxPropReach = reach;
  }

  /**
   * Props whose ground point lies within `r` of (x, y), in index order. Allocation-free when `out` is reused.
   * @param {number} x
   * @param {number} y
   * @param {number} r world px
   * @param {Object[]} [out] cleared and filled
   * @returns {Object[]} out
   */
  propsNear(x, y, r, out = []) {
    out.length = 0;
    const r2 = r * r;
    const c0 = Math.max(0, Math.floor((x - r) / PROP_CELL));
    const r0 = Math.max(0, Math.floor((y - r) / PROP_CELL));
    const c1 = Math.min(this.propCols - 1, Math.floor((x + r) / PROP_CELL));
    const r1 = Math.min(this.propRows - 1, Math.floor((y + r) / PROP_CELL));
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const cell = cy * this.propCols + cx;
        for (let k = this.propCellStart[cell]; k < this.propCellStart[cell + 1]; k++) {
          const p = this.props[this.propCellItems[k]];
          const dx = p.x - x;
          const dy = p.y - y;
          if (dx * dx + dy * dy <= r2) out.push(p);
        }
      }
    }
    return out;
  }

  /**
   * Props whose ground point lies in the world rectangle [x0, x1] x [y0, y1].
   * @param {Object[]} [out] cleared and filled
   */
  propsInRect(x0, y0, x1, y1, out = []) {
    out.length = 0;
    const c0 = Math.max(0, Math.floor(x0 / PROP_CELL));
    const r0 = Math.max(0, Math.floor(y0 / PROP_CELL));
    const c1 = Math.min(this.propCols - 1, Math.floor(x1 / PROP_CELL));
    const r1 = Math.min(this.propRows - 1, Math.floor(y1 / PROP_CELL));
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const cell = cy * this.propCols + cx;
        for (let k = this.propCellStart[cell]; k < this.propCellStart[cell + 1]; k++) {
          const p = this.props[this.propCellItems[k]];
          if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) out.push(p);
        }
      }
    }
    return out;
  }
}
