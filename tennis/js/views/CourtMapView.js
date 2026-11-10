/**
 * View 1: Serve & Return lattice on a SCHEMATIC court (guideline section 4.1, Phase 3.2).
 *
 * One service box, seen from above, drawn as a schematic 3 x 4 grid instead of to ITF scale:
 * a to-scale half court made the boxes narrow (about 49 x 115 units) and left half the court
 * empty. Columns are where the serve went (Wide at the sideline, Body, T at the centre line);
 * rows are where the return landed: "Not returned" above the dashed net, then Short (service
 * box), Deep and Very deep down to the baseline. Court marks (net, service line, baseline) are
 * kept as orientation cues only; cell sizes carry no data.
 *
 * Encoding (Cleveland & McGill):
 *   - cell fill            : Lab-diverging server win % centred at 0.50, with the exact
 *                            rate (large) and point count printed in the cell
 *   - marginal bar charts  : share of points per return depth (bars right of the rows) and per
 *                            serve direction (bars under the columns), each on one scale from
 *                            zero: volume is read as length from a common baseline, never as area
 *   - grey + hatch         : low-sample cells (N < LOW_SAMPLE_THRESHOLD): too few points to colour,
 *                            so they get the neutral grey of THEME.lowSample and stripes; the raw
 *                            share is still printed in the cell and in the tooltip
 *   - 2px accent stroke    : selected cells; unselected cells are GREYED OUT (paper fill, muted
 *                            labels) rather than made transparent, for the same reason; selected
 *                            rows / columns turn their marginal bar accent
 * Hover / selection strokes are applied to the rect, never inherited by the labels.
 *
 * Rendered structure (all class names prefixed `tva-court`):
 * <div class="tva-court-wrap">
 *   <svg class="tva-court" viewBox="0 0 640 472">
 *     <defs> hatch patterns </defs>
 *     <g class="tva-court__surface">  court plane behind the three in-court rows
 *     <g class="tva-court__cells">    12 x <g class="tva-court__cell" data-key="Wide|Deep" role="button" tabindex="0">
 *                                        <rect class="tva-court__cell-rect"> <rect class="tva-court__cell-hatch">
 *                                        <text class="tva-court__cell-rate"> <text class="tva-court__cell-n">
 *     <g class="tva-court__lines">    net (dashed), service line, baseline, mid back-court guide
 *     <g class="tva-court__labels">   row / column labels, net label
 *     <g class="tva-court__rowbars">  4 x <g class="tva-court__rowbar"> (share per return depth)
 *     <g class="tva-court__colbars">  3 x <g class="tva-court__colbar"> (share per serve direction)
 *   </svg>
 *   <div class="tva-court-legend">    colour scale, low-sample swatch, how to read
 * </div>
 *
 * @module views/CourtMapView
 */
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { getThemeTokens, winRateStops } from "../core/palette.js";
import { LOW_SAMPLE_THRESHOLD, computeDeltaVsBaseline, formatPct } from "../core/StatsEngine.js";
import { SERVE_DIRS, RETURN_DEPTHS } from "../core/DataAdapter.js";
import { NODE_LABELS, courtCellToggle } from "../core/StateStore.js";
import { createWinRateColorScale, hatchPatternId, rateFill, TRANSITION_MS } from "./scales.js";

// ---------------------------------------------------------------------------
// Geometry (SVG user units; landscape viewBox)
// ---------------------------------------------------------------------------

/** viewBox size. */
const VB_W = 640;
const VB_H = 472;

/** Grid: three equal columns after the row-label gutter. */
const GRID_X0 = 100;
const COL_W = 124;
const GRID_X1 = GRID_X0 + COL_W * SERVE_DIRS.length; // 472
const COL_X = Object.freeze(Object.fromEntries(SERVE_DIRS.map((dir, i) => [dir, GRID_X0 + i * COL_W])));

/** Rows: "Not returned" above the net, then three equal in-court rows. */
const STRIP_Y0 = 8;
const STRIP_Y1 = 86;
const NET_Y = 98;
const COURT_Y0 = 106;
const ROW_H = 90;
const ROW_Y = Object.freeze({
  Unreturned: Object.freeze([STRIP_Y0, STRIP_Y1]),
  Shallow: Object.freeze([COURT_Y0, COURT_Y0 + ROW_H]),
  Deep: Object.freeze([COURT_Y0 + ROW_H, COURT_Y0 + 2 * ROW_H]),
  VeryDeep: Object.freeze([COURT_Y0 + 2 * ROW_H, COURT_Y0 + 3 * ROW_H]),
});
const SERVICE_Y = ROW_Y.Shallow[1];
const BASELINE_Y = ROW_Y.VeryDeep[1]; // 376
const COL_LABEL_Y = BASELINE_Y + 20;

