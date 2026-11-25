// The Journal's entries (spec §7.2, step 4.6): data/lore_entries.json compiled once, and the rules that unlock
// entries from what happens in the world. Simulation side: pure, deterministic, no files (the caller passes the
// data in as `data.lore_entries`).
//
// State lives in the story (Dialogue.js `Story`): `journal` (entry ids, in the order they were unlocked; the
// dialogue's `journal` effect appends to the same list) and `read` (ids the player has opened, sent by the
// Journal through the tick input's `journal` field, see applyJournalCommands).
//
// Unlocks (an entry's `unlockedBy`, one string or a list, any of):
//   start                 the first unpaused step of a game (and of an older save restored)
//   dialogue              only a dialogue `journal` effect adds it (Marek)
//   site:<id>             `site_inspected` naming that container/landmark id (or its landmark)
//   discover:<landmark>   `landmark_discovered`
//   event:<type>[:<id>]   any simulation event of that type (and id)
//   recipe:<id> | flag:<name> | entry:<id>   a story fact, checked after every unpaused step
// A discover: entry also unlocks when its landmark is already discovered (the Cartographer's map) and the player
// comes within tuning.lore.visitRadius of it, so a note about a place is written only once the place is seen.
// An entry that unlocks may `reveals` landmarks (FogOfWar.revealLandmarks: the Cartographer's map) and may
// `teaches` a recipe (a second source for the totem besides Marek).
//
// Events: journal_entry { id, source: 'lore', category }, recipe_learned { id, source: 'lore' },
//         map_revealed { id, landmarks } (the ids newly discovered), journal_read { ids }.

/** entry categories, in the order the Notes tab groups them */
export const LORE_CATEGORIES = Object.freeze(['note', 'site', 'marek', 'recipe', 'objective']);
const NAME = /^[a-z][a-z0-9_]*$/;
/** unlock kinds that are an id lookup on an event */
const EVENT_KINDS = Object.freeze(['site', 'discover', 'event']);
/** unlock kinds checked against the story after every step */
const STATE_KINDS = Object.freeze(['start', 'recipe', 'flag', 'entry', 'discover']);

export class LoreError extends Error {}

/**
 * Parse one `unlockedBy` string.
 * @param {string} s
 * @returns {{ k: 'start'|'dialogue'|'site'|'discover'|'event'|'recipe'|'flag'|'entry', id?: string, type?: string }}
 */
export function parseUnlock(s) {
  if (typeof s !== 'string') throw new LoreError(`unlockedBy: expected a string, got ${JSON.stringify(s)}`);
  if (s === 'start' || s === 'dialogue') return { k: s };
  const parts = s.split(':');
  const [k, a, b] = parts;
  if (k === 'event') {
    if (parts.length < 2 || parts.length > 3 || !NAME.test(a) || (b !== undefined && !/^[a-z0-9_]+$/.test(b))) throw new LoreError(`unlockedBy: bad event "${s}" (event:<type> or event:<type>:<id>)`);
    return { k, type: a, id: b ?? null };
  }
  if (!['site', 'discover', 'recipe', 'flag', 'entry'].includes(k) || parts.length !== 2 || !/^[a-z0-9_]+$/.test(a)) {
    throw new LoreError(`unlockedBy: bad entry "${s}" (start | dialogue | site:<id> | discover:<id> | event:<type>[:<id>] | recipe:<id> | flag:<name> | entry:<id>)`);
  }
  return { k, id: a };
}

const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/**
 * Compile the lore file. Throws LoreError on the first structural problem (the validator reports all of them).
 * @param {{ entries: Object[] }|null|undefined} json missing gives an empty book
 * @returns {LoreBook}
 */
