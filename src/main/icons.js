'use strict';
// Tile pictures for programs: the program's own icon, or a Microsoft Store app's tile logo.
// Read from this computer only; nothing is downloaded. Tiles without one show a letter.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { storeFamily, manifestLogo, pickLogoFile } = require('../core/discovery');

const MAX_LOGO = 400000;

/**
 * @param {object} deps
 * @param {(script: string) => Promise<string>} deps.powershell
 * @param {(line: string) => void} deps.log
 */
function createIcons({ powershell, log }) {
  /** @type {Map<string, string>} tile id → data URL */
  const cache = new Map();

  async function storeLogos(tiles) {
    const wanted = tiles.filter((t) => t.family && !cache.has(t.id));
    if (!wanted.length || process.platform !== 'win32') return;
    const families = [...new Set(wanted.map((t) => t.family))].filter((f) => /^[A-Za-z0-9._-]+$/.test(f));
    let packages;
    try {
      const list = families.map((f) => `'${f}'`).join(',');
      const out = await powershell(`$f=@(${list}); Get-AppxPackage | Where-Object { $f -contains $_.PackageFamilyName } | Select-Object PackageFamilyName,InstallLocation | ConvertTo-Json -Compress`);
      const data = out.trim() ? JSON.parse(out.replace(/^\uFEFF/, '')) : [];
      packages = Array.isArray(data) ? data : [data];
    } catch (e) { log(`store logos: ${String(e?.message || e).slice(0, 120)}`); return; }
    for (const t of wanted) {
      const pkg = packages.find((p) => p?.PackageFamilyName === t.family);
      if (!pkg?.InstallLocation) continue;
      try {
        const manifest = fs.readFileSync(path.join(pkg.InstallLocation, 'AppxManifest.xml'), 'utf8');
        const logo = manifestLogo(manifest, storeFamily(t.appId)?.app || 'App');
        if (!logo) continue;
        const dir = path.join(pkg.InstallLocation, path.dirname(logo.replace(/\\/g, path.sep)));
        const file = pickLogoFile(logo, fs.readdirSync(dir));
        if (!file) continue;
        const buf = fs.readFileSync(path.join(dir, file));
        if (buf.length <= MAX_LOGO) cache.set(t.id, `data:image/png;base64,${buf.toString('base64')}`);
      } catch { /* letter tile */ }
    }
  }

  async function fileIcons(tiles) {
    for (const t of tiles) {
      if (cache.has(t.id) || t.family || t.kind === 'web' || t.kind === 'cli') continue;
      const file = t.target || t.path || t.shortcut;
      if (!file) continue;
      try {
        const img = await app.getFileIcon(file, { size: 'large' });
        if (!img.isEmpty()) cache.set(t.id, img.toDataURL());
      } catch { /* letter tile */ }
    }
  }

  return {
    /** Fills in pictures for these tiles; returns true if any were added. */
    async load(tiles) {
      const before = cache.size;
      await storeLogos(tiles);
      await fileIcons(tiles);
      return cache.size > before;
    },
    get: (id) => cache.get(id) || null,
    forget: (id) => cache.delete(id),
  };
}

module.exports = { createIcons };
