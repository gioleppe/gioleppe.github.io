// The coastal offering (step 4.4, spec §7.3): something that is not metal, laid at a border totem, taken by a scout
// of that beach, and a truce: the sector's patrols stand down off the beach for one full tide. Owned by the scouts
// (`sim.scouts.offerings`); all numbers in tuning.ai.offering. Nothing here is a trade: no meter, no prompt, no
// words. A scout comes, looks, takes it, turns its open palm to where the player stands, and goes.
//
// ---- the offering -------------------------------------------------------------------------------------------
// Interacting with a totem while holding an item with the `offering` flag (catalog.canOffer: never a key item,
// never metal or electronics) lays one at the totem's foot (Inventory.remove: the ordinary removal, which refuses
// key items). Interacting again before it is taken gives it back and cancels it. Without one, the totem is looked
// at (`totem_inspected`).
// While the player stands back (standOffPx), with no metal or electronics in hand, nothing switched on and Resonance
// not Agitated, the nearest scout of the totem's sector that is walking its route within callRangePx leaves it
// (phase offer_go, [question]); seeing the offering within seePx it shows [fish]; it crouches over it (offer_take,
// `gather`), straightens, turns to the player if it can see them and shows [palm_up] (offer_show), and the truce
// begins. If the player breaks the conditions while it comes, it drops the errand and the ordinary rules apply
// from where it stands (on the coast that is a warning at most, as it would have been).
//
// ---- the truce ------------------------------------------------------------------------------------------------
// Every scout whose route names the sector walks along its route to the waypoint of its stand-down post
// (stand_route), off to the post (stand_go) and waits there facing inland, looking round slowly (stand_wait); it
// does not watch, hear or track anyone. It lasts one tide period on the live clock (world.tidePeriodSeconds). It
// breaks when the player, in the sector, holds metal or runs electronics or goes Agitated, or comes within
// postPresencePx of a scout at its post. Broken or over, the scouts walk back to the post's waypoint (stand_back)
// and along the route to where they left it (stand_route_back), with their ordinary senses.
//
// Events: offering_placed { totem, sector, item }, offering_taken_back { totem, sector, item },
//   offering_seen { scout, totem }, offering_accepted { totem, sector, scout, until, extended },
//   truce_start { sector, until }, truce_broken { sector, reason: metal|electronics|agitated|presence },
//   truce_end { sector }, totem_inspected { totem, sector, truce }.
import { TILE_W, TILE_H, TICK_HZ } from '../../sim/constants.js';
import { look } from './perception.js';
import { lineOfWalk } from './navigation.js';
import { inSafeZone } from './env.js';
import { facingFor } from '../Player.js';

const ticks = (s) => Math.round(s * TICK_HZ);

export const OFFER_PHASES = Object.freeze(['offer_go', 'offer_take', 'offer_show']);
export const STAND_PHASES = Object.freeze(['stand_route', 'stand_go', 'stand_wait', 'stand_back', 'stand_route_back']);
const OFFER = new Set(OFFER_PHASES);
const STAND = new Set(STAND_PHASES);
/** the phases in which a standing-down scout keeps the truce (senses off) */
const KEEPING = new Set(['stand_route', 'stand_go', 'stand_wait']);

/** is the scout on an errand of the offering or a truce (busy: kept in the full simulation; calm: threat 0) */
export function onTask(s) {
  return s.state === 'patrol' && (OFFER.has(s.phase) || STAND.has(s.phase));
}

/** is the scout keeping a truce (it perceives nothing) */
export function keepingTruce(s) {
  return s.state === 'patrol' && KEEPING.has(s.phase);
}

/** a watery tile: water, or ground any tide floods */
function watery(map, tx, ty) {
  return !map.inBounds(tx, ty) || map.isWater(tx, ty) || map.floodLevel(tx, ty) > 0;
}

