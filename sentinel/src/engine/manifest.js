// Structural check of assets/manifest.json (format documented at the top of AssetManager.js) and the animation
// fallback rule. Pure and DOM-free: the page uses it to drop bad entries, tools/validate-data.mjs to fail the check.

export const FACINGS = Object.freeze(['N', 'E', 'S', 'W']);

const TOP_KEYS = new Set(['$comment', 'sheets', 'sprites', 'tiles', 'icons']);
const SHEET_KEYS = new Set(['image', 'data', 'ready']);
const SPRITE_KEYS = new Set(['sheet', 'states', 'facings', 'mirrorW', 'frame', 'anchor', 'shadow']);
const TILE_KEYS = new Set(['sheet', 'frames']);
const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
// relative, forward slashes, no way out of assets/
const FILE = /^(?!\/)(?!.*\.\.)(?!.*\\)[^:]+\.(png|json)$/i;

/**
 * @typedef {{ image: string, data: string, ready: boolean }} SheetEntry
 * @typedef {{ sheet: string, states: string[], facings: string[], mirrorW: boolean, frame: string|null,
 *             anchor: [number, number], shadow: number|null }} SpriteEntry
 * @typedef {{ sheet: string, frames: string[] }} TileEntry
 * @typedef {{ sheets: Map<string, SheetEntry>, sprites: Map<string, SpriteEntry>, tiles: Map<string, TileEntry>,
 *             icons: Map<string, string[]> }} Manifest
 */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Check a parsed manifest and return the usable part of it. Never throws: every problem becomes a message and
 * the entry it concerns is left out, so the game draws placeholders for exactly that entry.
 * @param {unknown} json
 * @returns {{ errors: string[], manifest: Manifest }}
 */
