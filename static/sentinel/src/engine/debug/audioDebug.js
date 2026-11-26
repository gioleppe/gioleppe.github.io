// Debug tools for the game's audio (steps Mu3 and 5.5; `?debug` only): a mixer readout (context, the director's
// record and mix, playing tracks and layers, voices, bed levels, cost per frame) and actions to force each director
// state (merged over the real one through gameAudio.forced, never written to the simulation) and to fire every sound.
// main.js calls registerAudioDebug(debug, gameAudio) once debug mode is up.
import { COLORS } from './layers.js';
import { SOUNDS } from '../sfx/sounds.js';

const TEAL = '#7fd1c7';
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');

/** the readout lines */
export function audioLines(ga) {
  const i = ga.info();
  const r = i.record;
  const lines = [`audio ${i.state}  screen ${i.screen}  scores ${i.loaded ? 'in' : '...'}${ga.forced ? `  FORCED ${JSON.stringify(ga.forced)}` : ''}`];
  if (r) lines.push(`  ${r.region}${r.inSafeZone ? ' (safe)' : ''}  day ${f2(r.daylight)}  rain ${f2(r.weather)}  wind ${f2(r.wind)}  tide ${r.tide}  res ${r.resonance.tier} ${Math.round(r.resonance.value)}  threat ${i.threat}${i.holdout !== null ? `  holdout ${i.holdout.toFixed(1)}s` : ''}`);
  if (i.mix) {
    lines.push(`  mix ${Object.entries(i.mix.tracks).map(([id, t]) => `${id}@${t.gain}${t.section ? `/${t.section}` : ''}`).join(' ') || '(silence)'}  duck ${i.mix.duck}  tone ${i.mix.tone}  detune ${i.mix.params.detune} bright ${i.mix.params.brightness} rev ${i.mix.params.reverb}`);
    for (const [id, t] of Object.entries(i.mix.tracks)) {
      const off = Object.entries(t.layers).filter(([, g]) => g < 1).map(([l, g]) => `${l}=${g}`);
      if (off.length) lines.push(`    ${id}: ${off.join(' ')}`);
    }
  }
  if (i.music) lines.push(`  engine ${i.music.tracks.join(' ') || '-'}  voices ${i.music.voices}  nodes ${i.music.liveNodes}  dropped ${i.music.dropped}  gap ${f2(i.music.maxTimerGap)}s`);
  if (i.sfx) {
    const b = i.sfx.beds;
    lines.push(`  sfx voices ${i.sfx.voices}/${i.sfx.peak} peak  nodes ${i.sfx.voiceNodes}+${i.sfx.bedNodes}  played ${i.sfx.played}  duck ${f2(i.sfx.duck)}`);
    lines.push(`  beds surf ${b.surf ?? 0} wind ${b.wind ?? 0} rain ${b.rain ?? 0} day ${b.jungleDay ?? 0} night ${b.jungleNight ?? 0} mangrove ${b.mangrove ?? 0} hum ${b.hum ?? 0}`);
  }
  lines.push(`  cost ${f2(i.perf.frameMs)} ms/frame + ${f2(i.perf.stepMs)} ms/step (worst ${f2(i.perf.worstFrameMs)})`);
  return lines;
}

/**
 * @param {import('./DebugMode.js').DebugMode} debug
 * @param {import('../GameAudio.js').GameAudio} ga
 */
export function registerAudioDebug(debug, ga) {
  debug.addLayer({
    id: 'audio', label: 'Audio mixer readout', group: 'readouts', default: false,
    drawUi(ctx, sim, vp, env) {
      env.textBlock(ctx, audioLines(ga).map((text, i) => ({ text, color: i ? COLORS.text : TEAL })));
    },
  });
  const force = (o) => { ga.forced = { ...(ga.forced ?? {}), ...o }; };
  const act = (id, label, run, group = 'audio') => debug.addAction({ id, label, group, run });
  act('audio-unlock', 'Audio: start (unlock)', () => ga.unlock());
  act('audio-clear', 'Audio: clear forced state', () => { ga.forced = null; ga.setScreen('game'); ga.holdout.stop(); });
  for (const [id, region, extra] of [
    ['cove', 'southern_cove', {}], ['mangroves', 'western_mangroves', { inSafeZone: false }], ['marek', 'western_mangroves', { inSafeZone: true }],
    ['jungle', 'interior_jungle', {}], ['meridian', 'quiet_meridian', {}], ['reef', 'reef', {}], ['peak', 'signal_peak', {}], ['sea', 'open_sea', {}],
  ]) act(`audio-region-${id}`, `Audio: region ${id}`, () => force({ region, inSafeZone: false, anomaly: 0, ...extra }));
  act('audio-night', 'Audio: night', () => force({ daylight: 0, dayPhase: 'night' }));
  act('audio-day', 'Audio: day', () => force({ daylight: 1, dayPhase: 'day' }));
  act('audio-squall', 'Audio: full squall', () => force({ weather: 1, wind: 0.85 }));
  for (const [tier, value] of [['quiet', 5], ['humming', 50], ['agitated', 95]]) act(`audio-res-${tier}`, `Audio: Resonance ${tier}`, () => force({ resonance: { tier, value } }));
  for (const t of ['none', 'investigate', 'warn', 'chase', 'search']) act(`audio-threat-${t}`, `Audio: threat ${t}`, () => force({ threat: t }));
  act('audio-dialogue', 'Audio: dialogue on/off', () => force({ dialogue: !ga.forced?.dialogue }));
  for (const s of ['title', 'game', 'gameover', 'ending_dinghy', 'ending_rescue']) act(`audio-screen-${s}`, `Audio: screen ${s}`, () => ga.setScreen(s));
  act('audio-holdout', 'Audio: holdout start', () => ga.holdout.start());
  act('audio-holdout-stop', 'Audio: holdout stop', () => ga.holdout.stop());
  for (const name of Object.keys(SOUNDS)) act(`sfx-${name}`, `SFX: ${name}`, () => ga.playSfx(name), 'sfx');
}
