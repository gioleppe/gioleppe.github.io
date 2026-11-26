// The Mangrove Gatherer (step 4.4, spec §7.3): an old islander, unarmed, who walks the Western Mangroves gathering.
// He is the scouts' record with kind 'gatherer' (movement, route, level of detail, snapshot and renderer shared),
// but none of their rules: he never warns, never hunts, carries no bow, is not counted in sim.threat and is never
// a target for the player. He is aware of the player through the scouts' sight and hearing. All numbers in
// tuning.ai.gatherer.
//
// Phases (state stays 'patrol'): walk (to the next gathering place, slowly) | gather (crouched, a long while) |
// regard (straightened, looking at the player) | offer (the `offer` animation; herbs set down) | show [palm_up] |
// leave (slipping away along his route) | gone (not in the world: for the rest of the day after a gift, or
// startleGoneSeconds after a fright; then he is back at his route's first waypoint).
//
// The gift: in his view, the player crouched, nothing metal or electronic in hand or switched on, farther than
// startleRadiusPx (80, spec) and within noticeMaxPx, for noticeSeconds without a break (his `awareness` is that
// progress, 0..1; never drawn as a meter). Once per day.
// Startled: within startleRadiusPx (seen or not); standing or sprinting in view; a sound of the player reaching him
// at noiseStrength or more, or any impact; metal, electronics or a light in view; Agitated within agitatedRadiusPx.
// [exclaim] then [ellipsis], and he leaves at once; perhaps (alertChance) the nearest patrol within alertRadiusPx
// comes to look where he was (INVESTIGATE, never a chase).
//
// Events: gatherer_noticed { x, y }, gatherer_gift { x, y, item }, gatherer_startled { reason }, gatherer_left.
import { DT, TICK_HZ } from '../../sim/constants.js';
import { look, hear } from './perception.js';
import { hash01 } from './Route.js';
import { facingFor } from '../Player.js';

const ticks = (s) => Math.round(s * TICK_HZ);
const VIEW = { inShape: false, seen: false, d: 0, range: 0, centrality: 0 };

/** the elder is in the world (not gone) */
export function present(s) {
  return s.kind === 'gatherer' && s.phase !== 'gone';
}

export class Gatherers {
  /** @param {import('../../sim/Sim.js').Sim} sim */
  constructor(sim) {
    this.cfg = sim.tuning.ai.gatherer;
  }

  /** the map's gatherer npc on his route (the entity's `route`, else 'gatherer_route'); nothing without one */
  spawn(sim, scouts, Scout) {
    if (!sim.map) return null;
    for (const e of sim.map.entitiesOfType('npc')) {
      if (e.npc !== 'gatherer') continue;
      const route = scouts.routes.get(e.route ?? 'gatherer_route');
      if (!route) continue;
      const s = new Scout({ id: e.id, route, routeId: route.id, radius: sim.tuning.ai.radius });
      s.kind = 'gatherer';
      scouts.placeOnRoute(s, route.nearest(e.x, e.y).s);
      s.anim = 'walk';
      scouts.list.push(s);
      return s;
    }
    return null;
  }

  /** one more elder on a route (tests, debug) */
  spawnOnRoute(scouts, Scout, routeId, at = 0, id = 'gatherer') {
    const route = scouts.routes.get(routeId);
    if (!route) throw new Error(`Gatherers.spawnOnRoute: no route ${routeId}`);
    const s = new Scout({ id, route, routeId, radius: scouts.ai.radius });
    s.kind = 'gatherer';
    scouts.placeOnRoute(s, at);
    s.anim = 'walk';
    scouts.list.push(s);
    return s;
  }

