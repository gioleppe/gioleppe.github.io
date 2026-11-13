// Web Audio psytrance and sound effects, generated at run time (no audio files).
// Music follows the zone's BPM and mood; a master low-pass closes as intoxication rises.
const SCALE = [0, 1, 4, 5, 7, 8, 10, 12, 13, 16];   // phrygian dominant: the Goa sound

// per mood: root note (Hz), which layers play, how bright, and a level trim (measured, see OPEN_POINTS item 12)
const MOODS = {
  TITLE:            { root: 55.0, kick: 1, bass: 1, hat: 1, lead: 0.5, pad: 0, bright: 900, seed: 3 },
  ANJUNA_DUST:      { root: 65.4, kick: 0.6, bass: 0.7, hat: 0.5, lead: 0.35, pad: 0, bright: 700, seed: 11, major: true, level: 1.25 },
  UV_BLACKLIGHT:    { root: 55.0, kick: 1, bass: 1, hat: 1, lead: 0.7, pad: 0, bright: 1200, seed: 23 },
  CHAI_TENT_WARMTH: { root: 73.4, kick: 0, bass: 0, hat: 0, lead: 0.25, pad: 1, bright: 600, seed: 5, major: true, level: 2 },
  BAD_TRIP:         { root: 49.0, kick: 1, bass: 1, hat: 0.6, lead: 0.5, pad: 0, bright: 500, seed: 41, detune: 18 },
  BATTLE:           { root: 61.7, kick: 1, bass: 1, hat: 1, lead: 1, pad: 0, bright: 1500, seed: 7 },
  BOSS:             { root: 51.9, kick: 1, bass: 1, hat: 1, lead: 1, pad: 0, bright: 1900, seed: 13, detune: 8 },
  // the Four-on-the-Floor: one track built up door by door (kick, then bass, then hi-hat, then the lead)
  FOUR_1:           { root: 55.0, kick: 1, bass: 0, hat: 0, lead: 0, pad: 0, bright: 900, seed: 31 },
  FOUR_2:           { root: 55.0, kick: 1, bass: 1, hat: 0, lead: 0, pad: 0, bright: 1100, seed: 31 },
  FOUR_3:           { root: 55.0, kick: 1, bass: 1, hat: 1, lead: 0, pad: 0, bright: 1300, seed: 31 },
  FOUR_4:           { root: 55.0, kick: 1, bass: 1, hat: 1, lead: 1, pad: 0, bright: 1600, seed: 31 },
};
const MAJOR = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
// bus levels: effects were ~10 dB under the music and got lost in battles, so they sit ~5 dB higher than before
export const MUSIC_LEVEL = 0.8, FX_LEVEL = 1.6;
// rolling arpeggio shapes (scale degrees); each zone picks one, so two zones with this style no longer share a melody
const RUNS = [[0, 2, 4, 6, 4, 2, 1, 3], [0, 3, 5, 7, 5, 3, 2, 4], [0, 4, 2, 5, 1, 6, 3, 4], [7, 5, 4, 2, 4, 5, 6, 3]];

const LEADS = ['square', 'sawtooth', 'triangle'];
const strHash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };

/**
 * The music for a mood in a particular zone. The mood sets the character (which layers, how bright);
 * the zone shifts the key, the pattern seed, the lead sound, the hi-hat density and the riff style,
 * so two zones with the same mood no longer sound the same. Pure, so tests can compare zones.
 */
export function profileFor(mood, zoneId = '') {
  const base = MOODS[mood] || MOODS.TITLE, h = strHash(`${mood}:${zoneId}`);
  if (!zoneId || mood === 'TITLE') return { ...base, leadWave: base.major ? 'triangle' : 'square', arp: 0, hatDensity: 0.2 };
  const shift = [-3, -2, 0, 2, 3, 5][h % 6];
  return {
    ...base,
    root: base.root * 2 ** (shift / 12),
    seed: base.seed + (h % 997),
    leadWave: base.major ? (['triangle', 'sine'][(h >>> 3) % 2]) : LEADS[(h >>> 3) % 3],
    arp: (h >>> 6) % 3,                                  // 0 sparse notes, 1 rolling arpeggio, 2 call and response
    hatDensity: [0.12, 0.2, 0.32][(h >>> 9) % 3],
    bright: base.bright * [0.85, 1, 1.15][(h >>> 11) % 3],
  };
}

