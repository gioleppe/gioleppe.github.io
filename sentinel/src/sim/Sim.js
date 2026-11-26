// The whole game state and the one way it advances: `step(input)`, exactly one tick of DT seconds.
// No browser, no clock, no files: the caller passes the loaded data in, randomness comes only from `rng`.
import { DT, TILE_W, TILE_H } from './constants.js';
import { Rng } from './rng.js';
import { sanitizeInput } from './input.js';
import { Player } from '../entities/Player.js';
import { buildTestField } from '../world/TestField.js';
import { IslandMap } from '../world/IslandMap.js';
import { WorldState } from '../world/WorldState.js';
import { Collider, terrainRules } from '../world/collision.js';
import { Resonance } from '../world/Resonance.js';
import { FogOfWar } from '../world/FogOfWar.js';

import { NoiseField } from '../world/Noise.js';
import { FootprintTrail } from '../world/Footprints.js';
import { ItemCatalog } from '../entities/ItemCatalog.js';
import { Inventory } from '../entities/Inventory.js';
import { Pickups } from '../entities/Pickups.js';
import { Interactables, updateInteraction, refreshTarget, endChannel } from '../entities/Interactable.js';
import { selectHotbar, toggleLight, useHeld, dropHeld, syncLight, giveStartingKit } from '../entities/ItemUse.js';
import { Projectiles, wantsThrow, throwHeld } from '../entities/Projectile.js';
import { Dialogue, Story, compileTree } from './Dialogue.js';
import { SafeZones } from './SafeZones.js';
import { MarekNPC } from '../entities/MarekNPC.js';
import { afterStep as marekAfterStep, dialogueHost } from '../entities/marekHooks.js';
import { loreBook, loreAfterStep, applyJournalCommands, unlockStartEntries } from './Lore.js';
import { recipeBook, craft, craftFromHand } from '../entities/Crafting.js';
import { useFlareGun, storyItemsAfterStep } from '../entities/storyInteractions.js';   // also registers the dinghy, hatch and signal point
import { Scouts } from '../entities/SentineleseAI.js';
import { Endings } from './endings/Endings.js';

/** bumped whenever the snapshot shape changes; restore refuses other versions (migration arrives with saving, step 5.2) */
export const SNAPSHOT_VERSION = 12;
/**
 * older versions restore can still read: 2 had no world (its clocks are rebuilt from the tick); 2 and 4 have no
 * player body (stamina and the rest start as in a new game) and no items (the fresh starting kit and the map's
 * loot); 5 is either half (body or items) of the two branches that both called themselves 5; 2 to 6 may lack
 * Resonance (it starts at rest) and the fog (it starts unexplored); 2 to 7 have no story (a fresh one); 8 has no
 * read marks and no lore unlocked (the journal holds only what the dialogue added; `start` entries unlock on the
 * first step); 2 to 9 have no scouts (they are put on their routes where a new game's patrols would be at the
 * snapshot's tick); 10 has no offerings or truces (nothing lies at the totems, every patrol on its route); 10 and 11
 * have no endings (nothing launched, nothing fired: fresh ones)
 */
const READABLE_VERSIONS = new Set([2, 4, 5, 6, 7, 8, 9, 10, 11, SNAPSHOT_VERSION]);

/**
 * Compiled dialogue trees from the loaded data files named `dialogue_<id>` (e.g. data.dialogue_marek).
 * Compiled once per data object and cached on it (data is never state).
 */
export function dialogueTrees(data) {
  const cache = dialogueTrees.cache;
  if (cache.has(data)) return cache.get(data);
  const trees = {};
  for (const [name, json] of Object.entries(data ?? {})) {
    if (name.startsWith('dialogue_') && json) {
      const t = compileTree(json);
      trees[t.id] = t;
    }
  }
  cache.set(data, trees);
  return trees;
}
dialogueTrees.cache = new WeakMap();

/**
 * World rectangle in world pixels for a map that is `width` x `height` tiles, or null for the open test field.
 * @param {{width:number,height:number}|null} map
 * @returns {{x:number,y:number,w:number,h:number}|null}
 */
export function worldBounds(map) {
  return map ? { x: 0, y: 0, w: map.width * TILE_W, h: map.height * TILE_H } : null;
}

