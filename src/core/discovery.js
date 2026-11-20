'use strict';
// Finds the AI programs installed on this PC.
//
// 1. Start-menu apps (PowerShell Get-StartApps): covers ordinary programs and Microsoft Store
//    apps such as ChatGPT and Copilot, with the AppID Windows itself uses to start them.
// 2. Start-menu shortcuts (.lnk): their targets give program icons, and they stand in if
//    PowerShell is unavailable.
// 3. Usual install locations for programs that skip the Start menu.
// 4. Command-line AIs (Claude Code, Codex …) on PATH or in their usual folders.
//
// Every outside call is passed in, so this file can be tested on any computer.
const path = require('node:path');
const crypto = require('node:crypto');
const { matchAiApp, cliPrograms, knownAppPaths, AI_APPS } = require('./catalog');

const P = path.win32;

/** Folder GUIDs that Get-StartApps uses at the start of a desktop program's AppID. */
function knownFolders(env) {
  const pf = env.ProgramW6432 || env.ProgramFiles || 'C:\\Program Files';
  const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const win = env.SystemRoot || env.windir || 'C:\\Windows';
  return {
    '{6D809377-6AF0-444B-8957-A3773F02200E}': pf, // Program Files (x64)
    '{905E63B6-C1BF-494E-B29C-65B732D3D21A}': pf,
    '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}': pf86,
    '{F38BF404-1D43-42F2-9305-67DE0B28FC23}': win,
    '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}': P.join(win, 'System32'),
    '{D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27}': P.join(win, 'SysWOW64'),
  };
}

/** A stable tile id from a program's name, so the same program keeps its place between scans. */
function idFor(prefix, name) {
  return `${prefix}:${crypto.createHash('sha1').update(String(name).trim().toLowerCase()).digest('hex').slice(0, 12)}`;
}

/** Store apps have AppIDs like "OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0!ChatGPT". */
function storeFamily(appId) {
  const m = /^([A-Za-z0-9.-]+_[a-z0-9]{13})!([A-Za-z0-9._-]+)$/.exec(String(appId || ''));
  return m ? { family: m[1], app: m[2] } : null;
}

/** Turns a desktop AppID ("{GUID}\\Folder\\app.exe" or a full path) into a file path, if it is one. */
function appIdPath(appId, env) {
  const id = String(appId || '');
  const m = /^(\{[0-9A-F-]{36}\})\\(.+)$/i.exec(id);
  if (m) {
    const base = knownFolders(env)[m[1].toUpperCase()];
    return base ? P.join(base, m[2]) : null;
  }
  return /^[A-Za-z]:\\.+\.exe$/i.test(id) ? id : null;
}

/** Get-StartApps returns one object, a list, or nothing. */
function parseStartApps(json) {
  if (!json || !String(json).trim()) return [];
  let data;
  try { data = JSON.parse(String(json).replace(/^\uFEFF/, '')); } catch { return []; }
  const list = Array.isArray(data) ? data : [data];
  return list.filter((a) => a && typeof a.Name === 'string' && typeof a.AppID === 'string')
    .map((a) => ({ name: a.Name.trim(), appId: a.AppID.trim() }))
    .filter((a) => a.name && a.appId);
}

function startMenuDirs(env) {
  const appData = env.APPDATA;
  const programData = env.ProgramData || env.ALLUSERSPROFILE || 'C:\\ProgramData';
  return [
    appData && P.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    P.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ].filter(Boolean);
}

/** Every .lnk under the Start-menu folders (two levels deep, as installers use). */
function listShortcuts(env, fs) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = P.join(dir, e.name);
      if (e.isDirectory() && depth < 2) walk(full, depth + 1);
      else if (e.isFile() && /\.lnk$/i.test(e.name)) out.push({ name: e.name.replace(/\.lnk$/i, '').trim(), file: full });
    }
  };
  for (const d of startMenuDirs(env)) walk(d, 0);
  return out;
}

/** Finds a program on PATH, then in its usual folders. */
function findCli(program, env, fs) {
  const dirs = String(env.PATH || env.Path || '').split(';').map((d) => d.trim().replace(/^"|"$/g, '')).filter(Boolean);
  for (const dir of dirs) {
    for (const f of program.files) {
      const full = P.join(dir, f);
      if (exists(fs, full)) return full;
    }
  }
  return program.defaults.find((f) => exists(fs, f)) || null;
}

function exists(fs, file) { try { return fs.statSync(file).isFile(); } catch { return false; } }

/**
 * @typedef {object} Detected
 * @property {string} id
 * @property {string} name
 * @property {'app'|'cli'} kind
 * @property {string} key      catalog key (claude, chatgpt …)
 * @property {string} color
 * @property {string} [appId]  Start-menu AppID (launch through shell:AppsFolder)
 * @property {string} [family] Microsoft Store package family, for the logo
 * @property {string} [shortcut] Start-menu .lnk
 * @property {string} [target]  program file (icon, and launch when there is no AppID)
 */

