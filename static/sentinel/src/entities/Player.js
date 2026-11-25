// The player as the simulation sees it: walking with collision and terrain movement modes (step 2.3), and the
// body of M3: movement states and stamina (3.1). Every number comes from tuning; the Sim lends the player what
// it needs for one tick (PlayerEnv) and collects its events from `outbox` after every step.
import { TILE_W, TILE_H, TICK_HZ } from '../sim/constants.js';
import { MODES, MODE_RANK, nextModeRank, modeRankAt, speedFor, makeContact } from '../world/collision.js';
import { waterAt } from '../world/water.js';
import { noiseFor } from '../world/Noise.js';

/** @typedef {'N'|'E'|'S'|'W'} Facing */
/** @typedef {'idle'|'walk'|'crouch'|'sneak'|'sprint'|'swim'} PlayerState  exactly the player sheet's animation states */

/** every value `player.state` can take (the renderer picks the animation by it) */
export const PLAYER_STATES = Object.freeze(['idle', 'walk', 'crouch', 'sneak', 'sprint', 'swim']);

/**
 * What the player needs from the world for one tick (the Sim keeps one and refreshes it every step).
 * @typedef {Object} MoveEnv
 * @property {import('../world/collision.js').Collider} collider
 * @property {ReturnType<typeof import('../world/collision.js').terrainRules>} rules
 * @property {number} tide       tide height 0..1 this tick
 * @property {Array<Object>} events  sim.events of this step
 */

/**
 * Everything the Sim lends the player for one tick.
 * @typedef {Object} PlayerEnv
 * @property {Object} tuning   the whole tuning object
 * @property {number} dt       seconds per tick
 * @property {number} tick     the tick being simulated
 * @property {{x:number,y:number,w:number,h:number}|null} bounds  world rectangle (used without `move`), or null
 * @property {MoveEnv|null} move  the island's collision and terrain; null on the open test field
 * @property {import('../world/WorldState.js').WorldState|null} world
 */

/** the body's state fields, in snapshot order (all plain values); missing ones restore as in a new game */
const BODY_FIELDS = Object.freeze([
  'state', 'stance', 'sprinting', 'stamina', 'staminaCap', 'restTicks',
  'noiseRadius', 'noiseSurface', 'inCover', 'printTravel',
  'hydration', 'health', 'bleedTicks', 'limpTicks', 'drowning', 'dead', 'deathCause', 'distance', 'noNeeds',
]);

/** seconds to whole ticks (timers count ticks so they never drift) */
const ticks = (s) => Math.round(s * TICK_HZ);

export class Player {
  /**
   * @param {Object} opts
   * @param {number} opts.x world pixels
   * @param {number} opts.y world pixels
   * @param {number} opts.radius collision radius in world pixels
   * @param {Object} [opts.tuning] the whole tuning object (stamina and friends start from it)
   */
  constructor({ x, y, radius, tuning = null }) {
    this.kind = 'player';
    /** the tuning this player reads (a reference, never part of a snapshot) */
    this.tuning = tuning;
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

    // ---- movement state (3.1) ----
    /** @type {PlayerState} the animation state; exactly one of PLAYER_STATES */
    this.state = 'idle';
    /** @type {'stand'|'crouch'} */
    this.stance = 'stand';
    /** true while a sprint is under way (sprint held, moving, standing, not swimming, stamina left) */
    this.sprinting = false;
    /** 0..staminaCap */
    this.stamina = tuning?.stamina?.max ?? 100;
    /** the most stamina can be right now (lowered by thirst in step 3.3) */
    this.staminaCap = tuning?.stamina?.max ?? 100;
    /** ticks since the last exertion (sprint or swim); regeneration waits for stamina.regenDelaySeconds */
    this.restTicks = 0;

    // ---- noise, cover, footprints (3.2) ----
    /** world px: how far the player's footsteps carry this tick, after the weather (0 when silent) */
    this.noiseRadius = 0;
    /** the noise table row used this tick ('sand', 'jungle_floor', 'water', 'swim', ...) */
    this.noiseSurface = tuning?.noise?.defaultSurface ?? 'sand';
    /** crouched inside a cover prop's radius */
    this.inCover = false;
    /** px walked on wet sand since the last footprint */
    this.printTravel = 0;

    // ---- hydration and health (3.3) ----
    /** 0..hydration.max */
    this.hydration = tuning?.hydration?.max ?? 100;
    /** 0..health.max */
    this.health = tuning?.health?.max ?? 100;
    /** ticks of bleeding left (an arrow hit); stopBleeding() (herbs, bandages) ends it */
    this.bleedTicks = 0;
    /** ticks of limping left (an arrow hit) */
    this.limpTicks = 0;
    /** swimming with no stamina left: taking drowning damage */
    this.drowning = false;
    /** health reached zero: the body no longer moves */
    this.dead = false;
    /** @type {'arrow'|'bleed'|'drowning'|'thirst'|string|null} what killed the player */
    this.deathCause = null;
    /** world px actually travelled since the start (after collision) */
    this.distance = 0;
    /** debug "no needs": hydration and stamina do not drain (testing only; set through cheats.js) */
    this.noNeeds = false;

    /** events raised by the player (also from calls between steps); the Sim moves them to sim.events */
    this.outbox = [];
    /** scratch for the collider and the prop query (not state) */
    this.contact = makeContact();
    this.propScratch = [];
    /** flashlight on: mirrors the carried flashlight, which the inventory owns (ItemUse.syncLight sets it every tick) */
    this.lightOn = false;
  }

