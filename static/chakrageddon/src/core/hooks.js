// Glue between the overworld/script engines and the creature, battle, item and shop systems.
import { tl } from './i18n.js';
import { enterZone, canUse } from './OverworldEngine.js';
import { startWildBattle, startTrainerBattle, startMirrorBattle, battleAction, learnMove } from './BattleEngine.js';
import { createMon, addToCollection, healMon, nameOf, rememberable } from './mons.js';
import { applyItem, soldOut, ONE_OF_A_KIND } from './items.js';
import { setMode } from './ScriptEngine.js';

export const hooks = {
  startWildBattle,
  startTrainerBattle,
  startMirrorBattle,
  giveMon(ctx, speciesId, level) { return addToCollection(ctx, createMon(ctx, speciesId, level)); },
  /** A hut (Chai tent, bed, hammock): full heal, sober up, and with respawn remember it for whiteouts and fast travel. */
  healParty(ctx, respawn = true) {
    const s = ctx.state;
    for (const m of [...s.party, ...s.box]) healMon(ctx.data, m);
    s.intox = 0;
    if (respawn) hooks.rememberHut(ctx);
    ctx.emit({ type: 'INTOXICATION_CHANGED', oldLevel: 0, newLevel: 0 });
  },
  /** the last hut that took you in: where a whiteout wakes you, and a tuk-tuk stop */
  rememberHut(ctx) {
    const s = ctx.state, name = ctx.data.zones[s.zoneId].name;
    const place = s.scriptMode === 'CHAI_TENT_RECOVERY' ? tl('the Chai Tent at {0}', name) : name;
    s.lastTent = { zone: s.zoneId, x: s.player.x, y: s.player.y, place };
    if (!s.tents.some((t) => t.zone === s.zoneId)) s.tents.push({ zone: s.zoneId, x: s.player.x, y: s.player.y, name });
  },
  warp(ctx, w) { enterZone(ctx, w.zone, w.x, w.y, w.dir); },
};

const say = (ctx, text) => ctx.emit({ type: 'MESSAGE', text });

