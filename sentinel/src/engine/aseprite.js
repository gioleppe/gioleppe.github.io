// Aseprite sprite-sheet metadata (File > Export Sprite Sheet, or `aseprite -b --sheet --data`), parsed into
// plain objects the AssetManager draws from. Pure and DOM-free, so Node tests and tools use it as the page does.
// Both export layouts are accepted: `json-hash` (frames keyed by name) and `json-array` (frames with `filename`).

/**
 * One picture in the sheet. A frame may be trimmed: its pixels (`x,y,w,h` in the sheet) sit at `offX,offY`
 * inside a logical box of `srcW x srcH`; the anchor is a point in that box (bottom-centre unless a slice pivot says otherwise).
 * @typedef {Object} Region
 * @property {string} name
 * @property {number} x       sheet rectangle
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {number} offX    where the rectangle sits inside the logical box
 * @property {number} offY
 * @property {number} srcW    logical box (the untrimmed frame or the slice bounds)
 * @property {number} srcH
 * @property {number} pivotX  anchor inside the logical box
 * @property {number} pivotY
 * @property {number} duration ms (frames only; slices get 100)
 */

/**
 * @typedef {Object} Tag
 * @property {string} name
 * @property {number} from       first frame index (inclusive)
 * @property {number} to         last frame index (inclusive)
 * @property {'forward'|'reverse'|'pingpong'|'pingpong_reverse'} direction
 * @property {number[]} sequence frame indices of one full cycle, in play order
 * @property {number[]} ends     cumulative end time (ms) of each step of `sequence`
 * @property {number} total      length of one cycle in ms
 */

/**
 * @typedef {Object} Sheet
 * @property {Region[]} frames               in frame order
 * @property {Map<string, number>} frameIndex frame name -> index (also the name without its file extension)
 * @property {Map<string, Tag>} tags
 * @property {Map<string, Region>} slices    slice bounds at frame 0, mapped into the sheet
 * @property {{w:number,h:number}|null} size the sheet image size meta says
 * @property {string|null} image             the image file name meta says
 */

const DIRECTIONS = new Set(['forward', 'reverse', 'pingpong', 'pingpong_reverse']);
const DEFAULT_DURATION = 100;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function rect(v, what, needXY = true) {
  if (!isObj(v) || !isNum(v.w) || !isNum(v.h) || (needXY && (!isNum(v.x) || !isNum(v.y)))) {
    throw new Error(`${what}: expected {${needXY ? 'x, y, ' : ''}w, h}`);
  }
  return v;
}

/** the frame name without a trailing file extension: "palm.png" and "palm.aseprite" are both "palm" */
const stripExt = (name) => name.replace(/\.(png|ase|aseprite)$/i, '');

function parseFrame(name, f) {
  const what = `frame "${name}"`;
  if (!isObj(f)) throw new Error(`${what}: not an object`);
  if (f.rotated) throw new Error(`${what}: rotated frames are not supported (export without rotation)`);
  const r = rect(f.frame, `${what}.frame`);
  const sss = f.spriteSourceSize ? rect(f.spriteSourceSize, `${what}.spriteSourceSize`) : { x: 0, y: 0 };
  const src = f.sourceSize ? rect(f.sourceSize, `${what}.sourceSize`, false) : { w: r.w, h: r.h };
  const duration = isNum(f.duration) && f.duration > 0 ? f.duration : DEFAULT_DURATION;
  return {
    name, x: r.x, y: r.y, w: r.w, h: r.h,
    offX: sss.x, offY: sss.y, srcW: src.w, srcH: src.h,
    pivotX: Math.floor(src.w / 2), pivotY: src.h, duration,
  };
}

/** one cycle of a tag in play order: pingpong visits both ends once (0 1 2 1, then 0 again) */
export function tagSequence(from, to, direction) {
  const fwd = [];
  for (let i = from; i <= to; i++) fwd.push(i);
  const rev = [...fwd].reverse();
  switch (direction) {
    case 'reverse': return rev;
    case 'pingpong': return fwd.concat(rev.slice(1, -1));
    case 'pingpong_reverse': return rev.concat(fwd.slice(1, -1));
    default: return fwd;
  }
}

function parseTag(t, frames) {
  if (!isObj(t) || typeof t.name !== 'string') throw new Error('frameTags: every tag needs a name');
  const what = `tag "${t.name}"`;
  if (!Number.isInteger(t.from) || !Number.isInteger(t.to) || t.from < 0 || t.to < t.from || t.to >= frames.length) {
    throw new Error(`${what}: frames ${t.from}..${t.to} out of range (sheet has ${frames.length})`);
  }
  const direction = t.direction ?? 'forward';
  if (!DIRECTIONS.has(direction)) throw new Error(`${what}: unknown direction "${direction}"`);
  const sequence = tagSequence(t.from, t.to, direction);
  const ends = [];
  let total = 0;
  for (const i of sequence) { total += frames[i].duration; ends.push(total); }
  return { name: t.name, from: t.from, to: t.to, direction, sequence, ends, total };
}

