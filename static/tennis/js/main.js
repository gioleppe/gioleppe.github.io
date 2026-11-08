/**
 * main.js - application bootstrapper and public embed API
 * (docs/implementation_guideline.md section 7.2, docs/api_contract.md "Public API (js/main.js)").
 *
 * `mountTennisDashboard(containerEl, opts)` builds the root markup inside the host container,
 * loads the dataset, creates the reactive StateStore, the shared tooltip and the five views
 * (ControlHeader, StoryStrip, CourtMapView, TacticalDagView, RallyHorizonView), wires every
 * view to the store (views never subscribe themselves) and returns a small controller.
 *
 * MVP scope: one dataset (the recent MCP extract), one warm light theme, one guided story.
 *
 * Views are loaded with dynamic imports so that a failing view module or factory is reported
 * inside its own section (`.tva-error`) without preventing the other views from mounting.
 *
 * @module main
 */

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { loadDataset } from "./core/DataAdapter.js";
import { applyTheme } from "./core/palette.js";
import {
  StateStore,
  encodeFilterStateToQuery,
  decodeFilterStateFromQuery,
} from "./core/StateStore.js";

/** Debounce delay (ms) before the filter state is written back to `location.hash`. */
const HASH_WRITE_DEBOUNCE_MS = 150;

/** Attribution footer text (CC BY-NC-SA 4.0 requires attribution). */
const ATTRIBUTION_TEXT = "Data: Match Charting Project, Jeff Sackmann and volunteer contributors";

/**
 * Section descriptors in grid order. `module` is resolved relative to this file; `factories`
 * lists the accepted export names (first match wins, `default` as a last resort).
 * @type {ReadonlyArray<{ id: string, title: string, module: string, factories: string[] }>}
 */
const VIEW_SPECS = Object.freeze([
  {
    id: "court",
    title: "Where serves and returns land",
    module: "./views/CourtMapView.js",
    factories: ["createCourtMapView", "createCourtView"],
  },
  {
    id: "dag",
    title: "What happens after the serve",
    module: "./views/TacticalDagView.js",
    factories: ["createTacticalDagView", "createDagView"],
  },
  {
    id: "rally",
    title: "Who wins as rallies get longer",
    module: "./views/RallyHorizonView.js",
    factories: ["createRallyHorizonView", "createRallyView"],
  },
]);

/** Story strip module descriptor (one guided question, four steps). */
const STORY_SPEC = Object.freeze({
  id: "story",
  module: "./views/StoryStrip.js",
  factories: ["createStoryStrip"],
});

/** Header (filters + KPI strip) module descriptor. */
const HEADER_SPEC = Object.freeze({
  id: "header",
  module: "./views/ControlHeader.js",
  factories: ["createControlHeader", "createControlHeaderView", "createHeader"],
});

/**
 * @typedef {Object} MountOptions
 * @property {string}  [dataUrl="./data/recent_mcp_points.json"]
 * @property {boolean|"auto"} [fill="auto"] true: 100vh standalone layout; false: natural height;
 *   "auto": fill the host container when it has its own height, else the viewport
 * @property {boolean} [expose=true]   expose the controller as `window.__tva`
 * @property {boolean} [syncHash=true] read/write the filter state in `location.hash`
 * @property {"auto"|"button"} [help="auto"] "auto": the "How it works" modal opens by itself on a
 *   reader's first visit; "button": only from its header button
 */

/**
 * @typedef {Object} DashboardController
 * @property {StateStore} store
 * @property {Record<string, object|null>} views      { header, story, court, dag, rally }
 * @property {(index: number) => void} goToStep        apply story step `index` (0-based)
 * @property {() => void} destroy
 * @property {() => import("./core/StateStore.js").FilterState} getState
 * @property {() => object} getSnapshot
 * @property {() => { id: string, source: string, meta: object }} getDatasetInfo
 * @property {HTMLElement} root
 */

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/**
 * Create an element with a class list and optional text (textContent only, never innerHTML).
 * @param {Document} doc
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Inject `css/styles.css` (resolved relative to this module) once per document.
 * @param {Document} doc
 */
