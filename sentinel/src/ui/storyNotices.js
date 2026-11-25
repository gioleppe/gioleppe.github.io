// Notices for the Journal, crafting and the shipwreck (steps 4.6, 4.7), registered with the shared notice queue
// (src/ui/Notices.js), which the item HUD feeds with every step's events. Presentation only.
import { registerNotice, NOTICE_COLORS } from './Notices.js';

const titleOf = (sim, id) => sim?.lore?.get(id)?.title ?? null;
const nameOf = (sim, id) => (sim?.catalog?.get(id)?.name ?? id).toLowerCase();
/** item names; an entry that is a list is alternatives ("bone or reef shell") */
const list = (sim, ids) => ids.map((i) => (Array.isArray(i) ? i.map((x) => nameOf(sim, x)).join(' or ') : nameOf(sim, i))).join(', ');

/**
 * The notice for a story event, or null. Exported for tests.
 * @param {Object} e sim event
 * @param {Object} sim
 * @returns {string|{ text: string, color?: string, key?: string }|null}
 */
export function storyNotice(e, sim) {
  switch (e.type) {
    case 'journal_entry': {
      const t = titleOf(sim, e.id);
      // one line for however many entries arrive together (the Cartographer's camp unlocks five)
      // hints arrive alongside the note that taught them and show on the Objectives tab; no line of their own
      if (e.category === 'objective') return null;
      const batch = (sim?.events ?? []).filter((x) => x.type === 'journal_entry' && x.category !== 'objective');
      if (batch.length > 1 && batch[0] !== e) return null;
      const more = batch.length > 1 ? ` (+${batch.length - 1})` : '';
      return { text: t ? `Journal updated: ${t}${more}` : 'Journal updated', color: NOTICE_COLORS.warn, key: 'journal' };
    }
    case 'map_revealed': return e.landmarks?.length ? { text: `${e.landmarks.length} places copied onto your map`, color: NOTICE_COLORS.warn, key: 'map_revealed' } : null;
    case 'recipe_learned': return { text: `Learned to make: ${sim?.recipeBook?.get(e.id)?.name ?? e.id.replace(/_/g, ' ')}`, color: NOTICE_COLORS.warn, key: `recipe:${e.id}` };
    case 'crafted': return `Made a ${nameOf(sim, e.item)}`;
    case 'craft_failed': {
      const why = {
        missing: `Not enough to make it: need ${list(sim, e.missing ?? [])}`,
        no_room: 'No room for it, even after using the parts',
        limit: 'You have already made one; it is enough',
        not_known: 'You do not know how to make that',
        at: 'That is made somewhere else',
      }[e.reason];
      return why ? { text: why, color: NOTICE_COLORS.warn, key: 'craft' } : null;
    }
    case 'dinghy_inspected': return e.missing?.length
      ? { text: `It could be patched. Still needed: ${list(sim, e.missing)}`, color: NOTICE_COLORS.warn, key: 'dinghy' }
      : { text: 'It could be patched, and you have what it takes', key: 'dinghy' };
    case 'dinghy_repair_start': return { text: 'You start patching the dinghy…', key: 'dinghy' };
    case 'dinghy_repaired': return { text: 'The dinghy is patched. It needs high water to go.', color: NOTICE_COLORS.warn, key: 'dinghy' };
    case 'dinghy_waits': return { text: e.highTide ? 'High water. Not yet: one last look at the island.' : 'It floats. Wait for high water to launch.', key: 'dinghy' };
    case 'hatch_inspected': return { text: 'The hatch will not move by hand. It needs a bar.', color: NOTICE_COLORS.warn, key: 'hatch' };
    case 'hatch_pry_start': return { text: 'You lean on the crowbar. Steel shrieks.', color: NOTICE_COLORS.warn, key: 'hatch' };
    case 'hatch_opened': return { text: 'The hatch gives. Anyone near heard that.', color: NOTICE_COLORS.warn, key: 'hatch' };
    case 'battery_humming': return { text: 'The battery is switched on and humming. Use it in hand to switch it off.', color: '#8b5cf6', key: 'battery' };
    case 'flare_refused': return e.reason === 'empty'
      ? { text: 'The flare gun is empty.', color: NOTICE_COLORS.warn, key: 'flare' }
      : { text: 'Not here. The flare is for the peak, where a ship could see it.', color: NOTICE_COLORS.warn, key: 'flare' };
    case 'flare_ready': return { text: 'This is the place. Not yet.', key: 'flare' };
    case 'signal_point_inspected': return { text: 'The whole sea in view. This is the place for a signal.', key: 'signal' };
    case 'channel_end':
      if ((e.action === 'dinghy' || e.action === 'hatch') && e.reason !== 'done') return { text: 'Stopped. Nothing was used up.', color: NOTICE_COLORS.dim, key: e.action };
      return e.action === 'spring' && e.reason === 'done' ? 'Water, cold and clean' : null;
    default: return null;
  }
}

for (const type of ['journal_entry', 'map_revealed', 'recipe_learned', 'crafted', 'craft_failed', 'dinghy_inspected', 'dinghy_repair_start',
  'dinghy_repaired', 'dinghy_waits', 'hatch_inspected', 'hatch_pry_start', 'hatch_opened', 'battery_humming', 'flare_refused', 'flare_ready',
  'signal_point_inspected', 'channel_end']) registerNotice(type, storyNotice);
