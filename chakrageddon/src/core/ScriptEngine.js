// Dialogue and cutscene scripts. A script is a JSON array of steps (see data/dialogues.json):
//   { s, t, style }                  a line of dialogue (s = speaker, optional)
//   { t, choice: [..], goto: [..] }  a question; goto holds a label per answer
//                                    optional: default (index the cursor starts on), show: [speciesId per answer] (preview)
//   { label } { goto } { if / ifNot: flag, goto } { ifHas: item, goto } { ifBands: n, goto } { ifParty: n, goto }
//   { ifIntox: level, goto }  jumps when the player's intoxication is at least level (0..1)
//   { ifCaught: n, goto }     jumps when the Trip Journal has at least n species bagged
//   { ifCond: cond, goto }    jumps when a quest condition holds (see src/core/quests.js)
//   { rupees: n }             the player receives n Rupees
//   { clock: minutes }        sets the festival clock (time passes while you wait)
//   { set / clear: flag } { give: item, n } { take: item, n } { giveMon: species, level } { pay: n, else: label }
//   { heal, respawn? } { water: true } (Hydration only) { stash: true } { shop: id } { battle: trainerId } { wild: species, level } { wristband: id }
//   { warp: { zone, x, y, dir } } { run: scriptId } { credits } { end }
//   { fx: name, at: npcId }        a visual effect at someone (the memory vendor's rainbow burst); the view draws it
//   { mirror: true }               a battle against a copy of your own party, for nothing (your reflection)
//   { walkOff: npcId }             that NPC walks to its leave: [x, y] tile (the view walks them; a flag hides them after)
//   { visitor: sprite | null }     someone stands next to you on the map while the script runs (Banyan with the timetable)
//                                    astral: true: they are a projection, floating down out of the sky (Banyan, six wristbands)
//   { tarot: true }                the tarot reader's table: an Astral remembers a forgotten move (mode TAROT)
//   { restUntilSet: true }         rest until the set picked just before (pickSet), or the next set on the timetable
//   { s, t, pickSet: true, cancel: label }  a question with one answer per set (soonest first) and Get up (goes to cancel)
//   { scene: id, show?: speciesId, phase?: n }  full-screen backdrop behind the dialogue (the opening dream); { scene: null } ends it
//                                    phase: a scene with several beats (the Vicchio landing) moves on to beat n
//                                    { scene: 'boss', who, card? }: a boss's cutscene; card: only the short title card
//   a choice with nameChoice: true also sets the player's name to the chosen answer
//   heal also makes this your whiteout point (the huts: tents, beds, the hammock), unless respawn: false
//   stash opens the party screen with the Chai Tent stash unlocked (s.menu.hut); only huts can swap with the stash
//   a shop in a zone with bossGate stays shut until that boss is beaten (dialogues.shop_closed)
// Text may contain {player}, replaced by the player's name, and {price}: a tarot reading (rules.tarot.price).
// The interpreter runs until it has something to show, then waits for ADVANCE_DIALOGUE.

import { check } from './quests.js';
import { restUntilSet, clockText, sets, minutesUntil } from './timetable.js';
import { statsOf } from './mons.js';
import { pathFor } from './OverworldEngine.js';

export function startScript(ctx, steps, mode = 'DIALOGUE') {
  ctx.state.script = { steps, pc: 0 };
  ctx.state.scriptMode = mode;
  runScript(ctx);
}

function jump(sc, label) {
  if (typeof label === 'number') { sc.pc = label; return; }
  const i = sc.steps.findIndex((st) => st.label === label);
  if (i < 0) throw new Error(`script label not found: ${label}`);
  sc.pc = i;
}

const fill = (s, text, data) => String(text ?? '').replace(/\{player\}/g, s.playerName || 'friend').replace(/\{price\}/g, data?.rules?.tarot?.price ?? 500);

/** zone.bossGate: the flag of the boss who runs this place. Until it is set, the Chai Tent and the shops here turn you away.
 *  Returns the boss's name while the gate is shut, otherwise null. */
export function bossGate(ctx, zone = ctx.data.zones[ctx.state.zoneId]) {
  const flag = zone?.bossGate;
  if (!flag || ctx.state.flags[flag]) return null;
  return Object.values(ctx.data.trainers).find((t) => t.setFlag === flag)?.name || 'the boss';
}

