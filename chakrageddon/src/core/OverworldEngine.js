// Grid movement, collision, warps, field techniques, trainer line-of-sight and wild encounter rolls.
// Pure functions over ctx = { data, state, rng, emit }.
import { check } from './quests.js';
import { bandOf, bandIndex, egoGone } from './intox.js';
import { runScript, startScript } from './ScriptEngine.js';
import { liveSet, setOn } from './timetable.js';

export const DIRS = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };
const key = (x, y) => `${x},${y}`;

export const T = { FLOOR: 0, SOLID: 1, ENCOUNTER: 2, WATER: 3, CORDON: 4, FAIRY: 5, PUSH: 6, PADLOCK: 7, ROOTS: 8, CHAI: 9 };

export function zoneOf(ctx) { return ctx.data.zones[ctx.state.zoneId]; }

/** Tile character at x,y after clears and pushes; null outside the map. */
export function charAt(ctx, x, y, zone = zoneOf(ctx)) {
  if (y < 0 || y >= zone.rows.length || x < 0 || x >= zone.rows[y].length) return null;
  const s = ctx.state, k = key(x, y);
  const pushed = s.pushed[zone.zoneId];
  if (pushed && k in pushed) return pushed[k];
  const cleared = s.cleared[zone.zoneId];
  if (cleared && cleared[k]) return '.';
  return zone.rows[y][x];
}
export function logicAt(ctx, x, y, zone = zoneOf(ctx)) {
  const ch = charAt(ctx, x, y, zone);
  if (ch === null) return T.SOLID;
  const def = ctx.data.legend[ch];
  return def ? def.id : T.SOLID;
}

export function npcVisible(ctx, npc) {
  const f = ctx.state.flags;
  if (npc.showIf && !f[npc.showIf]) return false;
  if (npc.hideIf && f[npc.hideIf]) return false;
  if (npc.minIntox !== undefined && ctx.state.intox < npc.minIntox) return false;   // only there when you are high enough to see them
  if (npc.showWhen && !check(ctx.state, npc.showWhen, ctx.data)) return false;      // any quest condition (src/core/quests.js)
  if (npc.hideWhen && check(ctx.state, npc.hideWhen, ctx.data)) return false;
  if (npc.maxIntox !== undefined && ctx.state.intox > npc.maxIntox) return false;
  return true;
}
/** where an NPC is now: wanderers keep their position in state.npcPos, everyone else stays put */
export function npcPos(ctx, npc, zone = zoneOf(ctx)) {
  const p = ctx.state.npcPos?.[zone.zoneId]?.[npc.id];
  return p ? { x: p[0], y: p[1], dir: p[2] || npc.dir } : { x: npc.x, y: npc.y, dir: npc.dir };
}
export function entityAt(ctx, x, y, zone = zoneOf(ctx)) {
  for (const n of zone.npcs || []) { const p = npcPos(ctx, n, zone); if (p.x === x && p.y === y && npcVisible(ctx, n)) return { kind: 'npc', npc: n }; }
  for (const p of zone.pickups || []) {
    if (p.x !== x || p.y !== y || ctx.state.picked[p.id]) continue;
    if (p.hidden && !canUse(ctx, 'blacklight_uv_pulse')) continue;   // hidden stashes need the UV pulse
    if (p.minIntox !== undefined && ctx.state.intox < p.minIntox) continue;   // only there when you are high enough
    return { kind: 'pickup', pickup: p };
  }
  return null;
}

/** A field technique works when the wristband is owned and a party member has a matching type. */
export function canUse(ctx, techId) {
  const t = ctx.data.rules.techniques?.[techId];
  if (!t) return false;
  if (!ctx.state.wristbands.includes(t.wristband)) return false;
  if (!t.types || !t.types.length) return true;
  return ctx.state.party.some((m) => ctx.data.dex[m.speciesId].types.some((ty) => t.types.includes(ty)));
}
const TECH_FOR = { [T.WATER]: 'pink_flamingo_float', [T.FAIRY]: 'machete_hack', [T.PUSH]: 'bass_drop_shove', [T.PADLOCK]: 'jaw_grind', [T.ROOTS]: 'banyan_root_climb' };

function cordonOpen(ctx, zone) { return !!(zone.cordonFlag && ctx.state.flags[zone.cordonFlag]); }

