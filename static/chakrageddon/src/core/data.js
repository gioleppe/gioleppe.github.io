// Data layer contract. The view (fetch) and the tests (fs) both load the files listed here and
// hand the parsed JSON to assembleData(), so the core never does any I/O itself.
export const DATA_FILES = ['rules', 'tiles', 'type_chart', 'dex', 'moves', 'items', 'trainers', 'dialogues', 'manifest', 'highlines'];

const byId = (arr, key = 'id') => Object.fromEntries((arr || []).map((x) => [x[key], x]));

/** raw: { rules, tiles, type_chart, dex, moves, items, trainers, dialogues, manifest, zones: [zoneJson...] } */
export function assembleData(raw) {
  return {
    rules: raw.rules || {},
    legend: raw.tiles?.legend || {},
    typeChart: raw.type_chart || { types: [], chart: {} },
    dex: byId(raw.dex),
    dexList: raw.dex || [],
    moves: byId(raw.moves),
    items: byId(raw.items),
    trainers: byId(raw.trainers),
    dialogues: raw.dialogues || {},
    highlines: raw.highlines || { lines: {}, hints: {} },   // what people say when you are high, and hints about high-only Astrals
    manifest: raw.manifest || {},
    zones: byId(raw.zones, 'zoneId'),
  };
}
