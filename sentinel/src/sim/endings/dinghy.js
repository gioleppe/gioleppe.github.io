// Win A, the dinghy escape (spec §8, step 5.3): wait for the high water, drag the patched dinghy to the sea, row it
// across the cove and out through the one gap in the outer reef. Simulation side; every number is in
// tuning.endings.dinghy.
//
// Phases (state `phase`):
//   rest    the dinghy lies where it was left (at first the crash site; x/y null = the map's place). Interacting
//           with it below tide launchTide: `dinghy_waits` (a notice and the objectives say when the water comes);
//           at or above it: `dinghy_drag_start` and phase drag.
//   drag    the player tows it: walking at dragSpeedFactor, no crouch, no sprint, a noise of dragNoiseRadius every
//           dragNoiseSeconds while moving (sim.noise, kind 'drag'). The dinghy trails towLength behind. Interact
//           again lets go (`dinghy_drag_stop { reason: 'let_go' }`), the tide falling below launchTide stops it
//           (`reason: 'tide'`); either way it stays where it is, and can be dragged again. The player reaching base
//           deep water boards it (`dinghy_afloat`): phase afloat.
//   afloat  the player is in the boat (the boat carries the player: Player.update is not run). Movement inputs
//           steer, sprint pulls harder (stamina), crouch does nothing. The boat moves with the collider at
//           boatRadius and only over base deep water (the cove's: its only way out is the reef passage). Steering
//           onto anything else beaches it (`dinghy_beached`): the player steps ashore, the boat stays (phase rest).
//           Crossing the line passageLinePx south of outer_reef_passage: `dinghy_passage`, then the ending.
//   away    the ending fired.
// Arrows: scouts that see the player afloat shoot without warning (viewPlayer's `fleeing`, ai/env.js); a hit is an
// ordinary hit. Saving is refused from boarding on (saveRules row `ending`).
import { DT, TICK_HZ, TILE_W, TILE_H } from '../constants.js';
import { DEEP_WATER } from '../../world/IslandMap.js';
import { makeContact } from '../../world/collision.js';
import { waterAt } from '../../world/water.js';
import { facingFor } from '../../entities/Player.js';

const ticks = (s) => Math.max(1, Math.round(s * TICK_HZ));
export const DINGHY_ID = 'dinghy';

/** the map's dinghy entity (its starting place), or null */
export function dinghyEntity(sim) {
  return sim.map?.byId?.(DINGHY_ID) ?? null;
}

/**
 * Water the boat floats and rows on: base deep water (tide-independent: the cove's, whose only way out past the
 * outer reef is the passage), and, well inside the cove (tidalMarginTiles north of the passage, so never round
 * the reef's ends), water the tide stands deep over (high water floats it right up the beach).
 */
export function boatWater(sim, x, y) {
  const map = sim.map;
  if (!map) return false;
  const tx = Math.floor(x / TILE_W);
  const ty = Math.floor(y / TILE_H);
  if (!map.inBounds(tx, ty)) return true;   // beyond the map edge is open sea
  if (map.isBlocked(tx, ty)) return false;
  if (map.terrainIdAt(tx, ty) === DEEP_WATER) return true;
  const pass = map.landmark('outer_reef_passage');
  if (!pass || !sim.world || ty >= Math.floor(pass.y / TILE_H) - sim.tuning.endings.dinghy.tidalMarginTiles) return false;
  return map.regionAtWorld(x, y) === 'southern_cove' && waterAt(map, sim.world, tx, ty) === 'deep';
}

export class DinghyEnding {
  constructor() {
    /** @type {'rest'|'drag'|'afloat'|'away'} */
    this.phase = 'rest';
    /** @type {number|null} where the dinghy is (null: where the map put it) */
    this.x = null;
    this.y = null;
    /** heading of the boat afloat (unit vector) */
    this.hx = 0;
    this.hy = 1;
    /** no rowing before this tick (the settle after boarding) */
    this.settleUntil = 0;
    /** next tick a drag or oar noise may be made */
    this.noiseAt = 0;
    /** times boarded (for the bots and the report) */
    this.launches = 0;
    this.contact = makeContact();
  }

  /** where the dinghy is now */
  pos(sim) {
    if (this.x !== null) return { x: this.x, y: this.y };
    const e = dinghyEntity(sim);
    return e ? { x: e.x, y: e.y } : { x: 0, y: 0 };
  }

  get moved() {
    return this.x !== null;
  }

  get afloat() {
    return this.phase === 'afloat';
  }

  get dragging() {
    return this.phase === 'drag';
  }

  /** the tide stands high enough to launch */
  tideOk(sim) {
    return sim.tideHeight() >= sim.tuning.endings.dinghy.launchTide;
  }

  /** interacting with the repaired dinghy */
  interact(sim, t) {
    if (this.phase !== 'rest') return;
    if (!this.tideOk(sim)) {
      sim.events.push({ type: 'dinghy_waits', id: t.id, highTide: false, tideHeight: Math.round(sim.tideHeight() * 100) / 100, need: sim.tuning.endings.dinghy.launchTide, secondsToHigh: Math.round(sim.world?.timeToNext?.('high') ?? 0) });
      return;
    }
    const p = this.pos(sim);
    this.x = p.x;
    this.y = p.y;
    this.phase = 'drag';
    sim.story.flags.add('dinghy_dragged');
    sim.events.push({ type: 'dinghy_drag_start', id: DINGHY_ID, x: this.x, y: this.y });
  }

