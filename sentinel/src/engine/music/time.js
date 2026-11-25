// Bars, beats and seconds. One pattern cycle is one bar. Pure.

/** seconds per beat at `bpm` */
export const secondsPerBeat = (bpm) => 60 / bpm;

/** seconds per bar (one cycle) */
export const secondsPerBar = (bpm, beatsPerBar) => (60 * beatsPerBar) / bpm;

/** Strudel's cycles per minute for this tempo (`setcpm(bpm / beatsPerBar)`) */
export const cyclesPerMinute = (bpm, beatsPerBar) => bpm / beatsPerBar;

/**
 * Seconds from the track start to a position given in bars (and optionally beats within the bar).
 * Computed from the absolute position every time, so there is nothing to accumulate and nothing drifts.
 */
export function barToSeconds(bar, beat, bpm, beatsPerBar) {
  return (Number(bar) * beatsPerBar + Number(beat || 0)) * secondsPerBeat(bpm);
}

/** { bar, beat } (bar an integer, beat fractional within it) of a time in seconds since the track start */
export function secondsToBarBeat(seconds, bpm, beatsPerBar) {
  const beats = seconds / secondsPerBeat(bpm);
  const bar = Math.floor(beats / beatsPerBar + 1e-9);
  return { bar, beat: Math.max(0, beats - bar * beatsPerBar) };
}

/**
 * Time of the first bar line at or after `time` for a track started at `t0`.
 * A bar line within `epsilon` seconds of `time` counts as "now" (so quantising at a bar line does not wait a bar).
 */
export function nextBarTime(time, t0, bpm, beatsPerBar, epsilon = 1e-6) {
  const spb = secondsPerBar(bpm, beatsPerBar);
  if (time <= t0) return t0;
  const bars = Math.ceil((time - t0 - epsilon) / spb);
  return t0 + bars * spb;
}
