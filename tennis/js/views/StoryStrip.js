/**
 * StoryStrip.js - the "Guided tour" bar above the three views (guideline section 8 Phase 4).
 *
 * A one-row stepper: "Step k of 4", Back / Next, the step title, a live headline (N and 95%
 * intervals, computed by core/Story.js from the whole dataset) and a short plain-language
 * explanation. Each step applies a complete filter state to the real dashboard in one
 * setFilters call, so the court, the flow graph and the rally chart show the evidence through
 * their normal selection marks; the views the step is about get an accent outline
 * (`.tva-view.is-story-focus`).
 *
 * On phones (CSS, < 640 px) an active step shows only its main chart (the first entry of
 * `step.focus`, published as `rootEl.dataset.storyView`); "Explore on my own" brings all three
 * charts back.
 *
 * On phones the bar is compact (the explanation folds behind "More"; the one-chart note shows on
 * step 1 only) and Back / Next scroll the page so the bar sits at the top of the screen with the
 * step's chart right below it: the headline and its evidence are visible together, without
 * scrolling (smooth unless the reader prefers reduced motion).
 *
 * The strip follows the store: when the filter state stops matching the current step (any
 * manual click or filter), it collapses to "Exploring freely" with a "Resume story" button.
 * "Free exploration" collapses it without changing the filters. All text via textContent.
 *
 * @module views/StoryStrip
 */

import { STORY, stepHeadline, stepFilterState, matchingStep } from "../core/Story.js";

/**
 * @param {Document} doc
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function node(doc, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/**
 * Create the story strip.
 * @param {HTMLElement} container  the `.tva-story` region created by main.js
 * @param {{ store: object, rootEl: HTMLElement }} ctx  ctx.store is read at event time
 * @returns {{ update(snapshot: object, change?: { type: string }): void, destroy(): void,
 *             goTo(index: number): void, getStep(): number, isActive(): boolean }}
 */
