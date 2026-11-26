// How a save or a moment is described to the player: 'Day 2 · 14:10 · Crash Site', 'saved 4 minutes ago', '12 min'.

/** "4 minutes ago" for a savedAt (ms) against now (ms) */
export function agoText(savedAt, now) {
  const s = Math.max(0, Math.round((now - savedAt) / 1000));
  if (!Number.isFinite(s)) return '';
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? 'a minute ago' : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 36) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** hour of day as 'HH:MM' */
export function hourText(timeOfDay) {
  const mins = Math.floor(((((Number(timeOfDay) || 0) % 24) + 24) % 24) * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** play time as '12 min' or '1:05 h' */
export function playTimeText(seconds) {
  const m = Math.floor((Number(seconds) || 0) / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`;
}

/** one line describing a save (an envelope or a saveSummary): 'Day 2 · 14:10 · Southern Cove' */
export function slotLine(env) {
  if (!env) return '';
  return `Day ${env.day} · ${hourText(env.timeOfDay)} · ${env.landmarkNearby ?? env.region}`;
}
