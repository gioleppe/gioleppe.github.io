// The panels the screens open: settings, the save slots (save, load, export, import), confirmations and messages.
// Each factory takes the screens' context `ui` = { screens, actions, prefs, audio } (see main.js and Screens.js)
// and returns a Panel already opened on the stack.
//
// `actions` is the page's side (main.js): newGame, loadSlot(id), saveSlot(i), deleteSlot(id), slots(),
// exportSlot(id), pickImport() (a Promise), importInto(i, env), resetAllData(), saving (bool: saves exist in
// this build), savingNote (why saving is unavailable, or null).
import { Panel } from './Panel.js';
import { SCREEN_COLORS as C } from './theme.js';
import { RESONANCE_STEPS, OPACITY_RANGE, stepList, stepValue } from './gameSettings.js';
import { slotLine, agoText, playTimeText } from './saveText.js';

const pct = (v) => `${Math.round(v * 100)}%`;

/** a confirmation: `yes` runs onYes (and closes), `no` / Esc closes */
export function confirmPanel(ui, { title, text, yes = 'Yes', no = 'Cancel', onYes, danger = false }) {
  const { screens } = ui;
  let panel = null;
  panel = new Panel({
    id: 'confirm', title, text,
    items: [
      { id: 'no', label: no, onSelect: () => screens.closePanel(panel) },
      { id: 'yes', label: yes, tone: danger ? 'danger' : undefined, onSelect: () => { screens.closePanel(panel); onYes?.(); } },
    ],
    onBack: () => screens.closePanel(panel),
  });
  return screens.openPanel(panel);
}

/** a message with OK (and optional extra buttons {id,label,onSelect}) */
export function messagePanel(ui, { title, text, ok = 'OK', extra = [], onOk = null }) {
  const { screens } = ui;
  let panel = null;
  const close = () => { screens.closePanel(panel); onOk?.(); };
  panel = new Panel({
    id: 'message', title, text,
    items: [...extra.map((e) => ({ ...e, onSelect: () => { screens.closePanel(panel); e.onSelect?.(); } })), { id: 'ok', label: ok, onSelect: close }],
    onBack: close,
  });
  return screens.openPanel(panel);
}

/** the Settings panel (shared by the title and the pause menu); every change applies and is remembered at once */
export function settingsPanel(ui) {
  const { screens, prefs, audio, actions } = ui;
  let panel = null;
  const vol = (bus, label) => ({
    id: `vol-${bus}`, label, kind: 'slider', disabled: !audio?.available,
    value: () => { const v = audio?.getVolume(bus); return v == null ? '—' : pct(v); },
    onAdjust: (d) => { const v = audio?.getVolume(bus); if (v != null) audio.setVolume(bus, Math.round((v + d * 0.1) * 10) / 10); },
  });
  const toggle = (id, label, key) => ({
    id, label, kind: 'toggle', value: () => (prefs.get(key) !== false ? 'On' : 'Off'),
    onAdjust: () => prefs.set(key, prefs.get(key) === false),
  });
  const items = () => [
    vol('master', 'Volume'), vol('music', 'Music'), vol('sfx', 'Effects'),
    {
      id: 'resonance', label: 'Resonance effects', kind: 'slider',
      value: () => { const v = Number(prefs.get('resonanceFx')); return v <= 0 ? 'Off' : pct(v); },
      onAdjust: (d) => prefs.set('resonanceFx', stepList(RESONANCE_STEPS, Number(prefs.get('resonanceFx')), d)),
    },
    toggle('shake', 'Screen shake', 'screenShake'),
    toggle('hints', 'Hints', 'hints'),
    {
      id: 'touch', label: 'Touch controls', kind: 'slider', value: () => pct(Number(prefs.get('touchOpacity'))),
      onAdjust: (d) => prefs.set('touchOpacity', stepValue(Number(prefs.get('touchOpacity')), d, OPACITY_RANGE)),
    },
    ...(actions.saving ? [
      { id: 'export', label: 'Export a save…', onSelect: () => slotsPanel(ui, 'export') },
      { id: 'import-save', label: 'Import a save…', onSelect: () => importFlow(ui) },
    ] : []),
    {
      id: 'reset', label: 'Reset all data…', tone: 'danger',
      onSelect: () => confirmPanel(ui, {
        title: 'Reset all data', danger: true, yes: 'Erase everything', no: 'Keep it',
        text: 'Every save, every setting and the hints seen will be erased from this browser. This cannot be undone.',
        onYes: () => { actions.resetAllData(); messagePanel(ui, { title: 'Reset', text: 'All data erased.' }); panel?.refresh(); },
      }),
    },
    { id: 'back', label: 'Back', onSelect: () => screens.closePanel(panel) },
  ];
  panel = new Panel({ id: 'settings', title: 'Settings', items, onBack: () => screens.closePanel(panel), width: ui.screens.cfg.settingsWidth });
  if (!audio?.available) panel.note = { text: 'Sound is not available yet.', color: C.dim };
  return screens.openPanel(panel);
}

/** a slot's label, value and detail for a slots list */
export function slotItem(info, now) {
  const label = info.kind === 'auto' ? (info.slot === 0 || info.slot === 1 ? 'Autosave' : 'Autosave') : `Slot ${info.slot + 1}`;
  if (info.empty) return { label, detail: 'Empty', value: null };
  if (!info.ok) return { label, detail: info.error === 'map' ? 'Made on an older island' : 'Damaged: cannot be read', value: null };
  const e = info.env;
  return { label, detail: `${slotLine(e)} · ${agoText(e.savedAt, now)}`, value: playTimeText(e.playSeconds) };
}

