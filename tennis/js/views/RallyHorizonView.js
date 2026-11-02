/**
 * RallyHorizonView.js - View 3: who wins as rallies get longer
 * (implementation_guideline.md section 4.3, section 8 Phase 3.4; api_contract.md
 * "Phase 3 shared conventions").
 *
 * The x axis shows rally lengths in PAIRS (1–2, 3–4, ..., 11–12, 13+; snapshot.viewModels.rally.pairs):
 * MCP counts the final error as a shot, so exact lengths alternate between server and returner
 * endings and the win rate zig-zags for recording reasons alone (guideline section 4.3).
 *
 * Two panels share the x axis (small multiples instead of a dual-axis chart, whose two
 * independent scales invite false readings such as "the 50% line meets the zero line"):
 *  - TOP, the message: the share of points won by the server per pair, as position on a common
 *    scale from just below the lowest 95% bound (at most 30 %) to 100 % (a line is read by
 *    position, so the scale need not start at zero; bars below it do), with its Wilson 95 % band, a dashed 50 % line and a "clearly below 50%"
 *    marker on the first pair whose whole 95 % range lies under 50 % inside the brush. With a
 *    View 1 / View 2 selection, a dotted line shows the same pairs without the selection.
 *  - BOTTOM, the context: how many points each pair holds (plain bars from zero, one colour).
 *    The split into winners and errors is details-on-demand (tooltip), not stacked segments.
 * Every series is labelled directly (panel titles and line-end labels); there is no legend box.
 * A d3.brushX layer spans both panels, snaps to whole pairs and is synchronised with the store's
 * `rallyRangeBrush` and with the quick-select pills above the chart.
 *
 * The viewBox tracks the panel body 1:1 (ResizeObserver) so text renders at native size.
 * Filter changes animate with 300 ms d3.easeCubicOut transitions; hover changes and resizes
 * never transition.
 *
 * @module RallyHorizonView
 */

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { LOW_SAMPLE_THRESHOLD, computeDeltaVsBaseline, formatPct } from "../core/StatsEngine.js";
import { RALLY_CAP } from "../core/DataAdapter.js";
import { TRANSITION_MS } from "./scales.js";

/** Default viewBox size, used until the panel has been measured. */
const DEFAULT_W = 1400;
const DEFAULT_H = 330;
/** Lower bounds of the viewBox so the plot never collapses in a tiny container. */
const MIN_W = 320;
const MIN_H = 220;
/** Margins; the top margin holds the top panel's title and the "clearly below 50%" label. */
const MARGIN = Object.freeze({ top: 44, right: 78, bottom: 40, left: 64 });
/** Vertical gap between the two panels (holds the bottom panel's title). */
const PANEL_GAP = 26;
/** Share of the plot height given to the top (win share) panel. */
const TOP_SHARE = 0.68;

/** Opacity of bars outside the brushed range. */
const DIM_OPACITY = 0.3;

/**
 * Codes of the paired rally buckets drawn on the x axis: the first length of each pair
 * (1 = "1–2", 3 = "3–4", ..., 13 = "13+").
 */
const RALLY_CODES = Object.freeze(Array.from({ length: Math.ceil(RALLY_CAP / 2) }, (_, i) => 2 * i + 1));

/** Last rally length of the pair starting at `r`. @param {number} r */
const pairEnd = (r) => Math.min(r + 1, RALLY_CAP);
/** First rally length of the pair containing exact length `r`. @param {number} r */
const pairStart = (r) => (r >= RALLY_CAP ? RALLY_CAP : r - ((r - 1) % 2));

/** How each point ended (tooltip rows, details on demand). */
const OUTCOMES = Object.freeze([
  { key: "serverWinner", label: "Server hit a winner" },
  { key: "serverInducedErr", label: "Returner missed" },
  { key: "returnerWinner", label: "Returner hit a winner" },
  { key: "returnerInducedErr", label: "Server missed" },
]);

/**
 * Quick-select pills (guideline section 8 Phase 3.4). Ranges are inclusive rally
 * lengths; the last pill ends at RALLY_CAP ("13+").
 * @type {ReadonlyArray<{ id: string, label: string, range: [number, number] }>}
 */
const PILLS = Object.freeze([
  { id: "all", label: "All", range: [1, RALLY_CAP] },
  { id: "1-4", label: "1–4 shots", range: [1, 4] },
  { id: "5-8", label: "5–8 shots", range: [5, 8] },
  { id: "9+", label: "9+ shots", range: [9, RALLY_CAP] },
]);

