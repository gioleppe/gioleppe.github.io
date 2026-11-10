/**
 * HelpDialog.js - "How it works" modal for a general audience.
 *
 * A native <dialog> opened with showModal(): the page behind is inert, focus moves into the
 * dialog and Escape closes it. A click on the backdrop and the "Got it" / × buttons also close
 * it, and focus returns to the element that opened it. On a reader's first visit the dialog opens
 * by itself (remembered in localStorage; every storage access is guarded, so private windows and
 * blocked storage simply show it again). All text is set with textContent.
 *
 * @module views/HelpDialog
 */

/** localStorage key remembering that the reader has seen the dialog. */
export const HELP_SEEN_KEY = "holding-serve:help-seen";

/**
 * Dialog content: sections of a heading plus paragraphs or bullet items.
 * Each item is either a string or { term, text } (bold lead-in followed by text).
 * @type {ReadonlyArray<{ heading: string, paragraphs?: string[], items?: Array<string|{ term: string, text: string }> }>}
 */
export const HELP_SECTIONS = Object.freeze([
  {
    heading: "What you are looking at",
    paragraphs: [
      "The charts hold every point of about 2,200 men's singles matches played between 31 October 2022 and 21 May 2026. Volunteers of the Match Charting Project recorded each one shot by shot.",
      "Serving is a big advantage in tennis. This page asks when the server loses it.",
    ],
  },
  {
    heading: "The guided tour",
    paragraphs: [
      "The bar above the charts answers the question in four short steps. Use Next and Back. Each step sets the charts for you, and the charts it talks about get a purple outline.",
      "Choose \"Explore on my own\" whenever you want to play with the charts yourself. You can come back to the tour at any time. On a phone the tour shows one chart per step.",
    ],
  },
  {
    heading: "The three charts",
    items: [
      { term: "Where serves and returns land.", text: "One service box, seen from above and drawn as a simple grid (not to scale), with the net at the top. Columns show where the serve went (wide, at the body, or down the middle, the \"T\"); rows show where the return landed. The strip above the net holds serves that never came back. Colour shows how often the server won those points (teal: server ahead, brown: returner ahead); the grey bars to the right and underneath show how many points fall in each row and column. Striped boxes have fewer than 10 points, so read them with care." },
      { term: "What happens after the serve.", text: "Follow the points from left to right: where the serve went, where the return landed, then the server's next shot. The thicker a band, the more points took that path; its colour shows how often the server won them." },
      { term: "Who wins as rallies get longer.", text: "Points grouped by how many shots were played. The top panel shows the share of points the server won, with its 95% range shaded and a dashed line at 50%; the bars below show how many points there were. Hover a column to see how those points ended (winners and errors). Lengths are grouped in pairs. The charting counts the final missed shot, so odd lengths always end on the server's shot and even lengths on the returner's, and single lengths would zig-zag." },
    ],
  },
  {
    heading: "Filtering",
    items: [
      { term: "Click or tap", text: "a box on the court or a block in the flow chart to keep only those points; click it again to undo." },
      { term: "Drag across", text: "the rally chart, or use the buttons above it, to pick a range of rally lengths." },
      { term: "The menus at the top", text: "narrow everything to one server, a surface, a type of event (Grand Slam, Masters 1000 …), the score situation (for example break points) or first and second serves. Reset clears everything." },
      { term: "Hover", text: "(or tap on a phone) any box, band or bar to see its exact numbers." },
    ],
  },
  {
    heading: "Reading the numbers",
    paragraphs: [
      "Each percentage comes with the number of points behind it and a 95% range. If many more matches were charted, the percentage would very likely stay inside that range. The fewer the points, the wider the range.",
      "Boxes and flows with fewer than 10 points are painted grey instead of coloured (the court boxes are also striped), so a lucky handful of points does not look like a pattern. Their share is still printed.",
    ],
  },
  {
    heading: "Keep in mind",
    paragraphs: [
      "Volunteers choose which matches to chart, so this is not every match on tour, and big events and famous players appear more often. The charts show what tends to happen together, not what causes what.",
    ],
  },
]);

