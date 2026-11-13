// View-side game object: owns the engine, routes input to commands and events to the screens.
import { GameEngine } from '../core/GameEngine.js';
import { canUse } from '../core/OverworldEngine.js';
import { bandIndex } from '../core/intox.js';
import { liveSet } from '../core/timetable.js';
import { W, H } from './CanvasRenderer.js';
import { drawText, panel, list, wrap, textWidth, C } from './ui.js';
import { overworldView } from './overworldView.js';
import { dialogueView } from './dialogueView.js';
import { CUES, CUE_SECONDS } from './WebGLPostProcess.js';

const SAVE_KEY = 'chakrageddon.save.v1', SETTINGS_KEY = 'chakrageddon.settings.v1';
export const VERSION = '1.0.55';   // keep in step with package.json (tests/scenarios.test.mjs checks)

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

export class Game {
  constructor({ assets, input, renderer, audio }) {
    this.data = assets.data; this.atlas = assets.atlas; this.images = assets.images;
    this.input = input; this.renderer = renderer; this.audio = audio;
    queueMicrotask?.(() => this.applyPictureSize());
    this.settings = { grounded: false, reducedMotion: false, textSpeed: 1, volume: 0.7, battleSpeed: 0, ...JSON.parse(store.get(SETTINGS_KEY) || '{}') };
    this.engine = null;
    this.screen = 'title';
    this.titleCursor = 0;
    this.t = 0;
    this.toast = null;
    this.views = [overworldView, dialogueView];
    this.extra = {};          // screens registered by later modules: battle, menu, shop...
    this.dialogue = dialogueView;
    this.overlays = [];
    this.log = [];            // the last lines of dialogue, battle messages and notices, newest last
  }

  register(name, view) { this.extra[name] = view; this.views.push(view); }
  saveSettings() { store.set(SETTINGS_KEY, JSON.stringify(this.settings)); this.audio?.setVolume(this.settings.volume); this.applyPictureSize(); }
  /** Options: Picture size, in whole-scale steps below the largest that fits */
  applyPictureSize() { if (!this.renderer) return; if (this.renderer.shrink !== (this.settings.pictureSize || 0)) { this.renderer.shrink = this.settings.pictureSize || 0; this.renderer.resize?.(); } }
  hasSave() { return !!store.get(SAVE_KEY); }
  rawSave() { return store.get(SAVE_KEY); }

