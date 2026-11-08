/**
 * TooltipManager.js - shared details-on-demand floating overlay
 * (docs/api_contract.md "Tooltip", guideline section 6.2 "Hover Any Mark").
 *
 * A single glassmorphic `.tva-tooltip` element lives inside the `.tva-root`;
 * every view calls `show(event, model)` / `move(event)` / `hide()` on the same
 * instance. All text is inserted with `textContent` (never innerHTML).
 *
 * The row-building logic (`buildTooltipRows`) is a pure function with no DOM
 * dependency so it can be unit-tested in Node. This module intentionally does
 * not use D3: it only needs the DOM.
 *
 * @module views/TooltipManager
 */

import { formatPct, LOW_SAMPLE_THRESHOLD } from "../core/StatsEngine.js";
import { signedPp } from "./scales.js";

/**
 * @typedef {object} TooltipStats
 * @property {number} n
 * @property {number} [wins]
 * @property {number} rawRate
 * @property {{ low: number, high: number }} [ci]
 * @property {number} [deltaVsBaseline]
 */

/**
 * @typedef {object} TooltipModel
 * @property {string} title
 * @property {string} [subtitle]
 * @property {TooltipStats} [stats]
 * @property {Array<{ label: string, value: string|number }>} [rows]
 */

/** Distance in px between the pointer and the tooltip box. @type {number} */
export const POINTER_OFFSET = 14;

/** Low-sample warning text (Cairo truthfulness cue). @type {string} */
export const LOW_SAMPLE_NOTICE = "⚠ Fewer than 10 points: read with care";

/** Standard stat row labels, in display order. @type {Readonly<Record<string,string>>} */
export const STAT_LABELS = Object.freeze({
  n: "Points",
  rawRate: "Won by the server",
  ci: "95% range",
  delta: "Compared with all points"
});

/**
 * Format an integer count with thousands separators ("1,234"); non-finite -> "n/a".
 * @param {number} n
 * @returns {string}
 */
function formatCount(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "n/a";
  return Math.round(n).toLocaleString("en-US");
}

/**
 * Pure helper: build the ordered list of label/value rows for a tooltip model.
 * Standard stats rows come first (only when `model.stats` is present), then
 * any custom `model.rows` in the order given. Values are always strings.
 *
 * @param {TooltipModel|null|undefined} model
 * @returns {Array<{ label: string, value: string }>}
 */
export function buildTooltipRows(model) {
  const rows = [];
  if (!model || typeof model !== "object") return rows;
  const stats = model.stats;
  if (stats && typeof stats === "object") {
    rows.push({ label: STAT_LABELS.n, value: formatCount(stats.n) });
    rows.push({ label: STAT_LABELS.rawRate, value: formatPct(stats.rawRate) });
    const ci = stats.ci;
    const ciText =
      ci && typeof ci === "object" && Number.isFinite(ci.low) && Number.isFinite(ci.high)
        ? `${formatPct(ci.low)} – ${formatPct(ci.high)}`
        : "n/a";
    rows.push({ label: STAT_LABELS.ci, value: ciText });
    rows.push({ label: STAT_LABELS.delta, value: signedPp(stats.deltaVsBaseline) });
  }
  if (Array.isArray(model.rows)) {
    for (const r of model.rows) {
      if (!r || typeof r !== "object") continue;
      rows.push({ label: String(r.label ?? ""), value: r.value == null ? "" : String(r.value) });
    }
  }
  return rows;
}

/**
 * Pure helper: whether the model's stats warrant the low-sample notice
 * (n < LOW_SAMPLE_THRESHOLD, including n = 0 / missing n).
 * @param {TooltipModel|null|undefined} model
 * @returns {boolean}
 */
export function isLowSample(model) {
  const stats = model && model.stats;
  if (!stats || typeof stats !== "object") return false;
  const n = Number.isFinite(stats.n) ? stats.n : 0;
  return n < LOW_SAMPLE_THRESHOLD;
}

/**
 * Pure helper: compute the top/left of a box of size (w, h) anchored at a
 * pointer (x, y) with `POINTER_OFFSET`, flipping to the other side when the
 * box would overflow the right/bottom viewport edge, and clamped to >= 4 px.
 *
 * @param {{ x: number, y: number }} anchor   pointer position in viewport px
 * @param {{ w: number, h: number }} box      tooltip size in px
 * @param {{ w: number, h: number }} viewport viewport size in px
 * @param {number} [offset=POINTER_OFFSET]
 * @returns {{ left: number, top: number }}
 */
