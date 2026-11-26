// Orders the Signal Peak climax (step 5.4) gives scouts, kept apart from the state machine so it stays one file:
// the beacon calls hunters to the peak, they search it, and the patrol boat's light sends them back down. The
// orders only use the machine's own transitions (CHASE towards a place, SEARCH, back to the route), so every
// fairness rule of SentineleseAI (telegraphed draws, stagger, at most arrow.maxShooters, the hold after a hit)
// still applies. Simulation side.
import { viewPlayer } from './env.js';

/**
 * Send a scout to search about (x, y): SEARCH with that as the last known place (the beacon tells them where,
 * not who). Seeing the player there fills its awareness as any alert scout's does (faster close up and in the
 * light, slower in the dark), and full awareness turns the search into a CHASE, with no warning (Resonance is
 * Agitated). A scout already chasing just gets the new place if it has lost the player.
 * @param {import('../SentineleseAI.js').Scouts} scouts
 */
export function orderConverge(scouts, sim, s, x, y, { approach = false } = {}) {
  if (sim.player.dead) return;
  if (s.state === 'chase') {
    if (!s.seen) { s.lkX = x; s.lkY = y; }
    return;
  }
  scouts.tick = sim.tick;
  if (s.state === 'warn') scouts.endWarn(sim, s, 'converge');
  if (s.lod === 'far') scouts.wake(sim, s);
  if (approach) {
    // far from the peak: they come at a run (CHASE towards the place, called by the beacon: no whistle)
    const P = viewPlayer(sim, scouts.ai, scouts.cheats, scouts.inland, {});
    scouts.chase(sim, s, 'converge', P, x, y, 'beacon');
    return;
  }
  scouts.leaveRoute(s);
  s.lkX = x;
  s.lkY = y;
  s.lkVX = 0;
  s.lkVY = 0;
  scouts.search(sim, s);
  s.reason = 'converge';
}

/**
 * A scout that ran up to the peak and has not seen the player arrives: it slows to a SEARCH about (x, y), its
 * awareness back to `suspicious` so a sighting must build again (the dark and cover count).
 */
export function arriveSearching(scouts, sim, s, x, y, suspicious) {
  if (s.state !== 'chase' || s.seen || s.reason !== 'converge') return false;
  scouts.tick = sim.tick;
  s.lkX = x;
  s.lkY = y;
  s.lkVX = 0;
  s.lkVY = 0;
  s.awareness = Math.min(s.awareness, suspicious);
  scouts.search(sim, s);
  s.reason = 'converge';
  return true;
}

/**
 * The light is on them: they shield their eyes and walk back to their routes, unharmed [ellipsis].
 */
export function orderWithdraw(scouts, sim, s) {
  if (s.state === 'patrol') return;
  scouts.tick = sim.tick;
  scouts.backToRoute(sim, s, 'ellipsis');
}
