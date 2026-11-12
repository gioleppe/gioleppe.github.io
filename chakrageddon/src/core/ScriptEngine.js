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
//   { heal } { shop: id } { battle: trainerId } { wild: species, level } { wristband: id }
//   { warp: { zone, x, y, dir } } { run: scriptId } { credits } { end }
//   { scene: id, show?: speciesId, phase?: n }  full-screen backdrop behind the dialogue (the opening dream); { scene: null } ends it
//                                    phase: a scene with several beats (the Vicchio landing) moves on to beat n
//                                    { scene: 'boss', who, card? }: a boss's cutscene; card: only the short title card
//   a choice with nameChoice: true also sets the player's name to the chosen answer
// Text may contain {player}, replaced by the player's name.
// The interpreter runs until it has something to show, then waits for ADVANCE_DIALOGUE.

import { check } from './quests.js';

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

const fill = (s, text) => String(text ?? '').replace(/\{player\}/g, s.playerName || 'friend');

function say(ctx, speaker, text, style, choices, extra = {}) {
  const s = ctx.state;
  speaker = fill(s, speaker); text = fill(s, text);
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
    if (st.scene !== undefined) { s.scene = st.scene ? { id: st.scene, ...(st.show ? { show: st.show } : {}), ...(st.phase ? { phase: st.phase } : {}), ...(st.who ? { who: st.who } : {}), ...(st.card ? { card: true } : {}) } : null; continue; }
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
    if (st.heal) { h.healParty(ctx); ctx.emit({ type: 'PARTY_HEALED' }); ctx.emit({ type: 'AUDIO_CUE', sfxId: 'heal' }); continue; }
    if (st.wristband) {
      if (!s.wristbands.includes(st.wristband)) s.wristbands.push(st.wristband);
      const wb = ctx.data.rules.wristbands?.[st.wristband];
      ctx.emit({ type: 'WRISTBAND_GAINED', wristbandId: st.wristband });
      ctx.emit({ type: 'AUDIO_CUE', sfxId: 'fanfare' });
      return say(ctx, '', `You received the ${wb?.name || st.wristband}!${wb?.note ? ' ' + wb.note : ''}`);
    }
    if (st.warp) { h.warp(ctx, st.warp); continue; }
    if (st.run) { s.script = { steps: ctx.data.dialogues[st.run], pc: 0 }; continue; }
    if (st.shop) { s.script = null; s.shop = st.shop; setMode(ctx, 'SHOP'); return; }
    if (st.credits) { s.flags.finished = 1; ctx.emit({ type: 'CREDITS' }); continue; }
    if (st.battle) { h.startTrainerBattle(ctx, st.battle); return; }   // resumes through resumeAfterBattle
    if (st.wild) { h.startWildBattle(ctx, st.wild, st.level || 5, { scripted: true }); return; }
    throw new Error(`unknown script step: ${JSON.stringify(st)}`);
  }
  throw new Error('script ran away (possible goto loop)');
}

function finish(ctx) {
  const s = ctx.state;
  s.script = null; s.dialogue = null; s.scriptMode = null; s.scene = null;
  setMode(ctx, 'OVERWORLD');
}

export function advance(ctx, choiceIndex) {
  const s = ctx.state, sc = s.script;
  if (s.dialogue?.choices) {
    const i = Math.max(0, Math.min(s.dialogue.choices.length - 1, choiceIndex ?? s.dialogue.choiceDefault ?? 0));
    if (sc && sc.nameChoice) { s.playerName = sc.nameChoice[i]; sc.nameChoice = null; }
    if (sc && sc.choiceGoto) { jump(sc, sc.choiceGoto[i]); sc.choiceGoto = null; }
  }
  runScript(ctx);
}
