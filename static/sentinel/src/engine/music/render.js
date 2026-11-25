// Offline rendering of tracks through exactly the live code path (Music, voices, buses), in an
// OfflineAudioContext. Used by tools/music/render.mjs (in headless Edge) and by the audits.
import { Music } from './Music.js';
import { createBuses } from '../AudioManager.js';
import { secondsPerBar } from './time.js';

const offlineContext = (OfflineContext, seconds, sampleRate) => {
  const Ctx = OfflineContext ?? globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  if (!Ctx) throw new Error('no OfflineAudioContext in this environment');
  return new Ctx({ numberOfChannels: 2, length: Math.ceil(seconds * sampleRate), sampleRate });
};

/**
 * Render `bars` bars of a score.
 * @param {object} score
 * @param {{ bars?: number, sampleRate?: number, limiter?: boolean, tail?: number, layers?: string[], gain?: number,
 *   OfflineContext?: Function }} [opts] bars defaults to one loop; `tail` adds seconds after the last bar in which
 *   no new notes start (for one-shot cues to ring out); `layers` keeps only these layer ids (solo renders);
 *   `limiter: false` bypasses the master limiter so the raw peak can be measured; `gain` is the track level
 * @returns {Promise<AudioBuffer>} stereo, master and music buses at unity gain
 */
export function renderTrack(score, { bars = score.bars, sampleRate = 44100, limiter = true, tail = 0, layers, gain = 1, OfflineContext } = {}) {
  return renderMix([{ score, gain, layers }], { seconds: bars * secondsPerBar(score.bpm, score.beatsPerBar), tail, sampleRate, limiter, OfflineContext });
}

/**
 * Render several tracks at once, all starting at 0 and playing together (a region track with the tension over it,
 * or both halves of a crossfade).
 * @param {{ score: object, gain?: number, layers?: string[], sections?: { bar: number, section: string }[] }[]} parts
 * @param {{ seconds: number, tail?: number, sampleRate?: number, limiter?: boolean, OfflineContext?: Function }} opts
 * @returns {Promise<AudioBuffer>}
 */
export async function renderMix(parts, { seconds, tail = 0, sampleRate = 44100, limiter = true, OfflineContext }) {
  const ctx = offlineContext(OfflineContext, seconds + tail, sampleRate);
  const buses = createBuses(ctx, { limiter });
  const music = new Music({ context: ctx, output: buses.music, live: false });
  for (const { score, gain = 1, layers, sections } of parts) {
    const s = layers ? { ...score, layers: score.layers.filter((l) => layers.includes(l.id)) } : score;
    music.load(s);
    music.play(s.id, { at: 0, quantise: false, exclusive: false, gain });
    // a scripted walk through the sections: [{ bar, section }], as the director would step through them
    const track = music.tracks[music.tracks.length - 1];
    for (const { bar, section } of sections ?? []) track.timeline.setSection(section, bar);
  }
  // no note starts after `seconds`; the faders stay open so the tails ring out
  for (const t of music.tracks) {
    t.stopAt = t.stopAt === null ? seconds : Math.min(t.stopAt, seconds);
    t.disposeAt = null;
  }
  music.renderUntil(seconds + tail);
  const buffer = await ctx.startRendering();
  music.dispose();
  return buffer;
}
