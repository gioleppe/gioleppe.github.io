// Player settings remembered across visits: one JSON object under one namespaced localStorage key.
// Storage can be missing or throw (private browsing, blocked site data, quota): every access is guarded and the
// settings then simply live in memory for the session.

export const SETTINGS_KEY = 'sentinel.settings.v1';

/** localStorage if it can be touched, else null (merely reading `localStorage` can throw) */
function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export class Settings {
  /**
   * @param {{ storage?: { getItem: Function, setItem: Function } | null, key?: string, defaults?: object }} [opts]
   */
  constructor({ storage = defaultStorage(), key = SETTINGS_KEY, defaults = {} } = {}) {
    this.storage = storage;
    this.key = key;
    this.defaults = { ...defaults };
    this.values = {};
    try {
      const raw = storage?.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.values = parsed;
    } catch { /* unreadable or corrupt: start from the defaults */ }
  }

  /** the stored value, else the default given here, else the constructor default */
  get(name, fallback) {
    if (Object.prototype.hasOwnProperty.call(this.values, name)) return this.values[name];
    return fallback !== undefined ? fallback : this.defaults[name];
  }

  /** set and persist; returns false if it could only be kept in memory */
  set(name, value) {
    this.values[name] = value;
    return this.#save();
  }

  /** forget a value (back to the default) */
  remove(name) {
    delete this.values[name];
    return this.#save();
  }

  /** every value with defaults filled in */
  all() { return { ...this.defaults, ...this.values }; }

  #save() {
    try {
      if (!this.storage) return false;
      this.storage.setItem(this.key, JSON.stringify(this.values));
      return true;
    } catch { return false; }
  }
}