/** Commands beyond the overworld basics. */
export function handleExtra(ctx, cmd) {
  const s = ctx.state, d = ctx.data;
  switch (cmd.type) {
    case 'BATTLE_ACTION': if (s.mode === 'ASTRAL_BATTLE') battleAction(ctx, cmd); break;
    case 'LEARN_MOVE': if (s.mode === 'ASTRAL_BATTLE') learnMove(ctx, cmd.slot); break;

    case 'USE_ITEM': {
      if (s.mode !== 'FANNY_PACK_MENU' && s.mode !== 'OVERWORLD') break;
      const item = d.items[cmd.itemId];
      if (!item || !(s.bag[item.id] > 0)) break;
      if (item.category === 'BAGGING') { say(ctx, tl('Save it for a wild Astral.')); break; }
      if (item.category === 'KEY' && !item.effect?.dose) { say(ctx, item.desc); break; }
      if (item.category === 'OUTFIT') {      // cosmetic clothing: put it on, or take it off again
        if (s.outfit === item.effect.outfit) { s.outfit = null; say(ctx, tl('You take off the {0}.', item.name)); }
        else { s.outfit = item.effect.outfit; say(ctx, tl('You put on the {0}. Looking festival.', item.name)); }
        ctx.emit({ type: 'OUTFIT_CHANGED', outfit: s.outfit });
        break;
      }
      const res = applyItem(ctx, item, s.party[cmd.target], {});
      if (res.ok) { if (item.category !== 'KEY') s.bag[item.id]--; if (!item.effect?.evolve) ctx.emit({ type: 'AUDIO_CUE', sfxId: item.effect?.dose ? 'status' : 'heal' }); }   // an evolution brings its own music
      ctx.emit({ type: 'MESSAGE', text: res.text, ...(res.trip && res.ok ? { kind: 'trip' } : {}) });   // licking the blotter: a trip notice (Options can hide them)
      break;
    }
    case 'HOLD_ITEM': {     // give a HELD item to a party member, or take theirs back (itemId null)
      if (s.mode !== 'FANNY_PACK_MENU') break;
      const mon = s.party[cmd.partyIndex];
      if (!mon) break;
      const item = cmd.itemId ? d.items[cmd.itemId] : null;
      if (item && (item.category !== 'HELD' || !(s.bag[item.id] > 0))) break;
      if (mon.held) { s.bag[mon.held] = (s.bag[mon.held] || 0) + 1; }
      const was = mon.held; delete mon.held;
      if (item) { s.bag[item.id]--; mon.held = item.id; say(ctx, tl('{0} is now holding the {1}.', nameOf(d, mon), item.name)); }
      else if (was) say(ctx, tl('You take the {0} back.', d.items[was].name));
      break;
    }
    case 'NICKNAME': {      // a name of up to 12 printable characters; empty or the species name clears it
      if (s.mode !== 'FANNY_PACK_MENU') break;
      const mon = s.party[cmd.partyIndex];
      if (!mon) break;
      const name = String(cmd.name || '').replace(/[^ -~]/g, '').trim().slice(0, 12);
      if (!name || name === d.dex[mon.speciesId].name) delete mon.nickname; else mon.nickname = name;
      say(ctx, mon.nickname ? tl('From now on, {0} answers to {1}.', d.dex[mon.speciesId].name, mon.nickname) : tl('{0} goes by its own name again.', d.dex[mon.speciesId].name));
      break;
    }
    case 'SWAP_PARTY': {     // the Fanny Pack's Astrals page, or the Quick menu's team list
      if (s.mode !== 'FANNY_PACK_MENU' && s.mode !== 'OVERWORLD') break;
      const { a, b } = cmd;
      if (s.party[a] && s.party[b] && a !== b) [s.party[a], s.party[b]] = [s.party[b], s.party[a]];
      break;
    }
    case 'STASH_SWAP': {   // move between party and the Chai Tent stash (box): only while you sit at a Chai Tent
      if (s.mode !== 'FANNY_PACK_MENU') break;
      if (!s.menu?.hut) { say(ctx, tl('The stash is kept at the Chai Tents. Ask Chai Mama.')); break; }
      if (cmd.boxIndex !== undefined && cmd.partyIndex !== undefined && s.box[cmd.boxIndex] && s.party[cmd.partyIndex]) {
        [s.party[cmd.partyIndex], s.box[cmd.boxIndex]] = [s.box[cmd.boxIndex], s.party[cmd.partyIndex]];
        if (!s.party.some((m) => m.hp > 0)) { [s.party[cmd.partyIndex], s.box[cmd.boxIndex]] = [s.box[cmd.boxIndex], s.party[cmd.partyIndex]]; say(ctx, tl('Then nobody in your party could fight.')); }
        else say(ctx, tl('{0} joins. {1} stays with Chai Mama.', nameOf(d, s.party[cmd.partyIndex]), nameOf(d, s.box[cmd.boxIndex])));
      } else if (cmd.boxIndex !== undefined && s.box[cmd.boxIndex] && s.party.length < (d.rules.partyMax || 6)) s.party.push(...s.box.splice(cmd.boxIndex, 1));
      else if (cmd.partyIndex !== undefined && s.party.length > 1 && s.party[cmd.partyIndex]) {
        const rest = s.party.filter((_, i) => i !== cmd.partyIndex);
        if (rest.some((m) => m.hp > 0)) s.box.push(...s.party.splice(cmd.partyIndex, 1)); else say(ctx, tl('{0} is the only one still standing.', nameOf(d, s.party[cmd.partyIndex])));
      }
      break;
    }
    case 'BUY': {
      if (s.mode !== 'SHOP') break;
      const item = d.items[cmd.itemId], n = ONE_OF_A_KIND.includes(item?.category) ? 1 : Math.max(1, cmd.n || 1);
      if (!item || !d.rules.shops[s.shop]?.items.includes(item.id)) break;
      if (soldOut(s, item)) { say(ctx, tl('Sold out. There was only the one {0}, and you have it.', item.name)); ctx.emit({ type: 'AUDIO_CUE', sfxId: 'deny' }); break; }
      if (s.rupees < item.price * n) { say(ctx, tl('Not enough rupees.')); ctx.emit({ type: 'AUDIO_CUE', sfxId: 'deny' }); break; }
      s.rupees -= item.price * n; s.bag[item.id] = (s.bag[item.id] || 0) + n;
      ctx.emit({ type: 'RUPEES_CHANGED', rupees: s.rupees }); ctx.emit({ type: 'AUDIO_CUE', sfxId: 'coin' });
      say(ctx, tl('Bought {0} x {1}.', n, item.name));
      break;
    }
    case 'SELL': {
      if (s.mode !== 'SHOP') break;
      const item = d.items[cmd.itemId], n = Math.max(1, cmd.n || 1);
      if (!item || (s.bag[item.id] || 0) < n) break;
      if (item.category === 'KEY' || !item.price) { say(ctx, tl('Nobody will buy that.')); break; }
      s.bag[item.id] -= n; s.rupees += Math.floor(item.price / 2) * n;
      ctx.emit({ type: 'RUPEES_CHANGED', rupees: s.rupees }); ctx.emit({ type: 'AUDIO_CUE', sfxId: 'coin' });
      say(ctx, tl('Sold {0} x {1}.', n, item.name));
      break;
    }
    case 'CLOSE_SHOP': if (s.mode === 'SHOP') { s.shop = null; setMode(ctx, 'OVERWORLD'); } break;

    // the tarot reader (rules.tarot): an Astral remembers a move from its past lives, for a price. slot: the move it
    // forgets for it (none needed with a free slot)
    case 'RELEARN_MOVE': {
      if (s.mode !== 'TAROT') break;
      const mon = s.party[cmd.partyIndex], price = d.rules.tarot?.price ?? 500;
      if (!mon || !rememberable(d, mon).includes(cmd.moveId)) break;
      if (s.rupees < price) { say(ctx, tl('Not enough rupees.')); ctx.emit({ type: 'AUDIO_CUE', sfxId: 'deny' }); break; }
      const full = mon.moves.length >= 4;
      if (full && !(cmd.slot >= 0 && cmd.slot < mon.moves.length)) break;
      const old = full ? d.moves[mon.moves[cmd.slot]].name : null, mv = d.moves[cmd.moveId];
      if (full) mon.moves[cmd.slot] = cmd.moveId; else mon.moves.push(cmd.moveId);
      s.rupees -= price;
      ctx.emit({ type: 'RUPEES_CHANGED', rupees: s.rupees });
      ctx.emit({ type: 'MOVE_LEARNED', uid: mon.uid, name: nameOf(d, mon), moveId: cmd.moveId, remembered: true });
      ctx.emit({ type: 'AUDIO_CUE', sfxId: 'fanfare' });
      say(ctx, old ? tl('{0} forgot {1} and remembered {2}!', nameOf(d, mon), old, mv.name) : tl('{0} remembered {1}!', nameOf(d, mon), mv.name));
      break;
    }
    case 'CLOSE_TAROT': if (s.mode === 'TAROT') setMode(ctx, 'OVERWORLD'); break;

    case 'USE_FIELD_TECHNIQUE': {
      if (cmd.techniqueId !== 'share_taxi_tuktuk' || (s.mode !== 'FANNY_PACK_MENU' && s.mode !== 'OVERWORLD')) break;
      if (!canUse(ctx, 'share_taxi_tuktuk')) { say(ctx, tl('No tuk-tuk will take you without a VIP Press Pass.')); break; }
      const t = s.tents[cmd.tentIndex];
      if (!t) break;
      if (d.zones[s.zoneId].noFly) { say(ctx, tl('No tuk-tuk can reach you in here.')); break; }
      s.menu = null;
      setMode(ctx, 'OVERWORLD');
      ctx.emit({ type: 'FIELD_TECHNIQUE', techniqueId: 'share_taxi_tuktuk' });
      enterZone(ctx, t.zone, t.x, t.y, 'DOWN');
      break;
    }
    default: break;
  }
}
