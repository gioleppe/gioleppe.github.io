// Input scripts: a whole play session as a compact, JSON-serialisable, run-length list of inputs, so a run
// recorded in the page (or written by hand, or by a bot) replays tick for tick in Node and in the page.
//
//   [{ ticks: 120, input: { moveX: 1 } }, { ticks: 1, input: { interact: true } }, { ticks: 30 }]
//
// Each step holds `input` for `ticks` consecutive ticks (an integer >= 1). `input` lists only the fields that
// differ from `emptyInput()`; a missing `input` is the empty input. A one-tick action (interact, useItem,
// toggleLight, hotbar) in a step of several ticks is pressed on every one of those ticks, exactly as recorded.

import { INPUT_FIELDS, emptyInput, sanitizeInput } from './input.js';

/** @typedef {{ ticks: number, input?: Partial<import('./input.js').InputState> }} ScriptStep */
/** @typedef {ScriptStep[]} InputScript */

/** Thrown for a malformed script; the message names the offending step and field. */
export class ScriptError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScriptError';
  }
}

const BOOL_FIELDS = new Set(['sprint', 'crouch', 'interact', 'useItem', 'toggleLight', 'drop']);
const KNOWN = new Set(INPUT_FIELDS);
const EMPTY = Object.freeze(emptyInput());

const show = (v) => (typeof v === 'number' || typeof v === 'boolean' || v === null ? String(v) : v === undefined ? 'undefined' : JSON.stringify(v));

/**
 * Check one partial input; throws ScriptError naming `where`.
 * @param {*} input
 * @param {string} where e.g. 'script[3].input'
 */
export function validateInput(input, where = 'input') {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new ScriptError(`${where}: expected an object, got ${show(input)}`);
  for (const [k, v] of Object.entries(input)) {
    const at = `${where}.${k}`;
    if (!KNOWN.has(k)) throw new ScriptError(`${at}: unknown input field (known: ${INPUT_FIELDS.join(', ')})`);
    if (k === 'moveX' || k === 'moveY') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < -1 || v > 1) throw new ScriptError(`${at}: expected a number in -1..1, got ${show(v)}`);
    } else if (BOOL_FIELDS.has(k)) {
      if (typeof v !== 'boolean') throw new ScriptError(`${at}: expected true or false, got ${show(v)}`);
    } else if (k === 'hotbar') {
      if (!Number.isInteger(v) || v < -1) throw new ScriptError(`${at}: expected an integer slot >= 0 or -1, got ${show(v)}`);
    } else if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) {   // aimX, aimY
      throw new ScriptError(`${at}: expected a finite number or null, got ${show(v)}`);
    }
  }
  const hasX = input.aimX !== undefined && input.aimX !== null;
  const hasY = input.aimY !== undefined && input.aimY !== null;
  if (hasX !== hasY) throw new ScriptError(`${where}: aimX and aimY must be given together`);
}

/**
 * Check a whole script; throws ScriptError for the first problem.
 * @param {*} script
 * @returns {InputScript} the same script
 */
export function validateScript(script) {
  if (!Array.isArray(script)) throw new ScriptError(`script: expected an array of { ticks, input } steps, got ${show(script)}`);
  script.forEach((step, i) => {
    const where = `script[${i}]`;
    if (step === null || typeof step !== 'object' || Array.isArray(step)) throw new ScriptError(`${where}: expected { ticks, input }, got ${show(step)}`);
    for (const k of Object.keys(step)) if (k !== 'ticks' && k !== 'input') throw new ScriptError(`${where}.${k}: unknown step field (a step has ticks and input)`);
    if (!Number.isInteger(step.ticks) || step.ticks < 1) throw new ScriptError(`${where}.ticks: expected an integer >= 1, got ${show(step.ticks)}`);
    if (step.input !== undefined) validateInput(step.input, `${where}.input`);
  });
  return script;
}

/** @param {InputScript} script validated @returns {number} total ticks */
export function scriptLength(script) {
  let n = 0;
  for (const s of script) n += s.ticks;
  return n;
}

/**
 * A full input from a partial one: unset fields from `emptyInput()`. A fresh object every call.
 * @param {Partial<import('./input.js').InputState>} [partial]
 * @returns {import('./input.js').InputState}
 */
export function fullInput(partial) {
  return partial ? { ...emptyInput(), ...partial } : emptyInput();
}

/**
 * Only the fields of a full input that differ from `emptyInput()` (-0 counts as 0), in INPUT_FIELDS order.
 * @param {import('./input.js').InputState} input
 * @returns {Partial<import('./input.js').InputState>}
 */
export function compactInput(input) {
  const out = {};
  for (const k of INPUT_FIELDS) {
    const v = input[k];
    if (v !== EMPTY[k] && v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * One full input per tick, in order; a fresh object each tick, so the consumer may keep or change it.
 * The script is validated right away (not on the first `next()`), so a bad script fails where it is passed.
 * @param {InputScript} script
 * @returns {Generator<import('./input.js').InputState>}
 */
export function expandScript(script) {
  validateScript(script);
  return expandSteps(script);
}

function* expandSteps(script) {
  for (const step of script) {
    for (let t = 0; t < step.ticks; t++) yield fullInput(step.input);
  }
}

const sameInput = (a, b) => {
  for (const k of INPUT_FIELDS) if (a[k] !== b[k]) return false;
  return true;
};

/**
 * Builds a script from a stream of per-tick inputs, merging equal consecutive ticks. Each input is sanitised
 * first (what the simulation really sees, so the replay is exact) and -0 is stored as 0 (JSON cannot keep it).
 * Use one in the page to record a session: `rec.push(input)` next to every `sim.step(input)`.
 */
export class InputRecorder {
  constructor() {
    /** @type {InputScript} */
    this.steps = [];
    /** ticks recorded */
    this.ticks = 0;
    this.last = null;
  }

  /** @param {Partial<import('./input.js').InputState>} input the input given to one `sim.step` */
  push(input) {
    const clean = sanitizeInput(input);
    if (clean.moveX === 0) clean.moveX = 0;   // turns -0 into 0
    if (clean.moveY === 0) clean.moveY = 0;
    if (this.last && sameInput(this.last, clean)) {
      this.steps[this.steps.length - 1].ticks++;
    } else {
      const compact = compactInput(clean);
      this.steps.push(Object.keys(compact).length ? { ticks: 1, input: compact } : { ticks: 1 });
      this.last = clean;
    }
    this.ticks++;
  }

  /** @returns {InputScript} a deep copy of the script so far */
  script() {
    return this.steps.map((s) => (s.input ? { ticks: s.ticks, input: { ...s.input } } : { ticks: s.ticks }));
  }
}

/**
 * Record a whole stream at once.
 * @param {Iterable<Partial<import('./input.js').InputState>>} inputs one per tick
 * @returns {InputScript}
 */
export function recordInput(inputs) {
  const rec = new InputRecorder();
  for (const i of inputs) rec.push(i);
  return rec.script();
}
