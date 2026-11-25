// Notices for the fog of war (step 3.7): a landmark discovered, the paths starting or ceasing to shift. Registered
// with the shared notice queue (src/ui/Notices.js), which the item HUD feeds with every step's events.
import { registerNotice, NOTICE_COLORS } from '../Notices.js';

/** the violet of the supernatural (palette) */
const VIOLET = '#8b5cf6';

/**
 * The notice for a fog event, or null.
 * @param {{ type: string, id?: string, name?: string, active?: boolean }} e
 */
export function fogNotice(e) {
  switch (e.type) {
    case 'landmark_discovered': return { text: `Discovered: ${e.name ?? e.id}`, color: NOTICE_COLORS.warn, key: `found:${e.id}` };
    case 'shifting_paths': return e.active
      ? { text: 'The paths are shifting…', color: VIOLET, key: 'shifting' }
      : { text: 'The paths hold still again.', color: NOTICE_COLORS.dim, key: 'shifting' };
    default: return null;
  }
}

registerNotice('landmark_discovered', fogNotice);
registerNotice('shifting_paths', fogNotice);
