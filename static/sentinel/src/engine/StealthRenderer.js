// What stealth looks like on the ground (step 3.2, spec §6.1): footprints on wet sand that fade over their
// lifetime, and the faint expanding ring of a loud noise. Called by the Renderer: footprints after the ground
// and before the entities, rings after the entities. Reads the simulation only.
import { TICK_HZ } from '../sim/constants.js';

/** palette colours (assets/src/palette.gpl) */
export const STEALTH_COLORS = Object.freeze({
  print: '#0d0b12',   // ink: a dent in wet sand reads darker than the (already dark) wet sand around it
  ring: '#e9e2cf',    // bone
});

/** how strong a fresh print is drawn; it fades linearly to nothing at the end of its lifetime */
export const PRINT_ALPHA = 0.7;
/** the ring is barely there: noise is told, not shouted */
export const RING_ALPHA = 0.35;
/** seconds for one ring of a continuous loud source (the player's sprint) to grow to its full radius */
export const RING_PERIOD = 0.9;

/**
 * Opacity of a print of a given age, 0 when it has faded.
 * @param {number} age seconds
 * @param {number} lifetime seconds
 */
export function printAlpha(age, lifetime) {
  if (!(lifetime > 0) || age >= lifetime) return 0;
  return PRINT_ALPHA * (1 - Math.max(0, age) / lifetime);
}

/**
 * Size and opacity of a noise ring: one-off noises grow once over the field's memory; a continuous source
 * (footsteps) pulses every RING_PERIOD seconds of presentation time.
 * @returns {{ r: number, alpha: number }}
 */
export function ringFor(noise, age, memory, time) {
  const t = noise.kind === 'footsteps' ? (time % RING_PERIOD) / RING_PERIOD : Math.min(1, age / memory);
  return { r: noise.radius * (0.15 + 0.85 * t), alpha: RING_ALPHA * (1 - t) };
}

/** footprints in view: two small dark marks per print, side by side across the heading, on whole pixels */
export function drawFootprints(ctx, sim, camera) {
  const trail = sim.footprints;
  if (!trail || !trail.list.length) return;
  const view = camera.visibleRect();
  const life = trail.lifetime;
  ctx.save();
  ctx.fillStyle = STEALTH_COLORS.print;
  for (const f of trail.list) {
    if (f.x < view.x - 4 || f.y < view.y - 4 || f.x > view.x + view.w + 4 || f.y > view.y + view.h + 4) continue;
    const a = printAlpha(trail.ageOf(f), life);
    if (a <= 0) continue;
    ctx.globalAlpha = a;
    const side = f.n % 2 ? 2 : -2;   // left and right foot either side of the line walked
    const x = Math.round(f.x - f.dirY * side) - camera.originX;
    const y = Math.round(f.y + f.dirX * side) - camera.originY;
    const along = Math.abs(f.dirX) >= Math.abs(f.dirY);   // a foot is longer than it is wide, along the heading
    ctx.fillRect(x - 1, y - 1, along ? 3 : 2, along ? 2 : 3);
  }
  ctx.restore();
}

/** faint rings for the loud noises in view */
export function drawNoiseRings(ctx, sim, camera, time) {
  const field = sim.noise;
  if (!field || !field.list.length) return;
  const memory = field.memoryTicks / TICK_HZ;
  const view = camera.visibleRect();
  ctx.save();
  ctx.strokeStyle = STEALTH_COLORS.ring;
  ctx.lineWidth = 1;
  for (const n of field.list) {
    if (n.radius < field.loudAt) continue;
    if (n.x + n.radius < view.x || n.x - n.radius > view.x + view.w || n.y + n.radius < view.y || n.y - n.radius > view.y + view.h) continue;
    const age = (field.tick - n.tick) / TICK_HZ;
    if (n.kind === 'footsteps' && age > 2 / TICK_HZ) continue;   // the source stopped being loud: no more rings
    const { r, alpha } = ringFor(n, age, memory, time);
    if (alpha <= 0.01) continue;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(Math.round(n.x) - camera.originX + 0.5, Math.round(n.y) - camera.originY + 0.5, Math.round(r), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
