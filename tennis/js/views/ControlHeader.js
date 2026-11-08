/**
 * ControlHeader.js - global control bar and KPI strip (guideline section 4 GLOBAL CONTROL BAR +
 * KPI STRIP; api_contract.md "KPI strip (ControlHeader)").
 *
 * MVP scope: one dataset, one theme. The header holds the title, the global filters of
 * guideline section 6.1 (player = server, surface, ATP event tier, pressure, serve number), Reset, and three
 * KPI tiles (active points, server win % with its Wilson interval, mean rally length).
 *
 *   headerEl
 *   |- div.tva-filters[role=toolbar]
 *   |  |- div.tva-title                  name + data line
 *   |  |- div.tva-filters__fields#id     selects + Reset (folded behind the toggle on phones)
 *   |  `- div.tva-filters__actions       "Filters" toggle (phones only) + slot for the help button
 *   `- div.tva-kpis[role=list]         div.tva-kpi[data-kpi=active|win|rally] (x3), each with a
 *                                      bullet-style meter: a bar for the value and a tick for all
 *                                      points, on a scale starting at zero (length, not just text)
 *
 * Selects dispatch ctx.store.setFilter(key, value); update(snapshot) syncs them back from
 * snapshot.state without re-dispatching (a programmatic `select.value = ...` never fires
 * "change"). All text via textContent, never innerHTML.
 *
 * @module ControlHeader
 */

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { SURFACES, PRESSURE_STATES } from "../core/DataAdapter.js";
import { formatPct } from "../core/StatsEngine.js";
import { TRANSITION_MS, signedPp } from "./scales.js";
import { createServerSearch } from "./ServerSearch.js";

/** Friendly labels for the pressure select. */
const PRESSURE_LABELS = Object.freeze({
  ALL: "All situations",
  Baseline: "Baseline",
  BreakPoint: "Break point",
  GamePoint: "Game point",
  Tiebreak: "Tiebreak",
});

const EMPTY_VALUE = "—"; // em dash
const NO_MATCH_TEXT = "No points match the current filters";

const formatInt = d3.format(",d");

/** @param {number} x @param {number} [digits=1] */
const pct = (x, digits = 1) => formatPct(x, digits);

/**
 * Signed shot difference, e.g. "+0.35" / "-1.20".
 * @param {number} delta
 * @returns {string}
 */
function signedShots(delta) {
  if (!Number.isFinite(delta)) return "n/a";
  return `${delta < 0 ? "-" : "+"}${Math.abs(delta).toFixed(2)}`;
}

/**
 * Create an element with class and optional text.
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Replace the options of a select (no innerHTML).
 * @param {HTMLSelectElement} select
 * @param {Array<{ value: string, label: string }>} options
 */
function fillOptions(select, options) {
  while (select.firstChild) select.removeChild(select.firstChild);
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    select.appendChild(o);
  }
}

/**
 * Build a labelled select.
 * @param {string} field       data-field value
 * @param {string} labelText
 * @param {Array<{ value: string, label: string }>} options
 * @returns {{ wrap: HTMLLabelElement, select: HTMLSelectElement }}
 */
function buildSelect(field, labelText, options) {
  const wrap = /** @type {HTMLLabelElement} */ (el("label", "tva-field"));
  wrap.dataset.field = field;
  wrap.appendChild(el("span", "tva-field__label", labelText));
  const select = /** @type {HTMLSelectElement} */ (el("select", "tva-select"));
  select.name = field;
  select.setAttribute("aria-label", labelText);
  fillOptions(select, options);
  wrap.appendChild(select);
  return { wrap, select };
}

/**
 * The three KPI tiles (order: Active points, Server win %, Rally mean).
 * @type {ReadonlyArray<{ id: string, label: string, symbol?: string, definition: string, format: (v: number) => string }>}
 */
const TILE_DEFS = Object.freeze([
  {
    id: "active",
    label: "Points shown",
    definition: "Points that match every filter and selection you have made.",
    format: (v) => (Number.isFinite(v) ? formatInt(Math.round(v)) : "n/a"),
  },
  {
    id: "win",
    label: "Won by the server",
    definition: "Share of these points won by the player serving, with its 95% range and the difference from all points.",
    format: (v) => pct(v, 1),
  },
  {
    id: "rally",
    label: "Average rally",
    definition: "Average number of shots per point (the serve counts as one), compared with all points.",
    format: (v) => (Number.isFinite(v) ? `${v.toFixed(1)} shots` : "n/a"),
  },
]);

