// Draws the touch controls on the #ui canvas (context already scaled to logical pixels). Shapes are built from
// one-logical-pixel rows so they match the pixel art of the world; icons come from icons.js.
import { TOUCH_ICONS } from './icons.js';
import { knobDrawPosition } from './joystick.js';

const LIGHT = '#d8d2bf';
const DARK = '#0b1416';
const ACCENT = '#e9c46a';

/** filled circle as horizontal runs of whole logical pixels */
function pixelDisc(ctx, cx, cy, r) {
  const x0 = Math.round(cx);
  const y0 = Math.round(cy);
  const rr = Math.round(r);
  for (let dy = -rr; dy < rr; dy++) {
    const yc = dy + 0.5;
    const half = Math.round(Math.sqrt(Math.max(0, rr * rr - yc * yc)));
    if (half > 0) ctx.fillRect(x0 - half, y0 + dy, half * 2, 1);
  }
}

/** ring of the given thickness as runs of whole logical pixels */
function pixelRing(ctx, cx, cy, r, thickness) {
  const x0 = Math.round(cx);
  const y0 = Math.round(cy);
  const ro = Math.round(r);
  const ri = Math.max(0, ro - Math.max(1, Math.round(thickness)));
  for (let dy = -ro; dy < ro; dy++) {
    const yc = dy + 0.5;
    const outer = Math.round(Math.sqrt(Math.max(0, ro * ro - yc * yc)));
    const inner = Math.abs(yc) < ri ? Math.round(Math.sqrt(ri * ri - yc * yc)) : 0;
    if (outer <= inner) continue;
    ctx.fillRect(x0 - outer, y0 + dy, outer - inner, 1);
    ctx.fillRect(x0 + inner, y0 + dy, outer - inner, 1);
  }
}

function pixelRect(ctx, x, y, w, h, thickness) {
  const t = Math.max(1, Math.round(thickness));
  const [rx, ry, rw, rh] = [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
  ctx.fillRect(rx, ry, rw, t);
  ctx.fillRect(rx, ry + rh - t, rw, t);
  ctx.fillRect(rx, ry + t, t, rh - 2 * t);
  ctx.fillRect(rx + rw - t, ry + t, t, rh - 2 * t);
}

/** a dotted line of one-pixel squares */
function pixelLine(ctx, x1, y1, x2, y2, spacing) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const n = Math.max(1, Math.floor(Math.sqrt(dx * dx + dy * dy) / spacing));
  for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(x1 + (dx * i) / n) - 1, Math.round(y1 + (dy * i) / n) - 1, 2, 2);
}

/**
 * @param {CanvasRenderingContext2D} ctx #ui context in logical pixels
 * @param {import('./InputCore.js').InputCore} input
 * @param {{ playerScreen?: {x:number,y:number}|null }} [opts] the player on screen, to draw the throw line from
 */
export function drawTouchControls(ctx, input, { playerScreen = null } = {}) {
  if (!input.touchVisible) return;
  const L = input.layout;
  const op = input.cfg.opacity;
  const line = Math.max(1, L.unit * 3);
  ctx.save();

  // joystick: the live one under the thumb, else a faint hint where a thumb usually rests
  const j = L.joystick;
  if (input.joystick) {
    const js = input.joystick;
    ctx.globalAlpha = op.joystick * 0.5;
    ctx.fillStyle = DARK;
    pixelDisc(ctx, js.baseX, js.baseY, j.ringRadius);
    ctx.globalAlpha = op.joystick;
    ctx.fillStyle = js.sprint ? ACCENT : LIGHT;
    pixelRing(ctx, js.baseX, js.baseY, j.ringRadius, line);
    ctx.globalAlpha = op.joystick * 0.6;
    ctx.fillStyle = LIGHT;
    pixelRing(ctx, js.baseX, js.baseY, j.walkRadius, Math.max(1, line / 2));
    const k = knobDrawPosition(js, j);
    ctx.globalAlpha = op.pressed;
    pixelDisc(ctx, k.x, k.y, j.knobRadius);
  } else {
    ctx.globalAlpha = op.hint;
    ctx.fillStyle = LIGHT;
    pixelRing(ctx, L.joystickRest.x, L.joystickRest.y, j.ringRadius, line);
    pixelDisc(ctx, L.joystickRest.x, L.joystickRest.y, j.knobRadius);
  }

  // thumb buttons
  for (const b of L.buttons) {
    const pressed = input.isPressed(b.id);
    const active = b.id === 'crouch' && input.crouch;
    const disabled = b.id === 'context' && !input.context;
    const alpha = pressed ? op.pressed : active ? op.active : disabled ? op.disabled : op.idle;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = active || pressed ? ACCENT : DARK;
    pixelDisc(ctx, b.x, b.y, b.r);
    ctx.globalAlpha = Math.min(1, alpha + 0.25);
    ctx.fillStyle = active ? ACCENT : LIGHT;
    pixelRing(ctx, b.x, b.y, b.r, line);
    ctx.fillStyle = active || pressed ? DARK : LIGHT;
    const icon = b.id === 'context' ? input.context ?? 'hand' : b.id;
    TOUCH_ICONS[icon](ctx, b.x, b.y, b.r * 1.05);
  }

  // top-right bar
  for (const r of L.bar) {
    const pressed = input.isPressed(r.id);
    ctx.globalAlpha = pressed ? op.pressed : op.idle;
    ctx.fillStyle = pressed ? ACCENT : DARK;
    ctx.fillRect(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h));
    ctx.globalAlpha = Math.min(1, (pressed ? op.pressed : op.idle) + 0.25);
    ctx.fillStyle = LIGHT;
    pixelRect(ctx, r.x, r.y, r.w, r.h, line);
    ctx.fillStyle = pressed ? DARK : LIGHT;
    TOUCH_ICONS[r.id](ctx, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.55);
  }

  // drag-to-throw: a line from the button to the finger and, when the player is known, the throw itself
  const d = input.useDrag;
  if (d && d.aiming) {
    ctx.globalAlpha = op.pressed;
    ctx.fillStyle = ACCENT;
    pixelLine(ctx, d.startX, d.startY, d.x, d.y, 3);
    const dx = d.x - d.startX;
    const dy = d.y - d.startY;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (playerScreen && len > 0) {
      const reach = input.cfg.throwAimDistance;
      const ex = playerScreen.x + (dx / len) * reach;
      const ey = playerScreen.y + (dy / len) * reach;
      pixelLine(ctx, playerScreen.x, playerScreen.y, ex, ey, 4);
      pixelRing(ctx, ex, ey, 4, 1);
    }
  }
  ctx.restore();
}
