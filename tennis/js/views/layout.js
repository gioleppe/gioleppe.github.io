/**
 * layout.js - pure (DOM-free, D3-free) layout helpers shared by the Phase 3 views.
 *
 * Like scales.js this module never imports D3 so that every helper stays importable
 * from `node --test` (tests/views_layout.test.js): the Sugiyama bar/ribbon geometry of
 * View 2 (`computeDagLayout`), greedy word wrapping for node labels (`wrapWords`), the
 * one-pass vertical label de-collision (`resolveLabelCollisions`) and the greedy legend
 * row packing of View 3 (`packLegendRows`).
 *
 * @module views/layout
 */

/**
 * View 2 geometry in SVG user units (guideline section 4.2: layer x at 0.08W, 0.50W, 0.92W).
 * @type {Readonly<{ W: number, H: number, LAYER_X: readonly number[], BAR_W: number, GAP: number,
 *   MIN_H: number, FILL_FRACTION: number, TOP: number, BOTTOM: number, ALPHA: number }>}
 */
export const DAG_GEOMETRY = Object.freeze({
  /** SVG viewBox width. */
  W: 1000,
  /** SVG viewBox height (close to the 7-column panel's aspect at 1920x1080). */
  H: 480,
  /** Fixed layer x centres: 0.08W, 0.50W, 0.92W. */
  LAYER_X: Object.freeze([80, 500, 920]),
  /** Node bar width. */
  BAR_W: 18,
  /** Vertical gap between stacked nodes. */
  GAP: 8,
  /** Minimum bar height so that empty nodes keep a visible anchor. */
  MIN_H: 2,
  /** The layer with the largest total fills this fraction of H. */
  FILL_FRACTION: 0.8,
  /** Top of the drawing region (below the layer titles). */
  TOP: 46,
  /** Bottom of the drawing region (above the legend). */
  BOTTOM: 440,
  /** Bezier curvature parameter alpha (control points at x + alpha * dx). */
  ALPHA: 0.5,
});

/**
 * Round to two decimals for compact path strings.
 * @param {number} v
 * @returns {number}
 */
export function r2(v) {
  return Math.round(v * 100) / 100;
}

/**
 * Horizontal cubic Bezier path from (sx, sy) to (tx, ty) with control points at
 * x + alpha * dx (identical geometry to d3.linkHorizontal()).
 * @param {number} sx
 * @param {number} sy
 * @param {number} tx
 * @param {number} ty
 * @param {number} [alpha=DAG_GEOMETRY.ALPHA]
 * @returns {string} SVG path data
 */
export function ribbonPath(sx, sy, tx, ty, alpha = DAG_GEOMETRY.ALPHA) {
  const mx = sx + alpha * (tx - sx);
  return `M${r2(sx)},${r2(sy)}C${r2(mx)},${r2(sy)} ${r2(mx)},${r2(ty)} ${r2(tx)},${r2(ty)}`;
}

/**
 * @typedef {object} NodeLayout
 * @property {string} id
 * @property {1|2|3} layer
 * @property {string} label
 * @property {number} n
 * @property {number} wins
 * @property {number} smoothedRate
 * @property {number} share
 * @property {number} nActive
 * @property {number} order
 * @property {boolean} selected
 * @property {boolean} aggregated
 * @property {readonly string[]} members
 * @property {number} x        left edge of the bar
 * @property {number} y        top of the bar
 * @property {number} h        bar height
 * @property {number} cx       bar centre x
 * @property {number} cy       bar centre y
 * @property {number} labelY   label block centre y (defaults to cy; moved by resolveLabelCollisions)
 * @property {number} pitch    distance (px) to the nearest neighbour's centre in the layer (Infinity when alone)
 */

/**
 * @typedef {object} LinkLayout
 * @property {string} key           source + ">" + target
 * @property {string} source
 * @property {string} target
 * @property {"12"|"23"} layerPair
 * @property {number} n
 * @property {number} wins
 * @property {number} smoothedRate
 * @property {number} share
 * @property {number} nActive
 * @property {number} winsActive
 * @property {boolean} pruned
 * @property {boolean} emphasized
 * @property {number} width         px-per-point * n
 * @property {number} widthActive   px-per-point * nActive
 * @property {number} sx            source bar right edge
 * @property {number} tx            target bar left edge
 * @property {number} sy0           slot start y on the source bar
 * @property {number} ty0           slot start y on the target bar
 * @property {string} d             context path (slot centre to slot centre)
 * @property {string} dActive       overlay path (aligned to the slot start, width widthActive)
 * @property {NodeLayout} sourceNode
 * @property {NodeLayout} targetNode
 */

