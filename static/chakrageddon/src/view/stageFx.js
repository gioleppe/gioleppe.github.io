// The bosses' stages, dressed (IMPROVEMENTS.md point 6). A zone lists its effects in zone.fx; the overworld view
// draws them in two layers: 'ground' (on the floor, under everyone) and 'air' (over everyone, before the night tint).
//   smoke { at: [[x, y]] }           wisps rising (incense, Baba's smoke)       steam { at }   puffs off a griddle
//   blink { on: 'char' }             little lights blinking on every tile of that character (scooters in the mud)
//   lasers { at, colors }            beams from those tiles sweeping on the beat (the Pit)
//   led { rect }                     an LED wall over those tiles, patterns changing every bar
//   candles { at }                   flames that flicker                       uv { }   blacklight over the zone
//   fog { rect }                     slow fog banks                            phones { rect }   fans holding up phones
//   pulse { rect, color }            the floor flashes on the kick              rumble { row }   dust shaken off a wall
//   ticks { rect }                   lights ticking along the walls on the hi-hat
//   notes { rect }                   notes of the melody drifting up           grand { rect }   gold light and banners
//   glow { at, color }               a soft light round glowing things          flash { }   a strobe flash on every beat
// Reduced motion and grounded mode keep everything, held still.
const TS = 16;
const COLS = ['#FF4FA8', '#3FD8E8', '#FFE066', '#4FE88A', '#C86BFF'];
const h32 = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return (h ^ (h >>> 16)) >>> 0; };

