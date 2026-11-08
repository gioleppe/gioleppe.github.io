/**
 * TacticalDagView.js - View 2: three-stage tactical flow DAG
 * (guideline sections 4.2 and 8 Phase 3.3; docs/api_contract.md "Phase 3 shared conventions").
 *
 * A strict 3-layer Sugiyama / alluvial layout: Serve direction (V1) -> Return depth (V2) ->
 * Serve+1 archetype (V3). Layer x positions are fixed at 0.08W, 0.50W and 0.92W; node bars are
 * stacked vertically within each layer in the barycentric `order` computed by the StateStore
 * (mental-map preservation: this view never reorders nodes). Bar heights and ribbon widths share
 * one px-per-point scale so that ribbons tile the bars exactly. Ribbons are horizontal cubic
 * Bezier curves (control points at x + 0.5 * dx, i.e. d3.linkHorizontal geometry) coloured by
 * the server win rate of the transition (grey when it holds fewer than 10 points); sub-1% ribbons are drawn as a 1 px
 * dashed wireframe. When any node selection exists, every context ribbon fades to 0.12 and the
 * emphasized ribbons carry an overlay path of width nActive at 0.90.
 *
 * Node labels are fitted to their horizontal room (word wrap, compact size when the node pitch
 * is small) and then de-collided vertically within each layer (`resolveLabelCollisions`) so they
 * stay legible at every filter state; they carry a 3 px halo in the panel colour
 * (paint-order: stroke) so they keep their contrast over any ribbon colour (guideline section 9,
 * Patrignani row). With a node selection, nodes without active flow (nActive = 0) fade to 0.25
 * and every label reads "nActive/n"; labels of empty nodes (n = 0) are hidden. An empty active
 * set shows an explicit message.
 *
 * Rendering uses the D3 general update pattern (selection.join) keyed by node id and by
 * source>target, with 300 ms easeCubicOut transitions on filter changes; hover changes only
 * toggle classes and theme changes are no-ops (all chrome colours are CSS variables). The pure
 * geometry lives in ./layout.js (Node-testable). The view never subscribes to the store itself:
 * main.js calls update().
 *
 * @module views/TacticalDagView
 */

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { computeWilsonCI, formatPct } from "../core/StatsEngine.js";
import { getThemeTokens, THEME } from "../core/palette.js";
import { NODE_LABELS } from "../core/StateStore.js";
import { createWinRateColorScale, rateFill, TRANSITION_MS } from "./scales.js";
import { DAG_GEOMETRY, computeDagLayout, wrapWords, resolveLabelCollisions, r2 } from "./layout.js";

const { W, H, LAYER_X, BAR_W, TOP, BOTTOM } = DAG_GEOMETRY;

/** Line height factor for multi-line labels. */
const LINE_HEIGHT = 1.2;
/** Horizontal offset between a bar edge and its label. */
const LABEL_OFFSET = 8;
/** Padding kept between an outer-layer label and the viewBox edge. */
const EDGE_PAD = 4;
/** Minimum vertical gap between neighbouring label blocks after de-collision. */
const LABEL_GAP = 2;
/** Label font sizes: normal (textPrimary) and compact (textSecondary, when neighbours are close). */
const LABEL_SIZE = 13;
const LABEL_SIZE_COMPACT = 11;
/** Ribbon opacities. */
const OPACITY = Object.freeze({ context: 0.7, faded: 0.2, emphasized: 0.9, pruned: 0.35 });
/** Thousands separators for every count shown in the chart. */
const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "n/a");
/** Opacity of a node without active flow while a selection exists (same dim as the court). */
/** Fill of a node without active flow under a selection: neutral grey, never a faded data colour. */
const NODE_DIM_FILL = THEME.nodeDim;
/** Width of the label halo (panel-coloured stroke painted under the glyphs). */
const LABEL_HALO = 3;

/** Layer titles, indexed by layer - 1. */
const LAYER_TITLES = Object.freeze(["Where the serve went", "Where the return landed", "Server's next shot"]);
/** Filter set key for each layer, indexed by layer - 1. */
const LAYER_SET_KEYS = Object.freeze(["selectedServeDirs", "selectedReturnDepths", "selectedThirdShots"]);
/** Hover-element field for each layer, indexed by layer - 1. */
const LAYER_HOVER_FIELDS = Object.freeze(["serveDir", "returnDepth", "thirdShot"]);
/** Message shown when no point passes the current filters. */
const EMPTY_TEXT = "No points match the current filters";