export function computeTooltipPosition(anchor, box, viewport, offset = POINTER_OFFSET) {
  let left = anchor.x + offset;
  let top = anchor.y + offset;
  if (left + box.w > viewport.w - 4) left = anchor.x - offset - box.w;
  if (top + box.h > viewport.h - 4) top = anchor.y - offset - box.h;
  if (left < 4) left = 4;
  if (top < 4) top = 4;
  return { left, top };
}

/**
 * Resolve the anchor point of an event: pointer coordinates for mouse/pointer
 * events, or the right-middle edge of the focused element's bounding rect for
 * keyboard focus events (no clientX/clientY).
 * @param {Event & { clientX?: number, clientY?: number }} event
 * @returns {{ x: number, y: number }}
 */
function anchorOf(event) {
  if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    return { x: event.clientX, y: event.clientY };
  }
  const target = event && (event.currentTarget || event.target);
  if (target && typeof target.getBoundingClientRect === "function") {
    const r = target.getBoundingClientRect();
    return { x: r.right, y: r.top + r.height / 2 };
  }
  return { x: 0, y: 0 };
}

/**
 * Create (or adopt) the shared tooltip element inside `rootEl`.
 *
 * @param {HTMLElement} rootEl  the `.tva-root` element (tooltip is appended to it if missing)
 * @returns {{
 *   show: (event: Event, model: TooltipModel) => void,
 *   move: (event: Event) => void,
 *   hide: () => void,
 *   destroy: () => void,
 *   element: HTMLElement
 * }}
 */
export function createTooltip(rootEl) {
  const doc = rootEl.ownerDocument || document;
  let el = rootEl.querySelector(".tva-tooltip");
  const created = !el;
  if (!el) {
    el = doc.createElement("div");
    el.className = "tva-tooltip";
    rootEl.appendChild(el);
  }
  el.setAttribute("role", "tooltip");
  el.setAttribute("aria-hidden", "true");

  let lastAnchor = { x: 0, y: 0 };
  let visible = false;

  /**
   * Append a child element with text.
   * @param {HTMLElement} parent
   * @param {string} tag
   * @param {string} className
   * @param {string} text
   * @returns {HTMLElement}
   */
  function addText(parent, tag, className, text) {
    const node = doc.createElement(tag);
    node.className = className;
    node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  /**
   * Rebuild the tooltip DOM from a model.
   * @param {TooltipModel} model
   */
  function render(model) {
    while (el.firstChild) el.removeChild(el.firstChild);
    const m = model || { title: "" };
    addText(el, "div", "tva-tooltip__title", String(m.title ?? ""));
    if (m.subtitle) addText(el, "div", "tva-tooltip__subtitle", String(m.subtitle));
    const rows = buildTooltipRows(m);
    if (rows.length) {
      const list = doc.createElement("div");
      list.className = "tva-tooltip__rows";
      for (const r of rows) {
        const row = doc.createElement("div");
        row.className = "tva-tooltip__row";
        addText(row, "span", "tva-tooltip__label", r.label);
        addText(row, "span", "tva-tooltip__value", r.value);
        list.appendChild(row);
      }
      el.appendChild(list);
    }
    if (isLowSample(m)) addText(el, "div", "tva-tooltip__notice", LOW_SAMPLE_NOTICE);
  }

  /** Position the box relative to the last anchor, flipping at viewport edges. */
  function place() {
    const win = doc.defaultView || window;
    const rect = el.getBoundingClientRect();
    const pos = computeTooltipPosition(
      lastAnchor,
      { w: rect.width, h: rect.height },
      { w: win.innerWidth, h: win.innerHeight }
    );
    el.style.left = `${Math.round(pos.left)}px`;
    el.style.top = `${Math.round(pos.top)}px`;
  }

  return {
    element: el,
    /**
     * Show the tooltip for a model at the event's anchor.
     * @param {Event} event mouse/pointer event, or focus event (positions near the target)
     * @param {TooltipModel} model
     */
    show(event, model) {
      render(model);
      lastAnchor = anchorOf(event);
      el.setAttribute("aria-hidden", "false");
      visible = true;
      place();
    },
    /**
     * Reposition the visible tooltip (no-op while hidden).
     * @param {Event} event
     */
    move(event) {
      if (!visible) return;
      lastAnchor = anchorOf(event);
      place();
    },
    /** Hide the tooltip (content is kept until the next show). */
    hide() {
      visible = false;
      el.setAttribute("aria-hidden", "true");
    },
    /** Hide and remove the element if this manager created it. */
    destroy() {
      visible = false;
      el.setAttribute("aria-hidden", "true");
      while (el.firstChild) el.removeChild(el.firstChild);
      if (created && el.parentNode) el.parentNode.removeChild(el);
    }
  };
}
