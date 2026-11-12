// Browser entry point: load everything, then run the loop.
import { CanvasRenderer, W, H } from './CanvasRenderer.js';
import { InputAdapter } from './InputAdapter.js';
import { loadAll } from './assets.js';
import { Game, VERSION } from './Game.js';
import { drawText } from './font.js';
import { WebGLPostProcess } from './WebGLPostProcess.js';

const renderer = new CanvasRenderer(document.getElementById('game'));
if (!new URLSearchParams(location.search).has('nogl')) { const post = new WebGLPostProcess(renderer.canvas); if (post.ok) renderer.post = post; }
const g = renderer.g;
let audio = null;
const input = new InputAdapter(renderer, { onGesture: () => audio?.unlock() });
renderer.resize();

function splash(text) {
  g.fillStyle = '#0B0314'; g.fillRect(0, 0, W, H);
  drawText(g, text, W / 2, H / 2 - 4, { color: '#F9DCC4', align: 'center' });
  renderer.present();
}

async function boot() {
  splash('Loading...');
  const assets = await loadAll((p) => splash(`Loading ${Math.round(p * 100)}%`));
  const optional = async (path) => { try { return await import(path); } catch (e) { if (!/Failed to fetch|404|not found|Cannot find|error loading/i.test(String(e))) console.error(e); return null; } };
  const audioMod = await optional('./SynthAudio.js');
  if (audioMod) audio = new audioMod.SynthAudio();
  const game = new Game({ assets, input, renderer, audio });
  audio?.setVolume(game.settings.volume);
  for (const mod of ['./sceneView.js', './battleView.js', './menuView.js', './shopView.js', './settingsView.js', './creditsView.js', './noticeView.js', './quickView.js']) {
    const m = await optional(mod);
    if (m) m.install(game);
  }
  window.__game = game;   // handy for debugging and automated checks
  const q = new URLSearchParams(location.search);
  if (q.get('scenario')) game.loadScenario(q.get('scenario'), q.get('v'));   // dev: ?scenario=before_boss_5
  input.applyKeys(game.settings.keys);
  // a lost WebGL context (common when a phone backgrounds the tab): save, then start clean
  renderer.canvas.addEventListener('webglcontextlost', () => { game.save(false); setTimeout(() => location.reload(), 300); });
  // error hook: keep the last error for bug reports and tell the player their progress is safe
  const report = (msg) => { try { localStorage.setItem('chakrageddon.lastError', JSON.stringify({ msg: String(msg).slice(0, 500), at: new Date().toISOString(), v: VERSION })); } catch { /* storage blocked */ } game.say('Something went wrong. Your last autosave is safe.'); };
  addEventListener('error', (e) => report(e.message));
  addEventListener('unhandledrejection', (e) => report(e.reason));

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!document.hidden) {
      input.pollGamepad();
      game.update(dt);
      game.draw(g);
      renderer.present(game.fx?.(dt));
      input.endFrame();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => { last = performance.now(); if (document.hidden) audio?.suspend(); else { audio?.resume(); input.relock?.(); } });
}

boot().catch((e) => { console.error(e); splash('Could not start: ' + e.message); });

// offline support: on https, or on localhost with ?sw for testing (otherwise dev edits would be served stale)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || new URLSearchParams(location.search).has('sw'))) navigator.serviceWorker.register('sw.js').catch(() => {});