/**
 * Compute the Sugiyama layout for a dag view model: bar geometry per node (one shared
 * px-per-point scale across the three layers, each layer vertically centred) and ribbon
 * slots per link (allocated in link order sorted by the other endpoint's order to minimise
 * crossings).
 *
 * @param {{ n: number, nodes: readonly object[], links: readonly object[] }} dag
 * @param {typeof DAG_GEOMETRY} [geometry=DAG_GEOMETRY]
 * @returns {{ nodes: NodeLayout[], links: LinkLayout[], byId: Map<string, NodeLayout>, pxPerPoint: number }}
 */
export function computeDagLayout(dag, geometry = DAG_GEOMETRY) {
  const { H, LAYER_X, BAR_W, GAP, MIN_H, FILL_FRACTION, TOP, BOTTOM, ALPHA } = geometry;
  const layers = [[], [], []];
  for (const node of dag.nodes) {
    if (node.layer >= 1 && node.layer <= 3) layers[node.layer - 1].push(node);
  }
  for (const layer of layers) {
    layer.sort((a, b) => (a.order - b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  // One px-per-point scale: the layer that would need the most room fills FILL_FRACTION of H.
  let pxPerPoint = Infinity;
  for (const layer of layers) {
    const total = layer.reduce((acc, nd) => acc + nd.n, 0);
    if (total <= 0) continue;
    const available = FILL_FRACTION * H - Math.max(0, layer.length - 1) * GAP;
    pxPerPoint = Math.min(pxPerPoint, Math.max(0, available) / total);
  }
  if (!Number.isFinite(pxPerPoint)) pxPerPoint = 0;

  /** @type {NodeLayout[]} */
  const nodes = [];
  const byId = new Map();
  layers.forEach((layer, li) => {
    const heights = layer.map((nd) => (nd.n > 0 ? Math.max(nd.n * pxPerPoint, MIN_H) : MIN_H));
    const stackHeight = heights.reduce((a, h) => a + h, 0) + Math.max(0, layer.length - 1) * GAP;
    let y = TOP + ((BOTTOM - TOP) - stackHeight) / 2;
    const cx = LAYER_X[li];
    layer.forEach((nd, i) => {
      const h = heights[i];
      /** @type {NodeLayout} */
      const item = {
        id: nd.id,
        layer: nd.layer,
        label: nd.label,
        n: nd.n,
        wins: nd.wins,
        smoothedRate: nd.smoothedRate,
        share: nd.share,
        nActive: nd.nActive,
        order: nd.order,
        selected: nd.selected === true,
        aggregated: nd.aggregated === true,
        members: Array.isArray(nd.members) ? nd.members : [],
        x: cx - BAR_W / 2,
        y,
        h,
        cx,
        cy: y + h / 2,
        labelY: y + h / 2,
        pitch: Infinity,
      };
      nodes.push(item);
      byId.set(item.id, item);
      y += h + GAP;
    });
    // Label room: distance to the nearest neighbouring label centre within the layer.
    for (let i = 0; i < layer.length; i += 1) {
      const cur = byId.get(layer[i].id);
      const prev = i > 0 ? byId.get(layer[i - 1].id) : null;
      const next = i + 1 < layer.length ? byId.get(layer[i + 1].id) : null;
      const gapTo = (other) => (other ? Math.abs(other.cy - cur.cy) : Infinity);
      cur.pitch = Math.min(gapTo(prev), gapTo(next));
    }
  });

  // Ribbon slots: outgoing links of a node sorted by target order, incoming by source order.
  const outgoing = new Map();
  const incoming = new Map();
  const valid = dag.links.filter((l) => byId.has(l.source) && byId.has(l.target));
  for (const l of valid) {
    if (!outgoing.has(l.source)) outgoing.set(l.source, []);
    if (!incoming.has(l.target)) incoming.set(l.target, []);
    outgoing.get(l.source).push(l);
    incoming.get(l.target).push(l);
  }
  const slotStart = new Map(); // key -> { sy0, ty0 }
  for (const [id, list] of outgoing) {
    list.sort((a, b) => byId.get(a.target).order - byId.get(b.target).order);
    let offset = byId.get(id).y;
    for (const l of list) {
      slotStart.set(`${l.source}>${l.target}`, { sy0: offset, ty0: 0 });
      offset += l.n * pxPerPoint;
    }
  }
  for (const [id, list] of incoming) {
    list.sort((a, b) => byId.get(a.source).order - byId.get(b.source).order);
    let offset = byId.get(id).y;
    for (const l of list) {
      slotStart.get(`${l.source}>${l.target}`).ty0 = offset;
      offset += l.n * pxPerPoint;
    }
  }

  /** @type {LinkLayout[]} */
  const links = valid.map((l) => {
    const key = `${l.source}>${l.target}`;
    const sourceNode = byId.get(l.source);
    const targetNode = byId.get(l.target);
    const { sy0, ty0 } = slotStart.get(key);
    const width = l.n * pxPerPoint;
    const widthActive = l.nActive * pxPerPoint;
    const sx = sourceNode.cx + BAR_W / 2;
    const tx = targetNode.cx - BAR_W / 2;
    return {
      key,
      source: l.source,
      target: l.target,
      layerPair: l.layerPair,
      n: l.n,
      wins: l.wins,
      smoothedRate: l.smoothedRate,
      share: l.share,
      nActive: l.nActive,
      winsActive: l.winsActive,
      pruned: l.pruned === true,
      emphasized: l.emphasized === true,
      width,
      widthActive,
      sx,
      tx,
      sy0,
      ty0,
      d: ribbonPath(sx, sy0 + width / 2, tx, ty0 + width / 2, ALPHA),
      dActive: ribbonPath(sx, sy0 + widthActive / 2, tx, ty0 + widthActive / 2, ALPHA),
      sourceNode,
      targetNode,
    };
  });

  return { nodes, links, byId, pxPerPoint };
}

/**
 * Greedy word wrap: packs whitespace-separated words into lines no wider than `maxWidth`
 * according to `widthOf(text)`. A single word wider than the limit gets its own line.
 * @param {string} text
 * @param {number} maxWidth
 * @param {(text: string) => number} widthOf
 * @returns {string[]} at least one line
 */
export function wrapWords(text, maxWidth, widthOf) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || widthOf(candidate) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/**
 * One-pass vertical label de-collision (guideline section 9: node labels legible at all
 * filter states). Each item is a label block centred at `y` with height `h`; blocks are
 * pushed apart (forward pass), pulled back inside [lo, hi] (backward pass) and finally
 * re-separated from the top, so that no two blocks overlap unless their total height
 * exceeds the range. Input order is preserved in the result.
 * @param {ReadonlyArray<{ y: number, h: number }>} items
 * @param {number} lo   minimum allowed top edge
 * @param {number} hi   maximum allowed bottom edge
 * @param {number} [gap=2] minimum vertical gap between blocks
 * @returns {number[]} resolved centre y per item (same order as `items`)
 */
export function resolveLabelCollisions(items, lo, hi, gap = 2) {
  const n = items.length;
  if (n === 0) return [];
  const order = items.map((_, i) => i).sort((a, b) => (items[a].y - items[b].y) || (a - b));
  const y = order.map((i) => items[i].y);
  const h = order.map((i) => Math.max(0, items[i].h));
  for (let k = 1; k < n; k += 1) y[k] = Math.max(y[k], y[k - 1] + (h[k - 1] + h[k]) / 2 + gap);
  const last = n - 1;
  y[last] = Math.min(y[last], hi - h[last] / 2);
  for (let k = last - 1; k >= 0; k -= 1) y[k] = Math.min(y[k], y[k + 1] - (h[k] + h[k + 1]) / 2 - gap);
  y[0] = Math.max(y[0], lo + h[0] / 2);
  for (let k = 1; k < n; k += 1) y[k] = Math.max(y[k], y[k - 1] + (h[k - 1] + h[k]) / 2 + gap);
  const out = new Array(n);
  order.forEach((i, k) => { out[i] = y[k]; });
  return out;
}

/**
 * Greedy row packing of legend items: items keep their order, a new row starts when
 * the next item would exceed `maxWidth`.
 * @param {number[]} widths
 * @param {number} maxWidth
 * @param {number} gap
 * @returns {number[][]} rows of item indices
 */
export function packLegendRows(widths, maxWidth, gap) {
  const rows = [];
  let row = [];
  let used = 0;
  widths.forEach((w, i) => {
    const next = row.length ? used + gap + w : w;
    if (row.length && next > maxWidth) {
      rows.push(row);
      row = [i];
      used = w;
    } else {
      row.push(i);
      used = next;
    }
  });
  if (row.length) rows.push(row);
  return rows;
}
