// Debug tools for the story and Marek's dialogue (step 4.5; `?debug` only): a safe-zone layer, a story
// readout, a "Marek" teleport place, and actions to fake the Fallen Outsider inspections, toggle any story flag
// and end or reset the conversation. Every write goes through cheats.js.
import { label, COLORS } from './layers.js';
import { OUTSIDER_SITES } from '../../entities/marekHooks.js';
import { conditionAtoms } from '../../sim/Dialogue.js';
import * as cheats from './cheats.js';

/** flags a tree sets or reads, sorted */
export function treeFlags(tree) {
  const out = new Set(['plan_boat', 'plan_signal', 'dinghy_repaired']);
  for (const n of tree.nodes.values()) {
    const all = [n, ...(n.choices ?? [])];
    for (const o of all) {
      for (const s of o.fx?.set ?? []) out.add(s.name);
      if (o.cond) for (const a of conditionAtoms(o.cond)) if (a.k === 'flag') out.add(a.name);
    }
    for (const b of n.branch ?? []) if (b.cond) for (const a of conditionAtoms(b.cond)) if (a.k === 'flag') out.add(a.name);
  }
  for (const k of [...out]) if (/=/.test(k)) out.delete(k);
  return [...out].sort();
}

/** the readout lines for a story */
export function storyLines(sim) {
  const st = sim.story;
  const c = st.conversation;
  const lines = [
    `story: visits ${JSON.stringify(st.visits)}  zone ${sim.safeZones.playerZone ?? '-'}`,
    `  conversation ${c ? `${c.tree}/${c.node} line ${c.line}` : 'none'}  marek ${sim.marek ? `${sim.marek.state} ${sim.marek.facing}` : 'absent'}`,
    `  sites ${[...st.inspected].join(', ') || '-'}  recipes ${[...st.recipes].join(', ') || '-'}`,
  ];
  const flags = [...st.flags].sort();
  for (let i = 0; i < flags.length || i === 0; i += 5) lines.push(`  flags ${flags.slice(i, i + 5).join(' ') || '-'}`);
  return lines;
}

/**
 * Register the story layers, places and actions.
 * @param {import('./DebugMode.js').DebugMode} debug
 */
export function registerStoryDebug(debug) {
  debug.addLayer({
    id: 'safe-zones', label: 'Safe zones', group: 'world', default: false,
    drawWorld(ctx, sim, camera) {
      ctx.lineWidth = 1;
      for (const z of sim.safeZones?.zones ?? []) {
        ctx.strokeStyle = '#66c2b0';
        ctx.beginPath();
        // world ground is the plane itself: a circle in world pixels is a circle on screen
        ctx.arc(Math.round(z.x - camera.originX) + 0.5, Math.round(z.y - camera.originY) + 0.5, z.r, 0, Math.PI * 2);
        ctx.stroke();
        label(ctx, `safe: ${z.id}`, Math.round(z.x - camera.originX), Math.round(z.y - z.r - camera.originY) - 8, '#66c2b0', 'center');
      }
      const m = sim.marek;
      if (m) {
        ctx.strokeStyle = '#f2a33a';
        ctx.beginPath();
        ctx.arc(Math.round(m.x - camera.originX) + 0.5, Math.round(m.y - camera.originY) + 0.5, sim.interactables?.radiusFor('talk') ?? 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    },
  });
  debug.addLayer({
    id: 'story', label: 'Story flags', group: 'readouts', default: false,
    drawUi(ctx, sim, vp, env) {
      if (!sim.story) return;
      env.textBlock(ctx, storyLines(sim).map((text) => ({ text, color: COLORS.text })));
    },
  });
  // a step south of Marek, facing him
  debug.addPlaces((sim) => (sim.marek ? [{ id: 'marek', label: 'Marek', x: sim.marek.x, y: sim.marek.y + 24 }] : []));

  const act = (id, lbl, run) => debug.addAction({ id, label: lbl, group: 'story', run });
  act('marek-go', 'Go to Marek', () => debug.teleportToPlace('marek'));
  for (const site of OUTSIDER_SITES) act(`inspect-${site}`, `Fake site_inspected: ${site}`, (sim) => cheats.fakeSiteInspected(sim, site));
  act('talk-end', 'Dialogue: end conversation', (sim) => cheats.endConversation(sim));
  act('story-reset', 'Story: reset everything', (sim) => cheats.resetStory(sim));
  const tree = debug.sim?.dialogue?.trees?.marek;
  for (const f of tree ? treeFlags(tree) : []) act(`flag-${f}`, `Flag: toggle ${f}`, (sim) => cheats.setStoryFlag(sim, f));
}
