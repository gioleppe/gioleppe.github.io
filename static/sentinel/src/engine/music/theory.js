// Note names, scales and scale degrees, following Strudel's conventions so patterns mean the same in strudel.cc:
// c4 = MIDI 60, a4 = 440 Hz, an octave-less name is octave 3, sharps `#` or `s`, flats `b` or `f`;
// a number is a scale degree, as in Strudel's `n("0 2 4").scale("D3:phrygian")`. Pure.

const LETTERS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** Scale steps in semitones. Names as Strudel (tonal) spells them. */
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic minor': [0, 2, 3, 5, 7, 9, 11],
  'phrygian dominant': [0, 1, 4, 5, 7, 8, 10],
  'minor pentatonic': [0, 3, 5, 7, 10],
  'major pentatonic': [0, 2, 4, 7, 9],
  'whole tone': [0, 2, 4, 6, 8, 10],
  hirajoshi: [0, 2, 3, 7, 8],
};

const NOTE_RE = /^([a-gA-G])((?:#|s|b|f)*)(-?\d+)?$/;

/** true if the word is a note name such as c3, eb3, f#4, cs4, a */
export const isNoteName = (w) => NOTE_RE.test(w);

/** true if the word is a scale degree (an integer, possibly negative) */
export const isDegree = (w) => /^-?\d+$/.test(w);

/** MIDI number of a note name; throws on anything else */
export function noteToMidi(name) {
  const m = NOTE_RE.exec(name);
  if (!m) throw new RangeError(`not a note name: "${name}"`);
  let acc = 0;
  for (const ch of m[2]) acc += ch === '#' || ch === 's' ? 1 : -1;
  const octave = m[3] === undefined ? 3 : Number(m[3]);
  return (octave + 1) * 12 + LETTERS[m[1].toLowerCase()] + acc;
}

const SHARP_NAMES = ['c', 'c#', 'd', 'eb', 'e', 'f', 'f#', 'g', 'ab', 'a', 'bb', 'b'];

/** note name of a MIDI number (flats for eb, ab, bb; sharps for c#, f#) */
export function midiToNote(midi) {
  return `${SHARP_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** frequency in Hz of a (possibly fractional) MIDI number */
export const midiToFreq = (midi) => 440 * 2 ** ((midi - 69) / 12);

/**
 * Validate and normalise a scale: `{ root: 'd3', mode: 'phrygian' }`.
 * @returns {{ rootMidi: number, steps: number[], name: string }}
 */
export function resolveScale(scale) {
  if (!scale || typeof scale !== 'object') throw new RangeError('scale must be { root, mode }');
  const steps = SCALES[scale.mode];
  if (!steps) throw new RangeError(`unknown scale mode "${scale.mode}" (known: ${Object.keys(SCALES).join(', ')})`);
  return { rootMidi: noteToMidi(scale.root), steps, name: `${scale.root}:${scale.mode}` };
}

/** MIDI number of scale degree `deg` (0 = root; wraps into higher and lower octaves) */
export function degreeToMidi(deg, scale) {
  const s = scale.steps ? scale : resolveScale(scale);
  const n = s.steps.length;
  const octave = Math.floor(deg / n);
  const idx = deg - octave * n;
  return s.rootMidi + octave * 12 + s.steps[idx];
}

/**
 * Turn a pattern atom into what a voice plays: `{ midi }` for a note name or a degree, `{ name }` otherwise.
 * @param {string} word
 * @param {object} [scale] `{ root, mode }` or a resolved scale; needed for degrees
 * @param {number} [transpose] semitones added to pitched atoms
 */
export function resolveAtom(word, scale, transpose = 0) {
  if (isDegree(word)) {
    if (!scale) throw new RangeError(`degree "${word}" needs a scale`);
    return { midi: degreeToMidi(Number(word), scale) + transpose };
  }
  if (isNoteName(word)) return { midi: noteToMidi(word) + transpose };
  return { name: word };
}
