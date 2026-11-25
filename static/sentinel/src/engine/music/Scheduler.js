// Look-ahead scheduling on the audio clock ("A Tale of Two Clocks"): a coarse timer wakes every ~25 ms and asks
// for everything in the next ~120 ms to be scheduled at exact audio-clock times.
//
// The windows handed out are contiguous and never overlap: [a, b), [b, c), ... so an event (whose time is
// computed from its absolute bar position) falls in exactly one window and is scheduled exactly once. After a
// timer stall (a busy main thread, a throttled tab) the next window starts where the last one ended, in the past;
// the receiver gets `now` and drops events that are already too late instead of playing them all in one burst.
// A suspended context freezes the audio clock, so nothing piles up while the page is hidden.

export class LookaheadScheduler {
  /**
   * @param {{ now: () => number, onWindow: (from: number, to: number, now: number) => void,
   *   lookahead?: number, interval?: number, timers?: { setInterval: Function, clearInterval: Function } }} opts
   *   `now` is the audio clock in seconds; `timers` defaults to the global ones (injected in tests)
   */
  constructor({ now, onWindow, lookahead = 0.12, interval = 0.025, timers = globalThis }) {
    this.now = now;
    this.onWindow = onWindow;
    this.lookahead = lookahead;
    this.interval = interval;
    this.timers = timers;
    /** end of the last window handed out; null before the first tick */
    this.until = null;
    this.handle = null;
    /** longest gap seen between ticks, in audio seconds (for diagnostics) */
    this.maxGap = 0;
    this.lastTick = null;
  }

  get running() { return this.handle !== null; }

  /** start the timer (and schedule the first window right away) */
  start() {
    if (this.handle !== null) return;
    this.handle = this.timers.setInterval(() => this.tick(), this.interval * 1000);
    this.tick();
  }

  stop() {
    if (this.handle === null) return;
    this.timers.clearInterval(this.handle);
    this.handle = null;
  }

  /**
   * Hand out the next window up to `now + lookahead`. Safe to call at any time and any number of times.
   * @returns {[number, number] | null} the window, or null if there was nothing new
   */
  tick() {
    const now = this.now();
    if (this.lastTick !== null) this.maxGap = Math.max(this.maxGap, now - this.lastTick);
    this.lastTick = now;
    const from = this.until ?? now;
    const to = now + this.lookahead;
    if (!(to > from)) return null;
    this.until = to;
    this.onWindow(from, to, now);
    return [from, to];
  }

  /** schedule everything up to `time` in one window (offline rendering) */
  flushUntil(time) {
    const from = this.until ?? 0;
    if (!(time > from)) return null;
    this.until = time;
    this.onWindow(from, time, from);
    return [from, time];
  }
}

/**
 * When a note whose window comes round at `now` should start: at its own time if that is still ahead (or only
 * slightly past: then now), or null when it is more than `tolerance` seconds late and must be dropped.
 */
export function startTimeFor(eventTime, now, tolerance) {
  if (eventTime < now - tolerance) return null;
  return Math.max(eventTime, now);
}