/** a slice's bounds at frame 0, mapped into the sheet through frame 0 (clipped to its trimmed pixels) */
function parseSlice(s, frames) {
  if (!isObj(s) || typeof s.name !== 'string' || !Array.isArray(s.keys) || s.keys.length === 0) {
    throw new Error('slices: every slice needs a name and keys');
  }
  const what = `slice "${s.name}"`;
  const key = s.keys.filter((k) => isObj(k) && (k.frame ?? 0) <= 0).pop() ?? s.keys[0];
  const b = rect(key.bounds, `${what}.bounds`);
  const f = frames[0];
  if (!f) throw new Error(`${what}: the sheet has no frames`);
  // the part of the slice that frame 0 actually has pixels for
  const x0 = Math.max(b.x, f.offX);
  const y0 = Math.max(b.y, f.offY);
  const x1 = Math.min(b.x + b.w, f.offX + f.w);
  const y1 = Math.min(b.y + b.h, f.offY + f.h);
  const pivot = isObj(key.pivot) && isNum(key.pivot.x) && isNum(key.pivot.y) ? key.pivot : null;
  return {
    name: s.name,
    x: f.x + (x0 - f.offX), y: f.y + (y0 - f.offY), w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0),
    offX: x0 - b.x, offY: y0 - b.y, srcW: b.w, srcH: b.h,
    pivotX: pivot ? pivot.x : Math.floor(b.w / 2), pivotY: pivot ? pivot.y : b.h,
    duration: DEFAULT_DURATION,
  };
}

/**
 * Parse Aseprite sheet JSON (json-hash or json-array).
 * @param {unknown} json the parsed JSON
 * @returns {Sheet}
 * @throws {Error} with a readable message when the JSON is not a usable Aseprite sheet
 */
export function parseAseprite(json) {
  if (!isObj(json)) throw new Error('not an Aseprite sheet: expected an object');
  let entries;
  if (Array.isArray(json.frames)) {
    entries = json.frames.map((f, i) => [isObj(f) && typeof f.filename === 'string' ? f.filename : String(i), f]);
  } else if (isObj(json.frames)) {
    entries = Object.entries(json.frames);   // Aseprite writes keys in frame order and JSON.parse keeps it
  } else {
    throw new Error('not an Aseprite sheet: "frames" is missing');
  }
  const frames = entries.map(([name, f]) => parseFrame(name, f));
  const frameIndex = new Map();
  frames.forEach((f, i) => { if (!frameIndex.has(f.name)) frameIndex.set(f.name, i); });
  frames.forEach((f, i) => { const s = stripExt(f.name); if (!frameIndex.has(s)) frameIndex.set(s, i); });

  const meta = isObj(json.meta) ? json.meta : {};
  const tags = new Map();
  for (const t of Array.isArray(meta.frameTags) ? meta.frameTags : []) {
    const tag = parseTag(t, frames);
    if (!tags.has(tag.name)) tags.set(tag.name, tag);
  }
  const slices = new Map();
  for (const s of Array.isArray(meta.slices) ? meta.slices : []) {
    const sl = parseSlice(s, frames);
    if (!slices.has(sl.name)) slices.set(sl.name, sl);
  }
  const size = isObj(meta.size) && isNum(meta.size.w) && isNum(meta.size.h) ? { w: meta.size.w, h: meta.size.h } : null;
  return { frames, frameIndex, tags, slices, size, image: typeof meta.image === 'string' ? meta.image : null };
}

/**
 * The frame index a tag shows at `timeMs` after it started, honouring per-frame durations and direction; loops forever.
 * @param {Tag} tag
 * @param {number} timeMs
 * @returns {number} index into sheet.frames
 */
export function frameAt(tag, timeMs) {
  if (!(tag.total > 0) || !Number.isFinite(timeMs)) return tag.sequence[0];
  const t = ((timeMs % tag.total) + tag.total) % tag.total;
  // cycles are a handful of frames long, a linear scan is cheapest
  for (let i = 0; i < tag.ends.length; i++) if (t < tag.ends[i]) return tag.sequence[i];
  return tag.sequence[tag.sequence.length - 1];
}

/**
 * A still picture by name: a frame name (with or without file extension), else a slice name.
 * @param {Sheet} sheet
 * @param {string} name
 * @returns {Region|null}
 */
export function findRegion(sheet, name) {
  const i = sheet.frameIndex.get(name);
  if (i !== undefined) return sheet.frames[i];
  return sheet.slices.get(name) ?? null;
}

/**
 * Every rectangle that falls outside the sheet image (a sign the JSON and PNG come from different exports).
 * @param {Sheet} sheet
 * @param {{w:number,h:number}} size image size
 * @returns {string[]} names of the offending frames and slices
 */
export function outOfBounds(sheet, size) {
  const bad = [];
  for (const r of [...sheet.frames, ...sheet.slices.values()]) {
    if (r.x < 0 || r.y < 0 || r.x + r.w > size.w || r.y + r.h > size.h) bad.push(r.name);
  }
  return bad;
}
