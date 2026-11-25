// Offline rendering of a track through exactly the live code path (Music, voices, buses), in an
// OfflineAudioContext. Used by tools/music/render.mjs (in headless Edge) and by the audits.
import { Music } from './Music.js';
import { createBuses } from '../AudioManager.js';
import { secondsPerBar } from './time.js';

/**
 * Render `bars` bars of a score.
 * @param {object} score
 * @param {{ bars?: number, sampleRate?: number, limiter?: boolean, tail?: number, layers?: string[],
 *   OfflineContext?: Function }} [opts] bars defaults to one loop; `tail` adds seconds of silence-to-come after the
 *   last bar (no new notes); `layers` keeps only these layer ids (solo renders); `limiter: false` bypasses the
 *   master limiter so the raw peak can be measured
 * @returns {Promise<AudioBuffer>} stereo, master and music buses at unity gain
 */
export async function renderTrack(score, { bars = score.bars, sampleRate = 44100, limiter = true, tail = 0, layers, OfflineContext } = {}) {
  const Ctx = OfflineContext ?? globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  if (!Ctx) throw new Error('no OfflineAudioContext in this environment');
  const playSeconds = bars * secondsPerBar(score.bpm, score.beatsPerBar);
  const length = Math.ceil((playSeconds + tail) * sampleRate);
  const ctx = new Ctx({ numberOfChannels: 2, length, sampleRate });
  const buses = createBuses(ctx, { limiter });
  const s = layers ? { ...score, layers: score.layers.filter((l) => layers.includes(l.id)) } : score;
  const music = new Music({ context: ctx, output: buses.music, live: false });
  music.load(s);
  music.play(s.id, { at: 0, quantise: false });
  // no notes start after the last bar; the faders stay open so the tail rings out
  music.tracks[0].stopAt = playSeconds;
  music.tracks[0].disposeAt = null;
  music.renderUntil(playSeconds);
  const buffer = await ctx.startRendering();
  music.dispose();
  return buffer;
}
