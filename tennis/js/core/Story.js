/**
 * Story.js - the single guided story of the MVP (guideline section 8 Phase 4).
 *
 * One question, four steps. Each step is a complete filter state of the real dashboard
 * (defaults + `patch`, applied in one setFilters call) plus a headline computed LIVE from the
 * whole dataset: every number carries N and a 95% Wilson interval, and the one difference
 * carries a Newcombe interval (guideline section 2, Cairo row). The steps walk Shneiderman's
 * mantra: overview first (step 1), then filter (steps 2-4); hovering any mark gives details.
 *
 * Pure module: no DOM, no D3 (runs in Node; tests/story.test.js).
 *
 * @module core/Story
 */

import { proportion, newcombeDiff } from "./StatsEngine.js";
import { createInitialFilterState, encodeFilterStateToQuery, SET_FILTER_KEYS } from "./StateStore.js";
import { RALLY_CAP } from "./DataAdapter.js";

const deep = (p) => p.returnDepth === "Deep" || p.returnDepth === "VeryDeep";
const short = (p) => p.rallyLength <= 4;
const unreturned = (p) => p.returnDepth === "Unreturned";
const all = () => true;

/** @param {number} x proportion */
const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "n/a");
/** @param {number} n */
const int = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "n/a");
/**
 * "65.4% of 321,393 points (95% range 65.2–65.6%)": the rate, the number of points behind it and
 * its 95% Wilson interval in plain words.
 * @param {import("./StatsEngine.js").Prop} a
 */
const est = (a) => (a.n > 0
  ? `${pct(a.p)} of ${int(a.n)} points (95% range ${pct(a.low)}–${pct(a.high)})`
  : "n/a (no points)");
/** @param {number} d proportion difference -> unsigned percentage points, one decimal */
const pts = (d) => `${Math.abs(d * 100).toFixed(1)}`;
/**
 * "1.4 percentage points lower (95% range 0.9 to 1.9 lower)" from a Newcombe difference.
 * @param {{ d: number, low: number, high: number }} diff
 * @returns {string}
 */
const diffText = (diff) => {
  if (![diff.d, diff.low, diff.high].every(Number.isFinite)) return "a difference we cannot estimate";
  const dir = diff.d < 0 ? "lower" : "higher";
  const range = diff.low * diff.high > 0
    ? `${pts(Math.min(Math.abs(diff.low), Math.abs(diff.high)))} to ${pts(Math.max(Math.abs(diff.low), Math.abs(diff.high)))} ${dir}`
    : `from ${pts(diff.low)} lower to ${pts(diff.high)} higher`;
  return `${pts(diff.d)} percentage points ${dir} (95% range ${range})`;
};

/**
 * @typedef {object} StoryStep
 * @property {string} id
 * @property {string} title       short step title
 * @property {string} text        plain-language explanation (tennis terms explained)
 * @property {object} patch       filter patch on top of the default state
 * @property {string[]} focus     views the step is about ("court" | "dag" | "rally")
 * @property {Array<{ include: (p: object) => boolean }>} groups  point groups measured (server win share)
 * @property {(m: import("./StatsEngine.js").Prop[]) => string} headline  sentence built from the measured groups
 */

