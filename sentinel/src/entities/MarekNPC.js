// Marek (spec §7.1): the only speaking character. He stays at the map's `npc { npc: 'marek' }` spawn by his
// shack: sitting most of the day, standing (`idle`) at the hours in tuning.marek.standHours, `gesturing` while he
// is the one speaking. He turns to face the player during a conversation. The player cannot walk through him.
// His conversation itself lives in src/sim/Dialogue.js; how a talk starts is in marekHooks.js.

/** sprite facings the marek sheet has (W is E mirrored) */
const FACINGS_TOWARD = (dx, dy) => (dy > 0 && dy >= Math.abs(dx) ? 'S' : dx < 0 ? 'W' : 'E');

export class MarekNPC {
  /**
   * @param {{ id?: string, x: number, y: number }} spawn
   * @param {Object} cfg tuning.marek
   */
  constructor(spawn, cfg) {
    this.id = spawn.id ?? 'marek';
    this.x = spawn.x;
    this.y = spawn.y;
    this.radius = cfg.radius;
    /** 'sitting' | 'idle' | 'gesturing' */
    this.state = 'sitting';
    /** 'S' | 'E' | 'W' */
    this.facing = 'S';
  }

  /** the map's Marek, or null when the map has none (the test field) */
  static fromMap(map, cfg) {
    const e = map?.entitiesOfType('npc').find((n) => n.npc === 'marek');
    return e ? new MarekNPC(e, cfg) : null;
  }

  /**
   * Pick pose and facing for this tick.
   * @param {Object} cfg tuning.marek
   * @param {{ hour: number, talking: boolean, speaking: boolean, player: {x:number,y:number} }} env
   */
  update(cfg, { hour, talking, speaking, player }) {
    if (talking) {
      this.state = speaking ? 'gesturing' : 'idle';
      this.facing = FACINGS_TOWARD(player.x - this.x, player.y - this.y);
      return;
    }
    this.state = (cfg.standHours ?? []).some(([a, b]) => hour >= a && hour < b) ? 'idle' : 'sitting';
    this.facing = 'S';
  }

  /** squared distance from a point to Marek */
  dist2(x, y) {
    const dx = x - this.x;
    const dy = y - this.y;
    return dx * dx + dy * dy;
  }

  /**
   * Keep the player out of his body: push them to the edge of the two radii, unless that point is blocked.
   * @param {{x:number,y:number,radius:number}} p
   * @param {{ isPositionFree(x:number,y:number,r:number): boolean }|null} collider
   */
  blockPlayer(p, collider) {
    const min = this.radius + p.radius;
    const d2 = this.dist2(p.x, p.y);
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2);
    const ux = d > 1e-6 ? (p.x - this.x) / d : 0;
    const uy = d > 1e-6 ? (p.y - this.y) / d : 1;
    const nx = this.x + ux * min;
    const ny = this.y + uy * min;
    if (collider && !collider.isPositionFree(nx, ny, p.radius)) return;
    p.x = nx;
    p.y = ny;
  }

  /** what the renderer draws */
  view() {
    return { id: this.id, kind: 'marek', x: this.x, y: this.y, state: this.state, facing: this.facing };
  }

  snapshot() {
    const { id, x, y, state, facing } = this;
    return { id, x, y, state, facing };
  }

  /** @param {Object} s from snapshot() */
  static restore(s, cfg) {
    const m = new MarekNPC(s, cfg);
    m.state = s.state ?? 'sitting';
    m.facing = s.facing ?? 'S';
    return m;
  }
}