  /**
   * Factor on an enemy's sight range against the player: 1 normally, tuning.cover.visibilityFactor in cover.
   * Later steps fold in darkness and Resonance here.
   */
  get visibilityFactor() {
    return this.inCover ? (this.tuning?.cover?.visibilityFactor ?? 1) : 1;
  }

  /** exact facing in radians (0 = east, y down); derived, so it never enters a snapshot */
  get angle() {
    return Math.atan2(this.dirY, this.dirX);
  }

  /** true while crouched (crouch idle or sneaking) */
  get crouched() {
    return this.stance === 'crouch';
  }

  /** true while an arrow wound bleeds */
  get bleeding() {
    return this.bleedTicks > 0;
  }

  /** true while an arrow wound slows the player */
  get limping() {
    return this.limpTicks > 0;
  }

  /** distance travelled in metres (tuning.player.metresPerPixel), for the game-over screen */
  get distanceMetres() {
    return this.distance * (this.tuning?.player?.metresPerPixel ?? 1);
  }

  // ---- what other systems call (exact names: the inventory, the AI and the debug cheats use them) ----------------

  /**
   * Drink: hydration goes up by `amount`, never past the maximum.
   * @param {number} amount
   * @returns {number} the hydration actually added (0 when dead or already full)
   */
  drink(amount) {
    if (this.dead || !(amount > 0)) return 0;
    const added = Math.min(amount, this.tuning.hydration.max - this.hydration);
    this.hydration += added;
    this.staminaCap = this.capFor(this.hydration);
    return added;
  }

  /**
   * Heal: health goes up by `amount`, never past the maximum. Whether a wound also stops bleeding is the
   * item's business (`use.stopsBleed` in data/items.json: herbs and bandages do), see stopBleeding.
   * @param {number} amount
   * @returns {number} the health actually added
   */
  heal(amount) {
    if (this.dead || !(amount > 0)) return 0;
    const added = Math.min(amount, this.tuning.health.max - this.health);
    this.health += added;
    return added;
  }

  /**
   * Stop a bleed (herbs, bandages).
   * @returns {boolean} a bleed was stopped
   */
  stopBleeding() {
    if (this.dead || this.bleedTicks <= 0) return false;
    this.bleedTicks = 0;
    this.outbox.push({ type: 'player_state', change: 'bleed_stop', state: this.state });
    return true;
  }