/** Marginal bars: return-depth shares right of the rows. */
const ROWBAR_X0 = GRID_X1 + 16;
const ROWBAR_MAX = VB_W - ROWBAR_X0 - 46;
const ROWBAR_H = 22;
/** Marginal bars: serve-direction shares under the columns (vertical, common baseline). */
const COLBAR_BASE = VB_H - 6;
const COLBAR_MAX = 42;
const COLBAR_W = 56;

/** Font sizes in viewBox units (the court renders at about 0.85-1.0 px per unit at 1920 x 1080). */
const FONT = Object.freeze({ cellRate: 22, cellN: 14, axis: 15, small: 13 });

/** Inset of each cell rect inside its band, so the lattice reads as a grid. */
const CELL_INSET = 2;

/** Fill of an unselected (greyed-out) cell: the page canvas, clearly not a data colour. */
const DIMMED_FILL = getThemeTokens("light").bgCanvas;
/** Ink colours for labels on light and dark fills (warm theme). */
const INK = getThemeTokens("light").textPrimary;
const PAPER = getThemeTokens("light").bgPanel;
const INK_MUTED = getThemeTokens("light").textSecondary;

/** Display label for a return depth. */
const DEPTH_LABEL = Object.freeze({ ...NODE_LABELS });

/** Legend reference values. */
const LEGEND_RATE_TICKS = Object.freeze([0.30, 0.50, 0.70]);

/** Return depths that live inside the court (the strip is outside). */
const IN_COURT_DEPTHS = RETURN_DEPTHS.filter((d) => d !== "Unreturned");

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Rectangle of a lattice cell in viewBox units.
 * @param {string} serveDir
 * @param {string} returnDepth
 * @returns {{ x: number, y: number, w: number, h: number, cx: number, cy: number }}
 */
