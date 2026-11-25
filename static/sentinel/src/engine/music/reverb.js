// A generated impulse response for the shared ConvolverNode: decorrelated stereo noise with an exponential decay
// that also darkens over time (a one-pole low-pass whose cutoff falls), like a large damp space. Seeded.
import { mulberry32 } from './voices.js';

/**
 * @param {BaseAudioContext} ctx
 * @param {{ seconds?: number, preDelay?: number, damping?: number, seed?: number }} [opts]
 *   seconds: time to -60 dB; damping 0..1: how much the tail darkens
 * @returns {AudioBuffer}
 */
export function impulseResponse(ctx, { seconds = 4.5, preDelay = 0.02, damping = 0.7, seed = 0x7e5 } = {}) {
  const sr = ctx.sampleRate;
  const len = Math.round(sr * (seconds + preDelay));
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.round(sr * preDelay);
  const k = Math.log(1000) / (seconds * sr);   // amplitude reaches 1/1000 (-60 dB) after `seconds`
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const rnd = mulberry32(seed + ch * 101);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const age = (i - pre) / (len - pre);
      const coeff = 1 - damping * 0.97 * age;   // 1 = no filtering, near 0 = very dark
      lp += coeff * ((rnd() * 2 - 1) - lp);
      // fade in over 5 ms so the onset is soft, then decay
      const fadeIn = Math.min(1, (i - pre) / (sr * 0.005));
      d[i] = lp * Math.exp(-k * (i - pre)) * fadeIn;
    }
  }
  // normalise so the reverb's loudness does not depend on its length
  let energy = 0;
  for (let ch = 0; ch < 2; ch++) for (const v of buf.getChannelData(ch)) energy += v * v;
  const norm = 1 / Math.sqrt(energy / 2 || 1) * 0.6;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= norm;
  }
  return buf;
}
