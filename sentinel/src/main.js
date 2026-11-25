// Entry point: sets up the two canvases, keeps them sized to the screen, and runs the fixed-timestep loop.
import { computeViewport, insetsToLogical } from './engine/viewport.js';
import { FixedStep } from './engine/FixedStep.js';
import { DT } from './sim/constants.js';
import { Sim } from './sim/Sim.js';
import { Camera } from './engine/Camera.js';
import { Renderer, testFieldTerrain } from './engine/Renderer.js';
import { IslandMap } from './world/IslandMap.js';
import { InputManager } from './engine/InputManager.js';
import { AssetManager, setActiveAssets } from './engine/AssetManager.js';
import { smokeStatus, pixelsVary } from './engine/smokeStatus.js';
import { drawHud } from './ui/HUD.js';
import { ResonanceFx } from './engine/ResonanceFx.js';
import { MapOverlay } from './ui/MapOverlay.js';
import './ui/hud/fogNotices.js';   // landmark and Shifting Paths notices join the shared queue
import { installItemHud } from './ui/hud/Hotbar.js';
import './ui/storyNotices.js';   // after the item HUD's notices: journal, crafting and shipwreck lines (some replace its own)
import { JournalUI } from './ui/JournalUI.js';
import { recipeViews } from './entities/Crafting.js';
import { ImpactEffects, drawAimMarker, throwPreview } from './engine/ItemRenderer.js';
import { DialogueUI } from './ui/DialogueUI.js';

const SEED = 1;

const gameBox = document.getElementById('game');
const worldCanvas = document.getElementById('world');
const uiCanvas = document.getElementById('ui');
const safeProbe = document.getElementById('safe-probe');
const worldCtx = worldCanvas.getContext('2d');   // not alpha:false: an opaque canvas gets LCD subpixel text, which fringes when scaled up
const uiCtx = uiCanvas.getContext('2d');

/** current Viewport (see engine/viewport.js) and safe-area insets in logical pixels */
let vp = computeViewport(1, 1);
let safe = { top: 0, right: 0, bottom: 0, left: 0 };
let buildLabel = '';
/** @type {Sim|null} null until the data has loaded */
let sim = null;
let loadError = '';
// placeholders draw from the first frame; real sheets take over one by one as they arrive
const assets = new AssetManager();
setActiveAssets(assets);   // the HUD, touch controls, map and emote bubbles draw from it
const renderer = new Renderer({ sprites: assets, resonanceFx: new ResonanceFx() });
let camera = new Camera();
const DEBUG = new URLSearchParams(location.search).has('debug');
/** debug mode (src/engine/debug/, loaded only with ?debug): loop, input and drawing hooks; null otherwise */
let debug = null;
/** @type {import('./ui/hud/Hotbar.js').ItemHud|null} hotbar, item notices and the interaction prompt */
let itemHud = null;
/** dust and splash where thrown things land */
const impactFx = new ImpactEffects();
/** liveness counters for window.__smoke */
let framesRun = 0;
let ticksRun = 0;
let framesAtLoad = 0;

// ---- screen ---------------------------------------------------------------------------------------------

function applyViewport() {
  const box = gameBox.getBoundingClientRect();
  vp = computeViewport(box.width, box.height, window.devicePixelRatio || 1);

  if (worldCanvas.width !== vp.logicalWidth || worldCanvas.height !== vp.logicalHeight) {
    worldCanvas.width = vp.logicalWidth;
    worldCanvas.height = vp.logicalHeight;
  }
  worldCanvas.style.width = `${vp.worldCssWidth}px`;
  worldCanvas.style.height = `${vp.worldCssHeight}px`;

  if (uiCanvas.width !== vp.uiWidth || uiCanvas.height !== vp.uiHeight) {
    uiCanvas.width = vp.uiWidth;
    uiCanvas.height = vp.uiHeight;
  }
  uiCanvas.style.width = `${vp.cssWidth}px`;
  uiCanvas.style.height = `${vp.cssHeight}px`;

  // resizing a canvas resets its context state, so these are set again every time
  worldCtx.imageSmoothingEnabled = false;
  uiCtx.setTransform(vp.uiScale, 0, 0, vp.uiScale, 0, 0);
  uiCtx.imageSmoothingEnabled = false;
  camera.setViewport(vp.logicalWidth, vp.logicalHeight);

  const cs = getComputedStyle(safeProbe);
  safe = insetsToLogical({
    top: parseFloat(cs.paddingTop), right: parseFloat(cs.paddingRight),
    bottom: parseFloat(cs.paddingBottom), left: parseFloat(cs.paddingLeft),
  }, vp.scale);
  input?.setViewport(vp, safe);
}

