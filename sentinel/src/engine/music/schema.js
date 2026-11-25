// The score format and its validation. Pure (no Web Audio), so tools/music/validate.mjs and the tests use it in Node.
//
// data/music/<id>.json:
// {
//   "id": "title", "title": "Title theme", "bpm": 56, "beatsPerBar": 4,
//   "scale": { "root": "d3", "mode": "phrygian" },      // degrees in patterns resolve against it
//   "bars": 16,                                          // loop length; one pattern cycle = one bar
//   "sections": ["calm", "tense"], "section": "calm",    // optional: section names and the one to start in
//   "seed": 1,                                           // optional: seed for `?` (each layer adds its index)
//   "fx": { "delayBeats": 0.75, "delayFeedback": 0.35, "delayTone": 2500 },   // optional
//   "layers": [{
//     "id": "pad", "voice": "pad", "params": { "cutoff": 900 },   // params: see VOICES below
//     "gain": 0.8, "reverb": 0.5, "delay": 0.1, "pan": 0, "transpose": 0,
//     "pattern": "<[d3,f3,a3] [eb3,g3,bb3]>/2"                    // or "sections": { "calm": "...", "tense": "..." }
//   }]
// }
import { compile } from './mini.js';
import { isNoteName, isDegree, resolveAtom, resolveScale } from './theory.js';

/** [min, max, default] per numeric parameter; strings list their allowed values with the default first */
const ENV = (a, d, s, r) => ({ attack: [0.001, 10, a], decay: [0.005, 20, d], sustain: [0, 1, s], release: [0.005, 20, r] });
const WAVES = ['sawtooth', 'triangle', 'square', 'sine'];

export const VOICES = {
  pad: {
    pitched: true,
    params: { ...ENV(1.5, 1, 0.8, 2.5), wave: WAVES, voices: [1, 5, 3], detune: [0, 50, 12], cutoff: [40, 16000, 900],
      q: [0.1, 20, 0.7], width: [0, 1, 0.6], level: [0, 1, 0.25], maxVoices: [1, 32, 12] },
  },
  pluck: {
    pitched: true,
    params: { attack: [0.001, 1, 0.003], decay: [0.02, 10, 0.6], wave: ['triangle', 'sawtooth', 'square', 'sine'],
      cutoff: [40, 16000, 2000], q: [0.1, 20, 1], envAmount: [0, 8, 3], level: [0, 1, 0.35], maxVoices: [1, 32, 8] },
  },
  bass: {
    pitched: true,
    params: { ...ENV(0.02, 0.3, 0.7, 0.4), wave: ['triangle', 'sawtooth', 'square', 'sine'], sub: [0, 1, 0.5],
      cutoff: [40, 8000, 400], q: [0.1, 20, 0.8], level: [0, 1, 0.45], maxVoices: [1, 32, 4] },
  },
  bell: {
    pitched: true,
    params: { attack: [0.001, 1, 0.002], decay: [0.05, 20, 4], ratio: [0.25, 16, 3.5], index: [0, 20, 2.5],
      brightDecay: [0.02, 1, 0.3], partial: [0, 1, 0.3], partialRatio: [0.5, 16, 2.76], cutoff: [200, 18000, 5000],
      level: [0, 1, 0.22], maxVoices: [1, 32, 8] },
  },
  drone: {
    pitched: true,
    params: { ...ENV(3, 1, 1, 4), wave: WAVES, detune: [0, 50, 7], cutoff: [40, 8000, 500], q: [0.1, 20, 1],
      lfoRate: [0.005, 5, 0.07], lfoDepth: [0, 4000, 200], drift: [0, 100, 4], sub: [0, 1, 0.3], level: [0, 1, 0.22], maxVoices: [1, 16, 4] },
  },
  perc: {
    pitched: false,
    kinds: ['thud', 'shaker', 'click'],
    params: { tone: [0.1, 4, 1], decay: [0.1, 8, 1], level: [0, 1, 0.5], maxVoices: [1, 32, 8] },
  },
};

