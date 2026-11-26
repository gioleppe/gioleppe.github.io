// Graphics quality (step 5.6): the player's setting (Auto / High / Low) and, in Auto, a governor that drops the
// expensive effects when frames stay slow for a few seconds and tries them again once frames have been fast for a
// while. Presentation only: the levels switch drawing knobs (QUALITY_LEVELS), never anything the simulation reads.
// Pure: the caller passes frame times and a clock in (ms), so the hysteresis is testable with a fake clock.

/** what each level draws; the renderer modules read these flags every frame */
export const QUALITY_LEVELS = Object.freeze({
  high: Object.freeze({ lightingScale: 1, rainScale: 1, sway: true, distortion: true, shadows: true }),
  // lighting at half its resolution (it is smooth anyway), half the rain, no foliage sway, no Resonance split-frame
  // pulses (the vignette and rings stay), single-oval shadows
  low: Object.freeze({ lightingScale: 0.5, rainScale: 0.5, sway: false, distortion: false, shadows: false }),
});

export const QUALITY_SETTINGS = Object.freeze(['auto', 'high', 'low']);

export const GOVERNOR_DEFAULTS = Object.freeze({
  /** a frame slower than this (ms between frames) counts as slow; 60 Hz is 16.7 */
  slowMs: 22,
  /** fraction of slow frames in the window that makes the window slow */
  slowShare: 0.25,
  /** a window this long (ms) of slow frames drops to low */
  degradeAfterMs: 3000,
  /** at low, frames must stay fast this long (ms) before high is tried again; doubles after each failed try */
  recoverAfterMs: 10000,
  /** cap of that wait */
  maxRecoverMs: 120000,
  /** a high that drops again within this long (ms) of being restored counts as a failed try */
  failWithinMs: 8000,
  /** frames longer than this are pauses (tab hidden, debugger), not slowness: they are ignored */
  ignoreOverMs: 250,
});

export class QualityGovernor {
  /** @param {Partial<typeof GOVERNOR_DEFAULTS>} [cfg] */
  constructor(cfg = {}) {
    this.cfg = { ...GOVERNOR_DEFAULTS, ...cfg };
    /** 'auto' | 'high' | 'low' */
    this.setting = 'auto';
    /** the level in force in Auto */
    this.autoLevel = 'high';
    this.recoverMs = this.cfg.recoverAfterMs;
    this.windowStart = null;
    this.frames = 0;
    this.slow = 0;
    /** since when the current Auto level holds a clean run (ms clock) */
    this.goodSince = null;
    this.restoredAt = null;
    /** number of level changes made by Auto (debug readout) */
    this.changes = 0;
  }

  /** the level drawn now */
  get level() {
    return this.setting === 'auto' ? this.autoLevel : this.setting;
  }

  /** the drawing knobs of the level drawn now */
  get flags() {
    return QUALITY_LEVELS[this.level];
  }

  /** @param {'auto'|'high'|'low'} s */
  setSetting(s) {
    this.setting = QUALITY_SETTINGS.includes(s) ? s : 'auto';
    this.resetWindow(null);
  }

  resetWindow(now) {
    this.windowStart = now;
    this.frames = 0;
    this.slow = 0;
  }

  /**
   * Record one frame (Auto only acts on it).
   * @param {number} frameMs time since the previous frame
   * @param {number} now     clock, ms
   * @returns {boolean} true when the level changed on this frame
   */
  frame(frameMs, now) {
    if (this.setting !== 'auto') return false;
    if (!(frameMs >= 0) || frameMs > this.cfg.ignoreOverMs) { this.resetWindow(now); this.goodSince = now; return false; }
    if (this.windowStart === null) this.resetWindow(now);
    if (this.goodSince === null) this.goodSince = now;
    this.frames++;
    if (frameMs > this.cfg.slowMs) this.slow++;
    const c = this.cfg;
    // windows of degradeAfterMs: a slow window at high drops; any slow window resets the "good" clock
    if (now - this.windowStart >= c.degradeAfterMs) {
      const isSlow = this.frames > 0 && this.slow / this.frames >= c.slowShare;
      this.resetWindow(now);
      if (isSlow) {
        this.goodSince = now;
        if (this.autoLevel === 'high') {
          // a high restored a moment ago failed again: wait twice as long before the next try
          if (this.restoredAt !== null && now - this.restoredAt <= c.failWithinMs + c.degradeAfterMs) this.recoverMs = Math.min(c.maxRecoverMs, this.recoverMs * 2);
          this.autoLevel = 'low';
          this.changes++;
          return true;
        }
        return false;
      }
    }
    if (this.autoLevel === 'low' && now - this.goodSince >= this.recoverMs) {
      this.autoLevel = 'high';
      this.restoredAt = now;
      this.goodSince = now;
      this.resetWindow(now);
      this.changes++;
      return true;
    }
    // a long clean run at high forgives earlier failures
    if (this.autoLevel === 'high' && this.restoredAt !== null && now - this.restoredAt > c.maxRecoverMs) {
      this.recoverMs = c.recoverAfterMs;
      this.restoredAt = null;
    }
    return false;
  }
}
