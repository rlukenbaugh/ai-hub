'use strict';
const { app, BrowserWindow, ipcMain, shell, Menu, Tray, nativeTheme, nativeImage, session, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFile, spawn } = require('node:child_process');
const { createStore } = require('../core/store');
const { discover } = require('../core/discovery');
const { launchSpec, terminalPath } = require('../core/launch');
const { WEB_AIS } = require('../core/catalog');
const { externalUrl, hostOf } = require('../core/urls');
const { createTabs } = require('./tabs');
const { createIcons } = require('./icons');
const { createUpdater } = require('./updater');

const APP_ID = 'com.rlukenbaugh.aihub';
const dataDir = process.env.AI_HUB_DATA_DIR || path.join(app.getPath('appData'), 'ai-hub');
app.setPath('userData', dataDir);
app.setAppUserModelId(APP_ID);

// Test mode: stand-in programs, and launches / browser links / start-up changes are recorded
// in a file instead of happening.
const fake = process.env.AI_HUB_FAKE === '1';
const fakeLog = process.env.AI_HUB_FAKE_LOG || path.join(dataDir, 'fake-actions.jsonl');
const record = (entry) => fs.appendFileSync(fakeLog, `${JSON.stringify({ ...entry, at: Date.now() })}\n`);

const store = createStore(dataDir);
const logFile = path.join(dataDir, 'logs', 'app.log');
function log(line) {
  // Status only: never page contents, addresses typed into a site, or sign-in details.
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    try { if (fs.statSync(logFile).size > 1_000_000) fs.renameSync(logFile, `${logFile}.1`); } catch { /* no log yet */ }
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch { /* best effort */ }
}
process.on('uncaughtException', (e) => log(`ERROR uncaught: ${e?.stack?.split('\n').slice(0, 3).join(' | ') || e}`));
process.on('unhandledRejection', (e) => log(`ERROR unhandled rejection: ${String(/** @type {any} */ (e)?.message || e).slice(0, 300)}`));

const startHidden = process.argv.includes('--hidden');
let win = null;
let tray = null;
let quitting = false;
let scanning = false;

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
const updater = createUpdater({
  log,
  send: (status) => { send('update:status', status); buildTrayMenu(); },
  fakeVersion: fake ? (process.env.AI_HUB_FAKE_UPDATE || '') : '',
});

// ---------- outside actions ----------

