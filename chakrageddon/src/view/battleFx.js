// Battle visuals that are pure drawing: a backdrop per kind of place, and the colours of each type.
// Move animations live in moveFx.js. Nothing here touches game state.
import { W } from './CanvasRenderer.js';
import { drawText } from './ui.js';

export const SPOT = { e: { x: 232, y: 52 }, p: { x: 84, y: 102 } };   // centres of the two creatures

/** which backdrop a zone gets, from its ground tile */
export function backdropOf(zone) {
  if (!zone) return 'meadow';
  if (zone.interior) return 'room';
  return { sand: 'beach', path: 'beach', grass: 'meadow', jungle: 'forest', laterite: 'cliff', concrete: 'backstage', cave: 'cave', temple_floor: 'temple', wood: 'room' }[zone.ground] || 'meadow';
}

const SKY = {
  beach: ['#7CC4D8', '#F2D8B0'], meadow: ['#8FD0E8', '#E8F4D0'], forest: ['#1E3A2A', '#3F6A44'], cliff: ['#E2704F', '#FFD08A'],
  backstage: ['#1A1A2A', '#3A3A50'], cave: ['#1A1412', '#3A2E28'], temple: ['#3A1A50', '#C99A58'], room: ['#6E4C24', '#C9A478'],
};
const NIGHT = ['#0B0314', '#2A1250'];