export class Sim {
  /**
   * @param {Object} opts
   * @param {IslandMap|Object|null} [opts.map]  the island: an IslandMap, or the parsed data/island_map.json (decoded
   *                                   here); null gives the open, unbounded test field
   * @param {Object} opts.tuning       contents of data/tuning.json
   * @param {Object} [opts.data]       other loaded data files, by name
   * @param {number|string} [opts.seed]
   */
  constructor({ map = null, tuning, data = {}, seed = 1 } = {}) {
    if (!tuning) throw new Error('Sim: tuning is required');
    /** @type {IslandMap|null} static world data; never part of a snapshot */
    this.map = map == null ? null : map instanceof IslandMap ? map : IslandMap.fromJSON(map, tuning);
    this.tuning = tuning;
    this.data = data;
    /** the Journal's entries (data.lore_entries compiled, Lore.js); data, not state */
    this.lore = loreBook(data);
    /** the recipes (data.recipes compiled, Crafting.js); data, not state */
    this.recipeBook = recipeBook(data);
    this.seed = seed;
    /** ticks simulated so far */
    this.tick = 0;
    /**
     * @type {Array<{type:string}>} events of the last step; replaced (not mutated) at the start of each step.
     * Events raised while building or restoring (e.g. `player_unstuck`) are here until the first step.
     */
    this.events = [];
    this.rng = new Rng(seed);
    /** world rectangle, or null when the world is the open test field */
    this.bounds = worldBounds(this.map);
    /** @type {Collider|null} collision and line-of-sight queries on the island; null on the test field (no walls) */
    this.collider = this.map ? new Collider(this.map, tuning) : null;
    /** terrain movement rules (tuning.terrain as tables) */
    this.terrainRules = terrainRules(tuning);
    /** what the player's update borrows from the world each tick (reused, not state) */
    this.moveEnv = this.collider ? { collider: this.collider, rules: this.terrainRules, tide: 0, events: this.events } : null;

    let spawn;
    /** @type {import('../world/TestField.js').Prop[]} static scenery */
    this.props = [];
    if (this.map) {
      spawn = this.map.spawn;
      this.props = this.map.props;   // frozen and shared with the map: static scenery is not simulation state
    } else {
      const field = buildTestField(this.rng, tuning);
      spawn = field.spawn;
      this.props = field.props;
    }
    this.player = new Player({ x: spawn.x, y: spawn.y, radius: tuning.player.radius, tuning });
    if (spawn.facing && spawn.facing !== this.player.facing) {
      // the map chooses which way the player first looks (the island starts facing inland)
      const dir = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[spawn.facing];
      if (dir) [this.player.facing, this.player.dirX, this.player.dirY] = [spawn.facing, dir[0], dir[1]];
    }
    /** tide, day/night and weather (WorldState.js) */
    this.world = new WorldState(tuning);
    /** Resonance (Resonance.js): sources, tiers, anomaly pulses */
    this.resonance = new Resonance(tuning, this.map);
    /** @type {FogOfWar|null} the explored map and Shifting Paths (FogOfWar.js); null on the open test field */
    this.fog = this.map ? new FogOfWar(tuning, this.map) : null;
    /** recent noises the AI can hear (Noise.js) */
    this.noise = new NoiseField(tuning);
    /** footprints on wet sand (Footprints.js) */
    this.footprints = new FootprintTrail(tuning);
    /**
     * @type {{ cause: string, tick: number, day: number, distance: number }|null} set when the run is lost:
     * cause 'arrow' | 'bleed' | 'drowning' | 'thirst', the tick of death, world.day (days survived) and the
     * distance travelled in metres
     */
    this.over = null;
    /** the escapes in progress (steps 5.3, 5.4: endings/Endings.js) */
    this.endings = new Endings();
    /** @type {Object|null} set when an ending is reached (Endings.finish): { kind: 'dinghy'|'rescue', ... } */
    this.ending = null;
    /** what the player borrows from the world each tick (reused, not state; refreshed every step) */
    this.playerEnv = {
      tuning, dt: DT, tick: 0, bounds: this.bounds, move: this.moveEnv, world: this.world,
      map: this.map, props: this.props, noise: this.noise, footprints: this.footprints,
    };
    this.buildItems();
    giveStartingKit(this.inventory, tuning.inventory.startingKit);
    this.settlePlayer('spawn');
    this.initStory(new Story(), null, null);
    unlockStartEntries(this);
    refreshTarget(this);
    this.buildScouts();
  }

  /**
   * The Sentinelese (steps 4.1-4.3): `scouts` on their routes, and `threat`, the summary of what the scouts near
   * the player are doing ({ level: 'none'|'investigate'|'search'|'warn'|'chase', nearest, nearestId, count }),
   * derived every tick for the HUD and the music, never saved.
   */
  buildScouts() {
    /** the scouts (SentineleseAI.js) */
    this.scouts = new Scouts(this);
    this.scouts.spawnFromMap(this);
    /** @type {{ level: string, nearest: number|null, nearestId: string|null, count: number }} */
    this.threat = null;
    this.scouts.summarize(this);
  }

