// Entry point. For now it only shows the build stamp; step 1.1 replaces this page with the canvas shell.
// build.json is written next to index.html by tools/publish-site.mjs and exists only in the published copy.

const stamp = document.getElementById('build');

async function showBuild() {
  try {
    const res = await fetch('build.json', { cache: 'no-store' });   // relative: the game lives under /sentinel/
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const build = await res.json();
    stamp.textContent = `v${build.version} · ${build.commit}`;
  } catch {
    stamp.textContent = 'dev build';
  }
}

showBuild();
