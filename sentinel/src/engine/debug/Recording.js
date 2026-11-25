// Records the inputs the page feeds the simulation, and plays recordings back. A recording is the document
// `tools/sim.mjs --script` replays in Node:
//
//   { seed, script, startTick, endTick, endHash, from? }
//
// `from` (the snapshot the recording started on) is present only when it did not start on a fresh Sim, so a
// recording made from a restart is exactly the `{ seed, script }` the CLI has always read. Pure (no DOM).
import { InputRecorder, expandScript, validateScript, scriptLength } from '../../sim/replay.js';
import { snapshotHash } from '../../sim/hash.js';

/** @typedef {{ seed: number|string, script: import('../../sim/replay.js').InputScript, startTick: number, endTick: number,
 *   endHash: string, from?: object }} RecordingDoc */

export class InputRecording {
  /**
   * Start recording from the sim's current state.
   * @param {import('../../sim/Sim.js').Sim} sim
   * @param {{ fresh?: boolean }} [opts] fresh: the sim was just created from its seed (no `from` needed)
   */
  constructor(sim, { fresh = false } = {}) {
    this.seed = sim.seed;
    this.startTick = sim.tick;
    this.from = fresh ? null : sim.snapshot();
    this.recorder = new InputRecorder();
    this.sim = sim;
    this.endHash = '';
  }

  /** ticks recorded so far */
  get ticks() {
    return this.recorder.ticks;
  }

  /** call with the input of every `sim.step` while recording */
  push(input) {
    this.recorder.push(input);
  }

  /**
   * The recording as a JSON-ready document.
   * @returns {RecordingDoc}
   */
  toJSON() {
    const doc = {
      seed: this.seed, script: this.recorder.script(), startTick: this.startTick,
      endTick: this.startTick + this.recorder.ticks, endHash: snapshotHash(this.sim),
    };
    if (this.from) doc.from = this.from;
    return doc;
  }
}

/**
 * Check a recording (or a bare script array) and normalise it to a RecordingDoc-like object.
 * @param {*} doc
 * @returns {{ seed: number|string, script: object[], from: object|null, endHash: string|null, ticks: number }}
 */
export function readRecording(doc) {
  const script = Array.isArray(doc) ? doc : doc?.script;
  validateScript(script);
  const from = !Array.isArray(doc) && doc.from ? doc.from : null;
  const seed = from ? from.seed : !Array.isArray(doc) && doc.seed !== undefined ? doc.seed : 1;
  return { seed, script, from, endHash: (!Array.isArray(doc) && doc.endHash) || null, ticks: scriptLength(script) };
}

/** Feeds a script to the page one tick at a time, in place of the live input. */
export class ScriptPlayer {
  /** @param {import('../../sim/replay.js').InputScript} script */
  constructor(script) {
    this.total = scriptLength(validateScript(script));
    this.iter = expandScript(script);
    this.played = 0;
    this.done = this.total === 0;
  }

  /** @returns {object|null} the next tick's input, or null once the script has run out */
  next() {
    if (this.done) return null;
    const r = this.iter.next();
    if (r.done) { this.done = true; return null; }
    this.played++;
    if (this.played >= this.total) this.done = true;
    return r.value;
  }
}
