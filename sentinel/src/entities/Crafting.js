// Simple context crafting (spec §6.4, step 4.7): no workbench. data/recipes.json compiled once; a recipe that
// `gives` an item is made from the Journal's Recipes tab (the tick input's `journal` craft:<id>) or by using one of
// its ingredients in hand; a recipe made `at` an interactable (the dinghy) is made there, over a channel, by that
// interaction's handler (storyInteractions.js), which uses checkIngredients / spendIngredients from here.
//
// Rules (asserted in tests/crafting.test.mjs):
//   - all or nothing: the ingredients are checked first and spent with `inventory.spend(id, n, purpose)` only
//     when everything is there and the result fits;
//   - the result fits when there is room *after* the spend (spending may free a slot, or may not: a stack of
//     three driftwood keeps its slot), worked out on a copy of the inventory;
//   - `maxCrafts`: how many times a recipe can ever be made (story counter `crafted_<id>`), so the totem can never
//     eat the paracord and driftwood the dinghy needs (softlock rule 1);
//   - an `anyOf` ingredient never names a key item, so a choice never spends one by accident.
//
// Events: crafted { recipe, item, n, spent: [{ item, n }] }, craft_failed { recipe, reason, missing? }
//   (missing: item ids; an anyOf ingredient is a list of its alternatives)
//   reasons: unknown | not_known | at (made somewhere else) | limit | missing | no_room

import { Inventory } from './Inventory.js';

/**
 * @typedef {{ item?: string, anyOf?: string[], n: number }} Ingredient
 * @typedef {{ id: string, name: string, ingredients: Ingredient[], gives: { item: string, n: number }|null,
 *   effect: string|null, requires: { recipeKnown: boolean, at: string|null }, maxCrafts: number, consumesKey: string[] }} Recipe
 */

export class RecipeBook {
  /** @param {{ recipes: Object[] }|null|undefined} json data/recipes.json */
  constructor(json) {
    /** @type {Map<string, Recipe>} */
    this.byId = new Map();
    /** @type {Recipe[]} file order */
    this.list = [];
    for (const r of Array.isArray(json?.recipes) ? json.recipes : []) {
      if (!r || typeof r.id !== 'string') continue;
      const recipe = Object.freeze({
        id: r.id, name: String(r.name ?? r.id),
        ingredients: Object.freeze((r.ingredients ?? []).map((g) => Object.freeze({ item: g.item ?? null, anyOf: g.anyOf ? Object.freeze([...g.anyOf]) : null, n: g.n ?? 1 }))),
        gives: r.gives ? Object.freeze({ item: r.gives.item, n: r.gives.n ?? 1 }) : null,
        effect: r.effect ?? null,
        requires: Object.freeze({ recipeKnown: r.requires?.recipeKnown !== false, at: r.requires?.at ?? null }),
        maxCrafts: Number.isInteger(r.maxCrafts) ? r.maxCrafts : Infinity,
        consumesKey: Object.freeze([...(r.consumesKey ?? [])]),
      });
      this.byId.set(recipe.id, recipe);
      this.list.push(recipe);
    }
  }

  /** @returns {Recipe|null} */
  get(id) {
    return this.byId.get(id) ?? null;
  }
}

const EMPTY = new RecipeBook(null);

/**
 * The compiled recipes of a data object (`data.recipes`), cached on it (data is never state).
 * @returns {RecipeBook}
 */
export function recipeBook(data) {
  const json = data?.recipes;
  if (!json) return EMPTY;
  const cache = recipeBook.cache;
  if (!cache.has(json)) cache.set(json, new RecipeBook(json));
  return cache.get(json);
}
recipeBook.cache = new WeakMap();

/** the alternatives an ingredient accepts */
export const optionsOf = (g) => (g.anyOf ? g.anyOf : [g.item]);

/** how many times a recipe has been made */
export function craftedCount(sim, id) {
  return sim.story.counters[`crafted_${id}`] ?? 0;
}

/**
 * Each ingredient against the inventory: what it would use (the first alternative carried in full), have/need.
 * @param {import('../sim/Sim.js').Sim} sim
 * @param {Recipe} recipe
 * @returns {Array<{ options: string[], use: string, have: number, need: number, ok: boolean }>}
 */
export function checkIngredients(sim, recipe) {
  const inv = sim.inventory;
  return recipe.ingredients.map((g) => {
    const opts = optionsOf(g);
    const use = opts.find((id) => inv.count(id) >= g.n) ?? opts[0];
    const have = opts.reduce((k, id) => k + inv.count(id), 0);
    return { options: opts, use, have, need: g.n, ok: inv.count(use) >= g.n };
  });
}

