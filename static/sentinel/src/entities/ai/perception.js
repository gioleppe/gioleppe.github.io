// What a scout notices (step 4.1, spec §6.1, §7.3): sight, hearing and footprints. Dot products and squared
// distances only (no angles), so the same numbers come out in Node and in every browser.
//
// Sight: a cone of half-angle acos(sight.coneCos) in the facing direction out to the effective range, plus a short
// all-round presence radius; both need a clear line (Collider.segmentBlocked: blocked tiles and sight-blocking
// props). Effective range = sight.range x player.visibilityFactor (cover: 0.35) x ambient light (night, squall;
// a lit flashlight raises it) x Resonance detection (1.2 Humming) x crouchFactor (crouched in the open)
// x alertRangeMultiplier (a scout already hunting looks harder).
//
// Awareness is a meter 0..1: while the player is in sight it fills at
//   fillPerSecond x (1 + closeBonus x (1 - d / range)) x (centralMin + (1 - centralMin) x centrality)
// (x alertFillMultiplier for a scout already in WARN/CHASE/SEARCH), and drains at drainPerSecond otherwise.
// centrality is 1 on the facing line and 0 at the cone's edge (1 inside the presence radius).

/**
 * The scout's view of the player this tick.
 * @param {import('../../sim/Sim.js').Sim} sim
 * @param {Object} s scout
 * @param {import('./env.js').PlayerView} P
 * @param {Object} ai tuning.ai
 * @param {boolean} alert the scout is hunting (WARN, CHASE, SEARCH): longer sight
 * @param {Object} out reused: { inShape, seen, d, range, centrality }
 */
export function look(sim, s, P, ai, alert, out) {
  out.inShape = false;
  out.seen = false;
  out.centrality = 0;
  const dx = P.x - s.x;
  const dy = P.y - s.y;
  const d2 = dx * dx + dy * dy;
  const d = Math.sqrt(d2);
  out.d = d;
  const sight = ai.sight;
  const range = sight.range * P.rangeFactor * (alert ? sight.alertRangeMultiplier : 1);
  out.range = range;
  if (P.hidden) return out;
  const pr = sight.presenceRadius * P.presenceFactor;
  if (d2 <= pr * pr) {
    out.inShape = true;
    out.centrality = 1;
  } else if (d2 <= range * range) {
    const dot = dx * s.dirX + dy * s.dirY;
    if (dot >= sight.coneCos * d) {
      out.inShape = true;
      const c = (dot / d - sight.coneCos) / (1 - sight.coneCos);
      out.centrality = c < 0 ? 0 : c > 1 ? 1 : c;
    }
  }
  if (!out.inShape) return out;
  out.seen = !sim.collider || !sim.collider.segmentBlocked(s.x, s.y, P.x, P.y);
  return out;
}

/**
 * Awareness gained per second while the player is in sight.
 * @param {Object} aw tuning.ai.awareness
 */
export function fillRate(aw, d, range, centrality, alert) {
  let near = range > 0 ? 1 - d / range : 1;
  if (near < 0) near = 0; else if (near > 1) near = 1;
  return aw.fillPerSecond * (1 + aw.closeBonus * near) * (aw.centralMin + (1 - aw.centralMin) * centrality) * (alert ? aw.alertFillMultiplier : 1);
}

/** is a world point inside a scout's cone (any range)? */
export function inCone(s, x, y, coneCos) {
  const dx = x - s.x;
  const dy = y - s.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d === 0) return true;
  return dx * s.dirX + dy * s.dirY >= coneCos * d;
}

/**
 * The loudest new noise a scout hears this tick (one it has not reacted to: emitted after `s.lastNoiseTick`).
 * @returns {null | { x: number, y: number, radius: number, kind: string, id: number, tick: number, strength: number, sourceId: string|null }}
 */
export function hear(sim, s) {
  const heard = sim.noise.heardFrom(s.x, s.y);
  let best = null;
  let newest = s.lastNoiseTick;
  for (const n of heard) {
    if (n.tick <= s.lastNoiseTick) continue;
    if (n.sourceId === s.id) continue;
    if (n.tick > newest) newest = n.tick;
    const strength = n.radius > 0 ? 1 - n.distance / n.radius : 0;
    if (!best || strength > best.strength) best = { x: n.x, y: n.y, radius: n.radius, kind: n.kind, id: n.id, tick: n.tick, strength, sourceId: n.sourceId };
  }
  s.lastNoiseTick = newest;
  return best;
}

/**
 * A fresh footprint the scout can see: within footprints.sightRange, inside its cone, in a clear line, made after
 * the last print it followed (`s.trailTick`) and younger than the prints' lifetime (spec §6.1: 15 s).
 * The freshest such print wins.
 * @returns {Object|null}
 */
export function spotFootprint(sim, s, ai) {
  const f = ai.footprints;
  const life = sim.tuning.footprints.lifetimeSeconds;
  const near = sim.footprintsNear(s.x, s.y, f.sightRange);
  for (const fp of near) {   // freshest first
    if (fp.tick <= s.trailTick || !(fp.age < life)) continue;
    if (!inCone(s, fp.x, fp.y, ai.sight.coneCos)) continue;
    if (sim.collider && sim.collider.segmentBlocked(s.x, s.y, fp.x, fp.y)) continue;
    return fp;
  }
  return null;
}

/**
 * The next print along a trail from a point: the freshest one within `trailStep` of it made after `afterTick`.
 * @returns {Object|null}
 */
export function nextFootprint(sim, x, y, afterTick, ai) {
  const life = sim.tuning.footprints.lifetimeSeconds;
  for (const fp of sim.footprintsNear(x, y, ai.footprints.trailStep)) {
    if (fp.tick > afterTick && fp.age < life) return fp;
  }
  return null;
}
