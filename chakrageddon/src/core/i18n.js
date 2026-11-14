// Localisation. English is the source language: every player-facing string in the code is written in English
// and wrapped in tl(); every player-facing string in data/*.json is English text. A language is a set of
// dictionaries (data/lang/<code>/*.json, flat { "English source": "translation" }) listed in data/lang/langs.json.
// A missing entry falls back to the English source, so a half-translated language never breaks the game.
//
// To add a language: add an entry to data/lang/langs.json and put its dictionaries in data/lang/<code>/.
// Run `npm run i18n` to see what is still untranslated.

let dict = {};
let current = 'en';

export function setLanguage(code, d) { current = code || 'en'; dict = d || {}; }
export const language = () => current;

/** tl('Hello {0}', name): the translation of the English source (or the source itself), with {0}, {1}... filled in */
export function tl(en, ...args) {
  const s = Object.prototype.hasOwnProperty.call(dict, en) ? dict[en] : en;
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] ?? m)) : s;
}

/** tl() for a count: tln(n, 'one thing', '{0} things') picks the singular source when n is 1 */
export function tln(n, one, many) { return n === 1 ? tl(one, n) : tl(many, n); }

// ---- the data files ----
// Text in data/*.json sits under these keys (and under the arrays they hold). Everything else is an id, a number
// or an enum. The same list drives the extractor (tools/i18n.mjs), so what is translated is what is checked.
export const TEXT_KEYS = new Set([
  't', 's', 'choice', 'intro', 'defeat', 'after', 'name', 'text', 'peak', 'ego', 'desc', 'journalNotes', 'line',
  'offer', 'setWait', 'note', 'what', 'short', 'boss', 'closedText', 'closedBy', 'cordonText', 'say', 'rising',
  'who', 'subtitle', 'down', 'up',
]);

/** calls visit(string) for every translatable string in the raw data, in order (with repeats) */
export function walkText(raw, visit) {
  const go = (v, key) => {
    if (typeof v === 'string') { if (TEXT_KEYS.has(key)) visit(v); return; }
    if (Array.isArray(v)) { v.forEach((x) => go(x, key)); return; }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) go(v[k], k);
  };
  go(raw, '');
  // the text that sits under ids instead of under a text key: the Fanny Pack map labels and the glossary terms
  const m = raw.manifest || {};
  for (const v of Object.values(m.map || {})) if (Array.isArray(v) && typeof v[2] === 'string') visit(v[2]);
  for (const k of Object.keys(m.glossary || {})) visit(k);
}

/** a copy of raw with every translatable string looked up in d (anything missing stays English) */
export function localizeRaw(raw, d) {
  if (!d || !Object.keys(d).length) return raw;
  const look = (s) => (Object.prototype.hasOwnProperty.call(d, s) && d[s] ? d[s] : s);
  const go = (v, key) => {
    if (typeof v === 'string') return TEXT_KEYS.has(key) ? look(v) : v;
    if (Array.isArray(v)) return v.map((x) => go(x, key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).map((k) => [k, go(v[k], k)]));
    return v;
  };
  const out = {};
  for (const f of Object.keys(raw)) out[f] = go(raw[f], f);
  const m = out.manifest;
  if (m) {
    for (const v of Object.values(m.map || {})) if (Array.isArray(v) && typeof v[2] === 'string') v[2] = look(v[2]);
    if (m.glossary) m.glossary = Object.fromEntries(Object.entries(m.glossary).map(([k, v]) => [look(k), v]));
  }
  return out;
}
