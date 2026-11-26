// The Sentinelese scouts (spec §7.3, steps 4.1 to 4.3), owned by the Sim as `sim.scouts`. People defending their
// home: territorial, deliberate, and legible. They never speak: every intent is an emote bubble (scout.emote) and
// an animation state (scout.anim). They warn before they shoot, and a player who reads them and backs off lives.
//
// ---- the state machine --------------------------------------------------------------------------------------
//   PATROL       walk the route (loop or ping-pong), pause and look round at its ends and at some waypoints;
//                `return` walks back to the exact route point it left from.
//   INVESTIGATE  [question] go to a point of interest (a heard noise, a thrown rock's impact, a fresh footprint,
//                a glimpse), look round, follow a trail of prints from freshest to freshest, then return.
//   WARN         [exclaim, then arrow_warn] the player is seen (awareness full) unarmed, at medium range, near the
//                coast: stop, shout, draw (warn_bow), loose a warning arrow into the ground in front of them.
//                Backing away (the distance grows by warn.backoffMargin) or getting out of sight within
//                warn.deescalateSeconds (3 s) of the arrow: the bow is lowered (lower_bow) [eye], and the scout
//                watches, then goes back to its route. A warned player gets no second warning for warn.memorySeconds.
//   CHASE        [exclaim, whistle, then skull | spear] the warning ignored, or the player advancing, deep inland,
//                holding metal or electronics, too close, or Resonance Agitated: pursue, whistle once (every scout
//                within chase.whistleRadius, 300 px, joins with the shared last known position) and shoot lethal
//                arrows (telegraphed draw, cool-down, at most arrow.maxShooters at once, none in the first
//                arrow.firstShotSeconds). Never into a safe zone: a player who reaches one is watched from its edge.
//   SEARCH       [search] line of sight broken for chase.loseSightSeconds (6 s): sweep the last known position, the
//                way the player was going and the cover nearby, then go back. Seeing the player again: CHASE.
//
// ---- cost ---------------------------------------------------------------------------------------------------
// Only scouts within lod.nearRadius of the player (or busy with anything but walking their route) run perception,
// collision and pathfinding. The rest are moved along their route by distance alone (a few additions a tick), and
// switch back seamlessly: a far scout is always exactly on its route, a near one leaves it only to come back.
// Path searches share a node budget per tick (path.nodesPerTick).
//
// ---- events (sim.events) ------------------------------------------------------------------------------------
//   scout_state { id, from, to, reason }   player_spotted { id, x, y, reason }   scout_shout { id, x, y }
//   scout_draw { id, warning }   arrow_fired { id, scout, warning }   arrow_land { id, scout, warning, x, y }
//   arrow_hit { id, scout, amount }   whistle { id, x, y, recruits }   chase_lost { id, x, y }   warn_end { id, outcome }
// and sim.threat = { level, nearest, nearestId, count } for the HUD and the music.
// Step 4.4 adds the tolerant interactions: the coastal offering and its truces (ai/offering.js: errands are patrol
// phases offer_* and stand_*, calm to sim.threat) and respecting the monolith (ai/monolith.js: a patrol phase
// `respect`, then respectUntil, during which the scout neither warns nor hunts the player).
import { DT, TICK_HZ } from '../sim/constants.js';
import { Route, routesOf, hash01 } from './ai/Route.js';
import { Scout, SCOUT_STATES } from './ai/Scout.js';
import { viewPlayer, inSafeZone } from './ai/env.js';
import { look, fillRate, hear, spotFootprint, nextFootprint } from './ai/perception.js';
import { stepToward, planPath, lineOfWalk, scoutMayStand } from './ai/navigation.js';
import { fireWarningArrow, fireLethalArrow, sweepArrows } from './ai/combat.js';
import { facingFor } from './Player.js';
import { Offerings, onTask, keepingTruce } from './ai/offering.js';
import { MonolithRespect, respecting } from './ai/monolith.js';
import { Gatherers } from './ai/gatherer.js';

export { SCOUT_STATES, Scout, Route };

const ticks = (s) => Math.round(s * TICK_HZ);
const SWEEP = Object.freeze([0, 1, 2, 1, 0, -1, -2, -1]);
const C45 = Math.SQRT1_2;
/** threat levels in rising order (sim.threat.level) */
export const THREAT_LEVELS = Object.freeze(['none', 'investigate', 'search', 'warn', 'chase']);
const THREAT_RANK = Object.freeze({ patrol: 0, investigate: 1, search: 2, warn: 3, chase: 4 });

/** a unit vector turned by n eighths of a turn (positive: clockwise on screen, y down); plain arithmetic */
export function turn45(x, y, n) {
  let ax = x;
  let ay = y;
  const k = n < 0 ? -n : n;
  for (let i = 0; i < k; i++) {
    const nx = n > 0 ? (ax - ay) * C45 : (ax + ay) * C45;
    const ny = n > 0 ? (ax + ay) * C45 : (ay - ax) * C45;
    ax = nx;
    ay = ny;
  }
  const l = Math.sqrt(ax * ax + ay * ay) || 1;
  return [ax / l, ay / l];
}

export class Scouts {
  /**
   * @param {import('../sim/Sim.js').Sim} sim  map and tuning are read from it (not stored state)
   */
  constructor(sim) {
    this.ai = sim.tuning.ai;
    /** @type {Map<string, Route>} the map's patrol routes */
    this.routes = routesOf(sim.map);
    /** regions where a sighting is attacked without a warning (tuning.ai.zones.inland) */
    this.inland = new Set(this.ai.zones.inland);
    /** @type {Scout[]} in a fixed order (the map's order, then spawned ones) */
    this.list = [];
    /** arrows stuck in the ground, for the picture: { x, y, dx, dy, tick, warning } */
    this.stuck = [];
    /** debug switches (cheats.js); part of the snapshot because they change what happens */
    this.cheats = { frozen: false, invisible: false, deaf: false };
    /** counter for spawned scouts' ids */
    this.seq = 0;
    /**
     * no scout starts drawing before this tick: draws are staggered (arrow.staggerSeconds) and a hit buys the player
     * arrow.hitGraceSeconds, so a caught player always has a moment to break away
     */
    this.nextDraw = 0;
    /** until this tick the hunters hold where they are after a hit (arrow.hitHoldSeconds) */
    this.holdUntil = 0;
    // derived each tick (never saved)
    this.maxAwareness = 0;
    this.watcherId = null;
    this.nearCount = 0;
    this.budget = 0;
    this.shooters = 0;
    /** per-tick cost of the last update, in path nodes expanded (the presentation measures time) */
    this.lastNodes = 0;
    this.view = { inShape: false, seen: false, d: 0, range: 0, centrality: 0 };
    /** the coastal offering and the truces (step 4.4, ai/offering.js) */
    this.offerings = new Offerings(sim);
    /** respecting the monolith (step 4.4, ai/monolith.js) */
    this.monolith = new MonolithRespect(sim);
    /** the Mangrove Gatherer (step 4.4, ai/gatherer.js): a record in `list` with kind 'gatherer' */
    this.gatherers = new Gatherers(sim);
    this.P = {};
    this.tmp = { x: 0, y: 0 };
    this.tick = 0;
  }