/** a tile with egoFloor (the cow that walks off, the stairs of light) can be walked on only at Ego gone */
function egoFloorAt(ctx, x, y, zone) { const ch = charAt(ctx, x, y, zone); return !!(ch !== null && ctx.data.legend[ch]?.egoFloor); }
export function walkable(ctx, x, y, zone) {
  if (egoFloorAt(ctx, x, y, zone) && egoGone(ctx.data.rules, ctx.state.intox)) return true;
  const id = logicAt(ctx, x, y, zone);
  if (id === T.FLOOR || id === T.ENCOUNTER) return true;
  if (id === T.CORDON) return cordonOpen(ctx, zone);
  if (id === T.WATER) return canUse(ctx, 'pink_flamingo_float');
  if (id === T.ROOTS) return canUse(ctx, 'banyan_root_climb');
  return false;
}

function useTechnique(ctx, id, x, y, dir, zone) {
  const s = ctx.state, techId = TECH_FOR[id];
  if (!techId || !canUse(ctx, techId)) return false;
  if (id === T.FAIRY || id === T.PADLOCK) {
    (s.cleared[zone.zoneId] ||= {})[key(x, y)] = 1;
    ctx.emit({ type: 'FIELD_TECHNIQUE', techniqueId: techId, x, y });
    ctx.emit({ type: 'AUDIO_CUE', sfxId: 'technique' });
    return true;
  }
  if (id === T.PUSH) {
    const [dx, dy] = DIRS[dir], tx = x + dx, ty = y + dy;
    if (logicAt(ctx, tx, ty, zone) !== T.FLOOR || entityAt(ctx, tx, ty, zone) || (zone.warps || []).some((w) => w.x === tx && w.y === ty)) return false;
    const pushed = (s.pushed[zone.zoneId] ||= {});
    const ch = charAt(ctx, x, y, zone);
    pushed[key(x, y)] = '.';
    pushed[key(tx, ty)] = ch;
    ctx.emit({ type: 'FIELD_TECHNIQUE', techniqueId: techId, x, y, to: [tx, ty] });
    ctx.emit({ type: 'AUDIO_CUE', sfxId: 'push' });
    return true;
  }
  return false;
}

export function isNight(state) { const h = Math.floor(state.clock / 60) % 24; return h >= 19 || h < 6; }

// Dusk and dawn are two-hour ramps centred on the turn (19:00 and 06:00), so the light changes gradually and
// isNight flips halfway through, when it is half dark.
export const DUSK = [18 * 60, 20 * 60], DAWN = [5 * 60, 7 * 60];
const smooth = (k) => { const x = Math.max(0, Math.min(1, k)); return x * x * (3 - 2 * x); };
/** how dark it is outdoors, 0 (day) to 1 (night), for a clock in minutes */
export function nightLevel(clock) {
  const m = ((clock % 1440) + 1440) % 1440;
  if (m >= DUSK[0] && m < DUSK[1]) return smooth((m - DUSK[0]) / (DUSK[1] - DUSK[0]));
  if (m >= DAWN[0] && m < DAWN[1]) return 1 - smooth((m - DAWN[0]) / (DAWN[1] - DAWN[0]));
  return m >= DUSK[1] || m < DAWN[0] ? 1 : 0;
}

/** If the player stands somewhere they could not have walked to (a save or a tent spot from before a map was
 *  redrawn, off the edge, on a wall or on someone), move them to the nearest open tile. */
export function settle(ctx) {
  const s = ctx.state, zone = zoneOf(ctx), p = s.player;
  // a trainer who walked up to you stays on the line they watch; a spot off that line comes from an older map
  for (const [zid, pos] of Object.entries(s.npcPos || {})) for (const [id, [x, y]] of Object.entries(pos)) {
    const n = (ctx.data.zones[zid]?.npcs || []).find((m) => m.id === id);
    if (!n || n.wander) continue;
    const [dx, dy] = DIRS[n.dir || 'DOWN'], d = dx ? (x - n.x) * dx : (y - n.y) * dy;
    if (!(d >= 0 && d <= (n.sight ?? 4) && x === n.x + dx * d && y === n.y + dy * d)) delete pos[id];
  }
  const ok = (x, y) => walkable(ctx, x, y, zone) && !entityAt(ctx, x, y, zone) && !(zone.warps || []).some((w) => w.x === x && w.y === y);
  if (ok(p.x, p.y)) return false;
  const H = zone.rows.length, W = zone.rows[0].length;
  const sx = Math.max(0, Math.min(W - 1, p.x)), sy = Math.max(0, Math.min(H - 1, p.y));
  const seen = new Set([`${sx},${sy}`]), queue = [[sx, sy]];
  while (queue.length) {
    const [x, y] = queue.shift();
    if (ok(x, y)) { p.x = x; p.y = y; return true; }
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && !seen.has(k)) { seen.add(k); queue.push([nx, ny]); }
    }
  }
  return false;
}