/**
 * The save slots.
 * @param {Object} ui
 * @param {'save'|'load'|'export'|'incoming'} mode
 * @param {{ env?: Object }} [opts] incoming: the checked envelope to write
 */
export function slotsPanel(ui, mode, { env = null } = {}) {
  const { screens, actions } = ui;
  let panel = null;
  const titles = { save: 'Save', load: 'Load', export: 'Export a save', incoming: 'Import into which slot?' };
  const done = (text) => { panel.note = { text, color: C.teal }; panel.refresh(); };
  const failed = (text) => { panel.note = { text, color: C.amber }; panel.refresh(); };
  const items = () => {
    const now = actions.now();
    const all = actions.slots();
    // newest autosave first, labelled; the older one is the backup
    const autos = all.filter((s) => s.kind === 'auto' && s.ok).sort((a, b) => b.env.seq - a.env.seq);
    const shown = mode === 'load' || mode === 'export'
      ? [...autos.map((s, i) => ({ ...s, label: i === 0 ? 'Autosave' : 'Autosave (backup)' })), ...all.filter((s) => s.kind === 'manual')]
      : all.filter((s) => s.kind === 'manual');
    const rows = shown.filter((s) => mode !== 'export' || s.ok).map((s) => {
      const v = slotItem(s, now);
      return {
        id: s.id, label: s.label ?? v.label, detail: v.detail, value: v.value ? () => v.value : undefined,
        disabled: (mode === 'load' || mode === 'export') && !s.ok && s.empty,
        onSelect: () => choose(s),
      };
    });
    if (!rows.length) rows.push({ id: 'none', label: 'No saves yet', kind: 'text' });
    rows.push({ id: 'back', label: 'Back', onSelect: () => screens.closePanel(panel) });
    return rows;
  };
  const choose = (s) => {
    if (mode === 'export') { if (actions.exportSlot(s.id)) done('Saved to your downloads.'); else failed('Could not export this save.'); return; }
    if (mode === 'incoming') {
      const write = () => { const r = actions.importInto(s.slot, env); if (r.ok) { screens.closePanel(panel); messagePanel(ui, { title: 'Imported', text: `The save is in slot ${s.slot + 1}.` }); } else failed(r.message); };
      if (s.empty) write();
      else confirmPanel(ui, { title: `Replace slot ${s.slot + 1}?`, text: `${slotItem(s, actions.now()).detail}\nwill be replaced by the imported save.`, yes: 'Replace', danger: true, onYes: write });
      return;
    }
    if (mode === 'save') {
      const write = () => { const r = actions.saveSlot(s.slot); if (r.ok) done(`Saved in slot ${s.slot + 1}.`); else failed(r.message); };
      if (s.empty || !s.ok) { write(); return; }
      slotActions(ui, s, [
        { id: 'over', label: 'Save over it', onSelect: () => confirmPanel(ui, { title: `Overwrite slot ${s.slot + 1}?`, text: `${slotItem(s, actions.now()).detail}\nwill be replaced by this moment.`, yes: 'Overwrite', danger: true, onYes: write }) },
        deleteItem(s),
      ]);
      return;
    }
    // load
    if (s.empty) return;
    const load = () => {
      const r = actions.loadSlot(s.id);
      if (!r.ok) loadFailed(ui, r);
    };
    slotActions(ui, s, [
      ...(s.ok ? [{ id: 'load', label: 'Load', onSelect: load }] : []),
      ...(s.kind === 'manual' || !s.ok ? [deleteItem(s)] : []),
    ]);
  };
  const deleteItem = (s) => ({
    id: 'delete', label: 'Delete', tone: 'danger',
    onSelect: () => confirmPanel(ui, {
      title: `Delete ${s.kind === 'auto' ? 'this autosave' : `slot ${s.slot + 1}`}?`, text: s.ok ? slotItem(s, actions.now()).detail : 'A damaged save.',
      yes: 'Delete', danger: true, onYes: () => { actions.deleteSlot(s.id); done('Deleted.'); },
    }),
  });
  panel = new Panel({ id: `slots-${mode}`, title: titles[mode], items, onBack: () => screens.closePanel(panel), width: screens.cfg.slotsWidth });
  if (mode === 'save' && actions.savingNote) panel.note = { text: actions.savingNote, color: C.amber };
  return screens.openPanel(panel);
}

/** a small panel of what to do with one slot */
function slotActions(ui, s, items) {
  const { screens, actions } = ui;
  let panel = null;
  const v = slotItem(s, actions.now());
  panel = new Panel({
    id: 'slot-actions', title: s.label ?? v.label, text: v.detail,
    items: [...items.map((it) => ({ ...it, onSelect: () => { screens.closePanel(panel); it.onSelect(); } })), { id: 'back', label: 'Back', onSelect: () => screens.closePanel(panel) }],
    onBack: () => screens.closePanel(panel),
  });
  return screens.openPanel(panel);
}

/** a load that failed: say why, and after an island change offer a new game */
export function loadFailed(ui, r) {
  const extra = r.code === 'map' || r.code === 'version' ? [{ id: 'new', label: 'New game', onSelect: () => ui.actions.newGame() }] : [];
  return messagePanel(ui, { title: 'Cannot load', text: r.message ?? 'This save could not be loaded.', extra });
}

/** Settings → Import: pick a file, check it, then choose the slot */
function importFlow(ui) {
  ui.actions.pickImport().then((r) => {
    if (!r) return;   // cancelled
    if (!r.ok) { messagePanel(ui, { title: 'Cannot use this file', text: r.message }); return; }
    slotsPanel(ui, 'incoming', { env: r.env });
  }).catch((e) => messagePanel(ui, { title: 'Cannot use this file', text: e?.message ?? 'The file could not be read.' }));
}
