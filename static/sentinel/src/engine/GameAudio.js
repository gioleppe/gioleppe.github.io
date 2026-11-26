// The game's audio, as the rest of the page sees it: one object that owns the AudioManager (context, buses, volumes),
// the music engine and its director, and (step 5.5) the sound effects and ambience. Presentation only: it reads the
// simulation and its events, never writes them; with no audio at all (headless, a browser without Web Audio, before
// the first gesture) every call is a cheap no-op and the game runs the same.
//
//   const gameAudio = new GameAudio();
//   gameAudio.attachUnlock(window);              // the first key or touch starts audio
//   gameAudio.configure(tuning); gameAudio.load(fetchJson);
//   // after every sim.step:   gameAudio.onStep(sim);
//   // once per frame:         gameAudio.frame(sim, { paused });
//
// Hooks for other steps (all safe before the unlock and before load):
//   gameAudio.setScreen('title' | 'game' | 'gameover' | 'ending_dinghy' | 'ending_rescue'), and the shell's ids
//     'pause' | 'opening' | 'ending' (see setScreen); gameAudio.muted / setMuted(on) for the settings screen
//   gameAudio.holdout.start() / .stop() / .active / .elapsed      (step 5.4: the 60 s Signal Peak holdout)
//   gameAudio.volume.get('master' | 'music' | 'sfx') / .set(bus, 0..1) / .mute(on) / .muted / .onChange(fn)
import { AudioManager, BUSES } from './AudioManager.js';
import { Music } from './music/Music.js';
import { MusicDirector } from './music/MusicDirector.js';
import { mixFor, ThreatTracker, SCREENS, DIRECTOR_DEFAULTS } from './music/director.js';
import { gameAudioState, playerAudioState, rawThreat, coastProximity } from './music/gameAudioState.js';
import { Sfx } from './sfx/Sfx.js';
import { ambienceFor } from './sfx/mixRules.js';

/** the shell's screen ids (src/ui/Screens.js) that are not music screens: id -> (current music screen) -> new one or null */
const SHELL_SCREENS = Object.freeze({
  pause: () => null,
  ending: () => null,
  opening: (cur) => (cur === 'title' ? null : 'game'),
});

/** where the player hears from: position, the terrain lookup the impact sounds use, and where a scout stands */
const listenerOf = (sim) => ({
  x: sim.player.x, y: sim.player.y,
  terrainAt: (x, y) => (sim.map ? sim.map.terrainAtWorld(x, y) : null),
  scoutAt: (id) => sim.scouts?.byId?.(id) ?? null,
});

/**
 * The director's settings from the tuning: tuning.audio.director plus the Resonance tier thresholds.
 * @param {object} [tuning]
 */
export function directorConfig(tuning) {
  const t = tuning?.resonance?.tiers;
  return {
    ...DIRECTOR_DEFAULTS,
    ...(tuning?.audio?.director ?? {}),
    ...(t ? { hummingAt: t.hummingAt, agitatedAt: t.agitatedAt } : {}),
    ...(tuning?.resonance?.max ? { maxResonance: tuning.resonance.max } : {}),
  };
}

/**
 * Build the whole game audio graph on any context (live, or an OfflineAudioContext for the scene renders):
 *   music engine -> tone (low-pass) -> duck (director) -> side (sfx side-chain) -> buses.music
 *   sound effects and ambience -> buses.sfx
 * and return the two per-tick entry points. The scene renderer (tools/audio/) drives exactly this.
 * @param {{ ctx: BaseAudioContext, buses: { music: AudioNode, sfx: AudioNode }, scores: object[], tuning?: object,
 *   live?: boolean, random?: () => number }} opts
 */
export function createAudioRig({ ctx, buses, scores, tuning = null, live = true, random = Math.random }) {
  const cfg = tuning?.audio ?? {};
  const dcfg = directorConfig(tuning);
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 20000;
  tone.Q.value = 0.5;
  const duck = ctx.createGain();
  const side = ctx.createGain();
  tone.connect(duck).connect(side).connect(buses.music);
  const music = new Music({ context: ctx, output: tone, live });
  music.load(scores);
  const director = new MusicDirector({ music, duck, tone, cfg: cfg.musicDirector, offline: !live });
  const sfx = new Sfx({ ctx, out: buses.sfx, musicSide: side, cfg: cfg.sfx ?? {}, random });
  const ambCfg = { ...dcfg, pauseAmbience: cfg.sfx?.pauseAmbience ?? 0.5 };
  return {
    music, director, sfx, tone, duck, side,
    /** once per frame */
    frame(mix, record, player, simDt) {
      director.update(mix);
      sfx.frame(record, player, simDt, ambienceFor(record, ambCfg));
      if (!live) music.renderUntil(ctx.currentTime + 0.3);
    },
    /** after every simulation step: `listener` is { x, y, terrainAt } */
    onEvents(events, listener) { sfx.onEvents(events, listener); },
    dispose() { music.dispose(); sfx.dispose(); },
  };
}

