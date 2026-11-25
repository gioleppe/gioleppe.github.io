// The view onto the world: a centre point in world pixels that eases toward a target, stays inside the world
// when there is one, and can shake. The pure maths is exported separately for tests.

/**
 * Frame-rate independent exponential ease of one axis toward a target.
 * @param {number} current
 * @param {number} target
 * @param {number} rate  1/s; higher follows tighter; <= 0 or non-finite snaps
 * @param {number} dt    seconds
 */
export function followStep(current, target, rate, dt) {
  if (!(rate > 0) || !Number.isFinite(rate)) return target;
  if (!(dt > 0)) return current;
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/**
 * Keep a view of half-size `half` centred at `center` inside [min, max]; a world smaller than the view is centred.
 */
export function clampAxis(center, half, min, max) {
  if (max - min <= half * 2) return (min + max) / 2;
  return Math.max(min + half, Math.min(max - half, center));
}

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} viewW
 * @param {number} viewH
 * @param {{x:number,y:number,w:number,h:number}|null} bounds null: no clamping (open test field)
 * @returns {{x:number,y:number}}
 */
export function clampCenter(cx, cy, viewW, viewH, bounds) {
  if (!bounds) return { x: cx, y: cy };
  return {
    x: clampAxis(cx, viewW / 2, bounds.x, bounds.x + bounds.w),
    y: clampAxis(cy, viewH / 2, bounds.y, bounds.y + bounds.h),
  };
}

/**
 * Shake displacement for a given strength and time: smooth pseudo-noise from sines, so it is reproducible
 * (screenshots, replays) and needs no random source.
 * @param {number} amount pixels
 * @param {number} t seconds
 */
export function shakeOffset(amount, t) {
  if (!(amount > 0)) return { x: 0, y: 0 };
  return {
    x: amount * (Math.sin(t * 61.3) * 0.6 + Math.sin(t * 37.9 + 1.7) * 0.4),
    y: amount * (Math.sin(t * 53.1 + 0.4) * 0.6 + Math.sin(t * 29.3 + 2.9) * 0.4),
  };
}

export class Camera {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.followRate=8]  ease rate toward the target, 1/s (tuning.camera.followRate)
   * @param {number} [opts.shakeDecay=6]  shake strength lost per second, as a rate (tuning.camera.shakeDecay)
   * @param {number} [opts.maxShake=8]    cap on shake strength in pixels (tuning.camera.maxShake)
   */
  constructor({ followRate = 8, shakeDecay = 6, maxShake = 8 } = {}) {
    this.followRate = followRate;
    this.shakeDecay = shakeDecay;
    this.maxShake = maxShake;
    /** view centre in world pixels (unrounded) */
    this.x = 0;
    this.y = 0;
    this.viewW = 1;
    this.viewH = 1;
    /** @type {{x:number,y:number,w:number,h:number}|null} */
    this.bounds = null;
    /** current shake strength in pixels */
    this.shake = 0;
    this.shakeTime = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  /** size of the view in logical pixels (the #world canvas) */
  setViewport(w, h) {
    this.viewW = w;
    this.viewH = h;
    this.clamp();
  }

  /** world rectangle to stay inside, or null for none */
  setBounds(bounds) {
    this.bounds = bounds;
    this.clamp();
  }

  /** jump straight to a point (start, teleport) */
  snapTo(x, y) {
    this.x = x;
    this.y = y;
    this.clamp();
  }

  clamp() {
    const c = clampCenter(this.x, this.y, this.viewW, this.viewH, this.bounds);
    this.x = c.x;
    this.y = c.y;
  }

  /** start or strengthen a shake (e.g. from a sim event); strengths do not stack past maxShake */
  addShake(amount) {
    if (amount > 0) this.shake = Math.min(this.maxShake, Math.max(this.shake, amount));
  }

  /**
   * Advance by one rendered frame: ease toward the target and decay the shake.
   * @param {number} dt seconds of real time
   * @param {number} [tx] target x in world pixels (omit to stay)
   * @param {number} [ty]
   */
  update(dt, tx = this.x, ty = this.y) {
    this.x = followStep(this.x, tx, this.followRate, dt);
    this.y = followStep(this.y, ty, this.followRate, dt);
    this.clamp();
    if (this.shake > 0 && dt > 0) {
      this.shakeTime += dt;
      this.shake *= Math.exp(-this.shakeDecay * dt);
      if (this.shake < 0.25) this.shake = 0;
    }
    const s = shakeOffset(this.shake, this.shakeTime);
    this.shakeX = s.x;
    this.shakeY = s.y;
  }

  /** world x of the screen's left edge, whole pixels so pixel art never shimmers */
  get originX() {
    return Math.round(this.x - this.viewW / 2 + this.shakeX);
  }

  /** world y of the screen's top edge, whole pixels */
  get originY() {
    return Math.round(this.y - this.viewH / 2 + this.shakeY);
  }

  /** world pixels -> logical screen pixels */
  worldToScreen(wx, wy) {
    return { x: wx - this.originX, y: wy - this.originY };
  }

  /** logical screen pixels -> world pixels */
  screenToWorld(sx, sy) {
    return { x: sx + this.originX, y: sy + this.originY };
  }

  /**
   * The world rectangle on screen, grown by `margin` on every side.
   * @param {number} [margin=0]
   * @returns {{x:number,y:number,w:number,h:number}}
   */
  visibleRect(margin = 0) {
    return { x: this.originX - margin, y: this.originY - margin, w: this.viewW + margin * 2, h: this.viewH + margin * 2 };
  }
}