  /**
   * Story, dialogue, Marek and the safe zones (step 4.5); called by the constructor and by restore.
   * @param {Story} story
   * @param {Object|null} marekSnap
   * @param {Object|null} zonesSnap
   */
  initStory(story, marekSnap, zonesSnap) {
    /** flags, counters, sites seen, the conversation in progress (Dialogue.js) */
    this.story = story;
    /** the conversation engine; while `dialogue.active` the world is paused (see step) */
    this.dialogue = new Dialogue({ trees: dialogueTrees(this.data), story, host: dialogueHost(this) });
    /** @type {MarekNPC|null} */
    this.marek = marekSnap ? MarekNPC.restore(marekSnap, this.tuning.marek) : MarekNPC.fromMap(this.map, this.tuning.marek);
    this.safeZones = SafeZones.restore(zonesSnap, this.tuning.safeZones, this.map);
  }

  /** Marek's pose for this tick (he is updated even while the world is paused for a conversation) */
  updateMarek() {
    if (!this.marek) return;
    const view = this.dialogue.active ? this.dialogue.current() : null;
    this.marek.update(this.tuning.marek, { hour: this.world.timeOfDay, talking: !!view, speaking: view?.speaker === 'marek', player: this.player });
  }

  /**
   * Items and interaction (step 3.4): the catalog (data.items), the inventory, the world's pickups and the
   * interactables, all built from the map. `interactTarget`/`interactIcon` are derived each tick, never saved.
   */
  buildItems() {
    const t = this.tuning;
    /** item definitions of data/items.json */
    this.catalog = new ItemCatalog(this.data.items);
    /** the 6-slot hotbar */
    this.inventory = new Inventory(this.catalog, t.inventory.slots);
    /** items lying in the world, and container contents */
    this.pickups = new Pickups(this.map, this.catalog, t.interaction);
    /** the island's interactables and the interaction state */
    this.interactables = new Interactables(this.map, t.interaction);
    /** things in flight (thrown items; arrows in M4) and the throw cooldown */
    this.projectiles = new Projectiles();
    /** @type {Object|null} what `interact` would use now (an Interactable or a pickup) */
    this.interactTarget = null;
    /** @type {string|null} its context icon: 'hand' | 'eye' | 'speech' | 'offering' */
    this.interactIcon = null;
  }

  /**
   * The truces of the coastal offering (step 4.4), per beach sector that has had one:
   * { active, start, until, chain, endTick, endReason } (ticks). Read-only for the HUD, journal, music and bots.
   */
  get truces() {
    return this.scouts.offerings.truces;
  }

  /** seconds simulated so far (derived from `tick`, so it never drifts) */
  get time() {
    return this.tick * DT;
  }

  /**
   * Tide height 0 (lowest) .. 1 (highest). The world clock (step 2.4) provides `this.world.tideHeight`; until it
   * exists the tide stands at tuning.terrain.lowTide.
   * @returns {number}
   */
  tideHeight() {
    const h = this.world?.tideHeight;
    return typeof h === 'number' ? h : this.terrainRules.lowTide;
  }

  /**
   * Make sure the player is not inside a blocker: move them to the nearest free position (else near the map's
   * spawn) and emit `player_unstuck`. Then set mode and terrain from the ground. Never throws.
   * @param {string} reason 'spawn' | 'restore' | ...
   */
  settlePlayer(reason) {
    if (!this.collider) return;
    const p = this.player;
    const c = this.collider;
    this.moveEnv.tide = this.tideHeight();
    if (!c.isPositionFree(p.x, p.y, p.radius)) {
      const fromX = p.x;
      const fromY = p.y;
      const out = { x: p.x, y: p.y };
      const reach = this.tuning.collision.unstuckSearch;
      const sx = Number.isFinite(p.x) ? p.x : this.map.spawn.x;
      const sy = Number.isFinite(p.y) ? p.y : this.map.spawn.y;
      const ok = c.nearestFreePosition(sx, sy, p.radius, reach, out)
        || c.nearestFreePosition(this.map.spawn.x, this.map.spawn.y, p.radius, reach, out);
      if (ok) {
        p.x = p.prevX = out.x;
        p.y = p.prevY = out.y;
      }
      this.events.push({ type: 'player_unstuck', reason, ok, fromX, fromY, x: p.x, y: p.y });
    }
    p.syncTerrain(this.moveEnv);
  }

