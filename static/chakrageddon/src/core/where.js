// Where to find an Astral (the Trip Journal's "Where" page): the zones whose wild tables hold it (with levels and when:
// at night, during a set, only when high, on the water), anyone who gives one or sends one at you in a script, and
// its line (what it evolves from and into). Pure: data in, plain records out.

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
  const place = (zone) => (zone ? data.zones[zone].name.replace(/^The /, '') : 'somewhere');
  const band = (m) => [...(data.rules.intox?.bands || [])].reverse().find((b) => m >= b.min)?.name || 'high';
  const setName = (id) => data.rules.timetable?.sets?.find((x) => x.id === id)?.name || id;
  // one line per place and time: on land and on the water together when both
  const rows = [];
  for (const x of w.wild) {
    const same = rows.find((r) => r.zone === x.zone && r.night === x.night && r.set === x.set && r.minIntox === x.minIntox);
    if (same) { same.minLevel = Math.min(same.minLevel, x.minLevel); same.maxLevel = Math.max(same.maxLevel, x.maxLevel); same.land ||= !x.water; same.water ||= x.water; }
    else rows.push({ ...x, land: !x.water });
  }
  for (const x of rows) {
    const when = [x.water ? (x.land ? 'land and water' : 'on the water') : null, x.night ? 'at night' : null, x.set ? `during the ${setName(x.set)}` : null, x.minIntox > 0 ? `from ${band(x.minIntox)}` : null].filter(Boolean);
    out.push(`${place(x.zone)}: Lv ${x.minLevel}${x.maxLevel !== x.minLevel ? `-${x.maxLevel}` : ''}${when.length ? `, ${when.join(', ')}` : ''}`);
  }
  for (const x of w.scripted) out.push(`${place(x.zone)}: one of a kind, Lv ${x.level}`);
  for (const x of w.gifts) out.push(x.starter ? 'Banyan\'s first gift: a starter' : `A gift at ${place(x.zone)}`);
  const how = (x) => (x.level ? `at Lv ${x.level}` : `with a ${data.items[x.itemId]?.name || x.itemId}`);
  const name = (id) => (s.dex?.seen?.[id] ? data.dex[id]?.name || id : '?????');
  for (const x of w.from) out.push(`Grows from ${name(x.speciesId)} ${how(x)}`);
  for (const x of w.into) out.push(`Grows into ${name(x.speciesId)} ${how(x)}`);
  if (!w.wild.length && !w.scripted.length && !w.gifts.length && !w.from.length) out.unshift('Not seen in the wild.');
  return out;
}