const fmtCount = d3.format(",");
const fmtPct0 = d3.format(".0%");
const fmtCompact = (n) => (Math.abs(n) >= 1000 ? `${d3.format(",")(Math.round(n / 1000))}k` : d3.format(",")(n));

/**
 * Human label for an exact rally length ("1".."12", "13+").
 * @param {number} r
 * @returns {string}
 */
function labelOf(r) {
  return r >= RALLY_CAP ? `${RALLY_CAP}+` : String(r);
}

/**
 * Axis label of the pair starting at `r` ("1–2", ..., "13+").
 * @param {number} r
 * @returns {string}
 */
function pairLabel(r) {
  return r >= RALLY_CAP ? `${RALLY_CAP}+` : `${r}–${pairEnd(r)}`;
}

/**
 * Inclusive range equality.
 * @param {[number, number]|null|undefined} a
 * @param {[number, number]|null|undefined} b
 * @returns {boolean}
 */
function sameRange(a, b) {
  return Boolean(a && b) && a[0] === b[0] && a[1] === b[1];
}

/**
 * Create View 3.
 *
 * @param {HTMLElement} bodyEl  the `.tva-view__body` element of the rally section
 * @param {{ store: import("../core/StateStore.js").StateStore,
 *           tooltip: { show: Function, move: Function, hide: Function },
 *           getTheme: () => ("dark"|"light"), d3?: object }} ctx
 *   `ctx.store` is read at event time.
 * @returns {{ update(snapshot: object, change: object): void, destroy(): void }}
 */