function powershell(script) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${script}`],
      { timeout: 30000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

function openExternal(url) {
  const safe = externalUrl(url);
  if (!safe) { log('blocked a link that is not a web address'); return false; }
  if (fake) { record({ type: 'external', url: safe }); return true; }
  shell.openExternal(safe);
  return true;
}

async function launchProgram(tile) {
  const spec = launchSpec(tile, { home: process.env.USERPROFILE || app.getPath('home'), terminal: terminalPath(process.env, (f) => { try { fs.lstatSync(f); return true; } catch { return false; } }) });
  if (fake) { record({ type: 'launch', id: tile.id, name: tile.name, spec }); return; }
  log(`launch ${tile.kind} ${tile.name}`);
  if (spec.type === 'open') {
    const err = await shell.openPath(spec.file);
    if (err) throw new Error(`Windows could not open ${tile.name}: ${err}`);
    return;
  }
  await new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: Boolean(spec.verbatim), cwd: process.env.USERPROFILE || app.getPath('home') });
    child.once('error', (e) => reject(new Error(`Could not start ${tile.name}: ${e.message}`)));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

/** Start with Windows (installed or portable app only; a development run is never registered). */
function applyLoginItem() {
  const on = store.getSettings().startWithWindows;
  if (fake) { record({ type: 'login-item', openAtLogin: on }); return; }
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  app.setLoginItemSettings({ openAtLogin: on, path: exe, args: ['--hidden'] });
}

// ---------- programs on this PC ----------

const FAKE_PROGRAMS = [
  { id: 'app:fakeclaude', name: 'Claude', kind: 'app', key: 'claude', color: '#d97757', appId: 'com.squirrel.AnthropicClaude.claude' },
  { id: 'app:fakechatgpt', name: 'ChatGPT', kind: 'app', key: 'chatgpt', color: '#10a37f', appId: 'OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0!ChatGPT', family: 'OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0' },
  { id: 'app:fakelmstudio', name: 'LM Studio', kind: 'app', key: 'lmstudio', color: '#6b4fd8', target: 'C:\\Users\\Test\\AppData\\Local\\Programs\\LM Studio\\LM Studio.exe' },
  { id: 'cli:claude-code', name: 'Claude Code', kind: 'cli', key: 'claude-code', color: '#d97757', target: 'C:\\Users\\Test\\.local\\bin\\claude.exe' },
];

const icons = createIcons({ powershell, log });

async function scan() {
  if (scanning) return;
  scanning = true;
  send('tiles:scanning', true);
  const started = Date.now();
  try {
    let found;
    if (fake) found = process.env.AI_HUB_FAKE_EMPTY === '1' ? [] : FAKE_PROGRAMS;
    else if (process.platform !== 'win32') found = [];
    else {
      found = await discover({
        env: process.env, fs,
        startApps: () => powershell('Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress').catch((e) => { log(`Get-StartApps failed: ${String(e.message).slice(0, 120)}`); return ''; }),
        readShortcut: (lnk) => shell.readShortcutLink(lnk),
      });
    }
    store.saveDetected(found);
    log(`found ${found.length} AI programs in ${Date.now() - started} ms`);
    if (!fake) await icons.load(store.list());
  } catch (e) {
    log(`ERROR scan: ${String(e?.message || e).slice(0, 200)}`);
  } finally {
    scanning = false;
    send('tiles:scanning', false);
    tilesChanged();
  }
}

function subtitle(t) {
  if (t.kind === 'web') return store.getSettings().openWeb === 'hub' ? `Web · ${hostOf(t.url)}` : `Web · opens in your browser`;
  if (t.kind === 'cli') return 'Command line';
  return t.family ? 'Microsoft Store app' : 'Program';
}

function tileView() {
  const saved = store.getTiles().icons;
  return store.list().map((t) => ({
    id: t.id, name: t.name, originalName: t.originalName, kind: t.kind, color: t.color || null,
    custom: t.id.startsWith('custom:') || t.id.startsWith('web:'),
    subtitle: subtitle(t), url: t.kind === 'web' ? t.url : undefined,
    icon: saved[t.id] || icons.get(t.id),
  }));
}

function tilesChanged() {
  send('tiles:changed', tileView());
  buildTrayMenu();
}

async function openTile(id, where) {
  const t = store.find(id);
  if (!t) throw new Error('That tile no longer exists.');
  if (t.kind === 'web') {
    const inHub = (where || store.getSettings().openWeb) === 'hub';
    if (!inHub) { openExternal(t.url); return { opened: 'browser' }; }
    showWindow();
    tabs.open(t);
    return { opened: 'tab' };
  }
  await launchProgram(t);
  return { opened: 'program' };
}

// ---------- web tabs ----------

const tabs = createTabs({
  window: () => (win && !win.isDestroyed() ? win : null),
  send: (list) => send('tabs:changed', list),
  openExternal,
  shortcut: (key) => send('key', key),
  favicon: (tileId, dataUrl) => { if (store.find(tileId)) { store.setIcon(tileId, dataUrl); tilesChanged(); } },
  log,
});

// ---------- window and tray ----------

function iconPath(name) { return path.join(__dirname, '..', '..', 'build', 'icons', name); }

function createWindow() {
  nativeTheme.themeSource = /** @type {any} */ (store.getSettings().theme);
  win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 640, minHeight: 480, show: false,
    title: 'AI Hub', backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f6f7f9',
    icon: iconPath('icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: true },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!(startHidden && store.getSettings().closeToTray)) win.show(); });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('render-process-gone', (_e, d) => { log(`ERROR window process gone: ${d.reason}`); if (d.reason !== 'clean-exit' && !win.isDestroyed()) win.webContents.reload(); });
  win.webContents.on('console-message', (details) => { if (details.level === 'error') log(`ERROR page: ${String(details.message).slice(0, 300)}`); });
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable && !params.selectionText) return;
    Menu.buildFromTemplate(params.isEditable ? [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' }] : [{ role: 'copy' }]).popup({ window: win });
  });
  win.on('close', (e) => {
    if (quitting || !store.getSettings().closeToTray || !tray) return;
    e.preventDefault();
    win.hide();
    if (!store.getSettings().trayHintShown) {
      store.saveSettings({ trayHintShown: true });
      if (process.platform === 'win32') tray.displayBalloon({ title: 'AI Hub is still running', content: 'Click the AI Hub icon by the clock to open it again. To quit, right-click the icon and choose Quit AI Hub.', iconType: 'info' });
    }
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  if (tray) return;
  const image = nativeImage.createFromPath(iconPath(process.platform === 'win32' ? 'icon.ico' : 'icon.png'));
  try {
    tray = new Tray(process.platform === 'win32' || image.isEmpty() ? image : image.resize({ width: 22, height: 22 }));
  } catch (e) {
    // Without a tray icon, closing the window quits as usual.
    log(`no tray icon: ${String(e?.message || e).slice(0, 120)}`);
    return;
  }
  tray.setToolTip('AI Hub');
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  buildTrayMenu();
}

function buildTrayMenu() {
  if (!tray) return;
  const s = store.getSettings();
  const list = store.list().slice(0, 15);
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const items = [
    { label: 'Open AI Hub', click: showWindow },
    { type: 'separator' },
    ...list.map((t) => ({ label: t.name.replace(/&/g, '&&'), click: () => openTile(t.id).catch((e) => { log(`tray open failed: ${e.message}`); showWindow(); send('toast', e.message); }) })),
    ...(list.length ? [{ type: /** @type {const} */ ('separator') }] : []),
    { label: 'Start with Windows', type: 'checkbox', checked: s.startWithWindows, click: (item) => { store.saveSettings({ startWithWindows: item.checked }); applyLoginItem(); send('settings:changed', store.getSettings()); } },
    ...(updater.status().state === 'ready' ? [{ label: `Restart to install version ${updater.status().version}`, click: () => { quitting = true; updater.install(); } }] : []),
    { label: 'Quit AI Hub', click: () => { quitting = true; app.quit(); } },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function tileMenu(id) {
  const t = store.find(id);
  if (!t || !win) return;
  const ids = store.list().map((x) => x.id);
  const i = ids.indexOf(id);
  const act = (action) => () => send('tiles:action', { action, id });
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const items = [
    { label: 'Open', click: () => openTile(id).catch((e) => send('toast', e.message)) },
    ...(t.kind === 'web' ? [
      { label: 'Open in a tab here', click: () => openTile(id, 'hub').catch((e) => send('toast', e.message)) },
      { label: 'Open in my browser', click: () => openTile(id, 'browser').catch((e) => send('toast', e.message)) },
    ] : []),
    { type: 'separator' },
    { label: 'Rename…', click: act('rename') },
    { label: 'Move left', enabled: i > 0, click: act('move-left') },
    { label: 'Move right', enabled: i < ids.length - 1, click: act('move-right') },
    { type: 'separator' },
    { label: 'Remove tile', click: act('remove') },
  ];
  Menu.buildFromTemplate(items).popup({ window: win });
}

// ---------- page requests ----------

function registerIpc() {
  ipcMain.handle('app:init', () => ({
    settings: store.getSettings(), tiles: tileView(), tabs: tabs.list(), scanning, webAis: WEB_AIS,
    version: app.getVersion(), fake, packaged: app.isPackaged, platform: process.platform,
  }));
  ipcMain.handle('settings:save', (_e, patch) => {
    const allowed = ['theme', 'fontSize', 'tileSize', 'openWeb', 'startWithWindows', 'closeToTray', 'showCli', 'autoUpdate'];
    const safe = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
    const s = store.saveSettings(safe);
    nativeTheme.themeSource = /** @type {any} */ (s.theme);
    if ('startWithWindows' in safe) applyLoginItem();
    if ('autoUpdate' in safe) updater.schedule(s.autoUpdate);
    if ('showCli' in safe || 'openWeb' in safe) tilesChanged(); else buildTrayMenu();
    return s;
  });
  ipcMain.handle('tiles:open', (_e, id, where) => openTile(String(id), where === 'browser' || where === 'hub' ? where : undefined));
  ipcMain.handle('tiles:menu', (_e, id) => tileMenu(String(id)));
  ipcMain.handle('tiles:rescan', () => scan());
  ipcMain.handle('tiles:addWeb', (_e, { name, url, key } = {}) => {
    const preset = WEB_AIS.find((w) => w.key === key);
    const id = store.addWeb(preset ? { name: preset.label, url: preset.url, color: preset.color } : { name, url });
    tilesChanged();
    return id;
  });
  ipcMain.handle('tiles:chooseProgram', async () => {
    const picked = await dialog.showOpenDialog(win, {
      title: 'Choose a program for a new tile', properties: ['openFile'],
      filters: [{ name: 'Programs and shortcuts', extensions: ['exe', 'lnk', 'cmd', 'bat'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const file = picked.filePaths[0];
    const id = store.addProgram({ file });
    if (!fake) await icons.load(store.list());
    tilesChanged();
    return { id, name: store.find(id)?.name };
  });
  ipcMain.handle('tiles:remove', (_e, id) => { store.remove(String(id)); icons.forget(String(id)); tilesChanged(); return true; });
  ipcMain.handle('tiles:restore', async (_e, id) => { store.restore(String(id)); if (!fake) await icons.load(store.list()); tilesChanged(); return true; });
  ipcMain.handle('tiles:hidden', () => store.hiddenList());
  ipcMain.handle('tiles:rename', (_e, id, name) => { store.rename(String(id), String(name || '')); tilesChanged(); return true; });
  ipcMain.handle('tiles:reorder', (_e, ids) => { store.reorder(ids); tilesChanged(); return true; });

  ipcMain.handle('tabs:activate', (_e, id) => tabs.activate(id || null));
  ipcMain.handle('tabs:close', (_e, id) => tabs.close(String(id)));
  ipcMain.handle('tabs:nav', (_e, id, action) => { if (['back', 'forward', 'reload', 'start', 'external'].includes(action)) tabs.nav(String(id), action); });
  ipcMain.handle('tabs:zoom', (_e, id, how) => { if (['in', 'out', 'reset'].includes(how)) tabs.zoom(String(id), how); });
  ipcMain.handle('tabs:next', (_e, step) => (step < 0 ? tabs.prev() : tabs.next()));
  ipcMain.handle('tabs:closeActive', () => tabs.closeActive());
  ipcMain.handle('tabs:bounds', (_e, rect) => tabs.setBounds(rect));
  ipcMain.handle('tabs:covered', (_e, on) => tabs.setCovered(on));
  ipcMain.handle('tabs:signOutAll', async () => { await tabs.clearData(); log('cleared the web profile'); return true; });

  ipcMain.handle('app:openDataFolder', () => (fake ? record({ type: 'open-folder' }) : shell.openPath(dataDir)));
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });
  ipcMain.handle('update:status', () => updater.status());
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:install', () => { quitting = true; return updater.install(); });
}

// ---------- start ----------

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    // The hub's own page needs no network and no permissions; web tabs use their own profile.
    session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_d, cb) => cb({ cancel: true }));
    registerIpc();
    createWindow();
    createTray();
    applyLoginItem();
    updater.schedule(store.getSettings().autoUpdate);
    log(`started v${app.getVersion()}${fake ? ' (test mode)' : ''}${startHidden ? ' in the tray' : ''}`);
    // Show the last scan at once (with icons), then look again in the background.
    if (!fake) icons.load(store.list()).then((more) => { if (more) tilesChanged(); });
    scan();
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => app.quit());
}
