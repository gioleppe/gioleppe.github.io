// The island behind the title screen: a throwaway Sim of the real island, never stepped, its clock set to dawn,
// drawn by the game's own renderer while a camera drifts slowly along the cove. Cheap: one Sim built once, no
// ticks, the same drawing as a game frame. The castaway is moved out of the shot (this Sim is never played).
import { Camera } from '../../engine/Camera.js';
import { WorldState } from '../../world/WorldState.js';

export class TitleBackdrop {
  /**
   * @param {{ makeSim: () => Object, tuning: Object }} opts makeSim: a fresh Sim on the loaded island
   */
  constructor({ makeSim, tuning }) {
    this.makeSim = makeSim;
    this.tuning = tuning;
    this.cfg = tuning.screens.title;
    this.sim = null;
    this.camera = new Camera(tuning.camera);
    this.t = 0;
    this.anchor = null;
  }

  ensure() {
    if (this.sim) return this.sim;
    const sim = this.makeSim();
    const day = this.tuning.world.day;
    const ticksPerHour = (day.lengthSeconds * 60) / 24;
    // the clock at dawn (the tide follows from the same tick)
    sim.world = WorldState.atTick(Math.max(0, Math.round((this.cfg.hour - day.startHour) * ticksPerHour)), this.tuning);
    const at = sim.map?.landmark(this.cfg.anchor) ?? sim.player;
    this.anchor = { x: at.x, y: at.y + this.cfg.offsetY };
    const away = sim.map?.landmark(this.cfg.hidePlayerAt);
    if (away) { sim.player.x = sim.player.prevX = away.x; sim.player.y = sim.player.prevY = away.y; }
    this.camera.setBounds(sim.bounds);
    this.sim = sim;
    return sim;
  }

  /**
   * Draw a frame.
   * @param {CanvasRenderingContext2D} ctx #world
   * @param {import('../../engine/Renderer.js').Renderer} renderer
   * @param {{ logicalWidth: number, logicalHeight: number }} vp
   * @param {number} dt seconds
   */
  draw(ctx, renderer, vp, dt) {
    const sim = this.ensure();
    this.t += Math.min(dt, 0.1);
    const c = this.cfg;
    const k = (2 * Math.PI * this.t) / c.driftPeriodSeconds;
    this.camera.setViewport(vp.logicalWidth, vp.logicalHeight);
    this.camera.snapTo(this.anchor.x + Math.sin(k) * c.driftAmplitude, this.anchor.y + Math.sin(k * 0.5) * 12);
    renderer.render(ctx, sim, this.camera, { alpha: 1, time: this.t });
  }
}