  /** stop dragging; the dinghy stays where it is (moved off anything solid) */
  letGo(sim, reason) {
    this.phase = 'rest';
    const c = sim.collider;
    if (c && !c.isPositionFree(this.x, this.y, sim.tuning.endings.dinghy.boatRadius / 2)) {
      const out = { x: this.x, y: this.y };
      if (c.nearestFreePosition(this.x, this.y, sim.tuning.endings.dinghy.boatRadius / 2, 64, out)) { this.x = out.x; this.y = out.y; }
    }
    this.sync(sim);
    sim.events.push({ type: 'dinghy_drag_stop', id: DINGHY_ID, reason, x: this.x, y: this.y });
  }

  /** keep the interactable on the dinghy, so it is found where it lies */
  sync(sim) {
    if (this.x === null) return;
    // the map's dinghy prop no longer blocks the crash site once it has been moved
    sim.collider?.moved?.add(DINGHY_ID);
    const it = sim.interactables?.get(DINGHY_ID);
    if (it && (it.x !== this.x || it.y !== this.y)) sim.interactables.move(DINGHY_ID, this.x, this.y);
  }

  /**
   * Before the player moves: dragging slows and steadies the input; interact lets go. Afloat, the inputs are the
   * oars (rowing happens in row()); nothing else in hand is used.
   * @param {Object} inp sanitised input (changed in place)
   */
  beforePlayer(sim, inp) {
    if (this.phase === 'drag') {
      if (sim.player.dead) { this.letGo(sim, 'dead'); return; }
      if (inp.interact) { inp.interact = false; this.letGo(sim, 'let_go'); return; }
      const f = sim.tuning.endings.dinghy.dragSpeedFactor;
      inp.moveX *= f;
      inp.moveY *= f;
      inp.sprint = false;
      inp.crouch = false;
      inp.useItem = false;
      inp.drop = false;
    } else if (this.phase === 'afloat') {
      inp.interact = false;
      inp.useItem = false;
      inp.drop = false;
      inp.crouch = false;
    }
  }

  /** after the player moved: tow, noise, the tide, boarding */
  afterPlayer(sim) {
    if (this.phase !== 'drag') return;
    const cfg = sim.tuning.endings.dinghy;
    const p = sim.player;
    if (!this.tideOk(sim)) { this.letGo(sim, 'tide'); return; }
    const dx = this.x - p.x;
    const dy = this.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const moving = p.x !== p.prevX || p.y !== p.prevY;
    if (d > cfg.towLength) {
      this.x = p.x + (dx / d) * cfg.towLength;
      this.y = p.y + (dy / d) * cfg.towLength;
    }
    if (moving && sim.tick >= this.noiseAt) {
      this.noiseAt = sim.tick + ticks(cfg.dragNoiseSeconds);
      sim.noise.emit({ x: this.x, y: this.y, radius: cfg.dragNoiseRadius, kind: 'drag', sourceId: 'player' });
    }
    this.sync(sim);
    if (boatWater(sim, p.x, p.y)) this.board(sim);
  }

  board(sim) {
    const cfg = sim.tuning.endings.dinghy;
    const p = sim.player;
    this.phase = 'afloat';
    this.launches += 1;
    this.x = p.x;
    this.y = p.y;
    const l = Math.sqrt(p.dirX * p.dirX + p.dirY * p.dirY) || 1;
    this.hx = p.dirX / l;
    this.hy = p.dirY / l;
    this.settleUntil = sim.tick + ticks(cfg.settleSeconds);
    p.mode = 'wade';   // sitting in the boat: never swimming, never drowning
    p.sprinting = false;
    p.stance = 'stand';
    p.state = 'idle';
    p.inCover = false;
    p.noiseRadius = 0;
    if (sim.interactables?.channel) sim.interactables.channel = null;
    this.sync(sim);
    sim.story.flags.add('dinghy_launched');
    sim.events.push({ type: 'dinghy_afloat', id: DINGHY_ID, x: this.x, y: this.y, launches: this.launches });
  }

