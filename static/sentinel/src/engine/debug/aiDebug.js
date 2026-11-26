// Debug tools for the Sentinelese (steps 4.1 to 4.3; `?debug` only): sight cones with their effective range
// against the player, awareness meters and states, routes and the current waypoint, paths, last known
// positions and search spots, hearing, the safe zone and the LOD state; a readout with the near/far counts, the
// cost of the AI per tick and the threat; actions to spawn a scout at the cursor, freeze the AI, make the player
// invisible, deafen the scouts, force the nearest scout into each state and bring it to the player.
// main.js calls registerAiDebug(debug) once debug mode is up; every write goes through cheats.js.
import { COLORS, label } from './layers.js';
import * as cheats from './cheats.js';
import { Scouts } from '../../entities/SentineleseAI.js';
import { viewPlayer } from '../../entities/ai/env.js';

export const AI_COLORS = Object.freeze({
  cone: '#e9c46a', coneSeen: '#e76f51', presence: 'rgba(233, 196, 106, 0.5)', route: 'rgba(102, 194, 176, 0.55)',
  waypoint: '#66c2b0', path: '#90be6d', lk: '#f72585', spot: '#f4a261', heard: '#f4a261',
  far: 'rgba(216, 210, 191, 0.5)', truce: '#8ecae6', window: '#c77dff',
  state: { patrol: '#d8d2bf', investigate: '#e9c46a', search: '#f4a261', warn: '#ff9f1c', chase: '#e76f51' },
});

/** per-tick cost of Scouts.update, measured here only (presentation side; the simulation never reads a clock) */
export const aiCost = { last: 0, avg: 0, worst: 0, samples: 0 };
let wrapped = false;

/** time every Scouts.update call (once per page; debug mode only) */
export function measureAiCost() {
  if (wrapped) return;
  wrapped = true;
  const orig = Scouts.prototype.update;
  Scouts.prototype.update = function timedUpdate(sim) {
    const t0 = performance.now();
    orig.call(this, sim);
    const ms = performance.now() - t0;
    aiCost.last = ms;
    aiCost.samples += 1;
    aiCost.avg += (ms - aiCost.avg) * (aiCost.samples < 60 ? 1 / aiCost.samples : 1 / 60);
    aiCost.worst = Math.max(aiCost.worst * 0.995, ms);
  };
}

const at = (s, alpha) => ({ x: s.prevX + (s.x - s.prevX) * alpha, y: s.prevY + (s.y - s.prevY) * alpha });
const sx = (camera, x) => Math.round(x) - camera.originX + 0.5;
const sy = (camera, y) => Math.round(y) - camera.originY + 0.5;

function ring(ctx, camera, x, y, r) {
  ctx.beginPath();
  ctx.arc(sx(camera, x), sy(camera, y), Math.max(0, r), 0, Math.PI * 2);
  ctx.stroke();
}

function line(ctx, camera, x0, y0, x1, y1) {
  ctx.beginPath();
  ctx.moveTo(sx(camera, x0), sy(camera, y0));
  ctx.lineTo(sx(camera, x1), sy(camera, y1));
  ctx.stroke();
}

/** scouts whose position is within the view (plus a margin) */
function visibleScouts(sim, camera, margin = 260) {
  const v = camera.visibleRect();
  return (sim.scouts?.list ?? []).filter((s) => s.x > v.x - margin && s.x < v.x + v.w + margin && s.y > v.y - margin && s.y < v.y + v.h + margin);
}

/** the readout lines */
export function aiLines(sim) {
  const sc = sim.scouts;
  if (!sc) return [];
  const t = sim.threat ?? { level: 'none', count: 0 };
  const near = sc.list.filter((s) => s.lod === 'near');
  const busy = sc.list.filter((s) => s.state !== 'patrol').length;
  const flags = Object.entries(sc.cheats).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(' ');
  return [
    `scouts ${sc.list.length}  near ${near.length}  far ${sc.list.length - near.length}  busy ${busy}  ${flags}`,
    `  ai ${aiCost.last.toFixed(3)} ms/tick  avg ${aiCost.avg.toFixed(3)}  worst ${aiCost.worst.toFixed(3)}  path nodes ${sc.lastNodes}`,
    `  threat ${t.level}${t.count ? ` x${t.count} nearest ${Math.round(t.nearest)}px ${t.nearestId}` : ''}  max awareness ${sc.maxAwareness.toFixed(2)}`,
    ...near.slice(0, 4).map((s) => `  ${s.id} ${s.state}/${s.phase} a=${s.awareness.toFixed(2)} d=${s.dist >= 0 ? Math.round(s.dist) : '-'}${s.seen ? ' SEES' : ''}`),
  ];
}

