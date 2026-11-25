// The jukebox page (jukebox.html): every track of data/music/ with play/stop, sections, per-layer mute, solo and
// gain, master and music volume, the global music params, and a level meter. Audio starts on the first touch.
import { AudioManager } from './engine/AudioManager.js';
import { Settings } from './engine/Settings.js';
import { Music } from './engine/music/Music.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.includes('-')) e.setAttribute(k, v); else e[k] = v;
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
};

const settings = new Settings();
const audio = new AudioManager({ settings });
audio.attachUnlock(window);

/** @type {Music|null} created once the context exists */
let music = null;
let analyser = null;
const scores = new Map();
/** per track: { [layerId]: { gain, mute, solo } } kept by the page so a restarted track gets the same mix */
const mix = new Map();
let loadError = null;
const ui = new Map();

const STATE_TEXT = {
  none: 'Audio is off: tap anywhere to start it',
  suspended: 'Audio is paused: tap to resume',
  interrupted: 'Audio was interrupted: tap to resume',
  running: 'Audio on',
  closed: 'Audio closed',
};

function ensureMusic() {
  if (music || audio.state !== 'running') return music;
  music = new Music({ context: audio.context, output: audio.buses.music });
  music.load([...scores.values()]);
  for (const [name, value] of Object.entries(globals)) if (value !== 0 && name !== 'reverb') music.setParam(name, value);
  music.setParam('reverb', globals.reverb);
  analyser = audio.context.createAnalyser();
  analyser.fftSize = 2048;
  audio.buses.output.connect(analyser);
  return music;
}

// ---- mix controls ------------------------------------------------------------------------------------

const globals = { brightness: 0, detune: 0, reverb: 1 };

