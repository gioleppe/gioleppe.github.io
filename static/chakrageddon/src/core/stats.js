// The numbers on the end card (IMPROVEMENTS.md point 6): your festival, in a few lines. Pure.
import { bandOf } from './intox.js';
import { questLog } from './quests.js';

export function festivalStats(data, s) {
  const trainers = Object.values(data.trainers);
  const bosses = trainers.filter((t) => t.wristband), four = trainers.filter((t) => /^elite_/.test(t.id) && !/_rematch$/.test(t.id));
  const rematches = trainers.filter((t) => /_rematch$/.test(t.id));
  const minutes = s.elapsed || 0;
  return {
    name: s.playerName || 'You',
    days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60), minutes,
    km: (s.steps || 0) / 1000,                                       // a tile is about a metre
    peak: bandOf(data.rules, s.peakIntox || s.intox || 0).name,
    caught: Object.keys(s.dex?.caught || {}).length, species: data.dexList.length,
    bosses: bosses.filter((t) => s.defeated[t.id]).length, bossTotal: bosses.length,
    four: four.filter((t) => s.defeated[t.id]).length,
    rematches: rematches.filter((t) => s.defeated[t.id]).length, rematchTotal: rematches.length,
    quests: questLog(data, s).filter((q) => q.state === 'done').length, questTotal: (data.manifest.quests || []).length,
  };
}
/** the festival time as words: "3 days, 4 hours" */
export function festivalTime(st) {
  const d = st.days ? `${st.days} day${st.days === 1 ? '' : 's'}` : '', h = `${st.hours} hour${st.hours === 1 ? '' : 's'}`;
  return d ? `${d}, ${h}` : h;
}