function ensureStylesheet(doc) {
  const href = new URL("../css/styles.css", import.meta.url).href;
  const existing = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))
    .some((link) => link.href === href || link.dataset.tvaStyles === "true");
  if (existing) return;
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.tvaStyles = "true";
  doc.head.appendChild(link);
}

/**
 * Decide how the root is sized. `fill: true` forces the full-viewport layout, `false` the
 * natural-height layout. `"auto"` (default): when the host container already has its own
 * height (an embedding div such as 1200x800) the root fills exactly that box
 * ("contained"); otherwise (a bare standalone mount point) it fills the viewport.
 * @param {HTMLElement} containerEl
 * @param {boolean|"auto"} fill
 * @returns {boolean|"contained"}
 */
function resolveFillMode(containerEl, fill) {
  if (fill === true || fill === false) return fill;
  const doc = containerEl.ownerDocument;
  if (containerEl === doc.body || containerEl === doc.documentElement) return true;
  const h = containerEl.clientHeight;
  if (h <= 0) return true;
  // A definite height does not grow with content (min-height / auto heights do): probe it.
  const probe = doc.createElement("div");
  probe.style.cssText = `height:${h + 2000}px;width:1px;visibility:hidden;`;
  containerEl.appendChild(probe);
  const grown = containerEl.clientHeight > h + 1;
  probe.remove();
  return grown ? true : "contained";
}

/**
 * Build the root markup (api_contract.md "Root markup") inside the host container.
 * @param {HTMLElement} containerEl
 * @param {boolean|"contained"} fill
 * @returns {{ root: HTMLElement, header: HTMLElement, headerControls: HTMLElement,
 *             subtitle: HTMLElement, bodies: Record<string, HTMLElement>,
 *             sections: Record<string, HTMLElement>, tooltipEl: HTMLElement, loading: HTMLElement }}
 */
function buildMarkup(containerEl, fill) {
  const doc = containerEl.ownerDocument;
  const mode = fill === "contained" ? " tva-root--contained" : fill ? " tva-root--fill" : "";
  const root = el(doc, "div", "tva-root" + mode);
  root.dataset.theme = "light";
  // Every colour comes from js/core/palette.js (THEME), written here as --tva-* variables.
  applyTheme(root);

  const header = el(doc, "header", "tva-header");
  header.dataset.region = "header";
  // The ControlHeader view renders the product title; main.js only owns the dataset-source line.
  const subtitle = el(doc, "p", "tva-header__subtitle", "Loading dataset…");
  subtitle.setAttribute("aria-live", "polite");
  header.appendChild(subtitle);
  const headerControls = el(doc, "div", "tva-header__controls");
  header.appendChild(headerControls);
  root.appendChild(header);

  const story = el(doc, "section", "tva-story");
  story.setAttribute("aria-label", "Guided tour");
  root.appendChild(story);

  /** @type {Record<string, HTMLElement>} */
  const bodies = {};
  /** @type {Record<string, HTMLElement>} */
  const sections = {};
  for (const spec of VIEW_SPECS) {
    const section = el(doc, "section", `tva-view tva-view--${spec.id}`);
    section.dataset.view = spec.id;
    section.appendChild(el(doc, "h2", "tva-view__title", spec.title));
    if (spec.id === "dag") {
      // Phones: the flow chart keeps a readable size and scrolls sideways (CSS shows the hint).
      section.appendChild(el(doc, "p", "tva-dag-scroll-hint", "Swipe sideways to see the whole chart →"));
    }
    const body = el(doc, "div", "tva-view__body");
    if (spec.id === "dag") {
      body.tabIndex = 0;
      body.setAttribute("aria-label", "Flow chart; on small screens use the arrow keys to scroll sideways");
    }
    section.appendChild(body);
    root.appendChild(section);
    bodies[spec.id] = body;
    sections[spec.id] = section;
  }

  const tooltipEl = el(doc, "div", "tva-tooltip");
  tooltipEl.setAttribute("role", "tooltip");
  tooltipEl.setAttribute("aria-hidden", "true");
  root.appendChild(tooltipEl);

  const footer = el(doc, "footer", "tva-footer");
  const attribution = el(doc, "span", "tva-footer__attribution", ATTRIBUTION_TEXT + " · ");
  const source = el(doc, "a", "", "Source");
  source.href = "https://github.com/JeffSackmann/tennis_MatchChartingProject";
  const license = el(doc, "a", "", "CC BY-NC-SA 4.0 (non-commercial)");
  license.href = "https://creativecommons.org/licenses/by-nc-sa/4.0/";
  const readme = el(doc, "a", "", "About the data and its limits");
  readme.href = new URL("../data/README.md", import.meta.url).href;
  attribution.append(source, doc.createTextNode(" · "), license, doc.createTextNode(" · "), readme);
  footer.append(attribution);
  root.appendChild(footer);

  const loading = el(doc, "div", "tva-loading");
  loading.setAttribute("role", "status");
  loading.setAttribute("aria-live", "polite");
  loading.appendChild(el(doc, "div", "tva-loading__spinner"));
  loading.appendChild(el(doc, "p", "tva-loading__text", "Loading dataset…"));
  root.appendChild(loading);

  containerEl.appendChild(root);
  return { root, story, header, headerControls, subtitle, bodies, sections, tooltipEl, loading };
}