  /**
   * Advance exactly one tick.
   * @param {Partial<import('./input.js').InputState>} [input]
   */
  step(input) {
    this.events = [];
    // once an ending is reached the player is out of the world's hands: no more input
    const inp = sanitizeInput(this.ending ? null : input);
    if (this.dialogue.active) {
      // A conversation pauses everything: tide, day, weather, player, scouts. The tension of the game is
      // stealth, not reading speed. Only the conversation advances (hotbar n = choose n, interact = advance),
      // and the tick counter, so replays and hashes stay one entry per input.
      this.dialogue.step(inp);
      this.updateMarek();
      this.tick++;
      return;
    }
    this.world.step(this.rng, this.events);   // before the entities, so they see this tick's tide and weather
    const env = this.moveEnv;
    if (env) {
      env.tide = this.tideHeight();
      env.events = this.events;
    }
    this.noise.beginTick(this.tick);
    this.footprints.beginTick(this.tick);
    const pe = this.playerEnv;
    pe.tick = this.tick;
    pe.world = this.world;
    pe.props = this.props;
    pe.noise = this.noise;
    pe.footprints = this.footprints;
    // the dinghy (step 5.3): dragging slows the input; afloat, the oars replace the player's own movement
    this.endings.beforePlayer(this, inp);
    if (this.endings.ridesBoat) this.endings.dinghy.row(this, inp, pe);
    else this.player.update(inp, pe);
    this.endings.afterPlayer(this);
    this.stepItems(inp);
    // the peak's minute (step 5.4) gives its orders before the scouts act on them
    this.endings.beforeScouts(this);
    // the scouts after the player, the items and the projectiles (they see this tick's world, and an arrow hit
    // this tick is in this tick's events and death check); before Resonance, so they read the tier of the tick
    // before, as everything else that reads it does. After the run is over they stand down.
    this.scouts.update(this);
    // after the player and the items: this tick's position, light and power. Once the run is over Resonance
    // still settles (the world goes on) but announces nothing, and the fog no longer follows the body
    this.resonance.step(this, this.over ? [] : this.events);
    if (!this.over) this.fog?.step(this, this.events);   // after Resonance: Shifting Paths reads this tick's tier
    this.collectEvents();
    // story systems run last, so they see every event of this tick (site_inspected, ...)
    this.marek?.blockPlayer(this.player, this.collider);
    this.safeZones.update(this.player, this.events);
    marekAfterStep(this);
    storyItemsAfterStep(this);   // the flare rounds of the wreck's gun and the Cartographer's pouch
    loreAfterStep(this);   // after Marek's hooks: their flags can unlock entries
    this.updateMarek();
    this.checkOver();
    this.endings.afterStep(this);
    this.tick++;
  }

  /**
   * Hotbar, light, interaction, use, drop and throw for one tick, then things in flight and the target the
   * presentation shows. A dead player's inputs are ignored and a running channel (drinking) ends; what is already
   * in the air still lands.
   */
  stepItems(inp) {
    const crafts = applyJournalCommands(this, inp.journal);
    if (this.player.dead) {
      if (this.interactables.channel) endChannel(this, 'dead');
    } else {
      selectHotbar(this, inp.hotbar);
      if (inp.toggleLight) toggleLight(this);
      for (const id of crafts) craft(this, id, 'journal');   // Make on the Journal's Recipes tab
      updateInteraction(this, inp);
      if (inp.useItem) {
        if (wantsThrow(this, inp)) throwHeld(this, inp);
        else if (this.inventory.heldId === 'flare_gun') useFlareGun(this);   // never wasted away from the peak
        else if (!craftFromHand(this)) useHeld(this);   // an ingredient in hand makes its recipe
      }
      if (inp.drop) dropHeld(this);
    }
    this.projectiles.update(this);
    syncLight(this);
    refreshTarget(this);
  }

  /**
   * The lose state (spec §8): once the player is dead, `over` records how and when, with the days survived and
   * the distance travelled for the game-over screen, and `player_died` is raised exactly once.
   */
  checkOver() {
    const p = this.player;
    if (!p.dead || this.over) return;
    this.over = { cause: p.deathCause, tick: this.tick, day: this.world.day, distance: p.distanceMetres };
    this.events.push({ type: 'player_died', ...this.over });
  }

  /**
   * Move the events raised by the player and the noise field (also those raised between steps, e.g. by a debug
   * cheat) into this step's list.
   */
  collectEvents() {
    for (const e of this.player.takeEvents()) this.events.push(e);
    for (const e of this.noise.takeEvents()) this.events.push(e);
  }

  /**
   * Footprints within `r` world px of a point, freshest first, each with its `age` in seconds (for the AI).
   * @returns {Array<import('../world/Footprints.js').Footprint & { age: number }>}
   */
  footprintsNear(x, y, r) {
    return this.footprints.near(x, y, r);
  }