export class GameAudio {
  /**
   * @param {{ settings?: object, AudioContextClass?: Function, doc?: Document, tuning?: object }} [opts]
   */
  constructor({ settings, AudioContextClass, doc, tuning } = {}) {
    this.audio = new AudioManager({ settings, AudioContextClass, doc });
    this.screen = 'game';
    this.scores = null;
    this.rig = null;
    this.simTime = 0;
    this.holdoutStart = null;
    this.mix = null;
    this.record = null;
    /** debug: a partial state record merged over the real one (audioDebug.js forces director states with it) */
    this.forced = null;
    this.coastNear = 1;
    this.coastAt = -Infinity;
    this.lastSimTime = null;
    this.wasJournal = null;
    this.perf = { frameMs: 0, stepMs: 0, frames: 0, worstFrameMs: 0 };
    this.configure(tuning);

    const a = this.audio;
    /** the volume API the settings/pause screen calls */
    this.volume = Object.freeze({
      buses: BUSES,
      get: (bus) => a.getVolume(bus),
      set: (bus, v) => a.setVolume(bus, v),
      mute: (on = true) => a.setMuted(on),
      get muted() { return a.muted; },
      onChange: (fn) => a.onChange(fn),
    });
    const self = this;
    /** step 5.4: the Signal Peak holdout (sections at 0/15/30/45 s of simulation time) */
    this.holdout = Object.freeze({
      start() { self.holdoutStart = self.simTime; },
      stop() { self.holdoutStart = null; },
      get active() { return self.holdoutStart !== null; },
      get elapsed() { return self.holdoutStart === null ? 0 : Math.max(0, self.simTime - self.holdoutStart); },
    });
  }

  /** read the tuning (safe to call again) */
  configure(tuning) {
    this.tuning = tuning ?? null;
    this.cfg = tuning?.audio ?? {};
    this.directorCfg = directorConfig(tuning);
    this.threat = new ThreatTracker(this.cfg.threat);
  }

  /** the AudioContext state ('none' before the first gesture) */
  get state() { return this.audio.state; }

  /** resume audio on the first gesture on `target` */
  attachUnlock(target) { return this.audio.attachUnlock(target); }

  /** start audio now (from a gesture handler, or programmatically in tools) */
  unlock() { return this.audio.unlock(); }

  /**
   * Fetch the scores listed in data/music/index.json. Failure leaves the game silent, never broken.
   * @param {(url: string) => Promise<any>} fetchJson
   */
  async load(fetchJson) {
    try {
      const index = await fetchJson('data/music/index.json');
      const ids = index.tracks.filter((id) => id !== 'test_tones');
      this.scores = await Promise.all(ids.map((id) => fetchJson(`data/music/${id}.json`)));
    } catch (e) {
      console.warn(`audio: no music (${e.message})`);
      this.scores = [];
    }
    return this;
  }

  /** the settings screen's mute (audioAdapter reads `muted` / calls `setMuted`) */
  get muted() { return this.audio.muted; }
  setMuted(on) { this.audio.setMuted(!!on); }

  /**
   * The music's screen. Also takes the shell's screen ids (src/ui/Screens.js calls this on every switch):
   * 'pause' keeps the game's music (the paused flag of frame() ducks it), 'opening' keeps the title's music after
   * the title (and starts the game's after a game over: Retry), 'ending' changes nothing (the endings step names
   * 'ending_dinghy' or 'ending_rescue' itself).
   * @param {'title'|'game'|'gameover'|'ending_dinghy'|'ending_rescue'|'pause'|'opening'|'ending'} screen
   */
  setScreen(screen) {
    if (SHELL_SCREENS[screen]) screen = SHELL_SCREENS[screen](this.screen);
    if (!screen) return;
    if (!SCREENS.includes(screen)) throw new RangeError(`unknown screen "${screen}" (${SCREENS.join(', ')})`);
    if (screen === this.screen) return;
    if (screen === 'game') { this.threat.reset(); this.holdoutStart = null; }
    this.screen = screen;
  }

