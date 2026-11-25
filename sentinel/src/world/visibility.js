// How far eyes reach in the light of the moment (spec §5.2: night lowers enemy sightlines, squalls reduce
// visibility). Simulation side and pure: step 4.1 multiplies scout sight ranges by it. Lights carried by the
// player (the flashlight) are not part of it: they make the player more visible, which is the AI's own rule.
//
//   ambientVisibility = min(1, night + (1 - night) * daylight + moonGain * moonlight) * visibilityMultiplier
//
// with night and moonGain from tuning.world.visibility, daylight, moonlight and visibilityMultiplier (the squall)
// from sim.world. Full daylight in clear weather is 1; a moonless clear night is `night`.

/**
 * @param {{ daylight: number, moonlight: number, visibilityMultiplier: number }} world sim.world
 * @param {Object} tuning the whole tuning object (reads tuning.world.visibility)
 * @returns {number} 0..1
 */
export function ambientVisibility(world, tuning) {
  const cfg = tuning.world.visibility;
  const sky = cfg.night + (1 - cfg.night) * world.daylight + cfg.moonGain * world.moonlight;
  const v = (sky < 1 ? sky : 1) * world.visibilityMultiplier;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