function slider({ label, min, max, step, value, format = (v) => v, onInput }) {
  const id = `s-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const input = el('input', { type: 'range', id, min, max, step, value });
  const out = el('output', { htmlFor: id, value: format(Number(value)) });
  input.addEventListener('input', () => { out.value = format(Number(input.value)); onInput(Number(input.value)); });
  return el('div', { className: 'slider' }, el('label', { htmlFor: id, textContent: label }), input, out);
}

function buildMix() {
  const box = $('mix');
  const pct = (v) => `${Math.round(v * 100)}%`;
  box.append(
    slider({ label: 'Master', min: 0, max: 1, step: 0.01, value: audio.getVolume('master'), format: pct, onInput: (v) => audio.setVolume('master', v) }),
    slider({ label: 'Music', min: 0, max: 1, step: 0.01, value: audio.getVolume('music'), format: pct, onInput: (v) => audio.setVolume('music', v) }),
    slider({ label: 'Brightness', min: -2400, max: 1200, step: 50, value: 0, format: (v) => `${v}c`, onInput: (v) => { globals.brightness = v; music?.setParam('brightness', v, { ramp: 0.3 }); } }),
    slider({ label: 'Detune', min: -100, max: 100, step: 1, value: 0, format: (v) => `${v}c`, onInput: (v) => { globals.detune = v; music?.setParam('detune', v, { ramp: 0.5 }); } }),
    slider({ label: 'Reverb', min: 0, max: 2, step: 0.05, value: 1, format: pct, onInput: (v) => { globals.reverb = v; music?.setParam('reverb', v, { ramp: 0.3 }); } }),
  );
  const mute = el('input', { type: 'checkbox', id: 'mute', checked: audio.muted });
  mute.addEventListener('change', () => audio.setMuted(mute.checked));
  box.append(el('label', { className: 'check', htmlFor: 'mute' }, mute, 'Mute everything'));
}

// ---- tracks ------------------------------------------------------------------------------------------

function effectiveGain(trackId, layerId) {
  const m = mix.get(trackId);
  const l = m[layerId];
  const anySolo = Object.values(m).some((x) => x.solo);
  if (anySolo) return l.solo ? l.gain : 0;
  return l.mute ? 0 : l.gain;
}

function applyLayers(trackId, fade = 0.15) {
  if (!music || !isPlaying(trackId)) return;
  for (const l of scores.get(trackId).layers) music.setLayerGain(trackId, l.id, effectiveGain(trackId, l.id), { fade });
}

const isPlaying = (id) => Boolean(music?.current.some((t) => t.id === id));

/**
 * Play a track. Alone (whatever plays crossfades out), or `over` what plays (the tension over a region track).
 * One-shot cues start at once instead of waiting for the next bar.
 */
async function play(id, { over = false } = {}) {
  await audio.unlock();
  if (!ensureMusic()) { render(); return; }
  const oneShot = scores.get(id).loop === false;
  music.play(id, { fade: over ? 2 : 1.5, exclusive: !over, quantise: !oneShot });
  applyLayers(id, 0.01);
  render();
}

/** stop one track, or everything */
function stop(id) {
  if (id) music?.stopTrack(id, { fade: 2 });
  else music?.stop({ fade: 2 });
  render();
}

/** "play B over A": audition the tension (or anything) over a region track */
function buildCombo() {
  const loops = [...scores.values()].filter((s) => s.loop !== false);
  const pick = (label, list, value) => {
    const sel = el('select', { 'aria-label': label });
    for (const s of list) sel.append(el('option', { value: s.id, textContent: s.title ?? s.id }));
    if (value && scores.has(value)) sel.value = value;
    return sel;
  };
  const base = pick('Track A (base)', loops, 'coast_day');
  const over = pick('Track B (over A)', loops, 'tension');
  const go = el('button', { className: 'btn primary', type: 'button', textContent: 'Play B over A' });
  go.addEventListener('click', async () => {
    if (base.value === over.value) return;
    await play(base.value);
    await play(over.value, { over: true });
  });
  const halt = el('button', { className: 'btn', type: 'button', textContent: 'Stop all' });
  halt.addEventListener('click', () => stop());
  $('combo').replaceChildren(el('label', { className: 'combo-label' }, 'A ', base), el('label', { className: 'combo-label' }, 'B ', over), go, halt);
}

function layerRow(s, l, st) {
  const muteBtn = el('button', { className: 'btn small', type: 'button', textContent: 'M', title: `Mute ${l.id}` });
  const soloBtn = el('button', { className: 'btn small solo', type: 'button', textContent: 'S', title: `Solo ${l.id}` });
  muteBtn.setAttribute('aria-pressed', 'false');
  soloBtn.setAttribute('aria-pressed', 'false');
  muteBtn.addEventListener('click', () => { st.mute = !st.mute; muteBtn.setAttribute('aria-pressed', String(st.mute)); applyLayers(s.id); });
  soloBtn.addEventListener('click', () => { st.solo = !st.solo; soloBtn.setAttribute('aria-pressed', String(st.solo)); applyLayers(s.id); });
  const range = el('input', { type: 'range', min: 0, max: 1.5, step: 0.05, value: 1, 'aria-label': `${l.id} gain` });
  const out = el('output', { value: '100%' });
  range.addEventListener('input', () => { st.gain = Number(range.value); out.value = `${Math.round(st.gain * 100)}%`; applyLayers(s.id, 0.1); });
  return el('div', { className: 'layer', title: l.comment ?? '' },
    el('span', { className: 'name' }, `${l.id} `, el('span', { className: 'voice', textContent: l.voice })), muteBtn, soloBtn, range, out);
}

function trackCard(s) {
  const m = {};
  for (const l of s.layers) m[l.id] = { gain: 1, mute: false, solo: false };
  mix.set(s.id, m);
  const playBtn = el('button', { className: 'btn primary', type: 'button', textContent: 'Play' });
  playBtn.addEventListener('click', () => (isPlaying(s.id) ? stop(s.id) : play(s.id)));
  const head = el('div', { className: 'track-head' }, el('h3', { textContent: s.title ?? s.id }), playBtn);
  if (s.sections) {
    const sel = el('select', { 'aria-label': `${s.id} section` });
    for (const name of s.sections) sel.append(el('option', { value: name, textContent: `section ${name}` }));
    sel.value = s.section ?? s.sections[0];
    sel.addEventListener('change', () => { if (isPlaying(s.id)) music.setSection(s.id, sel.value); });
    head.append(sel);
  }
  const scale = s.scale ? `${s.scale.root} ${s.scale.mode} · ` : '';
  const kind = s.loop === false ? `one-shot, ${s.bars} bars` : `${s.bars}-bar loop`;
  head.append(el('p', { className: 'track-meta', textContent: `${s.id} · ${s.bpm} bpm ${s.beatsPerBar}/4 · ${scale}${kind}` }));
  const layers = el('div', { className: 'layers' });
  let group = null;
  for (const l of s.layers) {
    if ((l.group ?? null) !== group) {
      group = l.group ?? null;
      if (group) layers.append(el('p', { className: 'layer-group', textContent: group }));
    }
    layers.append(layerRow(s, l, m[l.id]));
  }
  const details = el('details', { className: 'layer-box' }, el('summary', { textContent: `${s.layers.length} layers` }), layers);
  const card = el('article', { className: 'track' }, head, details);
  ui.set(s.id, { card, playBtn });
  return card;
}

/** track cards under the group headings of data/music/index.json */
function buildTracks(groups) {
  const box = $('tracks');
  box.replaceChildren();
  const list = (groups?.length ? groups : [{ name: 'Tracks', tracks: [...scores.keys()] }])
    .map((g) => ({ ...g, tracks: g.tracks.filter((id) => scores.has(id)) }));
  const rest = [...scores.keys()].filter((id) => !list.some((g) => g.tracks.includes(id)));
  if (rest.length) list.push({ name: 'Other', tracks: rest });
  const placed = new Set();
  for (const g of list) {
    const ids = g.tracks.filter((id) => !placed.has(id));
    if (!ids.length) continue;
    box.append(el('h3', { className: 'group-title', textContent: g.name }));
    for (const id of ids) {
      placed.add(id);
      box.append(trackCard(scores.get(id)));
    }
  }
  buildCombo();
}

// ---- status and meter ----------------------------------------------------------------------------------

function render() {
  const state = audio.state;
  const status = $('status');
  let text = loadError ? `Could not load the music: ${loadError}` : STATE_TEXT[state] ?? state;
  if (music && state === 'running') {
    const st = music.state();
    const playing = st.tracks.filter((t) => !t.stopping);
    const audible = playing.filter((t) => !t.ended);
    if (audible.length) text += ` · ${audible.map((t) => `${t.id} bar ${t.loopBar + 1} beat ${Math.floor(t.beat) + 1}`).join(', ')}`;
    text += ` · ${st.voices} voices`;
  }
  status.textContent = text;
  status.className = `status${state === 'running' ? ' running' : ''}${loadError ? ' error' : ''}`;
  $('unlock').hidden = state === 'running' || !audio.supported;
  for (const [id, { card, playBtn }] of ui) {
    const on = isPlaying(id);
    card.classList.toggle('playing', on);
    playBtn.textContent = on ? 'Stop' : 'Play';
  }
}

const meter = $('meter');
const meterCtx = meter.getContext('2d');
let meterData = null;
let peakHold = -60;

function drawMeter() {
  const w = meter.clientWidth || meter.width;
  const dpr = window.devicePixelRatio || 1;
  if (meter.width !== Math.round(w * dpr)) { meter.width = Math.round(w * dpr); meter.height = Math.round(18 * dpr); }
  const W = meter.width, H = meter.height;
  meterCtx.clearRect(0, 0, W, H);
  let rmsDb = -60, peakDb = -60;
  if (analyser && audio.state === 'running') {
    meterData ??= new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(meterData);
    let sq = 0, pk = 0;
    for (const v of meterData) { sq += v * v; pk = Math.max(pk, Math.abs(v)); }
    rmsDb = Math.max(-60, 20 * Math.log10(Math.sqrt(sq / meterData.length) || 1e-6));
    peakDb = Math.max(-60, 20 * Math.log10(pk || 1e-6));
  }
  peakHold = Math.max(peakDb, peakHold - 0.5);
  const x = (db) => ((db + 60) / 60) * W;
  meterCtx.fillStyle = '#6fae8f';
  meterCtx.fillRect(0, 0, x(rmsDb), H);
  meterCtx.fillStyle = peakHold > -1 ? '#c76b4f' : '#c9a45c';
  meterCtx.fillRect(Math.max(0, x(peakHold) - 2 * dpr), 0, 2 * dpr, H);
  meterCtx.fillStyle = 'rgba(216,210,191,0.25)';
  for (let db = -48; db < 0; db += 12) meterCtx.fillRect(x(db), 0, dpr, H);
  requestAnimationFrame(drawMeter);
}

// ---- start -------------------------------------------------------------------------------------------

$('unlock').addEventListener('click', async () => { await audio.unlock(); ensureMusic(); render(); });
audio.onChange(() => { ensureMusic(); render(); });
setInterval(render, 250);
buildMix();
render();
requestAnimationFrame(drawMeter);

async function loadScores() {
  try {
    const index = await (await fetch('data/music/index.json')).json();
    for (const id of index.tracks) {
      const r = await fetch(`data/music/${id}.json`);
      if (!r.ok) throw new Error(`${id}.json: HTTP ${r.status}`);
      scores.set(id, await r.json());
    }
    buildTracks(index.groups);
    if (music) music.load([...scores.values()]);
  } catch (e) {
    loadError = e.message;
    $('tracks').replaceChildren(el('p', { className: 'error', textContent: loadError }));
  }
  render();
}
const loaded = loadScores();

// for the smoke test and the soak tool
window.__smoke = async () => {
  await loaded;
  return { ok: !loadError, details: { audio: audio.state, tracks: scores.size, unlockShown: !$('unlock').hidden, error: loadError } };
};
window.__jukebox = { audio, scores, play, stop, get music() { return music; }, ensureMusic, loaded };