export function checkManifest(json) {
  const errors = [];
  const manifest = { sheets: new Map(), sprites: new Map(), tiles: new Map(), icons: new Map() };
  if (!isObj(json)) return { errors: ['manifest: expected a JSON object'], manifest };
  for (const k of Object.keys(json)) if (!TOP_KEYS.has(k)) errors.push(`manifest: unknown key "${k}"`);

  const section = (key) => {
    if (json[key] === undefined) return [];
    if (!isObj(json[key])) { errors.push(`manifest.${key}: expected an object`); return []; }
    return Object.entries(json[key]);
  };
  const unknownKeys = (where, v, allowed) => {
    let ok = true;
    for (const k of Object.keys(v)) if (!allowed.has(k)) { errors.push(`${where}: unknown key "${k}"`); ok = false; }
    return ok;
  };
  const badName = (where, name) => {
    if (NAME.test(name)) return false;
    errors.push(`${where}: "${name}" is not a valid name (letters, digits, _ . -)`);
    return true;
  };
  /** a list of distinct non-empty strings */
  const nameList = (where, v, { allowEmpty = false } = {}) => {
    if (!Array.isArray(v) || (!allowEmpty && v.length === 0) || v.some((s) => typeof s !== 'string' || s === '')) {
      errors.push(`${where}: expected a${allowEmpty ? '' : ' non-empty'} list of names`);
      return null;
    }
    const seen = new Set();
    for (const s of v) {
      if (seen.has(s)) { errors.push(`${where}: duplicate "${s}"`); return null; }
      seen.add(s);
    }
    return v;
  };

  const files = new Map();
  for (const [name, v] of section('sheets')) {
    const where = `sheets.${name}`;
    if (badName(where, name)) continue;
    if (!isObj(v)) { errors.push(`${where}: expected an object`); continue; }
    let ok = unknownKeys(where, v, SHEET_KEYS);
    for (const k of ['image', 'data']) {
      const want = k === 'image' ? '.png' : '.json';
      if (typeof v[k] !== 'string' || !FILE.test(v[k]) || !v[k].toLowerCase().endsWith(want)) {
        errors.push(`${where}.${k}: expected a relative ${want} path inside assets/`); ok = false;
      } else if (files.has(v[k])) {
        errors.push(`${where}.${k}: "${v[k]}" is also used by sheets.${files.get(v[k])}`); ok = false;
      } else files.set(v[k], name);
    }
    if (v.ready !== undefined && typeof v.ready !== 'boolean') { errors.push(`${where}.ready: expected true or false`); ok = false; }
    if (ok) manifest.sheets.set(name, { image: v.image, data: v.data, ready: v.ready === true });
  }

  const sheetRef = (where, v) => {
    if (typeof v.sheet !== 'string') { errors.push(`${where}.sheet: expected a sheet name`); return false; }
    if (!manifest.sheets.has(v.sheet)) { errors.push(`${where}.sheet: no usable sheet "${v.sheet}"`); return false; }
    return true;
  };

  for (const [kind, v] of section('sprites')) {
    const where = `sprites.${kind}`;
    if (badName(where, kind)) continue;
    if (!isObj(v)) { errors.push(`${where}: expected an object`); continue; }
    let ok = [unknownKeys(where, v, SPRITE_KEYS), sheetRef(where, v)].every(Boolean);
    const states = v.states === undefined ? [] : nameList(`${where}.states`, v.states);
    const facings = v.facings === undefined ? ['S'] : nameList(`${where}.facings`, v.facings);
    if (!states || !facings) ok = false;
    if (facings) for (const f of facings) if (!FACINGS.includes(f)) { errors.push(`${where}.facings: "${f}" is not one of N E S W`); ok = false; }
    if (v.mirrorW !== undefined && typeof v.mirrorW !== 'boolean') { errors.push(`${where}.mirrorW: expected true or false`); ok = false; }
    if (v.mirrorW === true && facings && !facings.includes('E')) { errors.push(`${where}.mirrorW: needs "E" in facings to mirror`); ok = false; }
    if (v.frame !== undefined && (typeof v.frame !== 'string' || v.frame === '')) { errors.push(`${where}.frame: expected a frame or slice name`); ok = false; }
    if (states && states.length === 0 && v.frame === undefined) { errors.push(`${where}: needs "states" (animated) or "frame" (still)`); ok = false; }
    if (v.anchor !== undefined && !(Array.isArray(v.anchor) && v.anchor.length === 2 && v.anchor.every(Number.isInteger))) {
      errors.push(`${where}.anchor: expected [dx, dy] in whole pixels`); ok = false;
    }
    if (v.shadow !== undefined && !(isNum(v.shadow) && v.shadow >= 0)) { errors.push(`${where}.shadow: expected a width in pixels >= 0`); ok = false; }
    if (ok) {
      manifest.sprites.set(kind, {
        sheet: v.sheet, states, facings, mirrorW: v.mirrorW === true, frame: v.frame ?? null,
        anchor: v.anchor ? [v.anchor[0], v.anchor[1]] : [0, 0], shadow: v.shadow ?? null,
      });
    }
  }

  for (const [terrain, v] of section('tiles')) {
    const where = `tiles.${terrain}`;
    if (badName(where, terrain)) continue;
    if (!isObj(v)) { errors.push(`${where}: expected an object`); continue; }
    let ok = [unknownKeys(where, v, TILE_KEYS), sheetRef(where, v)].every(Boolean);
    const frames = nameList(`${where}.frames`, v.frames);
    if (!frames) ok = false;
    if (ok) manifest.tiles.set(terrain, { sheet: v.sheet, frames });
  }

  for (const [sheet, v] of section('icons')) {
    const where = `icons.${sheet}`;
    if (!manifest.sheets.has(sheet)) { errors.push(`${where}: no usable sheet "${sheet}"`); continue; }
    const names = nameList(where, v, { allowEmpty: true });
    if (names) manifest.icons.set(sheet, names);
  }
  return { errors, manifest };
}

/**
 * The tag names a sprite entry promises its sheet has: every state in every facing. W is optional when mirrorW
 * is set and W is not listed, because E mirrored stands in for it.
 * @param {SpriteEntry} entry
 * @returns {string[]}
 */
export function declaredTags(entry) {
  const out = [];
  for (const s of entry.states) for (const f of entry.facings) out.push(`${s}_${f}`);
  return out;
}

/**
 * The animation to play for (state, facing), by the fallback order: `<state>_<facing>`, then for W the mirrored
 * `<state>_E` (when mirrorW), then `<state>_S`, then a bare `<state>` tag; then all of that again with state
 * 'idle'. null means no tag fits (the caller tries the entry's still frame, then the placeholder).
 * @param {(name: string) => boolean} hasTag
 * @param {{ mirrorW: boolean }} entry
 * @param {string} state
 * @param {('N'|'E'|'S'|'W'|null)} facing
 * @returns {{ tag: string, mirror: boolean }|null}
 */
export function resolveTag(hasTag, entry, state, facing) {
  const states = !state || state === 'idle' ? ['idle'] : [state, 'idle'];
  for (const s of states) {
    if (facing) {
      if (hasTag(`${s}_${facing}`)) return { tag: `${s}_${facing}`, mirror: false };
      if (facing === 'W' && entry.mirrorW && hasTag(`${s}_E`)) return { tag: `${s}_E`, mirror: true };
    }
    if (hasTag(`${s}_S`)) return { tag: `${s}_S`, mirror: false };
    if (hasTag(s)) return { tag: s, mirror: false };
  }
  return null;
}
