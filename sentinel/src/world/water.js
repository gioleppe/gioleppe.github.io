// How wet a tile is right now: the one notion of water depth that movement (wading, swimming), footprints,
// noise, drowning, the renderer and the audits share. A pure query of the static map and the tide height;
// nothing is stored per tile (spec §5.2: the tide floods and exposes tiles as it moves).
//
//   'deep'     base deep_water at any tide, or a tidal tile the water stands over by more than water.deepMargin
//              (isDeepFlood: the one rule, which movement also uses to decide when a body swims)
//   'shallow'  base shallow_water (unless the tide stands deep over it), or a tidal tile just flooded (wading)
//   'wet'      base wet_sand when not flooded, or a tidal tile within water.wetMargin below its flood threshold
//              (about to flood or just drained)
//   'dry'      everything else
//
// "Flooded" is exactly IslandMap.isFlooded(tx, ty, h): h > floodThreshold(floodLevel(tx, ty)). Out of bounds is
// open sea: 'deep'. With no map (the open test field) everything is 'dry'.
import { TILE_W, TILE_H } from '../sim/constants.js';
import { DEEP_WATER, SHALLOW_WATER, TERRAIN_ID } from './IslandMap.js';

export const WATER_CLASSES = Object.freeze(['dry', 'wet', 'shallow', 'deep']);
const WET_SAND = TERRAIN_ID.wet_sand;

/**
 * Tidal water is deep (a body swims, the renderer draws deep water) once it stands more than water.deepMargin over
 * the tile's flood threshold. Written once, here: collision.js (modeRankAt) and waterClass both ask this.
 * @param {number} depth tide height minus the tile's flood threshold (> 0: flooded)
 * @param {{ deepMargin: number }} cfg tuning.water
 */
export function isDeepFlood(depth, cfg) {
  return depth > cfg.deepMargin;
}

/**
 * The depth class of one tile from its parts (no map needed: tests and the renderer use it directly).
 * @param {number} terrainId index into TERRAINS
 * @param {number} threshold the tile's flood threshold (+Infinity for level 0)
 * @param {number} tideHeight 0..1
 * @param {{ wetMargin: number, deepMargin: number }} cfg tuning.water
 * @returns {'dry'|'wet'|'shallow'|'deep'}
 */
export function waterClass(terrainId, threshold, tideHeight, cfg) {
  if (terrainId === DEEP_WATER) return 'deep';
  // the tide first: shallow-water ground the tide stands deep over is swum (as collision.js modeRankAt has it)
  if (tideHeight > threshold) return isDeepFlood(tideHeight - threshold, cfg) ? 'deep' : 'shallow';
  if (terrainId === SHALLOW_WATER) return 'shallow';
  if (terrainId === WET_SAND || threshold - tideHeight <= cfg.wetMargin) return 'wet';
  return 'dry';
}

/**
 * Depth class of a tile now.
 * @param {import('./IslandMap.js').IslandMap|null} map
 * @param {{ tideHeight: number, waterConfig: { wetMargin: number, deepMargin: number } }} world sim.world
 * @param {number} tx tile column
 * @param {number} ty tile row
 * @returns {'dry'|'wet'|'shallow'|'deep'}
 */
export function waterAt(map, world, tx, ty) {
  if (!map) return 'dry';
  return waterClass(map.terrainIdAt(tx, ty), map.floodThreshold(map.floodLevel(tx, ty)), world.tideHeight, world.waterConfig);
}

/** waterAt for a world point in pixels */
export function waterAtWorld(map, world, x, y) {
  return waterAt(map, world, Math.floor(x / TILE_W), Math.floor(y / TILE_H));
}

/** true where a body would swim rather than wade or walk */
export function isDeep(cls) {
  return cls === 'deep';
}

/** true for wading or swimming depth (the tile is water now) */
export function isWaterClass(cls) {
  return cls === 'shallow' || cls === 'deep';
}

/**
 * How close a tidal tile that is not under water is to its flood threshold: 1 right at it, 0 at wetMargin
 * below it or further, 0 for flooded tiles and tiles that never flood. Drives the renderer's wet darkening.
 * @param {number} threshold
 * @param {number} tideHeight
 * @param {{ wetMargin: number }} cfg
 * @returns {number} 0..1
 */
export function tideWetness(threshold, tideHeight, cfg) {
  if (!(threshold < Infinity) || tideHeight > threshold || cfg.wetMargin <= 0) return 0;
  const v = 1 - (threshold - tideHeight) / cfg.wetMargin;
  return v > 0 ? v : 0;
}