/** nearest watery tile centre within `R` tiles of a world point: { d, x, y } (d Infinity when none) */
function nearestWater(map, x, y, R) {
  const tx0 = Math.floor(x / TILE_W);
  const ty0 = Math.floor(y / TILE_H);
  let best = { d: Infinity, x: 0, y: 0 };
  for (let r = 0; r <= R; r++) {
    // a ring at Chebyshev radius r; once something is found, one more ring can still hold a nearer centre
    for (let ty = ty0 - r; ty <= ty0 + r; ty++) {
      for (let tx = tx0 - r; tx <= tx0 + r; tx++) {
        if (Math.abs(tx - tx0) !== r && Math.abs(ty - ty0) !== r) continue;
        if (!watery(map, tx, ty)) continue;
        const cx = (tx + 0.5) * TILE_W;
        const cy = (ty + 0.5) * TILE_H;
        const d = Math.sqrt((cx - x) * (cx - x) + (cy - y) * (cy - y));
        if (d < best.d) best = { d, x: cx, y: cy };
      }
    }
    if (best.d < Infinity && r * Math.min(TILE_W, TILE_H) > best.d) break;
  }
  return best;
}

/** may a scout wait here through a whole tide: dry at high water, free, outside a safe zone */
function goodPost(sim, x, y, radius) {
  const map = sim.map;
  const tx = Math.floor(x / TILE_W);
  const ty = Math.floor(y / TILE_H);
  if (watery(map, tx, ty) || map.isBlocked(tx, ty)) return false;
  if (sim.collider && !sim.collider.isPositionFree(x, y, radius)) return false;
  return !inSafeZone(sim, x, y);
}

/**
 * The stand-down post of a route (derived, deterministic, never saved): the waypoint farthest from water (a bonus
 * outside every beach sector), pushed further from the water while the straight walk from it stays clear and dry.
 * @returns {{ x: number, y: number, s: number, wp: number, dirX: number, dirY: number, waterPx: number, sector: string|null }}
 */
export function standDownPost(sim, route, cfg, radius) {
  const map = sim.map;
  const n = route.points.length;
  let best = null;
  for (let i = 0; i < n; i++) {
    const [x, y] = route.points[i];
    const w = nearestWater(map, x, y, cfg.postSearchTiles);
    const cap = cfg.postSearchTiles * TILE_H;
    const score = Math.min(w.d, cap) + (map.sectorAtWorld(x, y) === null ? cfg.sectorFreeBonusPx : 0);
    if (!best || score > best.score) best = { i, x, y, w, score };
  }
  const { i, w } = best;
  let dx = 0;
  let dy = -1;
  if (w.d < Infinity && w.d > 0) { dx = (best.x - w.x) / w.d; dy = (best.y - w.y) / w.d; }
  let px = best.x;
  let py = best.y;
  const steps = Math.floor(cfg.postPushPx / cfg.postPushStepPx);
  for (let k = 1; k <= steps; k++) {
    const x = best.x + dx * cfg.postPushStepPx * k;
    const y = best.y + dy * cfg.postPushStepPx * k;
    if (!goodPost(sim, x, y, radius) || !lineOfWalk(sim, best.x, best.y, x, y, radius, sim.tuning.ai.path.walkCheckStep)) break;
    px = x;
    py = y;
  }
  const w2 = nearestWater(map, px, py, cfg.postSearchTiles);
  return { x: px, y: py, s: route.cum[i], wp: i, dirX: dx, dirY: dy, waterPx: w2.d, sector: map.sectorAtWorld(px, py) };
}

