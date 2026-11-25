// Stuck detection for the verification track (V3): fed once per tick with the input and the position, it
// reports when movement has been pressed for `tuning.stuck.seconds` without the position getting more than
// `tuning.stuck.epsilon` px away from where the pressing started. Pure: not part of the game state, never in a
// snapshot; bots, the fuzzer and tools/sim.mjs own one each.
//
// Note: pressing straight into a wall on purpose is "stuck" by this definition (the spec's V3 wording); scripts
// that want to exercise walls should keep changing direction more often than `seconds`.

export class StuckDetector {
  /**
   * @param {{ seconds: number, epsilon: number }} cfg tuning.stuck
   * @param {number} dt seconds per tick
   */
  constructor(cfg, dt) {
    if (!(cfg?.seconds > 0) || !(cfg?.epsilon >= 0)) throw new Error('StuckDetector: tuning.stuck needs seconds > 0 and epsilon >= 0');
    /** ticks of pressing in place that count as stuck */
    this.limitTicks = Math.max(1, Math.round(cfg.seconds / dt));
    this.eps2 = cfg.epsilon * cfg.epsilon;
    this.reset();
  }

  reset() {
    /** ticks of pressing without getting away from the anchor */
    this.pressed = 0;
    this.anchorX = 0;
    this.anchorY = 0;
    this.active = false;
    /** true while the current episode has been reported (reported once per episode) */
    this.fired = false;
    /** episodes reported so far */
    this.count = 0;
  }

  /**
   * @param {{ moveX: number, moveY: number }} input
   * @param {number} x position after the tick
   * @param {number} y
   * @returns {boolean} true on the tick a stuck episode is first detected
   */
  update(input, x, y) {
    const moving = (input.moveX !== 0 && Number.isFinite(input.moveX)) || (input.moveY !== 0 && Number.isFinite(input.moveY));
    if (!moving) { this.active = false; this.fired = false; this.pressed = 0; return false; }
    const dx = x - this.anchorX;
    const dy = y - this.anchorY;
    if (!this.active || !(dx * dx + dy * dy <= this.eps2)) {
      // first tick of pressing, or it got away (NaN positions also restart: findNonFinite reports those)
      this.active = true;
      this.fired = false;
      this.anchorX = x;
      this.anchorY = y;
      this.pressed = 0;
      return false;
    }
    this.pressed++;
    if (!this.fired && this.pressed >= this.limitTicks) {
      this.fired = true;
      this.count++;
      return true;
    }
    return false;
  }
}
