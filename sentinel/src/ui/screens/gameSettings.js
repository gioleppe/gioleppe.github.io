// The player's preferences (Settings screen, step 5.1), remembered with the same guarded localStorage wrapper as
// the audio settings (engine/Settings.js) under their own key, and applied live:
//   resonanceFx   0..1  comfort scale of the Resonance screen effects (times tuning.resonanceFx.intensity; 0 = off)
//   screenShake   bool  camera shake from sim events
//   hints         bool  the three one-line first-time hints
//   hintsSeen     ids   hints already shown on this profile
//   touchOpacity  0.4..1.6  scale of the touch controls' opacity
//   endingsSeen   ids   the endings reached on this profile ('dinghy', 'rescue'; EndingScreen.js)
//   quality       'auto' | 'high' | 'low'  graphics quality (engine/Quality.js; Auto drops effects while frames are slow)
// Volumes are not stored here: the audio keeps its own (through the audio adapter).
import { Settings } from '../../engine/Settings.js';

export const PREFS_KEY = 'sentinel.prefs.v1';
export const PREF_DEFAULTS = Object.freeze({ resonanceFx: 1, screenShake: true, hints: true, hintsSeen: [], touchOpacity: 1, endingsSeen: [], quality: 'auto' });
export const RESONANCE_STEPS = Object.freeze([0, 0.25, 0.5, 0.75, 1]);
export const OPACITY_RANGE = Object.freeze({ min: 0.4, max: 1.6, step: 0.2 });
/** every key of the game in storage starts so; debug snapshots (sentinel.debug.*) are not player data */
export const DATA_PREFIX = 'sentinel.';
const KEEP_PREFIX = 'sentinel.debug.';

const round2 = (v) => Math.round(v * 100) / 100;

/** the next value of a stepped setting (clamped) */
export function stepValue(v, dir, { min, max, step }) {
  return round2(Math.max(min, Math.min(max, round2(v) + dir * step)));
}

/** the next value in a list of steps */
export function stepList(list, v, dir) {
  let i = list.findIndex((x) => Math.abs(x - v) < 1e-6);
  if (i < 0) i = list.reduce((b, x, j) => (Math.abs(x - v) < Math.abs(list[b] - v) ? j : b), 0);
  return list[Math.max(0, Math.min(list.length - 1, i + dir))];
}

export class GameSettings {
  /**
   * @param {Object} opts
   * @param {Object|null} [opts.storage] localStorage-like (default: the page's, guarded)
   * @param {Object} opts.tuning the loaded tuning (its presentation blocks are scaled live)
   */
  constructor({ storage, tuning }) {
    this.storage = storage;
    this.store = new Settings({ ...(storage !== undefined ? { storage } : {}), key: PREFS_KEY, defaults: PREF_DEFAULTS });
    this.tuning = tuning;
    /** the tuned values the preferences scale */
    this.base = {
      resonanceIntensity: tuning?.resonanceFx?.intensity ?? 1,
      opacity: { ...(tuning?.input?.opacity ?? {}) },
    };
    this.input = null;
    /** @type {import('../../engine/Quality.js').QualityGovernor|null} */
    this.quality = null;
  }

  get(name) { return this.store.get(name); }

  /** set, persist and apply at once; returns false if it could only be kept in memory */
  set(name, value) {
    const ok = this.store.set(name, value);
    this.apply();
    return ok;
  }

  /**
   * Apply the preferences to the live game: the Resonance effects' intensity (read by ResonanceFx every frame) and
   * the touch controls' opacity. Presentation tuning only: the simulation never reads these blocks.
   * @param {{ input?: Object }} [targets]
   */
  apply({ input = this.input, quality = this.quality } = {}) {
    this.input = input;
    this.quality = quality;
    quality?.setSetting(String(this.get('quality')));
    const fx = this.tuning?.resonanceFx;
    if (fx) fx.intensity = round2(this.base.resonanceIntensity * Number(this.get('resonanceFx')));
    if (input?.cfg) {
      const k = Number(this.get('touchOpacity')) || 1;
      const opacity = Object.fromEntries(Object.entries(this.base.opacity).map(([key, v]) => [key, Math.min(1, round2(v * k))]));
      input.cfg = { ...input.cfg, opacity };
    }
  }

  /** shake the camera on `shake` events */
  get shake() { return this.get('screenShake') !== false; }

  get hintsOn() { return this.get('hints') !== false; }

  hintSeen(id) {
    const seen = this.get('hintsSeen');
    return Array.isArray(seen) && seen.includes(id);
  }

  markHint(id) {
    if (this.hintSeen(id)) return;
    const seen = Array.isArray(this.get('hintsSeen')) ? this.get('hintsSeen') : [];
    this.store.set('hintsSeen', [...seen, id]);
  }

  /**
   * Reset all data: every stored key of the game (saves, preferences, audio settings), then the defaults applied.
   * @returns {number} keys removed
   */
  resetAll() {
    let removed = 0;
    const s = this.storage === undefined ? safeLocalStorage() : this.storage;
    try {
      const keys = [];
      for (let i = 0; i < (s?.length ?? 0); i++) {
        const k = s.key(i);
        if (k && k.startsWith(DATA_PREFIX) && !k.startsWith(KEEP_PREFIX)) keys.push(k);
      }
      for (const k of keys) { s.removeItem(k); removed++; }
    } catch { /* storage blocked: only the memory copy resets */ }
    for (const k of Object.keys(PREF_DEFAULTS)) this.store.remove(k);
    this.store.values = {};
    this.apply();
    return removed;
  }
}

function safeLocalStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
