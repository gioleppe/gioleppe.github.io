// Smooth AudioParam changes: no zipper noise, no clicks, no dependence on the current value.

/**
 * Move `param` towards `value` from time `at`, reaching about 98% after `duration` seconds.
 * setTargetAtTime starts from whatever the automation gives at `at`, so it is safe while another ramp is running.
 * @param {AudioParam} param
 * @param {number} value
 * @param {number} at audio-clock time (clamped by the caller to >= currentTime)
 * @param {number} [duration] seconds; very short values still get 5 ms of smoothing
 */
export function rampParam(param, value, at, duration = 0.05) {
  param.cancelScheduledValues(at);
  param.setTargetAtTime(value, at, Math.max(duration, 0.005) / 4);
}

/** perceptual volume curve for a 0..1 slider (squared: 0.5 on the slider is about -12 dB) */
export const sliderToGain = (v) => {
  const x = Math.min(1, Math.max(0, Number(v) || 0));
  return x * x;
};
