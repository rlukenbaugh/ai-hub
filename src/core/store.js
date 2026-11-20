'use strict';
// Local JSON storage in this app's own data folder:
//   settings.json  appearance, web tab and start-up choices
//   tiles.json     tiles added by hand, their order, renamed and hidden tiles, the last scan
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WEB_AIS, DEFAULT_WEB_TILES } = require('./catalog');
const { safeWebUrl } = require('./urls');

const DEFAULT_SETTINGS = {
  theme: 'system', // system | light | dark
  fontSize: 18,
  tileSize: 'large', // large | xlarge
  openWeb: 'hub', // hub (tabs inside AI Hub, stay signed in) | browser (default browser)
  startWithWindows: true,
  closeToTray: true,
  showCli: true, // command-line AIs (Claude Code, Codex …) as tiles
  autoUpdate: true,
  trayHintShown: false,
};

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function mergeSettings(saved) {
  const s = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (saved && k in saved) s[k] = saved[k];
  if (!['system', 'light', 'dark'].includes(s.theme)) s.theme = 'system';
  if (!['large', 'xlarge'].includes(s.tileSize)) s.tileSize = 'large';
  if (!['hub', 'browser'].includes(s.openWeb)) s.openWeb = 'hub';
  s.fontSize = Math.min(28, Math.max(14, Math.round(Number(s.fontSize)) || 18));
  for (const k of ['startWithWindows', 'closeToTray', 'showCli', 'autoUpdate', 'trayHintShown']) s[k] = s[k] !== false && s[k] !== 'false' && Boolean(s[k]);
  return s;
}

const cleanName = (n) => String(n || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60);

function defaultTiles() {
  return {
    custom: DEFAULT_WEB_TILES.map((key) => {
      const w = WEB_AIS.find((x) => x.key === key);
      return { id: `web:${key}`, kind: 'web', name: w.label, url: w.url, color: w.color };
    }),
    order: [],
    hidden: [],
    names: {},
    icons: {},
    detected: [],
    scannedAt: null,
  };
}

function mergeTiles(saved) {
  const t = defaultTiles();
  if (!saved || typeof saved !== 'object') return t;
  t.custom = Array.isArray(saved.custom) ? saved.custom.filter((c) => c && typeof c.id === 'string' && (c.kind === 'web' ? safeWebUrl(c.url) : c.kind === 'program' && typeof c.path === 'string')) : t.custom;
  t.order = Array.isArray(saved.order) ? saved.order.filter((x) => typeof x === 'string') : [];
  t.hidden = Array.isArray(saved.hidden) ? saved.hidden.filter((x) => typeof x === 'string') : [];
  t.names = Object.fromEntries(Object.entries(saved.names || {}).filter(([, v]) => typeof v === 'string' && cleanName(v)));
  t.icons = Object.fromEntries(Object.entries(saved.icons || {}).filter(([, v]) => typeof v === 'string' && /^data:image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|jpeg|gif|webp);base64,/.test(v) && v.length < 300000));
  t.detected = Array.isArray(saved.detected) ? saved.detected.filter((d) => d && typeof d.id === 'string' && typeof d.name === 'string') : [];
  t.scannedAt = saved.scannedAt || null;
  return t;
}

/**
 * The tiles to show, in order. Tiles in the saved order come first; new ones follow
 * (web tiles, then programs, then command-line AIs).
 */
function buildTiles(tiles, settings) {
  const all = [
    ...tiles.custom,
    ...tiles.detected.filter((d) => !tiles.hidden.includes(d.id) && (settings.showCli || d.kind !== 'cli')),
  ];
  const rank = (t) => (t.kind === 'web' ? 0 : t.kind === 'cli' ? 2 : 1);
  const pos = new Map(tiles.order.map((id, i) => [id, i]));
  return all
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const pa = pos.has(a.t.id) ? pos.get(a.t.id) : Infinity;
      const pb = pos.has(b.t.id) ? pos.get(b.t.id) : Infinity;
      if (pa !== pb) return pa - pb;
      return rank(a.t) - rank(b.t) || a.i - b.i;
    })
    .map(({ t }) => ({ ...t, name: tiles.names[t.id] || t.name, originalName: t.name }));
}

function createStore(dir) {
  const files = { settings: path.join(dir, 'settings.json'), tiles: path.join(dir, 'tiles.json') };
  const getTiles = () => mergeTiles(readJson(files.tiles, null));
  const saveTiles = (t) => { writeAtomic(files.tiles, JSON.stringify(t, null, 2)); return t; };
  const update = (fn) => { const t = getTiles(); fn(t); return saveTiles(t); };

  return {
    dir,
    files,
    getSettings: () => mergeSettings(readJson(files.settings, {})),
    saveSettings(patch) {
      const next = mergeSettings({ ...readJson(files.settings, {}), ...(patch || {}) });
      writeAtomic(files.settings, JSON.stringify(next, null, 2));
      return next;
    },
    getTiles,
    list() { return buildTiles(getTiles(), this.getSettings()); },
    find(id) { return this.list().find((t) => t.id === id) || null; },
    /** Replaces the last scan. Hidden, renamed and ordered tiles keep their settings. */
    saveDetected(detected) { return update((t) => { t.detected = detected; t.scannedAt = new Date().toISOString(); }); },
    /** @param {{ name?: string, url: string, color?: string }} tile */
    addWeb({ name, url, color }) {
      const safe = safeWebUrl(url);
      if (!safe) throw new Error('Use a web address that starts with https:// (or http://localhost for a program on this PC).');
      const id = `custom:${crypto.randomUUID()}`;
      update((t) => { t.custom.push({ id, kind: 'web', name: cleanName(name) || new URL(safe).hostname.replace(/^www\./, ''), url: safe, color: /^#[0-9a-f]{6}$/i.test(color || '') ? color : undefined }); });
      return id;
    },
    /** Programs added by hand; `file` comes from the file picker in main.js, never from the page. */
    /** @param {{ name?: string, file: string }} tile */
    addProgram({ name, file }) {
      const id = `custom:${crypto.randomUUID()}`;
      update((t) => { t.custom.push({ id, kind: 'program', name: cleanName(name) || path.win32.basename(file).replace(/\.(exe|lnk|cmd|bat)$/i, ''), path: file }); });
      return id;
    },
    remove(id) {
      update((t) => {
        if (t.custom.some((c) => c.id === id)) t.custom = t.custom.filter((c) => c.id !== id);
        else if (t.detected.some((d) => d.id === id) && !t.hidden.includes(id)) t.hidden.push(id);
        delete t.names[id]; delete t.icons[id];
      });
    },
    restore(id) { update((t) => { t.hidden = t.hidden.filter((h) => h !== id); }); },
    hiddenList() { const t = getTiles(); return t.detected.filter((d) => t.hidden.includes(d.id)).map((d) => ({ id: d.id, name: d.name, kind: d.kind })); },
    rename(id, name) {
      const n = cleanName(name);
      update((t) => { if (n) t.names[id] = n; else delete t.names[id]; });
    },
    reorder(ids) {
      if (!Array.isArray(ids)) return;
      update((t) => { t.order = [...new Set(ids.filter((x) => typeof x === 'string'))].slice(0, 500); });
    },
    setIcon(id, dataUrl) { update((t) => { t.icons[id] = dataUrl; }); },
  };
}

module.exports = { createStore, mergeSettings, mergeTiles, buildTiles, DEFAULT_SETTINGS };
