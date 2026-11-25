// Which notes of a track fall in a time window. Pure (no Web Audio), so the scheduling maths is tested in Node.
// Times are computed from the absolute bar position of each event (exact fractions until the last step), so
// the same event always gets the same time, falls in exactly one of the scheduler's contiguous windows, and
// nothing drifts however long the track plays.
import { compile, queryCycle } from './mini.js';
import { resolveAtom, resolveScale } from './theory.js';
import { secondsPerBar } from './time.js';
import { layerPattern, defaultSection } from './schema.js';

export class TrackTimeline {
  /** @param {object} score a valid score (see schema.js) */
  constructor(score) {
    this.score = score;
    this.spb = secondsPerBar(score.bpm, score.beatsPerBar);
    this.scale = score.scale ? resolveScale(score.scale) : null;
    const seed = score.seed ?? 0;
    this.layers = score.layers.map((layer, i) => {
      const compiled = new Map();
      const patternFor = (section) => {
        const src = layerPattern(layer, section);
        if (src === null) return null;
        if (!compiled.has(src)) compiled.set(src, compile(src, { seed: seed * 7919 + i }));
        return compiled.get(src);
      };
      return { layer, index: i, patternFor, cache: new Map() };
    });
    /** section changes, sorted by bar: [{ bar, section }] */
    this.changes = [{ bar: 0, section: defaultSection(score) }];
  }

  /** the section in force at `bar` */
  sectionAt(bar) {
    let s = this.changes[0].section;
    for (const c of this.changes) if (c.bar <= bar) s = c.section;
    return s;
  }

  /** switch section from `bar` on (bars before it keep what they had) */
  setSection(section, bar) {
    this.changes = this.changes.filter((c) => c.bar < bar);
    this.changes.push({ bar, section });
    for (const l of this.layers) for (const b of l.cache.keys()) if (b >= bar) l.cache.delete(b);
  }

  /** events of one layer starting in `bar`, with the atom resolved to { midi } or { name } */
  eventsForBar(layerIndex, bar) {
    const l = this.layers[layerIndex];
    let evs = l.cache.get(bar);
    if (!evs) {
      const pat = l.patternFor(this.sectionAt(bar));
      evs = pat ? queryCycle(pat, bar).map((ev) => ({ ...ev, note: resolveAtom(ev.value, this.scale, l.layer.transpose ?? 0) })) : [];
      l.cache.set(bar, evs);
    }
    return evs;
  }

  /** forget cached bars before `bar` (keeps memory flat over a long session) */
  prune(bar) {
    for (const l of this.layers) for (const b of l.cache.keys()) if (b < bar) l.cache.delete(b);
  }

  /**
   * Every event whose start time lies in [from, to), for a track whose bar 0 starts at `t0` (seconds).
   * @returns {{ layer: number, time: number, duration: number, note: object, start: object, bar: number }[]} sorted by time
   */
  eventsInWindow(t0, from, to) {
    if (!(to > from) || to <= t0) return [];
    const spb = this.spb;
    // one bar of slack on each side: an event is selected by its own time, never by which bar we think it is in
    const b0 = Math.max(0, Math.floor((from - t0) / spb) - 1);
    const b1 = Math.floor((to - t0) / spb) + 1;
    const out = [];
    for (let bar = b0; bar <= b1; bar++) {
      for (const l of this.layers) {
        for (const ev of this.eventsForBar(l.index, bar)) {
          const time = t0 + ev.start.valueOf() * spb;
          if (time >= from && time < to) {
            out.push({ layer: l.index, time, duration: (ev.end.valueOf() - ev.start.valueOf()) * spb, note: ev.note, start: ev.start, bar });
          }
        }
      }
    }
    this.prune(b0 - 1);
    return out.sort((a, b) => a.time - b.time || a.layer - b.layer);
  }
}
