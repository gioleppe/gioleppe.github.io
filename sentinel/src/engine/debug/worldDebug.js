// Debug tools for the world clocks (step 2.4; `?debug` only): a tide overlay (flood level and depth class per
// tile), a world readout, and actions for the tide, the hour and the weather. main.js calls
// registerWorldDebug(debug) once debug mode is up; every write goes through cheats.js.
import { tileRange } from '../Renderer.js';
import { waterAt } from '../../world/water.js';
import { TILE_W, TILE_H } from '../../sim/constants.js';
import { label, COLORS } from './layers.js';
import * as cheats from './cheats.js';

/** overlay colour per depth class */
export const CLASS_COLORS = Object.freeze({ dry: '#d8d2bf', wet: '#e9c46a', shallow: '#4cc9f0', deep: '#f72585' });
const CLASS_LETTER = Object.freeze({ dry: '.', wet: 'w', shallow: 's', deep: 'D' });

const pct = (v) => `${Math.round(v * 100)}%`;
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** the readout lines for a world */
export function worldLines(world) {
  const wx = world.weather;
  return [
    `tide ${world.tideHeight.toFixed(3)} ${world.tideState}${world.tideRising ? ' ^' : ' v'}  phase ${world.tidePhase.toFixed(3)}  cycle ${world.cycleCount}${world.fastTide ? '  FAST' : ''}`,
    `  low in ${mmss(world.timeToNext('low'))}  high in ${mmss(world.timeToNext('high'))}  period ${world.tidePeriodSeconds}s`,
    `day ${world.day} ${hhmm(world.timeOfDay)} ${world.dayPhase}  daylight ${world.daylight.toFixed(2)}  moon ${world.moonlight.toFixed(2)}`,
    `weather ${wx.kind} ${pct(wx.intensity)}  next change ${mmss(wx.timeLeft)}  wind ${world.windStrength.toFixed(2)}`,
    `  noise x${world.noiseMultiplier.toFixed(2)}  sight x${world.visibilityMultiplier.toFixed(2)}  move x${world.moveMultiplier.toFixed(2)}`,
  ];
}

/** one line on the lighting of the last frame */
export function lightingLine(last) {
  const a = last.ambient;
  const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `light #${hex(a.r)}${hex(a.g)}${hex(a.b)} dark ${a.darkness.toFixed(2)}  lights ${last.lights}  ${last.ms.toFixed(2)} ms`;
}

/**
 * Register the world layers and actions.
 * @param {import('./DebugMode.js').DebugMode} debug
 */
export function registerWorldDebug(debug) {
  debug.addLayer({
    id: 'tide', label: 'Tide: level + depth', group: 'world', default: false,
    drawUi(ctx, sim, vp, env) {
      if (!sim.map || !sim.world) return;
      const { c0, c1, r0, r1 } = tileRange(env.camera.visibleRect(), sim.bounds);
      for (let r = r0; r < r1; r++) {
        for (let c = c0; c < c1; c++) {
          const level = sim.map.floodLevel(c, r);
          const cls = waterAt(sim.map, sim.world, c, r);
          if (!level && (cls === 'dry' || cls === 'deep')) continue;   // keep the overlay to what the tide touches
          const s = env.camera.worldToScreen(c * TILE_W + 3, r * TILE_H + 3);
          label(ctx, `${level}${CLASS_LETTER[cls]}`, s.x, s.y, CLASS_COLORS[cls]);
        }
      }
    },
  });
  debug.addLayer({
    id: 'world', label: 'World clocks', group: 'readouts', default: true,
    drawUi(ctx, sim, vp, env) {
      if (!sim.world) return;
      const lines = worldLines(sim.world);
      const lit = env.renderer?.lighting?.last;
      if (lit) lines.push(lightingLine(lit));
      const fx = env.renderer?.weather?.last;
      lines.push(`wind ${sim.world.windStrength.toFixed(2)} gust ${sim.world.gust.toFixed(2)}${fx ? `  rain ${fx.drops} drops ${fx.splashes} splashes` : ''}`);
      env.textBlock(ctx, lines.map((text) => ({ text, color: COLORS.text })));
    },
  });
  debug.addLayer({
    id: 'lights', label: 'Light radii', group: 'world', default: false,
    drawWorld(ctx, sim, camera, env) {
      const lights = env.renderer?.lighting?.lights ?? [];
      ctx.lineWidth = 1;
      for (const l of lights) {
        ctx.strokeStyle = l.color ?? '#e9c46a';
        const x = Math.round(l.x - camera.originX) + 0.5;
        const y = Math.round(l.y - camera.originY) + 0.5;
        ctx.beginPath();
        if (l.kind === 'flashlight') {
          ctx.ellipse(x + Math.cos(l.angle) * l.offset, y + Math.sin(l.angle) * l.offset, l.length / 2, l.width / 2, l.angle, 0, Math.PI * 2);
          ctx.moveTo(x + l.radius, y);
        }
        ctx.arc(x, y, l.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    },
  });

  const act = (id, label, run) => debug.addAction({ id, label, group: 'world', run });
  act('tide-low', 'Tide: low', (sim) => cheats.setTidePhase(sim, 0));
  act('tide-mid', 'Tide: mid (rising)', (sim) => cheats.setTidePhase(sim, 0.25));
  act('tide-high', 'Tide: high', (sim) => cheats.setTidePhase(sim, 0.5));
  act('tide-plus', 'Tide: +10% of a cycle', (sim) => cheats.advanceTide(sim, 0.1));
  act('tide-fast', 'Tide: fast (30 s) on/off', (sim) => cheats.toggleFastTide(sim));
  act('time-dawn', 'Time: dawn', (sim) => cheats.setTimeOfDay(sim, 6));
  act('time-noon', 'Time: noon', (sim) => cheats.setTimeOfDay(sim, 12));
  act('time-dusk', 'Time: dusk', (sim) => cheats.setTimeOfDay(sim, 19));
  act('time-midnight', 'Time: midnight', (sim) => cheats.setTimeOfDay(sim, 0));
  act('moon-full', 'Moon: full (sets the day)', (sim) => cheats.setMoon(sim, 0.5));
  act('moon-new', 'Moon: new (sets the day)', (sim) => cheats.setMoon(sim, 0));
  act('flashlight', 'Player: flashlight on/off', (sim) => cheats.toggleFlashlight(sim));
  act('squall', 'Weather: start squall', (sim) => cheats.startSquall(sim));
  act('squall-full', 'Weather: full squall now', (sim) => cheats.startSquall(sim, { instant: true }));
  act('clear', 'Weather: clear', (sim) => cheats.clearWeather(sim));
  act('wind-max', 'Weather: max wind', (sim) => cheats.maxWind(sim));
}
