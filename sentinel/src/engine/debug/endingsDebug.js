// Debug tools for the two endings (steps 5.3, 5.4; `?debug` only): jumps to "the dinghy repaired at high tide",
// "afloat in the cove", "at the signal point with the battery and a flare", start the holdout, skip to second 55,
// and the two ending screens; layers for the launch water line, the passage line, the plateau, the converge order
// and waves, and the spotlight. Like cheats.js, a sanctioned writer of simulation state under ?debug only; its
// writes are the functions of `endingCheats`, which tests, the cross-check and the smoke runs call too.
import { COLORS } from './layers.js';
import * as cheats from './cheats.js';
import { storyCheats } from './journalDebug.js';
import { TICK_HZ } from '../../sim/constants.js';
import { signalPointOf, onPlateau } from '../../sim/endings/signal.js';

/** put the player at (x, y) standing still */
function put(sim, x, y) {
  const p = sim.player;
  p.x = p.prevX = x;
  p.y = p.prevY = y;
  if (sim.moveEnv) p.syncTerrain(sim.moveEnv);
}

/** a tide phase in the launch window */
const HIGH_WATER = 0.36;   // rising, height about 0.8: inside the launch window, the dinghy's own tile not yet afloat

export const endingCheats = {
  /** the dinghy patched, the tide at high water, the player beside the dinghy on its sea side */
  dinghyReady(sim) {
    storyCheats.repairDinghy(sim);
    sim.world.setTidePhase(HIGH_WATER);
    const d = sim.endings.dinghy.pos(sim);
    put(sim, d.x + 8, d.y - 24);   // on the beach side, clear of the dinghy prop (solid, radius 14), within reach (30)
    return true;
  },
  /** in the boat on the cove's deep water off the launch, facing the reef */
  afloat(sim) {
    endingCheats.dinghyReady(sim);
    const l = sim.map.landmark('dinghy_launch');
    const x = l.x;
    const y = l.y + 3 * 24;
    put(sim, x, y);
    sim.player.dirX = 0;
    sim.player.dirY = 1;
    sim.endings.dinghy.x = x;
    sim.endings.dinghy.y = y;
    sim.endings.dinghy.board(sim);
    sim.endings.dinghy.settleUntil = sim.tick;
    return true;
  },
  /** at the signal point with the battery (switched off) and the loaded gun in hand */
  signalReady(sim) {
    storyCheats.giveKit(sim, 'signal');
    const inv = sim.inventory;
    const b = inv.slots.findIndex((s) => s && s.id === 'radio_battery');
    if (b >= 0 && inv.slots[b].on) inv.setPower(b, false);
    const g = inv.slots.findIndex((s) => s && s.id === 'flare_gun');
    if (g >= 0) inv.selected = g;
    const sp = signalPointOf(sim);
    put(sim, sp.x, sp.y + 22);
    return true;
  },
  /** fire at once (no confirm, no autosave: debug) and start the minute */
  startHoldout(sim) {
    if (!sim.endings.signal.vigil) {
      endingCheats.signalReady(sim);
      sim.endings.signal.fire(sim);
    }
    return true;
  },
  /** move the running window's clock so it stands at `second` */
  skipTo(sim, second = 55) {
    const w = sim.endings.signal.vigil;
    if (!w) return false;
    const shift = Math.round(second * TICK_HZ) - (sim.tick - w.start);
    w.start -= shift;
    w.end -= shift;
    sim.resonance.force(sim.tuning.endings.signal.resonanceValue, Math.max(1 / TICK_HZ, (w.end - sim.tick) / TICK_HZ));
    return true;
  },
  /** reach an ending now (the screen) */
  finish(sim, kind) {
    sim.endings.finish(sim, kind);
    return true;
  },
  giveItem: cheats.giveItem,
};

