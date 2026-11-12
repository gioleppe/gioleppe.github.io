// Glue between the overworld/script engines and the creature, battle, item and shop systems.
import { enterZone, canUse } from './OverworldEngine.js';
import { startWildBattle, startTrainerBattle, battleAction, learnMove } from './BattleEngine.js';
import { createMon, addToCollection, healMon, nameOf } from './mons.js';
import { applyItem } from './items.js';
import { setMode } from './ScriptEngine.js';

export const hooks = {
  startWildBattle,
  startTrainerBattle,
  giveMon(ctx, speciesId, level) { return addToCollection(ctx, createMon(ctx, speciesId, level)); },
  /** Chai tent: full heal, sober up, remember this tent for whiteouts and fast travel. */
  healParty(ctx) {
    const s = ctx.state;
    for (const m of [...s.party, ...s.box]) healMon(ctx.data, m);
    s.intox = 0;
    s.lastTent = { zone: s.zoneId, x: s.player.x, y: s.player.y };
    if (!s.tents.some((t) => t.zone === s.zoneId)) s.tents.push({ ...s.lastTent, name: ctx.data.zones[s.zoneId].name });
    ctx.emit({ type: 'INTOXICATION_CHANGED', oldLevel: 0, newLevel: 0 });
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
      if (item.category === 'BAGGING') { say(ctx, 'Save it for a wild Astral.'); break; }
      if (item.category === 'KEY' && !item.effect?.dose) { say(ctx, item.desc); break; }
      if (item.category === 'OUTFIT') {      // cosmetic clothing: put it on, or take it off again
        if (s.outfit === item.effect.outfit) { s.outfit = null; say(ctx, `You take off the ${item.name}.`); }
        else { s.outfit = item.effect.outfit; say(ctx, `You put on the ${item.name}. Looking festival.`); }
        ctx.emit({ type: 'OUTFIT_CHANGED', outfit: s.outfit });
        break;
      }
      const res = applyItem(ctx, item, s.party[cmd.target], {});
      if (res.ok) { if (item.category !== 'KEY') s.bag[item.id]--; ctx.emit({ type: 'AUDIO_CUE', sfxId: item.effect?.dose ? 'status' : 'heal' }); }
      say(ctx, res.text);
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
      if (item) { s.bag[item.id]--; mon.held = item.id; say(ctx, `${nameOf(d, mon)} is now holding the ${item.name}.`); }
      else if (was) say(ctx, `You take the ${d.items[was].name} back.`);
      break;
    }
    case 'NICKNAME': {      // a name of up to 12 printable characters; empty or the species name clears it
      if (s.mode !== 'FANNY_PACK_MENU') break;
      const mon = s.party[cmd.partyIndex];
      if (!mon) break;
      const name = String(cmd.name || '').replace(/[^ -~]/g, '').trim().slice(0, 12);
      if (!name || name === d.dex[mon.speciesId].name) delete mon.nickname; else mon.nickname = name;
      say(ctx, mon.nickname ? `From now on, ${d.dex[mon.speciesId].name} answers to ${mon.nickname}.` : `${d.dex[mon.speciesId].name} goes by its own name again.`);
      break;
    }
    case 'SWAP_PARTY': {
      if (s.mode !== 'FANNY_PACK_MENU') break;
      const { a, b } = cmd;
      if (s.party[a] && s.party[b] && a !== b) [s.party[a], s.party[b]] = [s.party[b], s.party[a]];
      break;
    }
    case 'STASH_SWAP': {   // move between party and the Chai Tent stash (box)
      if (s.mode !== 'FANNY_PACK_MENU') break;
      if (cmd.boxIndex !== undefined && cmd.partyIndex !== undefined && s.box[cmd.boxIndex] && s.party[cmd.partyIndex]) {
        [s.party[cmd.partyIndex], s.box[cmd.boxIndex]] = [s.box[cmd.boxIndex], s.party[cmd.partyIndex]];
        if (!s.party.some((m) => m.hp > 0)) [s.party[cmd.partyIndex], s.box[cmd.boxIndex]] = [s.box[cmd.boxIndex], s.party[cmd.partyIndex]];
      } else if (cmd.boxIndex !== undefined && s.box[cmd.boxIndex] && s.party.length < (d.rules.partyMax || 6)) s.party.push(...s.box.splice(cmd.boxIndex, 1));
      else if (cmd.partyIndex !== undefined && s.party.length > 1 && s.party[cmd.partyIndex]) {
        const rest = s.party.filter((_, i) => i !== cmd.partyIndex);
        if (rest.some((m) => m.hp > 0)) s.box.push(...s.party.splice(cmd.partyIndex, 1)); else say(ctx, `${nameOf(d, s.party[cmd.partyIndex])} is the only one still standing.`);
      }
      break;
    }
    case 'BUY': {
      if (s.mode !== 'SHOP') break;
      const item = d.items[cmd.itemId], n = Math.max(1, cmd.n || 1);
      if (!item || !d.rules.shops[s.shop]?.items.includes(item.id)) break;
      if (s.rupees < item.price * n) { say(ctx, 'Not enough rupees.'); ctx.emit({ type: 'AUDIO_CUE', sfxId: 'deny' }); break; }
      s.rupees -= item.price * n; s.bag[item.id] = (s.bag[item.id] || 0) + n;
      ctx.emit({ type: 'RUPEES_CHANGED', rupees: s.rupees }); ctx.emit({ type: 'AUDIO_CUE', sfxId: 'coin' });
      say(ctx, `Bought ${n} x ${item.name}.`);
      break;
    }
    case 'SELL': {
      if (s.mode !== 'SHOP') break;
      const item = d.items[cmd.itemId], n = Math.max(1, cmd.n || 1);
      if (!item || (s.bag[item.id] || 0) < n) break;
      if (item.category === 'KEY' || !item.price) { say(ctx, 'Nobody will buy that.'); break; }
      s.bag[item.id] -= n; s.rupees += Math.floor(item.price / 2) * n;
      ctx.emit({ type: 'RUPEES_CHANGED', rupees: s.rupees }); ctx.emit({ type: 'AUDIO_CUE', sfxId: 'coin' });
      say(ctx, `Sold ${n} x ${item.name}.`);
      break;
    }
    case 'CLOSE_SHOP': if (s.mode === 'SHOP') { s.shop = null; setMode(ctx, 'OVERWORLD'); } break;

    case 'USE_FIELD_TECHNIQUE': {
      if (cmd.techniqueId !== 'share_taxi_tuktuk' || (s.mode !== 'FANNY_PACK_MENU' && s.mode !== 'OVERWORLD')) break;
      if (!canUse(ctx, 'share_taxi_tuktuk')) { say(ctx, 'No tuk-tuk will take you without a VIP Press Pass.'); break; }
      const t = s.tents[cmd.tentIndex];
      if (!t) break;
      if (d.zones[s.zoneId].noFly) { say(ctx, 'No tuk-tuk can reach you in here.'); break; }
      s.menu = null;
      setMode(ctx, 'OVERWORLD');
      ctx.emit({ type: 'FIELD_TECHNIQUE', techniqueId: 'share_taxi_tuktuk' });
      enterZone(ctx, t.zone, t.x, t.y, 'DOWN');
      break;
    }
    default: break;
  }
}