/**
 * Read / write the "seen" flag without ever throwing.
 * @param {Window} win
 * @returns {{ get(): boolean, set(): void }}
 */
function seenFlag(win) {
  return {
    get() {
      try { return win.localStorage.getItem(HELP_SEEN_KEY) === "1"; } catch { return false; }
    },
    set() {
      try { win.localStorage.setItem(HELP_SEEN_KEY, "1"); } catch { /* storage unavailable */ }
    },
  };
}

/**
 * Create the dialog and the "How it works" trigger button.
 * @param {HTMLElement} rootEl  the dashboard root (the dialog is appended to it)
 * @param {{ autoOpen?: boolean }} [options] autoOpen (default true): open on a first visit
 * @returns {{ open(): void, close(): void, button: HTMLButtonElement, dialog: HTMLDialogElement, destroy(): void }}
 */
export function createHelpDialog(rootEl, options = {}) {
  const doc = rootEl.ownerDocument;
  const win = doc.defaultView || globalThis;
  const abort = new AbortController();
  const { signal } = abort;
  const flag = seenFlag(win);
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const dialog = /** @type {HTMLDialogElement} */ (el("dialog", "tva-help"));
  dialog.setAttribute("aria-labelledby", "tva-help-title");
  const panel = el("div", "tva-help__panel");
  const head = el("div", "tva-help__head");
  const title = el("h2", "tva-help__title", "How it works");
  title.id = "tva-help-title";
  const closeX = /** @type {HTMLButtonElement} */ (el("button", "tva-help__close", "×"));
  closeX.type = "button";
  closeX.setAttribute("aria-label", "Close");
  head.append(title, closeX);

  const body = el("div", "tva-help__body");
  for (const section of HELP_SECTIONS) {
    const block = el("section", "tva-help__section");
    block.appendChild(el("h3", "tva-help__heading", section.heading));
    for (const text of section.paragraphs || []) block.appendChild(el("p", "tva-help__text", text));
    if (section.items) {
      const list = el("ul", "tva-help__list");
      for (const item of section.items) {
        const li = el("li", "tva-help__item");
        if (typeof item === "string") li.textContent = item;
        else li.append(el("strong", "", item.term), doc.createTextNode(` ${item.text}`));
        list.appendChild(li);
      }
      block.appendChild(list);
    }
    body.appendChild(block);
  }

  const foot = el("div", "tva-help__foot");
  const ok = /** @type {HTMLButtonElement} */ (el("button", "tva-btn tva-btn--primary tva-help__ok", "Got it"));
  ok.type = "button";
  foot.appendChild(ok);
  panel.append(head, body, foot);
  dialog.appendChild(panel);
  rootEl.appendChild(dialog);

  const button = /** @type {HTMLButtonElement} */ (el("button", "tva-btn tva-btn--help", "How it works"));
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");

  /** @type {Element|null} */
  let opener = null;

  function open() {
    if (dialog.open) return;
    opener = doc.activeElement;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    body.scrollTop = 0;
    ok.focus();
  }

  function close() {
    if (!dialog.open) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  dialog.addEventListener("close", () => {
    flag.set();
    if (opener && typeof opener.focus === "function" && doc.contains(opener)) opener.focus();
    opener = null;
  }, { signal });
  // A click on the backdrop lands on the <dialog> element itself (the panel covers the box).
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); }, { signal });
  closeX.addEventListener("click", close, { signal });
  ok.addEventListener("click", close, { signal });
  button.addEventListener("click", open, { signal });

  if (options.autoOpen !== false && !flag.get()) open();

  return {
    open,
    close,
    button,
    dialog,
    destroy() {
      abort.abort();
      close();
      dialog.remove();
      button.remove();
    },
  };
}

export default createHelpDialog;
