// Debug time controls: pause, single step and play speed. Presentation-side only: a faster speed feeds the
// fixed-step loop more seconds per real second, so more ticks run per frame; a tick is always DT. Pure (no
// DOM), so the per-frame maths is unit-tested.

/** the speeds the panel offers */
export const SPEEDS = Object.freeze([0.25, 1, 2, 4, 8]);

/**
 * How many whole ticks may run in one frame at a speed: the loop's own cap, scaled with the speed (×8 must be
 * able to run 8 ticks in a 60 Hz frame) but never unbounded, so a slow machine at ×8 drops backlog instead
 * of locking the page (the spiral-of-death guard still holds).
 * @param {number} baseMaxSteps the FixedStep cap at ×1
 * @param {number} speed
 * @param {number} [hardCap=64]
 */
export function maxStepsAt(baseMaxSteps, speed, hardCap = 64) {
  return Math.min(hardCap, Math.max(1, Math.ceil(baseMaxSteps * Math.max(1, speed))));
}

export class TimeControl {
  /**
   * @param {import('../FixedStep.js').FixedStep} stepper the page's loop accumulator
   */
  constructor(stepper) {
    this.stepper = stepper;
    this.baseMaxFrame = stepper.maxFrame;
    this.baseMaxSteps = stepper.maxSteps;
    this.speed = 1;
    this.paused = false;
    /** ticks run by the last `advance` */
    this.lastTicks = 0;
  }

  /** @param {number} speed one of SPEEDS (others are clamped into 0.25..8) */
  setSpeed(speed) {
    const s = Number(speed);
    this.speed = Number.isFinite(s) ? Math.min(SPEEDS[SPEEDS.length - 1], Math.max(SPEEDS[0], s)) : 1;
    return this.speed;
  }

  /** next (dir > 0) or previous speed in SPEEDS */
  cycleSpeed(dir = 1) {
    let i = SPEEDS.indexOf(this.speed);
    if (i < 0) i = SPEEDS.indexOf(1);
    return this.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + (dir > 0 ? 1 : -1)))]);
  }

  setPaused(on) {
    this.paused = !!on;
    if (this.paused) this.holdAlpha();
    else this.stepper.reset();   // resume from now, without a burst of catch-up ticks
  }

  togglePaused() {
    this.setPaused(!this.paused);
    return this.paused;
  }

  /**
   * Run `n` ticks right now and stay paused (pauses first if needed). Synchronous, so it is exact.
   * @param {number} n
   * @param {() => void} tick one simulation step
   * @returns {number} ticks run
   */
  step(n, tick) {
    const count = Math.max(0, Math.floor(Number(n) || 0));
    this.paused = true;
    for (let i = 0; i < count; i++) tick();
    this.holdAlpha();
    return count;
  }

  /**
   * One frame of the loop: what `stepper.advance(elapsed, tick)` does in the game, at the chosen speed.
   * @param {number} elapsed real seconds since the last frame
   * @param {() => void} tick
   * @returns {number} ticks run
   */
  advance(elapsed, tick) {
    if (this.paused) {
      this.holdAlpha();
      this.lastTicks = 0;
      return 0;
    }
    const st = this.stepper;
    const e = Number.isFinite(elapsed) && elapsed > 0 ? Math.min(elapsed, this.baseMaxFrame) : 0;   // a stall is cut in real time first
    st.maxFrame = this.baseMaxFrame * Math.max(1, this.speed);
    st.maxSteps = maxStepsAt(this.baseMaxSteps, this.speed);
    try {
      // a tick may pause (a replay reaching its end): the rest of this frame's ticks are then skipped
      let ran = 0;
      st.advance(e * this.speed, () => { if (!this.paused) { tick(); ran++; } });
      this.lastTicks = ran;
    } finally {
      st.maxFrame = this.baseMaxFrame;
      st.maxSteps = this.baseMaxSteps;
    }
    return this.lastTicks;
  }

  /** while paused, draw the latest tick (interpolation alpha just under 1) rather than the one before it */
  holdAlpha() {
    this.stepper.acc = this.stepper.dt * 0.999;
  }
}