  /**
   * One tick afloat, instead of Player.update: steer, row, stamina, thirst and wounds.
   * @param {Object} inp sanitised input
   * @param {Object} pe the Sim's player environment
   */
  row(sim, inp, pe) {
    const cfg = sim.tuning.endings.dinghy;
    const S = sim.tuning.stamina;
    const p = sim.player;
    p.prevX = p.x;
    p.prevY = p.y;
    p.vx = 0;
    p.vy = 0;
    if (p.dead) { p.noiseRadius = 0; return; }
    let mx = inp.moveX;
    let my = inp.moveY;
    const len = Math.sqrt(mx * mx + my * my);
    const moving = len > 0 && sim.tick >= this.settleUntil;
    if (len > 1) { mx /= len; my /= len; }
    const pull = moving && inp.sprint && p.stamina > 0;
    if (moving) {
      const k = Math.min(1, cfg.turnRate * DT);
      let hx = this.hx + (mx / (len > 1 ? 1 : len || 1) - this.hx) * k;
      let hy = this.hy + (my / (len > 1 ? 1 : len || 1) - this.hy) * k;
      const hl = Math.sqrt(hx * hx + hy * hy);
      if (hl > 1e-6) { hx /= hl; hy /= hl; } else { hx = mx; hy = my; }
      this.hx = hx;
      this.hy = hy;
      const speed = cfg.rowSpeed * (pull ? cfg.pullMultiplier : 1) * Math.min(1, len);
      const dx = this.hx * speed * DT;
      const dy = this.hy * speed * DT;
      this.moveBoat(sim, dx, dy);
      if (this.phase !== 'afloat') return;
      if (sim.tick >= this.noiseAt) {
        this.noiseAt = sim.tick + ticks(cfg.dragNoiseSeconds);
        sim.noise.emit({ x: this.x, y: this.y, radius: cfg.rowNoiseRadius * (pull ? cfg.pullMultiplier : 1), kind: 'oars', sourceId: 'player' });
      }
    }
    // stamina: a hard pull drains it, easy rowing lets it come back
    if (pull) {
      if (!p.noNeeds) p.stamina -= (cfg.pullStaminaPerSecond + cfg.rowStaminaPerSecond) * DT;
      p.restTicks = 0;
    } else {
      if (moving && !p.noNeeds) p.stamina -= cfg.rowStaminaPerSecond * DT;
      p.restTicks += 1;
      if (p.restTicks > Math.round(S.regenDelaySeconds * TICK_HZ)) p.stamina += (moving ? S.regenMovingPerSecond : S.regenStillPerSecond) * DT;
    }
    if (p.stamina > p.staminaCap) p.stamina = p.staminaCap;
    if (p.stamina < 0) p.stamina = 0;
    p.sprinting = pull;
    p.state = 'idle';
    p.mode = 'wade';
    p.facing = facingFor(this.hx, this.hy, p.facing);
    p.dirX = this.hx;
    p.dirY = this.hy;
    p.noiseRadius = 0;
    p.inCover = false;
    p.updateHydration(pe);
    p.updateHealth(pe);
  }

  /** move the boat (and the rower) by (dx, dy): over base deep water only; anything else beaches it */
  moveBoat(sim, dx, dy) {
    const cfg = sim.tuning.endings.dinghy;
    const p = sim.player;
    const c = sim.collider;
    let nx = this.x + dx;
    let ny = this.y + dy;
    if (c) {
      const r = c.moveCircle(this.x, this.y, cfg.boatRadius, dx, dy, this.contact, false);
      nx = r.x;
      ny = r.y;
    }
    if (!boatWater(sim, nx, ny)) {
      // the bow touches the shallows: beach it if the player can step out there, else hold (coral, a wall)
      const sx = this.x + this.hx * (cfg.boatRadius + p.radius + 2);
      const sy = this.y + this.hy * (cfg.boatRadius + p.radius + 2);
      if (!boatWater(sim, sx, sy) && (!c || c.isPositionFree(sx, sy, p.radius))) this.beach(sim, sx, sy);
      return;
    }
    const mdx = nx - this.x;
    const mdy = ny - this.y;
    this.x = nx;
    this.y = ny;
    p.x = nx;
    p.y = ny;
    p.vx = mdx / DT;
    p.vy = mdy / DT;
    p.distance += Math.sqrt(mdx * mdx + mdy * mdy);
    this.sync(sim);
    const pass = sim.map?.landmark?.('outer_reef_passage');
    if (pass && this.y >= pass.y + cfg.passageLinePx) {
      this.phase = 'away';
      sim.story.flags.add('dinghy_passage');
      sim.events.push({ type: 'dinghy_passage', id: DINGHY_ID, x: this.x, y: this.y });
      sim.endings.finish(sim, 'dinghy');
    }
  }

  /** step out onto the shore at (x, y); the boat stays where it floats */
  beach(sim, x, y) {
    const p = sim.player;
    this.phase = 'rest';
    p.x = p.prevX = x;
    p.y = p.prevY = y;
    p.state = 'idle';
    if (sim.moveEnv) p.syncTerrain(sim.moveEnv);
    this.sync(sim);
    sim.events.push({ type: 'dinghy_beached', id: DINGHY_ID, x: this.x, y: this.y });
  }

  snapshot() {
    return { phase: this.phase, x: this.x, y: this.y, hx: this.hx, hy: this.hy, settleUntil: this.settleUntil, noiseAt: this.noiseAt, launches: this.launches };
  }

  static restore(s) {
    const d = new DinghyEnding();
    if (!s) return d;
    Object.assign(d, { phase: s.phase, x: s.x, y: s.y, hx: s.hx, hy: s.hy, settleUntil: s.settleUntil, noiseAt: s.noiseAt, launches: s.launches ?? 0 });
    return d;
  }
}