  /**
   * The island's scouts: one per `npc: 'scout'` entity on its route, plus extra scouts on long routes
   * (tuning.ai.spawn: one more every extraScoutEveryPx of route, at most maxPerRoute), spread evenly along it.
   * A scout without a route has nothing to patrol and is not spawned (the map validator refuses one anyway).
   */
  spawnFromMap(sim) {
    if (!sim.map) return;
    const cfg = this.ai.spawn;
    for (const e of sim.map.entitiesOfType('npc')) {
      if (e.npc !== 'scout' || !e.route) continue;
      const route = this.routes.get(e.route);
      if (!route) continue;
      const oneWay = route.mode === 'pingpong' ? route.length / 2 : route.length;
      const count = 1 + Math.min(cfg.maxPerRoute - 1, Math.floor(oneWay / cfg.extraScoutEveryPx));
      const at = route.nearest(e.x, e.y);
      for (let k = 0; k < count; k++) {
        const s = new Scout({ id: k === 0 ? e.id : `${e.id}_${k + 1}`, route, routeId: route.id, radius: this.ai.radius });
        this.placeOnRoute(s, at.s + (route.length * k) / count);
        this.list.push(s);
      }
    }
    this.gatherers.spawn(sim, this, Scout);
  }

  /**
   * Put the scouts where a new game's patrols would be after `tick` ticks (restoring a save older than the scouts):
   * each walks its route by distance alone, as a far scout does. A patrol repeats once it has gone round its whole
   * cycle (walk and pauses, measured between two arrivals at its first waypoint), so whole cycles are skipped and a
   * save of any age costs at most about two cycles of steps per scout.
   * @param {number} tick
   */
  advanceTo(sim, tick) {
    for (const s of this.list) {
      if (s.kind === 'gatherer') continue;   // he starts at home
      let t = 0;
      let firstArrival = -1;
      let skipped = false;
      while (t < tick) {
        const before = s.leg;
        this.tick = t;
        this.patrolStep(sim, s, false);
        t += 1;
        if (skipped || s.leg !== 0 || before === 0) continue;
        if (firstArrival < 0) { firstArrival = t; continue; }
        const period = t - firstArrival;
        const skip = Math.floor((tick - t) / period) * period;
        t += skip;
        s.phaseTick += skip;
        s.phaseEnd += skip;
        skipped = true;
      }
      s.prevX = s.x;
      s.prevY = s.y;
    }
    this.tick = tick;
  }

  /** put a scout at walk distance `s` of its route, walking */
  placeOnRoute(sc, s) {
    const r = sc.route;
    let w = r.length > 0 ? s % r.length : 0;
    if (w < 0) w += r.length;
    sc.leg = r.legAt(w);
    sc.s = w;
    r.pointOnLeg(sc.leg, w, this.tmp);
    sc.x = sc.prevX = this.tmp.x;
    sc.y = sc.prevY = this.tmp.y;
    sc.dirX = r.ux[sc.leg];
    sc.dirY = r.uy[sc.leg];
    sc.facing = facingFor(sc.dirX, sc.dirY, 'S');
    sc.state = 'patrol';
    sc.phase = 'walk';
  }

  /**
   * A scout standing guard at a point (debug "spawn a scout", tests): its route is that one point, so it pauses
   * there and looks round, and comes back to it after anything it investigates.
   * @param {{ x: number, y: number, dirX?: number, dirY?: number, id?: string, fixedFacing?: boolean }} o
   *   fixedFacing: it stares the way it faces instead of looking round (tests, a guard on a gate)
   * @returns {Scout}
   */
  spawnPost(o) {
    this.seq += 1;
    const id = o.id ?? `scout_spawned_${this.seq}`;
    const dx = o.dirX ?? 0;
    const dy = o.dirY ?? 1;
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    const route = new Route(id, 'post', [[o.x, o.y]], null, [dx / l, dy / l]);
    const s = new Scout({ id, route, routeId: null, radius: this.ai.radius });
    s.dirX = s.baseX = route.ux[0];
    s.dirY = s.baseY = route.uy[0];
    s.facing = facingFor(s.dirX, s.dirY, 'S');
    s.fixedFacing = o.fixedFacing === true;
    s.phase = 'pause';
    s.anim = 'idle';
    s.phaseTick = this.tick;
    s.phaseEnd = this.tick + ticks(this.ai.patrol.postSeconds);
    this.list.push(s);
    return s;
  }

  /**
   * One more scout on a map route, at walk distance `at` (tests, debug).
   * @returns {Scout}
   */
  spawnOnRoute(routeId, at = 0, id = null) {
    const route = this.routes.get(routeId);
    if (!route) throw new Error(`Scouts.spawnOnRoute: no route ${routeId}`);
    this.seq += 1;
    const s = new Scout({ id: id ?? `scout_spawned_${this.seq}`, route, routeId, radius: this.ai.radius });
    this.placeOnRoute(s, at);
    this.list.push(s);
    return s;
  }

  /** @returns {boolean} the patrols of a beach sector stand down after an offering (step 4.4) */
  inTruce(sector) {
    return this.offerings.inTruce(sector);
  }

  /** @returns {Scout|null} */
  byId(id) {
    return this.list.find((s) => s.id === id) ?? null;
  }

