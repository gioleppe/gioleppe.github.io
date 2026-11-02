/**
 * scales.js - shared D3 scale factories and animation constants for the
 * Phase 3 views (docs/api_contract.md "Shared scales").
 *
 * This module deliberately does NOT import D3: every factory receives the D3
 * namespace as an argument (`ctx.d3` in the views) so that the pure helpers
 * (`signedPp`, `hatchPatternId`, `TRANSITION_MS`) stay importable from Node
 * unit tests, where the CDN ESM build is unavailable. Views import D3 at their
 * own module top and pass it in. Pure geometry helpers live in ./layout.js.
 *
 * @module views/scales
 */

import { PALETTE, winRateStops } from "../core/palette.js";

/**
 * Duration of every filter-driven transition, in milliseconds
 * (guideline section 6.2 / section 8 Phase 3.1). Hover never transitions.
 * @type {number}
 */
export const TRANSITION_MS = 300;

/**
 * Diverging server win-efficiency color scale (guideline section 5.1, Ware):
 * `d3.scaleLinear()` over [0.30, 0.40, 0.50, 0.60, 0.70] onto
 * `PALETTE.winRateDiverging`, interpolated in CIELAB and clamped, so that
 * 0.50 maps exactly to the neutral parity stop.
 * @param {typeof import("d3")} d3 the D3 v7 namespace
 * @returns {import("d3").ScaleLinear<string, string>}
 */
export function createWinRateColorScale(d3) {
  const stops = winRateStops();
  return d3
    .scaleLinear()
    .domain(stops.map((s) => s.value))
    .range(PALETTE.winRateDiverging.slice())
    .interpolate(d3.interpolateLab)
    .clamp(true);
}

/**
 * Id of the low-sample diagonal hatch `<pattern>` for a theme. The pattern
 * itself is defined once by CourtMapView inside its `<defs>`; other views only
 * reference it as `url(#id)`.
 * @param {"dark"|"light"} theme
 * @returns {string} e.g. "tva-hatch-dark"
 */
export function hatchPatternId(theme) {
  return `tva-hatch-${theme === "light" ? "light" : "dark"}`;
}

/**
 * Format a win-rate delta (difference of two proportions in [0, 1]) as signed
 * percentage points, e.g. 0.032 -> "+3.2 pp", -0.015 -> "-1.5 pp", 0 -> "+0.0 pp".
 * Non-finite input (NaN / Infinity / undefined) yields "n/a".
 * @param {number} delta  rate difference (subset - baseline)
 * @param {number} [digits=1] decimal digits
 * @returns {string}
 */
export function signedPp(delta, digits = 1) {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return "n/a";
  let s = (delta * 100).toFixed(digits);
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1); // normalise "-0.0" -> "0.0"
  return `${s.startsWith("-") ? "" : "+"}${s} % pts`;
}
