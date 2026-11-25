// A bucket grid over world points, so "what is near the player" never scans every pickup or interactable of a
// 480x480-tile island. Works unbounded too (the open test field has negative coordinates). Buckets keep
// insertion order and are visited in a fixed order, so queries are deterministic.

const OFFSET = 32768;

export class SpatialHash {
  /** @param {number} cell bucket side in world px */
  constructor(cell) {
    if (!(cell > 0)) throw new Error('SpatialHash: cell must be > 0');
    this.cell = cell;
    /** @type {Map<number, Object[]>} */
    this.buckets = new Map();
  }

  key(x, y) {
    return (Math.floor(x / this.cell) + OFFSET) * 65536 + (Math.floor(y / this.cell) + OFFSET);
  }

  /** @param {{x:number,y:number}} obj */
  insert(obj) {
    const k = this.key(obj.x, obj.y);
    let b = this.buckets.get(k);
    if (!b) this.buckets.set(k, (b = []));
    b.push(obj);
  }

  /** @returns {boolean} it was there (looked up at its current x, y) */
  remove(obj) {
    const k = this.key(obj.x, obj.y);
    const b = this.buckets.get(k);
    const i = b ? b.indexOf(obj) : -1;
    if (i < 0) return false;
    b.splice(i, 1);
    if (b.length === 0) this.buckets.delete(k);
    return true;
  }

  /** move an object already in the grid */
  move(obj, x, y) {
    this.remove(obj);
    obj.x = x;
    obj.y = y;
    this.insert(obj);
  }

  /**
   * Objects whose point lies in [x0, x1] x [y0, y1].
   * @param {Object[]} [out] cleared and filled
   */
  inRect(x0, y0, x1, y1, out = []) {
    out.length = 0;
    const c = this.cell;
    const cx0 = Math.floor(x0 / c);
    const cx1 = Math.floor(x1 / c);
    const cy0 = Math.floor(y0 / c);
    const cy1 = Math.floor(y1 / c);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const b = this.buckets.get((cx + OFFSET) * 65536 + (cy + OFFSET));
        if (!b) continue;
        for (const o of b) if (o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1) out.push(o);
      }
    }
    return out;
  }

  /**
   * Objects whose point lies within `r` of (x, y).
   * @param {Object[]} [out] cleared and filled
   */
  near(x, y, r, out = []) {
    this.inRect(x - r, y - r, x + r, y + r, out);
    const r2 = r * r;
    let k = 0;
    for (const o of out) {
      const dx = o.x - x;
      const dy = o.y - y;
      if (dx * dx + dy * dy <= r2) out[k++] = o;
    }
    out.length = k;
    return out;
  }

  /** every object, bucket by bucket (debug and tests) */
  all() {
    const out = [];
    for (const b of this.buckets.values()) out.push(...b);
    return out;
  }
}
