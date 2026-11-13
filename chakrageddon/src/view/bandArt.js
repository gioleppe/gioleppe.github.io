// The Wristbands of Enlightenment in fake 3D (1.2.2): each band is a ring of thin vertical strips seen a little from
// above, turning slowly. Strips at the back show the inside of the band (darker) and are drawn first; the light comes
// from the upper left. Every band has its own material: twisted hemp, quartz beads, a keyring with charms, a cheese
// stamp, glowing bones, a press pass, a smudge of ash, a hologram. One you have not earned yet is a dark silhouette.

const TAU = Math.PI * 2;
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const shade = (c, k) => `rgb(${hex(c).map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(',')})`;
const hsl = (h, s, l) => `hsl(${Math.round(h) % 360},${s}%,${l}%)`;

/** the colour of a band's surface at u (0..1 round the band) and v (0..1 across it), before light */
const MATERIAL = {
  hemp_string: (u, v) => ((Math.floor(u * 40 + v * 4) % 3) === 0 ? '#8A6A32' : (Math.floor(u * 40 + v * 4) % 3) === 1 ? '#C9A45A' : '#E0C27A'),   // three twisted strands
  quartz: (u, v) => { const b = (u * 18) % 1, r = Math.hypot(b - 0.5, v - 0.5); return r < 0.22 ? '#FFE4F0' : r < 0.42 ? '#F2A6C8' : '#7A4A6A'; },   // round beads on a cord
  wonky_keychain: (u, v) => (v > 0.3 && v < 0.7 ? ((u * 30) % 1 < 0.5 ? '#C8D0DC' : '#8E939C') : '#5A5F6A'),                   // a steel split ring
  extra_cheese: (u, v) => { const h = ((u * 12) % 1 - 0.5) ** 2 + ((v - 0.5 + 0.2 * Math.sin(u * 37)) ** 2); return h < 0.03 ? '#E8A33A' : '#FFD84A'; },   // holes
  uv_skeleton: (u, v) => { const s = (u * 10) % 1; return (Math.abs(v - 0.5) < 0.12 && s > 0.2 && s < 0.8) || ((s < 0.2 || s > 0.8) && Math.abs(v - 0.5) < 0.3) ? '#C8FFE0' : '#14101E'; },   // little bones
  vip_press: (u, v) => (Math.abs(v - 0.5) < 0.12 ? '#FFE066' : '#FF4FA8'),                                                     // a lanyard with a stripe
  ash_mark: (u, v) => { const n = Math.sin(u * 53) * Math.sin(v * 9 + u * 21); return n > 0.3 ? '#E8E4DC' : n > -0.2 ? '#A8AEB6' : '#6C727C'; },   // smudged
  all_access: (u, v, t) => hsl(u * 360 + t * 90 + v * 40, 85, 62),                                                            // a hologram
};
/** the thin and the wide ones */
const HEIGHT = { hemp_string: 8, quartz: 9, wonky_keychain: 5, extra_cheese: 11, uv_skeleton: 10, vip_press: 9, ash_mark: 12, all_access: 10 };

/** draw band `id` turning round its own axis, centred at (cx, cy); owned: in colour; else a silhouette */
export function drawBand(g, id, cx, cy, t, { owned = true, still = false, R = 30, tilt = 0.32 } = {}) {
  const N = 72, H = HEIGHT[id] || 9, rot = still ? 0.6 : t * 0.9, mat = MATERIAL[id] || (() => '#C8C0B0');
  // a soft glow behind it (a little brighter for the hologram and the bones)
  g.globalAlpha = owned ? 0.18 : 0.08; g.fillStyle = owned ? (id === 'uv_skeleton' ? '#4FE88A' : id === 'all_access' ? '#C86BFF' : '#FFE066') : '#6C5A8A';
  g.beginPath(); g.ellipse(cx, cy, R + 12, R * tilt + 14, 0, 0, TAU); g.fill(); g.globalAlpha = 1;
  const strips = [];
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * TAU + rot, a1 = ((k + 1) / N) * TAU + rot;
    const x0 = cx + R * Math.cos(a0), x1 = cx + R * Math.cos(a1), y = cy + R * Math.sin((a0 + a1) / 2) * tilt;
    const z = Math.sin((a0 + a1) / 2);                       // > 0: the front, towards you
    const nx = Math.cos((a0 + a1) / 2);
    strips.push({ k, x: Math.round(Math.min(x0, x1)), w: Math.max(1, Math.round(Math.abs(x1 - x0)) + 1), y, z, light: z > 0 ? 0.62 + 0.38 * Math.max(0, z * 0.8 - nx * 0.5) : 0.42 + 0.12 * -z });
  }
  strips.sort((a, b) => a.z - b.z);
  for (const s of strips) {
    const top = Math.round(s.y - H / 2);
    for (let r = 0; r < H; r++) {
      const v = r / (H - 1);
      let c = owned ? mat(s.k / N, v, t) : '#3A2A4A';
      const edge = r === 0 || r === H - 1 ? 0.75 : 1;        // the rims, a touch darker
      g.fillStyle = shade(c.startsWith('#') ? c : hslToHex(c), s.light * edge);
      g.fillRect(s.x, top + r, s.w, 1);
    }
  }
  // what hangs off it, on the front half: Keta's charms; the press pass card
  if (owned && id === 'wonky_keychain') charms(g, cx, cy, R, tilt, rot, t, still);
  if (owned && id === 'vip_press') card(g, cx, cy, R, tilt, rot);
  if (!owned) drawQuestion(g, cx, cy - 2);
}

