// Where the touch controls sit, free of the DOM, in logical pixels of the #ui canvas.
//
// Sizes in `tuning.input` are CSS pixels, because a CSS pixel has roughly the same physical size on every
// phone (about 0.16 mm), so a 60 px button is about 9.5 mm whatever the screen. They are converted with the
// viewport scale (CSS px per logical px), and shrunk together only if the largest button would take more
// than `maxSizeFraction` of the screen height (very short windows); the joystick shrinks with them.
//
// Right thumb cluster, anchored at the bottom-right corner of the safe area: the context action (largest) in
// the corner, and use/throw, light and crouch on an arc around it from left to top. Top-right bar: journal in
// the corner, inventory to its left. The left half (minus the bar) belongs to the floating joystick.

/** ids of the round thumb buttons, in arc order after the corner one */
export const BUTTON_IDS = Object.freeze(['context', 'use', 'light', 'crouch']);
/** ids of the top-right bar icons, right to left */
export const BAR_IDS = Object.freeze(['journal', 'inventory']);

/**
 * @typedef {Object} TouchLayout
 * @property {number} unit       logical pixels per CSS-pixel tuning value
 * @property {{x:number,y:number,w:number,h:number}} safeRect  the safe area in logical pixels
 * @property {Array<{id:string,x:number,y:number,r:number}>} buttons  circles
 * @property {Array<{id:string,x:number,y:number,w:number,h:number}>} bar  rectangles
 * @property {import('./joystick.js').JoystickMetrics} joystick
 * @property {{x:number,y:number}} joystickRest  where the idle joystick hint is drawn
 * @property {{x:number,y:number,w:number,h:number}} joystickZone  thumbs landing here start the joystick
 * @property {number} dragThreshold  logical pixels a use-button drag must travel to become an aim
 */

/**
 * @param {{ width: number, height: number, scale: number }} view  #ui size in logical pixels and CSS px per logical px
 * @param {{top:number,right:number,bottom:number,left:number}} safe  insets in logical pixels
 * @param {Object} cfg  tuning.input
 * @returns {TouchLayout}
 */
export function layoutTouchControls(view, safe, cfg) {
  const s = { top: safe?.top || 0, right: safe?.right || 0, bottom: safe?.bottom || 0, left: safe?.left || 0 };
  const safeRect = { x: s.left, y: s.top, w: Math.max(0, view.width - s.left - s.right), h: Math.max(0, view.height - s.top - s.bottom) };
  const b = cfg.buttons;
  const largest = Math.max(b.primarySize, b.size, b.barSize);
  let unit = 1 / (view.scale > 0 ? view.scale : 1);
  const cap = (cfg.maxSizeFraction * view.height) / (largest * unit);
  if (cap < 1) unit *= cap;
  const u = (v) => v * unit;

  const margin = u(b.margin);
  const gap = u(b.gap);
  const rc = u(b.primarySize) / 2;
  const r = u(b.size) / 2;
  const right = safeRect.x + safeRect.w;
  const bottom = safeRect.y + safeRect.h;

  // corner button, then the others on an arc around it (180° = left, 90° = up), far enough apart not to touch
  const cx = right - margin - rc;
  const cy = bottom - margin - rc;
  const step = (b.arcStepDeg * Math.PI) / 180;
  const dist = Math.max(rc + gap + r, (2 * r + gap) / (2 * Math.sin(step / 2)));
  const buttons = [{ id: 'context', x: cx, y: cy, r: rc }];
  BUTTON_IDS.slice(1).forEach((id, i) => {
    const a = Math.PI - i * step;
    buttons.push({ id, x: cx + Math.cos(a) * dist, y: cy - Math.sin(a) * dist, r });
  });

  const bs = u(b.barSize);
  const bg = u(b.barGap);
  const bar = BAR_IDS.map((id, i) => ({ id, x: right - margin - bs - i * (bs + bg), y: safeRect.y + margin, w: bs, h: bs }));

  const j = cfg.joystick;
  const joystick = {
    deadZone: u(j.deadZone), walkRadius: u(j.walkRadius), ringRadius: u(j.ringRadius),
    sprintEnter: u(j.sprintEnter), sprintExit: u(j.sprintExit), knobRadius: u(j.knobRadius),
  };
  const joystickRest = { x: safeRect.x + margin + joystick.ringRadius, y: bottom - margin - joystick.ringRadius };
  const joystickZone = { x: 0, y: 0, w: view.width / 2, h: view.height };

  return { unit, safeRect, buttons, bar, joystick, joystickRest, joystickZone, dragThreshold: u(cfg.dragThreshold) };
}

/** true if (x, y) is inside the rectangle */
export function inRect(rect, x, y) {
  return !!rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

/**
 * The control under (x, y): a thumb button or bar id, 'joystick' in the joystick zone, or null.
 * @param {TouchLayout} layout
 * @param {number} x
 * @param {number} y
 * @returns {string|null}
 */
export function hitTestTouch(layout, x, y) {
  for (const btn of layout.buttons) {
    const dx = x - btn.x;
    const dy = y - btn.y;
    if (dx * dx + dy * dy <= btn.r * btn.r) return btn.id;
  }
  for (const r of layout.bar) if (inRect(r, x, y)) return r.id;
  if (inRect(layout.joystickZone, x, y)) return 'joystick';
  return null;
}
