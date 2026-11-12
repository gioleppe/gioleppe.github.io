// Loads the JSON data layer and the sprite sheets exported from Aseprite.
import { DATA_FILES, assembleData } from '../core/data.js';

const json = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); });
const image = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`image ${url}`)); i.src = url; });

export async function loadAll(onProgress = () => {}) {
  const raw = {};
  await Promise.all(DATA_FILES.map(async (f) => { raw[f] = await json(`data/${f}.json`).catch((e) => { if (f === 'manifest' || f === 'tiles' || f === 'rules') throw e; return undefined; }); }));
  raw.zones = await Promise.all(raw.manifest.zones.map((z) => json(`data/zones/${z}.json`)));
  const data = assembleData(raw);

  const atlas = await json('assets/export/atlas.json');
  const files = { tiles: 'tiles.png' };
  for (const [n, f] of Object.entries(atlas.chars)) files[`char:${n}`] = f;
  for (const [n, pr] of Object.entries(atlas.props || {})) files[`prop:${n}`] = pr.file;
  for (const [n, f] of Object.entries(atlas.creatures || {})) files[`mon:${n}`] = f;
  for (const [n, f] of Object.entries(atlas.portraits || {})) files[`portrait:${n}`] = f;
  for (const [n, f] of Object.entries(atlas.sheets || {})) files[n] = f;
  const images = {};
  const names = Object.keys(files);
  let done = 0;
  await Promise.all(names.map(async (n) => { images[n] = await image(`assets/export/${files[n]}`); onProgress(++done / names.length); }));
  return { data, atlas, images };
}
