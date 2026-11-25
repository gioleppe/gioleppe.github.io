// Public entry of the music engine. See Music.js for the API and schema.js for the score format.
export { Music, GLOBAL_PARAMS, LAYER_PARAMS, LATE_TOLERANCE } from './Music.js';
export { renderTrack } from './render.js';
export { validateScore, VOICES } from './schema.js';
export { compile, queryCycle } from './mini.js';
