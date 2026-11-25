// A small, general branching-dialogue engine (spec §7.1). Simulation side: pure, deterministic, no eval.
//
// ---- Tree format (data/dialogue_<name>.json) ------------------------------------------------------------------
//   { "id": "marek", "start": "<node id>", "speakers": { "<speaker id>": "<shown name>" }, "nodes": [ <node>, ... ] }
//   A node without a speaker is narration (no name shown).
//   node:   { id, speaker?, text | lines[], choices?: [<choice>], next?, end?, branch?: [{ if?, goto }],
//             set?, give?, take?, journal?, event? }
//     - a *router* has `branch` and no text: on entering it the first branch whose `if` holds is taken (the
//       last branch must have no `if`). Routers are how a node is gated by state.
//     - a *line* node shows `text` (or each of `lines` in turn, one `advance` each). After its last line it
//       shows its choices, or `advance` goes to `next`, or ends the conversation if `end` is true.
//     - effects (set/give/take/journal/event) run once, when the node is entered.
//   choice: { text, goto? | end?, if?, once?, exit?, id?, set?, give?, take?, journal?, event? }
//     - hidden while its `if` fails; a `once` choice is hidden after it was picked (remembered by `id`, default
//       "<node>#<index>"); `exit` marks the choice the Esc key picks (leave / go back); effects run when picked.
//
// ---- Conditions (`if`) ----------------------------------------------------------------------------------------
//   expr   := or;  or := and ('|' and)*;  and := not ('&' not)*;  not := '!' not | '(' expr ')' | atom
//   atom   := flag                         a story flag is set               e.g. met_marek
//           | has:<item>                   the player carries the item       has:fish
//           | inspected:<site>             a Fallen Outsider site was seen   inspected:sailor_remains
//           | recipe:<id>                  the recipe was learned            recipe:driftwood_totem
//           | tier:quiet|humming|agitated  Resonance tier
//           | time:night|dawn|day|dusk     phase of the day
//           | tide:low|rising|high|falling tide state
//           | weather:clear|squall
//           | light:on|off                 the player's flashlight
//           | <number name> <op> <integer> op: >= <= > < == !=; names: visits (conversations started with this
//                                          tree, the current one included), inspected (sites seen), hour, day,
//                                          resonance, or any story counter
//   Names are lower case: [a-z][a-z0-9_]*.
//
// ---- Effects ---------------------------------------------------------------------------------------------------
//   set:     "flag" | "!flag" (clear) | "counter+=n" | "counter=n"      (a string or a list)
//   give:    "recipe:<id>" (learned, + event recipe_learned) | "item:<id>" or "<id>" (host.give)
//   take:    "item:<id>" or "<id>" (host.take)
//   journal: "<entry id>" (appended once, + event journal_entry)
//   event:   "<type>" or { type, ... } (appended to sim.events with `source: 'dialogue'`)
//
// ---- Input ------------------------------------------------------------------------------------------------------
// While a conversation is active the Sim feeds the tick input to `step`: `hotbar` n (0-based) picks the n-th
// *visible* choice, `interact` advances. Nothing else in the world runs (see Sim.step).

/** condition atoms with a fixed set of values */
export const STATE_VALUES = Object.freeze({
  tier: Object.freeze(['quiet', 'humming', 'agitated']),
  time: Object.freeze(['night', 'dawn', 'day', 'dusk']),
  tide: Object.freeze(['low', 'rising', 'high', 'falling']),
  weather: Object.freeze(['clear', 'squall']),
  light: Object.freeze(['on', 'off']),
});
/** condition atoms whose argument is an id (item, site, recipe) */
export const ID_OPS = Object.freeze(['has', 'inspected', 'recipe']);
/** built-in numeric values (others are story counters) */
export const NUMBERS = Object.freeze(['visits', 'inspected', 'hour', 'day', 'resonance']);
const COMPARE = Object.freeze(['>=', '<=', '==', '!=', '>', '<']);
const NAME = /^[a-z][a-z0-9_]*$/;
const MAX_ROUTE_HOPS = 32;

export class DialogueError extends Error {}

