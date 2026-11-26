// Debug tools for saving (step 5.2; `?debug` only): a live readout of saveRules.canSave and the saves, and
// actions to force an autosave, damage the newest autosave (one flipped digit: the checksum catches it and Continue
// falls back to the backup), fill storage until it is full (quota errors), free it again, and clear every save.
// The debug snapshot slots (sentinel.debug.slot.*) and scenarios are separate and untouched.
import { canSave } from '../../sim/saveRules.js';
import { COLORS } from './layers.js';

export const FILL_PREFIX = 'sentinel.debug.fill.';

/** flip one digit inside the snapshot part of a save's text (still valid JSON, wrong checksum) */
export function corruptText(text) {
  const at = text.indexOf('"snapshot"');
  for (let i = Math.max(0, at) + 12; i < text.length; i++) {
    const c = text[i];
    if (c >= '0' && c <= '9') return text.slice(0, i) + (c === '9' ? '8' : String(Number(c) + 1)) + text.slice(i + 1);
  }
  return `${text.slice(0, -2)}#`;
}

/**
 * @param {import('./DebugMode.js').DebugMode} debug
 * @param {{ store: import('../SaveStore.js').SaveStore, autosave: import('../Autosave.js').Autosave, session: Object }} env
 */
export function registerSaveDebug(debug, { store, autosave, session }) {
  debug.addLayer({
    id: 'saves', label: 'Saving: canSave + slots', group: 'readouts', default: false,
    drawUi(ctx, sim, vp, e) {
      const c = canSave(sim);
      const lines = [
        { text: `canSave: ${c.ok ? 'yes' : `NO (${c.code}) ${c.reason}`}`, color: c.ok ? COLORS.text : '#f2a33a' },
        { text: `threat ${sim.threat?.level ?? 'none'}  pending ${autosave.pending ?? '-'}  next in ${Math.max(0, Math.round((autosave.everyTicks - (sim.tick - autosave.lastTick)) / 60))}s  storage ${store.available ? 'ok' : 'UNAVAILABLE'}${store.lastError ? ` (${store.lastError.code})` : ''}`, color: COLORS.text },
        ...store.list().map((s) => ({ text: `  ${s.id.padEnd(8)} ${s.empty ? '-' : s.ok ? `#${s.env.seq} t${s.env.createdAtTick} ${(s.bytes / 1024).toFixed(1)} KB${s.memoryOnly ? ' (memory)' : ''}` : `BAD ${s.error}`}`, color: COLORS.text })),
      ];
      e.textBlock(ctx, lines);
    },
  });
  const act = (id, label, run) => debug.addAction({ id, label, group: 'save', run });
  act('save-force', 'Force an autosave (ignores canSave)', (sim) => {
    const r = autosave.write(sim, 'debug');
    debug.say(r.ok ? `autosaved into ${r.id} (${(r.bytes / 1024).toFixed(1)} KB)` : `autosave failed: ${r.message}`);
  });
  act('save-corrupt', 'Corrupt the newest autosave', () => {
    const n = store.newestFirst().find((s) => s.kind === 'auto');
    if (!n) { debug.say('no autosave'); return; }
    const raw = store.readRaw(n.id);
    try { store.storage?.setItem(store.key(n.id), corruptText(raw)); } catch { /* storage refused */ }
    if (store.memory.has(n.id)) store.memory.set(n.id, corruptText(raw));
    debug.say(`${n.id} corrupted`);
  });
  act('save-fill', 'Fill storage until it is full', () => {
    const chunk = 'x'.repeat(256 * 1024);
    let n = 0;
    try { for (; n < 200; n++) store.storage?.setItem(`${FILL_PREFIX}${n}`, chunk); } catch { /* full */ }
    debug.say(`filled ${n} x 256 KB`);
  });
  act('save-unfill', 'Free the filled storage', () => {
    for (let n = 0; n < 200; n++) { try { store.storage?.removeItem(`${FILL_PREFIX}${n}`); } catch { /* */ } }
    debug.say('storage freed');
  });
  act('save-clear', 'Clear every player save', () => { store.clearAll(); session.resetCaches?.(); debug.say('saves cleared'); });
}