/**
 * Show an error box inside a view body (replacing a previous one), never innerHTML.
 * @param {HTMLElement} bodyEl
 * @param {string} title
 * @param {unknown} err
 */
function showViewError(bodyEl, title, err) {
  const doc = bodyEl.ownerDocument;
  const previous = bodyEl.querySelector(":scope > .tva-error");
  if (previous) previous.remove();
  const box = el(doc, "div", "tva-error");
  box.setAttribute("role", "alert");
  box.appendChild(el(doc, "strong", "tva-error__title", title));
  const message = err instanceof Error ? err.message : String(err);
  box.appendChild(el(doc, "p", "tva-error__message", message));
  bodyEl.appendChild(box);
}

/**
 * Pick the factory function from a view module (contract name first, `default` last).
 * @param {object} mod
 * @param {string[]} names
 * @returns {Function}
 */
function resolveFactory(mod, names) {
  for (const name of names) {
    if (typeof mod[name] === "function") return mod[name];
  }
  if (typeof mod.default === "function") return mod.default;
  const anyCreate = Object.keys(mod).find((k) => k.startsWith("create") && typeof mod[k] === "function");
  if (anyCreate) return mod[anyCreate];
  throw new Error(`no factory export found (expected ${names.join(" | ")})`);
}

/**
 * A no-op tooltip used only when TooltipManager fails to load, so the views still work.
 * @returns {{ show: Function, move: Function, hide: Function, destroy: Function }}
 */
function createNullTooltip() {
  return { show() {}, move() {}, hide() {}, destroy() {} };
}

/**
 * Dataset line under the title: source, points, matches, servers.
 * @param {object} meta  dataset metadata
 * @param {StateStore} store
 * @returns {string}
 */
function describeDataset(meta, store) {
  const total = store.getAllPoints().length;
  const matches = Number.isFinite(meta.matches) ? ` · ${meta.matches.toLocaleString("en-US")} matches` : "";
  if (meta.fallback) return `Synthetic fallback data (data file not found) · ${total.toLocaleString("en-US")} points`;
  const range = Array.isArray(meta.dateRange) && meta.dateRange.length === 2
    ? ` · ${formatYmd(meta.dateRange[0])} – ${formatYmd(meta.dateRange[1])}` : "";
  return `Men's singles, Match Charting Project${range} · ${total.toLocaleString("en-US")} points${matches}`;
}

/** Month abbreviations for formatYmd (fixed English, independent of the browser locale). */
const MONTHS = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);

/**
 * "20221031" -> "31 Oct 2022" (the input is returned unchanged when it is not YYYYMMDD).
 * @param {string} ymd
 * @returns {string}
 */
function formatYmd(ymd) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(ymd));
  if (!m || !MONTHS[Number(m[2]) - 1]) return String(ymd);
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the dashboard inside `containerEl`.
 *
 * @param {HTMLElement} containerEl host element (its content is preserved; the root is appended)
 * @param {MountOptions} [opts]
 * @returns {Promise<DashboardController>}
 */
