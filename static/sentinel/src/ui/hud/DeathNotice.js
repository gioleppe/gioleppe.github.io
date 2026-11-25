// HUD widget: a minimal notice once the run is lost (sim.over), so a tester is not left with a frozen character.
// Step 5.1's game-over screen (atmosphere, distance and days survived, Retry) replaces it.

export const DEATH_COLORS = Object.freeze({ shade: '#0d0b12', title: '#e9e2cf', text: '#8f8789', accent: '#a8522b' });   // ink, bone, basalt_4, rust_1

const CAUSES = Object.freeze({
  arrow: 'Struck down by an arrow',
  bleed: 'Bled out',
  drowning: 'Drowned',
  thirst: 'Died of thirst',
  debug: 'Killed (debug)',
});

/** the notice's lines for a `sim.over` record */
export function deathLines(over) {
  return {
    title: 'YOU DIED',
    cause: CAUSES[over.cause] ?? `Died (${over.cause})`,
    stats: `day ${over.day}  ·  ${Math.round(over.distance)} m travelled`,
    hint: 'reload the page to try again',
  };
}

/** the HUD widget (see HUD.js); drawn last, over everything */
export const deathNotice = Object.freeze({
  id: 'death',
  draw(ctx, sim, { vp }) {
    if (!sim?.over) return;
    const l = deathLines(sim.over);
    const W = vp.uiLogicalWidth;
    const H = vp.uiLogicalHeight;
    const C = DEATH_COLORS;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = C.shade;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = Math.round(W / 2);
    const cy = Math.round(H / 2);
    ctx.font = '12px ui-monospace, Consolas, monospace';
    ctx.fillStyle = C.title;
    ctx.fillText(l.title, cx, cy - 14);
    ctx.fillStyle = C.accent;
    ctx.fillRect(cx - 30, cy - 5, 60, 1);
    ctx.font = '7px ui-monospace, Consolas, monospace';
    ctx.fillStyle = C.title;
    ctx.fillText(l.cause, cx, cy + 3);
    ctx.fillStyle = C.text;
    ctx.fillText(l.stats, cx, cy + 13);
    ctx.font = '6px ui-monospace, Consolas, monospace';
    ctx.fillText(l.hint, cx, cy + 24);
    ctx.restore();
  },
});