  /** one tick of the elder */
  step(sim, scouts, s, P) {
    const c = this.cfg;
    const tick = scouts.tick;
    s.prevX = s.x;
    s.prevY = s.y;
    if (s.phase === 'gone') {
      const day = sim.world?.day ?? 1;
      if ((s.goneUntil >= 0 && tick >= s.goneUntil) || (s.goneDay >= 0 && day > s.goneDay)) this.comeBack(scouts, s);
      return;
    }
    const dx = P.x - s.x;
    const dy = P.y - s.y;
    const d2 = dx * dx + dy * dy;
    const near = sim.tuning.ai.lod.nearRadius;
    s.lod = d2 < near * near ? 'near' : 'far';
    if (s.lod === 'near' && s.phase !== 'leave') this.perceive(sim, scouts, s, P, Math.sqrt(d2));
    else { s.seen = false; s.awareness = 0; }
    switch (s.phase) {
      case 'walk': this.walk(sim, scouts, s); break;
      case 'gather':
        s.anim = 'gather';
        if (tick >= s.phaseEnd) { s.phase = 'walk'; s.phaseTick = tick; s.path = null; }
        break;
      case 'regard':
        s.anim = 'idle';
        scouts.face(s, P.x, P.y);
        if (tick >= s.phaseEnd) this.setPhase(s, 'offer', tick, c.offerSeconds);
        break;
      case 'offer':
        s.anim = 'offer';
        if (tick >= s.phaseEnd) this.give(sim, scouts, s, P);
        break;
      case 'show':
        s.anim = 'idle';
        if (tick >= s.phaseEnd) this.leave(sim, scouts, s, (sim.world?.day ?? 1), -1);
        break;
      case 'leave': this.slipAway(sim, scouts, s); break;
      default: s.phase = 'walk';
    }
    scouts.updateEmote(s);
  }

  setPhase(s, phase, tick, seconds) {
    s.phase = phase;
    s.phaseTick = tick;
    s.phaseEnd = tick + ticks(seconds);
    s.path = null;
  }

  /** what he sees and hears of the player: the gift slowly, a fright at once */
  perceive(sim, scouts, s, P, d) {
    const c = this.cfg;
    const tick = scouts.tick;
    const v = look(sim, s, P, sim.tuning.ai, false, VIEW);
    s.seen = v.seen;
    s.dist = d;
    const p = sim.player;
    let why = null;
    if (!P.hidden) {
      if (d <= c.startleRadiusPx) why = 'close';
      else if (v.seen && p.sprinting) why = 'sprint';
      else if (v.seen && p.stance !== 'crouch') why = 'stood';
      else if (v.seen && P.provokes) why = 'metal';
      else if (P.escalate && d <= c.agitatedRadiusPx) why = 'agitated';
    }
    if (!why && !scouts.cheats.deaf) {
      const n = hear(sim, s);
      if (n && (n.kind !== 'footsteps' || (n.sourceId === 'player' && n.strength >= c.noiseStrength))) why = 'noise';
    }
    if (why && (s.phase === 'walk' || s.phase === 'gather' || s.phase === 'regard' || s.phase === 'offer')) {
      this.startle(sim, scouts, s, why);
      return;
    }
    if (s.phase !== 'walk' && s.phase !== 'gather') return;
    const day = sim.world?.day ?? 1;
    const calm = v.seen && d <= c.noticeMaxPx && s.giftDay !== day;
    if (!calm) { s.awareness = 0; return; }
    if (s.awareness === 0) sim.events.push({ type: 'gatherer_noticed', x: s.x, y: s.y });
    s.awareness += DT / c.noticeSeconds;
    if (s.awareness >= 1) {
      s.awareness = 1;
      this.setPhase(s, 'regard', tick, c.regardSeconds);
      scouts.face(s, P.x, P.y);
    }
  }

  /** the herbs are set down between him and the player */
  give(sim, scouts, s, P) {
    const c = this.cfg;
    const dx = P.x - s.x;
    const dy = P.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    let x = s.x + (dx / d) * c.herbsOffsetPx;
    let y = s.y + (dy / d) * c.herbsOffsetPx;
    if (sim.collider && !sim.collider.isPositionFree(x, y, 2)) { x = s.x; y = s.y; }
    sim.pickups.drop('healing_herbs', 1, x, y);
    s.giftDay = sim.world?.day ?? 1;
    sim.events.push({ type: 'gatherer_gift', x, y, item: 'healing_herbs' });
    this.setPhase(s, 'show', scouts.tick, c.showSeconds);
    s.emote = null;
    s.emoteQueue = [];
    scouts.emote(s, 'palm_up', c.showSeconds);
  }