/**
 * Can this recipe be made here and now? (No change to anything.)
 * @param {import('../sim/Sim.js').Sim} sim
 * @param {string} id
 * @param {{ at?: string|null }} [where] the interactable action the player is using (the dinghy), or none
 * @returns {{ ok: boolean, reason: string|null, recipe: Recipe|null, status: ReturnType<typeof checkIngredients>, missing: string[] }}
 */
export function checkCraft(sim, id, { at = null } = {}) {
  const recipe = sim.recipeBook.get(id);
  const fail = (reason, status = [], missing = []) => ({ ok: false, reason, recipe, status, missing });
  if (!recipe) return fail('unknown');
  if (recipe.requires.recipeKnown && !sim.story.recipes.has(id)) return fail('not_known');
  if ((recipe.requires.at ?? null) !== at) return fail('at');
  if (craftedCount(sim, id) >= recipe.maxCrafts) return fail('limit');
  const status = checkIngredients(sim, recipe);
  const missing = status.filter((s) => !s.ok).map((s) => (s.options.length > 1 ? [...s.options] : s.options[0]));
  if (missing.length) return fail('missing', status, missing);
  if (recipe.gives) {
    // the result must fit once the ingredients are gone: try it on a copy
    const copy = Inventory.restore(sim.inventory.snapshot(), sim.catalog, sim.inventory.size);
    for (const s of status) copy.spend(s.use, s.need, 'check');
    if (copy.canAdd(recipe.gives.item, recipe.gives.n) < recipe.gives.n) return fail('no_room', status);
  }
  return { ok: true, reason: null, recipe, status, missing: [] };
}

/**
 * Spend a checked recipe's ingredients (all of them: the caller has just checked).
 * @returns {Array<{ item: string, n: number }>} what was spent
 */
export function spendIngredients(sim, status, purpose) {
  const spent = [];
  for (const s of status) {
    if (sim.inventory.spend(s.use, s.need, purpose) === s.need) spent.push({ item: s.use, n: s.need });
  }
  return spent;
}

/** count one more making of a recipe */
export function countCraft(sim, id) {
  sim.story.counters[`crafted_${id}`] = craftedCount(sim, id) + 1;
}

/**
 * Make a recipe that gives an item, now (the Journal's Make, or an ingredient used in hand).
 * @param {import('../sim/Sim.js').Sim} sim
 * @param {string} id
 * @param {string} [source] 'journal' | 'hand'
 * @returns {boolean} made
 */
export function craft(sim, id, source = 'journal') {
  const c = checkCraft(sim, id);
  if (!c.ok || !c.recipe.gives) {
    sim.events.push({ type: 'craft_failed', recipe: id, reason: c.ok ? 'at' : c.reason, missing: c.missing, source });
    return false;
  }
  const spent = spendIngredients(sim, c.status, `craft:${id}`);
  const n = sim.inventory.add(c.recipe.gives.item, c.recipe.gives.n);
  countCraft(sim, id);
  sim.events.push({ type: 'crafted', recipe: id, item: c.recipe.gives.item, n, spent, source });
  return true;
}

/**
 * The quick context action: `useItem` with an ingredient in hand of a known recipe that gives an item makes it
 * (or says what is missing). Returns false when the item in hand is no such ingredient (the ordinary use follows).
 * @param {import('../sim/Sim.js').Sim} sim
 */
export function craftFromHand(sim) {
  const held = sim.inventory.heldId;
  if (!held) return false;
  for (const r of sim.recipeBook.list) {
    if (!r.gives || r.requires.at || !sim.story.recipes.has(r.id)) continue;
    if (!r.ingredients.some((g) => optionsOf(g).includes(held))) continue;
    craft(sim, r.id, 'hand');
    return true;
  }
  return false;
}

/**
 * What the Journal's Recipes tab shows: every known recipe with have/need per ingredient and its state.
 * @param {import('../sim/Sim.js').Sim} sim
 * @returns {Array<{ id: string, name: string, ingredients: Array<{ label: string, have: number, need: number }>,
 *   state: 'make'|'missing'|'made'|'at', at: string|null, note: string|null }>}
 */
export function recipeViews(sim) {
  const out = [];
  const nameOf = (id) => sim.catalog.get(id)?.name ?? id;
  for (const r of sim.recipeBook.list) {
    if (r.requires.recipeKnown && !sim.story.recipes.has(r.id)) continue;
    const status = checkIngredients(sim, r);
    const done = craftedCount(sim, r.id) >= r.maxCrafts;
    let state;
    if (done) state = 'made';
    else if (r.requires.at) state = 'at';
    else state = checkCraft(sim, r.id).ok ? 'make' : 'missing';
    out.push({
      id: r.id, name: r.name, state, at: r.requires.at,
      ingredients: status.map((s) => ({ label: s.options.map(nameOf).join(' or '), have: s.have, need: s.need })),
      note: done && r.gives ? 'Made. One is enough.' : null,
    });
  }
  return out;
}
