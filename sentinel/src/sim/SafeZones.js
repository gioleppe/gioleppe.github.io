// Safe zones: circles on the island where the islanders never go (Marek's clearing, spec §5.1 "safe zone").
// Scouts (step 4.1) will neither enter nor pursue into one; the autosave (step 5.2) triggers on entering one.
// Zones come from tuning.safeZones.zones: { id, landmark, radius } (centred on a map landmark) or { id, x, y, radius }.
// State: which zone the player is in, so `safe_zone { id, entered }` is emitted once per crossing.

export class SafeZones {
  /**
   * @param {Object} cfg tuning.safeZones
   * @param {import('../world/IslandMap.js').IslandMap|null} map landmarks resolve through it; without a map only
   *   zones with explicit x, y exist
   */
  constructor(cfg, map) {
    /** @type {Array<{ id: string, x: number, y: number, r: number }>} */
    this.zones = [];
    for (const z of cfg?.zones ?? []) {
      const at = z.landmark ? map?.landmark(z.landmark) : z;
      if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y) || !(z.radius > 0)) continue;
      this.zones.push({ id: z.id ?? z.landmark, x: at.x, y: at.y, r: z.radius });
    }
    /** id of the zone the player stood in after the last update, or null */
    this.playerZone = null;
  }

  /**
   * @param {number} x world pixels
   * @param {number} y
   * @returns {{ id: string, x: number, y: number, r: number }|null} the first zone containing the point (edge included)
   */
  zoneAt(x, y) {
    for (const z of this.zones) {
      const dx = x - z.x;
      const dy = y - z.y;
      if (dx * dx + dy * dy <= z.r * z.r) return z;
    }
    return null;
  }

  /** true if (x, y) is inside any safe zone */
  inSafeZone(x, y) {
    return this.zoneAt(x, y) !== null;
  }

  /**
   * Track the player and emit `safe_zone { id, entered: true|false }` when they cross an edge.
   * @param {{x:number,y:number}} player
   * @param {Array<Object>} events
   */
  update(player, events) {
    const id = this.zoneAt(player.x, player.y)?.id ?? null;
    if (id === this.playerZone) return;
    if (this.playerZone) events.push({ type: 'safe_zone', id: this.playerZone, entered: false });
    if (id) events.push({ type: 'safe_zone', id, entered: true });
    this.playerZone = id;
  }

  snapshot() {
    return { playerZone: this.playerZone };
  }

  /** zones are rebuilt from tuning and map; only the player's zone is state */
  static restore(s, cfg, map) {
    const z = new SafeZones(cfg, map);
    z.playerZone = s?.playerZone ?? null;
    return z;
  }
}