let resizeQueued = false;
function queueResize() {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => { resizeQueued = false; applyViewport(); });
}

new ResizeObserver(queueResize).observe(gameBox);
window.addEventListener('resize', queueResize);
window.addEventListener('orientationchange', queueResize);
window.visualViewport?.addEventListener('resize', queueResize);

// no context menu, long-press, pinch or pull-to-refresh on the game surface
const block = (e) => e.preventDefault();
document.addEventListener('contextmenu', block);
document.addEventListener('gesturestart', block);
document.addEventListener('touchmove', block, { passive: false });

// ---- build stamp ----------------------------------------------------------------------------------------

async function loadBuild() {
  try {
    const res = await fetch('build.json', { cache: 'no-store' });   // relative: the game lives under /sentinel/; only the published copy has it
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const build = await res.json();
    buildLabel = `v${build.version} ${build.commit}`;
  } catch {
    buildLabel = 'dev';
  }
}

// ---- data -----------------------------------------------------------------------------------------------

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });   // relative URL: the game is served from a subpath
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function loadGame() {
  try {
    const params = new URLSearchParams(location.search);
    // ?debug&map=none: the open test field instead of the island
    const useMap = !(params.has('debug') && params.get('map') === 'none');
    const [tuning, mapJson, items, dialogueMarek, lore, recipes] = await Promise.all([
      fetchJson('data/tuning.json'), useMap ? fetchJson('data/island_map.json') : null, fetchJson('data/items.json'), fetchJson('data/dialogue_marek.json'),
      fetchJson('data/lore_entries.json'), fetchJson('data/recipes.json'),
    ]);
    const map = mapJson ? IslandMap.fromJSON(mapJson, tuning) : null;
    renderer.terrainAt = map ? (c, r) => map.terrainAt(c, r) : testFieldTerrain;
    sim = new Sim({ map, tuning, data: { items, dialogue_marek: dialogueMarek, lore_entries: lore, recipes }, seed: SEED });
    camera = new Camera(tuning.camera);
    camera.setViewport(vp.logicalWidth, vp.logicalHeight);
    camera.setBounds(sim.bounds);
    camera.snapTo(sim.player.x, sim.player.y);
    input = new InputManager({ tuning, surface: uiCanvas });
    input.setViewport(vp, safe);
    // the island map lives in the Journal's Map tab, which forwards its input to it
    mapOverlay = new MapOverlay({ tuning });
    itemHud = installItemHud({ input, assets, tuning });
    // after the item HUD, so the dialogue's hit regions sit on top of the hotbar's
    dialogueUi = new DialogueUI({ input, assets, tuning });
    journalUi = new JournalUI({ input, assets, tuning, map: mapOverlay, recipes: (s) => recipeViews(s), onCraft: () => { craftTickPending = true; } });
    journalUi.attach({ surface: uiCanvas });
    framesAtLoad = framesRun;
    if (DEBUG) {
      window.__game = { get sim() { return sim; }, get camera() { return camera; }, input, assets, renderer, itemHud, mapOverlay, get dialogueUi() { return dialogueUi; }, get journalUi() { return journalUi; } };
    }
  } catch (e) {
    loadError = `could not load the game data (${e.message})`;
    console.error(e);
    return;
  }
  if (DEBUG) {
    // a dynamic import, so without ?debug the debug modules are never even fetched
    Promise.all([
      import('./engine/debug/DebugMode.js'), import('./engine/debug/worldDebug.js'), import('./engine/debug/playerDebug.js'),
      import('./engine/debug/resonanceDebug.js'),
    ]).then(([m, w, pd, r]) => {
      debug = m.installDebug({
        get sim() { return sim; },
        setSim(s) { sim = s; camera.setBounds(s.bounds); camera.snapTo(s.player.x, s.player.y); },
        get camera() { return camera; }, get input() { return input; }, get vp() { return vp; }, get safe() { return safe; },
        assets, renderer, stepper, tick, uiCanvas,
      });
      w.registerWorldDebug(debug);
      r.registerResonanceDebug(debug);
      pd.registerPlayerDebug(debug);
      import('./engine/debug/storyDebug.js').then((m) => m.registerStoryDebug(debug)).catch((e) => console.error('story debug failed to start', e));
      import('./engine/debug/journalDebug.js').then((m) => m.registerJournalDebug(debug)).catch((e) => console.error('journal debug failed to start', e));
      // every landmark of the island is a teleport target (debug "Go" page, __game.debug.teleportTo(id))
      debug.addPlaces((s) => (s.map ? s.map.entitiesOfType('landmark').map((l) => ({ id: l.id, label: l.name, x: l.x, y: l.y })) : []));
      import('./engine/debug/itemDebug.js').then((i) => i.registerItemDebug(debug)).catch((e) => console.error('item debug failed', e));
      import('./engine/debug/artDebug.js').then((a) => a.registerArtDebug(debug)).catch((e) => console.error('art debug failed', e));
      return import('./engine/debug/collisionLayers.js').then((c) => c.collisionLayers().forEach((l) => debug.addLayer(l)));
    }).catch((e) => console.error('debug mode failed to start', e));
  }
}