/** draw the backdrop down to y = bottom; t in seconds, still = reduced motion */
export function drawBackdrop(g, style, bottom, t, night, still) {
  const [top, low] = night && style !== 'room' && style !== 'cave' ? NIGHT : SKY[style] || SKY.meadow;
  const grd = g.createLinearGradient(0, 0, 0, bottom);
  grd.addColorStop(0, top); grd.addColorStop(1, low);
  g.fillStyle = grd; g.fillRect(0, 0, W, bottom);
  const wob = still ? 0 : t;
  if (style === 'beach') {
    g.fillStyle = night ? '#2A3A6A' : '#4FA4B8'; g.fillRect(0, 58, W, 18);
    g.fillStyle = night ? '#4A5A9A' : '#8FD0DE';
    for (let x = 0; x < W; x += 22) g.fillRect((x + Math.round(wob * 12)) % W, 62 + ((x / 22) % 2) * 6, 10, 1);
    g.fillStyle = night ? '#6A5A6A' : '#E8C39E'; g.fillRect(0, 76, W, bottom - 76);
    palm(g, 18, 76, night); palm(g, 300, 80, night);
  } else if (style === 'meadow') {
    g.fillStyle = night ? '#1E3A2A' : '#9AD08A'; hill(g, 70, 70, 120); hill(g, 250, 66, 140);
    g.fillStyle = night ? '#2A4A32' : '#74BE63'; g.fillRect(0, 76, W, bottom - 76);
  } else if (style === 'forest') {
    for (let i = 0; i < 9; i++) { const x = i * 40 - 10; g.fillStyle = i % 2 ? '#14281C' : '#1A3424'; g.fillRect(x + 14, 20, 8, 60); g.beginPath(); g.ellipse(x + 18, 22, 26, 18, 0, 0, 7); g.fill(); }
    g.fillStyle = '#2F5A3A'; g.fillRect(0, 76, W, bottom - 76);
    g.fillStyle = 'rgba(255,224,102,0.5)';
    for (let i = 0; i < 12; i++) { const x = (i * 53 + Math.round(wob * 9)) % W, y = 30 + ((i * 37) % 40) + Math.round(Math.sin(wob * 2 + i) * 3); g.fillRect(x, y, 1, 1); }
  } else if (style === 'cliff') {
    g.fillStyle = '#FFE6A8'; g.beginPath(); g.arc(W / 2, 64, 22, 0, 7); g.fill();
    g.fillStyle = '#4FA4B8'; g.fillRect(0, 62, W, 12);
    g.fillStyle = '#C8603A'; g.fillRect(0, 74, W, bottom - 74);
    g.fillStyle = '#9A4424'; for (let x = 0; x < W; x += 30) g.fillRect(x, 74, 14, 3);
  } else if (style === 'backstage') {
    for (let i = 0; i < 6; i++) { g.fillStyle = ['#3A6484', '#5A8CAE', '#8A3A3A'][i % 3]; g.fillRect(i * 56, 30 - (i % 2) * 14, 50, 50 + (i % 2) * 14); g.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 4; k < 50; k += 8) g.fillRect(i * 56 + k, 30 - (i % 2) * 14, 2, 50 + (i % 2) * 14); }
    for (let i = 0; i < 5; i++) { const on = still || Math.floor(wob * 4 + i) % 2; g.fillStyle = on ? ['#FF4FA8', '#3FD8E8', '#FFE066', '#4FE88A', '#9A4FE0'][i] : '#2A2A3A'; g.fillRect(20 + i * 64, 6, 10, 5); }
    g.fillStyle = '#5A5F6A'; g.fillRect(0, 80, W, bottom - 80);
  } else if (style === 'cave') {
    g.fillStyle = '#2A211D';
    for (let x = 0; x < W; x += 26) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 13, 14 + ((x / 26) % 3) * 8); g.lineTo(x + 26, 0); g.fill(); }
    for (let i = 0; i < 7; i++) { g.fillStyle = ['#5FF4FF', '#C86BFF', '#4FE88A'][i % 3]; const x = 20 + i * 44, y = 50 + ((i * 13) % 20); g.fillRect(x, y, 3, 6); g.fillRect(x - 1, y + 2, 5, 2); }
    g.fillStyle = '#4A3C34'; g.fillRect(0, 78, W, bottom - 78);
  } else if (style === 'temple') {
    for (let i = 0; i < 6; i++) { const x = 12 + i * 56; g.fillStyle = '#C99A58'; g.fillRect(x, 16, 16, 62); g.fillStyle = '#F0CC78'; g.fillRect(x - 3, 12, 22, 5); g.fillRect(x - 3, 76, 22, 4); g.fillStyle = '#8A6230'; g.fillRect(x + 11, 17, 3, 59); }
    g.fillStyle = '#DCCBA4'; g.fillRect(0, 80, W, bottom - 80);
  } else if (style === 'room') {
    for (let x = 0; x < W; x += 20) { g.fillStyle = (x / 20) % 2 ? '#B98450' : '#A87644'; g.fillRect(x, 0, 20, 76); }
    g.fillStyle = '#7CC4D8'; g.fillRect(140, 18, 40, 26); g.fillStyle = '#8E6634'; g.fillRect(138, 16, 44, 2); g.fillRect(138, 44, 44, 2); g.fillRect(159, 18, 2, 26);
    g.fillStyle = '#946338'; g.fillRect(0, 76, W, bottom - 76);
  }
}
function hill(g, x, y, r) { g.beginPath(); g.ellipse(x, y + 10, r, 22, 0, Math.PI, 0); g.fill(); }
function palm(g, x, y, night) {
  g.fillStyle = night ? '#1A1A2A' : '#7E5632'; g.fillRect(x - 1, y - 40, 3, 40);
  g.fillStyle = night ? '#14281C' : '#3E9A4E';
  for (const [dx, dy] of [[-12, -38], [12, -38], [-9, -44], [9, -44], [0, -46]]) { g.beginPath(); g.ellipse(x + dx, y + dy, 9, 3, dx / 30, 0, 7); g.fill(); }
}

/** colours per type for effects */
export const FX_COLORS = {
  PSYCHEDELIC: ['#C86BFF', '#FF4FA8', '#3FD8E8', '#FFE066'], STIMULANT: ['#FFE066', '#FFFFFF', '#FFD23F'],
  ORGANIC: ['#4FE88A', '#3E9A4E', '#B8F4A0'], DOWNER: ['#7C8CD9', '#2A2A4A', '#C8D0FF'],
  DISSOCIATIVE: ['#7FD6FF', '#FF4FA8', '#FFFFFF'], BUMMER: ['#9A8F9F', '#5A5F6A', '#C8C0D0'], NORMAL: ['#FFFFFF', '#F2D8B0', '#FFE066'],
};

