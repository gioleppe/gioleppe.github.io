// 5x7 bitmap font drawn pixel by pixel (no browser text rendering, so it stays crisp at any scale).
// Classic public-domain 5x7 column font, ASCII 32..126, 5 column bytes per glyph, bit 0 = top row.
const F = '0000000000,00005F0000,0007000700,147F147F14,242A7F2A12,2313086462,3649552250,0005030000,001C224100,0041221C00,14083E0814,08083E0808,0050300000,0808080808,0060600000,2010080402,3E5149453E,00427F4000,4261514946,2141454B31,1814127F10,2745454539,3C4A494930,0171090503,3649494936,064949291E,0036360000,0056360000,0814224100,1414141414,0041221408,0201510906,324979413E,7E1111117E,7F49494936,3E41414122,7F4141221C,7F49494941,7F09090901,3E4149497A,7F0808087F,00417F4100,2040413F01,7F08142241,7F40404040,7F020C027F,7F0408107F,3E4141413E,7F09090906,3E4151215E,7F09192946,4649494931,01017F0101,3F4040403F,1F2040201F,3F4038403F,6314081463,0708700807,6151494543,007F414100,0204081020,0041417F00,0402010204,4040404040,0001020400,2054545478,7F48444438,3844444420,384444487F,3854545418,087E090102,0C5252523E,7F08040478,00447D4000,2040443D00,7F10284400,00417F4000,7C04180478,7C08040478,3844444438,7C14141408,081414187C,7C08040408,4854545420,043F444020,3C4040207C,1C2040201C,3C4030403C,4428102844,0C5050503C,4464544C44,0008364100,00007F0000,0041360800,0804081008'.replace(/ /g, '').split(',');

const DESCENDERS = { p: [0xFC, 0x24, 0x24, 0x24, 0x18], q: [0x18, 0x24, 0x24, 0x24, 0xFC], g: [0x18, 0xA4, 0xA4, 0xA4, 0x7C], y: [0x1C, 0xA0, 0xA0, 0xA0, 0x7C], j: [0x40, 0x80, 0x84, 0x7D, 0x00] };
const GLYPHS = F.map((h, i) => {
  let cols = [];
  for (let c = 0; c < 5; c++) cols.push(parseInt(h.substr(c * 2, 2), 16) || 0);
  const desc = DESCENDERS[String.fromCharCode(32 + i)];   // lower-case letters with real descenders (row 7)
  if (desc) cols = desc.slice();
  if (i === 0) return { cols: [0, 0, 0], w: 3 };
  while (cols.length && cols[0] === 0) cols.shift();
  while (cols.length && cols[cols.length - 1] === 0) cols.pop();
  return { cols, w: cols.length };
});

// Accented lower-case letters (Italian: a e i o u). The 5x7 letters sit in rows 2-6, so rows 0-1 are free for the
// accent. Capitals fill all seven rows: write E' for the capital accented E, as plain Italian type always did.
const ACCENTED = { 'à': ['a', 'g'], 'è': ['e', 'g'], 'é': ['e', 'a'], 'ì': ['i', 'g'], 'ò': ['o', 'g'], 'ù': ['u', 'g'] };
const ACCENT_CHARS = Object.keys(ACCENTED);
ACCENT_CHARS.forEach((ch) => {
  const [base, kind] = ACCENTED[ch];
  const bytes = []; const h = F[base.charCodeAt(0) - 32];
  for (let c = 0; c < 5; c++) bytes.push(parseInt(h.substr(c * 2, 2), 16) || 0);
  if (base === 'i') bytes[2] &= ~1;                       // the dot gives way to the accent
  if (kind === 'g') { bytes[1] |= 1; bytes[2] |= 2; } else { bytes[3] |= 1; bytes[2] |= 2; }
  const cols = bytes.slice();
  while (cols.length && cols[0] === 0) cols.shift();
  while (cols.length && cols[cols.length - 1] === 0) cols.pop();
  GLYPHS.push({ cols, w: cols.length });
});
/** the glyph index of a character: ASCII 32..126, then the accented letters, else '?' */
const gindex = (ch) => { const c = ch.charCodeAt(0); if (c >= 32 && c < 127) return c - 32; const k = ACCENT_CHARS.indexOf(ch); return k >= 0 ? 95 + k : 31; };
export const LINE_H = 10;
/** Test hook: when log is an array, every drawText call records { text, x, y, w, h } (after alignment). */
export const textProbe = { log: null };
const atlases = new Map();

function atlas(color) {
  let a = atlases.get(color);
  if (a) return a;
  a = document.createElement('canvas'); a.width = GLYPHS.length * 6; a.height = 8;
  const g = a.getContext('2d'); g.fillStyle = color;
  GLYPHS.forEach((gl, i) => gl.cols.forEach((bits, x) => { for (let y = 0; y < 8; y++) if (bits & (1 << y)) g.fillRect(i * 6 + x, y, 1, 1); }));
  atlases.set(color, a);
  return a;
}
const glyphOf = (ch) => GLYPHS[gindex(ch)];

export function textWidth(text) {
  let w = 0;
  for (const ch of String(text)) w += glyphOf(ch).w + 1;
  return Math.max(0, w - 1);
}

/** opts: { color, shadow, align: 'left'|'center'|'right', scramble: 0..1, t, runs: [{ from, to, color }] }
 *  runs colour parts of the text (key terms, see glossary.js); the shadow stays one colour */
export function drawText(g, text, x, y, opts = {}) {
  text = String(text);
  const color = opts.color || '#FFFFFF';
  if (opts.align === 'center') x -= Math.floor(textWidth(text) / 2);
  else if (opts.align === 'right') x -= textWidth(text);
  x = Math.round(x); y = Math.round(y);
  if (textProbe.log && text.trim()) textProbe.log.push({ text, x, y, w: textWidth(text), h: 8 });
  const passes = opts.shadow ? [[opts.shadow, 1, 1], [color, 0, 0]] : [[color, 0, 0]];
  for (const [col, ox, oy] of passes) {
    const a = atlas(col), main = col === color && ox === 0;
    let cx = x, run = 0;
    for (let i = 0; i < text.length; i++) {
      let a2 = a;
      if (main && opts.runs?.length) {
        while (run < opts.runs.length && opts.runs[run].to <= i) run++;
        const r = opts.runs[run];
        if (r && i >= r.from) a2 = atlas(r.color);
      }
      let ch = text[i];
      if (opts.scramble && ch !== ' ' && ((i * 7919 + Math.floor((opts.t || 0) * 6)) % 100) < opts.scramble * 100) ch = String.fromCharCode(33 + ((i * 31 + Math.floor((opts.t || 0) * 9)) % 90));
      const idx = gindex(ch), gl = GLYPHS[idx];
      if (gl.w && idx > 0) g.drawImage(a2, idx * 6, 0, gl.w, 8, cx + ox, y + oy, gl.w, 8);
      cx += gl.w + 1;
    }
  }
  return x + textWidth(text);
}

export function wrap(text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (textWidth(t) > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}