/** Module-wide counter so that several mounted instances get distinct SVG ids. */
let instanceCounter = 0;

/**
 * Whole-number percentage ("65%"), "n/a" when not finite.
 * @param {number} v
 * @returns {string}
 */
const pct = (v) => formatPct(v, 0);

/**
 * Text width measurer backed by an offscreen 2D canvas (no layout thrash). Falls back to an
 * average-glyph estimate when canvas is unavailable.
 * @param {string} fontFamily
 * @returns {(text: string, size: number, weight?: number) => number}
 */
function createTextMeasurer(fontFamily) {
  let ctx2d = null;
  try {
    const canvas = document.createElement("canvas");
    ctx2d = canvas.getContext ? canvas.getContext("2d") : null;
  } catch (_) {
    ctx2d = null;
  }
  return (text, size, weight = 400) => {
    if (!ctx2d) return String(text).length * size * 0.55;
    ctx2d.font = `${weight} ${size}px ${fontFamily}`;
    return ctx2d.measureText(String(text)).width;
  };
}

/**
 * Whether a keyboard event activates a button-like SVG element.
 * @param {KeyboardEvent} evt
 * @returns {boolean}
 */
const isActivationKey = (evt) => evt.key === "Enter" || evt.key === " " || evt.key === "Spacebar";

/**
 * Create View 2 inside `bodyEl`.
 *
 * @param {HTMLElement} bodyEl  the `.tva-view__body` element of the dag section
 * @param {{ store: object, tooltip: { show: Function, move: Function, hide: Function },
 *           getTheme: () => ("dark"|"light"), d3?: object }} ctx
 *   `ctx.store` is read at event time (main.js may swap it); `ctx.d3` is the same namespace
 *   this module imports and is not needed.
 * @returns {{ update: (snapshot: object, change?: { type: string }) => void, destroy: () => void }}
 */
