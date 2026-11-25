// Short on-screen notices ("Took the crowbar", "No room: the tarp stays here"): a small queue of lines that fade
// out, drawn on #ui above the hotbar. Reusable: any step turns its simulation events into notices by registering
// a formatter for the event type,
//
//   registerNotice('site_inspected', (e, sim) => 'You look around the camp.');   // text, { text, color }, or null
//
// then the page feeds every step's events in with `notices.fromEvents(sim.events, sim)` (after every step, since
// the next step replaces the list). Presentation only: reads the simulation, never writes it.

/** palette colours (assets/src/palette.gpl) */
export const NOTICE_COLORS = Object.freeze({ text: '#e9e2cf', warn: '#f2a33a', dim: '#8f8789', ink: '#0d0b12' });

/** @type {Map<string, (event: Object, sim: Object) => (string|{text:string,color?:string}|null)>} */
const FORMATTERS = new Map();

/**
 * Turn an event type into a notice.
 * @param {string} type sim event type
 * @param {(event: Object, sim: Object) => (string|{text:string,color?:string}|null)} format null shows nothing
 */
export function registerNotice(type, format) {
  if (typeof format !== 'function') throw new TypeError(`registerNotice ${type}: a formatter function is required`);
  FORMATTERS.set(type, format);
}

/** @returns {string|{text:string,color?:string}|null} what an event would show (for tests) */
export function noticeFor(event, sim) {
  const f = FORMATTERS.get(event?.type);
  return f ? f(event, sim) : null;
}

export class Notices {
  /**
   * @param {{ max?: number, seconds?: number, fade?: number }} [opts] lines kept, seconds shown, of which the last `fade` fade out
   */
  constructor({ max = 4, seconds = 2.6, fade = 0.7 } = {}) {
    this.max = max;
    this.seconds = seconds;
    this.fade = fade;
    /** @type {Array<{ text: string, color: string, born: number, key: string|null }>} oldest first */
    this.lines = [];
  }

  /**
   * Show a line. A line with the same `key` as a live one replaces it instead of stacking (repeated "full").
   * @param {string} text
   * @param {{ color?: string, key?: string|null, now?: number }} [opts] now in ms
   */
  push(text, { color = NOTICE_COLORS.text, key = null, now = clock() } = {}) {
    if (!text) return;
    const k = key ?? text;
    this.lines = this.lines.filter((l) => l.key !== k);
    this.lines.push({ text, color, born: now, key: k });
    while (this.lines.length > this.max) this.lines.shift();
  }

  /** push a notice for every event that has a formatter */
  fromEvents(events, sim, now = clock()) {
    for (const e of events) {
      const n = noticeFor(e, sim);
      if (!n) continue;
      if (typeof n === 'string') this.push(n, { now });
      else this.push(n.text, { color: n.color, key: n.key, now });
    }
  }

  /** @returns {Array<{ text: string, color: string, alpha: number }>} the lines still showing at `now` (ms) */
  visible(now = clock()) {
    this.lines = this.lines.filter((l) => now - l.born < this.seconds * 1000);
    return this.lines.map((l) => {
      const left = this.seconds - (now - l.born) / 1000;
      return { text: l.text, color: l.color, alpha: Math.max(0, Math.min(1, left / this.fade)) };
    });
  }

  /**
   * Draw the live lines centred on `cx`, the newest at the bottom resting on `bottom`.
   * @param {CanvasRenderingContext2D} ctx #ui context in logical pixels
   */
  draw(ctx, cx, bottom, now = clock()) {
    const lines = this.visible(now);
    if (!lines.length) return;
    ctx.save();
    ctx.font = '6px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const lh = 8;
    lines.forEach((l, i) => {
      const y = Math.round(bottom - (lines.length - 1 - i) * lh);
      const w = Math.ceil(ctx.measureText(l.text).width) + 6;
      ctx.globalAlpha = l.alpha * 0.7;
      ctx.fillStyle = NOTICE_COLORS.ink;
      ctx.fillRect(Math.round(cx - w / 2), y - lh + 1, w, lh - 1);
      ctx.globalAlpha = l.alpha;
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, Math.round(cx), y);
    });
    ctx.restore();
  }
}

function clock() {
  return globalThis.performance ? globalThis.performance.now() : 0;
}