  /** a fright: he goes at once; perhaps a patrol comes to look */
  startle(sim, scouts, s, reason) {
    const c = this.cfg;
    const tick = scouts.tick;
    s.awareness = 0;
    s.emote = null;
    s.emoteQueue = [];
    scouts.emote(s, 'exclaim', sim.tuning.ai.emote.exclaimSeconds);
    scouts.emote(s, 'ellipsis', sim.tuning.ai.emote.shortSeconds);
    sim.events.push({ type: 'gatherer_startled', reason, x: s.x, y: s.y });
    this.leave(sim, scouts, s, -1, tick + ticks(c.leaveSeconds + c.startleGoneSeconds));
    if (hash01(s.n, tick, 7) < c.alertChance) {
      const r2 = c.alertRadiusPx * c.alertRadiusPx;
      let best = null;
      let bd = r2;
      for (const o of scouts.list) {
        if (o.kind === 'gatherer' || o.state !== 'patrol' || (o.phase !== 'walk' && o.phase !== 'pause')) continue;
        const dx = o.x - s.x;
        const dy = o.y - s.y;
        const dd = dx * dx + dy * dy;
        if (dd <= bd) { bd = dd; best = o; }
      }
      if (best) {
        if (best.lod === 'far') scouts.wake(sim, best);
        scouts.investigate(sim, best, s.x, s.y, 'noise', { escalate: false });
      }
    }
  }

  /** he turns away along his route (faster than he walks) */
  leave(sim, scouts, s, goneDay, goneUntil) {
    this.setPhase(s, 'leave', scouts.tick, this.cfg.leaveSeconds);
    s.goneDay = goneDay;
    s.goneUntil = goneUntil;
    s.awareness = 0;
  }

  slipAway(sim, scouts, s) {
    s.anim = 'walk';
    this.walk(sim, scouts, s, this.cfg.leaveSpeed, true);
    if (scouts.tick < s.phaseEnd) return;
    s.phase = 'gone';
    s.phaseTick = scouts.tick;
    s.path = null;
    s.emote = null;
    s.emoteQueue = [];
    s.seen = false;
    sim.events.push({ type: 'gatherer_left', x: s.x, y: s.y });
  }

  comeBack(scouts, s) {
    s.goneDay = -1;
    s.goneUntil = -1;
    scouts.placeOnRoute(s, 0);
    s.anim = 'walk';
    s.awareness = 0;
  }

  /**
   * Along the route towards the next waypoint; at one, a long crouch over the plants (not while leaving). Far from
   * the player he moves by distance alone, as a far scout does.
   */
  walk(sim, scouts, s, speed = this.cfg.walkSpeed, leaving = false) {
    const r = s.route;
    const k = s.leg;
    const j = r.next(k);
    if (!leaving) s.anim = 'walk';
    let arrived = false;
    if (s.lod === 'far') {
      s.s = r.projectOnLeg(k, s.x, s.y);
      const end = r.cum[k] + r.len[k];
      if (s.s + speed * DT >= end) arrived = true;
      else {
        s.s += speed * DT;
        r.pointOnLeg(k, s.s, scouts.tmp);
        s.x = scouts.tmp.x;
        s.y = scouts.tmp.y;
        s.dirX = r.ux[k];
        s.dirY = r.uy[k];
        s.facing = facingFor(s.dirX, s.dirY, s.facing);
      }
    } else {
      const res = scouts.goTo(sim, s, r.wx[j], r.wy[j], speed, this.cfg.arriveRadius, true);
      s.s = r.projectOnLeg(k, s.x, s.y);
      arrived = res !== 'moving';
      if (res === 'unreachable' || scouts.tick - s.phaseTick > ticks(sim.tuning.ai.path.giveUpSeconds) * 4) arrived = true;
    }
    if (!arrived) return;
    s.x = r.wx[j];
    s.y = r.wy[j];
    s.leg = j;
    s.s = r.cum[j];
    s.path = null;
    s.phaseTick = scouts.tick;
    if (leaving) return;
    const g = this.cfg.gatherSeconds;
    this.setPhase(s, 'gather', scouts.tick, g[0] + (g[1] - g[0]) * hash01(s.n, j, scouts.tick));
  }
}
