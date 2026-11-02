/**
 * ServerSearch.js - searchable "Server" field (ARIA 1.2 combobox with a listbox popup).
 *
 * A native <select> with ~380 names is hard to use and renders differently from the short
 * menus. This field is a text input that filters the servers as you type (accent- and
 * case-insensitive; every typed word must start a word of the name, or appear in it) and shows
 * each server's number of service points, most-charted first, so the size of the sample is
 * visible before choosing. "All servers" is always the first option.
 *
 * Keyboard: ArrowDown / ArrowUp move, Enter picks, Escape closes and restores, Tab leaves.
 * Mouse / touch: tap an option. All text via textContent.
 *
 * The ranking helper `rankServers` is pure (Node-tested).
 *
 * @module views/ServerSearch
 */

/** Maximum number of options rendered at once (the list asks to keep typing beyond it). */
export const MAX_OPTIONS = 60;

/**
 * Lower-case, accent-free form of a string for matching.
 * @param {string} s
 * @returns {string}
 */
export function foldText(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Servers matching a query, best first.
 * Rank: 0 = the name starts with the query, 1 = every query word starts a word of the name,
 * 2 = the query appears anywhere; ties by points (desc), then name.
 * @param {ReadonlyArray<{ name: string, n: number }>} servers
 * @param {string} query
 * @returns {Array<{ name: string, n: number }>}
 */
export function rankServers(servers, query) {
  const q = foldText(query);
  const words = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const s of servers) {
    const name = foldText(s.name);
    let rank;
    if (!q) rank = 0;
    else if (name.startsWith(q)) rank = 0;
    else if (words.every((w) => name.split(/[\s-]+/).some((part) => part.startsWith(w)))) rank = 1;
    else if (name.includes(q)) rank = 2;
    else continue;
    scored.push({ s, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || b.s.n - a.s.n || a.s.name.localeCompare(b.s.name));
  return scored.map((x) => x.s);
}

let comboCount = 0;

/**
 * Create the field.
 * @param {Document} doc
 * @param {{ onPick: (name: string) => void, label?: string }} options  onPick receives a server
 *   name or "ALL"
 * @returns {{ wrap: HTMLElement, input: HTMLInputElement, setServers(list: Array<{ name: string, n: number }>): void,
 *             setValue(name: string): void, destroy(): void }}
 */
export function createServerSearch(doc, { onPick, label = "Server" }) {
  comboCount += 1;
  const id = `tva-server-${comboCount}`;
  const abort = new AbortController();
  const { signal } = abort;
  const fmt = (n) => Math.round(n).toLocaleString("en-US");

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const wrap = el("div", "tva-field tva-field--combo");
  wrap.dataset.field = "player";
  const labelEl = el("label", "tva-field__label", label);
  labelEl.htmlFor = `${id}-input`;
  const box = el("div", "tva-combo");
  const input = /** @type {HTMLInputElement} */ (el("input", "tva-select tva-combo__input"));
  input.id = `${id}-input`;
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "All servers · type a name";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", `${id}-list`);
  const list = el("ul", "tva-combo__list");
  list.id = `${id}-list`;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Servers");
  list.hidden = true;
  box.append(input, list);
  wrap.append(labelEl, box);

  /** @type {Array<{ name: string, n: number }>} */
  let servers = [];
  let value = "ALL";
  /** @type {Array<{ name: string, n: number|null }>} options currently rendered */
  let shown = [];
  let active = -1;

  const displayOf = (name) => (name === "ALL" ? "" : name);

  function close(restore) {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
    if (restore) input.value = displayOf(value);
  }

  function setActive(i) {
    const items = list.querySelectorAll("li[role=option]");
    active = items.length ? (i + items.length) % items.length : -1;
    items.forEach((li, k) => li.setAttribute("aria-selected", String(k === active)));
    if (active >= 0) {
      input.setAttribute("aria-activedescendant", items[active].id);
      items[active].scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function render(query) {
    const matches = rankServers(servers, query);
    const q = foldText(query);
    const includeAll = !q || "all servers".startsWith(q);
    shown = [...(includeAll ? [{ name: "ALL", n: null }] : []), ...matches.slice(0, MAX_OPTIONS)];
    list.replaceChildren();
    shown.forEach((opt, i) => {
      const li = el("li", "tva-combo__option");
      li.id = `${id}-opt-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      li.append(el("span", "tva-combo__name", opt.name === "ALL" ? "All servers" : opt.name));
      if (opt.n !== null) li.append(el("span", "tva-combo__count", `${fmt(opt.n)} pts`));
      if (opt.name === value) li.classList.add("is-current");
      li.addEventListener("pointerdown", (event) => { event.preventDefault(); pick(opt.name); });
      list.appendChild(li);
    });
    if (matches.length > MAX_OPTIONS) {
      list.appendChild(el("li", "tva-combo__more", `${fmt(matches.length - MAX_OPTIONS)} more · keep typing`));
    }
    if (shown.length === 0) list.appendChild(el("li", "tva-combo__more", "No server matches"));
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    setActive(q && matches.length ? (includeAll ? 1 : 0) : -1);
  }

  function pick(name) {
    value = name;
    close(true);
    onPick(name);
  }

  input.addEventListener("focus", () => { input.select(); render(""); }, { signal });
  input.addEventListener("click", () => { if (list.hidden) render(""); }, { signal });
  input.addEventListener("input", () => render(input.value), { signal });
  input.addEventListener("blur", () => close(true), { signal });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (list.hidden) render(input.value);
      setActive(active + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active >= 0 && shown[active]) pick(shown[active].name);
      else if (!input.value.trim()) pick("ALL");
      else if (shown.filter((o) => o.name !== "ALL").length === 1) pick(shown.find((o) => o.name !== "ALL").name);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      input.blur();
    }
  }, { signal });

  return {
    wrap,
    input,
    setServers(next) {
      servers = next.slice();
    },
    setValue(name) {
      value = name || "ALL";
      if (doc.activeElement !== input) input.value = displayOf(value);
    },
    destroy() {
      abort.abort();
      wrap.remove();
    },
  };
}

export default createServerSearch;