export function enterZone(ctx, zoneId, x, y, dir) {
  if (ctx.state.npcPos) delete ctx.state.npcPos[zoneId];          // wanderers start from home on each visit
  for (const f of ctx.data.zones[zoneId].resetOnEnter || []) delete ctx.state.flags[f];   // e.g. a legendary that slipped away comes back
  // things that only happen sometimes, decided as you walk in: { flag, chance, minIntox } (your reflection, at Ego gone)
  for (const r of ctx.data.zones[zoneId].onEnter || []) {
    delete ctx.state.flags[r.flag];
    if (!(ctx.state.intox < (r.minIntox ?? 0)) && ctx.rng.chance(r.chance ?? 1)) ctx.state.flags[r.flag] = 1;
  }
  ctx.state.said = {};                                               // high lines and hints: once per visit
  const s = ctx.state, from = s.zoneId;
  s.zoneId = zoneId; s.player.x = x; s.player.y = y; if (dir) s.player.dir = dir;
  delete s.pushed[zoneId];
  s.visited[zoneId] = 1;
  const zone = ctx.data.zones[zoneId];
  settle(ctx);
  ctx.emit({ type: 'ZONE_CHANGED', from, to: zoneId, name: zone.name });
  ctx.emit({ type: 'AUDIO_CUE', trackBpm: zone.baseBpm, lowPassFilterHz: 20000 });
}