export class Offerings {
  /**
   * @param {import('../../sim/Sim.js').Sim} sim
   */
  constructor(sim) {
    this.cfg = sim.tuning.ai.offering;
    /** @type {Map<string, { id: string, x: number, y: number, sector: string|null }>} the map's border totems */
    this.totems = new Map();
    if (sim.map) for (const t of sim.map.entitiesOfType('totem')) this.totems.set(t.id, { id: t.id, x: t.x, y: t.y, sector: t.sector ?? sim.map.sectorAtWorld(t.x, t.y) });
    /**
     * @type {Array<{ totem: string, sector: string|null, item: string, x: number, y: number, tick: number,
     *   status: 'waiting'|'claimed'|'taken'|'ignored', scout: string|null, since: number, nextCall: number, during?: boolean }>}
     * offerings lying at totems (at most one per totem), in the order they were laid
     */
    this.lying = [];
    /**
     * @type {Object<string, { active: boolean, start: number, until: number, chain: number, endTick: number }>}
     * per sector that has had a truce (sim.truces)
     */
    this.truces = {};
    /** @type {Map<string, Object>} stand-down posts by route id (derived, not state) */
    this.posts = new Map();
  }

  /** @returns {boolean} a truce holds in this sector now */
  inTruce(sector) {
    return this.truces[sector]?.active === true;
  }

  /** the stand-down post of a scout's route (cached) */
  postOf(sim, s) {
    const id = s.route.id;
    let p = this.posts.get(id);
    if (!p) {
      p = sim.map ? standDownPost(sim, s.route, this.cfg, s.radius) : { x: s.route.wx[0], y: s.route.wy[0], s: 0, wp: 0, dirX: 0, dirY: -1, waterPx: 0, sector: null };
      this.posts.set(id, p);
    }
    return p;
  }

  offeringAt(totem) {
    return this.lying.find((o) => o.totem === totem) ?? null;
  }

  // ---- the totem interaction ------------------------------------------------------------------------------------

  /**
   * The player interacts with a border totem: take back what lies there (not yet taken), else lay the offering in
   * hand, else look at the totem.
   * @param {import('../../sim/Sim.js').Sim} sim
   * @param {{ id: string, x: number, y: number }} t the interactable
   */
  interact(sim, t) {
    const inv = sim.inventory;
    const totem = this.totems.get(t.id) ?? { id: t.id, x: t.x, y: t.y, sector: sim.map?.sectorAtWorld(t.x, t.y) ?? null };
    const o = this.offeringAt(t.id);
    if (o && o.status === 'taken') {
      sim.events.push({ type: 'totem_inspected', totem: t.id, sector: totem.sector, truce: this.inTruce(totem.sector) });
      return;
    }
    if (o) {
      if (inv.add(o.item, 1) < 1) { sim.events.push({ type: 'inventory_full', id: t.id, item: o.item }); return; }
      this.cancel(sim, o, 'taken_back');
      sim.events.push({ type: 'offering_taken_back', totem: t.id, sector: o.sector, item: o.item });
      return;
    }
    const id = inv.heldId;
    if (id && sim.catalog.canOffer(id)) {
      if (sim.catalog.isKey(id)) throw new Error(`offering: key item ${id} may never be offered`);
      if (inv.remove(id, 1) !== 1) return;
      const c = this.cfg;
      // at the totem's foot, and a free spot beside it where a scout can crouch over it
      const at = { x: totem.x, y: totem.y + c.footOffsetPx };
      const st = { x: at.x, y: at.y + c.standBesidePx };
      const col = sim.collider;
      const r = sim.tuning.ai.radius;
      if (col && !col.isPositionFree(st.x, st.y, r)) col.nearestFreePosition(st.x, st.y, r, c.standBesidePx * 2, st);
      this.lying.push({ totem: t.id, sector: totem.sector, item: id, x: at.x, y: at.y, sx: st.x, sy: st.y, tick: sim.tick, status: 'waiting', scout: null, since: sim.tick, nextCall: 0 });
      sim.events.push({ type: 'offering_placed', totem: t.id, sector: totem.sector, item: id });
      return;
    }
    sim.events.push({ type: 'totem_inspected', totem: t.id, sector: totem.sector, truce: this.inTruce(totem.sector) });
  }

  remove(o) {
    const i = this.lying.indexOf(o);
    if (i >= 0) this.lying.splice(i, 1);
  }