export const SCORE_KEYS = ['id', 'title', 'bpm', 'beatsPerBar', 'scale', 'bars', 'sections', 'section', 'seed', 'fx', 'layers', 'comment'];
export const LAYER_KEYS = ['id', 'voice', 'params', 'gain', 'reverb', 'delay', 'pan', 'transpose', 'pattern', 'sections', 'comment'];
export const FX = { delayBeats: [0.0625, 4, 0.75], delayFeedback: [0, 0.9, 0.3], delayTone: [200, 12000, 2500] };
export const MIDI_RANGE = [21, 108];   // A0..C8: anything outside is a typo, not music
const ID = /^[a-z][a-z0-9_]*$/;

/** voice params with defaults filled in (score params win) */
export function voiceParams(voice, params = {}) {
  const spec = VOICES[voice];
  const out = {};
  for (const [k, v] of Object.entries(spec.params)) out[k] = typeof v[0] === 'string' ? v[0] : v[2];
  return { ...out, ...params };
}

/** score effect settings with defaults */
export function fxParams(fx = {}) {
  const out = {};
  for (const [k, v] of Object.entries(FX)) out[k] = fx[k] ?? v[2];
  return out;
}

/** the pattern of a layer in a section (null if the layer is silent there) */
export function layerPattern(layer, section) {
  if (layer.pattern !== undefined) return layer.pattern;
  return layer.sections?.[section] ?? null;
}

/** the section a score starts in */
export const defaultSection = (score) => score.section ?? score.sections?.[0] ?? null;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Check a score. Returns a list of problems (empty when the score is good); never throws.
 * @param {object} score parsed JSON
 * @param {{ name?: string }} [opts] name used in messages (e.g. the file name)
 * @returns {string[]}
 */