/** a rubber duck, a bottle opener and a key, swinging a little */
function charms(g, cx, cy, R, tilt, rot, t, still) {
  [[0.6, '#FFD23F', 'duck'], [2.4, '#C8D0DC', 'opener'], [4.4, '#E8C468', 'key']].forEach(([a, c, kind]) => {
    const ang = a + rot, z = Math.sin(ang);
    if (z < -0.2) return;
    const x = Math.round(cx + R * Math.cos(ang)), y = Math.round(cy + R * Math.sin(ang) * tilt) - 2, sw = still ? 0 : Math.round(Math.sin(t * 3 + a) * 1);
    g.fillStyle = '#5A5F6A'; g.fillRect(x, y, 1, 4);
    g.fillStyle = c;
    if (kind === 'duck') { g.fillRect(x - 3 + sw, y + 4, 6, 4); g.fillRect(x - 1 + sw, y + 2, 3, 3); g.fillStyle = '#FF9A2A'; g.fillRect(x + 2 + sw, y + 3, 2, 1); }
    else if (kind === 'opener') { g.fillRect(x - 1 + sw, y + 4, 3, 7); g.fillStyle = '#5A5F6A'; g.fillRect(x + sw, y + 9, 1, 1); }
    else { g.fillRect(x - 2 + sw, y + 4, 4, 3); g.fillRect(x + sw, y + 7, 1, 5); g.fillRect(x + 1 + sw, y + 10, 2, 1); }
  });
}
/** the laminated card on the lanyard, when it comes round to the front */
function card(g, cx, cy, R, tilt, rot) {
  const ang = 1.57 + rot, z = Math.sin(ang);
  if (z < 0.1) return;
  const x = Math.round(cx + R * Math.cos(ang)), y = Math.round(cy + R * Math.sin(ang) * tilt - 4), w = Math.max(2, Math.round(12 * z));   // clipped on the band
  g.fillStyle = '#14101E'; g.fillRect(x - Math.floor(w / 2) - 1, y - 1, w + 2, 15);
  g.fillStyle = '#F4F0E8'; g.fillRect(x - Math.floor(w / 2), y, w, 13);
  if (w > 6) { g.fillStyle = '#FF4FA8'; g.fillRect(x - Math.floor(w / 2) + 1, y + 2, w - 2, 3); g.fillStyle = '#2A1A2E'; g.fillRect(x - Math.floor(w / 2) + 1, y + 7, w - 3, 1); g.fillRect(x - Math.floor(w / 2) + 1, y + 9, w - 5, 1); }
}
/** a big pixel question mark, for a band still to earn */
function drawQuestion(g, x, y) {
  g.fillStyle = '#C8C0E0';
  for (const [dx, dy, w, h] of [[-3, -6, 6, 2], [2, -5, 2, 4], [-1, -2, 3, 2], [-1, 0, 2, 2], [-1, 3, 2, 2]]) g.fillRect(x + dx, y + dy, w, h);
}
/** hsl() to #rrggbb (the hologram's colours, so shade() can darken them) */
function hslToHex(c) {
  const [h, s, l] = c.match(/[\d.]+/g).map(Number), S = s / 100, Lr = l / 100;
  const f = (n) => { const k = (n + h / 30) % 12, a = S * Math.min(Lr, 1 - Lr); return Math.round(255 * (Lr - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