window.__smoke = () => {
  const img = worldCtx.getImageData(0, 0, worldCanvas.width, worldCanvas.height);
  return smokeStatus({
    frames: framesRun - framesAtLoad, ticks: ticksRun, loaded: !!sim, loadError,
    drawn: pixelsVary(img.data, 7), paused: !!debug?.paused || uiPaused(),
  });
};

// ---- input ----------------------------------------------------------------------------------------------

/** @type {InputManager|null} keyboard, mouse and touch; null until the tuning has loaded */
let input = null;
/** @type {MapOverlay|null} the island map, the Journal's Map tab; null until the tuning has loaded */
let mapOverlay = null;
/** @type {JournalUI|null} the Journal (Tab / J; I opens it on Recipes); null until the tuning has loaded */
let journalUi = null;
/** Make was pressed in the Journal: one tick runs at once (the world is paused) to carry the craft command */
let craftTickPending = false;

/** a screen that stops the world is open (the Journal; later the pause menu): no ticks run */
function uiPaused() {
  return !!journalUi?.isOpen;
}

/** the presentation-only actions of this frame: open and close the Journal */
function handleUiActions() {
  const ui = input?.takeUiActions();
  if (!ui || !sim || !journalUi) return;
  if (ui.openJournal) journalUi.toggle(sim);
  else if (ui.openInventory) journalUi.toggle(sim, 'recipes');   // the inventory is the hotbar; I shows what it can make
  else if (ui.pause && journalUi.isOpen) journalUi.close();
}
/** @type {DialogueUI|null} Marek's dialogue box; null until the tuning has loaded */
let dialogueUi = null;

// ---- frame ----------------------------------------------------------------------------------------------

function tick() {
  if (!sim) return;
  const live = input.nextTick({ camera, player: sim.player });
  live.journal = journalUi?.takeCommands() ?? null;   // read marks and crafts made in the Journal
  const inp = debug?.nextInput() ?? live;   // a debug replay replaces the live input
  sim.step(inp);
  ticksRun++;
  debug?.afterStep(inp);
  // events must be read after every tick: the next step replaces the list
  for (const e of sim.events) if (e.type === 'shake') camera.addShake(e.amount);
  itemHud?.onStep(sim);
  impactFx.onStep(sim);
}