  /** after every sim.step: the events of this tick and the threat level at this tick's time */
  onStep(sim) {
    const t0 = performance.now();
    this.simTime = sim.time;
    this.threat.update(this.forced?.threat ?? rawThreat(sim), sim.time);
    if (this.rig && sim.events.length) this.rig.onEvents(sim.events, listenerOf(sim));
    this.perf.stepMs += performance.now() - t0;
  }

  /**
   * Debug and tools: play events as if a step had raised them (the scouts' events before the AI exists).
   * @param {object[]} events
   * @param {object} sim for the listener position and terrain
   */
  inject(events, sim) {
    if (this.rig) this.rig.onEvents(events, listenerOf(sim));
  }

  /** debug: play one recipe at the listener */
  playSfx(name, opts = {}) { return this.rig ? this.rig.sfx.play(name, opts) : null; }

  /**
   * Once per frame: the state record, the director, the ambience and the player's body sounds.
   * @param {object} sim
   * @param {{ paused?: boolean, journal?: boolean }} [ui] paused: no ticks run (Journal, pause, title, game over);
   *   journal: the Journal is open (its page sounds; defaults to `paused`)
   */
  frame(sim, { paused = false, journal = paused } = {}) {
    const t0 = performance.now();
    const simDt = this.lastSimTime === null ? 0 : Math.min(0.5, Math.max(0, sim.time - this.lastSimTime));
    this.lastSimTime = sim.time;
    this.simTime = sim.time;
    if (sim.time - this.coastAt > 0.5 || sim.time < this.coastAt) {
      this.coastAt = sim.time;
      this.coastNear = coastProximity(sim.map, sim.player.x, sim.player.y);
    }
    const record = gameAudioState(sim, {
      screen: this.screen, paused, threat: this.threat.level, coastNear: this.coastNear,
      holdout: this.holdoutStart === null ? null : { elapsed: this.holdout.elapsed },
    });
    // a forced threat goes through the tracker (onStep), like the real one; the rest of a forced record wins here
    const { threat: _t, ...forced } = this.forced ?? {};
    this.record = this.forced ? { ...record, ...forced, resonance: { ...record.resonance, ...(forced.resonance ?? {}) } } : record;
    this.mix = mixFor(this.record, this.directorCfg);
    const building = !this.rig;
    if (building) this.#build();
    if (this.rig) {
      // the Journal (and later the pause screen) opening and closing
      if (this.wasJournal !== null && journal !== this.wasJournal) this.rig.sfx.play(journal ? 'journal_open' : 'journal_close');
      this.rig.frame(this.mix, this.record, playerAudioState(sim), simDt);
    }
    this.wasJournal = journal;
    const ms = performance.now() - t0;
    this.perf.frameMs += ms;
    this.perf.frames++;
    // the frame that builds the graph (the reverb's impulse response, the noise buffers) is counted apart
    if (!(building && this.rig)) this.perf.worstFrameMs = Math.max(this.perf.worstFrameMs, ms);
  }

  /** the graph is built once the context runs and the scores are in */
  #build() {
    if (this.audio.state !== 'running' || !this.scores) return;
    const t0 = performance.now();
    this.rig = createAudioRig({ ctx: this.audio.context, buses: this.audio.buses, scores: this.scores, tuning: this.tuning });
    this.perf.buildMs = performance.now() - t0;
  }
  /** a JSON-friendly picture for the debug readout and the soak tool */
  info() {
    const r = this.rig;
    const f = this.perf.frames || 1;
    return {
      state: this.state, screen: this.screen, loaded: !!this.scores,
      record: this.record, mix: this.mix, threat: this.threat.level,
      holdout: this.holdout.active ? this.holdout.elapsed : null,
      director: r?.director?.state() ?? null,
      music: r?.music ? (({ tracks, ...rest }) => ({ ...rest, tracks: tracks.map((t) => `${t.id}${t.stopping ? '(out)' : ''}`) }))(r.music.state()) : null,
      sfx: r?.sfx?.info?.() ?? null,
      perf: { frameMs: this.perf.frameMs / f, stepMs: this.perf.stepMs / f, worstFrameMs: this.perf.worstFrameMs, frames: this.perf.frames, buildMs: this.perf.buildMs ?? null },
    };
  }
}