/** @type {{ question: string, steps: ReadonlyArray<StoryStep> }} */
export const STORY = Object.freeze({
  question: "When does the server lose their advantage?",
  steps: Object.freeze([
    {
      id: "overview",
      title: "Serving is an advantage",
      text: "The bottom chart sorts every point by how many shots were played. Its top panel shows the share of points the server won, with its likely range shaded; the bars underneath show how many points there were. The server's share is high for short points and sinks towards 50% as rallies get longer.",
      patch: {},
      focus: ["rally"],
      groups: [{ include: all }],
      headline: ([a]) => `The player serving won ${est(a)}.`,
    },
    {
      id: "unreturned",
      title: "When the serve is not returned",
      text: "About a third of all points end without a return in play: aces, serves the returner touches but cannot get back, and double faults (which the server loses). They are the strip above the net on the court and the 'Not returned' block in the middle chart.",
      patch: { selectedReturnDepths: ["Unreturned"] },
      focus: ["court", "dag"],
      groups: [{ include: unreturned }],
      headline: ([a]) => `When the serve was not returned, the server won ${est(a)}.`,
    },
    {
      id: "deep-short",
      title: "When the return lands deep",
      text: "A deep return lands in the back half of the court, close to the server's baseline: the two bottom rows of the court. Here we keep short points (1 to 4 shots) that started with a deep return.",
      patch: { selectedReturnDepths: ["Deep", "VeryDeep"], rallyRangeBrush: [1, 4] },
      focus: ["court", "rally"],
      groups: [{ include: (p) => short(p) }, { include: (p) => short(p) && deep(p) }],
      headline: ([allShort, deepShort]) => `After a deep return the server won only ${est(deepShort)}, against ${pct(allShort.p)} of all short points: the edge is gone.`,
    },
    {
      id: "deep-long",
      title: "Longer rallies barely change it",
      text: "Same deep returns, now in rallies of five shots or more. If long rallies wore the server down, this share would fall well below the one in the previous step. It hardly moves, because the deep return had already taken the advantage. The data shows what tends to happen together, not proof of cause.",
      patch: { selectedReturnDepths: ["Deep", "VeryDeep"], rallyRangeBrush: [5, RALLY_CAP] },
      focus: ["rally", "court"],
      groups: [{ include: (p) => !short(p) && deep(p) }, { include: (p) => short(p) && deep(p) }],
      headline: ([long, shortDeep]) => {
        const d = newcombeDiff(long, shortDeep);
        return `In rallies of 5+ shots after a deep return, the server won ${est(long)}: just ${diffText(d)} than in short ones.`;
      },
    },
  ].map((step) => Object.freeze(step))),
});

/**
 * Server-win proportion of each group (Wilson 95% interval), counted in one pass.
 * @param {ReadonlyArray<{ serverWon: boolean }>} points
 * @param {ReadonlyArray<{ include: (p: object) => boolean }>} groups
 * @returns {import("./StatsEngine.js").Prop[]}
 */
export function measureGroups(points, groups) {
  const counts = groups.map(() => ({ w: 0, n: 0 }));
  for (const point of points) {
    for (let i = 0; i < groups.length; i += 1) {
      if (!groups[i].include(point)) continue;
      counts[i].n += 1;
      if (point.serverWon) counts[i].w += 1;
    }
  }
  return counts.map(({ w, n }) => proportion(w, n));
}

/**
 * Live headline of a step over a point array.
 * @param {StoryStep} step
 * @param {ReadonlyArray<object>} points
 * @returns {string}
 */
export function stepHeadline(step, points) {
  return step.headline(measureGroups(points, step.groups));
}

/**
 * Complete filter state a step produces (defaults + patch); hoveredElement left out.
 * @param {StoryStep} step
 * @returns {object}
 */
export function stepFilterState(step) {
  const s = createInitialFilterState();
  delete s.hoveredElement;
  for (const [key, value] of Object.entries(step.patch)) {
    if (SET_FILTER_KEYS.includes(key)) s[key] = new Set(value);
    else if (key === "rallyRangeBrush") s[key] = [value[0], value[1]];
    else s[key] = value;
  }
  return s;
}

/**
 * Index of the step whose filter state equals `state` (every persistent key), or -1.
 * `preferred` wins when several steps share a state.
 * @param {object} state store.getState()
 * @param {number} [preferred]
 * @returns {number}
 */
export function matchingStep(state, preferred = -1) {
  const key = encodeFilterStateToQuery(state);
  const keys = STORY.steps.map((step) => encodeFilterStateToQuery(stepFilterState(step)));
  if (preferred >= 0 && keys[preferred] === key) return preferred;
  return keys.indexOf(key);
}