export async function mountTennisDashboard(containerEl, opts = {}) {
  if (!containerEl || typeof containerEl.appendChild !== "function") {
    throw new TypeError("mountTennisDashboard: containerEl must be a DOM element");
  }
  const {
    dataUrl = "./data/recent_mcp_points.json",
    fill = "auto",
    expose = true,
    syncHash = true,
    help = "auto",
  } = opts || {};

  const doc = containerEl.ownerDocument;
  const win = doc.defaultView || globalThis;
  ensureStylesheet(doc);

  const dom = buildMarkup(containerEl, resolveFillMode(containerEl, fill));

  // ---- dataset ---------------------------------------------------------------
  const loaded = await loadDataset({ dataUrl });
  const datasetMeta = { ...(loaded.meta || {}), fallback: loaded.source === "fallback" };
  const store = new StateStore(loaded.points);

  // Initial filter state from location.hash (ignored silently when invalid).
  if (syncHash && win.location && typeof win.location.hash === "string" && win.location.hash.length > 1) {
    try {
      const decoded = decodeFilterStateFromQuery(win.location.hash);
      const { hoveredElement, ...patch } = decoded;
      void hoveredElement;
      store.setFilters(patch);
    } catch (err) {
      console.error("mountTennisDashboard: ignoring invalid filter state in location.hash", err);
    }
  }

  // ---- tooltip ---------------------------------------------------------------
  let tooltip;
  try {
    const mod = await import("./views/TooltipManager.js");
    tooltip = resolveFactory(mod, ["createTooltip"])(dom.root);
  } catch (err) {
    console.error("mountTennisDashboard: TooltipManager failed to load, tooltips disabled", err);
    tooltip = createNullTooltip();
  }

  // ---- shared view context ---------------------------------------------------
  /** @type {Record<string, { update: Function, destroy: Function }|null>} */
  const views = { header: null, story: null, court: null, dag: null, rally: null };
  /** @type {Map<string, () => void>} */
  const unsubscribers = new Map();
  let destroyed = false;

  /** Context shared by every view. */
  const ctx = {
    store,
    tooltip,
    d3,
    getTheme: () => "light",
    rootEl: dom.root,
    subtitleEl: dom.subtitle,
  };

  // ---- store wiring ----------------------------------------------------------

  /**
   * Subscribe one view to the current store (replacing an earlier subscription).
   * @param {string} id
   */
  function subscribeView(id) {
    const view = views[id];
    if (!view) return;
    const prev = unsubscribers.get(id);
    if (prev) prev();
    const unsubscribe = ctx.store.subscribe((snap, change) => {
      try {
        view.update(snap, change);
      } catch (err) {
        console.error(`view "${id}" update failed`, err);
      }
    });
    unsubscribers.set(id, unsubscribe);
  }

  let hashTimer = 0;

  /** Write the persistent filter state to location.hash (debounced, replaceState: no history spam). */
  function scheduleHashWrite() {
    if (!syncHash || !win.location) return;
    if (hashTimer) win.clearTimeout(hashTimer);
    hashTimer = win.setTimeout(() => {
      hashTimer = 0;
      if (destroyed) return;
      const encoded = encodeFilterStateToQuery(ctx.store.getState());
      const next = encoded ? `#${encoded}` : "";
      const current = win.location.hash || "";
      if (current === next || (next === "" && current === "#")) return;
      try {
        const url = `${win.location.pathname}${win.location.search}${next}`;
        if (win.history && typeof win.history.replaceState === "function") win.history.replaceState(null, "", url);
        else win.location.hash = next;
      } catch (err) {
        console.error("mountTennisDashboard: could not update location.hash", err);
      }
    }, HASH_WRITE_DEBOUNCE_MS);
  }

  let unsubscribeHash = null;

  /** Subscribe the hash writer to the current store. */
  function subscribeHashWriter() {
    if (unsubscribeHash) unsubscribeHash();
    unsubscribeHash = ctx.store.subscribe((snap, change) => {
      if (change.type === "hover" || change.type === "init") return;
      scheduleHashWrite();
    });
  }

  /**
   * Apply an external hash change (back/forward navigation or a pasted link). The decoded hash
   * is a complete filter state and setFilters() drops values equal to the current ones, so a
   * hash that already matches the store (e.g. the echo of our own fallback `location.hash`
   * write) is a silent no-op. Never skip by string identity: a hash we wrote with replaceState
   * can also be a real history entry the user navigates back to.
   */
  function onHashChange() {
    if (destroyed || !win.location) return;
    const hash = win.location.hash || "";
    try {
      const { hoveredElement, ...patch } = decodeFilterStateFromQuery(hash);
      void hoveredElement;
      ctx.store.setFilters(patch);
    } catch (err) {
      console.error("mountTennisDashboard: ignoring invalid filter state in location.hash", err);
    }
  }

  // ---- views -----------------------------------------------------------------

  /**
   * Create one view; failures are isolated into that view's section.
   * @param {{ id: string, module: string, factories: string[] }} spec
   * @param {HTMLElement} bodyEl
   */
  async function createView(spec, bodyEl) {
    try {
      const mod = await import(spec.module);
      const factory = resolveFactory(mod, spec.factories);
      const view = factory(bodyEl, ctx);
      if (!view || typeof view.update !== "function") {
        throw new Error("factory did not return { update, destroy }");
      }
      if (typeof view.destroy !== "function") view.destroy = () => {};
      views[spec.id] = view;
      subscribeView(spec.id);
    } catch (err) {
      console.error(`view "${spec.id}" failed to mount`, err);
      views[spec.id] = null;
      showViewError(bodyEl, `View "${spec.id}" failed to load`, err);
    }
  }

  await Promise.all([
    createView(HEADER_SPEC, dom.headerControls),
    createView(STORY_SPEC, dom.story),
    ...VIEW_SPECS.map((spec) => createView(spec, dom.bodies[spec.id])),
  ]);
  subscribeHashWriter();
  // "How it works" modal: its button sits in the header's action slot (always visible, also
  // on phones where the filters fold away).
  let helpDialog = null;
  try {
    const mod = await import("./views/HelpDialog.js");
    helpDialog = mod.createHelpDialog(dom.root, { autoOpen: help !== "button" });
    const slot = views.header && views.header.elements && views.header.elements.actions;
    (slot || dom.header).appendChild(helpDialog.button);
  } catch (err) {
    console.error("help dialog failed to mount", err);
  }
  dom.subtitle.textContent = describeDataset(datasetMeta, store);
  if (syncHash) win.addEventListener("hashchange", onHashChange);
  dom.loading.remove();
  dom.root.dataset.ready = "true";

  /** Unsubscribe everything, destroy the views and remove the markup. */
  function destroy() {
    if (helpDialog) helpDialog.destroy();
    if (destroyed) return;
    destroyed = true;
    if (hashTimer) win.clearTimeout(hashTimer);
    if (syncHash) win.removeEventListener("hashchange", onHashChange);
    if (unsubscribeHash) unsubscribeHash();
    for (const unsubscribe of unsubscribers.values()) unsubscribe();
    unsubscribers.clear();
    for (const id of Object.keys(views)) {
      const view = views[id];
      if (!view) continue;
      try {
        view.destroy();
      } catch (err) {
        console.error(`view "${id}" destroy failed`, err);
      }
      views[id] = null;
    }
    try {
      tooltip.destroy && tooltip.destroy();
    } catch (err) {
      console.error("tooltip destroy failed", err);
    }
    dom.root.remove();
    if (expose !== false && win.__tva === controller) delete win.__tva;
  }

  /** @type {DashboardController} */
  const controller = {
    store,
    views,
    root: dom.root,
    destroy,
    getState: () => store.getState(),
    getSnapshot: () => store.getSnapshot(),
    getDatasetInfo: () => ({ ...datasetMeta }),
    goToStep: (index) => views.story && views.story.goTo(index),
    openHelp: () => helpDialog && helpDialog.open(),
    closeHelp: () => helpDialog && helpDialog.close(),
  };

  if (expose !== false) win.__tva = controller;
  return controller;
}

export default mountTennisDashboard;
