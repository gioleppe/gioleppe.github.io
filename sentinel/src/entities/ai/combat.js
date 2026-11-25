// Arrows (step 4.3, spec §7.3): the warning arrow that lands short of the player and can never hit, and the
// lethal arrow, aimed with lead and an error that grows with distance, darkness, cover and the target's speed
// across the line of fire, so a moving player can dodge. Arrows are ordinary projectiles (Projectile.js): flight
// stops at the first wall or trunk (planFlight), and a lethal arrow is tested against the player's body along
// every segment of its flight. A hit is `player.applyArrowHit()` (50 HP, bleed and limp).
//
// Projectile kinds: 'warning_arrow' (no hit test), 'arrow' (lethal), 'arrow_spent' (an arrow that already hit,
// dropping out of the list on the next update).
import { registerImpact, planFlight } from '../Projectile.js';

/** the flight-planning numbers for an arrow (planFlight's shape), from tuning.ai.arrow */
function flightCfg(a, maxRange) {
  return { maxRange, radius: a.landRadius, marchStep: a.marchStep, backoff: a.backoff, landSearch: a.landSearch };
}

/**
 * Loose a warning arrow from a scout: it lands `shortPx` in front of the player, between them (half way when the
 * player is closer than twice that), and stops at anything that blocks the way.
 * @returns {import('../Projectile.js').Projectile}
 */
export function fireWarningArrow(sim, s, px, py, ai) {
  const a = ai.arrow;
  const dx = px - s.x;
  const dy = py - s.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const short = d > ai.warn.shortPx * 2 ? ai.warn.shortPx : d / 2;
  const reach = d - short;
  const ux = d > 0 ? dx / d : s.dirX;
  const uy = d > 0 ? dy / d : s.dirY;
  const plan = planFlight(sim, s.x, s.y, s.x + ux * reach, s.y + uy * reach, flightCfg(a, reach));
  return sim.projectiles.spawn({
    kind: 'warning_arrow', x0: s.x, y0: s.y, x1: plan.x, y1: plan.y, aimX: plan.aimX, aimY: plan.aimY,
    speed: a.speed, arc: a.arc, ownerId: s.id,
  });
}

/**
 * The spread of a lethal shot in px (half-width of the uniform lateral error at the target).
 * @param {Object} a tuning.ai.arrow
 * @param {number} d distance to the target
 * @param {number} cross target speed across the line of fire, px/s
 * @param {number} ambient light factor 0..1
 * @param {boolean} inCover
 */
export function shotSpread(a, d, cross, ambient, inCover) {
  return a.baseError + a.errorPerPx * d + a.errorPerCrossSpeed * cross + a.darkError * (1 - ambient) + (inCover ? a.coverError : 0);
}

/**
 * Loose a lethal arrow at the player: aimed where the player will be (velocity x flight time x leadFactor, an
 * imperfect lead), plus a lateral error drawn from sim.rng, flying on past the aim point until it lands or hits.
 * @param {import('./env.js').PlayerView} P
 * @returns {import('../Projectile.js').Projectile}
 */
export function fireLethalArrow(sim, s, P, ai) {
  const a = ai.arrow;
  let dx = P.x - s.x;
  let dy = P.y - s.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const t = d / a.speed;
  const ax = P.x + P.vx * t * a.leadFactor;
  const ay = P.y + P.vy * t * a.leadFactor;
  const cross = P.vx * -uy + P.vy * ux;
  const spread = shotSpread(a, d, cross < 0 ? -cross : cross, P.ambient, P.inCover);
  const off = (sim.rng.next() * 2 - 1) * spread;
  const tx = ax - uy * off;
  const ty = ay + ux * off;
  dx = tx - s.x;
  dy = ty - s.y;
  const da = Math.sqrt(dx * dx + dy * dy) || 1;
  const reach = da + a.overshoot;
  const plan = planFlight(sim, s.x, s.y, s.x + (dx / da) * reach, s.y + (dy / da) * reach, flightCfg(a, reach));
  return sim.projectiles.spawn({
    kind: 'arrow', x0: s.x, y0: s.y, x1: plan.x, y1: plan.y, aimX: tx, aimY: ty, speed: a.speed, arc: a.arc, ownerId: s.id,
  });
}

/**
 * Does the segment (x0, y0)-(x1, y1) pass within r of (cx, cy)?
 */
export function segmentHitsCircle(x0, y0, x1, y1, cx, cy, r) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((cx - x0) * dx + (cy - y0) * dy) / l2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const qx = x0 + dx * t - cx;
  const qy = y0 + dy * t - cy;
  return qx * qx + qy * qy <= r * r;
}

/** does a lethal arrow's last segment of flight strike the player? */
function strikes(sim, p, x1, y1) {
  const pl = sim.player;
  if (pl.dead) return false;
  return segmentHitsCircle(p.prevX, p.prevY, x1, y1, pl.x, pl.y, pl.radius + sim.tuning.ai.arrow.hitRadius);
}

/** the hit itself: damage through the player's own rule, an event for the presentation */
function hit(sim, p) {
  const lost = sim.player.applyArrowHit();
  sim.scouts?.onPlayerHit(sim);
  sim.events.push({ type: 'arrow_hit', id: p.id, scout: p.ownerId, x: sim.player.x, y: sim.player.y, amount: lost });
}

/**
 * After the projectiles moved this tick: every lethal arrow still in flight is tested along the segment it just
 * flew. One that strikes is spent (it stops where it is and leaves the list on the next update).
 */
export function sweepArrows(sim) {
  for (const p of sim.projectiles.list) {
    if (p.kind !== 'arrow') continue;
    if (!strikes(sim, p, p.x, p.y)) continue;
    hit(sim, p);
    p.kind = 'arrow_spent';
    p.x1 = p.x;
    p.y1 = p.y;
    p.ticks = p.t;
  }
}

registerImpact('arrow', (sim, p) => {
  // the last segment (an arrival is not seen by sweepArrows: it has already left the list)
  if (strikes(sim, p, p.x1, p.y1)) { hit(sim, p); return; }
  sim.scouts?.stickArrow(p, false);
  sim.events.push({ type: 'arrow_land', id: p.id, scout: p.ownerId, warning: false, x: p.x1, y: p.y1 });
});
registerImpact('warning_arrow', (sim, p) => {
  sim.scouts?.stickArrow(p, true);
  sim.events.push({ type: 'arrow_land', id: p.id, scout: p.ownerId, warning: true, x: p.x1, y: p.y1 });
});
registerImpact('arrow_spent', () => {});
