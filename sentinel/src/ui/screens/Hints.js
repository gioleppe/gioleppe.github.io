// At most three one-line hints, each the first time it is relevant and once per profile (step 5.1): how to move,
// crouching in tall grass, the journal. No tutorial pop-ups: a quiet line under the tide widget that fades. Which
// hints were shown is kept in the preferences; Settings → Hints turns them off.
import { SCREEN_COLORS as C, font, ellipsize, measurer } from './theme.js';
import { tideWidgetRect } from '../hud/TideWidget.js';

export const HINTS = Object.freeze({
  move: { keys: 'WASD or the arrow keys to move. Shift to run.', touch: 'Drag with your left thumb to move.' },
  crouch: { keys: 'C to crouch. Crouched in tall grass, you are hard to see.', touch: 'Crouch in tall grass and you are hard to see.' },
  journal: { keys: 'Something new in the journal: Tab or J.', touch: 'Something new in the journal: the book, top right.' },
});

/** a prop with cover (tall grass, mangrove roots) within `r` px of the player, from the map's prop index */
export function nearCover(sim, r) {
  const map = sim.map;
  const p = sim.player;
  if (!map?.propsNear) return false;
  const kinds = sim.tuning.props ?? {};
  for (const q of map.propsNear(p.x, p.y, r + (map.maxPropReach ?? 0))) {
    const cr = q.coverRadius ?? kinds[q.kind]?.coverRadius ?? 0;
    if (!(cr > 0) || q.cover === false) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    if (dx * dx + dy * dy <= (r + cr) * (r + cr)) return true;
  }
  return false;
}

export class Hints {
  /**
   * @param {{ prefs: import('./gameSettings.js').GameSettings, cfg: Object }} opts cfg: tuning.hints
   */
  constructor({ prefs, cfg }) {
    this.prefs = prefs;
    this.cfg = cfg;
    /** @type {{ id: string, age: number }|null} */
    this.active = null;
    this.played = 0;
    this.start = null;
    this.coverCheck = 0;
  }

  /** a new or loaded run */
  reset(sim) {
    this.active = null;
    this.played = 0;
    this.start = sim ? { x: sim.player.x, y: sim.player.y } : null;
    this.coverCheck = 0;
  }

  /** show a hint if it may be shown (hints on, not seen on this profile, nothing else showing) */
  show(id) {
    if (this.active || !this.prefs.hintsOn || this.prefs.hintSeen(id) || !HINTS[id]) return false;
    this.prefs.markHint(id);
    this.active = { id, age: 0 };
    return true;
  }

  /** after every tick: events that make a hint relevant */
  onStep(sim) {
    for (const e of sim.events) {
      if (e.type === 'journal_entry' && e.source !== 'start' && e.category !== 'objective') this.show('journal');
    }
  }

  /**
   * Once per frame while the game runs.
   * @param {Object} sim
   * @param {number} dt seconds
   * @param {{ journalOpen?: boolean }} [o]
   */
  frame(sim, dt, { journalOpen = false } = {}) {
    if (!sim || sim.over) return;
    const cfg = this.cfg;
    if (journalOpen) {
      // opening the journal answers its hint; nothing new is shown over the journal
      if (this.active?.id === 'journal') this.active = null;
      return;
    }
    const p = sim.player;
    this.played += dt;
    const moved = this.start ? Math.sqrt((p.x - this.start.x) ** 2 + (p.y - this.start.y) ** 2) : 0;
    if (this.played >= cfg.moveDelaySeconds && moved < cfg.moveDoneDistance) this.show('move');
    this.coverCheck -= dt;
    if (this.coverCheck <= 0) {
      this.coverCheck = cfg.crouchCheckSeconds;
      if (p.stance !== 'crouch' && p.mode !== 'swim' && nearCover(sim, cfg.crouchRadius)) this.show('crouch');
    }
    const a = this.active;
    if (!a) return;
    a.age += dt;
    const satisfied = (a.id === 'move' && moved >= cfg.moveDoneDistance) || (a.id === 'crouch' && p.stance === 'crouch') || (a.id === 'journal' && journalOpen);
    if (satisfied && a.age < cfg.seconds - cfg.fadeSeconds) a.age = cfg.seconds - cfg.fadeSeconds;
    if (a.age >= cfg.seconds) this.active = null;
  }

  /** the hint line, under the tide widget */
  draw(ctx, vp, safe, { touch = false } = {}) {
    const a = this.active;
    if (!a || !this.prefs.hintsOn) return;
    const cfg = this.cfg;
    const alpha = Math.min(1, a.age / 0.4, (cfg.seconds - a.age) / cfg.fadeSeconds);
    if (!(alpha > 0)) return;
    const tide = tideWidgetRect(vp, safe);
    const text = HINTS[a.id][touch ? 'touch' : 'keys'];
    ctx.save();
    ctx.font = font(cfg.fontPx);
    const m = measurer(ctx);
    const maxW = vp.uiLogicalWidth - (safe.left || 0) - (safe.right || 0) - 16;
    const t = ellipsize(text, maxW - 12, m);
    const w = Math.ceil(m(t)) + 12;
    const x = Math.round(vp.uiLogicalWidth / 2 - w / 2);
    const y = tide.y + tide.h + cfg.offsetY;
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = C.ink;
    ctx.fillRect(x, y, w, cfg.fontPx + 6);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = C.bone;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, Math.round(vp.uiLogicalWidth / 2), y + (cfg.fontPx + 6) / 2 + 0.5);
    ctx.restore();
  }
}