  /** take an offering out of the world (taken back); a scout on its way gives up */
  cancel(sim, o, why) {
    this.remove(o);
    if (why === 'taken_back' && o.scout) {
      const s = sim.scouts.byId(o.scout);
      if (s && s.taskId === o.totem && OFFER.has(s.phase)) this.dropErrand(sim, s, 'ellipsis');
    }
  }

  // ---- the tick -------------------------------------------------------------------------------------------------

  /**
   * The player stands back from an offering in the way the islanders would read as peaceful.
   * @param {import('./env.js').PlayerView} P
   */
  peaceful(P) {
    return !P.provokes && !P.escalate;
  }

  /**
   * Once per tick before the scouts act: call a scout to a waiting offering, end and break truces, send the
   * sector's patrols to their posts. Costs nothing without offerings or truces.
   */
  update(sim, scouts, P) {
    const tick = scouts.tick;
    const c = this.cfg;
    for (const o of this.lying) {
      if (o.status !== 'waiting') continue;
      if (this.inTruce(o.sector)) { o.since = tick; o.during = true; continue; }   // it waits for the truce to end
      if (tick - o.since > ticks(c.waitSeconds)) { o.status = 'ignored'; continue; }
      if (tick < o.nextCall || !this.peaceful(P)) continue;
      const dx = P.x - o.x;
      const dy = P.y - o.y;
      if (dx * dx + dy * dy < c.standOffPx * c.standOffPx) continue;
      const s = this.caller(scouts, o);
      if (s) this.call(sim, scouts, s, o);
    }
    for (const sector of Object.keys(this.truces)) {
      const t = this.truces[sector];
      if (!t.active) continue;
      if (tick >= t.until) { this.endTruce(sim, scouts, sector, null); continue; }
      const why = this.breach(sim, scouts, sector, P);
      if (why) this.endTruce(sim, scouts, sector, why);
    }
    for (const s of scouts.list) {
      if (s.state !== 'patrol' || (s.phase !== 'walk' && s.phase !== 'pause')) continue;
      const sec = s.route.sector;
      if (sec && this.inTruce(sec)) this.standDown(sim, scouts, s, sec);
    }
  }

