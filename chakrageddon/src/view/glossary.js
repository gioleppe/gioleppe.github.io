// Key terms in running text get their own colour: key items (the blotter, the passport), other items, Astrals,
// places, and the rules of the game (Hydration, Vibes, the four levels of high). Names come from the data;
// manifest.glossary adds the words the data does not name ("blotter", "Wristbands of Enlightenment").
// termRuns(text, data) gives colour runs for drawText({ runs }).

export const TERM_COLORS = { key: '#C2185B', item: '#A8551A', astral: '#00796B', place: '#6A1B9A', rule: '#1565C0' };
export const TERM_KINDS = Object.keys(TERM_COLORS);

// terms are matched as whole words, unicode-aware so accented Italian terms (città, Perché...) are found and not cut mid-word
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let built = null, builtFor = null;
const memo = new Map();

function matcher(data) {
  if (builtFor === data && built) return built;
  const kinds = new Map();
  const add = (name, kind) => { if (name && name.length >= 3 && !kinds.has(name.toLowerCase())) kinds.set(name.toLowerCase(), kind); };
  for (const [term, kind] of Object.entries(data.manifest?.glossary || {})) add(term, kind);     // explicit terms win
  for (const it of Object.values(data.items || {})) add(it.name, it.category === 'KEY' ? 'key' : 'item');
  for (const sp of Object.values(data.dex || {})) add(sp.name, 'astral');
  for (const z of Object.values(data.zones || {})) add(z.name.replace(/^The /, ''), 'place');   // "Poi Pit", not "the Poi Pit"
  const terms = [...kinds.keys()].sort((a, b) => b.length - a.length).map(esc);
  // whole words only, with an optional plural; longest first so "Wristbands of Enlightenment" beats "Wristband"
  built = { kinds, re: terms.length ? new RegExp(`(?<!\\p{L})(${terms.join('|')})(?:s|es)?(?!\\p{L})`, 'giu') : null };
  builtFor = data; memo.clear();
  return built;
}

/** colour runs [{ from, to, color, kind }] for every key term in text */
export function termRuns(text, data) {
  if (!data || !text) return [];
  const m = matcher(data);
  if (!m.re) return [];
  const hit = memo.get(text);
  if (hit) return hit;
  const runs = [];
  for (const r of text.matchAll(m.re)) {
    const kind = m.kinds.get(r[1].toLowerCase());
    runs.push({ from: r.index, to: r.index + r[0].length, color: TERM_COLORS[kind], kind });
  }
  if (memo.size > 500) memo.clear();
  memo.set(text, runs);
  return runs;
}