// ---- conditions ----------------------------------------------------------------------------------------------

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if ('!&|()'.includes(c) && !(c === '!' && src[i + 1] === '=')) { out.push({ t: c }); i++; continue; }
    const cmp = COMPARE.find((op) => src.startsWith(op, i));
    if (cmp) { out.push({ t: 'cmp', v: cmp }); i += cmp.length; continue; }
    const m = /^[a-z0-9_:.-]+/.exec(src.slice(i));
    if (!m) throw new DialogueError(`unexpected "${c}" at ${i}`);
    out.push({ t: 'word', v: m[0] });
    i += m[0].length;
  }
  return out;
}

function atomOf(word, src) {
  const colon = word.indexOf(':');
  if (colon < 0) {
    if (!NAME.test(word)) throw new DialogueError(`bad flag name "${word}" in "${src}"`);
    return { k: 'flag', name: word };
  }
  const op = word.slice(0, colon);
  const arg = word.slice(colon + 1);
  if (!NAME.test(arg)) throw new DialogueError(`bad argument "${arg}" in "${src}"`);
  if (ID_OPS.includes(op)) return { k: op, id: arg };
  if (STATE_VALUES[op]) {
    if (!STATE_VALUES[op].includes(arg)) throw new DialogueError(`${op}: expected one of ${STATE_VALUES[op].join(', ')}, got "${arg}" in "${src}"`);
    return { k: 'state', kind: op, value: arg };
  }
  throw new DialogueError(`unknown operator "${op}:" in "${src}"`);
}

/**
 * Parse a condition string into a tree. Throws DialogueError on bad syntax.
 * @param {string} src
 * @returns {Object} AST: { k: 'and'|'or', a, b } | { k: 'not', a } | { k: 'flag', name } | { k: 'has'|'inspected'|'recipe', id }
 *   | { k: 'state', kind, value } | { k: 'cmp', name, op, n }
 */
export function parseCondition(src) {
  if (typeof src !== 'string' || !src.trim()) throw new DialogueError(`condition must be a non-empty string, got ${JSON.stringify(src)}`);
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const expect = (t) => {
    if (peek()?.t !== t) throw new DialogueError(`expected "${t}" in "${src}"`);
    p++;
  };
  const primary = () => {
    const tok = peek();
    if (!tok) throw new DialogueError(`unexpected end of "${src}"`);
    if (tok.t === '!') { p++; return { k: 'not', a: primary() }; }
    if (tok.t === '(') { p++; const e = or(); expect(')'); return e; }
    if (tok.t !== 'word') throw new DialogueError(`unexpected "${tok.v ?? tok.t}" in "${src}"`);
    p++;
    if (peek()?.t === 'cmp') {
      const op = toks[p++].v;
      const num = peek();
      if (num?.t !== 'word' || !/^-?\d+$/.test(num.v)) throw new DialogueError(`expected an integer after "${op}" in "${src}"`);
      p++;
      if (!NAME.test(tok.v)) throw new DialogueError(`bad number name "${tok.v}" in "${src}"`);
      return { k: 'cmp', name: tok.v, op, n: Number(num.v) };
    }
    return atomOf(tok.v, src);
  };
  const and = () => {
    let a = primary();
    while (peek()?.t === '&') { p++; a = { k: 'and', a, b: primary() }; }
    return a;
  };
  const or = () => {
    let a = and();
    while (peek()?.t === '|') { p++; a = { k: 'or', a, b: and() }; }
    return a;
  };
  const ast = or();
  if (p !== toks.length) throw new DialogueError(`unexpected "${toks[p].v ?? toks[p].t}" in "${src}"`);
  return ast;
}

/**
 * @typedef {Object} ConditionContext
 * @property {(name: string) => boolean} flag
 * @property {(item: string) => boolean} has
 * @property {(site: string) => boolean} inspected
 * @property {(id: string) => boolean} recipe
 * @property {(kind: string) => string} state      'tier' | 'time' | 'tide' | 'weather' | 'light'
 * @property {(name: string) => number} value
 */

/**
 * @param {Object} ast from parseCondition
 * @param {ConditionContext} ctx
 * @returns {boolean}
 */
export function evalCondition(ast, ctx) {
  switch (ast.k) {
    case 'and': return evalCondition(ast.a, ctx) && evalCondition(ast.b, ctx);
    case 'or': return evalCondition(ast.a, ctx) || evalCondition(ast.b, ctx);
    case 'not': return !evalCondition(ast.a, ctx);
    case 'flag': return !!ctx.flag(ast.name);
    case 'has': return !!ctx.has(ast.id);
    case 'inspected': return !!ctx.inspected(ast.id);
    case 'recipe': return !!ctx.recipe(ast.id);
    case 'state': return ctx.state(ast.kind) === ast.value;
    case 'cmp': {
      const v = ctx.value(ast.name);
      switch (ast.op) {
        case '>=': return v >= ast.n;
        case '<=': return v <= ast.n;
        case '>': return v > ast.n;
        case '<': return v < ast.n;
        case '==': return v === ast.n;
        default: return v !== ast.n;
      }
    }
    default: throw new DialogueError(`unknown condition node ${ast.k}`);
  }
}