  /** the nearest scout of the offering's sector walking its route within callRangePx, or null */
  caller(scouts, o) {
    const r2 = this.cfg.callRangePx * this.cfg.callRangePx;
    let best = null;
    let bd = r2;
    for (const s of scouts.list) {
      if (s.kind === 'gatherer' || s.route.sector !== o.sector || s.state !== 'patrol' || (s.phase !== 'walk' && s.phase !== 'pause')) continue;
      const dx = s.x - o.x;
      const dy = s.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bd) { bd = d2; best = s; }
    }
    return best;
  }

  call(sim, scouts, s, o) {
    o.status = 'claimed';
    o.scout = s.id;
    scouts.leaveRoute(s);
    if (s.lod === 'far') scouts.wake(sim, s);
    s.phase = 'offer_go';
    s.phaseTick = scouts.tick;
    s.path = null;
    s.taskId = o.totem;
    s.taskX = o.sx ?? o.x;
    s.taskY = o.sy ?? o.y;
    s.poiKind = null;
    s.emote = null;
    s.emoteQueue = [];
    scouts.emote(s, 'question', -1);
  }

  /** why the truce of a sector breaks this tick, or null */
  breach(sim, scouts, sector, P) {
    if (P.hidden) return null;
    const here = sim.map ? sim.map.sectorAtWorld(P.x, P.y) === sector : true;
    const inv = sim.inventory;
    if (here && inv?.holdingMetalOrElectronics) return 'metal';
    if (here && inv?.carriesActiveElectronics) return 'electronics';
    if (here && P.escalate) return 'agitated';
    const r2 = this.cfg.postPresencePx * this.cfg.postPresencePx;
    for (const s of scouts.list) {
      if (s.taskId !== sector || !keepingTruce(s)) continue;
      const dx = P.x - s.x;
      const dy = P.y - s.y;
      if (dx * dx + dy * dy <= r2) return 'presence';
    }
    return null;
  }

  /** a truce begins (or, inside maxExtensions, follows straight on from the last) */
  startTruce(sim, scouts, sector, during) {
    const tick = scouts.tick;
    const prev = this.truces[sector];
    // a truce that follows the last without a break (an offering left during it) counts as an extension
    const follows = during && prev && !prev.active && prev.endReason === null;
    const chain = follows ? prev.chain + 1 : 0;
    if (chain > this.cfg.maxExtensions) return { started: false, until: prev.until };
    const period = sim.world?.tidePeriodSeconds ?? 360;
    const until = tick + Math.round(period * TICK_HZ);
    this.truces[sector] = { active: true, start: tick, until, chain, endTick: -1, endReason: null };
    sim.events.push({ type: 'truce_start', sector, until });
    return { started: true, until, extended: chain > 0 };
  }

  /** a truce ends (why null) or breaks (why = the reason): the scouts go back to their routes */
  endTruce(sim, scouts, sector, why) {
    const t = this.truces[sector];
    t.active = false;
    t.endTick = scouts.tick;
    t.endReason = why;
    sim.events.push(why ? { type: 'truce_broken', sector, reason: why } : { type: 'truce_end', sector });
    for (const s of scouts.list) if (s.taskId === sector && onTask(s)) this.release(s, scouts.tick);
  }

  // ---- the scouts' errands --------------------------------------------------------------------------------------

  /** go to the post: along the route to its waypoint first (a patrol's own path), senses off */
  standDown(sim, scouts, s, sector) {
    const post = this.postOf(sim, s);
    if (s.lod === 'far') scouts.wake(sim, s);
    s.returnLeg = s.leg;
    s.returnS = s.s;
    s.returnTries = 0;
    s.taskId = sector;
    // a second scout of the same route stands a little to the side of the first
    let k = 0;
    for (const o of scouts.list) { if (o === s) break; if (o.route === s.route) k += 1; }
    s.taskX = post.x;
    s.taskY = post.y;
    if (k > 0) {
      const x = post.x - post.dirY * this.cfg.postSpacingPx * k;
      const y = post.y + post.dirX * this.cfg.postSpacingPx * k;
      if (!sim.collider || sim.collider.isPositionFree(x, y, s.radius)) { s.taskX = x; s.taskY = y; }
    }
    s.taskS = post.s;
    s.taskDirX = post.dirX;
    s.taskDirY = post.dirY;
    s.phase = 'stand_route';
    s.phaseTick = scouts.tick;
    s.path = null;
    s.awareness = 0;
    s.seen = false;
    s.emote = null;
    s.emoteQueue = [];
  }

  /** the truce is over for this scout: back the way it came, with its senses */
  release(s, tick) {
    s.phase = s.phase === 'stand_route' ? 'stand_route_back' : 'stand_back';
    s.phaseTick = tick;
    s.path = null;
    // what it might have noticed while it kept the truce is not followed up
    s.lastNoiseTick = tick;
    s.trailTick = tick;
    s.awareness = 0;
  }

  /** the errand to an offering is dropped (taken back, the conditions broken, unreachable) */
  dropErrand(sim, s, emote) {
    const o = this.offeringAt(s.taskId);
    if (o && o.scout === s.id) { o.status = 'waiting'; o.scout = null; o.nextCall = sim.scouts.tick + ticks(this.cfg.recallSeconds); }
    s.taskId = null;
    s.phase = 'return';
    s.phaseTick = sim.scouts.tick;
    s.path = null;
    s.anim = 'patrol';
    s.emote = null;
    s.emoteQueue = [];
    if (emote) sim.scouts.emote(s, emote, sim.tuning.ai.emote.shortSeconds);
  }

  /**
   * One tick of a scout on an errand.
   * @returns {boolean} the tick is handled (no ordinary senses this tick); false: the ordinary rules run
   */
  step(sim, scouts, s, P) {
    if (OFFER.has(s.phase)) return this.offerStep(sim, scouts, s, P);
    if (s.phase === 'stand_back' || s.phase === 'stand_route_back') {
      // ordinary senses again; a sighting or a noise takes over from the walk home
      scouts.sense(sim, s, P);
      scouts.think(sim, s, P);
      if (s.state === 'patrol' && (s.phase === 'stand_back' || s.phase === 'stand_route_back')) this.homeStep(sim, scouts, s);
      return true;
    }
    this.standStep(sim, scouts, s);
    return true;
  }

  offerStep(sim, scouts, s, P) {
    const c = this.cfg;
    const o = this.offeringAt(s.taskId);
    const taken = s.phase === 'offer_show';
    if (!o || o.scout !== s.id) { this.dropErrand(sim, s, 'ellipsis'); return false; }
    const dx = P.x - o.x;
    const dy = P.y - o.y;
    const back = dx * dx + dy * dy >= c.standOffPx * c.standOffPx;
    if (!this.peaceful(P) || !back) {
      // the player came close, drew metal or lit something: ordinary rules from here (a scout that has already
      // lifted the offering keeps it, and there is no truce)
      if (!taken) this.dropErrand(sim, s, null);
      else {
        this.remove(o);
        s.taskId = null; s.phase = 'return'; s.phaseTick = scouts.tick; s.path = null; s.emote = null; s.emoteQueue = [];
      }
      return false;
    }
    s.awareness = 0;
    if (s.phase === 'offer_go') {
      s.anim = 'patrol';
      const ox = s.x - s.taskX;
      const oy = s.y - s.taskY;
      if (s.emote?.name === 'question' && ox * ox + oy * oy <= c.seePx * c.seePx && !(sim.collider?.segmentBlocked(s.x, s.y, s.taskX, s.taskY))) {
        s.emote = null;
        scouts.emote(s, 'fish', -1);
        sim.events.push({ type: 'offering_seen', scout: s.id, totem: s.taskId });
      }
      const res = scouts.goTo(sim, s, s.taskX, s.taskY, sim.tuning.ai.patrolSpeed, c.approachArrivePx, true);
      const close = ox * ox + oy * oy <= 4 * c.approachArrivePx * c.approachArrivePx;
      if (res === 'arrived' || (res === 'unreachable' && close)) {
        s.phase = 'offer_take';
        s.phaseTick = scouts.tick;
        s.phaseEnd = scouts.tick + ticks(c.takeSeconds);
        s.path = null;
        scouts.face(s, o.x, o.y);
        if (s.emote?.name !== 'fish') { s.emote = null; scouts.emote(s, 'fish', -1); sim.events.push({ type: 'offering_seen', scout: s.id, totem: s.taskId }); }
      } else if (res === 'unreachable' || scouts.tick - s.phaseTick > ticks(c.approachMaxSeconds)) {
        this.dropErrand(sim, s, 'ellipsis');
      }
      return true;
    }
    if (s.phase === 'offer_take') {
      s.anim = 'gather';
      if (scouts.tick < s.phaseEnd) return true;
      // lifted: it is no longer the player's to take back (it leaves the world when the scout turns away)
      o.status = 'taken';
      s.phase = 'offer_show';
      s.phaseTick = scouts.tick;
      s.phaseEnd = scouts.tick + ticks(c.showSeconds);
      s.emote = null;
      s.emoteQueue = [];
      scouts.emote(s, 'palm_up', c.showSeconds);
      s.anim = 'idle';
      // it turns to where the player is, if it can see them
      if (look(sim, s, P, sim.tuning.ai, false, { inShape: false, seen: false, d: 0, range: 0, centrality: 0 }).seen || this.canSee(sim, s, P)) scouts.face(s, P.x, P.y);
      return true;
    }
    // offer_show
    s.anim = 'idle';
    if (scouts.tick < s.phaseEnd) return true;
    const totem = s.taskId;
    const sector = this.totems.get(totem)?.sector ?? (sim.map ? sim.map.sectorAtWorld(s.taskX, s.taskY) : null);
    const r = sector ? this.startTruce(sim, scouts, sector, o.during === true) : { started: false, until: scouts.tick };
    this.remove(o);
    sim.events.push({ type: 'offering_accepted', totem, sector, scout: s.id, until: r.until, extended: r.started ? !!r.extended : false });
    s.taskId = null;
    s.phase = 'return';
    s.phaseTick = scouts.tick;
    s.path = null;
    return true;
  }

  /** a clear line to the player within sight range in any direction (it turns its head before it shows its palm) */
  canSee(sim, s, P) {
    const r = sim.tuning.ai.sight.range * P.rangeFactor;
    const dx = P.x - s.x;
    const dy = P.y - s.y;
    if (P.hidden || dx * dx + dy * dy > r * r) return false;
    return !sim.collider || !sim.collider.segmentBlocked(s.x, s.y, P.x, P.y);
  }

  /** walking to the post and waiting there */
  standStep(sim, scouts, s) {
    const ai = sim.tuning.ai;
    s.awareness = 0;
    s.seen = false;
    if (s.phase === 'stand_route') {
      s.anim = 'patrol';
      if (this.routeWalk(sim, scouts, s, s.taskS)) { s.phase = 'stand_go'; s.phaseTick = scouts.tick; s.path = null; }
      return;
    }
    if (s.phase === 'stand_go') {
      s.anim = 'patrol';
      const res = scouts.goTo(sim, s, s.taskX, s.taskY, ai.patrolSpeed, this.cfg.postArrivePx, true);
      if (res !== 'moving' || scouts.tick - s.phaseTick > ticks(ai.path.giveUpSeconds)) {
        s.phase = 'stand_wait';
        s.phaseTick = scouts.tick;
        s.path = null;
        s.baseX = s.taskDirX;
        s.baseY = s.taskDirY;
      }
      return;
    }
    // stand_wait: unalert, facing inland, a slow look to one side and the other now and then
    s.anim = 'idle';
    const step = ticks(this.cfg.idleLookSeconds);
    const k = Math.floor((scouts.tick - s.phaseTick) / step + (s.n & 3)) & 3;
    const turn = k === 1 ? 1 : k === 3 ? -1 : 0;
    const [x, y] = turnEighth(s.baseX, s.baseY, turn);
    s.dirX = x;
    s.dirY = y;
    s.facing = facingFor(x, y, s.facing);
  }

  /** back from the post to its waypoint, then along the route to where it left it */
  homeStep(sim, scouts, s) {
    const ai = sim.tuning.ai;
    s.anim = 'patrol';
    if (s.phase === 'stand_back') {
      const r = s.route;
      const p = { x: 0, y: 0 };
      r.pointOnLeg(r.legAt(s.taskS), s.taskS, p);
      const res = scouts.goTo(sim, s, p.x, p.y, ai.patrolSpeed, ai.patrol.arriveRadius + 1.5, false);
      if (res !== 'moving' || scouts.tick - s.phaseTick > ticks(ai.path.giveUpSeconds)) {
        s.x = p.x;
        s.y = p.y;
        s.leg = r.legAt(s.taskS);
        s.s = s.taskS;
        s.phase = 'stand_route_back';
        s.phaseTick = scouts.tick;
        s.path = null;
      }
      return;
    }
    if (this.routeWalk(sim, scouts, s, s.returnS)) {
      s.leg = s.returnLeg;
      s.s = s.returnS;
      s.taskId = null;
      s.phase = 'walk';
      s.path = null;
    }
  }

  /**
   * One tick along the route (whichever way round is shorter) towards walk distance `target`.
   * @returns {boolean} arrived
   */
  routeWalk(sim, scouts, s, target) {
    const r = s.route;
    const L = r.length;
    if (!(L > 0)) return true;
    const mod = (v) => ((v % L) + L) % L;
    const fwd = mod(target - s.s);
    const bwd = mod(s.s - target);
    if (fwd < 1 || bwd < 1) {
      r.pointOnLeg(r.legAt(target), target, scouts.tmp);
      s.leg = r.legAt(target);
      s.s = target;
      return true;
    }
    const k = s.leg;
    const ai = sim.tuning.ai;
    let gx;
    let gy;
    let hop;
    if (fwd <= bwd) {
      const left = r.cum[k] + r.len[k] - s.s;
      if (fwd <= left) { r.pointOnLeg(k, s.s + fwd, scouts.tmp); gx = scouts.tmp.x; gy = scouts.tmp.y; hop = 'here'; }
      else { const j = r.next(k); gx = r.wx[j]; gy = r.wy[j]; hop = 'next'; }
    } else {
      const done = s.s - r.cum[k];
      if (bwd <= done) { r.pointOnLeg(k, s.s - bwd, scouts.tmp); gx = scouts.tmp.x; gy = scouts.tmp.y; hop = 'here'; }
      else { gx = r.wx[k]; gy = r.wy[k]; hop = 'prev'; }
    }
    const res = scouts.goTo(sim, s, gx, gy, ai.patrolSpeed, 1, false);
    s.s = r.projectOnLeg(k, s.x, s.y);
    if (res === 'moving' && scouts.tick - s.phaseTick <= ticks(ai.path.giveUpSeconds) * 8) return false;
    // at the hop (or, never seen, stuck for good: put on it so a scout never freezes)
    s.x = gx;
    s.y = gy;
    s.path = null;
    if (hop === 'here') { s.s = r.projectOnLeg(k, gx, gy); return true; }
    if (hop === 'next') { s.leg = r.next(k); s.s = r.cum[s.leg]; return false; }
    // back onto the end of the previous leg
    s.leg = (k - 1 + r.K) % r.K;
    s.s = r.cum[s.leg] + r.len[s.leg];
    return false;
  }

  // ---- debug (cheats.js) ----------------------------------------------------------------------------------------

  /** start a truce in a sector at once, as if an offering had been accepted (debug) */
  forceTruce(sim, scouts, sector) {
    scouts.tick = sim.tick;
    if (this.inTruce(sector)) return this.truces[sector].until;
    return this.startTruce(sim, scouts, sector, false).until;
  }

  /** end a truce now, as if its tide had run out (debug) */
  forceEnd(sim, scouts, sector) {
    scouts.tick = sim.tick;
    if (this.inTruce(sector)) this.endTruce(sim, scouts, sector, null);
  }

  // ---- state --------------------------------------------------------------------------------------------------

  snapshot() {
    const truces = {};
    for (const k of Object.keys(this.truces).sort()) truces[k] = { ...this.truces[k] };
    return { lying: this.lying.map((o) => ({ ...o })), truces };
  }

  /** @param {ReturnType<Offerings['snapshot']>|null|undefined} snap (absent in older saves: nothing lies anywhere) */
  restore(snap) {
    this.lying = (snap?.lying ?? []).map((o) => ({ ...o }));
    this.truces = {};
    for (const [k, v] of Object.entries(snap?.truces ?? {})) this.truces[k] = { ...v };
  }
}

const C45 = Math.SQRT1_2;
/** a unit vector turned one eighth clockwise (n 1), anticlockwise (n -1) or not at all */
function turnEighth(x, y, n) {
  if (n === 0) return [x, y];
  const nx = n > 0 ? (x - y) * C45 : (x + y) * C45;
  const ny = n > 0 ? (x + y) * C45 : (y - x) * C45;
  const l = Math.sqrt(nx * nx + ny * ny) || 1;
  return [nx / l, ny / l];
}