export function step(ctx, dir) {
  const s = ctx.state, zone = zoneOf(ctx), [dx, dy] = DIRS[dir];
  s.player.dir = dir;
  const from = [s.player.x, s.player.y], nx = from[0] + dx, ny = from[1] + dy;
  if (entityAt(ctx, nx, ny, zone)) return bump(ctx);
  if (!walkable(ctx, nx, ny, zone)) {
    const id = logicAt(ctx, nx, ny, zone);
    if (useTechnique(ctx, id, nx, ny, dir, zone)) return;
    return bump(ctx);
  }
  s.player.x = nx; s.player.y = ny;
  s.steps++;
  // the festival clock: one minute every few steps, so an hour is about a minute of walking
  s.clockSteps = (s.clockSteps || 0) + 1;
  if (s.clockSteps >= (ctx.data.rules.stepsPerMinute || 1)) { s.clockSteps = 0; s.clock = (s.clock + 1) % 1440; }
  s.intox = Math.max(0, s.intox - (ctx.data.rules.intoxStepDecay ?? 0.002));
  if (s.repel > 0) s.repel--;
  const id = logicAt(ctx, nx, ny, zone);
  ctx.emit({ type: 'ENTITY_MOVED', entityId: 'player', from, to: [nx, ny], floating: id === T.WATER });

  const warp = (zone.warps || []).find((w) => w.x === nx && w.y === ny);
  if (warp) { enterZone(ctx, warp.to, warp.tx, warp.ty, warp.dir); return; }

  if (checkTrainerSight(ctx, zone)) return;
  wander(ctx, zone);

  const enc = zone.encounters;
  if (enc && s.party.length && (id === T.ENCOUNTER || (id === T.WATER && enc.water)) && s.repel <= 0) {
    const band = bandOf(ctx.data.rules, s.intox);
    if (ctx.rng.chance(Math.min(0.9, enc.encounterRate * (band.encounter ?? 1)))) {
      const base = (id === T.WATER && enc.water) || (isNight(s) && enc.nightTable) || enc.table;
      // some Astrals only show themselves to people who are high enough (minIntox)
      // ...some only at night, and some only while their set is playing (set: id, the festival timetable)
      const live = liveSet(ctx.data, s, zone.zoneId)?.id;
      const extra = live && base !== enc.table ? (enc.table || []).filter((e) => e.set === live) : [];   // a set's Astral comes out at night too
      const table = [...base, ...extra].filter((e) => !(e.minIntox > s.intox) && !(e.night && !isNight(s)) && !(e.set && e.set !== live));
      // higher bands tilt the odds towards species with a high intoxication weight
      const tilt = band.tilt || 0;
      const weightOf = (e) => (tilt ? Math.max(e.weight * 0.2, e.weight * (1 + tilt * ((ctx.data.dex[e.speciesId].intoxicationWeight ?? 0.4) - 0.4) * 2)) : e.weight);
      const pick = ctx.rng.weighted(table, weightOf);
      const level = Math.min(60, ctx.rng.int(pick.minLevel, pick.maxLevel) + (band.wildLevel || 0));
      ctx.emit({ type: 'WILD_ENCOUNTER', speciesId: pick.speciesId, level });
      ctx.hooks.startWildBattle?.(ctx, pick.speciesId, level);
    }
  }
}
/** small deterministic hash, so wandering does not touch the game's random numbers */
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
/** NPCs with wander: [x0, y0, x1, y1] take a step inside that box now and then, as the player walks */
function wander(ctx, zone) {
  const s = ctx.state;
  for (const n of zone.npcs || []) {
    if (!n.wander || n.trainer || !npcVisible(ctx, n)) continue;
    const h = hash(`${n.id}:${s.steps}`);
    if (h % 3) continue;                                   // about one step in three
    const p = npcPos(ctx, n, zone), dir = Object.keys(DIRS)[(h >>> 4) % 4], [dx, dy] = DIRS[dir];
    const nx = p.x + dx, ny = p.y + dy, [x0, y0, x1, y1] = n.wander;
    (s.npcPos ||= {})[zone.zoneId] ||= {};
    const id = logicAt(ctx, nx, ny, zone);
    const free = nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1 && (id === T.FLOOR || id === T.ENCOUNTER) && !entityAt(ctx, nx, ny, zone)
      && !(nx === s.player.x && ny === s.player.y) && !(zone.warps || []).some((w) => w.x === nx && w.y === ny);
    s.npcPos[zone.zoneId][n.id] = free ? [nx, ny, dir] : [p.x, p.y, dir];
    if (free) ctx.emit({ type: 'NPC_MOVED', npcId: n.id, from: [p.x, p.y], to: [nx, ny], dir });
  }
}
function bump(ctx) { ctx.emit({ type: 'BUMP', dir: ctx.state.player.dir }); }

/**
 * Coming down at the wrong moment. A zone that exists only at Ego gone (egoOnly: { zone, x, y, dir, text }) sends you
 * back where you came in; standing on a tile that is only floor at Ego gone, you land on the zone's egoFall spot
 * ({ zone, x, y, dir, text }, the stairs of light over the sea) or, without one, on the nearest open tile.
 */
export function egoCheck(ctx) {
  const s = ctx.state, zone = zoneOf(ctx);
  if (!zone || egoGone(ctx.data.rules, s.intox)) return false;
  const back = zone.egoOnly || (egoFloorAt(ctx, s.player.x, s.player.y, zone) && !walkable(ctx, s.player.x, s.player.y, zone) && (zone.egoFall || 'settle'));
  if (!back) return false;
  if (back === 'settle') { settle(ctx); ctx.emit({ type: 'PLAYER_PLACED', x: s.player.x, y: s.player.y }); return true; }
  enterZone(ctx, back.zone, back.x, back.y, back.dir);
  if (back.text) ctx.emit({ type: 'MESSAGE', text: back.text });
  return true;
}

/**
 * What a person says first when you talk to them, before their usual script: a line for when you are high (data
 * highlines.lines: { s, peak, ego }) or a hint about an Astral that only comes out when you are higher (highlines.hints:
 * { s, t, species }, until you have seen it). Each once per visit; trainers only once they are beaten.
 */