  /** @returns {Object} JSON-serialisable state; with the same map/tuning/data it rebuilds this exact Sim */
  snapshot() {
    return {
      version: SNAPSHOT_VERSION,
      seed: this.seed,
      tick: this.tick,
      rng: this.rng.snapshot(),
      player: this.player.snapshot(),
      world: this.world.snapshot(),
      resonance: this.resonance.snapshot(),
      fog: this.fog ? this.fog.snapshot() : null,
      noise: this.noise.snapshot(),
      footprints: this.footprints.snapshot(),
      over: this.over ? { ...this.over } : null,
      inventory: this.inventory.snapshot(),
      pickups: this.pickups.snapshot(),
      interaction: this.interactables.snapshot(),
      projectiles: this.projectiles.snapshot(),
      story: this.story.snapshot(),
      marek: this.marek ? this.marek.snapshot() : null,
      safeZones: this.safeZones.snapshot(),
      scouts: this.scouts.snapshot(),
      endings: this.endings.snapshot(),
      ending: this.ending ? { ...this.ending } : null,
      // the map itself is data, not state: only which map this was, so a save from another map is refused
      map: this.map ? { version: this.map.version, hash: this.map.hash } : null,
      // map props are rebuilt from the map; only the test field's (placed by the rng) are stored
      props: this.map ? null : this.props.map((p) => ({ ...p })),
    };
  }

  /**
   * @param {Object} snap from `snapshot()` (possibly through JSON)
   * @param {{ map?: Object|null, tuning: Object, data?: Object }} ctx
   * @returns {Sim}
   */
  static restore(snap, { map = null, tuning, data = {} }) {
    if (!snap || !READABLE_VERSIONS.has(snap.version)) throw new Error(`Sim.restore: unsupported snapshot version ${snap?.version}`);
    const sim = new Sim({ map, tuning, data, seed: snap.seed });
    const want = snap.map ? `${snap.map.version}/${snap.map.hash}` : 'none';
    const have = sim.map ? `${sim.map.version}/${sim.map.hash}` : 'none';
    if (want !== have) throw new Error(`Sim.restore: snapshot was made on map ${want}, not on ${have}`);
    sim.tick = snap.tick;
    sim.rng = Rng.restore(snap.rng);
    sim.player = Player.restore(snap.player, tuning);
    sim.world = snap.world ? WorldState.restore(snap.world, tuning) : WorldState.atTick(snap.tick, tuning);
    if (snap.resonance) sim.resonance = Resonance.restore(snap.resonance, tuning, sim.map);
    if (snap.fog && sim.map) sim.fog = FogOfWar.restore(snap.fog, tuning, sim.map);
    sim.noise = NoiseField.restore(snap.noise, tuning);
    sim.footprints = FootprintTrail.restore(snap.footprints, tuning);
    sim.over = snap.over ? { ...snap.over } : null;
    if (!sim.map) sim.props = snap.props.map((p) => ({ ...p }));
    if (snap.inventory) {
      // an older snapshot has no items: it keeps the fresh starting kit and the map's loot
      sim.inventory = Inventory.restore(snap.inventory, sim.catalog, tuning.inventory.slots);
      sim.pickups = Pickups.restore(snap.pickups, sim.map, sim.catalog, tuning.interaction);
      sim.interactables.restoreState(snap.interaction);
      if (snap.projectiles) sim.projectiles = Projectiles.restore(snap.projectiles);
    }
    sim.initStory(Story.restore(snap.story), snap.marek ?? null, snap.safeZones ?? null);
    // a conversation saved at a node the dialogue data no longer has is closed, not left hanging
    if (sim.story.conversation && !sim.dialogue.node()) sim.story.conversation = null;
    if (snap.scouts) sim.scouts = Scouts.restore(snap.scouts, sim);
    else sim.scouts.advanceTo(sim, snap.tick);   // an older save: the patrols where a new game's would be now
    sim.endings = Endings.restore(snap.endings);
    sim.ending = snap.ending ? { ...snap.ending } : null;
    sim.endings.dinghy.sync(sim);   // the dinghy's interactable where the dinghy lies
    sim.events = [];
    if (sim.collider) {
      // a restored player inside a wall is moved out; one that is free keeps its mode (hysteresis state) as saved
      const free = sim.collider.isPositionFree(sim.player.x, sim.player.y, sim.player.radius);
      if (!free) sim.settlePlayer('restore');
    }
    syncLight(sim);
    refreshTarget(sim);
    sim.scouts.summarize(sim);
    return sim;
  }
}
