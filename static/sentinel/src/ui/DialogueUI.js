// The dialogue box (spec §7.1, §9 ui/DialogueUI.js): bottom of #ui, in logical pixels. Reads the conversation
// from `sim.dialogue.current()` and answers only through input: `interact` to advance, hotbar slot n to pick
// choice n (InputCore.trigger / selectHotbar), so a conversation replays from the recorded tick input.
//
// Presentation-only state: the typewriter (the first press completes the line, the second advances), the
// choice cursor, and "a press was sent, wait for the sim" (so a fast double press never skips a line).
// While the box is open it owns the keyboard and pointers (InputCore.setModal): the touch joystick and buttons
// are hidden and inert, movement keys do nothing, and the key that closes the box never reaches the game.
//
// Keys: E / Enter / Space advance or confirm; arrows or W/S move the cursor; 1-4 pick; Esc picks the node's
// exit choice (leave or go back) or closes a closing line. Mouse: click a choice, click the box to advance.
// Touch: tap a choice (rows are at least tuning.dialogue.touchChoiceRowCss CSS pixels tall), tap the box.

/** palette (assets/src/palette.gpl) */
export const DIALOGUE_COLORS = Object.freeze({
  ink: '#0d0b12', face: '#24212c', edgeLight: '#6c6570', edgeDark: '#37323f',
  text: '#e9e2cf', dim: '#8f8789', name: '#f2a33a', narration: '#bdb5a6',
});
const FONT_FAMILY = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';
const ADVANCE_KEYS = new Set(['KeyE', 'Enter', 'NumpadEnter', 'Space']);
const UP_KEYS = new Set(['ArrowUp', 'KeyW']);
const DOWN_KEYS = new Set(['ArrowDown', 'KeyS']);
const CHOICE_KEYS = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 };

// ---- pure helpers (tested in Node) ------------------------------------------------------------------------------

/**
 * Greedy word wrap. Words wider than the line are broken between characters; '\n' forces a break.
 * @param {string} text
 * @param {number} maxWidth
 * @param {(s: string) => number} measure width of a string
 * @returns {string[]} lines (at least one)
 */
export function wrapText(text, maxWidth, measure) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/ +/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (measure(tryLine) <= maxWidth) { line = tryLine; continue; }
      if (line) out.push(line);
      line = '';
      let rest = word;
      while (measure(rest) > maxWidth && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && measure(rest.slice(0, n)) > maxWidth) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

/**
 * When each character of a line appears: `cps` characters per second, plus a pause after the end of a
 * sentence (. ? !) and a shorter one after , ; : and the dash.
 * @param {string} text
 * @param {{ cps: number, pauseMs: { stop: number, comma: number } }} cfg
 * @returns {number[]} times[i] = ms after which character i is visible (non-decreasing)
 */
export function revealTimes(text, cfg) {
  const step = 1000 / cfg.cps;
  const times = new Array(text.length);
  let t = 0;
  for (let i = 0; i < text.length; i++) {
    t += step;
    times[i] = t;
    const c = text[i];
    const next = text[i + 1];
    if ((c === '.' || c === '?' || c === '!') && (next === ' ' || next === undefined)) t += cfg.pauseMs.stop;
    else if ((c === ',' || c === ';' || c === ':' || c === '—') && next === ' ') t += cfg.pauseMs.comma;
  }
  return times;
}