export function createStoryStrip(container, ctx) {
  const doc = container.ownerDocument;
  const abort = new AbortController();
  const { signal } = abort;
  const steps = STORY.steps;
  let current = 0;
  let exploring = false;
  let active = false;
  let destroyed = false;
  /** Headline cache, keyed by step index; reset when the store (dataset) changes. */
  let cache = new Map();
  let cachedStore = null;

  const kicker = node(doc, "span", "tva-story__kicker", "Guided tour");
  const question = node(doc, "span", "tva-story__question", STORY.question);
  const head = node(doc, "div", "tva-story__head");
  head.append(kicker, question);

  const progress = node(doc, "span", "tva-story__progress");
  progress.setAttribute("aria-live", "polite");
  const back = node(doc, "button", "tva-btn tva-story__back", "‹ Back");
  back.setAttribute("aria-label", "Previous step");
  back.type = "button";
  const next = node(doc, "button", "tva-btn tva-btn--primary tva-story__next", "Next ›");
  next.setAttribute("aria-label", "Next step");
  next.type = "button";
  const nav = node(doc, "div", "tva-story__nav");
  nav.append(back, progress, next);

  const headline = node(doc, "p", "tva-story__headline");
  const text = node(doc, "p", "tva-story__text");
  const phoneNote = node(doc, "p", "tva-story__phone-note",
    "On a phone the tour shows one chart per step; \"Explore on my own\" shows all three.");
  // Phones: the explanation folds behind "More" so the bar stays compact (CSS shows the button
  // below 640 px only).
  const more = node(doc, "button", "tva-story__more", "More");
  more.type = "button";
  more.setAttribute("aria-expanded", "false");
  const body = node(doc, "div", "tva-story__body");
  body.append(headline, more, text, phoneNote);

  const toggle = node(doc, "button", "tva-btn tva-story__toggle");
  toggle.type = "button";

  container.append(head, nav, body, toggle);

  /** @param {number} index */
  function headlineOf(index) {
    if (cachedStore !== ctx.store) {
      cache = new Map();
      cachedStore = ctx.store;
    }
    if (!cache.has(index)) cache.set(index, stepHeadline(steps[index], ctx.store.getAllPoints()));
    return cache.get(index);
  }

  /**
   * Apply step `index` to the store (one notification).
   * @param {number} index
   */
  function goTo(index) {
    if (destroyed) return;
    current = Math.max(0, Math.min(steps.length - 1, index));
    exploring = false;
    const state = stepFilterState(steps[current]);
    if (matchingStep(ctx.store.getState(), current) === current) {
      active = true;
      render();
    } else {
      ctx.store.setFilters(state);
    }
  }

  const win = doc.defaultView || globalThis;
  /** True on phone-sized screens (the CSS breakpoint of the compact tour). */
  const isPhone = () => Boolean(win.matchMedia && win.matchMedia("(max-width: 640px)").matches);

  /**
   * Phones: bring the bar to the top of the screen so the step's chart sits right below it.
   * Runs after the store update has re-rendered the views (next animation frame).
   */
  function anchorToBar() {
    if (!isPhone() || typeof container.scrollIntoView !== "function") return;
    const reduce = Boolean(win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const run = () => container.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    if (typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(run); else run();
  }

  /** Step from a Back / Next button: apply it, fold the explanation, anchor the view (phones). */
  function stepTo(index) {
    goTo(index);
    container.classList.remove("is-expanded");
    more.setAttribute("aria-expanded", "false");
    more.textContent = "More";
    anchorToBar();
  }

  back.addEventListener("click", () => stepTo(current - 1), { signal });
  next.addEventListener("click", () => stepTo(current + 1), { signal });
  more.addEventListener("click", () => {
    const open = !container.classList.contains("is-expanded");
    container.classList.toggle("is-expanded", open);
    more.setAttribute("aria-expanded", String(open));
    more.textContent = open ? "Less" : "More";
  }, { signal });
  toggle.addEventListener("click", () => {
    if (active) {
      exploring = true;
      active = false;
      render();
    } else {
      goTo(current);
    }
  }, { signal });

  /** Mark the views the active step is about. */
  function markFocus() {
    const focus = active ? steps[current].focus : [];
    const root = ctx.rootEl || container.parentElement;
    if (!root) return;
    // Main chart of the step: the only one shown on phones while the tour is active.
    if (active && focus.length) root.dataset.storyView = focus[0];
    else delete root.dataset.storyView;
    for (const section of root.querySelectorAll(".tva-view")) {
      section.classList.toggle("is-story-focus", focus.includes(section.dataset.view));
    }
  }

  function render() {
    const step = steps[current];
    container.dataset.active = String(active);
    container.dataset.step = String(current + 1);
    if (ctx.rootEl) ctx.rootEl.dataset.story = active ? String(current + 1) : "off";
    progress.textContent = `Step ${current + 1} of ${steps.length} · ${step.title}`;
    back.disabled = !active || current === 0;
    next.disabled = !active || current === steps.length - 1;
    nav.hidden = !active;
    body.hidden = !active;
    if (active) {
      headline.textContent = headlineOf(current);
      text.textContent = step.text;
      toggle.textContent = "Explore on my own";
      toggle.title = "Hide the guided tour and keep the charts as they are";
    } else {
      headline.textContent = "";
      text.textContent = "";
      toggle.textContent = current === 0 ? "Take the guided tour" : `Back to the guided tour (step ${current + 1})`;
      toggle.title = "Set the charts to the guided tour's step again";
    }
    question.textContent = active ? STORY.question : "You are exploring on your own: click or tap anything in the charts to filter; hover (or tap) for exact numbers.";
    markFocus();
  }

  /**
   * Store listener: work out whether the filter state still equals a story step.
   * @param {object} snapshot
   * @param {{ type: string }} [change]
   */
  function update(snapshot, change) {
    if (destroyed || !snapshot || !snapshot.state) return;
    if (change && (change.type === "hover" || change.type === "theme" || change.type === "resize")) return;
    const match = matchingStep(snapshot.state, current);
    if (match >= 0) current = match;
    active = match >= 0 && !exploring;
    // A manual divergence means the reader is exploring: stay collapsed (also after Reset)
    // until they choose to resume the story.
    if (match < 0) exploring = true;
    render();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    abort.abort();
    active = false;
    markFocus();
    container.replaceChildren();
  }

  return { update, destroy, goTo, getStep: () => current, isActive: () => active };
}

export default createStoryStrip;