// ---------------------------------------------------------------- the bosses' own stages (IMPROVEMENTS.md point 6)
const NEON = ['#FF4FA8', '#3FD8E8', '#FFE066', '#4FE88A', '#C86BFF'];
/**
 * What stands behind a boss: drawn over the zone's backdrop. k: how much of the boss's team is left (0..1), so some of
 * it reacts (Svetlana's candles go out, Chloe's viewers leave); moment: the boss's half-health moment has happened.
 */
export function drawStage(g, stage, bottom, t, still, k = 1, moment = false, bpm = 150) {
  const beats = still ? 0 : (t * bpm) / 60, beat = still ? 0.5 : beats % 1, bar = Math.floor(beats / 4);
  const a0 = g.globalAlpha;
  if (stage === 'pit') {
    // an LED wall behind the decks, strobes on the corners, lasers on the beat (in front of a dark stage wall)
    g.globalAlpha = 0.88; g.fillStyle = '#14081E'; g.fillRect(0, 0, W, 76); g.globalAlpha = 1;
    for (let y = 8; y < 58; y += 5) for (let x = 40; x < W - 40; x += 5) {
      const v = (Math.floor(x / 5) + Math.floor(y / 5) + Math.floor(beats * (moment ? 4 : 2))) % 9;
      if (v > 3) continue;
      g.fillStyle = NEON[(v + bar) % NEON.length]; g.globalAlpha = 0.55; g.fillRect(x, y, 3, 3);
    }
    g.globalAlpha = 1; g.fillStyle = '#14101E'; g.fillRect(36, 58, W - 72, 18); g.fillStyle = '#2A1A3E'; g.fillRect(60, 60, 60, 10); g.fillRect(W - 120, 60, 60, 10);
    g.fillStyle = '#FF4FA8'; g.fillRect(64, 62, 4, 2); g.fillRect(W - 116, 62, 4, 2);
    for (const x of [10, W - 22]) { g.fillStyle = '#2A2A32'; g.fillRect(x, 20, 12, 10); g.fillStyle = (!still && beat < 0.2) ? '#FFFFFF' : '#C8D0DC'; g.fillRect(x + 2, 22, 8, 6); }
    if (!still) { g.globalAlpha = 0.4; for (let i = 0; i < 4; i++) { g.strokeStyle = NEON[(i + bar) % 5]; g.beginPath(); g.moveTo(i % 2 ? W - 16 : 16, 26); g.lineTo(W / 2 + Math.sin(beats + i) * 140, 90); g.stroke(); } }
  } else if (stage === 'yurt') {
    g.fillStyle = 'rgba(154,79,224,0.35)';
    for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(32 + i * 64, 0, 40, 26, 0, 0, Math.PI); g.fill(); }
    const lit = Math.ceil(k * 6);
    for (let i = 0; i < 6; i++) {
      const x = 30 + i * 52, on = i < lit, fl = still ? 0 : Math.round(Math.sin(t * 11 + i) * 0.6);
      g.globalAlpha = 1; g.fillStyle = '#F4F0E8'; g.fillRect(x, 62, 3, 8);
      if (on) { g.fillStyle = '#FFB347'; g.fillRect(x + fl, 58, 3, 4); g.globalAlpha = 0.2; g.beginPath(); g.arc(x + 1, 60, 8, 0, 7); g.fill(); }
      else { g.globalAlpha = 0.4; g.fillStyle = '#B8B0C8'; g.fillRect(x + 1, 52 - (still ? 0 : (t * 6 + i * 3) % 6), 1, 4); }
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 7; i++) { g.fillStyle = ['#FF4FA8', '#9A4FE0', '#E2704F'][i % 3]; g.beginPath(); g.ellipse(20 + i * 48, 76, 14, 4, 0, 0, 7); g.fill(); }
  } else if (stage === 'ditch') {
    g.fillStyle = '#6A4426'; g.fillRect(0, 70, W, 8);
    for (let i = 0; i < 4; i++) {
      const x = 20 + i * 80, tilt = (i % 2 ? 1 : -1) * 3;
      g.fillStyle = ['#E0303C', '#3FD8E8', '#FFE066', '#4FE88A'][i]; g.fillRect(x, 60 + tilt, 30, 8);
      g.fillStyle = '#2A2A32'; g.fillRect(x + 22, 52 + tilt, 3, 10); g.fillRect(x + 18, 51 + tilt, 10, 2);
      g.fillStyle = '#6A4426'; g.fillRect(x - 2, 68, 34, 4);
      if (still || Math.floor(t * 2 + i) % 2) { g.fillStyle = '#FFB347'; g.fillRect(x + 2, 62 + tilt, 2, 2); }
    }
  } else if (stage === 'stall') {
    g.fillStyle = '#3A3A46'; g.fillRect(20, 62, 90, 6); g.fillStyle = '#5A5A68'; g.fillRect(20, 60, 90, 2);
    for (let i = 0; i < 5; i++) { const kk = still ? i / 5 : (t * 0.7 + i / 5) % 1; g.globalAlpha = (1 - kk) * 0.5; g.fillStyle = '#F4F8FF'; g.beginPath(); g.arc(30 + i * 18, 58 - kk * 30, 3 + kk * 5, 0, 7); g.fill(); }
    g.globalAlpha = 1; g.fillStyle = '#2A1A0E'; g.fillRect(W - 96, 14, 70, 44); g.fillStyle = '#5A3418'; g.fillRect(W - 98, 12, 74, 3);
    drawText(g, moment ? 'SPECIAL!!' : 'OMELETTE', W - 61, 22, { color: moment ? '#FF4FA8' : '#F4F0E8', align: 'center' });
    drawText(g, moment ? '2nd helping' : 'Rs 40', W - 61, 36, { color: '#FFE066', align: 'center' });
  } else if (stage === 'forest') {
    g.globalAlpha = 0.18; g.fillStyle = '#6A2AE0'; g.fillRect(0, 0, W, bottom);
    for (let i = 0; i < 4; i++) { const kk = still ? i / 4 : (t * 0.06 + i / 4) % 1; g.globalAlpha = 0.18; g.fillStyle = '#D8D0F0'; g.beginPath(); g.ellipse(kk * W, 66 + (i % 2) * 6, 50, 6, 0, 0, 7); g.fill(); }
    for (let i = 0; i < 6; i++) { const x = 24 + i * 54; g.globalAlpha = 1; g.fillStyle = '#F2E8D0'; g.fillRect(x, 68, 2, 6); g.fillStyle = NEON[i % 5]; g.beginPath(); g.ellipse(x + 1, 67, 6, 3, 0, Math.PI, 0); g.fill(); }
    if (!still && beat < (moment ? 0.18 : 0.12)) { g.globalAlpha = 0.25; g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, bottom); }
  } else if (stage === 'cliff') {
    g.strokeStyle = '#FFFFFF'; g.lineWidth = 3; g.globalAlpha = 0.9; g.beginPath(); g.arc(W - 50, 34, 18, 0, 7); g.stroke();
    g.lineWidth = 1; g.globalAlpha = 0.25; g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(W - 50, 34, 26, 0, 7); g.fill();
    g.globalAlpha = 1; g.fillStyle = '#E0303C'; g.fillRect(8, 8, 32, 11); drawText(g, 'LIVE', 24, 10, { color: '#FFFFFF', align: 'center' });
    drawText(g, `${(2 + k * 38).toFixed(1)}K`, 46, 10, { color: '#FFFFFF', shadow: '#14101E' });
    for (let i = 0; i < 9; i++) { const x = 16 + i * 34, up = still ? 0 : Math.round(Math.sin(t * 2 + i)); g.fillStyle = '#14101E'; g.fillRect(x, 64 + up, 5, 8); g.fillStyle = '#C8F4FF'; g.fillRect(x + 1, 65 + up, 3, 6); }
  } else if (stage === 'cave') {
    const spin = still ? 0 : t * (moment ? 2.4 : 0.6);
    for (let r = 4; r <= 16; r += 4) for (let i = 0; i < 8 + r; i++) { const a = (i / (8 + r)) * Math.PI * 2 + spin * (r % 8 ? 1 : -1); g.globalAlpha = 0.85; g.fillStyle = NEON[(r / 4) % 5]; g.fillRect(Math.round(W / 2 + Math.cos(a) * r * 1.6), Math.round(30 + Math.sin(a) * r), 2, 2); }
    for (let i = 0; i < 8; i++) { const kk = still ? i / 8 : (t * 0.25 + i / 8) % 1; g.globalAlpha = (1 - kk) * 0.3; g.fillStyle = '#B8B0C8'; g.beginPath(); g.arc(20 + i * 40, 76 - kk * 60, 6 + kk * 10, 0, 7); g.fill(); }
    for (const x of [40, 90, W - 90, W - 40]) { g.globalAlpha = 1; g.fillStyle = '#F4F0E8'; g.fillRect(x, 66, 3, 8); g.fillStyle = '#FFB347'; g.fillRect(x, 62 + (still ? 0 : Math.round(Math.sin(t * 9 + x))), 3, 4); }
  } else if (stage === 'backstage') {
    const sh = !still && beat < 0.15 ? 1 : 0;
    g.fillStyle = '#14101E'; g.fillRect(W - 54 + sh, 14, 40, 60); g.fillStyle = '#5A5A68'; g.beginPath(); g.arc(W - 34 + sh, 34, 9, 0, 7); g.arc(W - 34 + sh, 58, 9, 0, 7); g.fill();
    for (const x of [24, 90, 156]) { g.fillStyle = '#D8A060'; g.fillRect(x, 54, 3, 22); g.fillStyle = '#FFD23F'; g.fillRect(x - 1, 52, 5, 3); }
    g.strokeStyle = '#B0203C'; g.lineWidth = 2; g.beginPath(); g.moveTo(25, 56); g.quadraticCurveTo(58, 66, 91, 56); g.quadraticCurveTo(124, 66, 157, 56); g.stroke(); g.lineWidth = 1;
    g.fillStyle = '#3A8A4A'; for (let i = 0; i < 4; i++) g.fillRect(180 + i * 3, 66 - i * 2, 18, 3);
    for (let i = 0; i < 3; i++) { g.fillStyle = '#F4F0E8'; g.fillRect(200 + i * 14, 14, 9, 12); g.fillStyle = NEON[i]; g.fillRect(200 + i * 14, 14, 9, 3); g.fillStyle = '#2A2A32'; g.fillRect(204 + i * 14, 6, 1, 8); }
  } else if (stage && stage.startsWith('temple_')) {
    const kind = stage.slice(7);
    if (kind === 'kick') { const p = still ? 0.15 : Math.max(0, 1 - beat * 3) * (moment ? 0.5 : 0.3); g.globalAlpha = p; g.fillStyle = '#E0303C'; g.fillRect(0, 74, W, bottom - 74); }
    if (kind === 'bass') { const sh = still ? 0 : Math.round(Math.sin(beats * Math.PI * 2) * (moment ? 2 : 1)); g.globalAlpha = 0.5; g.fillStyle = '#3A2A5A'; for (let x = 0; x < W; x += 56) g.fillRect(x + sh, 14, 16, 62); }
    if (kind === 'hat') { const on = still ? -1 : Math.floor(beats * (moment ? 8 : 4)) % 16; for (let i = 0; i < 16; i++) { g.globalAlpha = i === on ? 1 : 0.35; g.fillStyle = i === on ? '#FFFFFF' : '#5FF4FF'; g.fillRect(8 + i * 20, 8, 3, 3); } }
    if (kind === 'lead') for (let i = 0; i < 8; i++) { const kk = still ? (i + 1) / 9 : (t * 0.25 + i / 8) % 1, x = 20 + i * 38, y = 72 - kk * 64; g.globalAlpha = Math.sin(kk * Math.PI); g.fillStyle = NEON[i % 5]; g.fillRect(x, y, 4, 3); g.fillRect(x + 3, y - 7, 1, 7); g.fillRect(x + 3, y - 7, 4, 1); }
  }
  g.globalAlpha = a0;
}
