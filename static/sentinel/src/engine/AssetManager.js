// Real art from Aseprite sheets, with the placeholders as the fallback for anything missing (spec §4.1, §4.2).
// Implements the Renderer's SpriteSource. Loading never blocks drawing and never throws or rejects: until a sheet
// has arrived, and for every entry that cannot be drawn from it, the placeholder is drawn instead.
//
// assets/manifest.json (paths relative to assets/; checked by src/engine/manifest.js and `npm run validate`):
// {
//   "sheets":  { "<sheet>": { "image": "sprites/player.png", "data": "sprites/player.json", "ready": false } },
//   "sprites": { "<kind>":  { "sheet": "player", "states": ["idle", "walk"], "facings": ["N", "E", "S"], "mirrorW": true,
//                             "frame": "palm", "anchor": [0, 0], "shadow": 20 } },
//   "tiles":   { "<terrain>": { "sheet": "terrain_tiles", "frames": ["sand", "sand_2"] } },
//   "icons":   { "<sheet>": ["exclaim", "question"] }
// }
// - Every sheet is a PNG plus the Aseprite JSON exported next to it (json-hash or json-array, tags and slices listed).
// - `ready` (default false): only ready sheets are fetched. The art pipeline sets it when it exports the sheet, so
//   missing art costs no requests; a ready sheet whose files are missing or broken is a fault (reported, validate fails).
// - sprites: keyed by the entity kind the game uses. Animated entries list `states` x `facings` (facings default
//   ["S"]); the sheet has one tag per pair named `<state>_<facing>` (e.g. `walk_S`). `mirrorW` draws W as E flipped.
//   Fallback per call: <state>_<facing> -> <state>_E mirrored (W only) -> <state>_S -> <state>, then the same for
//   `idle`, then the still `frame`, then the placeholder. Still entries (props) name a `frame`: a frame name
//   (extension optional) or a slice name in the sheet; a slice pivot, if set, is the anchor.
//   Variants: draw/size take a variant number (a prop's `variant`, 0-2); variant v > 0 uses the slice or frame
//   `<frame>_<v+1>` when the sheet has it (palm_2, wreck_hull_3), else `<frame>`. A still slice whose name is also
//   a tag of the sheet plays that tag (the campfire's flames): the slice rectangle taken from the tag's frame.
// - size boxes carry `below`: how far the picture reaches under its anchor (slices whose pivot is above their
//   bottom row), so culling never pops a sprite at the screen's bottom edge.
// - anchor: [dx, dy] whole pixels the picture is moved from the default (bottom-centre on the ground point).
// - shadow: ground shadow width in pixels (0 = none); default follows the sprite width.
// - tiles: keyed by terrain name; `frames` are its variants (32 x 24), chosen by the renderer's variant number.
// - icons: 16 x 16 icons drawn with drawIcon(ctx, sheet, name, x, y), addressed by frame or slice name; the list
//   names the icons the sheet must have.
import { parseAseprite, frameAt, findRegion, outOfBounds, sliceInFrame } from './aseprite.js';
import { checkManifest, declaredTags, resolveTag } from './manifest.js';
import { PlaceholderSprites } from './PlaceholderSprites.js';

/**
 * How files are fetched; injectable so tests run without a browser. Both reject on any failure.
 * @typedef {Object} AssetLoader
 * @property {(url: string) => Promise<unknown>} json
 * @property {(url: string) => Promise<{ width: number, height: number }>} image  anything ctx.drawImage accepts
 */

