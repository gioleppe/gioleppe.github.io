// Battle visuals that are pure drawing: a backdrop per kind of place, and the colours of each type.
// Move animations live in moveFx.js. Nothing here touches game state.
import { W } from './CanvasRenderer.js';

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
