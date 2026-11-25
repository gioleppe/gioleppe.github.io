// The page's own health check for `tools/smoke.mjs` (`window.__smoke()`): the loop is alive, the data loaded,
// and the world canvas shows something. Pure, so the rules are unit-tested with fake counters.

/**
 * True when the RGBA pixels are not all the same colour (something was drawn, not just a cleared canvas).
 * @param {ArrayLike<number>} data RGBA bytes (ImageData.data)
 * @param {number} [stride=1] look at every stride-th pixel
 */
export function pixelsVary(data, stride = 1) {
  if (data.length < 8) return false;
  const step = Math.max(1, Math.floor(stride)) * 4;
  const [r, g, b, a] = [data[0], data[1], data[2], data[3]];
  for (let i = step; i + 3 < data.length; i += step) {
    if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b || data[i + 3] !== a) return true;
  }
  return false;
}

/**
 * @param {Object} s
 * @param {number} s.frames      frames drawn since the game data loaded
 * @param {number} s.ticks       simulation ticks run since the game data loaded
 * @param {boolean} s.loaded     the game data has loaded and the Sim exists
 * @param {string} [s.loadError] the load error shown to the player, if any
 * @param {boolean} s.drawn      the world canvas has non-uniform pixels
 * @param {boolean} [s.paused]   debug pause is on (ticks are then not expected to advance)
 * @returns {{ ok: boolean, details: object }}
 */
export function smokeStatus({ frames, ticks, loaded, loadError = '', drawn, paused = false }) {
  const problems = [];
  if (loadError) problems.push(`load error: ${loadError}`);
  else if (!loaded) problems.push('game data not loaded');
  if (!(frames > 0)) problems.push('no frame drawn since load');
  if (!(ticks > 0) && !paused) problems.push('no simulation tick since load');
  if (!drawn) problems.push('world canvas is blank');
  return { ok: problems.length === 0, details: { frames, ticks, loaded, paused, drawn, problems } };
}
