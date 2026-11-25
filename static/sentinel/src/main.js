// Entry point: sets up the two canvases, keeps them sized to the screen, and runs the fixed-timestep loop.
import { computeViewport, insetsToLogical } from './engine/viewport.js';
import { FixedStep } from './engine/FixedStep.js';
import { DT } from './sim/constants.js';
import { Sim } from './sim/Sim.js';
import { Camera } from './engine/Camera.js';
import { Renderer, testFieldTerrain } from './engine/Renderer.js';
import { IslandMap } from './world/IslandMap.js';
import { InputManager } from './engine/InputManager.js';
import { AssetManager } from './engine/AssetManager.js';
import { smokeStatus, pixelsVary } from './engine/smokeStatus.js';

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
const renderer = new Renderer({ sprites: assets });
let camera = new Camera();
const DEBUG = new URLSearchParams(location.search).has('debug');
/** debug mode (src/engine/debug/, loaded only with ?debug): loop, input and drawing hooks; null otherwise */
let debug = null;
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
    const [tuning, mapJson] = await Promise.all([fetchJson('data/tuning.json'), useMap ? fetchJson('data/island_map.json') : null]);
    const map = mapJson ? IslandMap.fromJSON(mapJson, tuning) : null;
    renderer.terrainAt = map ? (c, r) => map.terrainAt(c, r) : testFieldTerrain;
    sim = new Sim({ map, tuning, data: {}, seed: SEED });
    camera = new Camera(tuning.camera);
    camera.setViewport(vp.logicalWidth, vp.logicalHeight);
    camera.setBounds(sim.bounds);
    camera.snapTo(sim.player.x, sim.player.y);
    input = new InputManager({ tuning, surface: uiCanvas });
    input.setViewport(vp, safe);
    framesAtLoad = framesRun;
    if (DEBUG) {
      window.__game = { get sim() { return sim; }, get camera() { return camera; }, input, assets };
    }
  } catch (e) {
    loadError = `could not load the game data (${e.message})`;
    console.error(e);
    return;
  }
  if (DEBUG) {
    // a dynamic import, so without ?debug the debug modules are never even fetched
    import('./engine/debug/DebugMode.js').then((m) => {
      debug = m.installDebug({
        get sim() { return sim; },
        setSim(s) { sim = s; camera.setBounds(s.bounds); camera.snapTo(s.player.x, s.player.y); },
        get camera() { return camera; }, get input() { return input; }, get vp() { return vp; }, get safe() { return safe; },
        assets, renderer, stepper, tick, uiCanvas,
      });
    }).catch((e) => console.error('debug mode failed to start', e));
  }
}

window.__smoke = () => {
  const img = worldCtx.getImageData(0, 0, worldCanvas.width, worldCanvas.height);
  return smokeStatus({
    frames: framesRun - framesAtLoad, ticks: ticksRun, loaded: !!sim, loadError,
    drawn: pixelsVary(img.data, 7), paused: !!debug?.paused,
  });
};

// ---- input ----------------------------------------------------------------------------------------------

/** @type {InputManager|null} keyboard, mouse and touch; null until the tuning has loaded */
let input = null;

// ---- frame ----------------------------------------------------------------------------------------------

function tick() {
  if (!sim) return;
  const live = input.nextTick({ camera, player: sim.player });
  const inp = debug?.nextInput() ?? live;   // a debug replay replaces the live input
  sim.step(inp);
  ticksRun++;
  debug?.afterStep(inp);
  // events must be read after every tick: the next step replaces the list
  for (const e of sim.events) if (e.type === 'shake') camera.addShake(e.amount);
}

function drawWorld(alpha, elapsed) {
  if (!sim) {
    worldCtx.fillStyle = '#0b1416';
    worldCtx.fillRect(0, 0, vp.logicalWidth, vp.logicalHeight);
    return;
  }
  const p = sim.player;
  camera.update(elapsed, p.prevX + (p.x - p.prevX) * alpha, p.prevY + (p.y - p.prevY) * alpha);
  renderer.render(worldCtx, sim, camera, { alpha, time: sim.time });
  debug?.drawWorld(worldCtx, alpha);
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
  if (input && sim) input.draw(ctx, { camera, player: sim.player });
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
  if (debug) debug.advance(elapsed, tick, now);   // pause, step and speed live in debug mode
  else stepper.advance(elapsed, tick);
  framesRun++;
  input?.takeUiActions();   // journal, inventory and pause screens arrive in later steps; until then the presses are dropped
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