/** @type {AssetLoader} */
export const browserLoader = {
  async json(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  async image(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return createImageBitmap(await res.blob());
  },
};

const msg = (e) => (e && e.message) || String(e);

/** characters the ui sheet's 4 x 6 glyphs cover */
const GLYPH_NAMES = Object.freeze({
  0: 'glyph_0', 1: 'glyph_1', 2: 'glyph_2', 3: 'glyph_3', 4: 'glyph_4', 5: 'glyph_5', 6: 'glyph_6', 7: 'glyph_7', 8: 'glyph_8', 9: 'glyph_9',
  x: 'glyph_x', ':': 'glyph_colon', '%': 'glyph_percent',
});
/** pixels from one glyph to the next */
export const GLYPH_ADVANCE = 4;

/** the AssetManager the UI draws from (set once by the page; null in tools and tests that do not set one) */
let active = null;

/**
 * Make `assets` the one the HUD, touch controls, map and emotes draw from (src/main.js, once).
 * @param {AssetManager|null} assets
 */
export function setActiveAssets(assets) {
  active = assets;
}

/** @returns {AssetManager|null} the AssetManager set by setActiveAssets */
export function activeAssets() {
  return active;
}

export class AssetManager {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.base]          folder of manifest.json, relative to the page
   * @param {AssetLoader} [opts.loader]
   * @param {PlaceholderSprites} [opts.placeholder]
   * @param {{ info: Function, warn: Function }} [opts.log]
   */
  constructor({ base = 'assets/', loader = browserLoader, placeholder = new PlaceholderSprites(), log = console } = {}) {
    this.base = base;
    this.loader = loader;
    this.placeholder = placeholder;
    this.log = log;
    /** @type {import('./manifest.js').Manifest|null} */
    this.manifest = null;
    /** sheet name -> { image, data: Sheet } for every sheet in use */
    this.sheets = new Map();
    /** kind -> {w, h, shadow?} for kinds drawn from a loaded sheet */
    this.sizes = new Map();
    /** `${kind}|${state}|${facing}|${variant}` -> what to draw; cleared whenever a sheet arrives */
    this.choice = new Map();
    /** `${kind}|${variant}` -> culling box of that variant's own picture (null: same as the kind's) */
    this.variantSizes = new Map();
    this.state = { manifest: 'pending', loaded: [], missing: [], broken: [], notReady: [], pending: [], fallbacks: [] };
    this.logged = new Set();
    this.loading = null;
  }

  /**
   * Start loading (once) and return a promise that settles when every file has arrived or failed. It never rejects.
   * Sheets switch to real art one by one as they arrive; nothing waits for this promise to draw.
   * @returns {Promise<ReturnType<AssetManager['report']>>}
   */
  load() {
    if (!this.loading) this.loading = this.loadAll().catch((e) => this.fault('broken', { what: 'loader', reason: msg(e) })).then(() => this.report());
    return this.loading;
  }

  /** what loaded, what is missing or broken, and what is waiting for art; a copy, safe to keep */
  report() {
    return JSON.parse(JSON.stringify(this.state));
  }

  /** @returns {boolean} whether the kind is drawn from real art right now */
  has(kind) {
    return this.sizes.has(kind);
  }

  async loadAll() {
    let json;
    try {
      json = await this.loader.json(`${this.base}manifest.json`);
    } catch (e) {
      this.state.manifest = 'missing';
      this.warnOnce('manifest', `assets: ${this.base}manifest.json could not be loaded (${msg(e)}); drawing placeholders`);
      return;
    }
    const { errors, manifest } = checkManifest(json);
    this.manifest = manifest;
    this.state.manifest = errors.length ? 'broken' : 'loaded';
    for (const e of errors) this.fault('broken', { what: 'manifest', reason: e });

    const ready = [...manifest.sheets].filter(([, s]) => s.ready);
    this.state.notReady = [...manifest.sheets].filter(([, s]) => !s.ready).map(([n]) => n);
    this.state.pending = ready.map(([n]) => n);
    if (this.state.notReady.length) {
      this.log.info(`assets: ${this.state.notReady.length} sheet(s) not ready yet, drawn as placeholders: ${this.state.notReady.join(', ')}`);
    }
    await Promise.all(ready.map(([name, s]) => this.loadSheet(name, s)));
  }

  /** fetch one sheet's PNG and JSON in parallel and install it; every failure is recorded, none escapes */
  async loadSheet(name, entry) {
    const call = async (fn, file) => fn(this.base + file);   // a loader that throws synchronously still only rejects
    const [img, data] = await Promise.allSettled([
      call((u) => this.loader.image(u), entry.image),
      call((u) => this.loader.json(u), entry.data),
    ]);
    this.state.pending = this.state.pending.filter((n) => n !== name);
    let failed = false;
    for (const [r, file] of [[img, entry.image], [data, entry.data]]) {
      if (r.status === 'rejected') {
        failed = true;
        // no file (HTTP error, network failure) is missing; a file that arrived but does not parse or decode is broken
        const kind = r.reason instanceof TypeError || /^HTTP \d/.test(msg(r.reason)) ? 'missing' : 'broken';
        this.fault(kind, kind === 'missing' ? { sheet: name, file, reason: msg(r.reason) } : { what: `sheet ${name}`, reason: `${file}: ${msg(r.reason)}` });
      }
    }
    if (failed) return;
    let sheet;
    try {
      sheet = parseAseprite(data.value);
    } catch (e) {
      this.fault('broken', { what: `sheet ${name}`, reason: `${entry.data}: ${msg(e)}` });
      return;
    }
    const size = { w: img.value.width, h: img.value.height };
    const outside = outOfBounds(sheet, size);
    if (outside.length) {
      this.fault('broken', { what: `sheet ${name}`, reason: `${entry.data} does not match ${entry.image} (${size.w}x${size.h}): ${outside.slice(0, 5).join(', ')} outside the image` });
      return;
    }
    this.install(name, img.value, sheet);
  }

  /** make a parsed sheet live, and record every declared tag, frame, tile or icon it lacks */
  install(name, image, sheet) {
    const m = this.manifest;
    this.sheets.set(name, { image, data: sheet });
    this.state.loaded.push(name);
    for (const [kind, e] of m.sprites) {
      if (e.sheet !== name) continue;
      for (const t of declaredTags(e)) if (!sheet.tags.has(t)) this.fault('broken', { what: `sprite ${kind}`, reason: `tag "${t}" missing in sheet ${name}` });
      if (e.frame && !findRegion(sheet, e.frame)) this.fault('broken', { what: `sprite ${kind}`, reason: `frame "${e.frame}" missing in sheet ${name}` });
      const box = this.boxOf(e, sheet);
      if (box) this.sizes.set(kind, box);
    }
    for (const [terrain, t] of m.tiles) {
      if (t.sheet !== name) continue;
      for (const f of t.frames) if (!findRegion(sheet, f)) this.fault('broken', { what: `tile ${terrain}`, reason: `frame "${f}" missing in sheet ${name}` });
    }
    for (const n of m.icons.get(name) ?? []) if (!findRegion(sheet, n)) this.fault('broken', { what: `icon ${name}/${n}`, reason: `frame "${n}" missing in sheet ${name}` });
    this.choice.clear();
    this.variantSizes.clear();
    this.log.info(`assets: sheet ${name} loaded`);
  }

  /**
   * The culling box of an entry: wide enough for every picture it can show, mirrored or not, with its anchor.
   * null when the sheet has nothing for it (the kind stays a placeholder).
   */
  boxOf(e, sheet, stillName = e.frame) {
    const regions = [];
    const states = e.states.length ? [...e.states, 'idle'] : [];
    for (const t of sheet.tags.values()) {
      if (!states.some((s) => t.name === s || t.name.startsWith(`${s}_`))) continue;
      for (let i = t.from; i <= t.to; i++) regions.push(sheet.frames[i]);
    }
    const still = stillName ? findRegion(sheet, stillName) : null;
    if (still) regions.push(still);
    if (!regions.length) return null;
    let half = 0;
    let h = 0;
    let below = 0;
    for (const r of regions) {
      const left = r.pivotX - e.anchor[0];
      const right = r.srcW - r.pivotX + e.anchor[0];
      half = Math.max(half, left, right);
      h = Math.max(h, r.pivotY - e.anchor[1]);
      below = Math.max(below, r.srcH - r.pivotY + e.anchor[1]);
    }
    const box = { w: Math.ceil(half) * 2, h: Math.ceil(h), below: Math.ceil(below) };
    if (e.shadow !== null) box.shadow = e.shadow;
    return box;
  }

  /** the still picture's name for a variant: `<frame>_<v+1>` when the sheet has it, else the entry's frame */
  stillName(e, sheet, variant) {
    if (!e.frame) return null;
    if (variant > 0) {
      const v = `${e.frame}_${variant + 1}`;
      if (findRegion(sheet, v)) return v;
    }
    return e.frame;
  }

  // ---- SpriteSource -----------------------------------------------------------------------------------------

  /**
   * @param {string} kind
   * @param {string} [state]
   * @param {number} [variant] a prop's variant: the box of that variant's own picture
   * @returns {{w:number,h:number,shadow?:number,below?:number}}
   */
  size(kind, state, variant = 0) {
    if (variant > 0 && this.sizes.has(kind)) {
      const key = `${kind}|${variant}`;
      let b = this.variantSizes.get(key);
      if (b === undefined) {
        const e = this.manifest.sprites.get(kind);
        const s = this.sheets.get(e.sheet);
        const name = s && this.stillName(e, s.data, variant);
        b = name && name !== e.frame ? this.boxOf(e, s.data, name) : null;
        this.variantSizes.set(key, b);
      }
      if (b) return b;
    }
    return this.sizes.get(kind) ?? this.placeholder.size(kind, state);
  }

  draw(ctx, kind, state, facing, x, y, time, variant = 0) {
    const c = this.pick(kind, state, facing, variant);
    if (c && this.paint(ctx, c, this.regionAt(c, time), x, y)) return;
    this.placeholder.draw(ctx, kind, state, facing, x, y, time);
  }

  /** the picture of a choice at `time` seconds: an animation frame, a still, or a still slice playing its tag */
  regionAt(c, time) {
    if (c.tag) return c.data.frames[frameAt(c.tag, time * 1000)];
    if (!c.stillTag) return c.region;
    const i = frameAt(c.stillTag, time * 1000);
    let r = c.frames[i];
    if (!r) r = c.frames[i] = sliceInFrame(c.data, c.region, i);
    return r;
  }

  drawTile(ctx, terrain, x, y, w, h, variant) {
    const t = this.manifest?.tiles.get(terrain);
    const s = t && this.sheets.get(t.sheet);
    const r = s && findRegion(s.data, t.frames[variant % t.frames.length]);
    if (r && this.blit(ctx, t.sheet, s.image, r, x + r.offX, y + r.offY)) return;
    this.placeholder.drawTile(ctx, terrain, x, y, w, h, variant);
  }

  /**
   * Milliseconds per frame of an animated terrain: the sheet's tag named after the terrain (its cycle length over
   * its frame count), or null while the sheet is not loaded or has no such tag.
   * @param {string} terrain
   * @returns {number|null}
   */
  tileFrameMs(terrain) {
    const t = this.manifest?.tiles.get(terrain);
    const tag = t && this.sheets.get(t.sheet)?.data.tags.get(terrain);
    return tag && tag.sequence.length ? tag.total / tag.sequence.length : null;
  }

  // ---- icons and UI pieces (ICONS.md) -------------------------------------------------------------------------
  // Every call is safe while sheets are loading: it draws a placeholder and never throws. UI code that has a
  // better procedural fallback of its own asks `hasIcon` first.

  /** @returns {boolean} whether the sheet has arrived (its icons draw from real art) */
  ready(sheet) {
    return this.sheets.has(sheet);
  }

  /** @returns {boolean} whether `name` draws from real art right now */
  hasIcon(sheet, name) {
    const s = this.sheets.get(sheet);
    return !!(s && findRegion(s.data, name));
  }

  /** @returns {{w:number,h:number}|null} an icon's own size (its untrimmed box), null while it is not loaded */
  iconSize(sheet, name) {
    const s = this.sheets.get(sheet);
    const r = s && findRegion(s.data, name);
    return r ? { w: r.srcW, h: r.srcH } : null;
  }

  /**
   * An icon by name with its top-left at (x, y): at its own size, or stretched to w x h (pixelated).
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} sheet 'items' | 'emotes' | 'ui'
   * @param {string} name frame or slice name
   * @param {number} x
   * @param {number} y
   * @param {number} [w] destination width (default: the icon's own)
   * @param {number} [h] destination height
   */
  drawIcon(ctx, sheet, name, x, y, w, h) {
    const s = this.sheets.get(sheet);
    const r = s && findRegion(s.data, name);
    if (r && this.blitScaled(ctx, sheet, s.image, r, x, y, w, h)) return;
    if (s && !r) this.infoOnce(`icon|${sheet}|${name}`, `assets: no icon "${name}" in sheet ${sheet}, drawing a placeholder`);
    this.placeholder.drawIcon(ctx, sheet, name, x, y, w, h);
  }

  /**
   * One frame of an animated icon: the sheet's tag `tag` at `timeMs` after it started (loops), top-left at (x, y).
   * Falls back to the still icon of the same name, then the placeholder.
   */
  drawIconAnim(ctx, sheet, tag, timeMs, x, y, w, h) {
    const s = this.sheets.get(sheet);
    const t = s?.data.tags.get(tag);
    if (t) {
      const r = s.data.frames[frameAt(t, timeMs)];
      if (this.blitScaled(ctx, sheet, s.image, r, x, y, w, h)) return;
    }
    this.drawIcon(ctx, sheet, tag, x, y, w, h);
  }

  /**
   * A 3-slice strip `<prefix>_l`, `<prefix>_m`, `<prefix>_r` across `w` pixels at (x, y), its own height. The middle
   * is uniform along its length (ICONS.md), so it is stretched in one draw ('stretch', default) or repeated ('tile').
   * A strip narrower than both ends draws the left end and then the right end over it.
   * @returns {boolean} false when it drew the placeholder
   */
  drawPanel3(ctx, sheet, prefix, x, y, w, { mode = 'stretch' } = {}) {
    const s = this.sheets.get(sheet);
    const l = s && findRegion(s.data, `${prefix}_l`);
    const m = s && findRegion(s.data, `${prefix}_m`);
    const r = s && findRegion(s.data, `${prefix}_r`);
    if (!(l && m && r) || w <= 0) {
      if (w > 0) this.placeholder.drawPanel(ctx, x, y, w, l?.srcH ?? 8);
      return false;
    }
    const ok = (reg, dx, dw) => this.blitScaled(ctx, sheet, s.image, reg, dx, y, dw, reg.srcH);
    if (!ok(l, x, l.srcW)) return false;
    const mid = w - l.srcW - r.srcW;
    if (mid > 0) {
      if (mode === 'tile') for (let i = 0; i < mid; i += m.srcW) ok(m, x + l.srcW + Math.min(i, mid - m.srcW), m.srcW);
      else ok(m, x + l.srcW, mid);
    }
    return ok(r, x + Math.max(0, w - r.srcW), r.srcW);
  }

  /**
   * A 9-slice box `<prefix>_tl … _br` (ICONS.md) filling the rect: corners at their size, edges and centre
   * stretched ('stretch', default: they are uniform along their length) or repeated ('tile', the last tile
   * overlapping). Works for any size at least two corners wide and high.
   * @returns {boolean} false when it drew the placeholder
   */
  drawPanel9(ctx, sheet, prefix, x, y, w, h, { mode = 'stretch' } = {}) {
    const s = this.sheets.get(sheet);
    const get = (k) => (s ? findRegion(s.data, `${prefix}_${k}`) : null);
    const tl = get('tl');
    const t = get('t');
    const tr = get('tr');
    const l = get('l');
    const c = get('c');
    const r = get('r');
    const bl = get('bl');
    const b = get('b');
    const br = get('br');
    if (!(tl && t && tr && l && c && r && bl && b && br) || w <= 0 || h <= 0) {
      if (w > 0 && h > 0) this.placeholder.drawPanel(ctx, x, y, w, h);
      return false;
    }
    const cw = tl.srcW;
    const ch = tl.srcH;
    const iw = w - cw - tr.srcW;
    const ih = h - ch - bl.srcH;
    const put = (reg, dx, dy, dw = reg.srcW, dh = reg.srcH) => this.blitScaled(ctx, sheet, s.image, reg, dx, dy, dw, dh);
    const span = (reg, dx, dy, len, horizontal) => {
      if (len <= 0) return;
      if (mode !== 'tile') { if (horizontal) put(reg, dx, dy, len, reg.srcH); else put(reg, dx, dy, reg.srcW, len); return; }
      const step = horizontal ? reg.srcW : reg.srcH;
      for (let i = 0; i < len; i += step) {
        const o = Math.min(i, len - step);
        if (horizontal) put(reg, dx + o, dy); else put(reg, dx, dy + o);
      }
    };
    if (iw > 0 && ih > 0) {
      if (mode === 'tile') {
        for (let j = 0; j < ih; j += c.srcH) span(c, x + cw, y + ch + Math.min(j, ih - c.srcH), iw, true);
      } else put(c, x + cw, y + ch, iw, ih);
    }
    span(t, x + cw, y, iw, true);
    span(b, x + cw, y + h - b.srcH, iw, true);
    span(l, x, y + ch, ih, false);
    span(r, x + w - r.srcW, y + ch, ih, false);
    put(tl, x, y);
    put(tr, x + w - tr.srcW, y);
    put(bl, x, y + h - bl.srcH);
    return put(br, x + w - br.srcW, y + h - br.srcH);
  }

  /**
   * Text in the ui sheet's 4 x 6 bitmap glyphs (`glyph_0`-`glyph_9`, `glyph_x`, `glyph_colon`, `glyph_percent`;
   * advance 4 px; a space advances 4, other characters are skipped), top-left at (x, y). Built-in 3 x 5 digits
   * while the sheet loads.
   * @returns {number} the width drawn, in pixels
   */
  drawGlyphs(ctx, text, x, y) {
    const s = this.sheets.get('ui');
    let cx = x;
    for (const ch of String(text)) {
      const name = GLYPH_NAMES[ch.toLowerCase()];
      if (name) {
        const r = s && findRegion(s.data, name);
        if (!(r && this.blitScaled(ctx, 'ui', s.image, r, cx, y))) this.placeholder.drawGlyph(ctx, ch, cx, y);
      } else if (ch !== ' ') continue;
      cx += GLYPH_ADVANCE;
    }
    return cx - x;
  }

  // ---- internals ----------------------------------------------------------------------------------------------

  /** what to draw for (kind, state, facing): a tag or a still region of a loaded sheet, or null for the placeholder */
  pick(kind, state, facing, variant = 0) {
    const key = `${kind}|${state}|${facing}|${variant}`;
    if (this.choice.has(key)) return this.choice.get(key);
    let c = null;
    const e = this.manifest?.sprites.get(kind);
    const s = e && this.sheets.get(e.sheet);
    if (s) {
      const hit = resolveTag((n) => s.data.tags.has(n), e, state, facing);
      const still = hit ? null : this.stillName(e, s.data, variant);
      const region = still ? findRegion(s.data, still) : null;
      if (hit || region) {
        // a still slice with a tag of its own name animates (frames cached per index as they are first drawn)
        const stillTag = region && region.bounds ? s.data.tags.get(still) ?? null : null;
        c = {
          kind, sheet: e.sheet, image: s.image, data: s.data, anchor: e.anchor, tag: hit ? s.data.tags.get(hit.tag) : null,
          mirror: hit ? hit.mirror : false, region, stillTag, frames: [],
        };
      }
      // an animated kind asked for something its sheet lacks: say so once, it is how missing poses get noticed
      const wanted = facing ? `${state}_${facing}` : state;
      const exact = hit && (hit.mirror ? hit.tag === `${state}_E` : hit.tag === wanted);
      if (e.states.length && !exact) {
        const used = hit ? `${hit.tag}${hit.mirror ? ' mirrored' : ''}` : region ? `frame ${e.frame}` : 'placeholder';
        this.state.fallbacks.push(`${kind} ${wanted} -> ${used}`);
        this.infoOnce(`fb|${key}`, `assets: ${kind} has no ${wanted}, drawing ${used}`);
      }
    }
    this.choice.set(key, c);
    return c;
  }

  /**
   * Draw one region with its pivot on (x, y); false if drawing failed (the sheet is then dropped). Step 5.6: one
   * drawImage, no save/translate/scale/restore per sprite; a mirrored picture is drawn from a flipped copy of its
   * sheet, made once (same pixels on whole-pixel positions: the flip is exact).
   */
  paint(ctx, c, r, x, y) {
    try {
      const dx = r.offX - r.pivotX + c.anchor[0];
      const dy = y + r.offY - r.pivotY + c.anchor[1];
      if (!c.mirror) {
        ctx.drawImage(c.image, r.x, r.y, r.w, r.h, x + dx, dy, r.w, r.h);
        return true;
      }
      const flipped = this.flippedSheet(c);
      if (flipped) {
        ctx.drawImage(flipped, flipped.width - r.x - r.w, r.y, r.w, r.h, x - dx - r.w, dy, r.w, r.h);
        return true;
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(-1, 1);
      ctx.drawImage(c.image, r.x, r.y, r.w, r.h, dx, dy - y, r.w, r.h);
      ctx.restore();
      return true;
    } catch (e) {
      this.drop(c.sheet, e);
      return false;
    }
  }

  /** the sheet of a choice mirrored left to right, cached per sheet (null where no canvas can be made) */
  flippedSheet(c) {
    if (!this.flipped) this.flipped = new Map();
    let f = this.flipped.get(c.sheet);
    if (f !== undefined && f?.src === c.image) return f.canvas;
    const img = c.image;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    let canvas = null;
    if (w > 0 && h > 0) {
      if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(w, h);
      else if (globalThis.document) canvas = Object.assign(globalThis.document.createElement('canvas'), { width: w, height: h });
      const g = canvas?.getContext('2d');
      if (g) {
        g.translate(w, 0);
        g.scale(-1, 1);
        g.drawImage(img, 0, 0);
      } else canvas = null;
    }
    this.flipped.set(c.sheet, { src: img, canvas });
    return canvas;
  }

  /**
   * Draw only the rows of a sprite between screen rows `top` and `bottom` (a swaying prop's slice), with one
   * drawImage instead of a clip. Same pixels as clipping the whole sprite to that band on whole-pixel positions.
   * @returns {boolean} false when it cannot (placeholder, mirrored): the caller clips instead
   */
  drawBand(ctx, kind, state, facing, x, y, time, variant, top, bottom) {
    const c = this.pick(kind, state, facing, variant);
    if (!c || c.mirror) return false;
    const r = this.regionAt(c, time);
    if (!r) return false;
    const dx = x + r.offX - r.pivotX + c.anchor[0];
    const dy = y + r.offY - r.pivotY + c.anchor[1];
    const y0 = Math.max(dy, top);
    const y1 = Math.min(dy + r.h, bottom);
    if (y1 <= y0) return true;
    try {
      ctx.drawImage(c.image, r.x, r.y + (y0 - dy), r.w, y1 - y0, dx, y0, r.w, y1 - y0);
      return true;
    } catch (e) {
      this.drop(c.sheet, e);
      return false;
    }
  }

  /** a region with its logical box's top-left at (x, y), optionally stretched to w x h (trim offsets scale too) */
  blitScaled(ctx, sheet, image, r, x, y, w = r.srcW, h = r.srcH) {
    if (w === r.srcW && h === r.srcH) return this.blit(ctx, sheet, image, r, x + r.offX, y + r.offY);
    const sx = w / r.srcW;
    const sy = h / r.srcH;
    try {
      ctx.drawImage(image, r.x, r.y, r.w, r.h, x + r.offX * sx, y + r.offY * sy, r.w * sx, r.h * sy);
      return true;
    } catch (e) {
      this.drop(sheet, e);
      return false;
    }
  }

  blit(ctx, sheet, image, r, x, y) {
    try {
      ctx.drawImage(image, r.x, r.y, r.w, r.h, x, y, r.w, r.h);
      return true;
    } catch (e) {
      this.drop(sheet, e);
      return false;
    }
  }

  /** a sheet the browser cannot draw goes back to placeholders for good */
  drop(sheet, e) {
    this.sheets.delete(sheet);
    for (const [kind, s] of this.manifest?.sprites ?? []) if (s.sheet === sheet) this.sizes.delete(kind);
    this.choice.clear();
    this.variantSizes.clear();
    this.state.loaded = this.state.loaded.filter((n) => n !== sheet);
    this.fault('broken', { what: `sheet ${sheet}`, reason: `drawing failed: ${msg(e)}` });
  }

  /** record a problem in the report and say it once on the console (never console.error: missing art is not a crash) */
  fault(list, item) {
    this.state[list].push(item);
    const text = list === 'missing' ? `${item.sheet}: ${item.file} ${item.reason}` : `${item.what}: ${item.reason}`;
    this.warnOnce(`${list}|${text}`, `assets: ${list} ${text}; drawing placeholders for it`);
  }

  warnOnce(key, text) {
    if (this.logged.has(key)) return;
    this.logged.add(key);
    this.log.warn(text);
  }

  infoOnce(key, text) {
    if (this.logged.has(key)) return;
    this.logged.add(key);
    this.log.info(text);
  }
}