/** every atom of a condition tree, for validators */
export function conditionAtoms(ast, out = []) {
  if (ast.a) conditionAtoms(ast.a, out);
  if (ast.b) conditionAtoms(ast.b, out);
  if (!ast.a && !ast.b) out.push(ast);
  return out;
}

// ---- effects -------------------------------------------------------------------------------------------------

const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** parse one `set` entry */
export function parseSet(s) {
  if (typeof s !== 'string') throw new DialogueError(`set: expected a string, got ${JSON.stringify(s)}`);
  let m = /^!([a-z][a-z0-9_]*)$/.exec(s);
  if (m) return { op: 'clear', name: m[1] };
  m = /^([a-z][a-z0-9_]*)(\+=|=)(-?\d+)$/.exec(s);
  if (m) return { op: m[2] === '+=' ? 'add' : 'assign', name: m[1], n: Number(m[3]) };
  if (NAME.test(s)) return { op: 'flag', name: s };
  throw new DialogueError(`set: bad entry "${s}"`);
}

/** parse one `give`/`take` entry: { kind: 'recipe'|'item', id } */
export function parseGive(s) {
  if (typeof s !== 'string') throw new DialogueError(`give/take: expected a string, got ${JSON.stringify(s)}`);
  const m = /^(?:(recipe|item):)?([a-z][a-z0-9_]*)$/.exec(s);
  if (!m) throw new DialogueError(`give/take: bad entry "${s}"`);
  return { kind: m[1] ?? 'item', id: m[2] };
}

/** compile the effects of a node or choice (throws on a bad entry) */
function compileEffects(o) {
  const ev = list(o.event).map((e) => {
    if (typeof e === 'string' && NAME.test(e)) return { type: e };
    if (e && typeof e === 'object' && typeof e.type === 'string' && NAME.test(e.type)) return { ...e };
    throw new DialogueError(`event: bad entry ${JSON.stringify(e)}`);
  });
  const journal = list(o.journal).map((j) => {
    if (typeof j !== 'string' || !NAME.test(j)) throw new DialogueError(`journal: bad entry ${JSON.stringify(j)}`);
    return j;
  });
  return { set: list(o.set).map(parseSet), give: list(o.give).map(parseGive), take: list(o.take).map(parseGive), journal, event: ev };
}

const hasEffects = (fx) => fx.set.length + fx.give.length + fx.take.length + fx.journal.length + fx.event.length > 0;

// ---- trees -------------------------------------------------------------------------------------------------------

/**
 * Compile a dialogue tree: conditions and effects parsed, gotos checked. Throws DialogueError on the first problem
 * (tools/lib/validate-dialogue.mjs reports all of them, plus reachability and the softlock rules).
 * @param {Object} json
 * @returns {{ id: string, start: string, speakers: Record<string, string>, nodes: Map<string, Object> }}
 */