export function compileLore(json) {
  const book = new LoreBook();
  const raw = Array.isArray(json?.entries) ? json.entries : [];
  for (const e of raw) {
    if (!e || typeof e.id !== 'string' || !NAME.test(e.id)) throw new LoreError(`lore: bad id ${JSON.stringify(e?.id)}`);
    if (book.byId.has(e.id)) throw new LoreError(`lore ${e.id}: duplicate id`);
    if (!LORE_CATEGORIES.includes(e.category)) throw new LoreError(`lore ${e.id}: category must be one of ${LORE_CATEGORIES.join(', ')}`);
    const unlocks = list(e.unlockedBy).map((u) => {
      try { return parseUnlock(u); } catch (err) { throw new LoreError(`lore ${e.id}: ${err.message}`); }
    });
    if (!unlocks.length) throw new LoreError(`lore ${e.id}: unlockedBy is required`);
    const entry = Object.freeze({
      id: e.id, category: e.category, title: String(e.title ?? ''), text: String(e.text ?? ''),
      unlocks: Object.freeze(unlocks), reveals: Object.freeze(list(e.reveals).slice()), teaches: e.teaches ?? null,
    });
    book.add(entry);
  }
  return book;
}

/** the compiled entries and the lookups the unlock rules use */
export class LoreBook {
  constructor() {
    /** @type {Map<string, Object>} */
    this.byId = new Map();
    /** @type {Object[]} file order */
    this.list = [];
    /** @type {Map<string, Object[]>} `<kind>:<id>` (site, discover) and `event:<type>` -> entries */
    this.index = new Map();
    /** entries with a story-state unlock, checked after every step */
    this.stateful = [];
  }

  add(entry) {
    this.byId.set(entry.id, entry);
    this.list.push(entry);
    for (const u of entry.unlocks) {
      if (EVENT_KINDS.includes(u.k)) {
        const key = u.k === 'event' ? `event:${u.type}` : `${u.k}:${u.id}`;
        let l = this.index.get(key);
        if (!l) this.index.set(key, (l = []));
        if (!l.includes(entry)) l.push(entry);
      }
      // a landmark can be discovered without its event (a found map, debug): its note waits for the visit
      if (STATE_KINDS.includes(u.k) && !this.stateful.includes(entry)) this.stateful.push(entry);
    }
  }

  /** @returns {Object|null} */
  get(id) {
    return this.byId.get(id) ?? null;
  }

  /** the entries a list of keys unlocks (no duplicates, file order kept per key) */
  lookup(key) {
    return this.index.get(key) ?? [];
  }
}

const EMPTY = compileLore(null);

/**
 * The compiled lore of a data object (`data.lore_entries`), cached on it (data is never state).
 * @param {Object} data
 * @returns {LoreBook}
 */
export function loreBook(data) {
  const json = data?.lore_entries;
  if (!json) return EMPTY;
  const cache = loreBook.cache;
  if (!cache.has(json)) cache.set(json, compileLore(json));
  return cache.get(json);
}
loreBook.cache = new WeakMap();

// ---- unlocking ---------------------------------------------------------------------------------------------------

/**
 * Learn a recipe (story.recipes), once, with a `recipe_learned` event.
 * @returns {boolean} newly learned
 */
export function learnRecipe(sim, id, source = 'lore') {
  const st = sim.story;
  if (st.recipes.has(id)) return false;
  st.recipes.add(id);
  sim.events.push({ type: 'recipe_learned', id, source });
  return true;
}

/**
 * Unlock a journal entry (once): append it to story.journal, announce it, then apply its reveals and teaches.
 * @param {import('./Sim.js').Sim} sim
 * @param {string} id
 * @param {string} [source]
 * @returns {boolean} newly unlocked
 */
export function unlockEntry(sim, id, source = 'lore') {
  const st = sim.story;
  if (st.journal.includes(id)) return false;
  const entry = sim.lore.get(id);
  st.journal.push(id);
  sim.events.push({ type: 'journal_entry', id, source, category: entry?.category ?? null });
  if (entry?.reveals.length && sim.fog) {
    // the found map: landmarks discovered silently (the journal entry is the announcement), areas uncovered;
    // the event lists every landmark the map added, those that came with the uncovered areas included
    const before = new Set(sim.fog.discovered);
    sim.fog.revealLandmarks(entry.reveals, null);
    const fresh = [...sim.fog.discovered].filter((l) => !before.has(l)).sort();
    sim.events.push({ type: 'map_revealed', id, landmarks: fresh });
  }
  if (entry?.teaches) learnRecipe(sim, entry.teaches, 'lore');
  return true;
}

/**
 * A new game: the `start` entries are in the journal from the first frame, silently (no event before the first
 * step; the Journal shows them unread). A restored older save gets them on its first step instead.
 * @param {import('./Sim.js').Sim} sim
 */
