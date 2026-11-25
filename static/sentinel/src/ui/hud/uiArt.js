// Small drawing helpers over the ui sheet (assets/src/ICONS.md) for the screens that are not HUD widgets: the map
// overlay, the journal (its tabs and paper page), prompts. Each draws from the page's AssetManager
// (setActiveAssets in main.js) and falls back to a procedural shape while the sheet loads; none throws.
import { activeAssets } from '../../engine/AssetManager.js';

/** palette (assets/src/palette.gpl) */
export const UI_ART_COLORS = Object.freeze({
  ink: '#0d0b12', bone: '#e9e2cf', amber: '#f2a33a', rust: '#a8522b', teal: '#379a95', basalt: '#4f4955', dim: '#8f8789',
  sand: '#e7cd98', paper: '#d2b07c', earth: '#2a1e1a', earthEdge: '#45312a', violet: '#8b5cf6', face: '#24212c',
});

/** the map markers (8 x 8) */
export const MAP_MARKERS = Object.freeze(['player', 'landmark', 'loot', 'danger', 'spring', 'totem', 'unknown']);
/** the journal tabs (12 x 12) */
export const JOURNAL_TABS = Object.freeze(['notes', 'map', 'objectives', 'recipes']);

const FALLBACK_MARKER = Object.freeze({
  player: UI_ART_COLORS.amber, landmark: UI_ART_COLORS.bone, loot: UI_ART_COLORS.sand, danger: UI_ART_COLORS.rust,
  spring: UI_ART_COLORS.teal, totem: UI_ART_COLORS.paper, unknown: UI_ART_COLORS.dim,
});

/**
 * An 8 x 8 map marker centred on (cx, cy) (whole pixels). `angle` (radians, clockwise from up) turns it: the
 * player arrow points up in the sheet.
 * @param {CanvasRenderingContext2D} ctx
 * @param {'player'|'landmark'|'loot'|'danger'|'spring'|'totem'|'unknown'} kind
 */
export function drawMapMarker(ctx, kind, cx, cy, angle = 0, art = activeAssets()) {
  const name = `marker_${kind}`;
  const x = Math.round(cx) - 4;
  const y = Math.round(cy) - 4;
  if (art?.hasIcon('ui', name)) {
    if (angle) {
      ctx.save();
      ctx.translate(Math.round(cx), Math.round(cy));
      ctx.rotate(angle);
      art.drawIcon(ctx, 'ui', name, -4, -4);
      ctx.restore();
    } else art.drawIcon(ctx, 'ui', name, x, y);
    return;
  }
  ctx.fillStyle = UI_ART_COLORS.ink;
  ctx.fillRect(x + 1, y + 1, 6, 6);
  ctx.fillStyle = FALLBACK_MARKER[kind] ?? UI_ART_COLORS.bone;
  ctx.fillRect(x + 2, y + 2, 4, 4);
}

/** which marker a landmark shows on the map, from its id (springs and border totems are landmarks too) */
export function markerForLandmark(id) {
  if (/spring/.test(id)) return 'spring';
  if (/totem/.test(id)) return 'totem';
  return 'landmark';
}

/**
 * A 12 x 12 journal tab icon with its top-left at (x, y); `selected` lifts it (full opacity) over the others.
 * @param {'notes'|'map'|'objectives'|'recipes'} tab
 */
export function drawJournalTab(ctx, tab, x, y, selected = false, art = activeAssets()) {
  const name = `tab_${tab}`;
  ctx.save();
  ctx.globalAlpha = selected ? 1 : 0.6;
  if (art?.hasIcon('ui', name)) art.drawIcon(ctx, 'ui', name, x, y);
  else {
    ctx.fillStyle = UI_ART_COLORS.earth;
    ctx.fillRect(x, y, 12, 12);
    ctx.fillStyle = UI_ART_COLORS.paper;
    ctx.fillRect(x + 1, y + 1, 10, 10);
  }
  ctx.restore();
}

/** the weathered paper 9-slice (`page_*`), for the journal and the map frame; a flat paper plate while loading */
export function drawPaperPanel(ctx, x, y, w, h, art = activeAssets()) {
  if (art?.hasIcon('ui', 'page_c') && art.drawPanel9(ctx, 'ui', 'page', x, y, w, h)) return;
  ctx.fillStyle = UI_ART_COLORS.earthEdge;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = UI_ART_COLORS.paper;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
}

/** the dark plate 9-slice (`dlg_*`): dialogue, prompts, the tide widget; a procedural plate while loading */
export function drawDarkPanel(ctx, x, y, w, h, art = activeAssets()) {
  if (art?.hasIcon('ui', 'dlg_c') && art.drawPanel9(ctx, 'ui', 'dlg', x, y, w, h)) return;
  ctx.fillStyle = UI_ART_COLORS.ink;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#37323f';
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = '#6c6570';
  ctx.fillRect(x + 1, y + 1, w - 3, h - 3);
  ctx.fillStyle = UI_ART_COLORS.face;
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
}