/** zone.gauntlet: { trainers, reset } — a run of fights (the Four). Under way once the first is beaten and until the last is;
 *  meanwhile the zone's Chai Tent turns you away, and a whiteout starts the run over (gauntletReset). */
export function gauntletUnderWay(ctx, zone) {
  const g = zone?.gauntlet;
  if (!g) return false;
  const beaten = g.trainers.filter((id) => ctx.state.defeated[id]).length;
  return beaten > 0 && beaten < g.trainers.length;
}
/** lose mid-run and the run starts over: the Four are back at their posts, and whatever the run used up comes back */
export function gauntletReset(ctx) {
  let reset = false;
  for (const zone of Object.values(ctx.data.zones)) {
    if (!gauntletUnderWay(ctx, zone)) continue;
    for (const id of zone.gauntlet.trainers) {
      delete ctx.state.defeated[id];
      const flag = ctx.data.trainers[id]?.setFlag;
      if (flag) delete ctx.state.flags[flag];
    }
    for (const flag of zone.gauntlet.reset || []) delete ctx.state.flags[flag];
    if (ctx.state.npcPos) delete ctx.state.npcPos[zone.zoneId];
    reset = true;
  }
  return reset;
}

function say(ctx, speaker, text, style, choices, extra = {}) {
  const s = ctx.state;
  speaker = fill(s, speaker); text = fill(s, text, ctx.data);
  s.dialogue = { speaker: speaker || '', text, style: style || 'NORMAL', choices: choices || null };
  if (choices && extra.default) s.dialogue.choiceDefault = extra.default;
  if (choices && extra.show) s.dialogue.show = extra.show;
  setMode(ctx, s.scriptMode || 'DIALOGUE');
  ctx.emit({ type: 'DIALOGUE_LINE', speaker: speaker || '', text, textStyle: style || 'NORMAL' });
}
export function setMode(ctx, to, shaderPreset = 'NONE') {
  const s = ctx.state;
  if (s.mode === to) return;
  ctx.emit({ type: 'TRANSITION_MODE', from: s.mode, to, shaderPreset });
  s.mode = to;
}