/**
 * Create the control header (filter row and KPI strip).
 * @param {HTMLElement} headerEl   the `.tva-header` region created by main.js
 * @param {{ store: object, tooltip?: { show: Function, move: Function, hide: Function }, subtitleEl?: HTMLElement }} ctx
 * @returns {{ update: (snapshot: object, change?: { type: string }) => void, destroy: () => void,
 *   elements: { filters: HTMLElement, kpis: HTMLElement, selects: Record<string, HTMLSelectElement>, resetButton: HTMLButtonElement } }}
 */
export function createControlHeader(headerEl, ctx) {
  if (!headerEl || typeof headerEl.appendChild !== "function") {
    throw new TypeError("createControlHeader: headerEl must be a DOM element");
  }
  if (!ctx || !ctx.store) throw new TypeError("createControlHeader: ctx.store is required");

  const abort = new AbortController();
  const { signal } = abort;
  let destroyed = false;
  let lastSnapshot = null;
  let playersKey = null;

  // ---- row 1: title + filters -------------------------------------------------------------
  const filters = el("div", "tva-filters");
  filters.setAttribute("role", "toolbar");
  filters.setAttribute("aria-label", "Global filters");

  const title = el("div", "tva-title");
  title.appendChild(el("h1", "tva-title__h1", "Holding Serve"));
  if (ctx.subtitleEl && typeof ctx.subtitleEl.nodeType === "number") {
    title.appendChild(ctx.subtitleEl);
  } else {
    title.appendChild(el("p", "tva-title__sub", "Match Charting Project · serve, return and rally"));
  }
  filters.appendChild(title);

  // Searchable server field (about 380 names): see ServerSearch.js.
  const playerSearch = createServerSearch(document, {
    onPick: (name) => ctx.store.setFilter("playerFilter", name),
  });
  const surfaceSel = buildSelect("surface", "Surface", [
    { value: "ALL", label: "All surfaces" },
    ...SURFACES.map((s) => ({ value: s, label: s })),
  ]);
  const tiers = typeof ctx.store.getEventTiers === "function" ? ctx.store.getEventTiers() : [];
  const tierSel = buildSelect("event", "Event", [
    { value: "ALL", label: "All events" },
    ...tiers.map((t) => ({ value: t, label: t })),
  ]);
  if (tiers.length === 0) tierSel.wrap.hidden = true;
  const pressureSel = buildSelect("pressure", "Pressure", [
    { value: "ALL", label: PRESSURE_LABELS.ALL },
    ...PRESSURE_STATES.map((p) => ({ value: p, label: PRESSURE_LABELS[p] || p })),
  ]);
  const serveSel = buildSelect("serve", "Serve", [
    { value: "ALL", label: "Both serves" },
    { value: "1", label: "1st serve" },
    { value: "2", label: "2nd serve" },
  ]);
  const fields = el("div", "tva-filters__fields");
  fields.id = `tva-filter-fields-${Math.random().toString(36).slice(2, 8)}`;
  for (const s of [playerSearch, surfaceSel, tierSel, pressureSel, serveSel]) fields.appendChild(s.wrap);

  const resetButton = /** @type {HTMLButtonElement} */ (el("button", "tva-btn tva-btn--reset", "Reset"));
  resetButton.type = "button";
  resetButton.title = "Clear every filter and selection";
  fields.appendChild(resetButton);
  filters.appendChild(fields);

  // Phones: the selects fold behind this toggle (CSS shows it below 640 px only).
  const actions = el("div", "tva-filters__actions");
  const filterToggle = /** @type {HTMLButtonElement} */ (el("button", "tva-btn tva-filters__toggle", "Filters"));
  filterToggle.type = "button";
  filterToggle.setAttribute("aria-expanded", "false");
  filterToggle.setAttribute("aria-controls", fields.id);
  actions.appendChild(filterToggle);
  filters.appendChild(actions);
  filterToggle.addEventListener("click", () => {
    const open = !filters.classList.contains("is-open");
    filters.classList.toggle("is-open", open);
    filterToggle.setAttribute("aria-expanded", String(open));
  });

  // ---- row 2: KPI strip ------------------------------------------------------------------
  const kpis = el("div", "tva-kpis");
  kpis.setAttribute("role", "list");
  kpis.setAttribute("aria-label", "Key performance indicators");

  /**
   * @typedef {object} Tile
   * @property {string} id
   * @property {HTMLElement} root
   * @property {HTMLElement} valueEl
   * @property {HTMLElement} subEl
   * @property {number|null} current  value currently displayed (tween state)
   * @property {number} raf           pending requestAnimationFrame id (0 = none)
   * @property {object|null} model    last tooltip model
   */
  /** @type {Tile[]} */
  const tiles = TILE_DEFS.map((def) => {
    const root = el("div", "tva-kpi");
    root.dataset.kpi = def.id;
    root.setAttribute("role", "listitem");
    const labelEl = el("span", "tva-kpi__label", def.label);
    if (def.symbol) {
      // Greek symbols get their own span so the CSS upper-casing skips them.
      labelEl.appendChild(document.createTextNode(" "));
      labelEl.appendChild(el("span", "tva-kpi__symbol", def.symbol));
    }
    root.appendChild(labelEl);
    const valueEl = el("span", "tva-kpi__value", EMPTY_VALUE);
    const subEl = el("span", "tva-kpi__sub", "");
    // Bullet-style meter: value as a bar from zero, "all points" as a tick on the same scale.
    const meter = el("span", "tva-kpi__meter");
    meter.setAttribute("aria-hidden", "true");
    const meterFill = el("span", "tva-kpi__meter-fill");
    const meterMark = el("span", "tva-kpi__meter-mark");
    meterMark.title = "All points";
    meter.append(meterFill, meterMark);
    root.appendChild(valueEl);
    root.appendChild(meter);
    root.appendChild(subEl);
    kpis.appendChild(root);
    return { id: def.id, root, valueEl, subEl, meterFill, meterMark, current: null, raf: 0, model: null };
  });
  const tileDef = Object.fromEntries(TILE_DEFS.map((d) => [d.id, d]));

  headerEl.appendChild(filters);
  headerEl.appendChild(kpis);

  // ---- event wiring ----------------------------------------------------------------------
  /**
   * @param {HTMLSelectElement} select
   * @param {string} key
   * @param {(v: string) => unknown} [coerce]
   */
  function bindSelect(select, key, coerce = (v) => v) {
    select.addEventListener("change", () => {
      ctx.store.setFilter(key, coerce(select.value));
    }, { signal });
  }
  bindSelect(surfaceSel.select, "surfaceFilter");
  bindSelect(tierSel.select, "eventTierFilter");
  bindSelect(pressureSel.select, "pressureFilter");
  bindSelect(serveSel.select, "serveNumberFilter", (v) => (v === "ALL" ? "ALL" : Number(v)));

  resetButton.addEventListener("click", () => { ctx.store.resetFilters(); }, { signal });

  // KPI tooltips + hover state
  for (const tile of tiles) {
    tile.root.addEventListener("pointerenter", (event) => showTileTooltip(tile, event), { signal });
    tile.root.addEventListener("pointermove", (event) => { if (tile.model && ctx.tooltip) ctx.tooltip.move(event); }, { signal });
    tile.root.addEventListener("pointerleave", () => hideTileTooltip(), { signal });
  }

  /**
   * @param {Tile} tile
   * @param {PointerEvent} event
   */
  function showTileTooltip(tile, event) {
    if (!tile.model || !ctx.tooltip) return;
    ctx.tooltip.show(event, tile.model);
    if (typeof ctx.store.setHovered === "function") {
      ctx.store.setHovered({ view: "kpi", kind: "kpi", key: tile.id });
    }
  }

  function hideTileTooltip() {
    if (ctx.tooltip) ctx.tooltip.hide();
    const hovered = lastSnapshot && lastSnapshot.state && lastSnapshot.state.hoveredElement;
    if (hovered && hovered.view === "kpi" && typeof ctx.store.setHovered === "function") {
      ctx.store.setHovered(null);
    }
  }

  // ---- number tween ----------------------------------------------------------------------
  /** @param {Tile} tile */
  function cancelTween(tile) {
    if (tile.raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(tile.raf);
    tile.raf = 0;
  }

  /**
   * Tween the tile's number to `target` over TRANSITION_MS (d3.easeCubicOut); text only.
   * @param {Tile} tile
   * @param {number} target
   * @param {(v: number) => string} format
   * @param {boolean} immediate  skip the tween (first render)
   */
  function tweenValue(tile, target, format, immediate) {
    cancelTween(tile);
    const from = tile.current;
    const canAnimate = !immediate && Number.isFinite(from) && Number.isFinite(target)
      && typeof requestAnimationFrame === "function" && from !== target;
    if (!canAnimate) {
      tile.current = Number.isFinite(target) ? target : null;
      tile.valueEl.textContent = format(target);
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / TRANSITION_MS);
      const v = from + (target - from) * d3.easeCubicOut(t);
      tile.current = t < 1 ? v : target;
      tile.valueEl.textContent = format(tile.current);
      tile.raf = t < 1 ? requestAnimationFrame(step) : 0;
    };
    tile.raf = requestAnimationFrame(step);
  }

  /**
   * @param {Tile} tile
   * @param {string} sub
   * @param {object|null} model  tooltip model
   * @param {boolean} empty
   */
  function setTileMeta(tile, sub, model, empty) {
    tile.subEl.textContent = sub;
    tile.model = model;
    tile.root.classList.toggle("is-empty", empty);
  }

  /**
   * Place a tile's meter: value and reference as fractions of the scale maximum (clamped 0..1).
   * @param {Tile} tile
   * @param {number} value
   * @param {number} reference  value for all points
   * @param {number} max        scale maximum (the scale starts at zero)
   */
  function setMeter(tile, value, reference, max) {
    const frac = (v) => (Number.isFinite(v) && max > 0 ? Math.max(0, Math.min(1, v / max)) : 0);
    tile.meterFill.style.width = `${(frac(value) * 100).toFixed(2)}%`;
    tile.meterMark.style.left = `${(frac(reference) * 100).toFixed(2)}%`;
    tile.meterMark.hidden = !Number.isFinite(reference);
  }

  // ---- renderers -------------------------------------------------------------------------
  /**
   * @param {object} snapshot
   * @param {boolean} immediate
   */
  function renderKpis(snapshot, immediate) {
    const kpi = snapshot.viewModels && snapshot.viewModels.kpi;
    const base = snapshot.baseline || {};
    const baseN = base.n > 0 ? base.n : 0;
    const [active, win, rally] = tiles;

    if (!kpi || !(kpi.n > 0)) {
      for (const tile of tiles) {
        setMeter(tile, 0, NaN, 1);
        cancelTween(tile);
        tile.current = null;
        tile.valueEl.textContent = EMPTY_VALUE;
        setTileMeta(tile, NO_MATCH_TEXT, {
          title: tileDef[tile.id].label,
          subtitle: tileDef[tile.id].definition,
          rows: [{ label: "Points shown", value: "0" }, { label: "All points", value: formatInt(baseN) }],
        }, true);
      }
      return;
    }

    const share = baseN > 0 ? kpi.n / baseN : 0;
    setMeter(active, kpi.n, baseN, baseN);
    tweenValue(active, kpi.n, tileDef.active.format, immediate);
    setTileMeta(active, share >= 0.9995 ? "all charted points" : `${pct(share, 1)} of all ${formatInt(baseN)}`, {
      title: tileDef.active.label,
      subtitle: tileDef.active.definition,
      rows: [
        { label: "Points shown", value: formatInt(kpi.n) },
        { label: "All points", value: formatInt(baseN) },
        { label: "Share", value: pct(share, 1) },
      ],
    }, false);

    const ci = kpi.ci || { low: NaN, high: NaN };
    setMeter(win, kpi.rawRate, base.rawRate, 1);
    tweenValue(win, kpi.rawRate, tileDef.win.format, immediate);
    const delta = kpi.deltaVsBaseline;
    const versus = Number.isFinite(delta) && Math.abs(delta) >= 0.0005 ? ` · ${signedPp(delta)} vs all points` : "";
    setTileMeta(win, `95% range ${pct(ci.low, 1)}–${pct(ci.high, 1)}${versus}`, {
      title: tileDef.win.label,
      subtitle: tileDef.win.definition,
      stats: {
        n: kpi.n,
        wins: kpi.wins,
        rawRate: kpi.rawRate,
        ci,
        deltaVsBaseline: kpi.deltaVsBaseline,
      },
    }, false);

    const baseMu = Number.isFinite(base.meanRally) ? base.meanRally : NaN;
    setMeter(rally, kpi.meanRally, baseMu, Number.isFinite(baseMu) ? 2 * baseMu : kpi.meanRally);
    tweenValue(rally, kpi.meanRally, tileDef.rally.format, immediate);
    setTileMeta(rally, `all points: ${tileDef.rally.format(baseMu)}`, {
      title: tileDef.rally.label,
      subtitle: tileDef.rally.definition,
      rows: [
        { label: "Points shown", value: tileDef.rally.format(kpi.meanRally) },
        { label: "All points", value: tileDef.rally.format(baseMu) },
        { label: "Difference", value: `${signedShots(kpi.meanRally - baseMu)} shots` },
      ],
    }, false);
  }

  /**
   * Count the active header filters on the phone toggle ("Filters · 2").
   * @param {object} state
   */
  function syncToggle(state) {
    const active = ["playerFilter", "surfaceFilter", "eventTierFilter", "pressureFilter", "serveNumberFilter"]
      .filter((k) => state[k] !== undefined && state[k] !== "ALL").length;
    filterToggle.textContent = active ? `Filters · ${active}` : "Filters";
  }

  /** @param {object} state */
  function syncSelects(state) {
    playerSearch.setValue(String(state.playerFilter));
    surfaceSel.select.value = String(state.surfaceFilter);
    tierSel.select.value = String(state.eventTierFilter);
    pressureSel.select.value = String(state.pressureFilter);
    serveSel.select.value = String(state.serveNumberFilter);
  }

  /** Give the server field its names and service-point counts (once per player list). */
  function syncPlayers() {
    const players = typeof ctx.store.getPlayers === "function" ? ctx.store.getPlayers() : [];
    const key = players.join("\u0000");
    if (key === playersKey) return;
    playersKey = key;
    const counts = new Map(players.map((p) => [p, 0]));
    const all = typeof ctx.store.getAllPoints === "function" ? ctx.store.getAllPoints() : [];
    for (const p of all) counts.set(p.serverName, (counts.get(p.serverName) || 0) + 1);
    playerSearch.setServers(players.map((name) => ({ name, n: counts.get(name) || 0 })));
  }

  /** @param {object|null} hovered */
  function applyHover(hovered) {
    const key = hovered && hovered.view === "kpi" ? hovered.key : null;
    for (const tile of tiles) tile.root.classList.toggle("is-hovered", tile.id === key);
  }

  // ---- public API ------------------------------------------------------------------------
  /**
   * Re-render from a store snapshot. change.type "hover" only toggles highlight classes.
   * @param {object} snapshot   ctx.store.getSnapshot() shape
   * @param {{ type: string, keys?: string[] }} [change]
   */
  function update(snapshot, change) {
    if (destroyed || !snapshot || !snapshot.state) return;
    const type = change && change.type;
    if (type === "hover" && lastSnapshot) {
      lastSnapshot = snapshot;
      applyHover(snapshot.state.hoveredElement);
      return;
    }
    const immediate = lastSnapshot === null || type === "init";
    lastSnapshot = snapshot;
    syncPlayers();
    syncSelects(snapshot.state);
    syncToggle(snapshot.state);
    renderKpis(snapshot, immediate);
    applyHover(snapshot.state.hoveredElement);
  }

  /** Remove listeners, pending tweens and all DOM created by this header. */
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    abort.abort();
    for (const tile of tiles) cancelTween(tile);
    if (ctx.tooltip && typeof ctx.tooltip.hide === "function") ctx.tooltip.hide();
    for (const node of [filters, kpis]) {
      if (node.parentNode === headerEl) headerEl.removeChild(node);
    }
    lastSnapshot = null;
  }

  return {
    update,
    destroy,
    elements: {
      filters,
      actions,
      kpis,
      selects: {
        player: playerSearch.input,
        surface: surfaceSel.select,
        event: tierSel.select,
        pressure: pressureSel.select,
        serve: serveSel.select,
      },
      resetButton,
    },
  };
}

export default createControlHeader;