function opener(ctx, npc) {
  const s = ctx.state, H = ctx.data.highlines || {}, said = (s.said ||= {});
  if (npc.trainer && !s.defeated[npc.trainer]) return [];
  const script = npc.script && ctx.data.dialogues[npc.script];
  const own = Array.isArray(script) && script.some((st) => st.ifIntox !== undefined);   // already has its own high lines
  const line = H.lines?.[npc.id], hint = H.hints?.[npc.id];
  const peak = bandIndex(ctx.data.rules, s.intox) >= 2;                                 // Peaking and up
  if (line && !own && peak && !said[npc.id]) {
    said[npc.id] = 1;
    const text = egoGone(ctx.data.rules, s.intox) && line.ego ? line.ego : line.peak;
    if (text) return [{ s: line.s, t: text, style: 'PSYCHEDELIC' }];
  }
  if (hint && !said[`hint:${npc.id}`] && !s.dex.seen[hint.species]) {
    const need = Math.min(...Object.values(ctx.data.zones).flatMap((z) => [...(z.encounters?.table || []), ...(z.encounters?.water || [])]).filter((e) => e.speciesId === hint.species).map((e) => e.minIntox ?? 0));
    if (s.intox < need) { said[`hint:${npc.id}`] = 1; return [{ s: hint.s, t: hint.t }]; }
  }
  return [];
}

function sightRange(ctx, npc) {
  let r = npc.sight ?? 4;
  if ((ctx.state.bag.wraparound_shades || 0) > 0) r -= 1;
  return Math.max(1, r);
}
export function checkTrainerSight(ctx, zone) {
  const s = ctx.state;
  if (!s.party.length) return false;
  for (const npc of zone.npcs || []) {
    if (!npc.trainer || s.defeated[npc.trainer] || !npcVisible(ctx, npc) || npc.sight === 0) continue;
    const [dx, dy] = DIRS[npc.dir || 'DOWN'];
    for (let d = 1; d <= sightRange(ctx, npc); d++) {
      const x = npc.x + dx * d, y = npc.y + dy * d;
      if (x === s.player.x && y === s.player.y) {
        ctx.emit({ type: 'EYE_CONTACT', npcId: npc.id, x: npc.x, y: npc.y });
        ctx.emit({ type: 'AUDIO_CUE', sfxId: 'alert' });
        // they walk right up to you before they start talking
        if (d > 1) {
          const ax = npc.x + dx * (d - 1), ay = npc.y + dy * (d - 1);
          ((s.npcPos ||= {})[zone.zoneId] ||= {})[npc.id] = [ax, ay, npc.dir || 'DOWN'];
          ctx.emit({ type: 'NPC_MOVED', npcId: npc.id, from: [npc.x, npc.y], to: [ax, ay], dir: npc.dir || 'DOWN', walkUp: true });
        }
        startTrainerFlow(ctx, npc, 'EYE_CONTACT_CUTSCENE');
        return true;
      }
      const id = logicAt(ctx, x, y, zone);
      if (!(id === T.FLOOR || id === T.ENCOUNTER) || entityAt(ctx, x, y, zone)) break;
    }
  }
  return false;
}

export function startTrainerFlow(ctx, npc, mode = 'DIALOGUE') {
  const t = ctx.data.trainers[npc.trainer];
  const steps = [];
  // a boss's cutscene: in full the first time, the short title card after that (a retry after a whiteout)
  if (t.cutscene) {
    const seen = ctx.state.flags[`cutscene_${t.cutscene}`];
    // the first time, the arrival: the music drops, the crowd turns, the camera goes to them (the view holds the rest)
    if (!seen && t.boss) ctx.emit({ type: 'BOSS_ARRIVAL', npcId: npc.id, x: npc.x, y: npc.y });
    steps.push({ scene: 'boss', who: t.cutscene, ...(seen ? { card: true } : {}) });
    if (!seen) steps.push({ set: `cutscene_${t.cutscene}` });
  }
  for (const line of t.intro || []) steps.push({ s: t.name, t: line, style: t.textStyle });
  if (t.cutscene) steps.push({ scene: null });
  steps.push({ battle: t.id });
  for (const line of t.defeat || []) steps.push({ s: t.name, t: line, style: t.textStyle });
  if (t.wristband) steps.push({ scene: 'wristband', who: t.wristband, by: t.sprite }, { wristband: t.wristband }, { scene: null });   // a short ceremony
  if (t.gives) steps.push({ give: t.gives, n: 1 });
  if (t.setFlag) steps.push({ set: t.setFlag });
  if (t.then) steps.push({ run: t.then });
  startScript(ctx, steps, mode);
}