function drawWorld(alpha, elapsed) {
  if (!sim) {
    worldCtx.fillStyle = '#0b1416';
    worldCtx.fillRect(0, 0, vp.logicalWidth, vp.logicalHeight);
    return;
  }
  const p = sim.player;
  // during a conversation the camera frames player and speaker above the dialogue box
  const focus = dialogueUi?.cameraFocus(sim, camera.viewH);
  if (focus) camera.update(elapsed, focus.x, focus.y);
  else camera.update(elapsed, p.prevX + (p.x - p.prevX) * alpha, p.prevY + (p.y - p.prevY) * alpha);
  renderer.render(worldCtx, sim, camera, { alpha, time: sim.time });
  impactFx.draw(worldCtx, camera, sim.time);
  if (input && !input.touchVisible) drawAimMarker(worldCtx, sim, camera, input.mouse);
  debug?.drawWorld(worldCtx, alpha);
}

/** room the HUD leaves for debug mode's tab at the top-left (nothing without ?debug) */
function hudReserve() {
  const m = debug?.panel?.m;
  return m ? { top: Math.max(0, Math.ceil(m.y + m.rowH + 2 - (safe.top || 0) - 4)) } : {};
}

function drawUi() {
  const ctx = uiCtx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
  ctx.setTransform(vp.uiScale, 0, 0, vp.uiScale, 0, 0);
  if (buildLabel) {
    ctx.font = '6px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(216, 210, 191, 0.45)';
    ctx.fillText(buildLabel, vp.uiLogicalWidth - safe.right - 3, vp.uiLogicalHeight - safe.bottom - 2);
  }
  const talking = !!dialogueUi?.open;
  if (sim && !sim.over && !talking) itemHud?.drawPrompt(ctx, sim, camera);
  if (sim) {
    // the HUD dims while the dialogue box is open (ctx.filter; where a browser lacks it the HUD stays bright)
    if (talking) ctx.filter = `brightness(${sim.tuning.dialogue.hudDim})`;
    drawHud(ctx, sim, vp, safe, { time: performance.now() / 1000, reserve: hudReserve() });
    ctx.filter = 'none';
  }
  if (input && sim) input.draw(ctx, { camera, player: sim.player, landing: (wx, wy) => throwPreview(sim, wx, wy) });
  if (talking) dialogueUi.draw(ctx, vp, safe, performance.now());
  if (journalUi?.isOpen) journalUi.draw(ctx, vp, safe, sim, performance.now());
  if (loadError) {
    ctx.font = '8px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e76f51';
    ctx.fillText(loadError, vp.uiLogicalWidth / 2, vp.uiLogicalHeight / 2);
  }
  debug?.drawUi(ctx, stepper.alpha);
}

// ---- loop -----------------------------------------------------------------------------------------------

const stepper = new FixedStep({ dt: DT });
let rafId = 0;
let lastTime = null;

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const elapsed = lastTime === null ? 0 : (now - lastTime) / 1000;
  lastTime = now;
  handleUiActions();   // the pause menu arrives in a later step; until then that press only closes the Journal
  if (uiPaused()) {
    stepper.reset();   // the world waits; on closing it resumes from now, without catch-up ticks
    if (craftTickPending) { craftTickPending = false; tick(); }   // a Make: exactly one tick, carrying the command
  } else if (debug) debug.advance(elapsed, tick, now);   // pause, step and speed live in debug mode
  else stepper.advance(elapsed, tick);
  framesRun++;
  if (sim) itemHud?.frame(sim);
  if (sim) dialogueUi?.sync(sim, elapsed);
  drawWorld(stepper.alpha, elapsed);
  drawUi();
}

function start() {
  if (rafId) return;
  lastTime = null;
  stepper.reset();
  rafId = requestAnimationFrame(frame);
}

function stop() {
  cancelAnimationFrame(rafId);
  rafId = 0;
}

// a hidden tab stops simulating; on return it resumes where it was instead of fast-forwarding
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

applyViewport();
loadBuild();
assets.load();
loadGame();
if (!document.hidden) start();
