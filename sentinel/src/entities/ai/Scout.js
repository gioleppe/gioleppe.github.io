// One Sentinelese scout as the simulation holds it (steps 4.1 to 4.3): plain fields only, every one of them in the
// snapshot, timers as absolute ticks. The behaviour is in SentineleseAI.js; this file is the record.
import { makeContact } from '../../world/collision.js';
import { idHash } from './Route.js';

/** @typedef {'patrol'|'investigate'|'search'|'warn'|'chase'} ScoutState */
/** every value `scout.state` can take, in rising order of alarm (the threat level orders them differently) */
export const SCOUT_STATES = Object.freeze(['patrol', 'investigate', 'search', 'warn', 'chase']);

/** the snapshot fields (all plain values or arrays of plain values) */
const FIELDS = Object.freeze([
  'id', 'routeId', 'post', 'x', 'y', 'prevX', 'prevY', 'dirX', 'dirY', 'facing', 'radius',
  'state', 'phase', 'stateTick', 'phaseTick', 'phaseEnd', 'reason', 'lod', 'anim',
  'leg', 's', 'returnLeg', 'returnS', 'returnTries',
  'awareness', 'seen', 'dist', 'lastNoiseTick', 'trailTick',
  'poiX', 'poiY', 'poiKind',
  'path', 'pathI', 'pathStatus', 'pathDirect', 'goalX', 'goalY', 'repathAt', 'blockedTicks',
  'lkX', 'lkY', 'lkVX', 'lkVY', 'lastSeenTick', 'lostTick',
  'warnD0', 'hitD0', 'warnedUntil', 'cooldownUntil', 'drawEnd', 'chaseTick', 'whistleReady', 'recruitedBy',
  'spots', 'spotI', 'searchEnd', 'baseX', 'baseY', 'fixedFacing',
  'emote', 'emoteQueue',
]);

/**
 * Values a new scout starts with: a snapshot leaves these out (37 patrolling scouts would otherwise fill a save
 * with defaults), and restore starts from a new scout, so a missing field is exactly this value.
 */
const DEFAULTS = Object.freeze({
  post: null, state: 'patrol', phase: 'walk', stateTick: 0, phaseTick: 0, phaseEnd: 0, reason: null, lod: 'far', anim: 'patrol',
  returnLeg: 0, returnS: 0, returnTries: 0, awareness: 0, seen: false, dist: -1, lastNoiseTick: -1, trailTick: -1,
  poiX: 0, poiY: 0, poiKind: null, path: null, pathI: 0, pathStatus: 'found', pathDirect: false, goalX: 0, goalY: 0,
  repathAt: 0, blockedTicks: 0, lkX: 0, lkY: 0, lkVX: 0, lkVY: 0, lastSeenTick: -1, lostTick: -1, warnD0: 0, hitD0: -1,
  warnedUntil: -1, cooldownUntil: 0, drawEnd: 0, chaseTick: 0, whistleReady: 0, recruitedBy: null,
  spots: [], spotI: 0, searchEnd: 0, fixedFacing: false, emote: null, emoteQueue: [],
});
const isDefault = (k, v) => {
  if (!(k in DEFAULTS)) return false;
  const d = DEFAULTS[k];
  if (Array.isArray(d)) return Array.isArray(v) && v.length === 0;
  return v === d;
};

const copy = (v) => (Array.isArray(v) ? v.map(copy) : v && typeof v === 'object' ? { ...v } : v);

