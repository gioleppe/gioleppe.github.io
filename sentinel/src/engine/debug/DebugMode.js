// Debug mode (`?debug` only): overlays, stats, time controls, teleport, snapshots, input recording and cheat
// actions, behind one panel and `window.__game.debug`. main.js loads this module with a dynamic import only
// when the URL has `?debug`, so without it none of this is fetched, created or listening.
//
// For later steps, the whole extension API is three calls (all also on `window.__game.debug`):
//   debug.addLayer({ id, label, group, default, drawWorld?(ctx, sim, camera, env), drawUi?(ctx, sim, vp, env) })
//   debug.addPlaces((sim) => [{ id, label, x, y }])
//   debug.addAction({ id, label, group, run(sim, debug) })      // sim writes go through cheats.js
// See OverlayRegistry.js and registries.js for the details.
//
// Keys: ` panel  F2 pause  F3 step (Shift: 10)  F4 faster (Shift: slower)  F8 teleport to the mouse
//       F9 save slot 1  F10 load slot 1. None of them is bound by the game.
import { snapshotHash } from '../../sim/hash.js';
import { OverlayRegistry } from './OverlayRegistry.js';
import { builtinLayers, COLORS } from './layers.js';
import { TimeControl, SPEEDS } from './TimeControl.js';
import { FrameStats } from './FrameStats.js';
import { SnapshotSlots } from './SnapshotSlots.js';
import { InputRecording, ScriptPlayer, readRecording } from './Recording.js';
import { PlaceRegistry, ActionRegistry } from './registries.js';
import { Panel } from './Panel.js';
import * as cheats from './cheats.js';
import { downloadJson, pickJsonFile, isRelativeUrl } from './files.js';

/** ticks between two hashes in the stats readout */
export const HASH_EVERY = 60;

/** localStorage, or null where it is blocked */
function safeStorage() {
  try {
    const s = globalThis.localStorage;
    s.getItem('sentinel.debug.probe');
    return s;
  } catch {
    return null;
  }
}

const speedLabel = (s) => `×${s}`;

/**
 * @typedef {Object} DebugHost  what main.js lends debug mode
 * @property {import('../../sim/Sim.js').Sim} sim  the running Sim (getter)
 * @property {(sim: import('../../sim/Sim.js').Sim) => void} setSim  swap the running Sim; main re-points camera and __game
 * @property {import('../Camera.js').Camera} camera (getter)
 * @property {import('../InputManager.js').InputManager} input (getter)
 * @property {import('../viewport.js').Viewport} vp (getter)
 * @property {{top:number,right:number,bottom:number,left:number}} safe (getter)
 * @property {import('../AssetManager.js').AssetManager} assets
 * @property {import('../Renderer.js').Renderer} renderer
 * @property {import('../FixedStep.js').FixedStep} stepper
 * @property {() => void} tick  one simulation step exactly as the loop runs it (input, step, events)
 * @property {HTMLCanvasElement} uiCanvas
 */

export class DebugMode {
  /** @param {DebugHost} host */
  constructor(host, { storage = safeStorage(), win = globalThis.window, log = console } = {}) {
    this.host = host;
    this.log = log;
    this.storage = storage;
    this.layers = new OverlayRegistry({ storage, log });
    this.time = new TimeControl(host.stepper);
    this.frameStats = new FrameStats();
    this.slots = new SnapshotSlots({ storage });
    this.places = new PlaceRegistry({ log });
    this.actions = new ActionRegistry();
    /** @type {InputRecording|null} */
    this.recording = null;
    /** @type {object|null} the last finished recording document */
    this.lastRecording = null;
    /** @type {ScriptPlayer|null} */
    this.player = null;
    /** @type {{ expected: string|null, result: { hash: string, expected: string|null, match: boolean|null, tick: number }|null }|null} */
    this.replayInfo = null;
    this.lastInput = null;
    this.lastHash = { tick: -1, hash: '' };
    this.teleportArmed = false;
    /** last pointer press on #ui, logical pixels (taps carry no position to hit-region callbacks) */
    this.lastPress = null;
    this.notice = { text: '', until: 0 };
    this.now = 0;
    this.spawnCache = new WeakMap();
    this.cleanup = [];

    for (const l of builtinLayers()) this.layers.add(l);
    this.addPlaces((sim) => this.defaultPlaces(sim));
    this.addAction({ id: 'restart', label: 'Restart (same seed)', group: 'game', run: () => this.restart(this.sim.seed) });
    this.addAction({ id: 'reseed', label: 'Reseed + restart', group: 'game', run: () => this.restart(cheats.nextSeed(this.sim.seed)) });
    this.addAction({ id: 'spawn', label: 'Player to spawn', group: 'player', run: (sim) => { cheats.resetPlayerToSpawn(sim); this.snapCamera(); } });

    this.panel = new Panel({
      storage,
      pages: [
        { id: 'time', label: 'Time' }, { id: 'layers', label: 'Lay' }, { id: 'go', label: 'Go' },
        { id: 'snap', label: 'Snap' }, { id: 'rec', label: 'Rec' }, { id: 'act', label: 'Act' },
      ],
      rows: (id) => this.rowsFor(id),
    });
    if (win) this.attach(win);
  }

