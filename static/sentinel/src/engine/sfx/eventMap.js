// Which sound each simulation event makes (step 5.5). Every event type the simulation emits must be listed here,
// either with the name of a handler in Sfx.js or as SILENT (the music, the ambience or the body sounds already
// answer it, or it is bookkeeping). A test greps src/ for emitted event types and fails on one missing here, so a new
// gameplay event cannot be forgotten. Pure data: importable in Node.

export const SILENT = 'silent';

export const SFX_EVENTS = Object.freeze({
  // the player's body
  player_state: 'playerState',          // exhausted -> gasp, drowning_start -> gasp, crouch/stand -> cloth
  player_mode: 'playerMode',            // into the water / out of it
  player_hurt: 'hurt',
  player_died: 'death',
  player_cover: 'cover',                // a rustle when settling into cover
  player_unstuck: SILENT,
  noise: SILENT,                        // what the scouts hear; its source makes the sound
  noise_loud: SILENT,
  shake: SILENT,                        // camera only

  // items
  item_picked: 'pickup',
  item_given: 'pickup',
  item_taken: 'drop',
  item_dropped: 'drop',
  inventory_full: 'deny',
  item_used: 'itemUsed',                // drink, herbs, bandage
  item_cannot_use: 'deny',
  drop_refused: 'deny',
  hotbar: 'select',
  power: 'power',                       // flashlight click, the battery's hum
  light_off: 'click',                   // Marek asks for the light to go off (a dialogue event)
  throw: 'throw',
  throw_refused: 'deny',
  impact: 'impact',                     // per surface, placed where it lands

  // crafting, the Journal, lore
  crafted: 'crafted',
  craft_failed: 'deny',
  recipe_learned: 'page',
  journal_entry: 'page',
  journal_read: SILENT,
  map_revealed: 'page',

  // interactions (lasting ones loop from the channel state: drinking, prying, patching)
  interact: SILENT,
  channel_start: SILENT,
  channel_end: SILENT,
  site_inspected: SILENT,
  container_empty: 'deny',
  hatch_inspected: SILENT,
  hatch_pry_start: SILENT,
  hatch_pry_failed: 'deny',
  hatch_opened: 'hatchOpened',
  dinghy_waits: SILENT,
  dinghy_inspected: SILENT,
  dinghy_repair_start: SILENT,
  dinghy_repair_failed: 'deny',
  dinghy_repaired: 'confirm',
  battery_humming: 'electric',
  signal_point_inspected: SILENT,
  flare_refused: 'deny',
  flare_ready: 'confirm',

  // the world (the beds follow the state; these are the moments)
  tide_state: SILENT,
  day_phase: SILENT,
  new_day: SILENT,
  weather_start: 'weatherStart',        // a distant roll as the squall comes in
  weather_end: SILENT,
  resonance_tier: 'resonanceTier',
  anomaly_pulse: 'anomalyPulse',        // a deep, soft pulse from the zone's direction
  landmark_discovered: 'landmark',
  shifting_paths: 'shiftingPaths',
  safe_zone: SILENT,                    // the music answers (Marek's cue)

  // dialogue (the music ducks under it)
  dialogue_start: SILENT,
  dialogue_node: SILENT,
  dialogue_choice: 'select',
  dialogue_end: SILENT,

  // the Sentinelese (steps 4.1-4.3)
  scout_state: SILENT,                  // the tension music answers
  scout_unstuck: SILENT,
  scout_shout: 'shout',
  scout_draw: 'bowDraw',
  arrow_fired: 'arrowFired',
  arrow_land: 'arrowLand',
  arrow_hit: 'arrowHit',
  whistle: 'whistle',
  player_spotted: 'spotted',            // a stinger, once per encounter
  chase_lost: 'chaseLost',
  warn_end: 'warnEnd',                  // retreat / driven_off: the release of tension; re-arms the stinger

  // offerings, truces, the totem, the monolith, the gatherers (another branch; registered by name ahead of it).
  // Quiet moments: restrained, wordless, never a reward jingle. Most are answered by silence on purpose.
  offering_placed: 'offeringPlaced',    // the object set down, softly, where it lies
  offering_taken_back: 'offeringTakenBack',
  offering_seen: SILENT,                // a scout notices: nothing to tell the player that the scout does not
  offering_accepted: 'offeringAccepted', // a soft let-go of breath, far below the stinger's level
  truce_start: SILENT,                  // the scouts' states (and the tension music) answer
  truce_broken: SILENT,                 // likewise: the shout / bow sounds of the scouts carry it
  truce_end: SILENT,
  totem_inspected: SILENT,
  monolith_window: SILENT,              // the Resonance beds and the anomaly music answer
  monolith_respect: SILENT,
  monolith_respect_end: SILENT,
  gatherer_noticed: SILENT,
  gatherer_gift: 'gathererGift',        // something set down near the player, softly, where it lies
  gatherer_startled: 'gathererStartled', // a rustle of leaves where the gatherer was
  gatherer_left: SILENT,
});

/** the Sentinelese' events */
export const SCOUT_EVENTS = Object.freeze(['scout_state', 'scout_unstuck', 'scout_shout', 'scout_draw', 'arrow_fired', 'arrow_land', 'arrow_hit',
  'whistle', 'player_spotted', 'chase_lost', 'warn_end']);

/** the quiet-contact events (offerings, truce, totem, monolith, gatherers): never louder than a footstep */
export const QUIET_EVENTS = Object.freeze(['offering_placed', 'offering_taken_back', 'offering_seen', 'offering_accepted',
  'truce_start', 'truce_broken', 'truce_end', 'totem_inspected', 'monolith_window', 'monolith_respect', 'monolith_respect_end',
  'gatherer_noticed', 'gatherer_gift', 'gatherer_startled', 'gatherer_left']);