export function compileTree(json) {
  if (!json || typeof json !== 'object') throw new DialogueError('tree: expected an object');
  if (typeof json.id !== 'string' || !NAME.test(json.id)) throw new DialogueError(`tree: bad id ${JSON.stringify(json.id)}`);
  if (!Array.isArray(json.nodes)) throw new DialogueError(`tree ${json.id}: nodes must be a list`);
  const nodes = new Map();
  const at = (n, what) => `${json.id}/${n.id}: ${what}`;
  for (const raw of json.nodes) {
    if (!raw || typeof raw.id !== 'string' || !raw.id) throw new DialogueError(`tree ${json.id}: a node without an id`);
    if (nodes.has(raw.id)) throw new DialogueError(at(raw, 'duplicate id'));
    const wrap = (what, fn) => {
      try { return fn(); } catch (e) { throw new DialogueError(at(raw, `${what}: ${e.message}`)); }
    };
    const node = { id: raw.id, speaker: raw.speaker ?? null, raw };
    if (raw.branch) {
      if (raw.text != null || raw.lines != null || raw.choices || raw.next || raw.end) throw new DialogueError(at(raw, 'a router (branch) has no text, choices, next or end'));
      if (!Array.isArray(raw.branch) || !raw.branch.length) throw new DialogueError(at(raw, 'branch must be a non-empty list'));
      node.branch = raw.branch.map((b, i) => ({ goto: b.goto, cond: b.if != null ? wrap(`branch ${i} if`, () => parseCondition(b.if)) : null, src: b.if ?? null }));
      if (node.branch[node.branch.length - 1].cond) throw new DialogueError(at(raw, 'the last branch must have no condition'));
    } else {
      const lines = raw.lines ?? (raw.text != null ? [raw.text] : null);
      if (!Array.isArray(lines) || !lines.length || lines.some((l) => typeof l !== 'string' || !l.trim())) throw new DialogueError(at(raw, 'needs text or lines (non-empty strings)'));
      node.lines = lines;
      node.next = raw.next ?? null;
      node.end = !!raw.end;
      node.choices = (raw.choices ?? []).map((c, i) => {
        if (!c || typeof c.text !== 'string' || !c.text.trim()) throw new DialogueError(at(raw, `choice ${i} needs text`));
        if (!c.goto === !c.end) throw new DialogueError(at(raw, `choice ${i} needs exactly one of goto or end`));
        return {
          index: i, text: c.text, goto: c.goto ?? null, end: !!c.end, once: !!c.once, exit: !!c.exit,
          id: c.id ?? `${raw.id}#${i}`,
          cond: c.if != null ? wrap(`choice ${i} if`, () => parseCondition(c.if)) : null, src: c.if ?? null,
          fx: wrap(`choice ${i} effects`, () => compileEffects(c)),
        };
      });
      const exits = (node.next ? 1 : 0) + (node.end ? 1 : 0) + (node.choices.length ? 1 : 0);
      if (exits !== 1) throw new DialogueError(at(raw, 'needs exactly one of choices, next or end'));
    }
    node.fx = wrap('effects', () => compileEffects(raw));
    if (node.branch && hasEffects(node.fx)) throw new DialogueError(at(raw, 'a router has no effects'));
    nodes.set(raw.id, node);
  }
  const check = (from, to) => { if (!nodes.has(to)) throw new DialogueError(`${json.id}/${from}: goto "${to}" does not exist`); };
  for (const n of nodes.values()) {
    if (n.branch) n.branch.forEach((b) => check(n.id, b.goto));
    if (n.next) check(n.id, n.next);
    for (const c of n.choices ?? []) if (c.goto) check(n.id, c.goto);
  }
  if (!nodes.has(json.start)) throw new DialogueError(`tree ${json.id}: start "${json.start}" does not exist`);
  return { id: json.id, start: json.start, speakers: { ...(json.speakers ?? {}) }, nodes };
}

// ---- story state ---------------------------------------------------------------------------------------------

const sorted = (set) => [...set].sort();

/**
 * Everything the story remembers: flags, counters, conversations started per tree, Fallen Outsider sites seen,
 * recipes learned, journal entries, once-only choices used, and the conversation in progress.
 */
export class Story {
  constructor() {
    /** @type {Set<string>} */
    this.flags = new Set();
    /** @type {Record<string, number>} */
    this.counters = {};
    /** @type {Record<string, number>} conversations started, per tree */
    this.visits = {};
    /** @type {Set<string>} */
    this.inspected = new Set();
    /** @type {Set<string>} */
    this.recipes = new Set();
    /** @type {string[]} journal entry ids in the order they were added (dialogue and lore, Lore.js) */
    this.journal = [];
    /** @type {Set<string>} journal entries the player has opened (the Journal's unread marks) */
    this.read = new Set();
    /** @type {Set<string>} ids of once-only choices already picked */
    this.used = new Set();
    /** @type {{ tree: string, node: string, line: number }|null} */
    this.conversation = null;
  }

  /** @returns {Object} JSON-serialisable, key and element order fixed */
  snapshot() {
    const counters = {};
    for (const k of Object.keys(this.counters).sort()) counters[k] = this.counters[k];
    const visits = {};
    for (const k of Object.keys(this.visits).sort()) visits[k] = this.visits[k];
    return {
      flags: sorted(this.flags), counters, visits, inspected: sorted(this.inspected), recipes: sorted(this.recipes),
      journal: [...this.journal], read: sorted(this.read), used: sorted(this.used), conversation: this.conversation ? { ...this.conversation } : null,
    };
  }

