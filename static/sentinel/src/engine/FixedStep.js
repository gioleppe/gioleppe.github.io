// Fixed-timestep accumulator: the simulation always advances in whole ticks of `dt`, however irregular the
// animation frames are. Pure (no DOM) so the catch-up and clamp rules are unit-tested.

export class FixedStep {
  /**
   * @param {Object} opts
   * @param {number} opts.dt          seconds per tick
   * @param {number} [opts.maxFrame]  longest frame time accepted, in seconds; longer gaps (a stall, a debugger) are cut to this
   * @param {number} [opts.maxSteps]  most ticks run in one frame; the rest of the backlog is dropped (spiral-of-death guard)
   */
  constructor({ dt, maxFrame = 0.25, maxSteps = 8 }) {
    if (!(dt > 0)) throw new Error('FixedStep: dt must be > 0');
    this.dt = dt;
    this.maxFrame = maxFrame;
    this.maxSteps = maxSteps;
    this.acc = 0;
  }

  /**
   * Feed the real time elapsed since the last frame and run as many ticks as it pays for.
   * @param {number} elapsed seconds
   * @param {() => void} step called once per tick
   * @returns {number} ticks run
   */
  advance(elapsed, step) {
    const e = Number.isFinite(elapsed) && elapsed > 0 ? Math.min(elapsed, this.maxFrame) : 0;
    this.acc += e;
    let n = 0;
    while (this.acc >= this.dt && n < this.maxSteps) {
      step();
      this.acc -= this.dt;
      n++;
    }
    if (this.acc >= this.dt) this.acc %= this.dt;   // too far behind: drop the backlog rather than fall further behind
    return n;
  }

  /** fraction of a tick accumulated but not yet simulated, 0..1, for render interpolation */
  get alpha() {
    return this.acc / this.dt;
  }

  /** forget accumulated time (after the tab was hidden, so it does not try to catch up) */
  reset() {
    this.acc = 0;
  }
}