function cellBox(serveDir, returnDepth) {
  const x0 = COL_X[serveDir] ?? GRID_X0;
  const [y0, y1] = ROW_Y[returnDepth] ?? ROW_Y.Deep;
  const x = x0 + CELL_INSET;
  const y = y0 + CELL_INSET;
  const w = COL_W - 2 * CELL_INSET;
  const h = y1 - y0 - 2 * CELL_INSET;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

/**
 * Label colour that contrasts with an arbitrary fill (CIELAB lightness test).
 * @param {string} fill CSS colour
 * @returns {string}
 */
function contrastingText(fill) {
  const lab = d3.lab(fill);
  const l = lab && Number.isFinite(lab.l) ? lab.l : 50;
  return l > 60 ? INK : PAPER;
}

/**
 * True when a cell is greyed out (a selection exists and the cell is not in it).
 * @param {object} cell
 * @param {boolean} hasSelection
 * @returns {boolean}
 */
function isDimmed(cell, hasSelection) {
  return hasSelection && !cell.selected;
}

/**
 * Smoothed win % label; "n/a" for an empty cell so no NaN ever reaches the DOM.
 * @param {object} cell
 * @returns {string}
 */
function rateLabel(cell) {
  if (!(cell.n > 0)) return "n/a";
  return formatPct(cell.rawRate, 0);
}

/**
 * True when the hovered element (from any view) shares the cell's categories.
 * @param {object|null} hovered state.hoveredElement
 * @param {object} cell
 * @returns {boolean}
 */
function isCrossHovered(hovered, cell) {
  if (!hovered || typeof hovered !== "object") return false;
  const sd = hovered.serveDir;
  const rd = hovered.returnDepth;
  if (sd === undefined && rd === undefined) return false;
  return (sd === undefined || sd === cell.serveDir) && (rd === undefined || rd === cell.returnDepth);
}

/**
 * Shares of the court's points per return depth (rows) and per serve direction (columns).
 * @param {ReadonlyArray<object>} cells
 * @returns {{ rows: Array<{ key: string, n: number, share: number }>, cols: Array<{ key: string, n: number, share: number }> }}
 */
function marginalsOf(cells) {
  const total = cells.reduce((acc, c) => acc + (c.n || 0), 0);
  const make = (keys, field) => keys.map((key) => {
    const n = cells.filter((c) => c[field] === key).reduce((acc, c) => acc + (c.n || 0), 0);
    return { key, n, share: total > 0 ? n / total : 0 };
  });
  return { rows: make(RETURN_DEPTHS, "returnDepth"), cols: make(SERVE_DIRS, "serveDir") };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create View 1.
 * @param {HTMLElement} bodyEl  `.tva-view__body` of the court section
 * @param {{ store: object, tooltip: { show: Function, move: Function, hide: Function },
 *           getTheme: () => "dark"|"light", d3?: object }} ctx
 * @returns {{ update(snapshot: object, change?: { type: string }): void, destroy(): void }}
 */
export function createCourtMapView(bodyEl, ctx) {
  const colorScale = createWinRateColorScale(d3);
  const getTheme = () => (ctx && typeof ctx.getTheme === "function" ? ctx.getTheme() : "dark");

  let lastSnapshot = null;
  let hoverKey = null;
  let hoverEvent = null;
  let paintedTheme = null;
  let destroyed = false;

  const wrap = d3.select(bodyEl).append("div").attr("class", "tva-court-wrap");
  const svg = wrap
    .append("svg")
    .attr("class", "tva-court")
    .attr("viewBox", `0 0 ${VB_W} ${VB_H}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("role", "img")
    .attr("font-family", "var(--tva-font, system-ui, sans-serif)")
    .attr("aria-label", "Service box seen from above: how often the server won, by where the serve went and where the return landed, with bars for the share of points per row and per column");

  // ----- defs: hatch patterns -----
  const defs = svg.append("defs");
  defs.selectAll("pattern.tva-court__hatch")
    .data(["dark", "light"].map((theme) => ({ id: hatchPatternId(theme), stroke: getThemeTokens(theme).textSecondary })))
    .join("pattern")
    .attr("class", "tva-court__hatch")
    .attr("id", (d) => d.id)
    .attr("patternUnits", "userSpaceOnUse")
    .attr("width", 6)
    .attr("height", 6)
    .attr("patternTransform", "rotate(45)")
    .append("line")
    .attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6)
    .attr("stroke", (d) => d.stroke)
    .attr("stroke-width", 1)
    .attr("stroke-opacity", 0.75);

  // ----- static layers -----
  const gSurface = svg.append("g").attr("class", "tva-court__surface");
  const surfaceRect = gSurface.append("rect")
    .attr("class", "tva-court__surface-rect")
    .attr("x", GRID_X0).attr("y", COURT_Y0)
    .attr("width", GRID_X1 - GRID_X0).attr("height", BASELINE_Y - COURT_Y0);

  const gCells = svg.append("g").attr("class", "tva-court__cells");
  const gLines = svg.append("g").attr("class", "tva-court__lines").attr("pointer-events", "none");
  const gLabels = svg.append("g").attr("class", "tva-court__labels").attr("pointer-events", "none");
  const gRowBars = svg.append("g").attr("class", "tva-court__rowbars").attr("pointer-events", "none");
  const gColBars = svg.append("g").attr("class", "tva-court__colbars").attr("pointer-events", "none");

  /** Court marks [class, x1, y1, x2, y2, width, dash]: orientation cues, not to scale. */
  const LINES = [
    ["service-line", GRID_X0, SERVICE_Y, GRID_X1, SERVICE_Y, 2, null],
    ["baseline", GRID_X0, BASELINE_Y, GRID_X1, BASELINE_Y, 3, null],
    ["sideline", GRID_X0, COURT_Y0, GRID_X0, BASELINE_Y, 2, null],
    ["center-service-line", GRID_X1, COURT_Y0, GRID_X1, SERVICE_Y, 2, null],
    ["mid-backcourt", GRID_X0, ROW_Y.Deep[1], GRID_X1, ROW_Y.Deep[1], 1, "2 4"],
  ];
  const courtLines = gLines.selectAll("line.tva-court__line")
    .data(LINES)
    .join("line")
    .attr("class", (d) => `tva-court__line tva-court__line--${d[0]}`)
    .attr("x1", (d) => d[1]).attr("y1", (d) => d[2])
    .attr("x2", (d) => d[3]).attr("y2", (d) => d[4])
    .attr("stroke-width", (d) => d[5])
    .attr("stroke-dasharray", (d) => d[6])
    .attr("stroke-linecap", "square");
  const netLine = gLines.append("line")
    .attr("class", "tva-court__line tva-court__line--net")
    .attr("x1", GRID_X0 - 6).attr("x2", GRID_X1 + 6)
    .attr("y1", NET_Y).attr("y2", NET_Y)
    .attr("stroke-width", 2.5)
    .attr("stroke-dasharray", "3 3");

  // Labels: rows (left), columns (under the baseline), net.
  const rowLabelX = GRID_X0 - 10;
  const rowLabels = gLabels.selectAll("text.tva-court__row-label")
    .data(IN_COURT_DEPTHS)
    .join("text")
    .attr("class", "tva-court__row-label")
    .attr("x", rowLabelX)
    .attr("y", (d) => (ROW_Y[d][0] + ROW_Y[d][1]) / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", "end")
    .attr("font-size", FONT.axis)
    .text((d) => NODE_LABELS[d] || d);
  const stripLabel = gLabels.append("text")
    .attr("class", "tva-court__row-label tva-court__row-label--strip")
    .attr("x", rowLabelX)
    .attr("y", (STRIP_Y0 + STRIP_Y1) / 2)
    .attr("text-anchor", "end")
    .attr("font-size", FONT.axis);
  stripLabel.append("tspan").attr("x", rowLabelX).attr("dy", "-0.2em").text("Not");
  stripLabel.append("tspan").attr("x", rowLabelX).attr("dy", "1.2em").text("returned");
  const colLabels = gLabels.selectAll("text.tva-court__col-label")
    .data(SERVE_DIRS)
    .join("text")
    .attr("class", "tva-court__col-label")
    .attr("x", (d) => COL_X[d] + COL_W / 2)
    .attr("y", COL_LABEL_Y)
    .attr("text-anchor", "middle")
    .attr("font-size", FONT.axis)
    .attr("font-weight", 600)
    .text((d) => NODE_LABELS[d] || d);
  const netLabel = gLabels.append("text")
    .attr("class", "tva-court__net-label")
    .attr("x", rowLabelX)
    .attr("y", NET_Y)
    .attr("dy", "0.35em")
    .attr("text-anchor", "end")
    .attr("font-size", FONT.small)
    .text("net");
  const rowBarTitle = gRowBars.append("text").attr("class", "tva-court__rowbars-title")
    .attr("x", ROWBAR_X0).attr("y", STRIP_Y0 + 4).attr("dy", "0.7em")
    .attr("font-size", FONT.small).attr("font-weight", 600)
    .text("Share of points");
  const colBarTitle = gColBars.append("text").attr("class", "tva-court__colbars-title")
    .attr("x", rowLabelX).attr("y", COLBAR_BASE - COLBAR_MAX / 2).attr("dy", "0.35em")
    .attr("text-anchor", "end").attr("font-size", FONT.small).attr("font-weight", 600)
    .text("Share of points");

  // ----- HTML legend column (text in CSS px; colours from CSS variables) -----
  const legend = wrap.append("div").attr("class", "tva-court-legend");
  const legendBlock = (cls, title) => {
    const block = legend.append("div").attr("class", `tva-court-legend__block tva-court-legend__block--${cls}`);
    block.append("div").attr("class", "tva-court-legend__title").text(title);
    return block;
  };

  const stops = winRateStops();
  const lo = stops[0].value;
  const hi = stops[stops.length - 1].value;
  const N_GRAD = 24;
  const gradientCss = `linear-gradient(to right, ${d3.range(N_GRAD + 1)
    .map((i) => `${colorScale(lo + (hi - lo) * (i / N_GRAD))} ${((i / N_GRAD) * 100).toFixed(1)}%`).join(", ")})`;
  const colorBlock = legendBlock("color", "How often the server won");
  colorBlock.append("div").attr("class", "tva-court-legend__bar").style("background", gradientCss);
  const tickRow = colorBlock.append("div").attr("class", "tva-court-legend__ticks");
  tickRow.selectAll("span")
    .data(LEGEND_RATE_TICKS)
    .join("span")
    .attr("class", (v, i) => `tva-court-legend__tick${i === 0 ? " is-first" : i === LEGEND_RATE_TICKS.length - 1 ? " is-last" : ""}`)
    .style("left", (v) => `${(((v - lo) / (hi - lo)) * 100).toFixed(1)}%`)
    .text((v) => formatPct(v, 0));
  const ends = colorBlock.append("div").attr("class", "tva-court-legend__ends");
  ends.append("span").text("← returner ahead");
  ends.append("span").text("server ahead →");

  const hatchBlock = legendBlock("hatch", `Fewer than ${LOW_SAMPLE_THRESHOLD} points`);
  const hatchRow = hatchBlock.append("div").attr("class", "tva-court-legend__row");
  const hatchSvg = hatchRow.append("svg")
    .attr("class", "tva-court-legend__swatch")
    .attr("width", 30).attr("height", 18).attr("viewBox", "0 0 30 18")
    .attr("aria-hidden", "true");
  hatchSvg.append("rect").attr("width", 30).attr("height", 18).attr("rx", 2)
    .attr("fill", getThemeTokens("light").lowSample);
  const hatchSwatch = hatchSvg.append("rect").attr("width", 30).attr("height", 18).attr("rx", 2)
    .attr("stroke-width", 1);
  hatchRow.append("span").text("grey and striped: too few points to colour");

  legend.append("p").attr("class", "tva-court-legend__note")
    .text("One service box seen from above (not to scale): net at the top, the server's baseline at the bottom. Columns show where the serve went, rows where the return landed, and the grey bars how many points fall in each. Click or tap a box to keep only those points.");

  // ----- theme colours for the static parts -----

  /**
   * Apply theme tokens to every static (non data-bound) SVG element.
   * @param {ReturnType<typeof getThemeTokens>} tokens
   */
  function applyStaticTheme(tokens) {
    surfaceRect.attr("fill", tokens.bgCanvas).attr("stroke", "none");
    courtLines.attr("stroke", tokens.textSecondary);
    netLine.attr("stroke", tokens.textSecondary);
    rowLabels.attr("fill", tokens.textSecondary);
    stripLabel.attr("fill", tokens.textSecondary);
    colLabels.attr("fill", tokens.textPrimary);
    netLabel.attr("fill", tokens.textSecondary);
    rowBarTitle.attr("fill", tokens.textSecondary);
    colBarTitle.attr("fill", tokens.textSecondary);
    hatchSwatch.attr("fill", `url(#${hatchPatternId(getTheme())})`).attr("stroke", tokens.borderSubtle);
    paintedTheme = getTheme();
  }

  // ----- event handlers (always read ctx.store / ctx.tooltip at event time) -----

  /**
   * Toggle one box: the boxes currently selected, plus or minus this one, in one store
   * notification (core/StateStore.courtCellToggle). Selecting a row and then clicking one of its
   * boxes leaves the other boxes of that row selected.
   * @param {object} cell
   */
  function toggleCell(cell) {
    const store = ctx && ctx.store;
    if (!store || typeof store.setFilters !== "function") return;
    try {
      store.setFilters(courtCellToggle(store.getState(), cell.key));
    } catch (err) {
      console.error("CourtMapView: toggle failed", err);
    }
  }

  /**
   * Tooltip model for a cell (contract "Tooltip" section).
   * @param {object} cell
   * @returns {object}
   */
  function tooltipModel(cell) {
    const baseline = lastSnapshot && lastSnapshot.baseline;
    const deltaVsBaseline = computeDeltaVsBaseline(cell, baseline);
    const shareText = formatPct(cell.volumeShare, 1);
    return {
      title: `${NODE_LABELS[cell.serveDir] || cell.serveDir} serve → ${DEPTH_LABEL[cell.returnDepth] || cell.returnDepth} return`,
      subtitle: `${d3.format(",d")(cell.n)} points · ${shareText} of the points shown`,
      stats: { ...cell, deltaVsBaseline },
    };
  }

  /**
   * Show tooltip + publish hover state.
   * @param {Event} event
   * @param {object} cell
   */
  function hoverIn(event, cell) {
    hoverKey = cell.key;
    hoverEvent = event;
    const tooltip = ctx && ctx.tooltip;
    if (tooltip && typeof tooltip.show === "function") tooltip.show(event, tooltipModel(cell));
    const store = ctx && ctx.store;
    if (store && typeof store.setHovered === "function") {
      store.setHovered({ view: "court", kind: "cell", key: cell.key, serveDir: cell.serveDir, returnDepth: cell.returnDepth });
    }
  }

  /** Hide tooltip + clear hover state. */
  function hoverOut() {
    hoverKey = null;
    hoverEvent = null;
    const tooltip = ctx && ctx.tooltip;
    if (tooltip && typeof tooltip.hide === "function") tooltip.hide();
    const store = ctx && ctx.store;
    if (store && typeof store.setHovered === "function") store.setHovered(null);
  }

  /**
   * Keep an open tooltip truthful after a recompute.
   * @param {object[]} cells
   */
  function refreshHover(cells) {
    if (!hoverKey) return;
    const tooltip = ctx && ctx.tooltip;
    const fresh = cells.find((c) => c.key === hoverKey);
    if (fresh && tooltip && typeof tooltip.show === "function") {
      tooltip.show(hoverEvent, tooltipModel(fresh));
    } else {
      hoverOut();
    }
  }

  /** @param {Event} event */
  function onMove(event) {
    const tooltip = ctx && ctx.tooltip;
    if (tooltip && typeof tooltip.move === "function") tooltip.move(event);
  }

  /**
   * @param {KeyboardEvent} event
   * @param {object} cell
   */
  function onKeydown(event, cell) {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      toggleCell(cell);
    }
  }

  // ----- data-bound rendering -----

  /**
   * Render / update the 12 cells.
   * @param {object} snapshot
   * @param {{ type: string }} change
   * @param {ReturnType<typeof getThemeTokens>} tokens
   */
  function renderCells(snapshot, change, tokens) {
    const court = snapshot && snapshot.viewModels && snapshot.viewModels.court;
    const cells = court && Array.isArray(court.cells) ? court.cells : [];
    const hasSelection = Boolean(court && court.hasSelection);
    const hovered = snapshot && snapshot.state ? snapshot.state.hoveredElement : null;
    const animate = change.type !== "hover" && change.type !== "theme";
    const hatchUrl = `url(#${hatchPatternId(getTheme())})`;

    const groups = gCells.selectAll("g.tva-court__cell")
      .data(cells, (d) => d.key)
      .join(
        (enter) => {
          const g = enter.append("g")
            .attr("class", "tva-court__cell")
            .attr("data-key", (d) => d.key)
            .attr("data-serve-dir", (d) => d.serveDir)
            .attr("data-return-depth", (d) => d.returnDepth)
            .attr("role", "button")
            .attr("tabindex", 0)
            .attr("cursor", "pointer")
            .attr("opacity", 1)
            .on("click.tva-court", (_event, d) => toggleCell(d))
            .on("mouseenter.tva-court", (event, d) => hoverIn(event, d))
            .on("mousemove.tva-court", (event) => onMove(event))
            .on("mouseleave.tva-court", () => hoverOut())
            .on("focus.tva-court", (event, d) => hoverIn(event, d))
            .on("blur.tva-court", () => hoverOut())
            .on("keydown.tva-court", (event, d) => onKeydown(event, d));
          g.each(function eachCell(d) {
            const box = cellBox(d.serveDir, d.returnDepth);
            const sel = d3.select(this);
            sel.append("rect").attr("class", "tva-court__cell-rect").attr("rx", 4)
              .attr("x", box.x).attr("y", box.y).attr("width", box.w).attr("height", box.h)
              .attr("fill", rateFill(colorScale, d));
            sel.append("rect").attr("class", "tva-court__cell-hatch").attr("rx", 4)
              .attr("x", box.x).attr("y", box.y).attr("width", box.w).attr("height", box.h)
              .attr("stroke", "none")
              .attr("pointer-events", "none");
            sel.append("text").attr("class", "tva-court__cell-rate")
              .attr("x", box.cx).attr("y", box.cy - 2)
              .attr("text-anchor", "middle")
              .attr("font-size", FONT.cellRate)
              .attr("font-weight", 700)
              .attr("font-variant-numeric", "tabular-nums")
              .attr("stroke", "none")
              .attr("pointer-events", "none");
            sel.append("text").attr("class", "tva-court__cell-n")
              .attr("x", box.cx).attr("y", box.cy + FONT.cellN + 4)
              .attr("text-anchor", "middle")
              .attr("font-size", FONT.cellN)
              .attr("font-variant-numeric", "tabular-nums")
              .attr("stroke", "none")
              .attr("pointer-events", "none");
          });
          return g;
        },
        (update) => update,
        (exit) => exit.remove(),
      );

    groups
      .attr("aria-label", (d) => `${NODE_LABELS[d.serveDir] || d.serveDir} serve, ${DEPTH_LABEL[d.returnDepth] || d.returnDepth} return: `
        + `server won ${rateLabel(d)} of ${d3.format(",d")(d.n)} points`
        + (d.lowSample ? ", few points" : "")
        + (d.selected ? ", selected" : ""))
      .attr("aria-pressed", (d) => (d.selected ? "true" : "false"))
      .classed("tva-selected", (d) => Boolean(d.selected))
      .classed("tva-dimmed", (d) => hasSelection && !d.selected)
      .classed("tva-low-sample", (d) => Boolean(d.lowSample))
      .classed("tva-hovered", (d) => isCrossHovered(hovered, d));

    groups.select("rect.tva-court__cell-hatch")
      .attr("fill", hatchUrl)
      .attr("visibility", (d) => (d.lowSample ? "visible" : "hidden"));

    groups.select("text.tva-court__cell-rate").text((d) => rateLabel(d));
    groups.select("text.tva-court__cell-n").text((d) => `${d3.format(",d")(d.n)} pts`);

    const t = animate
      ? d3.transition("tva-court").duration(TRANSITION_MS).ease(d3.easeCubicOut)
      : null;
    const withT = (sel) => (t ? sel.transition(t) : sel);

    withT(groups).attr("opacity", 1);

    const fillOf = (d) => (isDimmed(d, hasSelection) ? DIMMED_FILL : rateFill(colorScale, d));
    withT(groups.select("rect.tva-court__cell-rect"))
      .attr("fill", fillOf)
      .attr("stroke", (d) => (d.selected ? tokens.accentFocus : tokens.textSecondary))
      .attr("stroke-opacity", (d) => (d.selected ? 1 : 0.45))
      .attr("stroke-width", (d) => (d.selected ? 2 : 0.75));

    const labelFill = (d) => (isDimmed(d, hasSelection) ? INK_MUTED : contrastingText(rateFill(colorScale, d)));
    withT(groups.select("text.tva-court__cell-rate")).attr("fill", labelFill);
    withT(groups.select("text.tva-court__cell-n")).attr("fill", labelFill);
  }

  /**
   * Marginal bar charts: share of points per return depth (horizontal, right of the rows) and per
   * serve direction (vertical, under the columns). One scale per chart from zero; bars of a
   * selected row / column take the accent colour.
   * @param {object} snapshot
   * @param {{ type: string }} change
   * @param {ReturnType<typeof getThemeTokens>} tokens
   */
  function renderMarginals(snapshot, change, tokens) {
    const court = snapshot && snapshot.viewModels && snapshot.viewModels.court;
    const cells = court && Array.isArray(court.cells) ? court.cells : [];
    const state = snapshot && snapshot.state ? snapshot.state : null;
    const selDepths = state && state.selectedReturnDepths ? state.selectedReturnDepths : new Set();
    const selDirs = state && state.selectedServeDirs ? state.selectedServeDirs : new Set();
    const { rows, cols } = marginalsOf(cells);
    const animate = change.type !== "hover" && change.type !== "theme";
    const t = animate ? d3.transition("tva-court-bars").duration(TRANSITION_MS).ease(d3.easeCubicOut) : null;
    const withT = (sel) => (t ? sel.transition(t) : sel);
    const fillOf = (selected) => (selected ? tokens.accentFocus : "var(--tva-mark)");
    const opacityOf = (selected, anySelected) => (selected || !anySelected ? 0.85 : 0.4);

    // Rows: horizontal bars from ROWBAR_X0.
    const maxRow = Math.max(0.0001, ...rows.map((r) => r.share));
    const rowLen = (share) => (share / maxRow) * ROWBAR_MAX;
    const rowY = (key) => (ROW_Y[key][0] + ROW_Y[key][1]) / 2;
    const rowBars = gRowBars.selectAll("g.tva-court__rowbar")
      .data(rows, (d) => d.key)
      .join((enter) => {
        const g = enter.append("g").attr("class", "tva-court__rowbar").attr("data-depth", (d) => d.key);
        g.append("rect").attr("x", ROWBAR_X0).attr("y", (d) => rowY(d.key) - ROWBAR_H / 2)
          .attr("height", ROWBAR_H).attr("rx", 2).attr("width", 0);
        g.append("text").attr("class", "tva-court__rowbar-label").attr("y", (d) => rowY(d.key))
          .attr("dy", "0.35em").attr("font-size", FONT.small).attr("font-variant-numeric", "tabular-nums");
        return g;
      });
    const rowSel = (d) => selDepths.size > 0 && selDepths.has(d.key);
    withT(rowBars.select("rect"))
      .attr("width", (d) => rowLen(d.share))
      .attr("fill", (d) => fillOf(rowSel(d), selDepths.size > 0))
      .attr("fill-opacity", (d) => opacityOf(rowSel(d), selDepths.size > 0));
    rowBars.select("text").text((d) => formatPct(d.share, 0)).attr("fill", tokens.textPrimary);
    withT(rowBars.select("text")).attr("x", (d) => ROWBAR_X0 + rowLen(d.share) + 6);

    // Columns: vertical bars on the COLBAR_BASE baseline, centred under each column.
    const maxCol = Math.max(0.0001, ...cols.map((c) => c.share));
    const colLen = (share) => (share / maxCol) * COLBAR_MAX;
    const colX = (key) => COL_X[key] + COL_W / 2 - COLBAR_W / 2;
    const colBars = gColBars.selectAll("g.tva-court__colbar")
      .data(cols, (d) => d.key)
      .join((enter) => {
        const g = enter.append("g").attr("class", "tva-court__colbar").attr("data-dir", (d) => d.key);
        g.append("rect").attr("x", (d) => colX(d.key)).attr("width", COLBAR_W).attr("rx", 2)
          .attr("y", COLBAR_BASE).attr("height", 0);
        g.append("text").attr("class", "tva-court__colbar-label")
          .attr("x", (d) => colX(d.key) + COLBAR_W + 6).attr("y", COLBAR_BASE)
          .attr("font-size", FONT.small).attr("font-variant-numeric", "tabular-nums");
        return g;
      });
    const colSel = (d) => selDirs.size > 0 && selDirs.has(d.key);
    withT(colBars.select("rect"))
      .attr("y", (d) => COLBAR_BASE - colLen(d.share))
      .attr("height", (d) => colLen(d.share))
      .attr("fill", (d) => fillOf(colSel(d), selDirs.size > 0))
      .attr("fill-opacity", (d) => opacityOf(colSel(d), selDirs.size > 0));
    colBars.select("text").text((d) => formatPct(d.share, 0)).attr("fill", tokens.textPrimary).attr("dy", "0.35em");
    withT(colBars.select("text")).attr("y", (d) => COLBAR_BASE - colLen(d.share) / 2);
  }

  /**
   * Only refresh cross-highlight classes (hover changes never transition or re-layout).
   * @param {object} snapshot
   */
  function renderHover(snapshot) {
    const hovered = snapshot && snapshot.state ? snapshot.state.hoveredElement : null;
    gCells.selectAll("g.tva-court__cell").classed("tva-hovered", (d) => isCrossHovered(hovered, d));
  }

  // ----- public API -----

  /**
   * @param {object} snapshot store snapshot
   * @param {{ type: "init"|"filter"|"reset"|"hover"|"theme" }} [change]
   */
  function update(snapshot, change) {
    if (destroyed) return;
    const ch = change && typeof change.type === "string" ? change : { type: "filter" };
    const hasCells = Boolean(snapshot && snapshot.viewModels && snapshot.viewModels.court);
    const previous = lastSnapshot;
    if (hasCells) lastSnapshot = snapshot;

    if (ch.type === "hover" && previous && snapshot && snapshot.viewModels === previous.viewModels) {
      renderHover(snapshot);
      return;
    }
    const theme = getTheme();
    const tokens = getThemeTokens(theme);
    if (ch.type === "theme" || paintedTheme !== theme) applyStaticTheme(tokens);
    renderCells(snapshot, ch, tokens);
    renderMarginals(snapshot, ch, tokens);
    if (ch.type === "init") {
      hoverKey = null;
      hoverEvent = null;
    } else if (ch.type !== "theme") {
      const court = hasCells ? snapshot.viewModels.court : null;
      refreshHover(court && Array.isArray(court.cells) ? court.cells : []);
    }
  }

  /** Remove listeners and the SVG. */
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    gCells.selectAll("g.tva-court__cell")
      .on(".tva-court", null)
      .attr("tabindex", null);
    svg.interrupt().selectAll("*").interrupt();
    wrap.remove();
    lastSnapshot = null;
    hoverKey = null;
    hoverEvent = null;
  }

  applyStaticTheme(getThemeTokens(getTheme()));

  return { update, destroy };
}

export default createCourtMapView;
