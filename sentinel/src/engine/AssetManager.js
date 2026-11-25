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
// - anchor: [dx, dy] whole pixels the picture is moved from the default (bottom-centre on the ground point).
// - shadow: ground shadow width in pixels (0 = none); default follows the sprite width.
// - tiles: keyed by terrain name; `frames` are its variants (32 x 24), chosen by the renderer's variant number.
// - icons: 16 x 16 icons drawn with drawIcon(ctx, sheet, name, x, y), addressed by frame or slice name; the list
//   names the icons the sheet must have.
import { parseAseprite, frameAt, findRegion, outOfBounds } from './aseprite.js';
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
    /** `${kind}|${state}|${facing}` -> what to draw; cleared whenever a sheet arrives */
    this.choice = new Map();
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
    this.log.info(`assets: sheet ${name} loaded`);
  }

  /**
   * The culling box of an entry: wide enough for every picture it can show, mirrored or not, with its anchor.
   * null when the sheet has nothing for it (the kind stays a placeholder).
   */
  boxOf(e, sheet) {
    const regions = [];
    const states = e.states.length ? [...e.states, 'idle'] : [];
    for (const t of sheet.tags.values()) {
      if (!states.some((s) => t.name === s || t.name.startsWith(`${s}_`))) continue;
      for (let i = t.from; i <= t.to; i++) regions.push(sheet.frames[i]);
    }
    const still = e.frame ? findRegion(sheet, e.frame) : null;
    if (still) regions.push(still);
    if (!regions.length) return null;
    let half = 0;
    let h = 0;
    for (const r of regions) {
      const left = r.pivotX - e.anchor[0];
      const right = r.srcW - r.pivotX + e.anchor[0];
      half = Math.max(half, left, right);
      h = Math.max(h, r.pivotY - e.anchor[1]);
    }
    const box = { w: Math.ceil(half) * 2, h: Math.ceil(h) };
    if (e.shadow !== null) box.shadow = e.shadow;
    return box;
  }

  // ---- SpriteSource -----------------------------------------------------------------------------------------

  /** @returns {{w:number,h:number,shadow?:number}} */
  size(kind, state) {
    return this.sizes.get(kind) ?? this.placeholder.size(kind, state);
  }

  draw(ctx, kind, state, facing, x, y, time) {
    const c = this.pick(kind, state, facing);
    if (c && this.paint(ctx, c, c.tag ? c.data.frames[frameAt(c.tag, time * 1000)] : c.region, x, y)) return;
    this.placeholder.draw(ctx, kind, state, facing, x, y, time);
  }

  drawTile(ctx, terrain, x, y, w, h, variant) {
    const t = this.manifest?.tiles.get(terrain);
    const s = t && this.sheets.get(t.sheet);
    const r = s && findRegion(s.data, t.frames[variant % t.frames.length]);
    if (r && this.blit(ctx, t.sheet, s.image, r, x + r.offX, y + r.offY)) return;
    this.placeholder.drawTile(ctx, terrain, x, y, w, h, variant);
  }

  /** a 16 x 16 icon by name with its top-left at (x, y) */
  drawIcon(ctx, sheet, name, x, y) {
    const s = this.sheets.get(sheet);
    const r = s && findRegion(s.data, name);
    if (r && this.blit(ctx, sheet, s.image, r, x + r.offX, y + r.offY)) return;
    if (s && !r) this.infoOnce(`icon|${sheet}|${name}`, `assets: no icon "${name}" in sheet ${sheet}, drawing a placeholder`);
    this.placeholder.drawIcon(ctx, sheet, name, x, y);
  }

  // ---- internals ----------------------------------------------------------------------------------------------

  /** what to draw for (kind, state, facing): a tag or a still region of a loaded sheet, or null for the placeholder */
  pick(kind, state, facing) {
    const key = `${kind}|${state}|${facing}`;
    if (this.choice.has(key)) return this.choice.get(key);
    let c = null;
    const e = this.manifest?.sprites.get(kind);
    const s = e && this.sheets.get(e.sheet);
    if (s) {
      const hit = resolveTag((n) => s.data.tags.has(n), e, state, facing);
      const region = !hit && e.frame ? findRegion(s.data, e.frame) : null;
      if (hit || region) {
        c = { kind, sheet: e.sheet, image: s.image, data: s.data, anchor: e.anchor, tag: hit ? s.data.tags.get(hit.tag) : null, mirror: hit ? hit.mirror : false, region };
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

  /** draw one region with its pivot on (x, y); false if drawing failed (the sheet is then dropped) */
  paint(ctx, c, r, x, y) {
    try {
      ctx.save();
      ctx.translate(x, y);
      if (c.mirror) ctx.scale(-1, 1);
      ctx.drawImage(c.image, r.x, r.y, r.w, r.h, r.offX - r.pivotX + c.anchor[0], r.offY - r.pivotY + c.anchor[1], r.w, r.h);
      return true;
    } catch (e) {
      this.drop(c.sheet, e);
      return false;
    } finally {
      ctx.restore();
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
