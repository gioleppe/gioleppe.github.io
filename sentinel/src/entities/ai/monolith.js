// Respecting the monolith (step 4.4, spec §7.3): when the island's anomaly pulses near a scout that has the player
// in sight, and the player answers by switching off what they carry that hums, the scout sees it. It shows [eye],
// lowers its bow and lets them pass. Not a trick and not a reset: something switched off that was on, inside a
// short window after the pulse, seen by the one watching. All numbers in tuning.ai.monolith.
//
//   window     anomaly_pulse (Resonance.pulses[].last is this tick) from an origin within pulseRadiusPx of a near
//              scout that sees the player with awareness >= suspicious, or warns, or chases without having loosed
//              a lethal arrow: windowUntil = now + windowSeconds (event monolith_window { zone, scout }).
//   gesture    the player goes from some electronics on to none on this tick, with no metal in hand.
//   respect    every scout with an open window that sees the player at that moment: [eye], lower_bow (patrol phase
//              `respect`, then back to its route), and while respectUntil holds it does not warn or hunt the player:
//              its awareness stays at 0, the player's sounds and prints are not followed. respectUntil is refreshed
//              to now + afterSeconds while it sees them, never past respectMax (granted + maxSeconds).
//              Event monolith_respect { scout, until } (until = respectMax, the latest it can last).
//   it ends    a device switched on, metal in hand, within chase.tooCloseRadius, running at it, or time:
//              monolith_respect_end { scout, reason: 'device'|'metal'|'close'|'sprint'|'expired' }.
//   once       per scout per intervalSeconds.
import { TICK_HZ } from '../../sim/constants.js';

const ticks = (s) => Math.round(s * TICK_HZ);

/** does the scout tolerate the player now (no warning, no hunt by sight or sound) */
export function respecting(s, tick) {
  return s.respectUntil > tick;
}

export class MonolithRespect {
  /** @param {import('../../sim/Sim.js').Sim} sim */
  constructor(sim) {
    this.cfg = sim.tuning.ai.monolith;
    /** electronics were on at the end of the last tick (the gesture is the change from on to off) */
    this.wasOn = false;
  }

  /**
   * Once per tick, before the scouts sense and decide: open windows on a pulse, grant on the gesture, end
   * tolerances. Costs a loop over the pulse origins and, when something happens, the near scouts.
   */
  update(sim, scouts, P) {
    const tick = scouts.tick;
    const c = this.cfg;
    const inv = sim.inventory;
    const on = !!inv?.carriesActiveElectronics;
    const gesture = this.wasOn && !on && !inv.holdingMetal && !sim.player.dead;
    this.wasOn = on;
    const sus = sim.tuning.ai.awareness.suspicious;
    const r2 = c.pulseRadiusPx * c.pulseRadiusPx;
    for (const z of sim.resonance?.pulses ?? []) {
      if (z.last !== tick) continue;
      for (const s of scouts.list) {
        if (s.lod !== 'near' || s.kind === 'gatherer' || !s.seen || tick < s.respectReady || respecting(s, tick)) continue;
        const watching = s.state === 'chase' ? !s.loosed : s.awareness >= sus || s.state === 'warn';
        if (!watching) continue;
        const dx = s.x - z.x;
        const dy = s.y - z.y;
        if (dx * dx + dy * dy > r2) continue;
        s.windowUntil = tick + ticks(c.windowSeconds);
        s.windowZone = z.id;
        sim.events.push({ type: 'monolith_window', zone: z.id, scout: s.id });
      }
    }
    for (const s of scouts.list) {
      if (s.windowUntil >= tick && gesture && s.seen && !(s.state === 'chase' && s.loosed)) this.grant(sim, scouts, s, P);
      if (s.windowUntil >= 0 && s.windowUntil < tick) { s.windowUntil = -1; s.windowZone = null; }
      if (s.respectUntil >= 0) this.keep(sim, scouts, s, P, on);
    }
  }

  /** the gesture is seen: the bow comes down */
  grant(sim, scouts, s, P) {
    const c = this.cfg;
    const tick = scouts.tick;
    s.windowUntil = -1;
    s.windowZone = null;
    s.respectReady = tick + ticks(c.intervalSeconds);
    s.respectMax = tick + ticks(c.maxSeconds);
    s.respectUntil = Math.min(s.respectMax, tick + ticks(c.afterSeconds));
    s.awareness = 0;
    if (s.state === 'patrol' && (s.phase === 'walk' || s.phase === 'pause')) scouts.leaveRoute(s);
    scouts.setState(sim, s, 'patrol', 'respect');
    s.phase = 'respect';
    s.phaseTick = tick;
    s.phaseEnd = tick + ticks(c.watchSeconds);
    s.anim = 'lower_bow';
    scouts.face(s, P.x, P.y);
    scouts.emote(s, 'eye', c.watchSeconds);
    sim.events.push({ type: 'monolith_respect', scout: s.id, until: s.respectMax });
  }

  /** a tolerance runs on while the player keeps faith with it */
  keep(sim, scouts, s, P, on) {
    const c = this.cfg;
    const tick = scouts.tick;
    let why = null;
    const dx = s.x - P.x;
    const dy = s.y - P.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const v = Math.sqrt(P.vx * P.vx + P.vy * P.vy);
    if (on) why = 'device';
    else if (sim.inventory?.holdingMetal) why = 'metal';
    else if (d <= sim.tuning.ai.chase.tooCloseRadius) why = 'close';
    else if (v > c.sprintTowardSpeed && d > 0 && (P.vx * dx + P.vy * dy) >= c.sprintTowardCos * v * d) why = 'sprint';
    else if (tick >= s.respectUntil) why = 'expired';
    if (why) {
      s.respectUntil = -1;
      s.respectMax = -1;
      sim.events.push({ type: 'monolith_respect_end', scout: s.id, reason: why });
      return;
    }
    if (s.seen) s.respectUntil = Math.min(s.respectMax, tick + ticks(c.afterSeconds));
    s.awareness = 0;
  }

  /** the `respect` phase: it stands, bow lowered, watching the player go, then walks back to its route */
  step(sim, scouts, s, P) {
    s.anim = 'lower_bow';
    if (s.seen) scouts.face(s, P.x, P.y);
    if (scouts.tick < s.phaseEnd) return;
    s.phase = 'return';
    s.phaseTick = scouts.tick;
    s.path = null;
  }

  snapshot() {
    return { wasOn: this.wasOn };
  }

  restore(snap) {
    this.wasOn = snap?.wasOn === true;
  }
}
