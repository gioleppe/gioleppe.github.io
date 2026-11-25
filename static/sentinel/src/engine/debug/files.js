// Moving debug documents (snapshots, recordings) in and out of the page as JSON files.

/**
 * True for a URL relative to the page (`scenarios/wreck.json`, `../x.json`), false for anything with a scheme,
 * a host (`//host/x`) or an absolute path (`/x`): the game lives under a subpath and loads only its own files.
 * @param {string} url
 */
export function isRelativeUrl(url) {
  return typeof url === 'string' && url.length > 0 && !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('/') && !url.startsWith('\\');
}

/** save an object as a .json download */
export function downloadJson(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

let picker = null;

/**
 * Ask the viewer for a JSON file (must run inside a tap or key handler, which the panel's taps are).
 * @returns {Promise<object|null>} the parsed file, or null if nothing was picked
 */
export function pickJsonFile() {
  return new Promise((resolve, reject) => {
    if (!picker) {
      picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = '.json,application/json';
      picker.style.display = 'none';
      document.body.appendChild(picker);
    }
    picker.value = '';
    picker.onchange = async () => {
      const file = picker.files?.[0];
      if (!file) { resolve(null); return; }
      try { resolve(JSON.parse(await file.text())); } catch (e) { reject(new Error(`${file.name}: ${e.message}`)); }
    };
    picker.oncancel = () => resolve(null);
    picker.click();
  });
}
