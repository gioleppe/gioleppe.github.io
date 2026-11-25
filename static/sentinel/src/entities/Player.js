// The player as the simulation sees it: walking with collision and terrain movement modes (step 2.3). Stealth,
// stamina, hydration and inventory arrive in M3 and grow this class.
import { TILE_W, TILE_H } from '../sim/constants.js';
import { MODES, MODE_RANK, nextModeRank, modeRankAt, speedFor, makeContact } from '../world/collision.js';

/** @typedef {'N'|'E'|'S'|'W'} Facing */

/**
 * What the player needs from the world for one tick (the Sim keeps one and refreshes it every step).
 * @typedef {Object} MoveEnv
 * @property {import('../world/collision.js').Collider} collider
 * @property {ReturnType<typeof import('../world/collision.js').terrainRules>} rules
 * @property {number} tide       tide height 0..1 this tick
 * @property {Array<Object>} events  sim.events of this step
 */

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
    /** world pixels per second (intended, before collision) */
    this.vx = 0;
    this.vy = 0;
    this.radius = radius;
    /** @type {Facing} */
    this.facing = 'S';
    /** unit vector of the last movement direction (exact aim of the body, for later sight and throw logic) */
    this.dirX = 0;
    this.dirY = 1;
    /** @type {'ground'|'wade'|'swim'} movement mode, with hysteresis at shorelines */
    this.mode = 'ground';
    /** @type {string|null} terrain under the ground point (null on the open test field) */
    this.terrain = null;
    /** normal of the last collision push of the last tick, (0, 0) when nothing was touched */
    this.contactX = 0;
    this.contactY = 0;
    /** scratch for the collider (not state) */
    this.contact = makeContact();
  }

  /** exact facing in radians (0 = east, y down); derived, so it never enters a snapshot */
  get angle() {
    return Math.atan2(this.dirY, this.dirX);
  }

  /** animation state for the presentation (the swim animation arrives with A3/3.1 and reads `mode`) */
  get state() {
    return this.vx !== 0 || this.vy !== 0 ? 'walk' : 'idle';
  }

  /**
   * Set mode and terrain from the ground under the player, without hysteresis (spawn, restore, teleport).
   * @param {MoveEnv} env
   */
  syncTerrain(env) {
    const map = env.collider.map;
    this.terrain = map.terrainAt(Math.floor(this.x / TILE_W), Math.floor(this.y / TILE_H));
    this.mode = MODES[modeRankAt(map, this.x, this.y, env.tide, env.rules)];
  }

  /**
   * Advance one tick.
   * @param {import('../sim/input.js').InputState} input already sanitised
   * @param {{ walkSpeed: number }} cfg tuning.player
   * @param {number} dt seconds
   * @param {{x:number,y:number,w:number,h:number}|null} bounds world rectangle (used without `env`), or null
   * @param {MoveEnv|null} [env] the island's collision and terrain; null on the open test field
   */
  update(input, cfg, dt, bounds, env = null) {
    this.prevX = this.x;
    this.prevY = this.y;
    let mx = input.moveX;
    let my = input.moveY;
    const len = Math.sqrt(mx * mx + my * my);
    if (len > 1) { mx /= len; my /= len; }   // diagonals are not faster than straight lines
    let speed = cfg.walkSpeed;
    if (env) {
      const map = env.collider.map;
      const tid = map.terrainIdAt(Math.floor(this.x / TILE_W), Math.floor(this.y / TILE_H));
      speed *= speedFor(tid, modeRankAt(map, this.x, this.y, env.tide, env.rules), MODE_RANK[this.mode], env.rules);
    }
    this.vx = mx * speed;
    this.vy = my * speed;
    if (env) {
      const c = env.collider.moveCircle(this.x, this.y, this.radius, this.vx * dt, this.vy * dt, this.contact);
      this.x = c.x;
      this.y = c.y;
      this.contactX = c.nx;
      this.contactY = c.ny;
      this.updateMode(env);
    } else {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (bounds) {
        this.x = Math.max(bounds.x + this.radius, Math.min(bounds.x + bounds.w - this.radius, this.x));
        this.y = Math.max(bounds.y + this.radius, Math.min(bounds.y + bounds.h - this.radius, this.y));
      }
    }
    if (len > 0) {
      this.dirX = input.moveX / len;
      this.dirY = input.moveY / len;
      this.facing = facingFor(input.moveX, input.moveY, this.facing);
    }
    // HOOK (steps 3.1 / 3.3): stamina drain while this.mode === 'swim', and drowning on flooded ground, go here.
  }

  /** terrain and mode after moving; emits `player_mode` on a change */
  updateMode(env) {
    const map = env.collider.map;
    this.terrain = map.terrainAt(Math.floor(this.x / TILE_W), Math.floor(this.y / TILE_H));
    const next = MODES[nextModeRank(map, this.x, this.y, env.tide, MODE_RANK[this.mode], env.rules)];
    if (next !== this.mode) {
      env.events.push({ type: 'player_mode', from: this.mode, to: next });
      this.mode = next;
    }
  }

  snapshot() {
    const { x, y, prevX, prevY, vx, vy, radius, facing, dirX, dirY, mode, terrain, contactX, contactY } = this;
    return { x, y, prevX, prevY, vx, vy, radius, facing, dirX, dirY, mode, terrain, contactX, contactY };
  }

  static restore(s) {
    const p = new Player({ x: s.x, y: s.y, radius: s.radius });
    Object.assign(p, {
      prevX: s.prevX, prevY: s.prevY, vx: s.vx, vy: s.vy, facing: s.facing, dirX: s.dirX, dirY: s.dirY,
      mode: s.mode ?? 'ground', terrain: s.terrain ?? null, contactX: s.contactX ?? 0, contactY: s.contactY ?? 0,
    });
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