export function unlockStartEntries(sim) {
  for (const e of sim.lore.list) {
    if (e.unlocks.some((u) => u.k === 'start') && !sim.story.journal.includes(e.id)) sim.story.journal.push(e.id);
  }
}

/** does a story-state unlock hold now */
function stateHolds(sim, u) {
  const st = sim.story;
  switch (u.k) {
    case 'start': return true;
    case 'recipe': return st.recipes.has(u.id);
    case 'flag': return st.flags.has(u.id);
    case 'entry': return st.journal.includes(u.id);
    case 'discover': {
      // discovered from afar (a found map) and now visited: within tuning.lore.visitRadius of it
      if (!sim.fog?.discovered.has(u.id)) return false;
      const l = sim.map.landmark(u.id);
      if (!l) return false;
      const r = sim.tuning.lore.visitRadius;
      const dx = l.x - sim.player.x;
      const dy = l.y - sim.player.y;
      return dx * dx + dy * dy <= r * r;
    }
    default: return false;
  }
}

/** the entries one event unlocks */
function entriesFor(book, e, out) {
  if (e.type === 'site_inspected') {
    for (const x of book.lookup(`site:${e.id}`)) out.push(x);
    if (e.landmark && e.landmark !== e.id) for (const x of book.lookup(`site:${e.landmark}`)) out.push(x);
  } else if (e.type === 'landmark_discovered') {
    for (const x of book.lookup(`discover:${e.id}`)) out.push(x);
  }
  for (const x of book.lookup(`event:${e.type}`)) {
    if (x.unlocks.some((u) => u.k === 'event' && u.type === e.type && (u.id === null || u.id === e.id))) out.push(x);
  }
}

/**
 * End of every unpaused step: unlock what this step's events and the story's state call for. Unlocking can raise
 * more events and facts (a recipe taught, an entry unlocked), so it repeats until nothing changes (bounded by the
 * number of entries).
 * @param {import('./Sim.js').Sim} sim
 */
export function loreAfterStep(sim) {
  const book = sim.lore;
  if (!book.list.length) return;
  const st = sim.story;
  const found = [];
  let seen = 0;
  for (let round = 0; round <= book.list.length; round++) {
    found.length = 0;
    const end = sim.events.length;
    for (; seen < end; seen++) entriesFor(book, sim.events[seen], found);
    for (const x of book.stateful) {
      if (!st.journal.includes(x.id) && x.unlocks.some((u) => stateHolds(sim, u))) found.push(x);
    }
    let changed = false;
    for (const x of found) if (unlockEntry(sim, x.id)) changed = true;
    if (!changed && seen === sim.events.length) return;
  }
}

/**
 * The Journal's commands, carried by the tick input's `journal` field (a space-separated list):
 * `read:<entry id>` marks an entry read, `craft:<recipe id>` makes a recipe (handled by the crafting step, which
 * passes the craft ids back here unhandled).
 * @param {import('./Sim.js').Sim} sim
 * @param {string|null} commands sanitized
 * @returns {string[]} the recipe ids asked to be crafted, in order
 */
export function applyJournalCommands(sim, commands) {
  const crafts = [];
  if (!commands) return crafts;
  const read = [];
  for (const tok of commands.split(' ')) {
    const [k, id] = tok.split(':');
    if (k === 'read') {
      if (sim.story.journal.includes(id) && !sim.story.read.has(id)) {
        sim.story.read.add(id);
        read.push(id);
      }
    } else if (k === 'craft') crafts.push(id);
  }
  if (read.length) sim.events.push({ type: 'journal_read', ids: read });
  return crafts;
}

/**
 * The unlocked entries of the Journal, for the UI: in unlock order, with their read state.
 * @param {import('./Sim.js').Sim} sim
 * @returns {Array<{ id: string, category: string, title: string, text: string, read: boolean }>}
 */
export function journalEntries(sim) {
  const out = [];
  for (const id of sim.story.journal) {
    const e = sim.lore.get(id);
    if (e) out.push({ id, category: e.category, title: e.title, text: e.text, read: sim.story.read.has(id) });
  }
  return out;
}
