// Frame timing for the debug readout: smoothed fps and frame time, the worst frame of the last second, and
// ticks per frame. Pure: the caller passes timestamps in.

export class FrameStats {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.smoothing=0.1] weight of the newest frame in the moving average
   * @param {number} [opts.windowMs=1000] span of the "worst frame" window
   */
  constructor({ smoothing = 0.1, windowMs = 1000 } = {}) {
    this.smoothing = smoothing;
    this.windowMs = windowMs;
    /** smoothed frame time in ms (0 until the second frame) */
    this.frameMs = 0;
    /** worst frame time in the last window, ms */
    this.worstMs = 0;
    /** ticks run by the last frame */
    this.ticks = 0;
    /** smoothed ticks per frame */
    this.ticksAvg = 0;
    this.frames = 0;
    this.last = null;
    /** @type {Array<{ t: number, ms: number }>} */
    this.recent = [];
  }

  /**
   * Record one frame.
   * @param {number} now   ms timestamp (requestAnimationFrame's)
   * @param {number} ticks ticks the frame ran
   */
  frame(now, ticks) {
    this.frames++;
    this.ticks = ticks;
    this.ticksAvg = this.frames === 1 ? ticks : this.ticksAvg + (ticks - this.ticksAvg) * this.smoothing;
    if (this.last !== null) {
      const ms = Math.max(0, now - this.last);
      this.frameMs = this.frameMs === 0 ? ms : this.frameMs + (ms - this.frameMs) * this.smoothing;
      this.recent.push({ t: now, ms });
    }
    this.last = now;
    while (this.recent.length && this.recent[0].t < now - this.windowMs) this.recent.shift();
    this.worstMs = this.recent.reduce((m, r) => Math.max(m, r.ms), 0);
  }

  /** smoothed frames per second (0 before two frames) */
  get fps() {
    return this.frameMs > 0 ? 1000 / this.frameMs : 0;
  }
}
