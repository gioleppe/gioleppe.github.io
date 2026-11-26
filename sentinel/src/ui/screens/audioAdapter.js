// The screens' view of the audio (built by the sound step): a tiny optional adapter, so the menus work with no
// audio at all, with the present AudioManager (setVolume / getVolume / setMuted / muted), or with the planned API
// (audio.volume.get/set(bus), audio.mute, audio.setScreen(name)). Nothing here throws.
import { DEFAULT_VOLUMES } from '../../engine/AudioManager.js';

export const AUDIO_BUSES = Object.freeze(['master', 'music', 'sfx']);

/**
 * @param {() => (Object|null|undefined)} source returns the audio object, or null while there is none
 */
export function audioAdapter(source) {
  const get = () => { try { return source() ?? null; } catch { return null; } };
  const call = (fn) => { try { return fn(); } catch { return undefined; } };
  return {
    /** true while some audio object exists */
    get available() { return !!get(); },
    /** 0..1, or null when unknown */
    getVolume(bus) {
      const a = get();
      if (!a) return null;
      const v = call(() => (a.volume?.get ? a.volume.get(bus) : a.getVolume?.(bus)));
      return Number.isFinite(v) ? v : null;
    },
    setVolume(bus, v) {
      const a = get();
      if (!a) return;
      const x = Math.max(0, Math.min(1, v));
      call(() => (a.volume?.set ? a.volume.set(bus, x) : a.setVolume?.(bus, x)));
    },
    get muted() {
      const a = get();
      if (!a) return false;
      const m = call(() => (typeof a.mute === 'object' && a.mute ? a.mute.get?.() : a.muted));
      return m === true;
    },
    setMuted(on) {
      const a = get();
      if (!a) return;
      call(() => {
        if (typeof a.mute === 'object' && a.mute?.set) a.mute.set(!!on);
        else if (typeof a.mute === 'function') a.mute(!!on);
        else a.setMuted?.(!!on);
      });
    },
    /** tell the music which screen is showing ('title' | 'game' | 'pause' | 'gameover' | ...) */
    setScreen(name) {
      const a = get();
      if (a?.setScreen) call(() => a.setScreen(name));
    },
    /** back to the default volumes (reset all data) */
    resetVolumes() {
      for (const b of AUDIO_BUSES) this.setVolume(b, DEFAULT_VOLUMES[b] ?? 0.8);
      this.setMuted(false);
    },
  };
}