export function createRallyHorizonView(bodyEl, ctx) {
  if (!bodyEl || typeof bodyEl.appendChild !== "function") {
    throw new TypeError("createRallyHorizonView: bodyEl must be a DOM element");
  }
  if (!ctx || !ctx.store) throw new TypeError("createRallyHorizonView: ctx.store is required");

  // ---- geometry (mutable: follows the panel size) -------------------------
  let viewW = DEFAULT_W;
  let viewH = DEFAULT_H;
  let plotW = viewW - MARGIN.left - MARGIN.right;
  let plotH = viewH - MARGIN.top - MARGIN.bottom;
  let topH = Math.round((plotH - PANEL_GAP) * TOP_SHARE);
  let measuredW = 0;
  let measuredH = 0;

  // ---- scales ------------------------------------------------------------
  const x = d3.scaleBand().domain(RALLY_CODES).range([0, plotW]).paddingInner(0.25).paddingOuter(0.2);
  /** Top panel: share won by the server, 0-100 %. */
  const yRate = d3.scaleLinear().domain([0, 1]).range([topH, 0]);
  /** Bottom panel: number of points, from zero. */
  const yN = d3.scaleLinear().domain([0, 1]).range([plotH, topH + PANEL_GAP]);
  /** Band centre of a pair code. @param {number} r */
  const xc = (r) => x(r) + x.bandwidth() / 2;

  const lineGen = d3.line().x((d) => xc(d.r)).y((d) => yRate(d.rawRate)).curve(d3.curveMonotoneX);
  const contextGen = d3.line().x((d) => xc(d.r)).y((d) => yRate(d.contextRate)).curve(d3.curveMonotoneX);
  const areaGen = d3.area().x((d) => xc(d.r)).y0((d) => yRate(d.ci.low)).y1((d) => yRate(d.ci.high)).curve(d3.curveMonotoneX);

  // ---- local state -------------------------------------------------------
  let lastSnapshot = null;
  let buckets = [];
  let hoveredR = null;
  let brushing = false;
  let movingBrush = false;
  let destroyed = false;

  // ---- DOM skeleton ------------------------------------------------------
  const root = d3.select(bodyEl).append("div").attr("class", "tva-rally");

  const toolbar = root.append("div").attr("class", "tva-rally__toolbar");
  const pillBar = toolbar.append("div").attr("class", "tva-rally__pills").attr("role", "group")
    .attr("aria-label", "Rally length quick select");
  const rangeReadout = toolbar.append("span").attr("class", "tva-rally__range").attr("aria-live", "polite");

  pillBar.selectAll("button.tva-pill").data(PILLS, (d) => d.id).join("button")
    .attr("class", "tva-pill")
    .attr("type", "button")
    .attr("data-range", (d) => `${d.range[0]}-${d.range[1]}`)
    .text((d) => d.label)
    .on("click", (event, d) => {
      const store = ctx.store;
      if (!sameRange(store.getState().rallyRangeBrush, d.range)) store.setRallyRange([d.range[0], d.range[1]]);
    });

  const svg = root.append("svg")
    .attr("class", "tva-rally__svg")
    .attr("viewBox", `0 0 ${viewW} ${viewH}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("role", "img")
    .attr("aria-label", "Top: share of points won by the server for each rally length, with its 95% range. Bottom: number of points for each rally length.");

  svg.append("title").text("Who wins as rallies get longer");

  const plot = svg.append("g").attr("class", "tva-rally__plot");

  const text = (parent, cls, size = 11) => parent.append("text").attr("class", cls)
    .attr("font-size", size).attr("font-family", "var(--tva-font)").attr("pointer-events", "none");

  // Layer order (bottom -> top): highlight, panel titles, bars, zero line, CI band, parity,
  // context line, rate line, points, direct labels, annotation, hit rects, brush.
  const highlightRect = plot.append("rect").attr("class", "tva-rally__highlight")
    .attr("y", 0)
    .attr("fill", "var(--tva-accent)").attr("fill-opacity", 0.1).attr("rx", 3)
    .attr("pointer-events", "none").style("display", "none");

  const topTitle = text(plot, "tva-rally__panel-title", 12).attr("font-weight", 600).attr("fill", "var(--tva-text)");
  topTitle.append("tspan").text("Share of points won by the server");
  const topTitleNote = topTitle.append("tspan").attr("fill", "var(--tva-text-2)").attr("font-weight", 400);
  const bottomTitle = text(plot, "tva-rally__panel-title", 12).attr("font-weight", 600).attr("fill", "var(--tva-text)")
    .text("Number of points");

  const barsLayer = plot.append("g").attr("class", "tva-rally__bars");

  const baseline = plot.append("line").attr("class", "tva-rally__zero")
    .attr("x1", 0)
    .attr("stroke", "var(--tva-text-2)").attr("stroke-width", 1).attr("pointer-events", "none");

  const ciPath = plot.append("path").attr("class", "tva-rally__ci")
    .attr("fill", "var(--tva-mark)").attr("fill-opacity", 0.32).attr("stroke", "none")
    .attr("pointer-events", "none");

  const parityLine = plot.append("line").attr("class", "tva-rally__parity")
    .attr("x1", 0)
    .attr("stroke", "var(--tva-text)").attr("stroke-width", 1.25)
    .attr("stroke-dasharray", "6 4").attr("opacity", 0.6).attr("pointer-events", "none");
  // End label of the parity line, in the right margin (never over the last bar).
  const parityLabel = text(plot, "tva-rally__parity-label", 12)
    .attr("text-anchor", "start").attr("dy", "0.35em").attr("font-weight", 600)
    .attr("fill", "var(--tva-text)").attr("opacity", 0.85)
    .text("50%: even");

  const contextPath = plot.append("path").attr("class", "tva-rally__context")
    .attr("fill", "none").attr("stroke", "var(--tva-text-2)").attr("stroke-width", 1.75)
    .attr("stroke-dasharray", "1 4").attr("stroke-linecap", "round")
    .attr("pointer-events", "none").attr("opacity", 0);

  const ratePath = plot.append("path").attr("class", "tva-rally__rate")
    .attr("fill", "none").attr("stroke", "var(--tva-text)").attr("stroke-width", 2.5)
    .attr("stroke-linejoin", "round").attr("stroke-linecap", "round").attr("pointer-events", "none");

  const pointsLayer = plot.append("g").attr("class", "tva-rally__points").attr("pointer-events", "none");
  /** Direct label of the rate line: the last pair's value, at the line's right end. */
  const rateEndLabel = text(plot, "tva-rally__rate-label", 12).attr("font-weight", 700).attr("fill", "var(--tva-text)")
    .attr("dy", "0.35em");
  const annotationLayer = plot.append("g").attr("class", "tva-rally__annotation").attr("pointer-events", "none");
  const hitsLayer = plot.append("g").attr("class", "tva-rally__hits");
  const brushG = plot.append("g").attr("class", "tva-rally__brush tva-brush");

  // ---- axes --------------------------------------------------------------
  const axisRateG = svg.append("g").attr("class", "tva-rally__axis tva-rally__axis--left");
  const axisCountG = svg.append("g").attr("class", "tva-rally__axis tva-rally__axis--count");
  const axisBottomG = svg.append("g").attr("class", "tva-rally__axis tva-rally__axis--bottom");
  const bottomAxisLabel = text(svg, "tva-rally__axis-label", 11).attr("fill", "var(--tva-text-2)")
    .attr("text-anchor", "middle").text("Shots in the point (grouped in pairs)");

  const axisRate = d3.axisLeft(yRate).ticks(4).tickSizeOuter(0).tickFormat(fmtPct0);
  const axisCount = d3.axisLeft(yN).ticks(3).tickSizeOuter(0).tickFormat(fmtCompact);
  const axisBottom = d3.axisBottom(x).tickSizeOuter(0).tickFormat(pairLabel);

  /** Apply theme-aware chrome colours to a rendered axis group. @param {d3.Selection} g */
  function styleAxis(g) {
    g.attr("color", "var(--tva-text-2)").attr("font-family", "var(--tva-font)").attr("font-size", 11);
    g.selectAll("path.domain").attr("stroke", "var(--tva-border)");
    g.selectAll(".tick line").attr("stroke", "var(--tva-border)");
    g.selectAll(".tick text").attr("fill", "var(--tva-text-2)").attr("font-size", 11)
      .attr("font-family", "var(--tva-font)");
  }

  // ---- brush ---------------------------------------------------------------
  const brush = d3.brushX().extent([[0, 0], [plotW, plotH]]).handleSize(8)
    .on("start", onBrushStart).on("brush", onBrushMove).on("end", onBrushEnd);
  // The brush overlay covers both panels, so ALL pointer hover is routed through it to the
  // pair under the pointer; the hit rects exist for keyboard users only (focus / Enter).
  brushG.on("pointermove.hover", onPlotPointerMove).on("pointerleave.hover", onPlotPointerLeave);

  /** (Re)attach the brush to its group and style its parts from CSS variables. */
  function mountBrush() {
    brushG.call(brush);
    brushG.select(".selection")
      .attr("fill", "var(--tva-accent)").attr("fill-opacity", 0.1)
      .attr("stroke", "var(--tva-accent)").attr("stroke-width", 1);
    brushG.select(".overlay").attr("cursor", "crosshair");
  }

  /**
   * Apply a viewBox size: scales, static chrome, brush extent. No transitions.
   * @param {number} w  panel width in CSS px
   * @param {number} h  panel height in CSS px
   */
  function applyGeometry(w, h) {
    viewW = Math.max(MIN_W, Math.round(w));
    viewH = Math.max(MIN_H, Math.round(h));
    plotW = viewW - MARGIN.left - MARGIN.right;
    plotH = Math.max(80, viewH - MARGIN.top - MARGIN.bottom);
    topH = Math.round((plotH - PANEL_GAP) * TOP_SHARE);
    x.range([0, plotW]);
    yRate.range([topH, 0]);
    yN.range([plotH, topH + PANEL_GAP]);

    svg.attr("viewBox", `0 0 ${viewW} ${viewH}`);
    plot.attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
    highlightRect.attr("height", plotH).attr("width", x.bandwidth() + 8);
    topTitle.attr("x", 0).attr("y", -28);
    // Narrow screens: the explanatory note would overflow the title line.
    topTitleNote.style("display", plotW < 560 ? "none" : null);
    bottomTitle.attr("x", 0).attr("y", topH + PANEL_GAP - 8);
    baseline.attr("x2", plotW).attr("y1", plotH).attr("y2", plotH);
    parityLine.attr("x2", plotW).attr("y1", yRate(0.5)).attr("y2", yRate(0.5));
    parityLabel.attr("x", plotW + 8).attr("y", yRate(0.5));
    axisRateG.attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
    axisCountG.attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
    axisBottomG.attr("transform", `translate(${MARGIN.left},${MARGIN.top + plotH})`);
    bottomAxisLabel.attr("x", MARGIN.left + plotW / 2).attr("y", viewH - 4);
    hitsLayer.selectAll("rect.tva-rally__hit").attr("height", plotH);
    brush.extent([[0, 0], [plotW, plotH]]);
    mountBrush();
  }

  /**
   * Re-apply the geometry when the measured size changed.
   * @param {number} w
   * @param {number} h
   * @returns {boolean} whether the geometry changed
   */
  function resizeTo(w, h) {
    if (!(w > 0) || !(h > 0)) return false;
    if (Math.abs(w - measuredW) < 0.5 && Math.abs(h - measuredH) < 0.5) return false;
    measuredW = w;
    measuredH = h;
    applyGeometry(w, h);
    return true;
  }

  {
    let rect = null;
    try { rect = svg.node().getBoundingClientRect(); } catch (err) { rect = null; }
    if (!(rect && resizeTo(rect.width, rect.height))) applyGeometry(DEFAULT_W, DEFAULT_H);
  }

  /** @type {ResizeObserver|null} */
  let resizeObserver = null;
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver((entries) => {
      if (destroyed) return;
      const entry = entries[entries.length - 1];
      const box = entry && entry.contentRect;
      if (!box) return;
      if (resizeTo(box.width, box.height) && lastSnapshot) render(lastSnapshot, { type: "resize", keys: [] });
    });
    resizeObserver.observe(svg.node());
  }

  /**
   * Snap a pixel selection to whole pairs: pairs whose band centre lies inside the selection;
   * an empty hit list snaps to the pair nearest the selection midpoint.
   * @param {[number, number]|null} sel
   * @returns {[number, number]}
   */
  function snapSelection(sel) {
    if (!sel) return [1, RALLY_CAP];
    const [s0, s1] = sel;
    const inside = RALLY_CODES.filter((r) => { const c = xc(r); return c >= s0 && c <= s1; });
    if (inside.length) return [inside[0], pairEnd(inside[inside.length - 1])];
    const mid = (s0 + s1) / 2;
    let best = RALLY_CODES[0];
    let bestD = Infinity;
    for (const r of RALLY_CODES) {
      const dd = Math.abs(xc(r) - mid);
      if (dd < bestD) { bestD = dd; best = r; }
    }
    return [best, pairEnd(best)];
  }

  /**
   * Pixel selection for a rally range, or null for the full range (no brush shown).
   * @param {[number, number]} range
   * @returns {[number, number]|null}
   */
  function selectionFor(range) {
    if (!range || (range[0] <= 1 && range[1] >= RALLY_CAP)) return null;
    return [x(pairStart(range[0])), x(pairStart(range[1])) + x.bandwidth()];
  }

  /**
   * Move the brush programmatically (store -> view), guarded against re-dispatch.
   * @param {[number, number]} range
   * @param {boolean} animate
   */
  function syncBrush(range, animate) {
    if (destroyed) return;
    movingBrush = true;
    try {
      const target = animate
        ? brushG.transition().duration(TRANSITION_MS).ease(d3.easeCubicOut)
        : brushG;
      target.call(brush.move, selectionFor(range));
    } finally {
      movingBrush = false;
    }
  }

  function onBrushStart(event) {
    if (!event.sourceEvent || movingBrush) return;
    brushing = true;
    hoverOut();
  }

  function onBrushMove(event) {
    if (!event.sourceEvent || movingBrush) return;
    const sel = event.selection;
    barsLayer.selectAll("g.tva-rally__bucket").interrupt().attr("opacity", (d) => {
      if (!sel) return 1;
      const c = xc(d.r);
      return c >= sel[0] && c <= sel[1] ? 1 : DIM_OPACITY;
    });
  }

  function onBrushEnd(event) {
    if (!event.sourceEvent || movingBrush) return;
    brushing = false;
    const range = snapSelection(event.selection);
    const store = ctx.store;
    const current = store.getState().rallyRangeBrush;
    if (!sameRange(range, current)) {
      store.setRallyRange(range); // store notifies -> update() -> syncBrush()
    } else {
      syncBrush(range, true);
      barsLayer.selectAll("g.tva-rally__bucket").attr("opacity", (d) => (d.inBrush ? 1 : DIM_OPACITY));
    }
  }

  // ---- hover / tooltip -----------------------------------------------------

  /**
   * Pair whose band step contains the plot-space x coordinate.
   * @param {number} px
   * @returns {object|null}
   */
  function bucketAtX(px) {
    const half = x.step() / 2;
    for (const b of buckets) {
      if (Math.abs(xc(b.r) - px) <= half) return b;
    }
    return null;
  }

  /**
   * Tooltip model for a pair: the standard rows plus how the points ended.
   * @param {object} b
   * @returns {object}
   */
  function tooltipModel(b) {
    const base = lastSnapshot && lastSnapshot.baseline;
    return {
      title: `Points of ${b.label} shots`,
      subtitle: `${fmtCount(b.n)} points`,
      stats: {
        n: b.n,
        wins: b.wins,
        rawRate: b.rawRate,
        smoothedRate: b.smoothedRate,
        ci: b.ci,
        deltaVsBaseline: computeDeltaVsBaseline(b, base),
      },
      rows: OUTCOMES.map((s) => ({ label: s.label, value: fmtCount(b[s.key] || 0) })),
    };
  }

  function hoverIn(event, b) {
    if (!b || destroyed) return;
    if (hoveredR === b.r) {
      if (ctx.tooltip && typeof ctx.tooltip.move === "function") ctx.tooltip.move(event);
      return;
    }
    hoveredR = b.r;
    if (ctx.tooltip && typeof ctx.tooltip.show === "function") ctx.tooltip.show(event, tooltipModel(b));
    ctx.store.setHovered({ view: "rally", kind: "bucket", key: b.label, r: b.r });
  }

  function hoverOut() {
    if (ctx.tooltip && typeof ctx.tooltip.hide === "function") ctx.tooltip.hide();
    if (hoveredR === null) return;
    hoveredR = null;
    const h = ctx.store.getState().hoveredElement;
    if (h && h.view === "rally") ctx.store.setHovered(null);
  }

  function onPlotPointerMove(event) {
    if (brushing || destroyed) return;
    const [px] = d3.pointer(event, plot.node());
    const b = bucketAtX(px);
    if (b) hoverIn(event, b); else hoverOut();
  }

  function onPlotPointerLeave() {
    if (brushing) return;
    hoverOut();
  }

  /**
   * Toggle the hovered-pair highlight (hover change only: no transitions).
   * @param {object|null} hovered state.hoveredElement
   */
  function applyHover(hovered) {
    const r = hovered && hovered.view === "rally" && hovered.kind === "bucket" ? hovered.r : null;
    if (r === null || x(r) === undefined) {
      highlightRect.style("display", "none");
      hitsLayer.selectAll("rect.tva-rally__hit").classed("is-hovered", false);
      return;
    }
    highlightRect.style("display", null).attr("x", x(r) - 4);
    hitsLayer.selectAll("rect.tva-rally__hit").classed("is-hovered", (d) => d.r === r);
  }

  // ---- render ----------------------------------------------------------------

  /**
   * Full re-render on a filter / reset / init / resize change.
   * @param {object} snapshot
   * @param {object} change
   */
  function render(snapshot, change) {
    const rally = snapshot && snapshot.viewModels && snapshot.viewModels.rally;
    if (!rally || !Array.isArray(rally.pairs)) return;
    lastSnapshot = snapshot;
    buckets = rally.pairs;
    const range = rally.brush || snapshot.state.rallyRangeBrush;
    const type = change && change.type;
    const isInit = !change || type === "init";
    const instant = isInit || type === "resize";
    const t = svg.transition().duration(instant ? 0 : TRANSITION_MS).ease(d3.easeCubicOut);

    // -- count axis: from zero to the largest pair, niced
    const maxN = Math.max(1, ...buckets.map((b) => b.n));
    yN.domain([0, maxN]).nice(3);
    // -- rate axis: 100 % down to the lowest 95% bound, floored to 10 %, never above 30 %
    const lows = buckets.filter((b) => b.n > 0 && b.ci && Number.isFinite(b.ci.low)).map((b) => b.ci.low);
    const floor = Math.max(0, Math.min(0.3, Math.floor(Math.min(1, ...lows) * 10) / 10));
    yRate.domain([floor, 1]);
    parityLine.attr("y1", yRate(0.5)).attr("y2", yRate(0.5));
    parityLabel.attr("y", yRate(0.5));

    if (instant) {
      axisCountG.interrupt().selectAll("*").interrupt();
      axisCountG.call(axisCount);
    } else {
      axisCountG.transition(t).call(axisCount);
    }
    styleAxis(axisCountG);
    if (instant) {
      axisRateG.interrupt().selectAll("*").interrupt();
      axisRateG.call(axisRate);
    } else {
      axisRateG.transition(t).call(axisRate);
    }
    styleAxis(axisRateG);
    styleAxis(axisBottomG.call(axisBottom));

    // -- bottom panel: one plain bar per pair (count from zero)
    const bucketG = barsLayer.selectAll("g.tva-rally__bucket").data(buckets, (d) => d.r)
      .join((enter) => {
        const g = enter.append("g").attr("class", "tva-rally__bucket")
          .attr("transform", (d) => `translate(${x(d.r)},0)`)
          .attr("opacity", (d) => (d.inBrush ? 1 : DIM_OPACITY));
        g.append("rect").attr("class", "tva-rally__bar")
          .attr("x", 0).attr("width", x.bandwidth())
          .attr("fill", "var(--tva-mark)").attr("fill-opacity", 0.9)
          .attr("y", yN(0)).attr("height", 0);
        return g;
      });
    bucketG.attr("data-r", (d) => d.r).attr("transform", (d) => `translate(${x(d.r)},0)`);
    bucketG.transition(t).attr("opacity", (d) => (d.inBrush ? 1 : DIM_OPACITY));
    const bars = bucketG.select("rect.tva-rally__bar").attr("width", x.bandwidth());
    (instant ? bars.interrupt() : bars.transition(t))
      .attr("y", (d) => yN(d.n))
      .attr("height", (d) => Math.max(0, yN(0) - yN(d.n)));

    // -- top panel: win-share line + 95% band + markers (pairs with data only)
    const withData = buckets.filter((b) => b.n > 0 && Number.isFinite(b.rawRate));
    const lineD = withData.length ? lineGen(withData) : "";
    const areaD = withData.length ? areaGen(withData) : "";
    if (instant) {
      ratePath.interrupt().attr("d", lineD);
      ciPath.interrupt().attr("d", areaD);
    } else {
      ratePath.transition(t).attr("d", lineD);
      ciPath.transition(t).attr("d", areaD);
    }

    // -- context line (same pairs without the View 1 / View 2 selection), named in the title
    const ctxData = rally.hasSelection
      ? buckets.filter((b) => b.contextN > 0 && Number.isFinite(b.contextRate)) : [];
    const ctxD = ctxData.length ? contextGen(ctxData) : "";
    if (ctxD) contextPath.interrupt().attr("d", ctxD);
    contextPath.transition(t).attr("opacity", ctxD ? 0.95 : 0);
    topTitleNote.text(ctxD
      ? "  · line: your selection · dotted: without it · shaded: 95% range"
      : "  · line with its 95% range (shaded)");

    const pts = pointsLayer.selectAll("circle.tva-rally__point").data(withData, (d) => d.r)
      .join((enter) => enter.append("circle").attr("class", "tva-rally__point")
        .attr("r", 3.5).attr("fill", "var(--tva-text)").attr("stroke", "var(--tva-bg-panel)")
        .attr("stroke-width", 1.5)
        .attr("cx", (d) => xc(d.r)).attr("cy", (d) => yRate(d.rawRate)).attr("opacity", 0));
    pts.transition(t).attr("cx", (d) => xc(d.r)).attr("cy", (d) => yRate(d.rawRate)).attr("opacity", 1);

    // Direct label: the value of the last pair with data, at the line's right end.
    const last = withData[withData.length - 1];
    rateEndLabel.text(last ? formatPct(last.rawRate, 0) : "");
    if (last) {
      // Keep it off the 50% line label in the right margin.
      const ly = yRate(last.rawRate);
      const nudged = Math.abs(ly - yRate(0.5)) < 14 ? ly + (ly <= yRate(0.5) ? -14 : 14) : ly;
      (instant ? rateEndLabel : rateEndLabel.transition(t)).attr("x", xc(last.r) + 10).attr("y", nudged);
    }

    // -- "clearly below 50%" annotation: first pair inside the brush whose whole 95% range
    //    lies below 50% (an estimate that merely dips under 50% is not claimed)
    const crossing = buckets.find((b) => b.inBrush && b.n >= LOW_SAMPLE_THRESHOLD && b.ci && b.ci.high < 0.5) || null;
    const ann = annotationLayer.selectAll("g.tva-rally__crossing").data(crossing ? [crossing] : [], () => "crossing")
      .join((enter) => {
        const g = enter.append("g").attr("class", "tva-rally__crossing").attr("opacity", 0);
        g.append("line").attr("class", "tva-rally__crossing-leader")
          .attr("x1", 0).attr("x2", 0).attr("y1", -6)
          .attr("stroke", "var(--tva-text)").attr("stroke-width", 1).attr("stroke-dasharray", "2 2");
        g.append("path").attr("class", "tva-rally__crossing-marker")
          .attr("d", d3.symbol(d3.symbolTriangle).size(60)())
          .attr("fill", "var(--tva-text)").attr("stroke", "var(--tva-bg-panel)").attr("stroke-width", 1);
        g.append("text").attr("class", "tva-rally__crossing-label")
          .attr("y", -9).attr("font-size", 11).attr("font-weight", 600)
          .attr("font-family", "var(--tva-font)").attr("fill", "var(--tva-text)");
        return g;
      });
    ann.select("text").text((d) => `clearly below 50% from ${d.label} shots`)
      .attr("text-anchor", (d) => (xc(d.r) > plotW - 130 ? "end" : xc(d.r) < 130 ? "start" : "middle"));
    const markerY = (d) => Math.max(8, yRate(d.ci.high) - 12);
    ann.transition(t).attr("opacity", 1).attr("transform", (d) => `translate(${xc(d.r)},0)`);
    ann.select("line.tva-rally__crossing-leader").transition(t).attr("y2", (d) => markerY(d) - 6);
    ann.select("path.tva-rally__crossing-marker").transition(t)
      .attr("transform", (d) => `translate(0,${markerY(d)}) rotate(180)`);

    // -- hit rects (keyboard targets; pointer hover goes through the brush overlay)
    const hits = hitsLayer.selectAll("rect.tva-rally__hit").data(buckets, (d) => d.r)
      .join((enter) => enter.append("rect").attr("class", "tva-rally__hit")
        .attr("y", 0)
        .attr("fill", "transparent").attr("stroke", "none")
        .attr("tabindex", 0).attr("role", "button")
        .on("focus", (event, d) => hoverIn(event, d))
        .on("blur", () => hoverOut())
        .on("keydown", (event, d) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            const store = ctx.store;
            const cur = store.getState().rallyRangeBrush;
            const pair = [d.lo, d.hi];
            store.setRallyRange(sameRange(cur, pair) ? [1, RALLY_CAP] : pair);
          } else if (event.key === "Escape") {
            hoverOut();
          }
        }));
    hits.attr("x", (d) => x(d.r) - x.step() * x.paddingInner() / 2).attr("width", x.step())
      .attr("height", plotH)
      .attr("aria-label", (d) => `Points of ${d.label} shots: ${fmtCount(d.n)} points, server won ${formatPct(d.rawRate)}`)
      .attr("data-r", (d) => d.r);

    // -- pills + readout
    // A pill is pressed when its range IS the brush, "mixed" (covered) when its whole range
    // lies inside a wider brush.
    const pillState = (d) => {
      if (sameRange(d.range, range)) return "true";
      const full = range[0] === 1 && range[1] === RALLY_CAP;
      return !full && d.range[0] >= range[0] && d.range[1] <= range[1] ? "mixed" : "false";
    };
    pillBar.selectAll("button.tva-pill")
      .classed("tva-pill--active", (d) => pillState(d) === "true")
      .classed("tva-pill--covered", (d) => pillState(d) === "mixed")
      .attr("aria-pressed", pillState);
    const brushedN = buckets.reduce((acc, b) => (b.inBrush ? acc + b.n : acc), 0);
    const rangeText = range[0] === range[1]
      ? `${labelOf(range[0])} shots`
      : `${labelOf(range[0])}–${labelOf(range[1])} shots`;
    rangeReadout.text(`Showing ${rangeText}: ${fmtCount(brushedN)} of ${fmtCount(rally.n)} points · drag across the chart to choose`);

    syncBrush(range, !instant);
    applyHover(snapshot.state.hoveredElement);
  }

  // ---- public API --------------------------------------------------------------

  /**
   * Store listener entry point (called by main.js).
   * @param {object} snapshot  store.getSnapshot()
   * @param {{ type: "init"|"filter"|"reset"|"hover"|"theme"|"resize", keys: string[] }} change
   */
  function update(snapshot, change) {
    if (destroyed || !snapshot) return;
    const type = change && change.type;
    if (type === "hover") {
      applyHover(snapshot.state.hoveredElement);
      return;
    }
    if (type === "theme") return;
    render(snapshot, change);
  }

  /** Remove listeners, the brush, the resize observer and all DOM created by this view. */
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (resizeObserver) {
      try { resizeObserver.disconnect(); } catch (err) { /* ignore */ }
      resizeObserver = null;
    }
    try { if (ctx.tooltip && typeof ctx.tooltip.hide === "function") ctx.tooltip.hide(); } catch (err) { /* ignore */ }
    brushG.on(".brush", null).on(".hover", null);
    brush.on("start", null).on("brush", null).on("end", null);
    hitsLayer.selectAll("rect.tva-rally__hit")
      .on("focus", null).on("blur", null).on("keydown", null);
    pillBar.selectAll("button.tva-pill").on("click", null);
    svg.selectAll("*").interrupt();
    root.remove();
    buckets = [];
    lastSnapshot = null;
    hoveredR = null;
  }

  return { update, destroy };
}

export default createRallyHorizonView;