export function createTacticalDagView(bodyEl, ctx) {
  instanceCounter += 1;
  const uid = `tva-dag-${instanceCounter}`;
  const colorScale = createWinRateColorScale(d3);

  /** @type {object|null} last snapshot received */
  let lastSnapshot = null;
  /** @type {ReturnType<typeof computeDagLayout>|null} */
  let layout = null;
  /**
   * Hover this view owns: which mark, its key and the event the tooltip is anchored to, so an
   * open tooltip can be re-shown with fresh numbers after a re-render.
   * @type {{ kind: "node"|"link", key: string, evt: object }|null}
   */
  let hover = null;
  let destroyed = false;

  const tokens = () => getThemeTokens(typeof ctx.getTheme === "function" ? ctx.getTheme() : "dark");
  const cssText = () => `var(--tva-text, ${tokens().textPrimary})`;
  const cssText2 = () => `var(--tva-text-2, ${tokens().textSecondary})`;
  const cssAccent = () => `var(--tva-accent, ${tokens().accentFocus})`;

  // ----------------------------------------------------------------------------------------
  // Static structure
  // ----------------------------------------------------------------------------------------
  const svg = d3.select(bodyEl)
    .append("svg")
    .attr("class", "tva-dag")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("role", "group")
    .attr("aria-label", "Flow of points: where the serve went, where the return landed, and the server's next shot")
    .style("width", "100%")
    .style("height", "100%")
    .style("font-family", "var(--tva-font, system-ui, sans-serif)");

  // Hover / focus states are class driven so that hover never triggers a transition.
  svg.append("style").text(`
    .tva-dag__node { cursor: pointer; outline: none; }
    .tva-dag__node.is-hover rect, .tva-dag__node:focus-visible rect { stroke: ${cssAccent()}; stroke-width: 3px; }
    .tva-dag__link { cursor: pointer; outline: none; }
    .tva-dag__link.is-hover, .tva-dag__link:focus-visible { opacity: 0.95; }
    .tva-dag__link.is-hover.is-pruned, .tva-dag__link.is-pruned:focus-visible { stroke: ${cssAccent()}; }
    .tva-dag__link-active { pointer-events: none; }
    .tva-dag__label { paint-order: stroke; stroke: var(--tva-bg-panel, ${tokens().bgPanel});
      stroke-width: ${LABEL_HALO}px; stroke-linejoin: round; }
  `);

  const defs = svg.append("defs");
  const gradientId = `${uid}-win-gradient`;
  const gradient = defs.append("linearGradient").attr("id", gradientId)
    .attr("x1", 0).attr("x2", 1).attr("y1", 0).attr("y2", 0);
  const domain = colorScale.domain();
  const span = domain[domain.length - 1] - domain[0];
  gradient.selectAll("stop")
    .data(domain)
    .join("stop")
    .attr("offset", (v) => `${((v - domain[0]) / span) * 100}%`)
    .attr("stop-color", (v) => colorScale(v));

  svg.append("g").attr("class", "tva-dag__titles")
    .selectAll("text")
    .data(LAYER_TITLES)
    .join("text")
    .attr("class", "tva-dag__layer-title")
    .attr("x", (_, i) => LAYER_X[i])
    .attr("y", 24)
    .attr("text-anchor", (_, i) => (i === 0 ? "start" : i === 2 ? "end" : "middle"))
    .attr("font-size", 13)
    .attr("font-weight", 600)
    .attr("fill", cssText())
    .text((title) => title);

  // Links are drawn before nodes (ribbons beneath bars); emphasized overlays sit between them.
  const linksG = svg.append("g").attr("class", "tva-dag__links").attr("fill", "none");
  const activeG = svg.append("g").attr("class", "tva-dag__links-active").attr("fill", "none");
  const nodesG = svg.append("g").attr("class", "tva-dag__nodes");

  const emptyText = svg.append("text")
    .attr("class", "tva-dag__empty")
    .attr("x", W / 2)
    .attr("y", 120)
    .attr("text-anchor", "middle")
    .attr("font-size", 12)
    .attr("fill", cssText2())
    .attr("opacity", 0)
    .attr("aria-hidden", "true")
    .text(EMPTY_TEXT);

  const legend = svg.append("g").attr("class", "tva-dag__legend").attr("transform", `translate(20, ${H - 30})`);
  legend.append("rect").attr("x", 0).attr("y", 0).attr("width", 96).attr("height", 8).attr("rx", 2)
    .attr("fill", `url(#${gradientId})`);
  legend.append("text").attr("x", 0).attr("y", 22).attr("font-size", 10).attr("fill", cssText2())
    .text(pct(domain[0]));
  legend.append("text").attr("x", 96).attr("y", 22).attr("text-anchor", "end").attr("font-size", 10)
    .attr("fill", cssText2()).text(pct(domain[domain.length - 1]));
  legend.append("text").attr("x", 110).attr("y", 8).attr("font-size", 11).attr("fill", cssText2())
    .text("Colour: how often the server won (blocks; bands when hovered or selected) · band width: number of points · dashed: under 1%");

  // ----------------------------------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------------------------------

  /**
   * Node count: "n", or "nActive/n" while a node selection exists (active flow of the context n).
   * @param {import("./layout.js").NodeLayout} d
   * @returns {string}
   */
  const countText = (d) => (hasSelection() && d.nActive !== d.n ? `${fmtInt(d.nActive)} of ${fmtInt(d.n)}` : fmtInt(hasSelection() ? d.nActive : d.n));

  /**
   * Accessible count wording matching countText.
   * @param {import("./layout.js").NodeLayout} d
   * @returns {string}
   */
  const countAria = (d) => (hasSelection() ? `${fmtInt(d.nActive)} of ${fmtInt(d.n)} points in the selection` : `${fmtInt(d.n)} points`);

  /**
   * Node label text: label · n (or nActive/n) · win%.
   * @param {import("./layout.js").NodeLayout} d
   * @returns {string}
   */
  const labelText = (d) => `${d.label} · ${countText(d)} · ${d.n > 0 ? pct(d.rawRate) : "–"}`;

  /**
   * Label x position, anchor and available width per layer (left of layer 1, right of layers
   * 2 and 3). Outer layers only have the room between the bar and the viewBox edge.
   * @param {import("./layout.js").NodeLayout} d
   * @returns {{ x: number, anchor: string, maxWidth: number }}
   */
  const labelPos = (d) => {
    if (d.layer === 1) {
      const x = d.x - LABEL_OFFSET;
      return { x, anchor: "end", maxWidth: x - EDGE_PAD };
    }
    const x = d.x + BAR_W + LABEL_OFFSET;
    const limit = d.layer === 2 ? LAYER_X[2] - BAR_W / 2 - LABEL_OFFSET : W;
    return { x, anchor: "start", maxWidth: limit - x - EDGE_PAD };
  };

  const fontFamily = (() => {
    try {
      return getComputedStyle(svg.node()).fontFamily || "system-ui, sans-serif";
    } catch (_) {
      return "system-ui, sans-serif";
    }
  })();
  const measure = createTextMeasurer(fontFamily);

  /**
   * Height of a label block.
   * @param {Array<{ size: number }>} lines
   * @returns {number}
   */
  const blockHeight = (lines) => lines.reduce((acc, ln) => acc + ln.size * LINE_HEIGHT, 0);

  /**
   * Fit a node label into its horizontal room. Layer 2 keeps the single line
   * "label · n · win%". Outer layers wrap the name by measured width and put "n · win%" on a
   * smaller final line. When the block is taller than the node pitch the label goes compact
   * (10 px, textSecondary); a line still wider than the room is glyph-compressed via textLength.
   * @param {import("./layout.js").NodeLayout} d
   * @param {number} maxWidth
   * @returns {{ compact: boolean, height: number, lines: Array<{ text: string, size: number, primary: boolean, width: number, y: number }> }}
   */
  const fitLabel = (d, maxWidth) => {
    const win = d.n > 0 ? pct(d.rawRate) : "–";
    const build = (size) => {
      if (d.layer === 2) {
        const text = labelText(d);
        return [{ text, size, primary: true, width: measure(text, size), y: 0 }];
      }
      const statsSize = Math.max(size - 2, 8);
      const stats = `${countText(d)} · ${win}`;
      const names = wrapWords(d.label, maxWidth, (s) => measure(s, size))
        .map((text) => ({ text, size, primary: true, width: measure(text, size), y: 0 }));
      return [...names, { text: stats, size: statsSize, primary: false, width: measure(stats, statsSize), y: 0 }];
    };
    let lines = build(LABEL_SIZE);
    let compact = false;
    if (blockHeight(lines) > d.pitch) {
      compact = true;
      lines = build(LABEL_SIZE_COMPACT);
    }
    const height = blockHeight(lines);
    let acc = -height / 2;
    for (const ln of lines) {
      const h = ln.size * LINE_HEIGHT;
      ln.y = r2(acc + h / 2);
      acc += h;
    }
    return { compact, height, lines };
  };

  /**
   * Fit every label, then push overlapping blocks apart within each layer (guideline section 9:
   * labels legible at all filter states). Sets `labelY` on each node.
   * @param {import("./layout.js").NodeLayout[]} nodes
   * @returns {Map<string, ReturnType<typeof fitLabel>>} fit per node id
   */
  const fitAndPlaceLabels = (nodes) => {
    const fits = new Map();
    for (const nd of nodes) fits.set(nd.id, fitLabel(nd, labelPos(nd).maxWidth));
    for (let layer = 1; layer <= 3; layer += 1) {
      const members = nodes.filter((nd) => nd.layer === layer);
      const placed = resolveLabelCollisions(
        members.map((nd) => ({ y: nd.cy, h: fits.get(nd.id).height })),
        TOP,
        BOTTOM,
        LABEL_GAP,
      );
      members.forEach((nd, i) => { nd.labelY = r2(placed[i]); });
    }
    return fits;
  };

  /**
   * Render a node label as tspans inside `textSel` (positioned by the text's transform).
   * @param {object} textSel d3 selection of one <text>
   * @param {import("./layout.js").NodeLayout} d
   * @param {ReturnType<typeof fitLabel>} fit
   * @param {string} primaryFill
   * @param {string} secondaryFill
   */
  const renderLabel = (textSel, d, fit, primaryFill, secondaryFill) => {
    const pos = labelPos(d);
    textSel.attr("text-anchor", pos.anchor).classed("is-compact", fit.compact);
    textSel.selectAll("tspan")
      .data(fit.lines)
      .join("tspan")
      .attr("x", 0)
      .attr("y", (ln) => ln.y)
      .attr("font-size", (ln) => ln.size)
      .attr("fill", (ln) => (ln.primary && !fit.compact ? primaryFill : secondaryFill))
      .attr("textLength", (ln) => (ln.width > pos.maxWidth ? r2(pos.maxWidth) : null))
      .attr("lengthAdjust", (ln) => (ln.width > pos.maxWidth ? "spacingAndGlyphs" : null))
      .text((ln) => ln.text);
  };

  /**
   * @param {import("./layout.js").NodeLayout} d
   * @returns {string} SVG transform placing the label block at its (de-collided) anchor
   */
  const labelTransform = (d) => `translate(${r2(labelPos(d).x)}, ${r2(Number.isFinite(d.labelY) ? d.labelY : d.cy)})`;

  /**
   * Tooltip model shared stats block.
   * @param {{ n: number, wins: number, rawRate: number }} d
   * @returns {object}
   */
  const statsOf = (d) => {
    const baseline = lastSnapshot && lastSnapshot.baseline ? lastSnapshot.baseline.rawRate : NaN;
    const ci = computeWilsonCI(d.wins, d.n);
    return {
      n: d.n,
      wins: d.wins,
      rawRate: d.rawRate,
      ci: { low: ci.low, high: ci.high },
      deltaVsBaseline: d.n > 0 && Number.isFinite(baseline) ? d.rawRate - baseline : NaN,
    };
  };

  /** @returns {boolean} whether the current dag model has a node selection */
  const hasSelection = () => Boolean(lastSnapshot && lastSnapshot.viewModels && lastSnapshot.viewModels.dag.hasSelection);

  /**
   * @param {import("./layout.js").NodeLayout} d
   * @returns {object} tooltip model
   */
  const nodeTooltipModel = (d) => {
    const rows = [];
    if (hasSelection()) rows.push({ label: "In your selection", value: `${fmtInt(d.nActive)} points` });
    if (d.aggregated && d.members.length > 0) {
      rows.push({ label: "Includes (each under 3%)", value: d.members.map((m) => NODE_LABELS[m] || m).join(", ") });
    }
    return {
      title: d.label,
      subtitle: `${LAYER_TITLES[d.layer - 1]} · ${pct(d.share)} of points`,
      stats: statsOf(d),
      rows,
    };
  };

  /**
   * @param {import("./layout.js").LinkLayout} d
   * @returns {object} tooltip model
   */
  const linkTooltipModel = (d) => {
    const src = d.sourceNode;
    const tgt = d.targetNode;
    const rows = [{
      label: `Share of "${src.label}" points`,
      value: src.n > 0 ? pct(d.n / src.n) : "n/a",
    }];
    if (hasSelection()) rows.push({ label: "In your selection", value: `${fmtInt(d.nActive)} points` });
    if (d.pruned) rows.push({ label: "Rare path", value: "under 1% of points (dashed)" });
    return {
      title: `${src.label} → ${tgt.label}`,
      subtitle: `${pct(d.share)} of points take this path`,
      stats: statsOf(d),
      rows,
    };
  };

  /**
   * Accessible name of a ribbon.
   * @param {import("./layout.js").LinkLayout} d
   * @returns {string}
   */
  const linkAriaLabel = (d) => `${d.sourceNode.label} → ${d.targetNode.label}: ${d.n} points, `
    + `${d.n > 0 ? pct(d.rawRate) : "n/a"} server win rate${d.pruned ? ", pruned" : ""}`;

  /**
   * Hover element for a node.
   * @param {import("./layout.js").NodeLayout} d
   * @returns {object}
   */
  const nodeHoverElement = (d) => ({ view: "dag", kind: "node", key: d.id, [LAYER_HOVER_FIELDS[d.layer - 1]]: d.id });

  /**
   * Hover element for a link.
   * @param {import("./layout.js").LinkLayout} d
   * @returns {object}
   */
  const linkHoverElement = (d) => (d.layerPair === "12"
    ? { view: "dag", kind: "link", key: d.key, serveDir: d.source, returnDepth: d.target }
    : { view: "dag", kind: "link", key: d.key, returnDepth: d.source, thirdShot: d.target });

  /**
   * @param {"node"|"link"} kind
   * @param {string} key
   * @param {object} evt     pointer or focus event (focus events are anchored by the tooltip)
   * @param {object} model   tooltip model
   * @param {object} hovered hover element
   */
  const beginHover = (kind, key, evt, model, hovered) => {
    if (destroyed) return;
    hover = { kind, key, evt };
    if (ctx.tooltip) ctx.tooltip.show(evt, model);
    if (ctx.store) ctx.store.setHovered(hovered);
  };

  const endHover = () => {
    if (ctx.tooltip) ctx.tooltip.hide();
    if (hover && ctx.store) ctx.store.setHovered(null);
    hover = null;
  };

  const moveHover = (evt) => {
    if (ctx.tooltip && typeof ctx.tooltip.move === "function") ctx.tooltip.move(evt);
  };

  /**
   * Keep an open tooltip truthful after a re-render: re-show it with the refreshed datum, or
   * close it (and release the hover) when the mark no longer exists.
   */
  const refreshHover = () => {
    if (!hover || !layout) return;
    if (hover.kind === "node") {
      const nd = layout.byId.get(hover.key);
      if (nd && ctx.tooltip) { ctx.tooltip.show(hover.evt, nodeTooltipModel(nd)); return; }
    } else {
      const l = layout.links.find((x) => x.key === hover.key);
      if (l && ctx.tooltip) { ctx.tooltip.show(hover.evt, linkTooltipModel(l)); return; }
    }
    endHover();
  };

  /**
   * Node click: toggle the node's category in its layer's set (the store handles the sink).
   * @param {import("./layout.js").NodeLayout} d
   */
  const onNodeClick = (d) => {
    if (destroyed || !ctx.store) return;
    ctx.store.toggleSetItem(LAYER_SET_KEYS[d.layer - 1], d.id);
  };

  /**
   * Bind (or re-bind: d3 `.on` replaces by name) the interaction listeners of the node groups.
   * Called on the merged selection so a node that re-enters while exiting is re-armed.
   * @param {object} sel d3 selection of node <g>
   */
  const bindNodeListeners = (sel) => {
    sel
      .on("click", (_, nd) => onNodeClick(nd))
      .on("keydown", (evt, nd) => {
        if (isActivationKey(evt)) {
          evt.preventDefault();
          onNodeClick(nd);
        }
      })
      .on("pointerenter", (evt, nd) => beginHover("node", nd.id, evt, nodeTooltipModel(nd), nodeHoverElement(nd)))
      .on("pointermove", (evt) => moveHover(evt))
      .on("pointerleave", () => endHover())
      .on("focus", (evt, nd) => beginHover("node", nd.id, evt, nodeTooltipModel(nd), nodeHoverElement(nd)))
      .on("blur", () => endHover());
  };

  /**
   * Bind the interaction listeners of the ribbon paths (see bindNodeListeners).
   * @param {object} sel d3 selection of link <path>
   */
  const bindLinkListeners = (sel) => {
    sel
      // MVP: ribbons are details-on-demand only (hover / focus tooltip); selection is by node.
      .on("pointerenter", (evt, l) => beginHover("link", l.key, evt, linkTooltipModel(l), linkHoverElement(l)))
      .on("pointermove", (evt) => moveHover(evt))
      .on("pointerleave", () => endHover())
      .on("focus", (evt, l) => beginHover("link", l.key, evt, linkTooltipModel(l), linkHoverElement(l)))
      .on("blur", () => endHover());
  };

  /** Listener names bound by bindNodeListeners / bindLinkListeners. */
  const LISTENERS = ["click", "keydown", "pointerenter", "pointermove", "pointerleave", "focus", "blur"];

  /**
   * Remove every listener bound by this view from a selection.
   * @param {object} sel
   */
  const unbindListeners = (sel) => {
    for (const name of LISTENERS) sel.on(name, null);
  };

  /**
   * Toggle highlight classes from the store's hoveredElement (any view). Nodes match when the
   * hovered category equals their id (or, for the sink, one of its members). Links match on both
   * endpoints when the hover names two or more categories (e.g. a court cell), and on either
   * endpoint when it names a single category (a node hover).
   * @param {object|null} hovered
   */
  const applyHover = (hovered) => {
    const h = hovered && typeof hovered === "object" ? hovered : null;
    const fields = h ? [h.serveDir, h.returnDepth, h.thirdShot] : [null, null, null];
    const defined = fields.filter((v) => typeof v === "string" && v.length > 0).length;
    const nodeMatches = (nd) => {
      if (defined === 0) return false;
      const v = fields[nd.layer - 1];
      if (typeof v !== "string") return false;
      return v === nd.id || (nd.aggregated && nd.members.includes(v));
    };
    nodesG.selectAll("g.tva-dag__node").classed("is-hover", (nd) => nodeMatches(nd));
    const linkMatches = (l) => {
      if (defined === 0) return false;
      const s = nodeMatches(l.sourceNode);
      const t = nodeMatches(l.targetNode);
      return defined >= 2 ? s && t : s || t;
    };
    linksG.selectAll("path.tva-dag__link")
      .classed("is-hover", (l) => linkMatches(l))
      .attr("stroke", (l) => (!l.pruned && linkMatches(l) ? rateFill(colorScale, l) : neutralStroke(l)));
  };

  /**
   * Resting colour of a band: neutral grey, so the coloured blocks, the hovered band and the
   * selected flow stand out (Ware: pop-out needs a quiet background). Dashed rare paths stay text-2.
   * @param {import("./layout.js").LinkLayout} l
   * @returns {string}
   */
  const neutralStroke = (l) => (l.pruned ? cssText2() : "var(--tva-context)");

  // ----------------------------------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------------------------------

  /**
   * Full (re)render on a filter / init / reset change with 300 ms easeCubicOut transitions.
   * @param {object} snapshot
   */
  const render = (snapshot) => {
    const dag = snapshot.viewModels.dag;
    layout = computeDagLayout(dag);
    const fits = fitAndPlaceLabels(layout.nodes);
    const selectionActive = dag.hasSelection === true;
    const t = svg.transition(uid).duration(TRANSITION_MS).ease(d3.easeCubicOut);
    const accent = cssAccent();
    const text2 = cssText2();
    const text1 = cssText();

    emptyText.transition(t).attr("opacity", dag.n > 0 ? 0 : 1);
    emptyText.attr("aria-hidden", dag.n > 0 ? "true" : "false");

    // --- context ribbons -------------------------------------------------------------------
    const contextOpacity = (l) => {
      if (l.pruned) return selectionActive && !l.emphasized ? OPACITY.faded : OPACITY.pruned;
      return selectionActive ? OPACITY.faded : OPACITY.context;
    };
    const contextStroke = (l) => neutralStroke(l);
    const contextWidth = (l) => (l.pruned ? 1 : Math.max(l.width, 0));
    const contextDash = (l) => (l.pruned ? "3 2" : null);

    const linkSel = linksG.selectAll("path.tva-dag__link")
      .data(layout.links, (l) => l.key)
      .join(
        (enter) => enter.append("path")
          .attr("class", "tva-dag__link")
          .attr("d", (l) => l.d)
          .attr("stroke", contextStroke)
          .attr("stroke-width", 0)
          .attr("opacity", 0)
          .attr("data-key", (l) => l.key),
        // A link that comes back while still exiting: the update transition below supersedes
        // the pending removal (same transition name on the same element).
        (update) => update.classed("is-exiting", false),
        (exit) => exit
          .classed("is-exiting", true)
          .attr("tabindex", null)
          .attr("role", null)
          .call(unbindListeners)
          .call((sel) => sel.transition(t).attr("stroke-width", 0).attr("opacity", 0).remove()),
      )
      .classed("is-pruned", (l) => l.pruned)
      .classed("is-emphasized", (l) => selectionActive && l.emphasized)
      .attr("stroke-dasharray", contextDash)
      .attr("tabindex", (l) => (l.pruned ? null : 0))
      .attr("role", (l) => (l.pruned ? null : "img"))
      .attr("aria-label", linkAriaLabel)
      .call(bindLinkListeners)
      .attr("stroke", contextStroke)
      .call((sel) => sel.transition(t)
        .attr("d", (l) => l.d)
        .attr("stroke-width", contextWidth)
        .attr("opacity", contextOpacity));

    // --- emphasized overlays (active flow, width nActive, aligned to the slot start) ---------
    const overlays = selectionActive ? layout.links.filter((l) => l.emphasized && l.nActive > 0) : [];
    activeG.selectAll("path.tva-dag__link-active")
      .data(overlays, (l) => l.key)
      .join(
        (enter) => enter.append("path")
          .attr("class", "tva-dag__link-active")
          .attr("d", (l) => l.dActive)
          .attr("stroke", (l) => rateFill(colorScale, l))
          .attr("stroke-width", 0)
          .attr("opacity", OPACITY.emphasized),
        (update) => update,
        (exit) => exit.call((sel) => sel.transition(t).attr("stroke-width", 0).attr("opacity", 0).remove()),
      )
      .call((sel) => sel.transition(t)
        .attr("d", (l) => l.dActive)
        .attr("stroke", (l) => rateFill(colorScale, l))
        .attr("stroke-width", (l) => Math.max(l.widthActive, 1))
        .attr("opacity", OPACITY.emphasized));

    // --- nodes ----------------------------------------------------------------------------
    const nodeSel = nodesG.selectAll("g.tva-dag__node")
      .data(layout.nodes, (nd) => nd.id)
      .join(
        (enter) => {
          const g = enter.append("g")
            .attr("class", "tva-dag__node")
            .attr("role", "button")
            .attr("data-id", (nd) => nd.id);
          // Enter from zero height at the bar's centre.
          g.append("rect")
            .attr("class", "tva-dag__bar")
            .attr("x", (nd) => nd.x)
            .attr("y", (nd) => nd.cy)
            .attr("width", BAR_W)
            .attr("height", 0)
            .attr("rx", 2)
            .attr("fill", (nd) => rateFill(colorScale, nd));
          g.append("text")
            .attr("class", "tva-dag__label")
            .attr("dominant-baseline", "middle")
            .attr("transform", labelTransform)
            .attr("opacity", 0);
          return g;
        },
        // A node that comes back while still exiting: cancel the pending `.remove()` scheduled
        // on the <g> (its children are superseded by the update transitions below).
        (update) => {
          update.filter(".is-exiting").interrupt(uid).classed("is-exiting", false);
          return update;
        },
        (exit) => {
          exit.classed("is-exiting", true)
            .attr("tabindex", null)
            .call(unbindListeners);
          // Exit to zero height at the bar's centre.
          exit.select("rect").transition(t).attr("y", (nd) => nd.cy).attr("height", 0);
          exit.select("text").transition(t).attr("opacity", 0);
          exit.transition(t).remove();
          return exit;
        },
      );

    nodeSel
      .attr("tabindex", 0)
      .classed("is-selected", (nd) => nd.selected)
      .classed("is-aggregated", (nd) => nd.aggregated)
      .attr("aria-pressed", (nd) => (nd.selected ? "true" : "false"))
      .attr("aria-label", (nd) => `${LAYER_TITLES[nd.layer - 1]}: ${nd.label}, ${countAria(nd)}, `
        + `${nd.n > 0 ? pct(nd.rawRate) : "n/a"} server win rate`)
      .call(bindNodeListeners);

    // Nodes without active flow are greyed out while a selection exists (a faded data colour
    // would read as "closer to 50%" on the lightness-coded scale).
    const nodeDimmed = (nd) => selectionActive && nd.nActive === 0 && !nd.selected;
    nodeSel.transition(t).attr("opacity", 1);

    nodeSel.select("rect")
      .attr("stroke", (nd) => (nd.selected ? accent : "none"))
      .attr("stroke-width", (nd) => (nd.selected ? 2 : 0))
      .transition(t)
      .attr("x", (nd) => nd.x)
      .attr("y", (nd) => nd.y)
      .attr("height", (nd) => nd.h)
      .attr("fill", (nd) => (nodeDimmed(nd) ? NODE_DIM_FILL : rateFill(colorScale, nd)));

    nodeSel.select("text")
      .attr("aria-hidden", (nd) => (nd.n > 0 ? null : "true"))
      .each(function renderEach(nd) { renderLabel(d3.select(this), nd, fits.get(nd.id), text1, text2); })
      .transition(t)
      .attr("transform", labelTransform)
      .attr("opacity", (nd) => (nd.n > 0 ? 1 : 0));

    // Keep an open tooltip truthful after a recompute: re-show it with the fresh numbers.
    refreshHover();
  };

  // ----------------------------------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------------------------------
  return {
    /**
     * @param {object} snapshot   store snapshot ({ state, activePoints, baseline, viewModels, timing })
     * @param {{ type: "init"|"filter"|"reset"|"hover"|"theme", keys?: string[] }} [change]
     */
    update(snapshot, change) {
      if (destroyed || !snapshot || !snapshot.viewModels || !snapshot.viewModels.dag) return;
      const type = change && change.type;
      // Every chrome colour is a CSS variable: a theme change needs no re-layout.
      if (type === "theme") return;
      lastSnapshot = snapshot;
      // A new store (dataset swap) starts with no hover: drop ours instead of refreshing it.
      if (type === "init" && hover) {
        if (ctx.tooltip) ctx.tooltip.hide();
        hover = null;
      }
      if (type !== "hover") render(snapshot);
      applyHover(snapshot.state ? snapshot.state.hoveredElement : null);
    },

    /** Remove the SVG, its listeners and any hover state this view owns. */
    destroy() {
      if (destroyed) return;
      endHover();
      destroyed = true;
      unbindListeners(nodesG.selectAll("g.tva-dag__node"));
      unbindListeners(linksG.selectAll("path.tva-dag__link"));
      svg.selectAll("*").interrupt();
      svg.remove();
      layout = null;
      lastSnapshot = null;
    },
  };
}