function readout(sim) {
  const d = sim.endings.dinghy;
  const s = sim.endings.signal;
  const w = s.vigil;
  const lines = [
    `dinghy ${d.phase}${d.moved ? ` at ${Math.round(d.x)},${Math.round(d.y)}` : ''}  tide ${sim.tideHeight().toFixed(2)} / launch ${sim.tuning.endings.dinghy.launchTide}`,
    `signal armed ${s.armedUntil >= sim.tick ? 'YES' : 'no'}  beacon ${s.beacon ? 'ON' : 'off'}  fired ${s.fired}  windows ${s.vigils}${s.nextWindow >= 0 ? `  next boat in ${Math.round((s.nextWindow - sim.tick) / TICK_HZ)} s` : ''}`,
  ];
  if (w) lines.push(`window ${w.n} ${w.phase} t=${((sim.tick - w.start) / TICK_HZ).toFixed(1)} s  called ${w.called.length} released ${w.released}  on plateau ${onPlateau(sim) ? 'yes' : 'NO'}`);
  if (sim.ending) lines.push(`ENDING ${sim.ending.kind}`);
  return lines;
}

/**
 * Register the endings layers and actions.
 * @param {import('./DebugMode.js').DebugMode} debug
 * @param {{ showEnding?: (kind: string) => void }} [hooks]
 */
export function registerEndingsDebug(debug, hooks = {}) {
  debug.addLayer({
    id: 'endings', label: 'Endings', group: 'readouts', default: false,
    drawUi(ctx, sim, vp, env) {
      if (!sim.endings) return;
      env.textBlock(ctx, readout(sim).map((text) => ({ text, color: COLORS.text })));
    },
    drawWorld(ctx, sim, camera) {
      if (!sim.endings || !sim.map) return;
      const P = (x, y) => camera.worldToScreen(x, y);
      const seg = (x0, y0, x1, y1) => { const a = P(x0, y0); const b = P(x1, y1); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
      const circle = (x, y, r) => { const a = P(x, y); ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.stroke(); };
      ctx.save();
      ctx.lineWidth = 1;
      // the passage line: the ending fires south of it
      const pass = sim.map.landmark('outer_reef_passage');
      if (pass) {
        const y = pass.y + sim.tuning.endings.dinghy.passageLinePx;
        ctx.strokeStyle = '#ffd060';
        seg(pass.x - 200, y, pass.x + 200, y);
      }
      const l = sim.map.landmark('dinghy_launch');
      if (l) {
        ctx.strokeStyle = sim.endings.dinghy.tideOk(sim) ? '#60ff90' : '#ff6060';
        circle(l.x, l.y, 24);
      }
      const sp = signalPointOf(sim);
      if (sp) {
        ctx.strokeStyle = '#80c0ff';
        const r = sim.tuning.endings.signal.plateauRadius;
        circle(sp.x, sp.y, r);
        const w = sim.endings.signal.vigil;
        if (w) {
          ctx.strokeStyle = '#ff8040';
          w.called.forEach((id, i) => {
            const s = sim.scouts.byId(id);
            if (!s) return;
            ctx.globalAlpha = i < w.released ? 1 : 0.35;
            seg(s.x, s.y, sp.x, sp.y);
          });
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
    },
  });
  const act = (id, label, run) => debug.addAction({ id, label, group: 'endings', run });
  act('ending-dinghy-ready', 'Endings: dinghy repaired at high tide', (sim) => endingCheats.dinghyReady(sim));
  act('ending-afloat', 'Endings: afloat in the cove', (sim) => endingCheats.afloat(sim));
  act('ending-signal-ready', 'Endings: at the signal point with battery and flare', (sim) => endingCheats.signalReady(sim));
  act('ending-holdout', 'Endings: start the holdout', (sim) => endingCheats.startHoldout(sim));
  act('ending-skip55', 'Endings: skip to second 55', (sim) => endingCheats.skipTo(sim, 55));
  act('ending-screen-dinghy', 'Endings: the dinghy ending screen', (sim) => { endingCheats.finish(sim, 'dinghy'); hooks.showEnding?.('dinghy'); });
  act('ending-screen-rescue', 'Endings: the rescue ending screen', (sim) => { endingCheats.finish(sim, 'rescue'); hooks.showEnding?.('rescue'); });
}