/**
 * Register the AI layers and actions.
 * @param {import('./DebugMode.js').DebugMode} debug
 */
export function registerAiDebug(debug) {
  measureAiCost();
  debug.addLayer({
    id: 'ai-cones', label: 'Scout sight cones', group: 'ai', default: true,
    drawWorld(ctx, sim, camera, env) {
      const ai = sim.tuning.ai;
      if (!ai || !sim.scouts) return;
      const P = viewPlayer(sim, ai, sim.scouts.cheats, sim.scouts.inland, {});
      const half = Math.acos(ai.sight.coneCos);   // drawing only
      ctx.lineWidth = 1;
      for (const s of visibleScouts(sim, camera)) {
        if (s.lod !== 'near') continue;
        const p = at(s, env.alpha);
        const alert = s.state === 'warn' || s.state === 'chase' || s.state === 'search';
        const r = ai.sight.range * P.rangeFactor * (alert ? ai.sight.alertRangeMultiplier : 1);
        const a = Math.atan2(s.dirY, s.dirX);
        ctx.strokeStyle = s.seen ? AI_COLORS.coneSeen : AI_COLORS.cone;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.moveTo(sx(camera, p.x), sy(camera, p.y));
        ctx.arc(sx(camera, p.x), sy(camera, p.y), r, a - half, a + half);
        ctx.closePath();
        ctx.stroke();
        ctx.strokeStyle = AI_COLORS.presence;
        ring(ctx, camera, p.x, p.y, ai.sight.presenceRadius * P.presenceFactor);
        ctx.globalAlpha = 1;
      }
    },
  });
  debug.addLayer({
    id: 'ai-state', label: 'Scout state + awareness', group: 'ai', default: true,
    drawUi(ctx, sim, vp, env) {
      for (const s of visibleScouts(sim, env.camera, 0)) {
        const p = at(s, env.alpha);
        const q = env.camera.worldToScreen(p.x, p.y);
        const color = AI_COLORS.state[s.state] ?? COLORS.text;
        if (s.lod === 'far') { label(ctx, `${s.id} far`, q.x, q.y + 3, AI_COLORS.far, 'center'); continue; }
        label(ctx, `${s.state}/${s.phase}`, q.x, q.y + 3, color, 'center');
        // the meter: 20 px, filled by awareness, a tick at `suspicious`
        const w = 20;
        const x0 = Math.round(q.x - w / 2);
        const y0 = Math.round(q.y + 11);
        ctx.fillStyle = 'rgba(11, 20, 22, 0.8)';
        ctx.fillRect(x0 - 1, y0 - 1, w + 2, 4);
        ctx.fillStyle = color;
        ctx.fillRect(x0, y0, Math.round(w * s.awareness), 2);
        ctx.fillStyle = COLORS.text;
        ctx.fillRect(x0 + Math.round(w * sim.tuning.ai.awareness.suspicious), y0 - 1, 1, 4);
      }
    },
  });
  debug.addLayer({
    id: 'ai-routes', label: 'Patrol routes + waypoint', group: 'ai', default: false,
    drawWorld(ctx, sim, camera) {
      if (!sim.scouts) return;
      ctx.lineWidth = 1;
      const shown = new Set();
      for (const s of visibleScouts(sim, camera, 600)) {
        const r = s.route;
        if (!shown.has(r)) {
          shown.add(r);
          ctx.strokeStyle = AI_COLORS.route;
          for (let k = 0; k < r.K; k++) {
            const j = r.next(k);
            line(ctx, camera, r.wx[k], r.wy[k], r.wx[j], r.wy[j]);
          }
        }
        const j = s.state === 'patrol' && s.phase === 'return' ? s.returnLeg : r.next(s.leg);
        ctx.strokeStyle = AI_COLORS.waypoint;
        ring(ctx, camera, r.wx[j], r.wy[j], 3);
        line(ctx, camera, s.x, s.y, r.wx[j], r.wy[j]);
      }
    },
  });
  debug.addLayer({
    id: 'ai-paths', label: 'Paths, last known, spots', group: 'ai', default: true,
    drawWorld(ctx, sim, camera) {
      ctx.lineWidth = 1;
      for (const s of visibleScouts(sim, camera, 600)) {
        if (s.path && s.pathI < s.path.length) {
          ctx.strokeStyle = AI_COLORS.path;
          let px = s.x;
          let py = s.y;
          for (let i = s.pathI; i < s.path.length; i++) {
            line(ctx, camera, px, py, s.path[i][0], s.path[i][1]);
            [px, py] = s.path[i];
          }
        }
        if (s.state === 'investigate') { ctx.strokeStyle = AI_COLORS.state.investigate; ring(ctx, camera, s.poiX, s.poiY, 4); }
        if (s.state === 'chase' || s.state === 'search') {
          ctx.strokeStyle = AI_COLORS.lk;
          line(ctx, camera, s.lkX - 4, s.lkY - 4, s.lkX + 4, s.lkY + 4);
          line(ctx, camera, s.lkX - 4, s.lkY + 4, s.lkX + 4, s.lkY - 4);
        }
        if (s.state === 'search') {
          ctx.strokeStyle = AI_COLORS.spot;
          s.spots.forEach(([x, y], i) => ring(ctx, camera, x, y, i === s.spotI ? 5 : 3));
        }
      }
    },
  });
  debug.addLayer({
    id: 'ai-hearing', label: 'Noises reaching scouts', group: 'ai', default: false,
    drawWorld(ctx, sim, camera) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = AI_COLORS.heard;
      for (const n of sim.noise?.recent ?? []) {
        for (const s of visibleScouts(sim, camera, 300)) {
          const dx = n.x - s.x;
          const dy = n.y - s.y;
          if (dx * dx + dy * dy <= n.radius * n.radius) line(ctx, camera, n.x, n.y, s.x, s.y);
        }
      }
    },
  });
  debug.addLayer({
    id: 'ai-readout', label: 'AI readout', group: 'readouts', default: true,
    drawUi(ctx, sim, vp, env) {
      env.textBlock(ctx, aiLines(sim).map((text) => ({ text, color: COLORS.text })));
    },
  });

  debug.addLayer({
    id: 'ai-truce', label: 'Totems, truces, stand-down posts', group: 'ai', default: false,
    drawWorld(ctx, sim, camera) {
      const off = sim.scouts?.offerings;
      if (!off) return;
      ctx.lineWidth = 1;
      for (const t of off.totems.values()) {
        ctx.strokeStyle = off.inTruce(t.sector) ? AI_COLORS.truce : AI_COLORS.waypoint;
        ring(ctx, camera, t.x, t.y, sim.tuning.ai.offering.standOffPx);
      }
      for (const s of visibleScouts(sim, camera, 900)) {
        if (!s.route.sector || s.kind === 'gatherer') continue;
        const p = off.postOf(sim, s);
        ctx.strokeStyle = off.inTruce(s.route.sector) ? AI_COLORS.truce : AI_COLORS.far;
        ring(ctx, camera, p.x, p.y, 4);
        if (off.inTruce(s.route.sector)) ring(ctx, camera, p.x, p.y, sim.tuning.ai.offering.postPresencePx);
        line(ctx, camera, p.x, p.y, p.x + p.dirX * 16, p.y + p.dirY * 16);
      }
    },
    drawUi(ctx, sim, vp, env) {
      const off = sim.scouts?.offerings;
      if (!off) return;
      const lines = [];
      for (const [k, t] of Object.entries(off.truces)) lines.push({ text: `truce ${k} ${t.active ? `${Math.ceil((t.until - sim.tick) / 60)} s left` : `ended ${t.endReason ?? 'tide'}`} chain ${t.chain}`, color: t.active ? AI_COLORS.truce : COLORS.text });
      for (const o of off.lying) lines.push({ text: `offering ${o.item} at ${o.totem} ${o.status}${o.scout ? ` by ${o.scout}` : ''}`, color: COLORS.text });
      if (lines.length) env.textBlock(ctx, lines);
    },
  });

  debug.addLayer({
    id: 'ai-monolith', label: 'Monolith: pulse reach, windows, tolerance', group: 'ai', default: false,
    drawWorld(ctx, sim, camera) {
      const m = sim.tuning.ai.monolith;
      if (!m) return;
      ctx.lineWidth = 1;
      ctx.strokeStyle = AI_COLORS.far;
      for (const z of sim.resonance?.pulses ?? []) ring(ctx, camera, z.x, z.y, m.pulseRadiusPx);
      for (const s of visibleScouts(sim, camera, 300)) {
        if (s.windowUntil >= sim.tick) { ctx.strokeStyle = AI_COLORS.window; ring(ctx, camera, s.x, s.y, 10); }
        if (s.respectUntil > sim.tick) { ctx.strokeStyle = AI_COLORS.truce; ring(ctx, camera, s.x, s.y, 14); ring(ctx, camera, s.x, s.y, sim.tuning.ai.chase.tooCloseRadius); }
      }
    },
    drawUi(ctx, sim, vp, env) {
      const lines = [];
      for (const z of sim.resonance?.pulses ?? []) {
        const d = Math.hypot(z.x - sim.player.x, z.y - sim.player.y);
        if (d < 2000) lines.push({ text: `pulse ${z.id} ${Math.round(d)}px next ${((z.interval - z.phase) / (1 + 2 * (sim.resonance.value / 100))).toFixed(1)}s`, color: COLORS.text });
      }
      for (const s of sim.scouts?.list ?? []) {
        if (s.windowUntil >= sim.tick) lines.push({ text: `window ${s.id} ${((s.windowUntil - sim.tick) / 60).toFixed(1)}s`, color: AI_COLORS.window });
        if (s.respectUntil > sim.tick) lines.push({ text: `respect ${s.id} ${((s.respectUntil - sim.tick) / 60).toFixed(1)}s (max ${((s.respectMax - sim.tick) / 60).toFixed(0)}s)`, color: AI_COLORS.truce });
      }
      if (lines.length) env.textBlock(ctx, lines);
    },
  });

  debug.addLayer({
    id: 'ai-gatherer', label: 'Gatherer: startle radius, notice reach, progress', group: 'ai', default: false,
    drawWorld(ctx, sim, camera) {
      const g = cheats.gatherer(sim);
      const c = sim.tuning.ai.gatherer;
      if (!g || g.phase === 'gone') return;
      ctx.lineWidth = 1;
      ctx.strokeStyle = AI_COLORS.window;
      ring(ctx, camera, g.x, g.y, c.startleRadiusPx);
      ctx.strokeStyle = g.seen ? AI_COLORS.truce : AI_COLORS.far;
      ring(ctx, camera, g.x, g.y, c.noticeMaxPx);
      line(ctx, camera, g.x, g.y, g.x + g.dirX * 24, g.y + g.dirY * 24);
    },
    drawUi(ctx, sim, vp, env) {
      const g = cheats.gatherer(sim);
      if (!g) return;
      const d = Math.round(Math.sqrt((g.x - sim.player.x) ** 2 + (g.y - sim.player.y) ** 2));
      env.textBlock(ctx, [{ text: `gatherer ${g.phase} ${g.anim} ${d}px seen ${g.seen ? 'y' : 'n'} regard ${Math.round(g.awareness * 100)}% gift day ${g.giftDay}`, color: AI_COLORS.truce }]);
    },
  });

  const act = (id, label, run) => debug.addAction({ id, label, group: 'ai', run });
  act('gatherer-meet', 'Gatherer: meet him (crouched, 130 px)', (sim) => cheats.meetGatherer(sim));
  act('offer-give', 'Offering: a fish in hand', (sim) => cheats.giveOffering(sim, 'fish'));
  let totemI = -1;
  act('offer-totem', 'Offering: teleport to the next totem', (sim) => cheats.teleportToTotem(sim, ++totemI));
  act('truce-start', 'Truce: start (sector of the nearest totem)', (sim) => cheats.startTruce(sim));
  act('truce-end', 'Truce: end all', (sim) => cheats.endTruce(sim));
  act('monolith-pulse', 'Monolith: pulse the nearest zone now', (sim) => cheats.forcePulse(sim));
  act('scout-spawn', 'Spawn a scout at the cursor', (sim, d) => {
    const m = d?.host?.input?.mouse ?? d?.lastPress;
    const w = m ? d.host.camera.screenToWorld(m.x, m.y) : { x: sim.player.x + 120, y: sim.player.y };
    return cheats.spawnScout(sim, w.x, w.y).id;
  });
  act('ai-freeze', 'Freeze / unfreeze AI', (sim) => cheats.setAiFrozen(sim));
  act('ai-invisible', 'Invisible player on/off', (sim) => cheats.setInvisiblePlayer(sim));
  act('ai-deaf', 'Deaf scouts on/off', (sim) => cheats.setDeafScouts(sim));
  for (const st of ['patrol', 'investigate', 'search', 'warn', 'chase']) act(`scout-${st}`, `Nearest scout: ${st.toUpperCase()}`, (sim) => cheats.forceScoutState(sim, st));
  act('scout-to-player', 'Nearest scout to the player', (sim) => cheats.teleportNearestScout(sim));
}