  get sim() { return this.host.sim; }
  get paused() { return this.time.paused; }
  get replaying() { return !!this.player && !this.player.done; }

  // ---- extension API ------------------------------------------------------------------------------------

  /** @param {import('./OverlayRegistry.js').OverlayLayer} layer @returns {() => void} */
  addLayer(layer) { return this.layers.add(layer); }

  /** @param {(sim: object) => Array<{id:string,label:string,x:number,y:number}>} provider @returns {() => void} */
  addPlaces(provider) { return this.places.add(provider); }

  /** @param {import('./registries.js').DebugAction} action @returns {() => void} */
  addAction(action) { return this.actions.add(action); }

  // ---- wiring -------------------------------------------------------------------------------------------

  attach(win) {
    const { input, uiCanvas } = this.host;
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn, opts));
    };
    on(win, 'keydown', (e) => { if (this.onKey(e.code, e)) e.preventDefault(); });
    on(uiCanvas, 'pointerdown', (e) => { this.lastPress = this.host.input.toLogical(e); });
    on(uiCanvas, 'wheel', (e) => {
      const p = this.host.input.toLogical(e);
      const r = this.panel.rect();
      if (!this.panel.open || p.x < r.x || p.x >= r.x + r.w || p.y < r.y || p.y >= r.y + r.h) return;
      this.panel.scrollBy(e.deltaY > 0 ? 1 : -1);
      e.preventDefault();
    }, { passive: false });
    // the teleport catcher first, so the panel (added after) stays on top of it
    this.cleanup.push(input.addHitRegion('debug-teleport', () => (this.teleportArmed ? { x: 0, y: 0, w: 1e5, h: 1e5 } : null), () => this.teleportToPress()));
    this.cleanup.push(input.addHitRegion('debug-panel', () => this.panel.rect(), () => { if (this.lastPress) this.panel.tap(this.lastPress.x, this.lastPress.y); }));
  }

  /** remove every listener and hit region (tests) */
  detach() {
    for (const fn of this.cleanup.splice(0)) fn();
  }

  /**
   * A debug key. Never claims a key the game binds, and leaves Ctrl/Alt/Meta combinations to the browser.
   * @returns {boolean} handled (prevent the browser default)
   */
  onKey(code, { shiftKey = false, ctrlKey = false, altKey = false, metaKey = false, repeat = false } = {}) {
    if (ctrlKey || altKey || metaKey) return false;
    switch (code) {
      case 'Backquote': if (!repeat) this.panel.toggle(); return true;
      case 'F2': if (!repeat) this.togglePause(); return true;
      case 'F3': this.step(shiftKey ? 10 : 1); return true;
      case 'F4': if (!repeat) this.say(`speed ${speedLabel(this.time.cycleSpeed(shiftKey ? -1 : 1))}`); return true;
      case 'F8': if (!repeat) this.teleportToMouse(); return true;
      case 'F9': if (!repeat) this.saveSlot(0); return true;
      case 'F10': if (!repeat) this.loadSlot(0); return true;
      default: return false;
    }
  }

  // ---- loop hooks (called by main.js) -------------------------------------------------------------------

  /** one frame's ticks, at the chosen speed and pause state */
  advance(elapsed, tick, now) {
    this.now = now;
    const n = this.time.advance(elapsed, tick);
    this.frameStats.frame(now, n);
    return n;
  }

  /** the input for the next tick when a script is playing, else null (the live input is used) */
  nextInput() {
    if (!this.player) return null;
    const inp = this.player.next();
    if (inp) return inp;
    this.finishReplay();
    return null;
  }

  /** after every sim.step, with the input it was given */
  afterStep(input) {
    this.lastInput = input;
    this.recording?.push(input);
    const sim = this.sim;
    if (sim.tick % HASH_EVERY === 0) this.lastHash = { tick: sim.tick, hash: snapshotHash(sim) };
    if (this.player?.done) this.finishReplay();
  }

  env(alpha) {
    const input = this.host.input;
    const mouse = input.mouse ?? (input.touchVisible ? this.lastPress : null);
    return {
      camera: this.host.camera, input, assets: this.host.assets, renderer: this.host.renderer, alpha, mouse,
      lastInput: this.lastInput, debug: this, textBlock: (ctx, lines) => this.textBlock(ctx, lines),
    };
  }

  /** world overlays, after the scene */
  drawWorld(ctx, alpha) {
    if (!this.sim) return;
    this.layers.drawWorld(ctx, this.sim, this.host.camera, this.env(alpha));
  }

  /** readouts and the panel, on top of the HUD */
  drawUi(ctx, alpha) {
    const { vp, safe } = this.host;
    this.panel.setViewport(vp, safe);
    this.blockY = this.panel.m.y;
    if (this.sim) this.layers.drawUi(ctx, this.sim, vp, this.env(alpha));
    if (this.notice.text && this.now < this.notice.until) this.textBlock(ctx, [{ text: this.notice.text, color: COLORS.cursor }]);
    if (this.teleportArmed) this.textBlock(ctx, [{ text: 'tap or click where to teleport', color: COLORS.cursor }]);
    this.panel.draw(ctx);
  }

  /** a box of text lines in the readout column beside the panel; lines are strings or { text, color } */
  textBlock(ctx, lines) {
    const x = this.panel.right() + 4;
    const maxW = Math.max(60, this.host.vp.uiLogicalWidth - x - 4);
    ctx.save();
    ctx.font = '6px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const out = [];
    for (const l of lines) {
      const item = typeof l === 'string' ? { text: l, color: COLORS.text } : { color: COLORS.text, ...l };
      // wrap long lines on spaces so a long asset list stays on screen
      let rest = item.text;
      while (rest.length) {
        let cut = rest.length;
        while (cut > 8 && ctx.measureText(rest.slice(0, cut)).width > maxW) cut = rest.lastIndexOf(' ', cut - 1) > 0 ? rest.lastIndexOf(' ', cut - 1) : cut - 1;
        out.push({ text: rest.slice(0, cut), color: item.color });
        rest = rest.slice(cut).trimStart();
      }
    }
    const w = Math.min(maxW, Math.max(...out.map((l) => ctx.measureText(l.text).width), 0)) + 4;
    const h = out.length * 7 + 3;
    ctx.fillStyle = 'rgba(11, 20, 22, 0.72)';
    ctx.fillRect(x, this.blockY, w, h);
    out.forEach((l, i) => { ctx.fillStyle = l.color; ctx.fillText(l.text, x + 2, this.blockY + 2 + i * 7); });
    ctx.restore();
    this.blockY += h + 2;
  }

  /** the stats readout */
  statsLines() {
    const sim = this.sim;
    const f = this.frameStats;
    const p = sim.player;
    const rs = this.host.renderer?.stats ?? { drawn: 0, entities: 0 };
    const state = this.paused ? 'PAUSED' : speedLabel(this.time.speed);
    const lines = [
      `${f.fps.toFixed(0)} fps  ${f.frameMs.toFixed(1)} ms  worst ${f.worstMs.toFixed(1)}  ${f.ticks} t/f  ${state}`,
      `tick ${sim.tick}  t ${sim.time.toFixed(2)} s  seed ${JSON.stringify(sim.seed)}  drawn ${rs.drawn}/${rs.entities}`,
      `player ${p.x.toFixed(1)},${p.y.toFixed(1)}  tile ${Math.floor(p.x / 32)},${Math.floor(p.y / 24)}`,
      `hash@${this.lastHash.tick < 0 ? '-' : this.lastHash.tick} ${this.lastHash.hash || '-'}`,
    ];
    if (this.recording) lines.push({ text: `REC ${this.recording.ticks} ticks`, color: COLORS.bad });
    if (this.replaying) lines.push({ text: `REPLAY ${this.player.played}/${this.player.total}`, color: COLORS.cursor });
    return lines;
  }

  say(text, ms = 2500) {
    this.notice = { text, until: this.now + ms };
    this.log.info(`debug: ${text}`);
  }

  // ---- panel pages --------------------------------------------------------------------------------------

  rowsFor(id) {
    switch (id) {
      case 'time': return [
        { label: this.paused ? 'Resume (F2)' : 'Pause (F2)', on: this.paused, run: () => this.togglePause() },
        { label: 'step', cells: [{ label: '+1', run: () => this.step(1) }, { label: '+10', run: () => this.step(10) }, { label: '+60', run: () => this.step(60) }] },
        { label: 'speed', cells: SPEEDS.map((s) => ({ label: s < 1 ? '¼' : `${s}`, on: this.time.speed === s, run: () => this.setSpeed(s) })) },
        { label: `tick ${this.sim?.tick ?? 0}`, value: `${this.frameStats.ticks} t/f` },
      ];
      case 'layers': {
        const rows = [];
        for (const g of this.layers.byGroup()) {
          rows.push({ label: g.group });
          for (const l of g.layers) rows.push({ label: l.label, on: l.on, run: () => this.layers.toggle(l.id) });
        }
        return rows;
      }
      case 'go': return [
        { label: this.teleportArmed ? 'Tap the world… (cancel)' : 'Teleport to tap', on: this.teleportArmed, run: () => { this.teleportArmed = !this.teleportArmed; } },
        ...(this.sim ? this.places.list(this.sim) : []).map((pl) => ({ label: pl.label, value: `${Math.round(pl.x)},${Math.round(pl.y)}`, run: () => this.teleport(pl.x, pl.y) })),
      ];
      case 'snap': return [
        ...this.slots.summary().map((s, i) => ({
          label: `${i + 1}${s ? ` t${s.tick}` : ' -'}`,
          cells: [{ label: 'save', run: () => this.saveSlot(i) }, { label: 'load', run: () => this.loadSlot(i) }, { label: 'file', run: () => this.downloadSlot(i) }],
        })),
        { label: 'Download current', run: () => this.downloadSnapshot() },
        { label: 'Load file…', run: () => this.loadFile() },
        { label: 'hash', value: this.sim ? snapshotHash(this.sim).slice(0, 12) : '-', run: () => this.say(`hash ${this.hash()}`) },
      ];
      case 'rec': return [
        this.recording
          ? { label: 'Stop recording', on: true, value: `${this.recording.ticks} t`, run: () => this.stopRecording() }
          : { label: 'rec', cells: [{ label: 'from now', run: () => this.startRecording() }, { label: 'restart', run: () => this.startRecording({ restart: true }) }] },
        { label: 'Download last', value: this.lastRecording ? `${this.lastRecording.endTick - this.lastRecording.startTick} t` : '-', run: () => this.downloadRecording() },
        { label: 'Replay last', run: () => { if (this.lastRecording) this.replay(this.lastRecording); else this.say('nothing recorded yet'); } },
        { label: 'Replay file…', run: () => this.loadFile() },
        ...(this.replaying ? [{ label: 'Stop replay', on: true, run: () => this.finishReplay(true) }] : []),
      ];
      case 'act': {
        const rows = [];
        let group = null;
        for (const a of this.actions.list()) {
          if (a.group !== group) { group = a.group; rows.push({ label: group }); }
          rows.push({ label: a.label, run: () => this.runAction(a.id) });
        }
        return rows;
      }
      default: return [];
    }
  }

  // ---- time ---------------------------------------------------------------------------------------------

  pause() { this.time.setPaused(true); }
  resume() { this.time.setPaused(false); }
  togglePause() { this.say(this.time.togglePaused() ? 'paused' : 'running'); }

  /** run n ticks now and stay paused; returns the tick reached */
  step(n = 1) {
    this.time.step(n, () => this.host.tick());
    return this.sim.tick;
  }

  setSpeed(s) {
    const v = this.time.setSpeed(s);
    if (this.paused) this.resume();
    return v;
  }

  // ---- teleport -----------------------------------------------------------------------------------------

  snapCamera() {
    const p = this.sim.player;
    this.host.camera.snapTo(p.x, p.y);
  }

  /** move the player to a world point; returns where it ended up */
  teleport(x, y) {
    const at = cheats.teleportPlayer(this.sim, x, y);
    this.snapCamera();
    this.say(`teleported to ${Math.round(at.x)},${Math.round(at.y)}`);
    return at;
  }

  teleportToPlace(id) {
    const pl = this.places.find(this.sim, id);
    if (!pl) throw new Error(`debug: no place "${id}"`);
    return this.teleport(pl.x, pl.y);
  }

  teleportToPress() {
    this.teleportArmed = false;
    if (!this.lastPress) return;
    const w = this.host.camera.screenToWorld(this.lastPress.x, this.lastPress.y);
    this.teleport(w.x, w.y);
  }

  teleportToMouse() {
    const m = this.host.input.mouse;
    if (!m) { this.say('F8: no mouse over the game'); return; }
    const w = this.host.camera.screenToWorld(m.x, m.y);
    this.teleport(w.x, w.y);
  }

  defaultPlaces(sim) {
    let spawn = this.spawnCache.get(sim);
    if (!spawn) { spawn = cheats.spawnPoint(sim); this.spawnCache.set(sim, spawn); }
    const out = [{ id: 'spawn', label: 'Spawn', ...spawn }];
    if (!sim.map) out.push({ id: 'origin', label: 'Field origin', x: 0, y: 0 });
    const kinds = new Set();
    for (const p of sim.props ?? []) {
      if (kinds.has(p.kind)) continue;
      kinds.add(p.kind);
      // beside the prop, not inside it
      out.push({ id: `prop:${p.id}`, label: `${p.kind} ${p.id}`, x: p.x, y: p.y + (p.radius ?? 0) + 8 });
    }
    return out;
  }

  // ---- snapshots ----------------------------------------------------------------------------------------

  snapshot() { return this.sim.snapshot(); }

  hash() { return snapshotHash(this.sim); }

  /**
   * Replace the running game with a Sim rebuilt from a snapshot. Stops a recording or replay (their inputs
   * no longer follow on from the state).
   * @returns {string} the restored state's hash
   */
  restore(snap) {
    this.useSim(cheats.restoreSim(this.sim, snap), 'restored');
    return this.hash();
  }

  useSim(sim, why) {
    if (this.recording) { this.stopRecording(); this.say(`recording stopped (${why})`); }
    if (this.player) this.finishReplay(true);
    this.host.setSim(sim);
    this.lastHash = { tick: sim.tick, hash: snapshotHash(sim) };
  }

  restart(seed) {
    this.useSim(cheats.freshSim(this.sim, seed), 'restart');
    this.say(`restarted, seed ${JSON.stringify(seed)}`);
    return this.sim;
  }

  saveSlot(i) {
    const e = this.slots.save(i, this.sim.snapshot());
    this.say(`slot ${i + 1}: saved tick ${e.tick}${this.slots.persisted ? '' : ' (memory only)'}`);
    return e.hash;
  }

  loadSlot(i) {
    const e = this.slots.load(i);
    if (!e) { this.say(`slot ${i + 1} is empty`); return null; }
    const h = this.restore(e.snapshot);
    this.say(`slot ${i + 1}: back to tick ${e.tick}`);
    return h;
  }

  downloadSlot(i) {
    const e = this.slots.load(i);
    if (!e) { this.say(`slot ${i + 1} is empty`); return; }
    downloadJson(`sentinel-snapshot-t${e.tick}.json`, e.snapshot);
  }

  downloadSnapshot() {
    downloadJson(`sentinel-snapshot-t${this.sim.tick}.json`, this.sim.snapshot());
  }

  /** a snapshot or a recording from a file the viewer picks */
  loadFile() {
    pickJsonFile().then((doc) => { if (doc !== null) this.loadDoc(doc, 'file'); }).catch((e) => this.say(`could not load: ${e.message}`));
  }

  /**
   * A snapshot (has `version`) is restored; a recording or bare script is replayed.
   * @returns {string|null} hash after a restore, null for a replay (it runs in the loop)
   */
  loadDoc(doc, from = 'file') {
    if (doc && !Array.isArray(doc) && doc.version !== undefined && !doc.script) {
      const h = this.restore(doc);
      this.say(`${from}: snapshot at tick ${this.sim.tick}`);
      return h;
    }
    this.replay(doc);
    return null;
  }

  /** `?scenario=<relative url>`: fetch a snapshot or recording and load it */
  async loadScenario(url) {
    if (!isRelativeUrl(url)) throw new Error(`scenario: "${url}" must be a relative URL (the game is served from a subpath)`);
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`scenario ${url}: HTTP ${res.status}`);
    const doc = await res.json();
    this.loadDoc(doc, `scenario ${url}`);
    return this.hash();
  }

  // ---- recording and replay -----------------------------------------------------------------------------

  /** @param {{ restart?: boolean }} [opts] restart: start a fresh game with this seed and record from tick 0 */
  startRecording({ restart = false } = {}) {
    if (this.recording) this.stopRecording();
    if (restart) this.restart(this.sim.seed);
    this.recording = new InputRecording(this.sim, { fresh: restart });
    this.say(`recording from tick ${this.sim.tick}`);
    return this.sim.tick;
  }

  /** @returns {object|null} the finished recording document ({ seed, script, startTick, endTick, endHash, from? }) */
  stopRecording() {
    if (!this.recording) return null;
    this.lastRecording = this.recording.toJSON();
    this.recording = null;
    this.say(`recorded ${this.lastRecording.endTick - this.lastRecording.startTick} ticks`);
    return this.lastRecording;
  }

  downloadRecording() {
    if (!this.lastRecording) { this.say('nothing recorded yet'); return; }
    const r = this.lastRecording;
    downloadJson(`sentinel-recording-${r.seed}-t${r.startTick}-${r.endTick}.json`, r);
  }

  /**
   * Feed a recording back into the page: the game restarts from its seed (or its `from` snapshot) and the
   * script replaces the live input until it runs out, then the game pauses on the final state.
   * @param {object|Array} doc a recording document or a bare script
   * @param {{ instant?: boolean }} [opts] instant: run every tick now instead of in real time
   * @returns {{ hash: string, expected: string|null, match: boolean|null }|null} with instant, the result
   */
  replay(doc, { instant = false } = {}) {
    const rec = readRecording(doc);
    this.useSim(rec.from ? cheats.restoreSim(this.sim, rec.from) : cheats.freshSim(this.sim, rec.seed), 'replay');
    this.player = new ScriptPlayer(rec.script);
    this.replayInfo = { expected: rec.endHash, result: null };
    this.say(`replaying ${rec.ticks} ticks`);
    if (instant) {
      this.time.setPaused(true);
      while (this.player && !this.player.done) this.host.tick();
      this.finishReplay();
      return this.replayInfo.result;
    }
    this.resume();
    return null;
  }

  /** end a replay: pause on the final state and compare with the recorded hash */
  finishReplay(cancelled = false) {
    if (!this.player) return;
    const info = this.replayInfo;
    this.player = null;
    if (cancelled) { this.say('replay stopped'); return; }
    const hash = this.hash();
    info.result = { hash, expected: info.expected, match: info.expected ? hash === info.expected : null, tick: this.sim.tick };
    this.time.setPaused(true);
    this.say(`replay done at tick ${this.sim.tick}: ${hash}${info.expected ? (hash === info.expected ? ' (matches)' : ` (EXPECTED ${info.expected})`) : ''}`, 6000);
  }

  runAction(id) {
    const r = this.actions.run(id, this.sim, this);
    const a = this.actions.actions.get(id);
    if (a && id !== 'restart' && id !== 'reseed') this.say(a.label);
    return r;
  }

  // ---- window.__game ------------------------------------------------------------------------------------

  /** the object exposed as window.__game.debug (also what the smoke tool's --eval calls) */
  api() {
    const d = this;
    return {
      addLayer: (l) => d.addLayer(l),
      addPlaces: (p) => d.addPlaces(p),
      addAction: (a) => d.addAction(a),
      teleport: (x, y) => d.teleport(x, y),
      teleportTo: (id) => d.teleportToPlace(id),
      places: () => d.places.list(d.sim),
      actions: () => d.actions.list().map(({ id, label, group }) => ({ id, label, group })),
      runAction: (id) => d.runAction(id),
      snapshot: () => d.snapshot(),
      restore: (snap) => d.restore(snap),
      hash: () => d.hash(),
      saveSlot: (i = 0) => d.saveSlot(i),
      loadSlot: (i = 0) => d.loadSlot(i),
      setSpeed: (n) => d.setSpeed(n),
      step: (n = 1) => d.step(n),
      pause: () => d.pause(),
      resume: () => d.resume(),
      startRecording: (opts) => d.startRecording(opts),
      stopRecording: () => d.stopRecording(),
      get recording() { return d.recording ? { ticks: d.recording.ticks, startTick: d.recording.startTick } : null; },
      get lastRecording() { return d.lastRecording; },
      replay: (doc, opts) => d.replay(doc, opts),
      get replayResult() { return d.replayInfo?.result ?? null; },
      loadScenario: (url) => d.loadScenario(url),
      layers: {
        list: () => d.layers.list().map(({ id, label, group, on }) => ({ id, label, group, on })),
        set: (id, on) => d.layers.set(id, on),
        toggle: (id) => d.layers.toggle(id),
      },
      panel: {
        open: () => { d.panel.open = true; },
        close: () => { d.panel.open = false; },
        toggle: () => d.panel.toggle(),
        page: (id) => d.panel.setPage(d.panel.pages.findIndex((p) => p.id === id)),
        rect: () => d.panel.rect(),
        get isOpen() { return d.panel.open; },
      },
      stats: () => ({
        fps: d.frameStats.fps, frameMs: d.frameStats.frameMs, worstMs: d.frameStats.worstMs, ticksPerFrame: d.frameStats.ticks,
        tick: d.sim.tick, time: d.sim.time, seed: d.sim.seed, paused: d.paused, speed: d.time.speed,
        drawn: d.host.renderer?.stats?.drawn, entities: d.host.renderer?.stats?.entities,
        player: { x: d.sim.player.x, y: d.sim.player.y }, lastHash: d.lastHash,
      }),
    };
  }

  /** the object exposed as window.__game.loop */
  loopApi() {
    const d = this;
    return {
      pause: () => d.pause(),
      resume: () => d.resume(),
      step: (n = 1) => d.step(n),
      setSpeed: (n) => d.setSpeed(n),
      get paused() { return d.paused; },
      get speed() { return d.time.speed; },
      get ticksLastFrame() { return d.time.lastTicks; },
    };
  }
}

/**
 * Start debug mode: build it, add `debug` and `loop` to window.__game, and load `?scenario=` if given.
 * @param {DebugHost} host
 * @returns {DebugMode}
 */
export function installDebug(host) {
  const d = new DebugMode(host);
  const g = globalThis.window?.__game;
  if (g) {
    g.debug = d.api();
    g.loop = d.loopApi();
  }
  const scenario = new URLSearchParams(globalThis.location?.search ?? '').get('scenario');
  if (scenario) d.loadScenario(scenario).catch((e) => { d.say(e.message, 8000); console.warn(`debug: ${e.message}`); });
  return d;
}
