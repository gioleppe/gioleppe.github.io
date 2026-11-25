// Floating virtual joystick maths, free of the DOM. All lengths are logical pixels (see touchLayout.js for the
// conversion from the CSS-pixel tuning values).
//
//   base  where the thumb landed (moved inward so the ring fits the safe area, and dragged along when the
//         thumb goes past the ring)
//   knob  where the thumb is now
//
// |knob - base| below `deadZone` is no movement; from there it ramps to full walk at `walkRadius`; past
// `sprintEnter` it sprints until it falls back below `sprintExit` (hysteresis, so the edge does not flicker).

/**
 * @typedef {Object} JoystickMetrics
 * @property {number} deadZone
 * @property {number} walkRadius
 * @property {number} ringRadius   the outer (sprint) ring; the base follows a thumb dragged beyond it
 * @property {number} sprintEnter
 * @property {number} sprintExit
 * @property {number} knobRadius
 */

/**
 * @typedef {Object} Joystick
 * @property {number} baseX
 * @property {number} baseY
 * @property {number} knobX
 * @property {number} knobY
 * @property {boolean} sprint
 */

/**
 * A joystick under a thumb that just landed at (x, y). The base is pulled inside `area` (shrunk by the ring
 * radius) so the whole ring stays on screen; the knob stays under the thumb.
 * @param {number} x
 * @param {number} y
 * @param {JoystickMetrics} m
 * @param {{x:number,y:number,w:number,h:number}|null} [area]
 * @returns {Joystick}
 */
export function startJoystick(x, y, m, area = null) {
  let bx = x;
  let by = y;
  if (area) {
    bx = clampInto(bx, area.x + m.ringRadius, area.x + area.w - m.ringRadius);
    by = clampInto(by, area.y + m.ringRadius, area.y + area.h - m.ringRadius);
  }
  // no follow on landing: the base was only moved inward, and the next move drags it if needed
  const js = { baseX: bx, baseY: by, knobX: x, knobY: y, sprint: false };
  const d = Math.sqrt((x - bx) ** 2 + (y - by) ** 2);
  js.sprint = d >= m.sprintEnter;
  return js;
}

/**
 * Move the thumb to (x, y): drags the base along past the ring and updates sprint with hysteresis. Mutates `js`.
 * @param {Joystick} js
 * @param {number} x
 * @param {number} y
 * @param {JoystickMetrics} m
 * @returns {Joystick}
 */
export function moveJoystick(js, x, y, m) {
  let dx = x - js.baseX;
  let dy = y - js.baseY;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d > m.ringRadius) {
    const pull = (d - m.ringRadius) / d;
    js.baseX += dx * pull;
    js.baseY += dy * pull;
    dx = x - js.baseX;
    dy = y - js.baseY;
    d = m.ringRadius;
  }
  js.knobX = x;
  js.knobY = y;
  if (!js.sprint && d >= m.sprintEnter) js.sprint = true;
  else if (js.sprint && d < m.sprintExit) js.sprint = false;
  return js;
}

/**
 * The movement the joystick asks for: a direction with length 0..1, and sprint.
 * @param {Joystick|null} js
 * @param {JoystickMetrics} m
 * @returns {{ x: number, y: number, magnitude: number, sprint: boolean }}
 */
export function joystickVector(js, m) {
  if (!js) return { x: 0, y: 0, magnitude: 0, sprint: false };
  const dx = js.knobX - js.baseX;
  const dy = js.knobY - js.baseY;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= m.deadZone) return { x: 0, y: 0, magnitude: 0, sprint: false };
  const span = m.walkRadius - m.deadZone;
  const magnitude = span > 0 ? Math.min(1, (d - m.deadZone) / span) : 1;
  return { x: (dx / d) * magnitude, y: (dy / d) * magnitude, magnitude, sprint: js.sprint };
}

/**
 * Where to draw the knob: under the thumb, but never outside the ring.
 * @param {Joystick} js
 * @param {JoystickMetrics} m
 */
export function knobDrawPosition(js, m) {
  const dx = js.knobX - js.baseX;
  const dy = js.knobY - js.baseY;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= m.ringRadius || d === 0) return { x: js.knobX, y: js.knobY };
  return { x: js.baseX + (dx / d) * m.ringRadius, y: js.baseY + (dy / d) * m.ringRadius };
}

function clampInto(v, lo, hi) {
  if (lo > hi) return (lo + hi) / 2;
  return Math.max(lo, Math.min(hi, v));
}