  /** @param {Object|null|undefined} s from snapshot(); missing (an older save) gives a fresh story */
  static restore(s) {
    const st = new Story();
    if (!s) return st;
    st.flags = new Set(s.flags ?? []);
    st.counters = { ...(s.counters ?? {}) };
    st.visits = { ...(s.visits ?? {}) };
    st.inspected = new Set(s.inspected ?? []);
    st.recipes = new Set(s.recipes ?? []);
    st.journal = [...(s.journal ?? [])];
    st.read = new Set(s.read ?? []);   // older saves: nothing read
    st.used = new Set(s.used ?? []);
    st.conversation = s.conversation ? { tree: s.conversation.tree, node: s.conversation.node, line: s.conversation.line | 0 } : null;
    return st;
  }
}

// ---- the engine --------------------------------------------------------------------------------------------

/**
 * @typedef {Object} DialogueHost  what the engine asks of the world (Sim + the hooks adapter)
 * @property {(item: string) => boolean} has
 * @property {(kind: string) => string} state       tier | time | tide | weather | light
 * @property {(name: string) => number|undefined} number  hour | day | resonance (else undefined)
 * @property {(item: string) => void} give
 * @property {(item: string) => void} take
 * @property {(event: Object) => void} emit
 */

/**
 * @typedef {Object} DialogueView  what the UI shows
 * @property {string} tree
 * @property {string} node
 * @property {string|null} speaker  speaker id, null for narration
 * @property {string|null} name     the speaker's shown name
 * @property {string} text
 * @property {number} line        index of the line shown
 * @property {number} lineCount
 * @property {Array<{ text: string, exit: boolean }>} choices  visible choices (only on the last line)
 * @property {boolean} canAdvance  `interact` moves on (no choices to pick)
 * @property {boolean} ends        advancing ends the conversation
 * @property {number} exitChoice   index of the visible choice Esc picks, or -1
 * @property {string} key          changes whenever what is shown changes
 */

export class Dialogue {
  /**
   * @param {Object} opts
   * @param {Record<string, Object>} opts.trees  compiled trees by id
   * @param {Story} opts.story
   * @param {DialogueHost} opts.host
   */
  constructor({ trees, story, host }) {
    this.trees = trees;
    this.story = story;
    this.host = host;
    /** reused condition context */
    this.ctx = {
      flag: (n) => this.story.flags.has(n),
      has: (i) => !!this.host.has(i),
      inspected: (s) => this.story.inspected.has(s),
      recipe: (r) => this.story.recipes.has(r),
      state: (k) => this.host.state(k),
      value: (n) => this.value(n),
    };
  }

  /** a numeric value for `name OP n` conditions */
  value(name) {
    if (name === 'visits') return this.story.visits[this.story.conversation?.tree ?? ''] ?? 0;
    if (name === 'inspected') return this.story.inspected.size;
    const v = this.host.number?.(name);
    if (typeof v === 'number') return v;
    return this.story.counters[name] ?? 0;
  }

  /** true while a conversation is open */
  get active() {
    return !!this.story.conversation;
  }

  /** @returns {Object|null} the compiled node being shown */
  node() {
    const c = this.story.conversation;
    return c ? this.trees[c.tree]?.nodes.get(c.node) ?? null : null;
  }

  /** evaluate a parsed condition (null = true) */
  test(cond) {
    return !cond || evalCondition(cond, this.ctx);
  }

  /** the choices of a node the player may pick now, in order */
  visibleChoices(node) {
    return (node.choices ?? []).filter((c) => this.test(c.cond) && !(c.once && this.story.used.has(c.id)));
  }

  /**
   * Open a conversation with a tree at its start node. Does nothing (returns false) if one is open or the tree
   * is unknown.
   * @param {string} treeId
   * @returns {boolean}
   */
  start(treeId) {
    const tree = this.trees[treeId];
    if (!tree || this.active) return false;
    this.story.visits[treeId] = (this.story.visits[treeId] ?? 0) + 1;
    this.story.conversation = { tree: treeId, node: tree.start, line: 0 };
    this.host.emit({ type: 'dialogue_start', tree: treeId });
    this.enter(tree.start);
    return true;
  }