export function stageFx(view, game, g, cx, cy, layer) {
  const s = game.engine.state, zone = game.data.zones[s.zoneId], list = zone.fx;
  if (!list) return;
  const still = game.settings.reducedMotion || game.settings.grounded, t = still ? 0 : view.t;
  const bpm = zone.baseBpm || 140, beats = (view.t * bpm) / 60, beat = still ? 0 : beats % 1, bar = still ? 0 : Math.floor(beats / 4);
  const X = (x) => x * TS - cx, Y = (y) => y * TS - cy;
  const a0 = g.globalAlpha;
  for (const f of list) {
    if (layer === 'ground') {
      if (f.kind === 'led') {
        const [x0, y0, x1, y1] = f.rect;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
          const k = (h32(x * 4 + i + bar * 7, y * 4 + j) + Math.floor(((x - x0) * 4 + i) / 3 + beats * 2) * (still ? 0 : 1)) % 7;
          if (k > 3) continue;
          g.globalAlpha = 0.75; g.fillStyle = COLS[(k + bar) % COLS.length]; g.fillRect(X(x) + 1 + i * 4, Y(y) + 1 + j * 4, 2, 2);
        }
      } else if (f.kind === 'pulse') {
        const [x0, y0, x1, y1] = f.rect, k = still ? 0.12 : Math.max(0, 1 - beat * 3) * 0.3;
        if (k > 0) { g.globalAlpha = k; g.fillStyle = f.color || '#FF4FA8'; g.fillRect(X(x0), Y(y0), (x1 - x0 + 1) * TS, (y1 - y0 + 1) * TS); }
      } else if (f.kind === 'grand') {
        const [x0, y0, x1, y1] = f.rect;
        g.globalAlpha = 0.16; g.fillStyle = '#FFD23F'; g.fillRect(X(x0), Y(y0), (x1 - x0 + 1) * TS, (y1 - y0 + 1) * TS);
        for (let x = x0; x <= x1; x += 3) { g.globalAlpha = 0.9; g.fillStyle = (x / 3) % 2 ? '#9A4FE0' : '#FF4FA8'; g.fillRect(X(x) + 5, Y(y0) - 14, 6, 10); g.fillStyle = '#FFD23F'; g.fillRect(X(x) + 5, Y(y0) - 15, 6, 1); }
      }
      continue;
    }
    // ---- the air layer
    if (f.kind === 'smoke' || f.kind === 'steam') {
      const white = f.kind === 'steam';
      for (const [x, y] of f.at) for (let i = 0; i < 4; i++) {
        const k = still ? (i + 1) / 5 : ((t * (white ? 0.8 : 0.35) + i / 4 + x * 0.13) % 1);
        g.globalAlpha = (1 - k) * (white ? 0.5 : 0.35); g.fillStyle = white ? '#F4F8FF' : '#B8B0C8';
        const sx = X(x) + 8 + Math.round(Math.sin(k * 6 + i * 2) * 3 * (still ? 0 : 1)), sy = Y(y) + 4 - k * (white ? 16 : 26), r = 2 + k * (white ? 3 : 5);
        g.beginPath(); g.arc(sx, sy, r, 0, 7); g.fill();
      }
    } else if (f.kind === 'blink') {
      zone.rows.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch !== f.on) return;
        const on = still || (Math.floor(t * 2 + (h32(x, y) % 10) / 5) % 2 === 0);
        if (!on) return;
        g.globalAlpha = 1; g.fillStyle = h32(x, y) % 2 ? '#FFB347' : '#FF4F4F'; g.fillRect(X(x) + 3 + (h32(x, y) % 8), Y(y) + 6, 2, 1);
      }));
    } else if (f.kind === 'lasers') {
      const cols = f.colors || COLS;
      f.at.forEach(([x, y], i) => {
        const ang = still ? 0.6 + i * 0.4 : 0.35 + Math.sin(beats * Math.PI * 0.5 + i * 1.7) * 0.5, dir = i % 2 ? -1 : 1;
        g.globalAlpha = still ? 0.2 : 0.45; g.strokeStyle = cols[(i + bar) % cols.length]; g.lineWidth = 1;
        g.beginPath(); g.moveTo(X(x) + 8, Y(y) - 4); g.lineTo(X(x) + 8 + dir * Math.cos(ang) * 260, Y(y) - 4 + Math.sin(ang) * 160); g.stroke();
      });
    } else if (f.kind === 'candles') {
      for (const [x, y] of f.at) {
        const fl = still ? 0 : Math.round(Math.sin(t * 13 + x * 3 + y) * 0.7);
        g.globalAlpha = 1; g.fillStyle = '#F4F0E8'; g.fillRect(X(x) + 7, Y(y) + 8, 2, 5);
        g.fillStyle = '#FFB347'; g.fillRect(X(x) + 7 + fl, Y(y) + 5, 2, 3); g.fillStyle = '#FFF4B0'; g.fillRect(X(x) + 7 + fl, Y(y) + 6, 1, 1);
        g.globalAlpha = 0.18; g.fillStyle = '#FFB347'; g.beginPath(); g.arc(X(x) + 8, Y(y) + 7, 7, 0, 7); g.fill();
      }
    } else if (f.kind === 'uv') {
      g.globalAlpha = 0.14; g.fillStyle = '#6A2AE0'; g.fillRect(0, 0, 320, 180);
    } else if (f.kind === 'fog') {
      const [x0, y0, x1, y1] = f.rect;
      for (let i = 0; i < 5; i++) {
        const w = (x1 - x0 + 1) * TS, k = still ? i / 5 : ((t * 0.05 + i / 5) % 1);
        g.globalAlpha = 0.16; g.fillStyle = '#D8D0F0';
        g.beginPath(); g.ellipse(X(x0) + k * w, Y(y0) + ((i * 37) % ((y1 - y0 + 1) * TS)), 34, 7, 0, 0, 7); g.fill();
      }
    } else if (f.kind === 'phones') {
      const [x0, y0, x1, y1] = f.rect;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (f.every ? (x * 5 + y * 3) % f.every !== 0 : h32(x, y) % 3 === 0) continue;   // phones where the fans stand
        const up = still ? 0 : Math.round(Math.sin(t * 2 + x) * 1);
        g.globalAlpha = 1; g.fillStyle = '#14101E'; g.fillRect(X(x) + 6, Y(y) - 14 + up, 4, 6);
        g.fillStyle = (h32(x, y) + Math.floor(t * 3)) % 5 ? '#C8F4FF' : '#FFFFFF'; g.fillRect(X(x) + 7, Y(y) - 13 + up, 2, 4);
      }
    } else if (f.kind === 'glow') {
      for (const [x, y] of f.at) { const k = still ? 1 : 0.8 + 0.2 * Math.sin(t * 3 + x); g.globalAlpha = 0.22 * k; g.fillStyle = f.color || '#4FE88A'; g.beginPath(); g.arc(X(x) + 8, Y(y) - 4, 13, 0, 7); g.fill(); }
    } else if (f.kind === 'flash') {
      if (!still && beat < 0.08) { g.globalAlpha = 0.1; g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, 320, 180); }   // a fast strobe on every beat (none with reduced motion or grounded mode)
    } else if (f.kind === 'rumble') {
      for (let i = 0; i < 10; i++) {
        const k = still ? 0.3 : (beats * 0.5 + i / 10) % 1;
        g.globalAlpha = (1 - k) * 0.6; g.fillStyle = '#8A7AA0';
        g.fillRect(X(1 + (i * 7) % 18) + (i % 3) * 4, Y(f.row) + 16 + k * 22, 1, 2);
      }
      if (!still && beat < 0.12) { g.globalAlpha = 0.35; g.fillStyle = '#14101E'; g.fillRect(0, Y(f.row) + 15, 320, 1); }
    } else if (f.kind === 'ticks') {
      const [x0, y0, x1] = f.rect, n = x1 - x0 + 1, on = still ? -1 : Math.floor(beats * 4) % n;
      for (let i = 0; i < n; i++) { g.globalAlpha = i === on ? 1 : 0.35; g.fillStyle = i === on ? '#FFFFFF' : '#5FF4FF'; g.fillRect(X(x0 + i) + 7, Y(y0) - 2, 2, 2); }
    } else if (f.kind === 'notes') {
      const [x0, y0, x1, y1] = f.rect;
      for (let i = 0; i < 6; i++) {
        const k = still ? (i + 1) / 7 : ((t * 0.3 + i / 6) % 1), x = X(x0 + ((i * 5) % (x1 - x0 + 1))) + 6, y = Y(y1) + 8 - k * ((y1 - y0 + 1) * TS + 10);
        g.globalAlpha = Math.sin(k * Math.PI); g.fillStyle = COLS[i % COLS.length];
        g.fillRect(x, y, 3, 2); g.fillRect(x + 2, y - 5, 1, 5); g.fillRect(x + 2, y - 5, 3, 1);
      }
    }
  }
  g.globalAlpha = a0;
}

/** the speaker stack Backstage (and anything listed in zone.shake) shakes on the beat */
export function shakeOf(view, game, id) {
  const zone = game.data.zones[game.engine.state.zoneId];
  if (!zone.shake?.includes(id) || game.settings.reducedMotion) return 0;
  const k = ((view.t * (zone.baseBpm || 140)) / 60) % 1;
  return k < 0.15 ? (Math.floor(view.t * 60) % 2 ? 1 : -1) : 0;
}