/** a beaten trainer with { rematch, rematchBands, rematchFlag } offers a stronger rematch once you have progressed */
export function rematchReady(ctx, t) {
  const s = ctx.state, re = t?.rematch && ctx.data.trainers[t.rematch];
  if (!re || s.defeated[re.id] || !s.defeated[t.id]) return false;
  if (t.rematchBands !== undefined && s.wristbands.length < t.rematchBands) return false;
  if (t.rematchFlag && !s.flags[t.rematchFlag]) return false;
  if (t.rematchSet && !setOn(ctx.data, s, t.rematchSet)) return false;   // Diabolo only takes you on again during his set
  return true;
}
/** ready for a rematch except that their set is not playing: they tell you when to come back */
function rematchWaits(ctx, t) {
  return !!t?.rematchSet && !!ctx.state.flags.timetable && rematchReady(ctx, { ...t, rematchSet: null });
}
function startRematch(ctx, t) {
  const re = ctx.data.trainers[t.rematch], st = t.textStyle;
  const steps = [
    { s: t.name, t: re.offer || 'You again. Want to see how much I have grown?', style: st, choice: ['Bring it', 'Not now'], goto: ['go', 'no'] },
    { label: 'go' },
    ...(t.cutscene ? [{ scene: 'boss', who: t.cutscene, card: true }] : []),     // a rematch: the short title card
    ...(re.intro || []).map((line) => ({ s: re.name, t: line, style: st })),
    ...(t.cutscene ? [{ scene: null }] : []),
    { battle: re.id },
    ...(re.defeat || []).map((line) => ({ s: re.name, t: line, style: st })),
    { end: true },
    { label: 'no' },
    { s: t.name, t: t.after || '...', style: st },
  ];
  startScript(ctx, steps);
}

const HINTS = {
  [T.WATER]: 'Foam and shallows. You would need something that floats.',
  [T.FAIRY]: 'A knot of fairy lights and bamboo. Something sharp would help.',
  [T.PUSH]: 'Far too heavy to move. For now.',
  [T.PADLOCK]: 'A padlocked VIP fence. Somebody could chew through that.',
  [T.ROOTS]: 'Banyan roots climb the cliff. Not for a beginner.',
  [T.CORDON]: 'A bouncer cordon. "Not tonight, boss."',
};

export function interact(ctx) {
  const s = ctx.state, zone = zoneOf(ctx), [dx, dy] = DIRS[s.player.dir];
  const x = s.player.x + dx, y = s.player.y + dy;
  const ent = entityAt(ctx, x, y, zone);
  if (ent?.kind === 'npc') {
    const npc = ent.npc;
    ctx.emit({ type: 'NPC_FACE', npcId: npc.id, dir: { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' }[s.player.dir] });
    if (npc.trainer && !s.defeated[npc.trainer]) return startTrainerFlow(ctx, npc);
    if (npc.trainer && rematchReady(ctx, ctx.data.trainers[npc.trainer])) return startRematch(ctx, ctx.data.trainers[npc.trainer]);
    if (npc.trainer && rematchWaits(ctx, ctx.data.trainers[npc.trainer])) { const t = ctx.data.trainers[npc.trainer]; return startScript(ctx, [{ s: t.name, t: t.setWait, style: t.textStyle }]); }
    const first = opener(ctx, npc);
    if (npc.trainer && !npc.script) {
      const t = ctx.data.trainers[npc.trainer];
      return startScript(ctx, [...first, { s: t.name, t: t.after || '...', style: t.textStyle }]);
    }
    if (npc.script) return startScript(ctx, [...first, ...(ctx.data.dialogues[npc.script] || [{ t: `(missing script ${npc.script})` }])]);
    return;
  }
  if (ent?.kind === 'pickup') {
    const p = ent.pickup;
    s.picked[p.id] = 1;
    return startScript(ctx, [{ give: p.item, n: p.n || 1 }]);
  }
  const id = logicAt(ctx, x, y, zone);
  if (id === T.CHAI) return startScript(ctx, ctx.data.dialogues.chai_tent || [{ heal: true }], 'CHAI_TENT_RECOVERY');
  if (id === T.CORDON && cordonOpen(ctx, zone)) return;
  if (useTechnique(ctx, id, x, y, s.player.dir, zone)) return;
  if (HINTS[id] && !(TECH_FOR[id] && canUse(ctx, TECH_FOR[id]))) startScript(ctx, [{ t: (id === T.CORDON && zone.cordonText) || HINTS[id] }]);
}

export { runScript };