export class Scout {
  /**
   * @param {Object} o
   * @param {string} o.id
   * @param {import('./Route.js').Route} o.route its patrol route (a one-point route is a post)
   * @param {string|null} o.routeId the map route's id, or null for a post (then `post` is [x, y, dirX, dirY])
   * @param {number} o.radius
   */
  constructor({ id, route, routeId = null, radius }) {
    this.id = id;
    /** a stable integer per scout, for per-scout variety without the rng (not state: derived from the id) */
    this.n = idHash(id);
    /** @type {import('./Route.js').Route} (not state: rebuilt from routeId or post) */
    this.route = route;
    this.routeId = routeId;
    /** @type {[number, number]|null} the point of a scout without a map route */
    this.post = routeId ? null : [route.wx[0], route.wy[0], route.ux[0], route.uy[0]];
    this.x = route.wx[0];
    this.y = route.wy[0];
    this.prevX = this.x;
    this.prevY = this.y;
    /** facing as a unit vector (sight cone); `facing` is its four-way sprite direction */
    this.dirX = route.ux[0];
    this.dirY = route.uy[0];
    this.facing = 'S';
    this.radius = radius;

    /** @type {ScoutState} */
    this.state = 'patrol';
    /** sub-state: patrol walk|pause|return, investigate go|look, search go|look, warn shout|draw|hold|lower, chase run|draw */
    this.phase = 'walk';
    this.stateTick = 0;
    this.phaseTick = 0;
    /** tick the phase ends (pauses, looks, warn phases) */
    this.phaseEnd = 0;
    /** why the last state was entered (for events and debugging) */
    this.reason = null;
    /** 'far': moved along its route by distance only, sees and hears nothing; 'near': the full AI */
    this.lod = 'far';
    /** sentinelese sheet state: idle patrol search warn_bow lower_bow chase */
    this.anim = 'patrol';

    // route position: leg k (from waypoint k) and walk distance s along the route's cycle
    this.leg = 0;
    this.s = 0;
    /** where it left the route, to come back to exactly there */
    this.returnLeg = 0;
    this.returnS = 0;
    this.returnTries = 0;

    // perception
    /** 0..1 */
    this.awareness = 0;
    /** sees the player this tick */
    this.seen = false;
    /** distance to the player this tick (px; -1 until a near scout has looked) */
    this.dist = -1;
    /** emission tick of the last noise reacted to */
    this.lastNoiseTick = -1;
    /** tick of the last footprint followed: older prints are not followed again */
    this.trailTick = -1;

    /** point of interest (INVESTIGATE) and what it was: noise | impact | footprint | glimpse */
    this.poiX = 0;
    this.poiY = 0;
    this.poiKind = null;

    // navigation
    /** @type {Array<[number, number]>|null} waypoints of the path being followed */
    this.path = null;
    this.pathI = 0;
    this.pathStatus = 'found';
    /** the path is the straight line to a goal that may move (it follows the goal) */
    this.pathDirect = false;
    this.goalX = 0;
    this.goalY = 0;
    this.repathAt = 0;
    /** consecutive ticks of (almost) no progress */
    this.blockedTicks = 0;

    // the hunt
    /** last known position and velocity of the player */
    this.lkX = 0;
    this.lkY = 0;
    this.lkVX = 0;
    this.lkVY = 0;
    this.lastSeenTick = -1;
    /** last tick the hunt had the player (seen outside a safe zone): six seconds after it, SEARCH */
    this.lostTick = -1;
    /** distance to the player when the warning began */
    this.warnD0 = 0;
    /** distance to the player when an arrow struck them (-1: no hit to judge); see Scouts.afterHitHold */
    this.hitD0 = -1;
    /** until this tick a warned player gets no second warning */
    this.warnedUntil = -1;
    this.cooldownUntil = 0;
    this.drawEnd = 0;
    this.chaseTick = 0;
    this.whistleReady = 0;
    /** id of the scout whose whistle brought this one, or null */
    this.recruitedBy = null;
    /** @type {Array<[number, number]>} SEARCH: the spots to sweep */
    this.spots = [];
    this.spotI = 0;
    this.searchEnd = 0;
    /** the direction a look-around sweeps about */
    this.baseX = this.dirX;
    this.baseY = this.dirY;
    /** a post scout that stares instead of looking round (tests, a gate guard) */
    this.fixedFacing = false;

    /** @type {{ name: string, until: number }|null} the emote bubble; until -1 = as long as the state lasts */
    this.emote = null;
    /** @type {Array<[string, number]>} emotes to show next: [name, ticks (-1 = for the rest of the state)] */
    this.emoteQueue = [];

    /** collider scratch (not state) */
    this.contact = makeContact();
  }

  snapshot() {
    const out = {};
    for (const k of FIELDS) if (!isDefault(k, this[k])) out[k] = copy(this[k]);
    return out;
  }

  /**
   * @param {Object} o from snapshot()
   * @param {import('./Route.js').Route} route
   */
  static restore(o, route) {
    const s = new Scout({ id: o.id, route, routeId: o.routeId, radius: o.radius });
    for (const k of FIELDS) if (o[k] !== undefined) s[k] = copy(o[k]);
    return s;
  }
}