  /**
   * Take damage. At zero health the player dies of `cause` (the Sim then sets sim.over and raises player_died).
   * @param {number} amount
   * @param {'arrow'|'bleed'|'drowning'|'thirst'|string} cause
   * @returns {number} the health actually lost
   */
  damage(amount, cause) {
    if (this.dead || !(amount > 0)) return 0;
    const lost = Math.min(amount, this.health);
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deathCause = cause;
      this.sprinting = false;
      this.drowning = false;
      this.noiseRadius = 0;
      this.inCover = false;
    }
    return lost;
  }

  /**
   * An arrow hit (M4): health.arrowDamage, then a bleed and a limp for their tuning durations.
   * @returns {number} the health lost to the hit itself
   */
  applyArrowHit() {
    const H = this.tuning.health;
    const lost = this.damage(H.arrowDamage, 'arrow');
    if (!this.dead) {
      this.bleedTicks = ticks(H.bleedSeconds);
      this.limpTicks = ticks(H.limpSeconds);
    }
    this.outbox.push({ type: 'player_hurt', cause: 'arrow', amount: lost, health: this.health });
    return lost;
  }

  /** the stamina cap for a hydration level: halved below hydration.staminaCapBelow (spec §6.2) */
  capFor(hydration) {
    const S = this.tuning.stamina;
    const W = this.tuning.hydration;
    return hydration < W.staminaCapBelow ? S.max * W.staminaCapFraction : S.max;
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
   * @param {PlayerEnv} env
   */
  update(input, env) {
    const { tuning, dt } = env;
    const move = env.move;
    this.prevX = this.x;
    this.prevY = this.y;
    if (this.dead) {
      // a dead body takes no more input and makes no sound
      this.vx = 0;
      this.vy = 0;
      this.sprinting = false;
      this.state = this.mode === 'swim' ? 'swim' : 'idle';
      this.noiseRadius = 0;
      return;
    }
    let mx = input.moveX;
    let my = input.moveY;
    const len = Math.sqrt(mx * mx + my * my);
    if (len > 1) { mx /= len; my /= len; }   // diagonals are not faster than straight lines
    const moving = len > 0;

    this.decideState(input, moving, tuning.stamina);
    const speed = this.speed(tuning, env);
    this.vx = mx * speed;
    this.vy = my * speed;
    if (move) {
      const c = move.collider.moveCircle(this.x, this.y, this.radius, this.vx * dt, this.vy * dt, this.contact);
      this.x = c.x;
      this.y = c.y;
      this.contactX = c.nx;
      this.contactY = c.ny;
      this.updateMode(move);
    } else {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      const bounds = env.bounds;
      if (bounds) {
        this.x = Math.max(bounds.x + this.radius, Math.min(bounds.x + bounds.w - this.radius, this.x));
        this.y = Math.max(bounds.y + this.radius, Math.min(bounds.y + bounds.h - this.radius, this.y));
      }
    }
    if (moving) {
      this.dirX = input.moveX / len;
      this.dirY = input.moveY / len;
      this.facing = facingFor(input.moveX, input.moveY, this.facing);
    }
    // the water may have taken the player this tick: swimming overrides whatever was decided on land
    if (this.mode === 'swim') this.decideState(input, moving, tuning.stamina);
    this.updateHydration(env);
    this.updateStamina(moving, tuning.stamina, dt);
    const ddx = this.x - this.prevX;
    const ddy = this.y - this.prevY;
    const moved = Math.sqrt(ddx * ddx + ddy * ddy);
    this.distance += moved;
    this.updateNoise(moving, env);
    this.updateCover(env);
    this.updateFootprints(moved, env);
    this.updateHealth(env);
  }

  /** thirst over time (faster while sprinting), rain in a squall, and the stamina cap it sets */
  updateHydration(env) {
    const W = env.tuning.hydration;
    const dt = env.dt;
    if (!this.noNeeds) this.hydration -= W.drainPerSecond * (this.sprinting ? W.sprintDrainMultiplier : 1) * dt;
    const world = env.world;
    if (world && world.weatherKind === 'squall') this.hydration += W.rainPerSecond * world.weatherIntensity * dt;
    if (this.hydration < 0) this.hydration = 0;
    if (this.hydration > W.max) this.hydration = W.max;
    this.staminaCap = this.capFor(this.hydration);
  }

  /** bleeding, limping, drowning and thirst; death is noticed by the Sim at the end of the step */
  updateHealth(env) {
    const H = env.tuning.health;
    const dt = env.dt;
    if (this.limpTicks > 0) this.limpTicks--;
    if (this.bleedTicks > 0) {
      this.bleedTicks--;
      this.damage(H.bleedDamagePerSecond * dt, 'bleed');
      if (this.bleedTicks === 0 && !this.dead) this.outbox.push({ type: 'player_state', change: 'bleed_stop', state: this.state });
    }
    const drowning = this.mode === 'swim' && this.stamina <= 0 && !this.dead;
    if (drowning !== this.drowning) this.outbox.push({ type: 'player_state', change: drowning ? 'drowning_start' : 'drowning_stop', state: this.state });
    this.drowning = drowning;
    if (drowning) this.damage(H.drowningDamagePerSecond * dt, 'drowning');
    if (this.hydration <= 0) this.damage(env.tuning.hydration.thirstDamagePerSecond * dt, 'thirst');
  }

  /**
   * The surface under the feet for the noise table: 'swim' when swimming, 'water' when wading in water,
   * otherwise the terrain ('wet_sand' also for sand the tide has just left wet).
   * @param {PlayerEnv} env
   */
  surface(env) {
    if (this.mode === 'swim') return 'swim';
    const map = env.map;
    if (!map) return env.tuning.noise.defaultSurface;
    const tx = Math.floor(this.x / TILE_W);
    const ty = Math.floor(this.y / TILE_H);
    const terrain = map.terrainAt(tx, ty);
    const cls = env.world ? waterAt(map, env.world, tx, ty) : 'dry';
    if (terrain === 'mud') return 'mud';
    if (cls === 'shallow' || cls === 'deep') return 'water';
    if (cls === 'wet' && terrain === 'sand') return 'wet_sand';
    return terrain;
  }

  /** this tick's footstep noise radius; a continuous source in sim.noise while it is above zero */
  updateNoise(moving, env) {
    const cfg = env.tuning.noise;
    const action = !moving ? 'still' : this.sprinting ? 'sprint' : this.stance === 'crouch' ? 'sneak' : 'walk';
    this.noiseSurface = this.surface(env);
    let r = noiseFor(cfg, this.noiseSurface, action);
    if (env.world) r *= env.world.noiseMultiplier;
    this.noiseRadius = r;
    if (r > 0 && env.noise) env.noise.emit({ x: this.x, y: this.y, radius: r, kind: 'footsteps', sourceId: 'player', announce: false });
  }

  /** crouched inside the cover radius of a prop (the map's prop index, never a scan of every prop) */
  updateCover(env) {
    let inside = false;
    if (this.stance === 'crouch' && this.mode !== 'swim') {
      const kinds = env.tuning.props;
      const props = env.map ? env.map.propsNear(this.x, this.y, env.map.maxPropReach, this.propScratch) : (env.props ?? []);
      for (const p of props) {
        if (p.cover === false) continue;
        const r = p.coverRadius ?? kinds[p.kind]?.coverRadius ?? 0;
        if (!(r > 0)) continue;
        const dx = p.x - this.x;
        const dy = p.y - this.y;
        if (dx * dx + dy * dy <= r * r) { inside = true; break; }
      }
    }
    if (inside !== this.inCover) this.outbox.push({ type: 'player_cover', inCover: inside });
    this.inCover = inside;
  }

  /**
   * Prints on wet sand: one every footprints.spacing px walked on foot (sneaking too: a crouched body still
   * presses wet sand, so the quiet way across a beach is not also the traceless one). Wading and swimming leave
   * none; the sea takes them.
   */
  updateFootprints(moved, env) {
    const trail = env.footprints;
    const map = env.map;
    if (!trail || !map || !env.world || this.mode !== 'ground' || !this.onWetSand(env)) {
      this.printTravel = 0;
      return;
    }
    this.printTravel += moved;
    const spacing = env.tuning.footprints.spacing;
    if (this.printTravel >= spacing) {
      this.printTravel -= spacing;
      if (this.printTravel >= spacing) this.printTravel = 0;   // a teleport-sized jump leaves one print, not a row
      trail.add(this.x, this.y, this.dirX, this.dirY);
    }
  }

  /** wet sand under the feet: terrain wet_sand, or sand the tide has just left wet */
  onWetSand(env) {
    const map = env.map;
    const tx = Math.floor(this.x / TILE_W);
    const ty = Math.floor(this.y / TILE_H);
    const t = map.terrainAt(tx, ty);
    return (t === 'wet_sand' || t === 'sand') && waterAt(map, env.world, tx, ty) === 'wet';
  }

  /**
   * Stance, sprint and animation state from the input, the mode and the stamina. No sprint while crouched or
   * swimming, no crouch while swimming; a sprint starts only with stamina.sprintStartMin and goes on until zero.
   * Crouch wins over sprint when both are held (the crouch toggle stays on until the player turns it off).
   */
  decideState(input, moving, cfg) {
    const swimming = this.mode === 'swim';
    const stance = !swimming && input.crouch ? 'crouch' : 'stand';
    const wantSprint = input.sprint && moving && stance === 'stand' && !swimming;
    const sprinting = wantSprint && (this.sprinting ? this.stamina > 0 : this.stamina >= cfg.sprintStartMin);
    let state;
    if (swimming) state = 'swim';
    else if (stance === 'crouch') state = moving ? 'sneak' : 'crouch';
    else if (sprinting) state = 'sprint';
    else state = moving ? 'walk' : 'idle';

    if (stance !== this.stance) this.outbox.push({ type: 'player_state', change: stance, state });
    if (sprinting !== this.sprinting) this.outbox.push({ type: 'player_state', change: sprinting ? 'sprint_start' : 'sprint_stop', state });
    this.stance = stance;
    this.sprinting = sprinting;
    this.state = state;
  }

  /** world pixels per second for this tick: walk speed x action x terrain x weather */
  speed(tuning, env) {
    const p = tuning.player;
    let s = p.walkSpeed;
    if (this.sprinting) s *= p.sprintMultiplier;
    else if (this.stance === 'crouch') s *= p.sneakMultiplier;
    const move = env.move;
    if (move) {
      const map = move.collider.map;
      const tid = map.terrainIdAt(Math.floor(this.x / TILE_W), Math.floor(this.y / TILE_H));
      s *= speedFor(tid, modeRankAt(map, this.x, this.y, move.tide, move.rules), MODE_RANK[this.mode], move.rules);
    }
    if (env.world) s *= env.world.moveMultiplier;
    if (this.limpTicks > 0) s *= tuning.health.limpMultiplier;
    return s;
  }

  /** drain while sprinting or swimming; after a short rest, regenerate (faster when still) up to the cap */
  updateStamina(moving, cfg, dt) {
    const before = this.stamina;
    const swimming = this.mode === 'swim';
    if (this.sprinting || swimming) {
      this.restTicks = 0;
      const drain = (this.sprinting ? cfg.sprintDrainPerSecond : 0) + (swimming ? cfg.swimDrainPerSecond : 0);
      if (!this.noNeeds) this.stamina -= drain * dt;
    } else {
      this.restTicks++;
      if (this.restTicks > ticks(cfg.regenDelaySeconds)) this.stamina += (moving ? cfg.regenMovingPerSecond : cfg.regenStillPerSecond) * dt;
    }
    if (this.stamina > this.staminaCap) this.stamina = this.staminaCap;
    if (this.stamina <= 0) {
      this.stamina = 0;
      if (before > 0) this.outbox.push({ type: 'player_state', change: 'exhausted', state: this.state });
    }
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

  /** the events raised since the last call, emptied */
  takeEvents() {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  snapshot() {
    const { x, y, prevX, prevY, vx, vy, radius, facing, dirX, dirY, mode, terrain, contactX, contactY, lightOn } = this;
    const out = { x, y, prevX, prevY, vx, vy, radius, facing, dirX, dirY, mode, terrain, contactX, contactY, lightOn };
    for (const k of BODY_FIELDS) out[k] = this[k];
    return out;
  }

  /**
   * @param {Object} s from snapshot(); fields missing from older snapshots get a new player's values
   * @param {Object} [tuning]
   */
  static restore(s, tuning = null) {
    const p = new Player({ x: s.x, y: s.y, radius: s.radius, tuning });
    Object.assign(p, {
      prevX: s.prevX, prevY: s.prevY, vx: s.vx, vy: s.vy, facing: s.facing, dirX: s.dirX, dirY: s.dirY,
      mode: s.mode ?? 'ground', terrain: s.terrain ?? null, contactX: s.contactX ?? 0, contactY: s.contactY ?? 0, lightOn: !!s.lightOn,
    });
    for (const k of BODY_FIELDS) if (s[k] !== undefined) p[k] = s[k];
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