  /** go to a node: follow routers, run the effects of the line node reached */
  enter(id) {
    const c = this.story.conversation;
    const tree = this.trees[c.tree];
    let node = tree.nodes.get(id);
    for (let hops = 0; node?.branch; hops++) {
      if (hops >= MAX_ROUTE_HOPS) throw new DialogueError(`${c.tree}/${id}: router loop`);
      const b = node.branch.find((x) => this.test(x.cond));
      node = tree.nodes.get(b.goto);
    }
    if (!node) { this.end(); return; }
    c.node = node.id;
    c.line = 0;
    this.host.emit({ type: 'dialogue_node', tree: c.tree, node: node.id });
    this.apply(node.fx);
  }

  /** run effects */
  apply(fx) {
    const st = this.story;
    for (const s of fx.set) {
      if (s.op === 'flag') st.flags.add(s.name);
      else if (s.op === 'clear') st.flags.delete(s.name);
      else if (s.op === 'add') st.counters[s.name] = (st.counters[s.name] ?? 0) + s.n;
      else st.counters[s.name] = s.n;
    }
    for (const g of fx.give) {
      if (g.kind === 'recipe') {
        if (!st.recipes.has(g.id)) {
          st.recipes.add(g.id);
          this.host.emit({ type: 'recipe_learned', id: g.id, source: 'dialogue' });
        }
      } else this.host.give(g.id);
    }
    for (const t of fx.take) this.host.take(t.id);
    for (const j of fx.journal) {
      if (!st.journal.includes(j)) {
        st.journal.push(j);
        this.host.emit({ type: 'journal_entry', id: j, source: 'dialogue' });
      }
    }
    for (const e of fx.event) this.host.emit({ ...e, source: 'dialogue' });
  }

  /** @returns {DialogueView|null} what to show, or null when no conversation is open */
  current() {
    const c = this.story.conversation;
    const node = this.node();
    if (!c || !node) return null;
    const last = c.line >= node.lines.length - 1;
    const vis = last ? this.visibleChoices(node) : [];
    const exitChoice = vis.findIndex((ch) => ch.exit);
    return {
      tree: c.tree, node: node.id, speaker: node.speaker, name: node.speaker ? this.trees[c.tree].speakers[node.speaker] ?? node.speaker : null, text: node.lines[Math.min(c.line, node.lines.length - 1)],
      line: c.line, lineCount: node.lines.length,
      choices: vis.map((ch) => ({ text: ch.text, exit: ch.exit })),
      canAdvance: vis.length === 0, ends: last && vis.length === 0 && !node.next, exitChoice,
      key: `${c.tree}/${node.id}/${c.line}/${this.story.visits[c.tree] ?? 0}`,
    };
  }

  /**
   * Pick the index-th visible choice. Ignored (false) before the last line, or with a bad index.
   * @param {number} index 0-based among the visible choices
   * @returns {boolean}
   */
  choose(index) {
    const c = this.story.conversation;
    const node = this.node();
    if (!c || !node || c.line < node.lines.length - 1) return false;
    const ch = this.visibleChoices(node)[index];
    if (!ch) return false;
    if (ch.once) this.story.used.add(ch.id);
    this.host.emit({ type: 'dialogue_choice', tree: c.tree, node: node.id, choice: ch.id });
    this.apply(ch.fx);
    if (ch.end) this.end();
    else this.enter(ch.goto);
    return true;
  }

  /**
   * Next line, or follow `next`, or end. Ignored (false) while choices are waiting.
   * @returns {boolean}
   */
  advance() {
    const c = this.story.conversation;
    const node = this.node();
    if (!c) return false;
    if (!node) { this.end(); return true; }
    if (c.line < node.lines.length - 1) { c.line++; return true; }
    if (this.visibleChoices(node).length) return false;
    if (node.next) this.enter(node.next);
    else this.end();
    return true;
  }

  /** close the conversation now */
  end() {
    const c = this.story.conversation;
    if (!c) return;
    this.story.conversation = null;
    this.host.emit({ type: 'dialogue_end', tree: c.tree, node: c.node });
  }

  /**
   * One tick of input while a conversation is open: `hotbar` n picks a choice, else `interact` advances.
   * @param {{ hotbar: number, interact: boolean }} input sanitized tick input
   */
  step(input) {
    if (!this.active) return;
    if (input.hotbar >= 0) this.choose(input.hotbar);
    else if (input.interact) this.advance();
  }
}