/**
 * @param {object} deps
 * @param {Record<string,string|undefined>} deps.env
 * @param {Pick<typeof import('node:fs'), 'readdirSync'|'statSync'>} deps.fs
 * @param {() => Promise<string>} deps.startApps  JSON from Get-StartApps ('' if unavailable)
 * @param {(lnk:string) => { target?: string } | null} [deps.readShortcut]
 * @returns {Promise<Detected[]>}
 */
async function discover({ env, fs, startApps, readShortcut = () => null }) {
  /** @type {Map<string, Detected>} by lower-case name */
  const found = new Map();
  const shortcuts = listShortcuts(env, fs);
  const shortcutTarget = (lnk) => {
    try { const t = readShortcut(lnk)?.target; return t && /\.exe$/i.test(t) ? t : null; } catch { return null; }
  };

  let apps;
  try { apps = parseStartApps(await startApps()); } catch { apps = []; }
  for (const a of apps) {
    const hit = matchAiApp(a.name);
    if (!hit || found.has(a.name.toLowerCase())) continue;
    const lnk = shortcuts.find((s) => s.name.toLowerCase() === a.name.toLowerCase());
    const family = storeFamily(a.appId)?.family;
    const target = family ? undefined : (appIdPath(a.appId, env) || (lnk && shortcutTarget(lnk.file)) || undefined);
    found.set(a.name.toLowerCase(), { id: idFor('app', a.name), name: a.name, kind: 'app', key: hit.key, color: hit.color, appId: a.appId, family, shortcut: lnk?.file, target });
  }

  // Shortcuts that Get-StartApps did not report (or all of them, if PowerShell failed).
  for (const s of shortcuts) {
    const hit = matchAiApp(s.name);
    if (!hit || found.has(s.name.toLowerCase())) continue;
    found.set(s.name.toLowerCase(), { id: idFor('app', s.name), name: s.name, kind: 'app', key: hit.key, color: hit.color, shortcut: s.file, target: shortcutTarget(s.file) || undefined });
  }

  // Usual locations, for programs with no Start-menu entry at all.
  for (const k of knownAppPaths(env)) {
    if ([...found.values()].some((d) => d.key === k.key)) continue;
    const file = k.paths.find((p) => exists(fs, p));
    if (!file) continue;
    const color = AI_APPS.find((a) => a.key === k.key)?.color || '#555555';
    found.set(k.label.toLowerCase(), { id: idFor('app', k.label), name: k.label, kind: 'app', key: k.key, color, target: file });
  }

  const list = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const c of cliPrograms(env)) {
    const file = findCli(c, env, fs);
    if (file) list.push({ id: `cli:${c.key}`, name: c.label, kind: 'cli', key: c.key, color: c.color, target: file });
  }
  return list;
}

// ---------- Microsoft Store logos ----------

/**
 * The logo a Store app declares for its tile, read from AppxManifest.xml.
 * @param {string} manifest  the XML text
 * @param {string} appName   the part after "!" in the AppID
 * @returns {string|null} a path inside the package, such as "Assets\\Square150x150Logo.png"
 */
function manifestLogo(manifest, appName) {
  const xml = String(manifest || '');
  const apps = [...xml.matchAll(/<Application\b([^>]*)>([\s\S]*?)<\/Application>/g)];
  const app = apps.find((m) => new RegExp(`\\bId="${appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(m[1])) || apps[0];
  const scope = app ? app[2] : xml;
  for (const attr of ['Square150x150Logo', 'Square44x44Logo', 'Logo']) {
    const m = new RegExp(`\\b${attr}="([^"]+)"`).exec(scope);
    if (m) return m[1];
  }
  const pkg = /<Properties>[\s\S]*?<Logo>([^<]+)<\/Logo>/.exec(xml);
  return pkg ? pkg[1].trim() : null;
}

/**
 * Store packages keep each logo in several sizes ("Logo.scale-200.png", "Logo.targetsize-256.png").
 * Picks the sharpest one that suits a large tile.
 * @param {string} logo  the declared path, e.g. "Assets\\StoreLogo.png"
 * @param {string[]} files  names in the logo's folder
 */
function pickLogoFile(logo, files) {
  const base = P.basename(logo).replace(/\.png$/i, '');
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${esc}(?:\\.(scale-(\\d+)|targetsize-(\\d+)(?:_altform-[a-z-]+)?))?\\.png$`, 'i');
  const scored = files.map((f) => {
    const m = re.exec(f);
    if (!m) return null;
    if (/altform/i.test(f) && !/altform-(lightunplated|unplated)/i.test(f)) return null;
    const scale = m[2] ? Number(m[2]) : 0;
    const target = m[3] ? Number(m[3]) : 0;
    // Prefer a large target size (crisp on a big tile), then scale-200, then any.
    const score = target ? 1000 + Math.min(target, 256) : scale ? 500 + (scale === 200 ? 100 : Math.min(scale, 400) / 4) : 1;
    return { f, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  return scored[0]?.f || null;
}

module.exports = { discover, parseStartApps, storeFamily, appIdPath, listShortcuts, findCli, idFor, manifestLogo, pickLogoFile };
