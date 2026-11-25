// The player as the simulation sees it. For now only walking; stealth, stamina, hydration and inventory
// arrive in M3 and grow this class.

/** @typedef {'N'|'E'|'S'|'W'} Facing */

export class Player {
  /**
   * @param {Object} opts
   * @param {number} opts.x world pixels
   * @param {number} opts.y world pixels
   * @param {number} opts.radius collision radius in world pixels
   */
  constructor({ x, y, radius }) {
    this.kind = 'player';
    this.x = x;
    this.y = y;
    /** position at the start of the last tick, for render interpolation */
    this.prevX = x;
    this.prevY = y;
    /** world pixels per second */
    this.vx = 0;
    this.vy = 0;
    this.radius = radius;
    /** @type {Facing} */
    this.facing = 'S';
    /** unit vector of the last movement direction (exact aim of the body, for later sight and throw logic) */
    this.dirX = 0;
    this.dirY = 1;
  }

  /** exact facing in radians (0 = east, y down); derived, so it never enters a snapshot */
  get angle() {
    return Math.atan2(this.dirY, this.dirX);
  }

  /** animation state for the presentation */
  get state() {
    return this.vx !== 0 || this.vy !== 0 ? 'walk' : 'idle';
  }

  /**
   * Advance one tick.
   * @param {import('../sim/input.js').InputState} input already sanitised
   * @param {{ walkSpeed: number }} cfg tuning.player
   * @param {number} dt seconds
   * @param {{x:number,y:number,w:number,h:number}|null} bounds world rectangle to stay inside, or null for an open field
   */
  update(input, cfg, dt, bounds) {
    this.prevX = this.x;
    this.prevY = this.y;
    let mx = input.moveX;
    let my = input.moveY;
    const len = Math.sqrt(mx * mx + my * my);
    if (len > 1) { mx /= len; my /= len; }   // diagonals are not faster than straight lines
    this.vx = mx * cfg.walkSpeed;
    this.vy = my * cfg.walkSpeed;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (bounds) {
      this.x = Math.max(bounds.x + this.radius, Math.min(bounds.x + bounds.w - this.radius, this.x));
      this.y = Math.max(bounds.y + this.radius, Math.min(bounds.y + bounds.h - this.radius, this.y));
    }
    if (len > 0) {
      this.dirX = input.moveX / len;
      this.dirY = input.moveY / len;
      this.facing = facingFor(input.moveX, input.moveY, this.facing);
    }
  }

  snapshot() {
    const { x, y, prevX, prevY, vx, vy, radius, facing, dirX, dirY } = this;
    return { x, y, prevX, prevY, vx, vy, radius, facing, dirX, dirY };
  }

  static restore(s) {
    const p = new Player({ x: s.x, y: s.y, radius: s.radius });
    Object.assign(p, { prevX: s.prevX, prevY: s.prevY, vx: s.vx, vy: s.vy, facing: s.facing, dirX: s.dirX, dirY: s.dirY });
    return p;
  }
}

/**
 * Four-way facing for a movement direction. On an exact diagonal the current facing is kept when it is one of
 * the two candidates, so walking diagonally does not flicker between sprites.
 * @param {number} mx
 * @param {number} my
 * @param {Facing} current
 * @returns {Facing}
 */
export function facingFor(mx, my, current) {
  const h = mx > 0 ? 'E' : 'W';
  const v = my > 0 ? 'S' : 'N';
  const ax = Math.abs(mx);
  const ay = Math.abs(my);
  if (ax > ay) return h;
  if (ay > ax) return v;
  return current === h ? h : v;
}
