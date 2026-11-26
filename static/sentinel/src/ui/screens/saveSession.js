// Saving, as the screens see it (step 5.2): adds the save actions to the page's session object (main.js
// sessionApi) on top of the SaveStore, the Autosave scheduler and saveRules.canSave. Every load (Continue, Load,
// Retry, an import) goes through the page's one re-pointing path, `useSim`.
//
//   continueGame / retry   the newest save that loads; a damaged newer one is skipped and the player is told
//   loadSlot / saveSlot / deleteSlot / slots / newestSave / newGameWouldLose / canSave
//   exportSlot / pickImport / importInto   a save as a file (download, file picker), checked like any other
//   quitToTitle            autosaves first when the moment allows it
import { canSave } from '../../sim/saveRules.js';
import { SAVE_ERRORS, mapHashOf } from '../../engine/SaveStore.js';
import { messagePanel } from './panels.js';
import { slotLine, agoText } from './saveText.js';

/** the moment's description for file names: 'day2-0614' */
const fileTag = (env) => `day${env.day}-${String(Math.floor(env.timeOfDay)).padStart(2, '0')}${String(Math.floor((env.timeOfDay % 1) * 60)).padStart(2, '0')}`;

/** a text file download (the page) */
export function downloadText(name, text, doc = globalThis.document) {
  if (!doc?.createElement || typeof Blob === 'undefined') return false;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** a file the player picks, as text; resolves null when cancelled */
export function pickTextFile(doc = globalThis.document) {
  return new Promise((resolve, reject) => {
    if (!doc?.createElement) { resolve(null); return; }
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (!f) { resolve(null); return; }
      f.text().then(resolve, reject);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/**
 * Give the session its save actions.
 * @param {Object} api the page's session object (mutated: gets the actions below)
 * @param {Object} o
 * @param {() => Object} o.getSim the running Sim
 * @param {(sim: Object, why: string) => void} o.useSim the one re-pointing path
 * @param {() => void} o.enterGame show the plain game
 * @param {() => Object} o.freshSim a new run
 * @param {Object} o.screens
 * @param {Object} o.ui the screens' context (for messages)
 * @param {{ map: Object|null, tuning: Object, data: Object }} o.game the loaded data
 * @param {(snap: Object, ctx: Object) => Object} o.restore Sim.restore
 * @param {import('../../engine/SaveStore.js').SaveStore} o.store
 * @param {import('../../engine/Autosave.js').Autosave} o.autosave
 */
export function attachSaving(api, { getSim, useSim, enterGame, freshSim, screens, ui, game, restore, store, autosave }) {
  const ctx = { restore: (snap) => restore(snap, game), mapHash: mapHashOf(game.map) };
  const prevReset = api.resetAllData;
  /** the newest loadable save, with its restored Sim, while the stored saves stay the same */
  let cache = null;
  const signature = () => store.list().map((s) => `${s.id}:${s.ok ? s.env.checksum + s.env.seq : s.error}`).join('|');
  const newest = () => {
    const sig = signature();
    if (cache?.sig !== sig) cache = { sig, result: store.loadNewest(ctx) };
    return cache.result;
  };
  const forget = () => { cache = null; };

  /** tell the player a damaged newer save was skipped */
  const tellSkipped = (r) => {
    const used = r.info?.env?.seq ?? -1;
    const newer = r.skipped.filter((s) => !s.info.empty && (s.info.env?.seq ?? Infinity) > used);
    if (!newer.length) return;
    const what = newer[0].info.kind === 'auto' ? 'The newest autosave' : `Slot ${newer[0].info.slot + 1}`;
    const why = { corrupt: 'was damaged and could not be read', map: 'was made on an older island', version: 'is from an older version' }[newer[0].code] ?? 'could not be loaded';
    messagePanel(ui, { title: 'A save could not be used', text: `${what} ${why}. Continued from ${r.info.kind === 'auto' ? 'the backup autosave' : `slot ${r.info.slot + 1}`}: ${slotLine(r.info.env)}.` });
  };

  /** start the loaded Sim (a fresh one each time: the cached restore is used only once) */
  const start = (r, why) => {
    forget();
    useSim(r.sim, why);
    enterGame();
    tellSkipped(r);
    return { ok: true };
  };

  Object.assign(api, {
    saving: true,
    get savingNote() {
      if (!store.available) return SAVE_ERRORS.unavailable;
      return store.lastError?.code === 'quota' ? SAVE_ERRORS.quota : null;
    },
    canSave: () => canSave(getSim()),
    slots: () => store.list(),
    newestSave: () => { const r = newest(); return r.ok ? r.info : null; },
    newGameWouldLose() {
      const r = newest();
      if (!r.ok || r.info.kind !== 'auto') return null;
      const kept = store.list().some((s) => s.kind === 'manual' && s.ok && s.env.checksum === r.info.env.checksum);
      return kept ? null : r.info;
    },
    continueGame() {
      const r = newest();
      if (!r.ok) { forget(); return { ok: false, message: r.skipped[0]?.message ?? SAVE_ERRORS.empty }; }
      return start(r, 'continue');
    },
    retry() {
      const r = newest();
      if (r.ok) return start(r, 'retry');
      useSim(freshSim(), 'retry');
      screens.show('opening', { fadeOnly: true });
      return { ok: true };
    },
    loadSlot(id) {
      const r = store.load(id, ctx);
      if (!r.ok) return r;
      forget();
      useSim(r.sim, 'load');
      enterGame();
      return { ok: true };
    },
    saveSlot(i) {
      const sim = getSim();
      const c = canSave(sim);
      if (!c.ok) return { ok: false, message: c.reason };
      const r = store.writeManual(i, sim);
      forget();
      autosave.onSaved?.(r, 'manual');
      if (!r.ok) return { ok: false, message: `${r.message} It is kept until this page closes.` };
      return r;
    },
    deleteSlot(id) { store.remove(id); forget(); },
    resetCaches: () => forget(),
    exportSlot(id) {
      const text = store.exportText(id);
      if (!text) return false;
      const env = JSON.parse(text);
      return downloadText(`sentinel-save-${fileTag(env)}.json`, text);
    },
    async pickImport() {
      const text = await pickTextFile();
      if (text == null) return null;
      return store.checkImport(text, ctx);
    },
    importInto(i, env) { const r = store.importInto(i, env); forget(); return r; },
    quitToTitle({ dryRun = false, force = false } = {}) {
      const sim = getSim();
      if (dryRun) { const c = canSave(sim); return c.ok ? { ok: true } : { ok: false, refused: c.reason }; }
      if (!force && sim && !sim.over) autosave.now(sim, 'quit');
      forget();
      screens.show('title');
      return { ok: true };
    },
    resetAllData() { prevReset?.(); store.clearAll(); forget(); },
    /** the opening has ended: the new run's first autosave, at the crash site */
    startAutosave() { autosave.now(getSim(), 'start'); forget(); },
    /** the page is being hidden or closed */
    hiddenAutosave() {
      const sim = getSim();
      if (!sim || sim.over) return { ok: false };
      const r = autosave.now(sim, 'hidden');
      forget();
      return r;
    },
    /** for the debug readout */
    lastSaveText() {
      const n = store.newestFirst()[0];
      return n ? `${n.id} ${slotLine(n.env)} saved ${agoText(n.env.savedAt, Date.now())}` : 'no save';
    },
  });
  return api;
}