/** how many characters are visible `ms` after the line appeared */
export function charsVisible(times, ms) {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Where everything in the box goes, in logical pixels.
 * @param {{ width: number, height: number, scale: number }} view #ui logical size, CSS px per logical px
 * @param {{ top: number, right: number, bottom: number, left: number }} safe insets
 * @param {{ text: string, name: string|null, choices: string[], touch: boolean }} content
 * @param {Object} cfg tuning.dialogue
 * @param {(s: string) => number} measure width at the dialogue font
 */
export function dialogueLayout(view, safe, content, cfg, measure) {
  const s = { top: safe?.top || 0, right: safe?.right || 0, bottom: safe?.bottom || 0, left: safe?.left || 0 };
  const areaW = Math.max(0, view.width - s.left - s.right);
  const boxW = Math.round(Math.max(120, Math.min(cfg.boxMaxWidth, areaW - cfg.margin * 2)));
  const boxX = Math.round(s.left + (areaW - boxW) / 2);
  const pad = cfg.padding;
  const n = Math.min(content.choices.length, cfg.maxChoices);
  const side = n > 0 && boxW >= cfg.sideBySideMinWidth;
  const gap = pad;
  const colW = side ? Math.round(boxW * cfg.choiceColumnFraction) : boxW - pad * 2;
  const textW = side ? boxW - pad * 2 - colW - gap : boxW - pad * 2;
  const textLines = wrapText(content.text, textW, measure);
  const textH = Math.max(cfg.maxTextLines, textLines.length) * cfg.lineHeight;
  const minRow = Math.max(cfg.choiceRowHeight, content.touch ? Math.ceil(cfg.touchChoiceRowCss / (view.scale > 0 ? view.scale : 1)) : 0);
  const indent = 10;
  const rows = content.choices.slice(0, n).map((c) => {
    const lines = wrapText(c, colW - indent, measure);
    return { lines, h: Math.max(minRow, lines.length * cfg.lineHeight + 2) };
  });
  const choicesH = rows.reduce((k, r) => k + r.h, 0);
  const nameH = cfg.nameHeight;
  const bodyH = side ? Math.max(textH, choicesH) : textH + (n ? 4 + choicesH : 0);
  const boxH = Math.round(nameH + bodyH + pad * 2);
  const boxY = Math.round(view.height - s.bottom - cfg.margin - boxH);
  const textX = boxX + pad;
  const textY = boxY + pad + nameH;
  let cy = side ? textY : textY + textH + 4;
  const cx = side ? boxX + boxW - pad - colW : boxX + pad;
  const choices = rows.map((r) => {
    const rect = { x: cx, y: cy, w: colW, h: r.h, lines: r.lines };
    cy += r.h;
    return rect;
  });
  return {
    box: { x: boxX, y: boxY, w: boxW, h: boxH },
    name: { x: textX, y: boxY + pad },
    text: { x: textX, y: textY, w: textW, lines: textLines },
    choices, side, indent,
    caret: { x: boxX + boxW - pad - 7, y: boxY + boxH - pad - 4 },
  };
}

/**
 * Where the camera should look while the box is open, so the box never covers the speaker: the midpoint of
 * player and speaker, raised until the lower of their feet sits `clearance` above the top of the box.
 * @returns {{x:number,y:number}}
 */
export function focusPoint(player, speaker, viewH, boxTop, clearance) {
  const x = (player.x + speaker.x) / 2;
  const mid = (player.y + speaker.y) / 2;
  const feet = Math.max(player.y, speaker.y);
  // centred on `mid` the feet would sit at viewH/2 + (feet - mid); move down only as much as needed
  const over = viewH / 2 + (feet - mid) - (boxTop - clearance);
  return { x, y: over > 0 ? mid + over : mid };
}

// ---- the box -------------------------------------------------------------------------------------------------

export class DialogueUI {
  /**
   * @param {Object} opts
   * @param {import('../engine/InputManager.js').InputManager} opts.input
   * @param {import('../engine/AssetManager.js').AssetManager} [opts.assets]
   * @param {Object} opts.tuning the whole tuning (reads tuning.dialogue)
   */
  constructor({ input, assets = null, tuning }) {
    this.input = input;
    this.assets = assets;
    this.cfg = tuning.dialogue;
    /** @type {import('../sim/Dialogue.js').DialogueView|null} */
    this.view = null;
    this.open = false;
    this.key = null;
    /** ms the current line has been shown */
    this.t = 0;
    this.skipped = false;
    /** a press went to the sim; wait until what is shown changes */
    this.pending = false;
    this.cursor = 0;
    this.times = [];
    this.layout = null;
    /** lowest box top seen in this conversation, for a camera that only moves once */
    this.focusTop = Infinity;
    this.removers = [];
    this.plateCache = { key: '', canvas: null };
    this.measureCtx = null;
  }

  /** whether the whole current line is on screen */
  get revealed() {
    return !!this.view && (this.skipped || charsVisible(this.times, this.t) >= this.view.text.length);
  }

  /**
   * Follow the simulation. Call once per frame after the ticks.
   * @param {import('../sim/Sim.js').Sim} sim
   * @param {number} elapsed seconds since the last frame
   */
  sync(sim, elapsed) {
    const view = sim?.dialogue?.active ? sim.dialogue.current() : null;
    if (!view) {
      if (this.open) this.close();
      return;
    }
    if (!this.open) this.openBox();
    this.view = view;
    if (view.key !== this.key) {
      this.key = view.key;
      this.t = 0;
      this.skipped = false;
      this.pending = false;
      this.cursor = 0;
      this.times = revealTimes(view.text, this.cfg);
    } else {
      this.t += Math.max(0, elapsed) * 1000;
    }
    if (this.cursor >= view.choices.length) this.cursor = 0;
  }

  openBox() {
    this.open = true;
    this.key = null;
    this.focusTop = Infinity;
    // the hotbar's tap regions would pick a slot, which in a conversation means a choice: only ours (and debug's)
    this.input.setModal?.({ onKey: (code, repeat) => this.onKey(code, repeat), allowRegion: (id) => id.startsWith('dialogue-') || id.startsWith('debug') });
    const reg = (id, rect, tap) => this.removers.push(this.input.addHitRegion(id, rect, tap));
    reg('dialogue-box', () => (this.open && this.layout ? this.layout.box : null), () => this.advance());
    for (let i = 0; i < this.cfg.maxChoices; i++) {
      reg(`dialogue-choice-${i}`, () => (this.open && this.revealed && this.layout?.choices[i] ? this.layout.choices[i] : null), () => this.pick(i));
    }
  }

  close() {
    this.open = false;
    this.view = null;
    this.key = null;
    this.layout = null;
    for (const r of this.removers) r();
    this.removers = [];
    this.input.setModal?.(null);
  }

  /** E / Enter / Space / a tap on the box */
  advance() {
    if (!this.view || this.pending) return;
    if (!this.revealed) { this.skipped = true; return; }
    if (this.view.choices.length) this.pick(this.cursor);
    else this.send('interact');
  }

  /** pick the i-th visible choice */
  pick(i) {
    if (!this.view || this.pending) return;
    if (!this.revealed) { this.skipped = true; return; }
    if (i < 0 || i >= this.view.choices.length) return;
    this.cursor = i;
    this.send(i);
  }

  send(what) {
    this.pending = true;
    if (what === 'interact') this.input.trigger('interact');
    else this.input.selectHotbar(what);
  }

  /**
   * A key while the box is open (InputCore modal hook).
   * @returns {boolean} true when the key belongs to the dialogue (its default is prevented)
   */
  onKey(code, repeat = false) {
    const v = this.view;
    if (!v) return false;
    const n = v.choices.length;
    if (UP_KEYS.has(code) || DOWN_KEYS.has(code)) {
      if (n && this.revealed) this.cursor = (this.cursor + (UP_KEYS.has(code) ? n - 1 : 1)) % n;
      return true;
    }
    if (repeat) return ADVANCE_KEYS.has(code) || code in CHOICE_KEYS || code === 'Escape';
    if (ADVANCE_KEYS.has(code)) { this.advance(); return true; }
    if (code in CHOICE_KEYS) { this.pick(CHOICE_KEYS[code]); return true; }
    if (code === 'Escape') {
      if (!this.revealed) return true;
      if (v.exitChoice >= 0) this.pick(v.exitChoice);
      else if (v.ends) this.advance();
      return true;
    }
    return false;
  }

  /** where the camera should look this frame, or null when the box is closed */
  cameraFocus(sim, viewH) {
    if (!this.open || !this.layout || !sim?.marek) return null;
    this.focusTop = Math.min(this.focusTop, this.layout.box.y);
    return focusPoint(sim.player, sim.marek, viewH, this.focusTop, this.cfg.speakerClearance);
  }

  font() {
    return `${this.cfg.fontPx}px ${FONT_FAMILY}`;
  }

  /**
   * Draw the box.
   * @param {CanvasRenderingContext2D} ctx #ui context in logical pixels
   * @param {{ uiLogicalWidth: number, uiLogicalHeight: number, scale: number }} vp
   * @param {{top:number,right:number,bottom:number,left:number}} safe
   * @param {number} nowMs a clock for the caret blink
   */
  draw(ctx, vp, safe, nowMs) {
    const v = this.view;
    if (!this.open || !v) return;
    const C = DIALOGUE_COLORS;
    const cfg = this.cfg;
    ctx.save();
    ctx.font = this.font();
    const measure = (s) => ctx.measureText(s).width;
    const revealed = this.revealed;
    const L = dialogueLayout({ width: vp.uiLogicalWidth, height: vp.uiLogicalHeight, scale: vp.scale }, safe,
      { text: v.text, name: v.name, choices: v.choices.map((c) => c.text), touch: !!this.input.touchVisible }, cfg, measure);
    this.layout = L;
    this.drawPlate(ctx, L.box);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (v.name) {
      ctx.font = `bold ${cfg.fontPx}px ${FONT_FAMILY}`;
      ctx.fillStyle = C.name;
      ctx.fillText(v.name, L.name.x, L.name.y);
      ctx.font = this.font();
    }
    // the typewriter: characters across the wrapped lines (wrapping is of the whole line, so words never jump)
    let left = this.skipped ? Infinity : charsVisible(this.times, this.t);
    ctx.fillStyle = v.name ? C.text : C.narration;
    if (!v.name) ctx.font = `italic ${cfg.fontPx}px ${FONT_FAMILY}`;
    L.text.lines.forEach((line, i) => {
      if (left <= 0) return;
      ctx.fillText(line.slice(0, left), L.text.x, L.text.y + i * cfg.lineHeight);
      left -= line.length + 1;
    });
    ctx.font = this.font();

    if (revealed && L.choices.length) {
      const m = this.input.mouse;
      L.choices.forEach((r, i) => {
        if (m && m.x >= r.x && m.x < r.x + r.w && m.y >= r.y && m.y < r.y + r.h) this.cursor = i;
      });
      L.choices.forEach((r, i) => {
        const sel = i === this.cursor;
        const ty = r.y + Math.max(1, Math.floor((r.h - r.lines.length * cfg.lineHeight) / 2));
        if (sel) this.icon(ctx, 'cursor', r.x, ty + 1, () => this.fallbackCursor(ctx, r.x, ty + 1));
        ctx.fillStyle = sel ? C.text : C.dim;
        r.lines.forEach((line, k) => ctx.fillText(line, r.x + L.indent, ty + k * cfg.lineHeight));
      });
    } else if (revealed && !this.pending) {
      const frame = Math.floor(nowMs / cfg.caretBlinkMs) % 2;
      this.icon(ctx, `caret_${frame}`, L.caret.x, L.caret.y - 6 + frame, () => this.fallbackCaret(ctx, L.caret.x, L.caret.y - 6 + frame));
    }
    ctx.restore();
  }

  /** a ui-sheet icon, or the fallback while the sheet is not loaded */
  icon(ctx, name, x, y, fallback) {
    if (this.assets?.hasIcon?.('ui', name)) this.assets.drawIcon(ctx, 'ui', name, x, y);
    else fallback();
  }

  fallbackCursor(ctx, x, y) {
    ctx.fillStyle = DIALOGUE_COLORS.name;
    for (let i = 0; i < 4; i++) ctx.fillRect(x + i, y + i, 1, 7 - i * 2);
  }

  fallbackCaret(ctx, x, y) {
    ctx.fillStyle = DIALOGUE_COLORS.text;
    for (let i = 0; i < 4; i++) ctx.fillRect(x + i, y + i, 7 - i * 2, 1);
  }

  /** the dark-plate 9-slice from the ui sheet, rendered once per size into a cached canvas; procedural until it loads */
  drawPlate(ctx, b) {
    const ready = !!this.assets?.hasIcon?.('ui', 'dlg_c');
    const key = `${b.w}x${b.h}:${ready}`;
    if (this.plateCache.key !== key) {
      const c = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(b.w, b.h) : Object.assign(document.createElement('canvas'), { width: b.w, height: b.h });
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      if (ready) this.tilePlate(g, b.w, b.h);
      else this.proceduralPlate(g, b.w, b.h);
      this.plateCache = { key, canvas: c };
    }
    ctx.drawImage(this.plateCache.canvas, b.x, b.y);
  }

  /** the dark plate 9-slice (ICONS.md), tiled into the cache once per size */
  tilePlate(g, w, h) {
    this.assets.drawPanel9(g, 'ui', 'dlg', 0, 0, w, h, { mode: 'tile' });
  }

  proceduralPlate(g, w, h) {
    const C = DIALOGUE_COLORS;
    g.fillStyle = C.ink;
    g.fillRect(0, 0, w, h);
    g.fillStyle = C.edgeDark;
    g.fillRect(1, 1, w - 2, h - 2);
    g.fillStyle = C.edgeLight;
    g.fillRect(1, 1, w - 3, h - 3);
    g.fillStyle = C.face;
    g.fillRect(2, 2, w - 4, h - 4);
  }
}