export function validateScore(score, { name } = {}) {
  const problems = [];
  const where = name ?? score?.id ?? 'score';
  const bad = (msg) => problems.push(`${where}: ${msg}`);
  if (!score || typeof score !== 'object' || Array.isArray(score)) { bad('not an object'); return problems; }

  for (const k of Object.keys(score)) if (!SCORE_KEYS.includes(k)) bad(`unknown key "${k}"`);
  if (typeof score.id !== 'string' || !ID.test(score.id)) bad('id must be a lower-case identifier');
  if (score.title !== undefined && typeof score.title !== 'string') bad('title must be a string');
  if (!isNum(score.bpm) || score.bpm < 20 || score.bpm > 240) bad(`bpm must be 20..240 (got ${JSON.stringify(score.bpm)})`);
  if (!Number.isInteger(score.beatsPerBar) || score.beatsPerBar < 1 || score.beatsPerBar > 16) bad('beatsPerBar must be an integer 1..16');
  if (!Number.isInteger(score.bars) || score.bars < 1 || score.bars > 256) bad('bars (loop length) must be an integer 1..256');
  if (score.seed !== undefined && !Number.isInteger(score.seed)) bad('seed must be an integer');
  let scale = null;
  if (score.scale !== undefined) {
    try {
      for (const k of Object.keys(score.scale)) if (!['root', 'mode'].includes(k)) bad(`scale: unknown key "${k}"`);
      scale = resolveScale(score.scale);
    } catch (e) { bad(`scale: ${e.message}`); }
  }
  if (score.fx !== undefined) {
    if (!score.fx || typeof score.fx !== 'object') bad('fx must be an object');
    else {
      for (const [k, v] of Object.entries(score.fx)) {
        if (!FX[k]) bad(`fx: unknown key "${k}"`);
        else if (!isNum(v) || v < FX[k][0] || v > FX[k][1]) bad(`fx.${k} must be ${FX[k][0]}..${FX[k][1]} (got ${JSON.stringify(v)})`);
      }
    }
  }
  const sections = score.sections;
  if (sections !== undefined) {
    if (!Array.isArray(sections) || !sections.length || !sections.every((s) => typeof s === 'string' && ID.test(s))) bad('sections must be a non-empty list of identifiers');
    else if (new Set(sections).size !== sections.length) bad('sections must be unique');
  }
  if (score.section !== undefined && !(Array.isArray(sections) && sections.includes(score.section))) bad(`section "${score.section}" is not in sections`);

  if (!Array.isArray(score.layers) || !score.layers.length) { bad('layers must be a non-empty list'); return problems; }
  const ids = new Set();
  score.layers.forEach((layer, i) => {
    const lw = `layer ${layer?.id ?? i}`;
    const lbad = (msg) => bad(`${lw}: ${msg}`);
    if (!layer || typeof layer !== 'object') { lbad('not an object'); return; }
    for (const k of Object.keys(layer)) if (!LAYER_KEYS.includes(k)) lbad(`unknown key "${k}"`);
    if (typeof layer.id !== 'string' || !ID.test(layer.id)) lbad('id must be a lower-case identifier');
    else if (ids.has(layer.id)) lbad('duplicate id');
    else ids.add(layer.id);
    const spec = VOICES[layer.voice];
    if (!spec) { lbad(`unknown voice "${layer.voice}" (known: ${Object.keys(VOICES).join(', ')})`); return; }

    if (layer.params !== undefined) {
      if (!layer.params || typeof layer.params !== 'object') lbad('params must be an object');
      else for (const [k, v] of Object.entries(layer.params)) {
        const p = spec.params[k];
        if (!p) lbad(`unknown ${layer.voice} param "${k}" (known: ${Object.keys(spec.params).join(', ')})`);
        else if (typeof p[0] === 'string') { if (!p.includes(v)) lbad(`param ${k} must be one of ${p.join(', ')}`); }
        else if (!isNum(v) || v < p[0] || v > p[1]) lbad(`param ${k} must be ${p[0]}..${p[1]} (got ${JSON.stringify(v)})`);
      }
    }
    const range = (k, lo, hi, def) => {
      const v = layer[k] ?? def;
      if (!isNum(v) || v < lo || v > hi) lbad(`${k} must be ${lo}..${hi} (got ${JSON.stringify(layer[k])})`);
    };
    range('gain', 0, 1.5, 1);
    range('reverb', 0, 1, 0);
    range('delay', 0, 1, 0);
    range('pan', -1, 1, 0);
    if (layer.transpose !== undefined && (!Number.isInteger(layer.transpose) || Math.abs(layer.transpose) > 48)) lbad('transpose must be an integer -48..48');

    const hasPattern = layer.pattern !== undefined;
    const hasSections = layer.sections !== undefined;
    if (hasPattern === hasSections) { lbad('needs exactly one of "pattern" or "sections"'); return; }
    let patterns;
    if (hasPattern) patterns = [['pattern', layer.pattern]];
    else {
      if (!layer.sections || typeof layer.sections !== 'object' || !Object.keys(layer.sections).length) { lbad('sections must be a non-empty object'); return; }
      if (!Array.isArray(sections)) { lbad('uses sections but the score declares none'); return; }
      patterns = Object.entries(layer.sections).map(([s, p]) => {
        if (!sections.includes(s)) lbad(`section "${s}" is not declared in the score`);
        return [`sections.${s}`, p];
      });
    }
    for (const [label, src] of patterns) {
      if (typeof src !== 'string') { lbad(`${label} must be a string`); continue; }
      let pat;
      try { pat = compile(src); } catch (e) { lbad(`${label}: ${e.message}`); continue; }
      if (Number.isInteger(score.bars) && score.bars % pat.period !== 0) {
        lbad(`${label} repeats every ${pat.period} bars, which does not divide the loop of ${score.bars} bars`);
      }
      if (pat.atoms.length === 0) lbad(`${label} has no notes`);
      for (const atom of pat.atoms) {
        if (!spec.pitched) {
          if (!spec.kinds.includes(atom)) lbad(`${label}: "${atom}" is not a ${layer.voice} kind (${spec.kinds.join(', ')})`);
          continue;
        }
        if (!isNoteName(atom) && !isDegree(atom)) { lbad(`${label}: "${atom}" is neither a note name nor a scale degree`); continue; }
        if (isDegree(atom) && !scale) { lbad(`${label}: degree "${atom}" needs a score scale`); continue; }
        const { midi } = resolveAtom(atom, scale, layer.transpose ?? 0);
        if (midi < MIDI_RANGE[0] || midi > MIDI_RANGE[1]) lbad(`${label}: "${atom}" is MIDI ${midi}, outside ${MIDI_RANGE[0]}..${MIDI_RANGE[1]}`);
      }
    }
  });
  return problems;
}