export function runScript(ctx) {
  const s = ctx.state, h = ctx.hooks;
  s.dialogue = null;
  for (let guard = 0; guard < 500; guard++) {
    const sc = s.script;
    if (!sc || sc.pc >= sc.steps.length) return finish(ctx);
    const st = sc.steps[sc.pc++];
    if (st.label !== undefined && Object.keys(st).length === 1) continue;
    if (st.end) return finish(ctx);
    if (st.goto !== undefined && !st.choice && st.if === undefined && st.ifNot === undefined && st.ifHas === undefined && st.ifBands === undefined && st.ifParty === undefined && st.ifIntox === undefined && st.ifCaught === undefined && st.ifCond === undefined) { jump(sc, st.goto); continue; }
    if (st.ifCond !== undefined) { if (check(s, st.ifCond, ctx.data)) jump(sc, st.goto); continue; }
    if (st.ifCaught !== undefined) { if (Object.keys(s.dex.caught).length >= st.ifCaught) jump(sc, st.goto); continue; }
    if (st.ifIntox !== undefined) { if (s.intox >= st.ifIntox) jump(sc, st.goto); continue; }
    if (st.if !== undefined) { if (s.flags[st.if]) jump(sc, st.goto); continue; }
    if (st.ifNot !== undefined) { if (!s.flags[st.ifNot]) jump(sc, st.goto); continue; }
    if (st.ifHas !== undefined) { if ((s.bag[st.ifHas] || 0) > 0) jump(sc, st.goto); continue; }
    if (st.ifBands !== undefined) { if (s.wristbands.length >= st.ifBands) jump(sc, st.goto); continue; }
    if (st.ifParty !== undefined) { if (s.party.length >= st.ifParty) jump(sc, st.goto); continue; }
    if (st.set) { s.flags[st.set] = 1; continue; }
    if (st.clear) { delete s.flags[st.clear]; continue; }
    if (st.scene !== undefined) { s.scene = st.scene ? { id: st.scene, ...(st.show ? { show: st.show } : {}), ...(st.phase ? { phase: st.phase } : {}), ...(st.who ? { who: st.who } : {}), ...(st.by ? { by: st.by } : {}), ...(st.card ? { card: true } : {}) } : null; continue; }
    // which set to sleep until: one answer per set on the timetable (soonest first), then Get up (goes to cancel)
    if (st.pickSet) {
      const list = sets(ctx.data).slice().sort((x, y) => (minutesUntil(ctx.data, s, x) || 1440) - (minutesUntil(ctx.data, s, y) || 1440));
      sc.setPick = list.map((x) => x.id).concat(null); sc.setCancel = st.cancel;
      const where = (x) => (x.zone === s.zoneId ? 'here' : ctx.data.zones[x.zone].name.replace(/^The /, ''));
      return say(ctx, st.s, st.t, st.style, list.map((x) => `${clockText(x.from)} ${x.name}, ${where(x)}`).concat('Get up'));
    }
    if (st.choice) { sc.choiceGoto = st.goto; sc.nameChoice = st.nameChoice ? st.choice : null; return say(ctx, st.s, st.t, st.style, st.choice, st); }
    if (st.t !== undefined) return say(ctx, st.s, st.t, st.style);
    if (st.give) {
      const n = st.n || 1, item = ctx.data.items[st.give];
      s.bag[st.give] = (s.bag[st.give] || 0) + n;
      ctx.emit({ type: 'ITEM_GAINED', itemId: st.give, n });
      ctx.emit({ type: 'AUDIO_CUE', sfxId: 'item' });
      return say(ctx, '', `You got ${n > 1 ? n + ' x ' : ''}${item?.name || st.give}!`);
    }
    if (st.clock !== undefined) { s.clock = ((st.clock % 1440) + 1440) % 1440; continue; }
    if (st.rupees) {
      s.rupees += st.rupees;
      ctx.emit({ type: 'RUPEES_CHANGED', rupees: s.rupees });
      ctx.emit({ type: 'AUDIO_CUE', sfxId: 'item' });
      return say(ctx, '', `You got Rs ${st.rupees}!`);
    }
    if (st.take) { s.bag[st.take] = Math.max(0, (s.bag[st.take] || 0) - (st.n || 1)); continue; }
    if (st.pay !== undefined) {
      if (s.rupees >= st.pay) { s.rupees -= st.pay; ctx.emit({ type: 'RUPEES_CHANGED', rupees: s.rupees }); } else jump(sc, st.else);
      continue;
    }
    if (st.giveMon) {
      const where = h.giveMon(ctx, st.giveMon, st.level || 5);
      const name = ctx.data.dex[st.giveMon].name;
      ctx.emit({ type: 'AUDIO_CUE', sfxId: 'fanfare' });
      return say(ctx, '', where === 'party' ? `${name} joined your party!` : `${name} was sent to the Chai Tent stash.`);
    }
    if (st.water) { for (const m of s.party) m.hyd = statsOf(ctx.data, m).maxHyd; ctx.emit({ type: 'AUDIO_CUE', sfxId: 'heal' }); continue; }   // Hydration only (the temple's water jug)
    if (st.heal) { h.healParty(ctx, st.respawn !== false); ctx.emit({ type: 'PARTY_HEALED' }); ctx.emit({ type: 'AUDIO_CUE', sfxId: 'heal' }); continue; }
    if (st.wristband) {
      if (!s.wristbands.includes(st.wristband)) s.wristbands.push(st.wristband);
      const wb = ctx.data.rules.wristbands?.[st.wristband];
      ctx.emit({ type: 'WRISTBAND_GAINED', wristbandId: st.wristband });
      ctx.emit({ type: 'AUDIO_CUE', sfxId: 'fanfare' });
      return say(ctx, '', `You received the ${wb?.name || st.wristband}!${wb?.note ? ' ' + wb.note : ''}`);
    }
    if (st.warp) { h.warp(ctx, st.warp); continue; }
    if (st.run) { s.script = { steps: ctx.data.dialogues[st.run], pc: 0 }; continue; }
    if (st.walkOff) {
      const zone = ctx.data.zones[s.zoneId], npc = (zone.npcs || []).find((n) => n.id === st.walkOff);
      if (npc?.leave) {
        const path = pathFor(ctx, npc, npc.leave, zone);
        if (path.length > 1) ctx.emit({ type: 'NPC_WALK_OFF', npcId: npc.id, sprite: npc.sprite, path });
      }
      continue;
    }
    if (st.stash) {
      if (s.scriptMode === 'CHAI_TENT_RECOVERY') h.rememberHut(ctx);
      s.script = null; s.scriptMode = null; s.dialogue = null;
      s.menu = { tab: 'WRISTBAND_ARM', hut: true };
      setMode(ctx, 'FANNY_PACK_MENU');
      return;
    }
    if (st.shop) {
      const boss = bossGate(ctx);
      if (boss) {
        const who = s.script.steps.slice(0, s.script.pc).reverse().find((x) => x.s)?.s || '';
        s.script.pc = s.script.steps.length;
        return say(ctx, who, (ctx.data.dialogues.shop_closed?.[0]?.t || 'Closed until {boss} is beaten.').replace('{boss}', boss));
      }
      s.script = null; s.shop = st.shop; setMode(ctx, 'SHOP'); return;
    }
    if (st.credits) { s.flags.finished = 1; ctx.emit({ type: 'CREDITS' }); continue; }
    if (st.battle) { h.startTrainerBattle(ctx, st.battle); return; }   // resumes through resumeAfterBattle
    if (st.wild) { h.startWildBattle(ctx, st.wild, st.level || 5, { scripted: true }); return; }
    if (st.mirror) { h.startMirrorBattle(ctx); return; }
    if (st.fx) { ctx.emit({ type: 'FX', fx: st.fx, npcId: st.at || null }); continue; }
    if (st.visitor !== undefined) { const fx = st.visitor ? (st.astral ? 'astral' : null) : s.visitorFx || null; ctx.emit({ type: 'VISITOR', sprite: st.visitor, fx, x: s.player.x, y: s.player.y }); s.visitor = st.visitor; s.visitorFx = st.visitor ? fx : null; continue; }
    if (st.tarot) { s.script = null; setMode(ctx, 'TAROT'); return; }
    if (st.restUntilSet) {
      // until the set you picked (pickSet), or the next one; the view plays the night going by, and shows you the stage
      const from = s.clock, next = restUntilSet(ctx, sc.wakeFor), here = next?.zone === s.zoneId;
      sc.wakeFor = null;
      ctx.emit({ type: 'CLOCK_SET', clock: s.clock, from, setId: next?.id || null, here });
      if (!next) return say(ctx, '', 'You doze off for a while.');
      return say(ctx, '', here ? `You doze off on a cushion. You wake at ${clockText(next.from)} to the bass coming up through the ground: the ${next.name} is starting, right here.`
        : `You doze off on a cushion. You wake at ${clockText(next.from)}, just as the ${next.name} starts at ${ctx.data.zones[next.zone].name}.`);
    }
    throw new Error(`unknown script step: ${JSON.stringify(st)}`);
  }
  throw new Error('script ran away (possible goto loop)');
}

function finish(ctx) {
  const s = ctx.state;
  s.script = null; s.dialogue = null; s.scriptMode = null; s.scene = null; s.visitor = null; s.visitorFx = null;
  setMode(ctx, 'OVERWORLD');
}

export function advance(ctx, choiceIndex) {
  const s = ctx.state, sc = s.script;
  if (s.dialogue?.choices) {
    const i = Math.max(0, Math.min(s.dialogue.choices.length - 1, choiceIndex ?? s.dialogue.choiceDefault ?? 0));
    if (sc && sc.nameChoice) { s.playerName = sc.nameChoice[i]; sc.nameChoice = null; }
    if (sc && sc.choiceGoto) { jump(sc, sc.choiceGoto[i]); sc.choiceGoto = null; }
    if (sc && sc.setPick) { const id = sc.setPick[i]; sc.setPick = null; if (id) sc.wakeFor = id; else if (sc.setCancel) jump(sc, sc.setCancel); }
  }
  runScript(ctx);
}
