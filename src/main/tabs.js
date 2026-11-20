'use strict';
// Web AIs open as tabs inside the hub window. Each tab is a separate, sandboxed web view that
// shares one saved browser profile ("persist:web-ai"), so sign-ins last between sessions and
// across tabs, but the hub's own page and the web pages never share anything.
const { WebContentsView, session, app } = require('electron');
const { navigable, externalUrl, hostOf } = require('../core/urls');

const PARTITION = 'persist:web-ai';
const MAX_TABS = 12;
const ready = new WeakSet();
const ZOOM_STEPS = [-3, -2, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3];

/** The web profile: a normal browser identity, and only the permissions chat sites need. */
function webSession() {
  const ses = session.fromPartition(PARTITION);
  if (ready.has(ses)) return ses;
  ready.add(ses);
  // Without "Electron" and the app name, sites treat the tabs as the Chrome they are.
  ses.setUserAgent(app.userAgentFallback.replace(/\s(ai-hub|AI Hub)\/[\d.]+/i, '').replace(/\sElectron\/[\d.]+/, ''));
  // Microphone for voice chat, clipboard writing for "copy" buttons, and full screen. Nothing else
  // (no camera, location, notifications, USB, MIDI …).
  const allowed = new Set(['clipboard-sanitized-write', 'fullscreen', 'media']);
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => {
    if (permission === 'media') {
      const types = /** @type {any} */ (details).mediaTypes || [];
      return cb(types.length > 0 && types.every((t) => t === 'audio'));
    }
    cb(allowed.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  return ses;
}

/**
 * @param {object} deps
 * @param {() => Electron.BrowserWindow | null} deps.window
 * @param {(tabs: object[]) => void} deps.send       tab list changes, for the tab strip
 * @param {(url: string) => void} deps.openExternal
 * @param {(key: string) => void} deps.shortcut      keys pressed inside a web page that the hub handles
 * @param {(tileId: string, dataUrl: string) => void} deps.favicon
 * @param {(line: string) => void} deps.log
 */
function createTabs({ window, send, openExternal, shortcut, favicon, log }) {
  /** @type {Map<string, { id: string, tileId: string, name: string, view: Electron.WebContentsView, home: string, faviconSaved?: boolean }>} */
  const tabs = new Map();
  let active = null; // tab id, or null for the tile page
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  let covered = false; // a dialog is open over the tab area
  let seq = 0;

  function list() {
    return [...tabs.values()].map((t) => {
      const wc = t.view.webContents;
      const destroyed = wc.isDestroyed();
      return {
        id: t.id, tileId: t.tileId, name: t.name, active: t.id === active,
        title: destroyed ? t.name : (wc.getTitle() || t.name), url: destroyed ? t.home : wc.getURL(),
        host: hostOf(destroyed ? t.home : wc.getURL() || t.home),
        loading: !destroyed && wc.isLoading(),
        canGoBack: !destroyed && wc.navigationHistory.canGoBack(),
        canGoForward: !destroyed && wc.navigationHistory.canGoForward(),
        zoom: destroyed ? 0 : wc.getZoomLevel(),
      };
    });
  }
  const changed = () => send(list());

  function layout() {
    for (const t of tabs.values()) {
      const show = t.id === active && !covered && bounds.width > 0 && bounds.height > 0;
      if (show) t.view.setBounds(bounds);
      t.view.setVisible(show);
    }
  }

  function keys(input) {
    if (input.type !== 'keyDown') return null;
    const ctrl = input.control || input.meta;
    const k = String(input.key || '');
    if (ctrl && !input.shift && (k === '=' || k === '+')) return 'zoom-in';
    if (ctrl && k === '-') return 'zoom-out';
    if (ctrl && k === '0') return 'zoom-reset';
    if (ctrl && k.toLowerCase() === 'w') return 'close-tab';
    if (ctrl && k === 'Tab') return input.shift ? 'prev-tab' : 'next-tab';
    if (input.alt && k === 'Home') return 'home';
    if (input.alt && k === 'ArrowLeft') return 'back';
    if (input.alt && k === 'ArrowRight') return 'forward';
    if (k === 'F5') return 'reload';
    return null;
  }

  function open(tile) {
    const existing = [...tabs.values()].find((t) => t.tileId === tile.id);
    if (existing) { activate(existing.id); return existing.id; }
    if (tabs.size >= MAX_TABS) throw new Error(`Up to ${MAX_TABS} web tabs can be open. Close one first.`);
    const win = window();
    if (!win) throw new Error('The window is not open.');

    const view = new WebContentsView({
      webPreferences: { session: webSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: true },
    });
    view.setBackgroundColor('#ffffff');
    const id = `tab-${++seq}`;
    const tab = { id, tileId: tile.id, name: tile.name, view, home: tile.url };
    tabs.set(id, tab);
    win.contentView.addChildView(view);
    const wc = view.webContents;

    // Sign-in pop-ups ("Continue with Google") stay in the same profile; ordinary links in an
    // answer open in the default browser.
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (disposition === 'new-window' && navigable(url)) {
        return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, parent: win, webPreferences: { session: webSession(), sandbox: true, contextIsolation: true, nodeIntegration: false } } };
      }
      const ext = externalUrl(url);
      if (ext) openExternal(ext);
      return { action: 'deny' };
    });
    wc.on('did-create-window', (popup) => {
      popup.webContents.setWindowOpenHandler(({ url }) => { const ext = externalUrl(url); if (ext) openExternal(ext); return { action: 'deny' }; });
      popup.webContents.on('will-navigate', (e, url) => { if (!navigable(url)) e.preventDefault(); });
    });
    wc.on('will-navigate', (e, url) => {
      if (navigable(url)) return;
      e.preventDefault();
      if (/^mailto:/i.test(url)) openExternal(url);
    });
    wc.on('will-redirect', (e, url) => { if (!navigable(url)) e.preventDefault(); });
    wc.on('before-input-event', (e, input) => {
      const k = keys(input);
      if (!k) return;
      e.preventDefault();
      if (k.startsWith('zoom-')) zoom(id, k.slice(5));
      else if (k === 'back' || k === 'forward' || k === 'reload') nav(id, k);
      else shortcut(k);
    });
    for (const ev of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate', 'did-navigate-in-page']) wc.on(/** @type {any} */ (ev), changed);
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => { if (isMain && code !== -3) log(`web tab failed to load ${hostOf(url)}: ${desc} (${code})`); });
    wc.on('render-process-gone', (_e, d) => { log(`web tab process gone: ${d.reason}`); changed(); });
    wc.on('page-favicon-updated', async (_e, favicons) => {
      // Saved once per tile so its tile shows the site's own icon from then on.
      if (tab.faviconSaved || !favicons?.length) return;
      const url = favicons.find((f) => /^https:/i.test(f));
      if (!url) return;
      try {
        const r = await wc.session.fetch(url, { signal: AbortSignal.timeout(8000) });
        const type = (r.headers.get('content-type') || '').split(';')[0].trim();
        if (!r.ok || !/^image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|jpeg|gif|webp)$/.test(type)) return;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 200000) return;
        tab.faviconSaved = true;
        favicon(tile.id, `data:${type};base64,${buf.toString('base64')}`);
      } catch { /* the tile keeps its letter */ }
    });

    wc.loadURL(tile.url).catch(() => { /* reported by did-fail-load */ });
    activate(id);
    return id;
  }

  function activate(id) {
    active = id && tabs.has(id) ? id : null;
    layout();
    if (active) tabs.get(active).view.webContents.focus();
    else window()?.webContents.focus();
    changed();
  }

  function close(id) {
    const t = tabs.get(id);
    if (!t) return;
    const order = [...tabs.keys()];
    const i = order.indexOf(id);
    tabs.delete(id);
    window()?.contentView.removeChildView(t.view);
    if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
    if (active === id) active = order[i + 1] || order[i - 1] || null;
    activate(active);
  }

  function cycle(step) {
    const order = [null, ...tabs.keys()];
    const i = order.indexOf(active);
    activate(order[(i + step + order.length) % order.length]);
  }

  function nav(id, action) {
    const t = tabs.get(id);
    if (!t || t.view.webContents.isDestroyed()) return;
    const wc = t.view.webContents;
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === 'reload') wc.reload();
    else if (action === 'start') wc.loadURL(t.home).catch(() => {});
    else if (action === 'external') { const u = externalUrl(wc.getURL()); if (u) openExternal(u); }
  }

  function zoom(id, how) {
    const t = tabs.get(id);
    if (!t) return;
    const wc = t.view.webContents;
    const z = wc.getZoomLevel();
    const next = how === 'reset' ? 0 : how === 'in' ? (ZOOM_STEPS.find((s) => s > z + 0.01) ?? z) : ([...ZOOM_STEPS].reverse().find((s) => s < z - 0.01) ?? z);
    wc.setZoomLevel(next);
    changed();
  }

  /** Signs out of every web AI by clearing the shared web profile. */
  async function clearData() {
    for (const id of [...tabs.keys()]) close(id);
    await webSession().clearStorageData();
    await webSession().clearCache();
  }

  return {
    open, activate, close, nav, zoom, list, clearData,
    next: () => cycle(1), prev: () => cycle(-1),
    closeActive: () => { if (active) close(active); },
    active: () => active,
    setBounds(b) {
      const n = (v) => Math.max(0, Math.round(Number(v) || 0));
      bounds = { x: n(b?.x), y: n(b?.y), width: n(b?.width), height: n(b?.height) };
      layout();
    },
    setCovered(on) { covered = Boolean(on); layout(); if (!covered && active) tabs.get(active)?.view.webContents.focus(); },
    closeAll() { for (const id of [...tabs.keys()]) close(id); },
  };
}

module.exports = { createTabs, PARTITION };
