// Small animation helpers shared by the screens: tinted copies of sprite frames (white silhouettes for
// evolutions, red when hurt, grey when fainting), cached per image, frame and colour.
const cache = new Map();

/** a copy of one frame of img filled with colour (alpha > 0 blends it over the original pixels) */
export function tinted(img, sx, sy, sw, sh, color, alpha = 1) {
  const key = `${img.src || img.id || ''}|${sx},${sy},${sw},${sh}|${color}|${alpha}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas'); c.width = sw; c.height = sh;
  const x = c.getContext('2d');
  x.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  x.globalCompositeOperation = 'source-atop'; x.globalAlpha = alpha; x.fillStyle = color; x.fillRect(0, 0, sw, sh);
  cache.set(key, c);
  return c;
}

/** a small stable hash, so each NPC fidgets on its own schedule */
export function hashOf(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
