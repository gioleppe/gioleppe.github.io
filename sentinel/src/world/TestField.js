// The open test field used while there is no island map: the player at the origin and a scatter of props
// placed from the simulation's seeded rng, so walking around shows front/behind ordering.

/**
 * @typedef {Object} Prop
 * @property {string} id
 * @property {string} kind   'palm' | 'rock' | 'tall_grass' | 'monolith' | ...
 * @property {number} x      world pixels (ground contact point)
 * @property {number} y
 * @property {number} radius collision radius (not enforced yet)
 */

/**
 * @param {import('../sim/rng.js').Rng} rng
 * @param {Object} tuning the whole tuning object (uses tuning.testField and tuning.props)
 * @returns {{ spawn: {x:number,y:number}, props: Prop[] }}
 */
export function buildTestField(rng, tuning) {
  const cfg = tuning.testField;
  const spawn = { x: 0, y: 0 };
  const props = [];
  let n = 0;
  for (const [kind, count] of Object.entries(cfg.counts)) {
    const radius = tuning.props[kind]?.radius ?? 0;
    for (let i = 0; i < count; i++) {
      // rejection sampling with a bounded number of tries: a crowded field just gets fewer props, never hangs
      for (let attempt = 0; attempt < cfg.placementTries; attempt++) {
        const x = Math.round(rng.range(-cfg.halfWidth, cfg.halfWidth));
        const y = Math.round(rng.range(-cfg.halfHeight, cfg.halfHeight));
        if (dist(x, y, spawn.x, spawn.y) < cfg.clearRadius) continue;
        if (props.some((p) => dist(p.x, p.y, x, y) < cfg.minSpacing)) continue;
        props.push({ id: `prop${++n}`, kind, x, y, radius });
        break;
      }
    }
  }
  return { spawn, props };
}

// sqrt is exactly rounded in every engine, Math.hypot is not: keep the layout identical in Node and every browser
function dist(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}
