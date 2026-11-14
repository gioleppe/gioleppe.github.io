// Where to find an Astral (the Trip Journal's "Where" page): the zones whose wild tables hold it (with levels and when:
// at night, during a set, only when high, on the water), anyone who gives one or sends one at you in a script, and
// its line (what it evolves from and into). Pure: data in, plain records out.

import { tl } from './i18n.js';

/** the zone an NPC with this script stands in, or null */
function zoneOfScript(data, scriptId) {
  for (const z of Object.values(data.zones)) if ((z.npcs || []).some((n) => n.script === scriptId)) return z.zoneId;
  return null;
}

export function whereToFind(data, speciesId) {
  const wild = [];
  for (const z of Object.values(data.zones)) {
    for (const [list, water] of [[z.encounters?.table || [], false], [z.encounters?.water || [], true]]) {
      for (const e of list) {
        if (e.speciesId !== speciesId) continue;
        const prev = wild.find((w) => w.zone === z.zoneId && w.water === water && w.night === !!e.night && w.set === (e.set || null) && w.minIntox === (e.minIntox || 0));
        if (prev) { prev.minLevel = Math.min(prev.minLevel, e.minLevel); prev.maxLevel = Math.max(prev.maxLevel, e.maxLevel); continue; }
        wild.push({ zone: z.zoneId, minLevel: e.minLevel, maxLevel: e.maxLevel, water, night: !!e.night, set: e.set || null, minIntox: e.minIntox || 0 });
      }
    }
  }
  const gifts = [], scripted = [];
  for (const [id, steps] of Object.entries(data.dialogues || {})) for (const st of steps) {
    if (st.giveMon === speciesId) gifts.push({ zone: zoneOfScript(data, id), level: st.level || 5, starter: id === 'banyan' });
    if (st.wild === speciesId) scripted.push({ zone: zoneOfScript(data, id), level: st.level || 5 });
  }
  const from = [], into = [];
  for (const sp of data.dexList) for (const ev of sp.evolutions || []) {
    if (ev.targetId === speciesId) from.push({ speciesId: sp.id, level: ev.level || null, itemId: ev.itemId || null });
    if (sp.id === speciesId) into.push({ speciesId: ev.targetId, level: ev.level || null, itemId: ev.itemId || null });
  }
  return { wild, gifts, scripted, from, into };
}

/** the same, as short lines for the Journal (an evolution you have not seen yet stays ?????) */
export function whereLines(data, s, speciesId) {
  const w = whereToFind(data, speciesId), out = [];
  const place = (zone) => (zone ? data.zones[zone].name.replace(/^The /, '') : tl('somewhere'));
  const band = (m) => [...(data.rules.intox?.bands || [])].reverse().find((b) => m >= b.min)?.name || tl('high');
  const setName = (id) => data.rules.timetable?.sets?.find((x) => x.id === id)?.name || id;
  // one line per place and time: on land and on the water together when both
  const rows = [];
  for (const x of w.wild) {
    const same = rows.find((r) => r.zone === x.zone && r.night === x.night && r.set === x.set && r.minIntox === x.minIntox);
    if (same) { same.minLevel = Math.min(same.minLevel, x.minLevel); same.maxLevel = Math.max(same.maxLevel, x.maxLevel); same.land ||= !x.water; same.water ||= x.water; }
    else rows.push({ ...x, land: !x.water });
  }
  for (const x of rows) {
    const when = [x.water ? (x.land ? tl('land and water') : tl('on the water')) : null, x.night ? tl('at night') : null, x.set ? tl('during the {0}', setName(x.set)) : null, x.minIntox > 0 ? tl('from {0}', band(x.minIntox)) : null].filter(Boolean);
    out.push(tl('{0}: Lv {1}', place(x.zone), x.maxLevel !== x.minLevel ? `${x.minLevel}-${x.maxLevel}` : x.minLevel) + (when.length ? `, ${when.join(', ')}` : ''));
  }
  for (const x of w.scripted) out.push(tl('{0}: one of a kind, Lv {1}', place(x.zone), x.level));
  for (const x of w.gifts) out.push(x.starter ? tl('Banyan\'s first gift: a starter') : tl('A gift at {0}', place(x.zone)));
  const how = (x) => (x.level ? tl('at Lv {0}', x.level) : tl('with a {0}', data.items[x.itemId]?.name || x.itemId));
  const name = (id) => (s.dex?.seen?.[id] ? data.dex[id]?.name || id : '?????');
  for (const x of w.from) out.push(tl('Grows from {0} {1}', name(x.speciesId), how(x)));
  for (const x of w.into) out.push(tl('Grows into {0} {1}', name(x.speciesId), how(x)));
  if (!w.wild.length && !w.scripted.length && !w.gifts.length && !w.from.length) out.unshift(tl('Not seen in the wild.'));
  return out;
}