  newGame() {
    this.engine = new GameEngine(this.data, { seed: (Date.now() & 0x7fffffff) || 1 });
    this.screen = 'play';
    overworldView.fade = 1;
    this.send({ type: 'BEGIN' });
    this.startZoneAudio();
  }
  loadGame(json) {
    try {
      this.engine = GameEngine.load(this.data, json ?? store.get(SAVE_KEY));
      this.screen = 'play'; overworldView.fade = 1; overworldView.anim = null;
      for (const v of this.views) v.reset?.(this);
      this.startZoneAudio();
      return true;
    } catch (e) { console.error(e); this.say('That save could not be read.'); return false; }
  }
  /** Debug: load a named scenario save from tests/fixtures/scenarios (dev server only). Never saves over the real game. */
  async loadScenario(name, version) {
    try {
      const index = await fetch('tests/fixtures/scenarios/index.json').then((r) => r.json());
      const v = version || index.versions[0];
      if (!index.scenarios[name]) { this.say(`Unknown scenario. Try: ${Object.keys(index.scenarios).join(', ')}`); return false; }
      const json = await fetch(`tests/fixtures/scenarios/${v}/${name}.json`).then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); });
      this.scenario = name;
      if (!this.loadGame(json)) return false;
      this.say(`Scenario ${name} (${v}). Saving is off.`);
      return true;
    } catch (e) { console.error(e); this.say('Scenarios are only available from the dev server.'); return false; }
  }
  save(manual) {
    if (this.scenario) { if (manual) this.say('Scenario mode: progress is not saved.'); return false; }
    const s = this.engine?.state;
    if (!s || s.mode !== 'OVERWORLD' && s.mode !== 'FANNY_PACK_MENU') return false;
    const ok = store.set(SAVE_KEY, this.engine.serialize());
    if (manual) this.say(ok ? 'Game saved.' : 'Saving failed (storage blocked).');
    return ok;
  }
  startZoneAudio() {
    const zone = this.data.zones[this.engine.state.zoneId];
    this.audio?.setTrack({ bpm: zone.baseBpm, mood: zone.paletteId, zone: zone.zoneId });
  }

  /** a notice at the top of the screen; several in a row wait their turn (a repeat of the one showing is dropped) */
  say(text, kind) {
    this.remember(text);
    const show = (t, k) => ({ text: t, t: 1.6 + t.length * 0.035, kind: k });
    // how high you are: several changes in a row (licking the blotter again and again) show only the latest
    if (kind === 'intox') {
      this.toasts = (this.toasts || []).filter((t) => (t.kind || null) !== 'intox');
      if (this.toast?.kind === 'intox') { this.toast = show(text, kind); return; }
    }
    if (!this.toast) { this.toast = show(text, kind); return; }
    if (this.toast.text === text) { this.toast.t = Math.max(this.toast.t, 1.2); return; }
    this.toasts = (this.toasts || []).filter((t) => (t.text ?? t) !== text).concat(kind ? { text, kind } : text).slice(-3);
  }
  remember(text, speaker) {
    const line = speaker ? `${speaker}: ${text}` : text;
    if (this.log[this.log.length - 1] === line) return;
    this.log.push(line);
    if (this.log.length > 80) this.log.shift();
  }
  /** one-shot screen effect requested by a move or event (picked up by the post-process shader) */
  cue(name) { if (name && CUES[name]) this.fxCue = { name, t: 0 }; }
  /** per-frame shader inputs; grounded mode and reduced motion are applied here */
  fx(dt) {
    const st = this.settings, target = this.screen === 'play' ? this.fxLevel() : 0;
    this.fxSmooth = (this.fxSmooth ?? 0) + (target - (this.fxSmooth ?? 0)) * Math.min(1, dt * 2.5);
    if (Math.abs(this.fxSmooth - (this.fxAudio ?? 0)) > 0.03) { this.fxAudio = this.fxSmooth; this.audio?.setTrack({ lowPass: 20000 - this.fxSmooth * 16500 }); }
    // from the Come-up a warm pad plays under the music
    const pad = this.screen === 'play' && this.engine && bandIndex(this.data.rules, this.engine.state.intox) >= 1 ? 1 : 0;
    if (pad !== this.padOn) { this.padOn = pad; this.audio?.setTrack({ highPad: pad }); }
    // a set on the festival timetable brings its own music (back to the zone's when it ends or you leave)
    const st0 = this.engine?.state;
    if (this.screen === 'play' && st0?.mode === 'OVERWORLD') {
      const live = liveSet(this.data, st0), key = `${st0.zoneId}:${live ? live.id : ''}`;
      if (key !== this.setKey) {
        const was = this.setKey; this.setKey = key;
        const z = this.data.zones[st0.zoneId];
        if (live) this.audio?.setTrack({ mood: live.mood, bpm: live.bpm, zone: `${z.zoneId}:${live.id}` });
        else if (was && !was.endsWith(':') && was.startsWith(`${z.zoneId}:`)) this.audio?.setTrack({ mood: z.paletteId, bpm: z.baseBpm, zone: z.zoneId });
      }
    } else if (st0?.mode === 'ASTRAL_BATTLE') this.setKey = null;
    let cue = 0, cueT = 0;
    if (this.fxCue) {
      this.fxCue.t += dt / (CUE_SECONDS[this.fxCue.name] || 0.5);
      if (this.fxCue.t >= 1) this.fxCue = null;
      else if (!st.grounded && !(st.reducedMotion && this.fxCue.name !== 'WARM_BLOOM' && this.fxCue.name !== 'DESATURATE')) { cue = CUES[this.fxCue.name]; cueT = this.fxCue.t; }
    }
    const bpm = this.audio?.bpm || 140;
    const phase = ((this.t * bpm) / 60) % 1;
    const crit = this.extra.battle?.on ? this.extra.battle.flash : 0;
    return { time: this.t, intox: this.fxSmooth, motion: st.reducedMotion ? 0 : 1, beat: Math.max(0, 1 - phase * 4), cue, cueT, invert: !st.grounded && !st.reducedMotion && this.fxSmooth > 0.9 && crit > 0.12 ? 1 : 0 };
  }

  exportSave() {
    const raw = this.rawSave();
    if (!raw) return this.say('Nothing saved yet.');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    a.download = 'chakrageddon-save.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.say('Save file downloaded.');
  }
  importSave() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        GameEngine.load(this.data, text);          // validates before anything is overwritten
        store.set(SAVE_KEY, text);
        this.say('Save imported. Choose Continue.');
        this.screen = 'title'; this.engine = null; this.titleCursor = 0;
      } catch (e) { console.error(e); this.say('That file is not a valid save.'); }
    };
    inp.click();
  }
  busy() { return Object.values(this.extra).some((v) => v.busy?.(this)); }
  canFlash() { const s = this.engine.state; return canUse({ data: this.data, state: s }, 'blacklight_uv_pulse'); }
  /** shader intensity 0..1 after accessibility caps */
  fxLevel() {
    if (!this.engine) return 0;
    const s = this.engine.state;
    let raw = s.battle ? s.battle.intox : s.intox;
    if (s.mode === 'FANNY_PACK_MENU' || s.mode === 'SHOP') raw *= 0.4;   // keep menus readable
    if (s.scene?.id === 'dream') raw = Math.max(raw, 0.45);              // the opening dream wobbles
    return this.settings.grounded ? Math.min(0.25, raw) : raw;
  }

  send(cmd) {
    const before = this.engine.state.mode;
    const { events } = this.engine.dispatch(cmd);
    for (const e of events) {
      for (const v of this.views) v.onEvent?.(this, e);
      if (e.type === 'AUDIO_CUE') {
        if (e.sfxId && !this.extra.battle?.on) this.audio?.sfx(e.sfxId);   // in a battle the screen plays it in turn (after the bag stops shaking)
        if (e.trackBpm) this.audio?.setTrack({ bpm: e.trackBpm, lowPass: e.lowPassFilterHz, mood: e.mood || this.data.zones[this.engine.state.zoneId].paletteId, zone: e.theme || this.engine.state.zoneId });
      }
      if (e.type === 'ZONE_CHANGED') this.autosaveSoon = true;
      if (e.type === 'MESSAGE' && !this.extra.battle?.on) this.say(e.text, e.kind);
      else if (e.type === 'MESSAGE') this.remember(e.text);
      if (e.type === 'DIALOGUE_LINE') this.remember(e.text, e.speaker);
    }
    const after = this.engine.state.mode;
    if (before === 'ASTRAL_BATTLE' && after !== 'ASTRAL_BATTLE') this.autosaveSoon = true;
    return events;
  }

  update(dt) {
    if (this.engine) this.engine.options.shift = this.settings.battleStyle !== 'set';   // Options: Battle style (Shift by default)
    this.t += dt;
    if (this.toast && (this.toast.t -= dt) <= 0) {
      const next = this.toasts?.shift(), n = typeof next === 'string' ? { text: next } : next;
      this.toast = n ? { text: n.text, t: 1.6 + n.text.length * 0.035, kind: n.kind } : null;
    }
    if (this.screen === 'title') return;
    if (this.screen !== 'play') { this.extra[this.screen]?.update(this, dt); return; }
    const mode = this.engine.state.mode;
    overworldView.update(this, dt);
    for (const v of Object.values(this.extra)) if (!v.screen) v.update?.(this, dt);
    if (this.engine.state.dialogue && !this.busy() && !overworldView.walking()) dialogueView.update(this, dt);
    if (this.autosaveSoon && mode === 'OVERWORLD' && !this.busy()) { this.autosaveSoon = false; this.save(false); }
  }

  draw(g) {
    if (this.screen === 'title') this.drawTitle(g);
    else if (this.screen !== 'play') this.extra[this.screen]?.draw(this, g);
    else {
      overworldView.draw(this, g);
      for (const v of Object.values(this.extra)) if (!v.screen) v.draw?.(this, g);
      if (this.engine.state.dialogue && !this.busy() && !overworldView.walking()) dialogueView.draw(this, g);
    }
    if (this.toast) {
      const lines = wrap(this.toast.text, W - 28);
      const w = Math.min(W - 8, Math.max(...lines.map((l) => textWidth(l))) + 16), h = lines.length * 10 + 7;
      panel(g, Math.floor((W - w) / 2), 4, w, h, { bg: C.void, accent: C.acid });
      lines.forEach((l, i) => drawText(g, l, W / 2, 8 + i * 10, { color: C.cream, align: 'center' }));
    }
  }

  drawTitle(g) {
    const t = this.t;
    g.fillStyle = C.void; g.fillRect(0, 0, W, H);
    // kaleidoscope rays
    const cols = [C.magenta, C.purple, C.cyan, C.acid];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + (this.settings.reducedMotion ? 0 : t * 0.15);
      g.strokeStyle = cols[i % 4] + '55'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(W / 2, 62); g.lineTo(W / 2 + Math.cos(a) * 260, 62 + Math.sin(a) * 260); g.stroke();
    }
    g.fillStyle = '#E8C39E'; g.fillRect(0, 128, W, 52);
    g.fillStyle = '#4FA4B8'; g.fillRect(0, 118, W, 10);
    const title = this.data.manifest.title || 'CHAKRA-GEDDON';
    for (let i = 3; i >= 0; i--) {
      g.save(); g.translate(W / 2 + i, 34 + i + Math.round(Math.sin(t * 2) * (this.settings.reducedMotion ? 0 : 2))); g.scale(3, 3);
      drawText(g, title, 0, 0, { color: i ? [C.purple, C.cyan, C.magenta][i - 1] : C.cream, align: 'center' });
      g.restore();
    }
    drawText(g, this.data.manifest.subtitle || '', W / 2, 66, { color: C.yellow, align: 'center', shadow: C.void });
    const items = [{ label: 'New trip' }];
    if (this.hasSave()) items.unshift({ label: 'Continue' });
    for (const [name, v] of Object.entries(this.extra)) if (v.titleEntry) items.push({ label: v.titleEntry, screen: name });
    panel(g, 100, 88, 120, items.length * 16 + 8, { bg: C.cream, accent: C.magenta });
    const r = list(this, g, items, 104, 92, 112, this.titleCursor, { rowH: 16 });
    this.titleCursor = r.cursor;
    if (r.chosen >= 0) {
      const it = items[r.chosen];
      if (it.label === 'Continue') this.loadGame();
      else if (it.screen) { this.screen = it.screen; this.extra[it.screen].open?.(this, 'title'); }
      else if (this.hasSave() && !this.confirmNew) { this.confirmNew = true; this.say('Press again to overwrite your save.'); }
      else { this.confirmNew = false; this.newGame(); }
    }
    drawText(g, `v${VERSION}`, W - 4, H - 10, { color: C.chai, align: 'right' });
    drawText(g, 'A satire. Hydrate. Look after each other.', 4, H - 10, { color: C.chai });
  }
}
