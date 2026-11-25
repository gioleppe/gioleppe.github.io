// Debug tools for the art wiring (`?debug` only): every emote bubble popping in over the player's head in turn
// (Emotes.js, until scouts draw their own), a lit campfire beside the player (the map has only cold ones), and one
// action that puts the HUD in its alarm states with a full hotbar. Sim writes go through cheats.js.
import * as cheats from './cheats.js';
import { drawEmote, EMOTES } from '../Emotes.js';

/** ms each emote shows in the demo */
const EMOTE_DEMO_MS = 900;
/** the player sprite's head top above its feet, px (32 x 48 frame, head from row 5) */
const HEAD_TOP = 43;

/**
 * Register the art actions.
 * @param {import('./DebugMode.js').DebugMode} debug
 */
export function registerArtDebug(debug) {
  const renderer = debug.host.renderer;
  let demo = null;
  const names = Object.keys(EMOTES);
  const drawDemo = (ctx, sim, camera) => {
    if (!demo) return;
    const now = performance.now();
    const i = Math.floor((now - demo.start) / EMOTE_DEMO_MS);
    if (i >= names.length * 2) { demo = null; return; }   // twice round: calm/alert plates as recommended, then swapped
    const name = names[i % names.length];
    const alert = i < names.length ? EMOTES[name] : !EMOTES[name];
    const p = sim.player;
    drawEmote(ctx, name, Math.round(p.x) - camera.originX, Math.round(p.y) - camera.originY - HEAD_TOP - 1, {
      alert, popStartMs: demo.start + i * EMOTE_DEMO_MS, timeMs: now,
    });
  };
  renderer?.afterLighting.push(drawDemo);
  debug.addAction({
    id: 'emotes-demo', label: 'Art: every emote over the player', group: 'art',
    run: () => { demo = demo ? null : { start: performance.now() }; },
  });
  debug.addAction({
    id: 'campfire-here', label: 'Art: lit campfire beside the player (on/off)', group: 'art',
    run: (sim) => {
      if (!renderer) return;
      if (renderer.extraViews.length) { renderer.extraViews.length = 0; return; }
      renderer.extraViews.push({ id: 'debug_campfire', kind: 'campfire', x: Math.round(sim.player.x) + 36, y: Math.round(sim.player.y) + 6, state: 'idle', facing: null, variant: 0, phase: 0.3 });
    },
  });
  debug.addAction({
    id: 'hud-alarm', label: 'Art: HUD alarm states + full hotbar', group: 'art',
    run: (sim) => {
      cheats.setHydration(sim, sim.tuning.hydration.staminaCapBelow * 0.5);
      cheats.setStamina(sim, sim.tuning.stamina.max * 0.15);
      cheats.arrowHit(sim);
      cheats.clearInventory(sim);
      for (const [id, n] of [['flashlight', 1], ['rock', 3], ['coconut', 2], ['paracord', 1], ['healing_herbs', 3], ['crowbar', 1]]) cheats.giveItem(sim, id, n);
    },
  });
}