const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export class SynthAudio {
  constructor() { this.highPad = 0; this.mute = null; this.ctx = null; this.vol = 0.7; this.bpm = 140; this.mood = null; this.zone = ''; this.prof = null; this.step = 0; this.next = 0; this.pending = { bpm: 140, mood: 'TITLE' }; this.lastSfx = {}; }

  /** Call from inside a user gesture. Creates the audio graph the first time, and resumes it whenever it is not
   *  running (a phone may start it suspended, or suspend it in the background). Returns true once sound is running. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') { this.ctx.resume?.().catch?.(() => {}); this.nudge(); }
      return this.ctx.state === 'running';
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return true;                                 // no Web Audio: nothing to wait for
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.vol * 0.6;
    this.filter = c.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 12000;   // a gentle top end; intoxication closes it further
    const comp = c.createDynamicsCompressor();
    this.music = c.createGain(); this.music.gain.value = MUSIC_LEVEL;
    this.music.connect(this.filter); this.filter.connect(comp); comp.connect(this.master); this.master.connect(c.destination);
    this.fx = c.createGain(); this.fx.gain.value = FX_LEVEL; this.fx.connect(this.master);
    const len = c.sampleRate * 0.5, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    setInterval(() => this.tick(), 25);
    if (this.pending) this.setTrack(this.pending);
    this.nudge();
    if (c.state !== 'running') c.resume?.().catch?.(() => {});
    return c.state === 'running';
  }
  /** iOS only lets a context make sound after something has played inside a gesture: a one-sample silence */
  nudge() {
    try { const s = this.ctx.createBufferSource(); s.buffer = this.ctx.createBuffer(1, 1, 22050); s.connect(this.ctx.destination); s.start(0); } catch { /* not needed elsewhere */ }
  }
  suspend() { this.ctx?.suspend(); }
  resume() { if (this.ctx && this.vol > 0) this.ctx.resume(); }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.setTargetAtTime(v * 0.6, this.ctx.currentTime, 0.05); }

  /** { bpm, mood, zone, lowPass, highPad } - any subset. highPad (0..1): a warm chord under the music from the Come-up on */
  setTrack(t) {
    if (t.highPad !== undefined) this.highPad = t.highPad;
    if (!this.ctx) { const { fade, ...rest } = t; this.pending = { ...this.pending, ...rest }; return; }
    // fade: the song playing now fades out over that many seconds, then this one starts (the end of a battle)
    if (t.fade && t.mood && (t.mood !== this.mood || (t.zone ?? this.zone) !== this.zone) && this.music?.gain?.linearRampToValueAtTime) {
      const now = this.ctx.currentTime, g = this.music.gain;
      g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0.0001, now + t.fade);
      this.fadeTo = { track: { ...t, fade: 0 }, at: now + t.fade };
      return;
    }
    if (t.mood && this.fadeTo) {                                   // another song asked for meanwhile: it wins, at full level
      this.fadeTo = null; this.music.gain.cancelScheduledValues?.(this.ctx.currentTime);
      if (t.mood === this.mood && (t.zone ?? this.zone) === this.zone) this.music.gain.setTargetAtTime(MUSIC_LEVEL * (this.prof?.level || 1), this.ctx.currentTime, 0.2);
    }
    if (t.bpm) this.bpm = t.bpm;
    const zone = t.zone ?? this.zone;
    if (t.mood && MOODS[t.mood] && (t.mood !== this.mood || zone !== this.zone)) {
      this.mood = t.mood; this.zone = zone; this.prof = profileFor(t.mood, zone); this.step = 0;
      this.music.gain.setTargetAtTime(MUSIC_LEVEL * (this.prof.level || 1), this.ctx.currentTime, 0.2);   // calm tracks are trimmed up to sit near the others
    }
    if (t.lowPass) this.filter.frequency.setTargetAtTime(Math.max(400, Math.min(12000, t.lowPass)), this.ctx.currentTime, 0.3);
  }

  tick() {
    const c = this.ctx;
    if (!c || c.state !== 'running' || !this.mood) return;
    if (this.fadeTo && c.currentTime >= this.fadeTo.at) { const f = this.fadeTo; this.fadeTo = null; this.setTrack(f.track); }
    if (this.next < c.currentTime - 0.2) this.next = c.currentTime + 0.05;
    const spb = 60 / this.bpm / 4;
    while (this.next < c.currentTime + 0.12) { this.playStep(this.step, this.next, spb); this.next += spb; this.step = (this.step + 1) % 256; }
  }

  voice(type, freq, t, dur, gain, out = this.music, opts = {}) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + dur);
    if (opts.detune) o.detune.value = opts.detune;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + (opts.attack ?? 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (opts.cutoff) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(opts.cutoff, t); if (opts.cutoffTo) f.frequency.exponentialRampToValueAtTime(opts.cutoffTo, t + dur); f.Q.value = opts.q ?? 6; o.connect(f); node = f; }
    node.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }
  hiss(t, dur, gain, hp = 6000, out = this.music) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = 'highpass'; f.frequency.value = hp;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + dur + 0.02);
  }

  /** the music drops low for a moment (a boss's arrival), then comes back */
  duck(seconds = 1.5) {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const now = c.currentTime, full = MUSIC_LEVEL * (this.prof?.level || 1);
    this.music.gain.cancelScheduledValues(now); this.music.gain.setValueAtTime(this.music.gain.value, now);
    this.music.gain.linearRampToValueAtTime(full * 0.12, now + 0.15); this.music.gain.setValueAtTime(full * 0.12, now + seconds); this.music.gain.linearRampToValueAtTime(full, now + seconds + 0.4);
  }

  /** The music stops dead for one bar, from the start of the next one, then drops back in with a crash (the Poi Pit's
   *  crowd turning to stare at you). Returns when that happens, in seconds from now, and for how long. */
  breakdown() {
    const c = this.ctx, spb = 60 / this.bpm / 4;
    if (!c || c.state !== 'running' || !this.mood) return { delay: 0, dur: spb * 16 };
    const at = this.next + ((16 - (this.step % 16)) % 16) * spb, end = at + spb * 16;
    this.mute = { from: at, to: end };
    this.music.gain.setValueAtTime(this.music.gain.value, at - 0.01); this.music.gain.linearRampToValueAtTime(0.0001, at);
    this.music.gain.setValueAtTime(0.0001, end - 0.01); this.music.gain.linearRampToValueAtTime(MUSIC_LEVEL * (this.prof?.level || 1), end);
    this.hiss(end, 1.2, 0.35, 3000, this.fx); this.voice('sine', 150, end, 0.4, 1, this.fx, { to: 40 });   // and back in
    return { delay: Math.max(0, at - c.currentTime), dur: end - at };
  }

  playStep(i, t, spb) {
    if (this.mute && t >= this.mute.from && t < this.mute.to) return;
    if (this.mute && t >= this.mute.to) this.mute = null;
    const m = this.prof || profileFor(this.mood), beat = i % 4, bar = Math.floor(i / 16);
    const scale = m.major ? MAJOR : SCALE;
    if (m.kick && beat === 0) this.voice('sine', 150, t, 0.2, 0.9 * m.kick, this.music, { to: 42 });
    if (m.bass && beat !== 0) {
      // rolling 16th bass: root with an occasional jump, changing every 4 bars
      const jump = hash(m.seed, Math.floor(bar / 4) * 16 + (i % 16)) < 0.18 ? scale[1 + Math.floor(hash(m.seed + 1, i % 16) * 3)] : 0;
      this.voice('sawtooth', m.root * 2 ** (jump / 12), t, spb * 0.95, 0.3 * m.bass, this.music, { cutoff: m.bright, cutoffTo: 180, q: 6, detune: m.detune || 0 });
    }
    if (m.hat) { if (beat === 2) this.hiss(t, 0.04, 0.13 * m.hat); else if (hash(m.seed + 2, i % 32) < m.hatDensity) this.hiss(t, 0.02, 0.05 * m.hat, 9000); }
    if (m.lead && bar % 8 >= 2) {
      const k = (bar % 4) * 16 + (i % 16);
      let note = null;
      if (m.arp === 1) { if (i % 2 === 0) { const run = RUNS[m.seed % RUNS.length]; note = scale[run[(i / 2 + m.seed) % 8] % scale.length]; } }   // rolling arpeggio: its shape and starting point come from the seed
      else if (m.arp === 2) { const phrase = (bar % 2 === 0) ? i % 16 : (i % 16) ^ 3; if (hash(m.seed + 5, phrase) < 0.3 * m.lead + 0.1) note = scale[Math.floor(hash(m.seed + 4, phrase) * 5) + (bar % 2) * 2]; }   // call and response
      else if (hash(m.seed + 3, k) < 0.34 * m.lead + 0.08) note = scale[Math.floor(hash(m.seed + 4, k) * scale.length)];
      if (note !== null) this.voice(m.leadWave, m.root * 4 * 2 ** (note / 12), t, spb * (m.major ? 2.5 : m.arp === 1 ? 1.1 : 1.4), (m.major ? 0.11 : 0.06) * Math.min(1, m.lead + 0.3), this.music, { cutoff: m.bright * 2, cutoffTo: 500, q: 6, detune: m.detune || 0 });
    }
    if ((m.pad || this.highPad > 0) && i % 32 === 0) {
      // chords in the track's own key: I IV V vi for the major moods, I bII iv I for the Goa scale (the pad used to play
      // the major ones over every track, a second song in another key under the boss music)
      const chord = (m.major ? [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 9]] : [[0, 4, 7], [1, 5, 8], [5, 8, 12], [0, 4, 7]])[bar % 8 >> 1];
      const gain = m.pad ? 0.09 : 0.035 * this.highPad;                 // the Come-up's pad sits under the zone's music, below the lead
      for (const n of chord) this.voice('triangle', m.root * 2 * 2 ** (n / 12), t, spb * 34, gain, this.music, { attack: spb * 6 });
    }
  }

  /** short synthesized effects */
  sfx(id) {
    const c = this.ctx;
    if (!c || c.state !== 'running' || this.vol <= 0) return;
    const now = c.currentTime;
    if (this.lastSfx[id] && now - this.lastSfx[id] < 0.03) return;
    this.lastSfx[id] = now;
    const o = this.fx, T = (type, f, d, g, at = 0, opts) => this.voice(type, f, now + at, d, g, o, opts);
    switch (id) {
      case 'blip': T('square', 760, 0.03, 0.04); break;
      case 'select': T('square', 660, 0.06, 0.09); T('square', 990, 0.08, 0.09, 0.05); break;
      case 'back': T('square', 520, 0.06, 0.08); T('square', 390, 0.08, 0.08, 0.05); break;
      case 'deny': T('sawtooth', 160, 0.14, 0.12); break;
      case 'bump': T('sine', 110, 0.07, 0.25, 0, { to: 60 }); break;
      case 'item': [523, 659, 784].forEach((f, i) => T('square', f, 0.09, 0.09, i * 0.07)); break;
      case 'coin': T('square', 1320, 0.05, 0.08); T('square', 1760, 0.12, 0.08, 0.05); break;
      case 'fanfare': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => T('square', f, i === 5 ? 0.4 : 0.11, 0.1, i * 0.1)); break;
      case 'levelup': [392, 523, 659, 784, 1047].forEach((f, i) => T('triangle', f, 0.12, 0.16, i * 0.06)); break;
      case 'heal': [440, 554, 659, 880].forEach((f, i) => T('triangle', f, 0.18, 0.14, i * 0.09)); break;
      case 'hit': this.hiss(now, 0.09, 0.3, 1200, o); T('square', 130, 0.09, 0.14, 0, { to: 70 }); break;
      case 'move': T('sawtooth', 260, 0.16, 0.1, 0, { to: 720, cutoff: 2400 }); break;
      case 'status': T('sine', 500, 0.3, 0.14, 0, { to: 250 }); T('sine', 760, 0.3, 0.08, 0.04, { to: 380 }); break;
      case 'faint': T('square', 420, 0.5, 0.1, 0, { to: 70 }); break;
      case 'evolve': [262, 330, 392, 523, 659, 784, 1047, 1319].forEach((f, i) => T('triangle', f, 0.3, 0.12, i * 0.08)); break;
      case 'encounter': for (let i = 0; i < 6; i++) T('square', i % 2 ? 880 : 660, 0.07, 0.1, i * 0.07); break;
      case 'alert': T('square', 1175, 0.08, 0.12); T('square', 1175, 0.16, 0.12, 0.12); break;
      case 'technique': T('sawtooth', 200, 0.3, 0.12, 0, { to: 900, cutoff: 3000 }); this.hiss(now + 0.05, 0.2, 0.12, 3000, o); break;
      case 'push': T('sine', 90, 0.16, 0.35, 0, { to: 45 }); break;
      case 'throw': T('sine', 400, 0.35, 0.12, 0, { to: 1200 }); break;
      case 'zip': this.hiss(now, 0.14, 0.12, 2500, o); T('sawtooth', 300, 0.14, 0.04, 0, { to: 900 }); break;
      case 'gong': T('sine', 110, 2.6, 0.35, 0, { attack: 0.01 }); T('sine', 166, 2.2, 0.16, 0.01, { detune: 7 }); T('triangle', 262, 1.4, 0.06, 0.02); break;   // Svetlana
      case 'horn': [[440, 0], [349, 0.18], [440, 0.42], [349, 0.6]].forEach(([f, at]) => T('square', f, 0.15, 0.08, at, { cutoff: 1800 })); break;            // scooter horns
      case 'drop': T('sine', 220, 0.7, 0.4, 0, { to: 38 }); this.hiss(now, 0.6, 0.2, 800, o); break;                                                  // the drop
      case 'cheer': for (let i = 0; i < 6; i++) this.hiss(now + i * 0.12, 0.9, 0.09, 1500 + i * 400, o); T('sine', 1800, 0.25, 0.05, 0.3, { to: 2400 }); T('sine', 2000, 0.25, 0.05, 0.7, { to: 2600 }); break;   // the crowd
      case 'dissolve': [1568, 1319, 1047, 784, 659].forEach((f, i) => T('triangle', f, 0.16, 0.07, i * 0.06)); this.hiss(now, 0.5, 0.05, 7000, o); break;   // a hallucination fades
      case 'burst': this.hiss(now, 0.3, 0.3, 1500, o); [523, 659, 784, 988, 1175, 1568].forEach((f, i) => T('square', f, 0.12, 0.08, 0.05 + i * 0.04)); break;   // a rainbow explosion
      default: break;
    }
  }
}