  /** @returns {Scout|null} the scout nearest to a point */
  nearestTo(x, y) {
    let best = null;
    let bd = Infinity;
    for (const s of this.list) {
      if (s.kind === 'gatherer') continue;
      const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /**
   * Put a scout into a state at once, as if it had just decided to (debug and tests): INVESTIGATE and SEARCH
   * about the player's position, WARN and CHASE against the player, PATROL back to its route.
   */
  force(sim, s, state) {
    if (s.kind === 'gatherer') return;   // he has none of these states
    const P = viewPlayer(sim, this.ai, this.cheats, this.inland, {});
    this.tick = sim.tick;
    const dx = P.x - s.x;
    const dy = P.y - s.y;
    s.dist = Math.sqrt(dx * dx + dy * dy);
    switch (state) {
      case 'investigate': this.investigate(sim, s, P.x, P.y, 'glimpse', { ...P, escalate: false }); break;
      case 'warn': this.warn(sim, s, P); break;
      case 'chase': this.chase(sim, s, 'debug', P, P.x, P.y); break;
      case 'search':
        s.lkX = P.x; s.lkY = P.y; s.lkVX = 0; s.lkVY = 0;
        this.leaveRoute(s);
        this.search(sim, s);
        break;
      case 'patrol': this.leaveRoute(s); this.backToRoute(sim, s, null); break;
      default: throw new Error(`Scouts.force: unknown state ${state}`);
    }
  }

  // ---- the tick ---------------------------------------------------------------------------------------------

  /**
   * Advance every scout one tick (the Sim calls this after the player, the items and the projectiles).
   * @param {import('../sim/Sim.js').Sim} sim
   */
  update(sim) {
    const ai = this.ai;
    this.tick = sim.tick;
    this.budget = ai.path.nodesPerTick;
    this.lastNodes = 0;
    this.pruneStuck();
    const P = viewPlayer(sim, ai, this.cheats, this.inland, this.P);
    if (this.cheats.frozen) {
      for (const s of this.list) { s.prevX = s.x; s.prevY = s.y; }
      sweepArrows(sim);
      this.summarize(sim, P);
      return;
    }
    if (sim.player.dead) {
      // the run is over: bows come down, every scout shrugs and walks back to its route; nothing more is loosed
      for (const s of this.list) {
        if (s.kind !== 'gatherer' && s.state !== 'patrol') {
          if (s.lod === 'far') this.wake(sim, s);
          this.backToRoute(sim, s, 'ellipsis');
        }
      }
    }
    this.shooters = 0;
    for (const s of this.list) if (s.state === 'chase' && s.phase === 'draw') this.shooters += 1;
    this.offerings.update(sim, this, P);
    this.monolith.update(sim, this, P);
    const near2 = ai.lod.nearRadius * ai.lod.nearRadius;
    const far2 = ai.lod.farRadius * ai.lod.farRadius;
    for (const s of this.list) {
      if (s.kind === 'gatherer') { this.gatherers.step(sim, this, s, P); continue; }
      s.prevX = s.x;
      s.prevY = s.y;
      const dx = P.x - s.x;
      const dy = P.y - s.y;
      const d2 = dx * dx + dy * dy;
      const busy = s.state !== 'patrol' || (s.phase !== 'walk' && s.phase !== 'pause');
      if (s.lod === 'far' && (d2 < near2 || busy)) this.wake(sim, s);
      else if (s.lod === 'near' && !busy && d2 > far2) this.sleep(s);
      if (s.lod === 'far') {
        this.patrolStep(sim, s, false);
        continue;
      }
      if (onTask(s) && this.offerings.step(sim, this, s, P)) { this.updateEmote(s); continue; }
      if (s.state === 'patrol' && s.phase === 'respect') {
        this.sense(sim, s, P);
        this.monolith.step(sim, this, s, P);
        this.updateEmote(s);
        continue;
      }
      this.sense(sim, s, P);
      this.think(sim, s, P);
      this.act(sim, s, P);
      this.updateEmote(s);
    }
    sweepArrows(sim);
    this.summarize(sim, P);
  }

  /** a far scout comes into the full simulation: it is on its route; nudge it out of anything it overlaps */
  wake(sim, s) {
    s.lod = 'near';
    const c = sim.collider;
    if (c && !c.isPositionFree(s.x, s.y, s.radius)) {
      const out = { x: s.x, y: s.y };
      if (c.nearestFreePosition(s.x, s.y, s.radius, this.ai.lod.unstuckSearch, out)) {
        s.x = s.prevX = out.x;
        s.y = s.prevY = out.y;
      }
    }
  }

  /** a near scout walking its route leaves the full simulation: it is put exactly on the route where it walks */
  sleep(s) {
    s.lod = 'far';
    s.seen = false;
    const r = s.route;
    s.s = r.projectOnLeg(s.leg, s.x, s.y);
    r.pointOnLeg(s.leg, s.s, this.tmp);
    s.x = s.prevX = this.tmp.x;
    s.y = s.prevY = this.tmp.y;
    s.path = null;
  }

  // ---- PATROL -----------------------------------------------------------------------------------------------

  /**
   * Walk the route. Far scouts move by distance along the leg; near ones walk towards the next waypoint with the
   * collider and their route distance follows by projection, so both arrive on the same tick on open ground.
   */
  patrolStep(sim, s, near) {
    const ai = this.ai;
    const r = s.route;
    if (s.phase === 'pause') {
      s.anim = 'idle';
      this.sweep(s);
      if (this.tick < s.phaseEnd) return;
      s.phase = 'walk';
      s.dirX = s.baseX;
      s.dirY = s.baseY;
    }
    s.anim = 'patrol';
    const k = s.leg;
    const j = r.next(k);
    if (!near) {
      const step = ai.patrolSpeed * DT;
      const end = r.cum[k] + r.len[k];
      if (s.s + step >= end) {
        s.x = r.wx[j];
        s.y = r.wy[j];
        this.arrive(s, j);
      } else {
        s.s += step;
        r.pointOnLeg(k, s.s, this.tmp);
        s.x = this.tmp.x;
        s.y = this.tmp.y;
        if (r.len[k] > 0) {
          s.dirX = r.ux[k];
          s.dirY = r.uy[k];
          s.facing = facingFor(s.dirX, s.dirY, s.facing);
        }
      }
      return;
    }
    const res = stepToward(sim, s, r.wx[j], r.wy[j], ai.patrolSpeed, ai.patrol.arriveRadius);
    s.s = r.projectOnLeg(k, s.x, s.y);
    if (res === 'arrived') { this.arrive(s, j); return; }
    if (s.blockedTicks >= ticks(ai.path.stuckSeconds)) {
      // something solid on the leg: walk round it to the next waypoint with a path, then carry on
      this.leaveRoute(s, j, r.cum[j]);
      s.phase = 'return';
      s.phaseTick = this.tick;
      s.path = null;
    }
  }

  /** reached waypoint j: the next leg, and a pause at the route's ends or (by a per-scout hash) elsewhere */
  arrive(s, j) {
    const p = this.ai.patrol;
    const r = s.route;
    s.leg = j;
    s.s = r.cum[j];
    s.blockedTicks = 0;
    let dur = 0;
    if (r.isEnd[j]) dur = p.endPauseSeconds[0] + (p.endPauseSeconds[1] - p.endPauseSeconds[0]) * hash01(s.n, j, 1);
    else if (hash01(s.n, j, 2) < p.pauseChance) dur = p.pauseSeconds[0] + (p.pauseSeconds[1] - p.pauseSeconds[0]) * hash01(s.n, j, 3);
    if (r.mode === 'post') dur = p.postSeconds;
    if (dur > 0) {
      s.phase = 'pause';
      s.phaseTick = this.tick;
      s.phaseEnd = this.tick + ticks(dur);
      // a post looks round about the way it faces; a walker about the way it was walking
      s.baseX = r.mode === 'post' ? r.ux[0] : s.dirX;
      s.baseY = r.mode === 'post' ? r.uy[0] : s.dirY;
    }
  }

  /** look round about (baseX, baseY): a sweep of eighth-turns, one step every patrol.lookStepSeconds */
  sweep(s) {
    if (s.fixedFacing && s.state === 'patrol') { s.dirX = s.baseX; s.dirY = s.baseY; return; }
    const step = ticks(this.ai.patrol.lookStepSeconds);
    const i = Math.floor((this.tick - s.phaseTick) / step + (s.n & 7)) % SWEEP.length;
    const [x, y] = turn45(s.baseX, s.baseY, SWEEP[i]);
    s.dirX = x;
    s.dirY = y;
    s.facing = facingFor(x, y, s.facing);
  }

  /** remember where the route was left (once: a scout already on its way back keeps the first point) */
  leaveRoute(s, leg = s.leg, at = s.s) {
    if (s.state === 'patrol' && s.phase !== 'return') {
      s.returnLeg = leg;
      s.returnS = at;
      s.returnTries = 0;
    }
  }

  /** walking back to the route point it left from; there, carry on patrolling */
  returnStep(sim, s) {
    const ai = this.ai;
    const r = s.route;
    r.pointOnLeg(s.returnLeg, s.returnS, this.tmp);
    const tx = this.tmp.x;
    const ty = this.tmp.y;
    s.anim = 'patrol';
    const res = this.goTo(sim, s, tx, ty, ai.patrolSpeed, ai.patrol.arriveRadius, false);
    if (res === 'arrived') {
      s.leg = s.returnLeg;
      s.s = s.returnS;
      s.phase = 'walk';
      s.path = null;
      return;
    }
    const gaveUp = this.tick - s.phaseTick > ticks(ai.path.giveUpSeconds);
    if (res === 'unreachable' || gaveUp) {
      if (s.returnTries < 1 && !gaveUp) {
        // the point it left is out of reach (a squeeze, the tide): make for the nearest point of the route
        const n = r.nearest(s.x, s.y);
        s.returnLeg = n.leg;
        s.returnS = n.s;
        s.returnTries += 1;
        s.path = null;
        return;
      }
      // last resort, so a scout never freezes: it is put back on its route (never seen happening on the island)
      s.x = s.prevX = tx;
      s.y = s.prevY = ty;
      s.leg = s.returnLeg;
      s.s = s.returnS;
      s.phase = 'walk';
      s.path = null;
      sim.events.push({ type: 'scout_unstuck', id: s.id, x: tx, y: ty });
    }
  }

  // ---- senses -------------------------------------------------------------------------------------------------

  sense(sim, s, P) {
    const ai = this.ai;
    const alert = s.state === 'warn' || s.state === 'chase' || s.state === 'search';
    const v = look(sim, s, P, ai, alert, this.view);
    s.seen = v.seen;
    s.dist = v.d;
    if (v.seen) {
      s.lastSeenTick = this.tick;
      if (!P.safe) s.lostTick = this.tick;
      s.lkX = P.x;
      s.lkY = P.y;
      s.lkVX = P.vx;
      s.lkVY = P.vy;
      const a = s.awareness + fillRate(ai.awareness, v.d, v.range, v.centrality, alert) * DT;
      s.awareness = a > 1 ? 1 : a;
      if (respecting(s, this.tick)) s.awareness = 0;   // it watches the player pass, and lets them
    } else if (s.state !== 'chase') {
      const a = s.awareness - ai.awareness.drainPerSecond * DT;
      s.awareness = a < 0 ? 0 : a;
    }
    if (!this.cheats.deaf) {
      const n = hear(sim, s);
      if (n && !(n.sourceId === 'player' && respecting(s, this.tick))) this.onNoise(sim, s, n, P);
    }
    if ((s.state === 'patrol' || s.state === 'investigate' || s.state === 'search') && !respecting(s, this.tick) && (this.tick + s.n) % ticks(ai.footprints.scanSeconds) === 0) {
      const fp = spotFootprint(sim, s, ai);
      if (fp) this.onFootprint(sim, s, fp, P);
    }
  }

  /** a new noise reached the scout */
  onNoise(sim, s, n, P) {
    const h = this.ai.hearing;
    const gain = n.kind === 'footsteps' ? h.stepsPerSecond * n.strength * DT : h.impactGain;
    if (s.awareness < h.cap) s.awareness = Math.min(h.cap, s.awareness + gain);
    // where it seemed to come from: exact for a clear sound, off by up to uncertaintyPx for a faint one
    const j = h.uncertaintyPx * (1 - n.strength);
    const px = n.x + (hash01(n.id, s.n, 1) * 2 - 1) * j;
    const py = n.y + (hash01(n.id, s.n, 2) * 2 - 1) * j;
    const kind = n.kind === 'footsteps' ? 'noise' : 'impact';
    switch (s.state) {
      case 'patrol':
        this.investigate(sim, s, px, py, kind, P);
        break;
      case 'investigate':
        if (!(s.poiKind === 'glimpse' && s.seen)) this.setPoi(s, px, py, kind);
        break;
      case 'search':
        if (!inSafeZone(sim, px, py)) { s.spots.splice(s.spotI, 0, [px, py]); s.phase = 'go'; s.path = null; }
        break;
      case 'chase':
        if (!s.seen && n.sourceId === 'player') { s.lkX = px; s.lkY = py; }
        break;
      default:
    }
  }

  /** a fresh print in sight: follow the trail */
  onFootprint(sim, s, fp, P) {
    s.trailTick = fp.tick;
    if (s.state === 'patrol') this.investigate(sim, s, fp.x, fp.y, 'footprint', P);
    else if (s.state === 'investigate' && s.poiKind !== 'glimpse') this.setPoi(s, fp.x, fp.y, 'footprint');
    else if (s.state === 'search') { s.spots.splice(s.spotI, 0, [fp.x, fp.y]); s.phase = 'go'; s.path = null; }
  }

  setPoi(s, x, y, kind) {
    const dx = x - s.poiX;
    const dy = y - s.poiY;
    s.poiX = x;
    s.poiY = y;
    s.poiKind = kind;
    const rd = this.ai.path.repathDistance;
    if (s.phase === 'look' || dx * dx + dy * dy > rd * rd) {
      s.phase = 'go';
      s.phaseTick = this.tick;
      s.path = null;
    }
  }

  // ---- decisions ----------------------------------------------------------------------------------------------

  think(sim, s, P) {
    const aw = this.ai.awareness;
    switch (s.state) {
      case 'patrol':
      case 'investigate':
        if (s.seen && s.awareness >= 1) { this.spotted(sim, s, P); break; }
        if (s.seen && s.awareness >= aw.suspicious) {
          if (s.state === 'patrol') this.investigate(sim, s, P.x, P.y, 'glimpse', P);
          else this.setPoi(s, P.x, P.y, 'glimpse');
        }
        break;
      case 'search':
        if (s.seen && s.awareness >= 1 && !P.safe) this.chase(sim, s, 'resighted', P);
        break;
      case 'warn':
        this.thinkWarn(sim, s, P);
        break;
      case 'chase':
        if (this.tick - s.lostTick >= ticks(this.ai.chase.loseSightSeconds)) {
          sim.events.push({ type: 'chase_lost', id: s.id, x: s.lkX, y: s.lkY });
          this.search(sim, s);
        } else if (s.hitD0 >= 0 && this.tick >= this.holdUntil) this.afterHitHold(sim, s, P);
        break;
      default:
    }
  }

  /** awareness full: warn or attack (spec §7.3) */
  spotted(sim, s, P) {
    if (P.safe) {
      // a player in a safe zone is watched, never engaged
      s.awareness = this.ai.awareness.suspicious;
      this.emote(s, 'eye', this.ai.emote.shortSeconds);
      return;
    }
    const reason = this.attackReason(s, P);
    sim.events.push({ type: 'player_spotted', id: s.id, x: P.x, y: P.y, reason: reason ?? 'warn' });
    if (reason) this.chase(sim, s, reason, P);
    else this.warn(sim, s, P);
  }

  /**
   * Why a scout that has seen the player attacks without warning, or null when it warns.
   * @returns {'metal'|'resonance'|'inland'|'too_close'|'warned_before'|null}
   */
  attackReason(s, P) {
    if (P.provokes) return 'metal';
    if (P.escalate) return 'resonance';
    if (P.inland) return 'inland';
    if (s.dist <= this.ai.chase.tooCloseRadius) return 'too_close';
    if (this.tick < s.warnedUntil) return 'warned_before';
    return null;
  }

  setState(sim, s, to, reason = null) {
    const from = s.state;
    s.state = to;
    s.reason = reason;
    s.stateTick = this.tick;
    s.phaseTick = this.tick;
    s.path = null;
    s.blockedTicks = 0;
    s.hitD0 = -1;
    s.loosed = false;
    s.emote = null;
    s.emoteQueue = [];
    if (from !== to) sim.events.push({ type: 'scout_state', id: s.id, from, to, reason });
    if (s.lod === 'far') this.wake(sim, s);
  }

  investigate(sim, s, x, y, kind, P) {
    if (inSafeZone(sim, x, y)) return;   // scouts do not go into a safe zone, not even to look
    if (P.escalate) { this.chase(sim, s, 'resonance', P, x, y); return; }   // Agitated: straight to the alert
    this.leaveRoute(s);
    this.setState(sim, s, 'investigate', kind);
    s.phase = 'go';
    s.poiX = x;
    s.poiY = y;
    s.poiKind = kind;
    this.emote(s, 'question', -1);
  }

  warn(sim, s, P) {
    const w = this.ai.warn;
    this.leaveRoute(s);
    this.setState(sim, s, 'warn', 'spotted');
    s.phase = 'shout';
    s.phaseEnd = this.tick + ticks(w.shoutSeconds);
    s.warnD0 = s.dist;
    s.anim = 'warn_bow';
    this.face(s, P.x, P.y);
    this.emote(s, 'exclaim', -1);
    sim.events.push({ type: 'scout_shout', id: s.id, x: s.x, y: s.y });
  }

  thinkWarn(sim, s, P) {
    const w = this.ai.warn;
    const near = this.ai.chase.tooCloseRadius;
    const d = s.dist;
    if (s.seen) this.face(s, P.x, P.y);
    if (s.phase === 'lower') {
      s.anim = 'lower_bow';
      // coming back while it still watches ends the tolerance
      if (s.seen && !P.safe && (d <= s.warnD0 - w.advanceMargin || d <= near)) { this.chase(sim, s, 'advanced', P); return; }
      if (this.tick >= s.phaseEnd) this.backToRoute(sim, s, null);
      return;
    }
    s.anim = 'warn_bow';
    if (P.provokes) { this.endWarn(sim, s, 'metal'); this.chase(sim, s, 'metal', P); return; }
    if (P.escalate) { this.endWarn(sim, s, 'resonance'); this.chase(sim, s, 'resonance', P); return; }
    if (s.seen && (d <= s.warnD0 - w.advanceMargin || d <= near)) { this.endWarn(sim, s, 'advanced'); this.chase(sim, s, 'advanced', P); return; }
    if (!s.seen || d >= s.warnD0 + w.backoffMargin || P.safe) {
      // backed away, or out of sight (cover, a tree, the dark): the bow comes down
      s.phase = 'lower';
      s.phaseTick = this.tick;
      s.phaseEnd = this.tick + ticks(w.watchSeconds);
      s.warnedUntil = this.tick + ticks(w.memorySeconds);
      s.anim = 'lower_bow';
      s.emote = null;
      s.emoteQueue = [];
      this.emote(s, 'eye', -1);
      sim.events.push({ type: 'warn_end', id: s.id, outcome: 'retreat' });
      return;
    }
    if (this.tick < s.phaseEnd) return;
    if (s.phase === 'shout') {
      s.phase = 'draw';
      s.phaseTick = this.tick;
      s.phaseEnd = this.tick + ticks(w.drawSeconds);
      sim.events.push({ type: 'scout_draw', id: s.id, warning: true });
    } else if (s.phase === 'draw') {
      const p = fireWarningArrow(sim, s, P.x, P.y, this.ai);
      sim.events.push({ type: 'arrow_fired', id: p.id, scout: s.id, warning: true });
      s.phase = 'hold';
      s.phaseTick = this.tick;
      s.phaseEnd = this.tick + ticks(w.deescalateSeconds);
      s.emote = null;
      s.emoteQueue = [];
      this.emote(s, 'arrow_warn', -1);
    } else if (s.phase === 'hold') {
      this.endWarn(sim, s, 'ignored');
      this.chase(sim, s, 'ignored', P);
    }
  }

  endWarn(sim, s, outcome) {
    s.warnedUntil = this.tick + ticks(this.ai.warn.memorySeconds);
    sim.events.push({ type: 'warn_end', id: s.id, outcome });
  }

  /**
   * Into CHASE: the hunt starts from the scout's own sighting or from (lkX, lkY). A scout that was not called by
   * a whistle whistles (once per chase.whistleCooldownSeconds): every scout within chase.whistleRadius joins.
   * @param {string|null} [by] id of the scout whose whistle called this one
   */
  chase(sim, s, reason, P, lkX = null, lkY = null, by = null) {
    if (s.state === 'chase' || sim.player.dead) return;
    const ai = this.ai;
    this.leaveRoute(s);
    this.setState(sim, s, 'chase', reason);
    s.phase = 'run';
    s.awareness = 1;
    s.recruitedBy = by;
    if (lkX !== null) { s.lkX = lkX; s.lkY = lkY; }
    else if (!s.seen) { s.lkX = P.x; s.lkY = P.y; }
    s.lostTick = this.tick;
    s.chaseTick = this.tick;
    s.cooldownUntil = this.tick + ticks(ai.arrow.firstShotSeconds);
    s.anim = 'chase';
    const em = ai.emote;
    this.emote(s, 'exclaim', em.exclaimSeconds);
    if (by === null && this.tick >= s.whistleReady) {
      s.whistleReady = this.tick + ticks(ai.chase.whistleCooldownSeconds);
      this.emote(s, 'whistle', em.whistleSeconds);
      this.emote(s, 'skull', -1);
      const r2 = ai.chase.whistleRadius * ai.chase.whistleRadius;
      const recruits = [];
      for (const o of this.list) {
        if (o === s || o.kind === 'gatherer' || o.state === 'chase' || keepingTruce(o) || respecting(o, this.tick)) continue;   // a truce kept is kept, and a gesture seen
        const dx = o.x - s.x;
        const dy = o.y - s.y;
        if (dx * dx + dy * dy <= r2) recruits.push(o);
      }
      sim.events.push({ type: 'whistle', id: s.id, x: s.x, y: s.y, recruits: recruits.map((o) => o.id) });
      for (const o of recruits) this.chase(sim, o, 'whistle', P, s.lkX, s.lkY, s.id);
    } else this.emote(s, by === null ? 'skull' : 'spear', -1);
  }

  search(sim, s) {
    const ai = this.ai;
    this.setState(sim, s, 'search', 'lost_sight');
    s.phase = 'go';
    s.spots = this.searchSpots(sim, s);
    s.spotI = 0;
    s.searchEnd = this.tick + ticks(ai.search.seconds);
    this.emote(s, 'search', -1);
  }

  /**
   * Where to look: the last known position, a little further the way the player was going, and the nearest
   * hiding places (cover props, trunks and boulders) around it; never inside a safe zone.
   * @returns {Array<[number, number]>}
   */
  searchSpots(sim, s) {
    const c = this.ai.search;
    const spots = [];
    const ok = (x, y) => scoutMayStand(sim, x, y) && (!sim.collider || sim.collider.isPositionFree(x, y, s.radius));
    if (ok(s.lkX, s.lkY)) spots.push([s.lkX, s.lkY]);
    const v = Math.sqrt(s.lkVX * s.lkVX + s.lkVY * s.lkVY);
    if (v > 1) {
      const ax = s.lkX + (s.lkVX / v) * c.aheadPx;
      const ay = s.lkY + (s.lkVY / v) * c.aheadPx;
      if (ok(ax, ay)) spots.push([ax, ay]);
    }
    if (sim.map) {
      const kinds = sim.tuning.props;
      const cand = [];
      for (const p of sim.map.propsNear(s.lkX, s.lkY, c.spotRadius)) {
        const cover = p.cover !== false && (p.coverRadius ?? kinds[p.kind]?.coverRadius ?? 0) > 0;
        const solid = p.radius > 0 && sim.collider.propBlocksSight(p);
        if (!cover && !solid) continue;
        const dx = p.x - s.lkX;
        const dy = p.y - s.lkY;
        const d2 = dx * dx + dy * dy;
        cand.push({ p, d2, solid });
      }
      cand.sort((a, b) => a.d2 - b.d2 || (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0));
      for (const { p, d2, solid } of cand) {
        if (spots.length >= c.spots) break;
        let x = p.x;
        let y = p.y;
        if (solid) {
          // behind the trunk, seen from where the player was last
          const d = Math.sqrt(d2) || 1;
          const off = p.radius + s.radius + c.behindPx;
          x = p.x + ((p.x - s.lkX) / d) * off;
          y = p.y + ((p.y - s.lkY) / d) * off;
        }
        if (ok(x, y)) spots.push([x, y]);
      }
    }
    // nowhere it may go (the player vanished into a safe zone): it looks round from where it stands, then leaves
    if (!spots.length) spots.push([s.x, s.y]);
    return spots;
  }

  /** go back to the route (from INVESTIGATE, SEARCH, WARN), optionally with a short emote */
  backToRoute(sim, s, emote) {
    this.setState(sim, s, 'patrol', 'done');
    s.phase = 'return';
    s.phaseTick = this.tick;
    s.recruitedBy = null;
    if (emote) this.emote(s, emote, this.ai.emote.shortSeconds);
  }

  // ---- acting -------------------------------------------------------------------------------------------------

  act(sim, s, P) {
    switch (s.state) {
      case 'patrol':
        if (s.phase === 'return') this.returnStep(sim, s);
        else this.patrolStep(sim, s, true);
        break;
      case 'investigate': this.investigateStep(sim, s); break;
      case 'search': this.searchStep(sim, s); break;
      case 'chase': this.chaseStep(sim, s, P); break;
      default:   // WARN: stands its ground (thinkWarn faces the player)
    }
  }

  investigateStep(sim, s) {
    const c = this.ai.investigate;
    s.anim = 'search';
    if (s.poiKind === 'glimpse' && s.seen) {
      // what it glimpsed is still there: it stops and peers (the meter fills), it does not walk up to it
      this.face(s, s.poiX, s.poiY);
      s.phase = 'go';
      s.phaseTick = this.tick;
      return;
    }
    if (s.phase === 'go') {
      const res = this.goTo(sim, s, s.poiX, s.poiY, c.speed, c.arriveRadius, true);
      if (res !== 'moving' || this.tick - s.phaseTick > ticks(c.maxSeconds)) this.startLook(s, c.lookSeconds);
      return;
    }
    this.sweep(s);
    if (this.tick < s.phaseEnd) return;
    if (s.poiKind === 'footprint') {
      const fp = nextFootprint(sim, s.x, s.y, s.trailTick, this.ai);
      if (fp) {
        s.trailTick = fp.tick;
        this.setPoi(s, fp.x, fp.y, 'footprint');
        return;
      }
    }
    this.backToRoute(sim, s, null);
  }

  searchStep(sim, s) {
    const c = this.ai.search;
    s.anim = 'search';
    if (this.tick >= s.searchEnd || s.spotI >= s.spots.length) { this.backToRoute(sim, s, 'ellipsis'); return; }
    if (s.phase === 'go') {
      const [x, y] = s.spots[s.spotI];
      const res = this.goTo(sim, s, x, y, c.speed, c.arriveRadius, true);
      if (res !== 'moving') this.startLook(s, c.lookSeconds);
      return;
    }
    this.sweep(s);
    if (this.tick >= s.phaseEnd) {
      s.spotI += 1;
      s.phase = 'go';
      s.phaseTick = this.tick;
      s.path = null;
    }
  }

  startLook(s, seconds) {
    s.phase = 'look';
    s.phaseTick = this.tick;
    s.phaseEnd = this.tick + ticks(seconds);
    s.baseX = s.dirX;
    s.baseY = s.dirY;
    s.path = null;
  }

  chaseStep(sim, s, P) {
    const ai = this.ai;
    const a = ai.arrow;
    if (s.phase === 'draw') {
      s.anim = 'warn_bow';
      if (s.seen) this.face(s, P.x, P.y);
      if (this.tick < s.drawEnd) return;
      s.phase = 'run';
      if (s.seen && !P.safe && s.dist <= a.maxRange) {
        const p = fireLethalArrow(sim, s, P, ai);
        s.loosed = true;
        sim.events.push({ type: 'arrow_fired', id: p.id, scout: s.id, warning: false });
        s.cooldownUntil = this.tick + ticks(a.cooldownSeconds);
      } else s.cooldownUntil = this.tick + ticks(a.retrySeconds);
      return;
    }
    s.anim = 'chase';
    if (s.seen && !P.safe && s.dist <= a.maxRange && this.tick >= s.cooldownUntil && this.shooters < a.maxShooters && this.tick >= this.nextDraw) {
      // the telegraph: the bow is drawn for drawSeconds before every shot; draws are staggered between scouts
      s.phase = 'draw';
      s.drawEnd = this.tick + ticks(a.drawSeconds);
      this.nextDraw = this.tick + ticks(a.staggerSeconds);
      this.shooters += 1;
      s.anim = 'warn_bow';
      this.face(s, P.x, P.y);
      sim.events.push({ type: 'scout_draw', id: s.id, warning: false });
      return;
    }
    if (this.tick < this.holdUntil) {
      // a hit has just landed: the hunters stand and watch the wounded run (the one chance to break away)
      if (s.seen) this.face(s, P.x, P.y);
      s.anim = 'lower_bow';
      return;
    }
    if (s.seen && s.dist <= ai.chase.standoff && !P.safe) { this.face(s, P.x, P.y); return; }
    const tx = s.seen ? P.x : s.lkX;
    const ty = s.seen ? P.y : s.lkY;
    const res = this.goTo(sim, s, tx, ty, ai.chase.speed, ai.chase.arriveRadius, true);
    if (res !== 'moving') {
      // at the last known place (or the edge of a safe zone): stand and look round until the hunt is given up
      if (s.phase !== 'look') { s.phase = 'look'; s.phaseTick = this.tick; s.baseX = s.dirX; s.baseY = s.dirY; }
      if (s.seen) this.face(s, P.x, P.y); else this.sweep(s);
      s.anim = 'search';
    } else if (s.phase === 'look') s.phase = 'run';
  }

  face(s, x, y) {
    const dx = x - s.x;
    const dy = y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (!(d > 0)) return;
    s.dirX = dx / d;
    s.dirY = dy / d;
    s.facing = facingFor(s.dirX, s.dirY, s.facing);
  }

  /**
   * Move towards a goal: straight while the straight walk is clear, else along a bounded A* path (planned when
   * the goal moves or the scout is stuck, at most every path.repathSeconds and within the tick's node budget).
   * @returns {'moving'|'arrived'|'unreachable'}
   */
  goTo(sim, s, gx, gy, speed, arrive, terrain) {
    const cfg = this.ai.path;
    if (!sim.map) return stepToward(sim, s, gx, gy, speed, arrive, false) === 'arrived' ? 'arrived' : 'moving';
    const gdx = gx - s.goalX;
    const gdy = gy - s.goalY;
    const moved = s.path && gdx * gdx + gdy * gdy > cfg.repathDistance * cfg.repathDistance;
    const stuck = s.blockedTicks >= ticks(cfg.stuckSeconds);
    if (s.path && s.pathDirect && !stuck) {
      // a straight walk follows a goal that moves
      s.path[0] = [gx, gy];
      s.goalX = gx;
      s.goalY = gy;
    } else if (!s.path || ((moved || stuck) && this.tick >= s.repathAt)) {
      s.repathAt = this.tick + ticks(cfg.repathSeconds);
      s.blockedTicks = 0;
      s.goalX = gx;
      s.goalY = gy;
      s.pathI = 0;
      if (!stuck && lineOfWalk(sim, s.x, s.y, gx, gy, s.radius, cfg.walkCheckStep)) {
        s.path = [[gx, gy]];
        s.pathDirect = true;
        s.pathStatus = 'found';
      } else if (this.budget > 0) {
        const res = planPath(sim, s, gx, gy, cfg);
        this.budget -= res.expanded;
        this.lastNodes += res.expanded;
        s.path = res.points.map((p) => [p.x, p.y]);
        s.pathDirect = false;
        s.pathStatus = res.status === 'found' ? 'found' : 'partial';
        if (!s.path.length) return res.status === 'found' ? 'arrived' : 'unreachable';
      } else {
        // no search left this tick: head straight for it and plan again next tick
        s.path = null;
        stepToward(sim, s, gx, gy, speed, arrive, terrain);
        return 'moving';
      }
    }
    if (!s.path) return 'moving';
    if (s.pathI >= s.path.length) return s.pathStatus === 'found' ? 'arrived' : 'unreachable';
    const [wx, wy] = s.path[s.pathI];
    const last = s.pathI === s.path.length - 1;
    const r = stepToward(sim, s, wx, wy, speed, last ? arrive : cfg.waypointRadius, terrain);
    if (r === 'arrived') {
      s.pathI += 1;
      if (s.pathI >= s.path.length) return s.pathStatus === 'found' ? 'arrived' : 'unreachable';
    }
    return 'moving';
  }

  // ---- emotes, arrows in the ground, the summary --------------------------------------------------------------

  /**
   * Show an emote: at once when nothing timed is showing, else after what is queued. `seconds` -1 = for the rest
   * of the state.
   */
  emote(s, name, seconds) {
    const t = seconds < 0 ? -1 : ticks(seconds);
    if (!s.emote || s.emote.until < 0) s.emote = { name, until: t < 0 ? -1 : this.tick + t };
    else s.emoteQueue.push([name, t]);
  }

  updateEmote(s) {
    if (!s.emote || s.emote.until < 0 || this.tick < s.emote.until) return;
    const next = s.emoteQueue.shift();
    s.emote = next ? { name: next[0], until: next[1] < 0 ? -1 : this.tick + next[1] } : null;
  }

  /**
   * the player was hit: nobody draws for arrow.hitGraceSeconds (a drawn bow already aimed may still loose), and the
   * hunters hold where they stand for arrow.hitHoldSeconds
   */
  onPlayerHit(sim) {
    const t = sim.tick + ticks(this.ai.arrow.hitGraceSeconds);
    if (t > this.nextDraw) this.nextDraw = t;
    this.holdUntil = sim.tick + ticks(this.ai.arrow.hitHoldSeconds);
    // every hunter remembers how far the player was when the arrow struck, to judge the flight when the hold ends
    const p = sim.player;
    for (const s of this.list) {
      if (s.state !== 'chase') continue;
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      s.hitD0 = Math.sqrt(dx * dx + dy * dy);
    }
  }

  /**
   * The hold after a hit is over. A wounded player still running (farther than when struck, by
   * warn.backoffMargin, or out of sight) has been driven off: the hunter lowers its bow and watches [eye], then
   * walks home, and remembers (no warning if the player comes back). One who stood or came closer is hunted on.
   */
  afterHitHold(sim, s, P) {
    const fled = !s.seen || s.dist >= s.hitD0 + this.ai.warn.backoffMargin;
    s.hitD0 = -1;
    if (!fled || !this.ai.arrow.driveOffAfterHit) return;
    const w = this.ai.warn;
    this.setState(sim, s, 'warn', 'driven_off');
    s.phase = 'lower';
    s.phaseEnd = this.tick + ticks(w.watchSeconds);
    s.warnD0 = s.dist;
    s.warnedUntil = this.tick + ticks(w.memorySeconds);
    s.anim = 'lower_bow';
    this.emote(s, 'eye', -1);
    sim.events.push({ type: 'warn_end', id: s.id, outcome: 'driven_off' });
  }

  /** an arrow that came down without hitting stays in the ground for arrow.stuckSeconds */
  stickArrow(p, warning) {
    this.stuck.push({ x: p.x1, y: p.y1, dx: p.x1 - p.x0, dy: p.y1 - p.y0, tick: this.tick, warning });
    const max = this.ai.arrow.stuckMax;
    if (this.stuck.length > max) this.stuck.splice(0, this.stuck.length - max);
  }

  pruneStuck() {
    const life = ticks(this.ai.arrow.stuckSeconds);
    let drop = 0;
    while (drop < this.stuck.length && this.tick - this.stuck[drop].tick >= life) drop++;
    if (drop) this.stuck.splice(0, drop);
  }

  /** sim.threat and the HUD's awareness: over the scouts near the player */
  summarize(sim, P = viewPlayer(sim, this.ai, this.cheats, this.inland, this.P)) {
    const r2 = this.ai.threat.radius * this.ai.threat.radius;
    let rank = 0;
    let nearest = null;
    let nearestId = null;
    let count = 0;
    let maxA = 0;
    let watcher = null;
    let nearN = 0;
    for (const s of this.list) {
      if (s.kind === 'gatherer') continue;   // never a threat, never watching for the eye
      if (s.lod === 'near') nearN += 1;
      const dx = s.x - P.x;
      const dy = s.y - P.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      if (s.awareness > maxA) { maxA = s.awareness; watcher = s.id; }
      const k = THREAT_RANK[s.state];
      if (k === 0) continue;
      count += 1;
      const d = Math.sqrt(d2);
      if (k > rank || (k === rank && d < nearest)) { rank = k; nearest = d; nearestId = s.id; }
    }
    this.maxAwareness = maxA;
    this.watcherId = watcher;
    this.nearCount = nearN;
    sim.threat = { level: THREAT_LEVELS[rank], nearest, nearestId, count };
  }

  // ---- snapshot -----------------------------------------------------------------------------------------------

  snapshot() {
    return {
      seq: this.seq,
      nextDraw: this.nextDraw,
      holdUntil: this.holdUntil,
      cheats: { ...this.cheats },
      list: this.list.map((s) => s.snapshot()),
      stuck: this.stuck.map((a) => ({ ...a })),
      offerings: this.offerings.snapshot(),
      monolith: this.monolith.snapshot(),
    };
  }

  /**
   * @param {Object} snap from snapshot()
   * @param {import('../sim/Sim.js').Sim} sim
   * @returns {Scouts}
   */
  static restore(snap, sim) {
    const sc = new Scouts(sim);
    sc.seq = snap.seq;
    sc.nextDraw = snap.nextDraw ?? 0;
    sc.holdUntil = snap.holdUntil ?? 0;
    sc.cheats = { ...sc.cheats, ...snap.cheats };
    sc.tick = sim.tick;
    sc.list = snap.list.map((o) => {
      const route = o.routeId ? sc.routes.get(o.routeId) : new Route(o.id, 'post', [[o.post[0], o.post[1]]], null, [o.post[2] ?? 0, o.post[3] ?? 1]);
      if (!route) throw new Error(`Scouts.restore: route ${o.routeId} is not on this map`);
      return Scout.restore(o, route);
    });
    sc.stuck = snap.stuck.map((a) => ({ ...a }));
    sc.offerings.restore(snap.offerings);
    sc.monolith.restore(snap.monolith);
    // a save from before the elder: he is at home on his route
    if (!sc.list.some((s) => s.kind === 'gatherer')) sc.gatherers.spawn(sim, sc, Scout);
    return sc;
  }
}
