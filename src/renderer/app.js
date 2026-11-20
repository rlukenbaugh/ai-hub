// The hub page: tiles, the tab strip, and the dialogs. Everything outside this page goes
// through window.hub (preload.js).

const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));
const $$ = (sel) => /** @type {HTMLElement[]} */ ([...document.querySelectorAll(sel)]);

/** @param {string} tag @param {Record<string, any>} [attrs] @param {...any} kids */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') el.textContent = v;
    // The page's security policy blocks style attributes; styles set through the DOM are allowed.
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
}

const state = {
  settings: null,
  tiles: [],
  tabs: [],
  webAis: [],
  arranging: false,
  update: null,
  updateDismissed: false,
  platform: 'win32',
};

// ---------- small helpers ----------

let toastTimer = null;
function toast(text, action) {
  $('#toast-text').textContent = text;
  const btn = /** @type {HTMLButtonElement} */ ($('#toast-action'));
  btn.hidden = !action;
  if (action) { btn.textContent = action.label; btn.onclick = () => { $('#toast').hidden = true; action.run(); }; }
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, action ? 8000 : 4500);
}

function colorFor(name) {
  const palette = ['#2457c5', '#10a37f', '#d97757', '#6b4fd8', '#1f8a8a', '#b5476b', '#a26a00', '#3a7d44'];
  let n = 0;
  for (const ch of String(name)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[n % palette.length];
}
function letterOf(name) { return (String(name).match(/[A-Za-z0-9]/)?.[0] || '?').toUpperCase(); }

function picture(tile, cls) {
  if (tile?.icon) return h('img', { src: tile.icon, alt: '', class: cls });
  return h('span', { class: cls, style: { background: tile?.color || colorFor(tile?.name || '') }, 'aria-hidden': 'true', text: letterOf(tile?.name || '') });
}

/** Opens a dialog, hiding any web page under it (web pages are drawn above the hub page). */
function openDialog(dlg) {
  hub.setTabsCovered(true);
  /** @type {HTMLDialogElement} */ (dlg).showModal();
}
for (const dlg of $$('dialog')) dlg.addEventListener('close', () => { if (!$$('dialog').some((d) => /** @type {HTMLDialogElement} */ (d).open)) hub.setTabsCovered(false); });

function confirmBox(text, okLabel) {
  return new Promise((resolve) => {
    const dlg = /** @type {HTMLDialogElement} */ ($('#confirm'));
    $('#confirm-text').textContent = text;
    $('#confirm-ok').textContent = okLabel;
    dlg.returnValue = '';
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    openDialog(dlg);
  });
}

// ---------- appearance ----------

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function applyAppearance() {
  const s = state.settings;
  const dark = s.theme === 'dark' || (s.theme === 'system' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.tiles = s.tileSize;
  document.documentElement.style.setProperty('--size', `${s.fontSize}px`);
  requestAnimationFrame(sendBounds);
}
darkQuery.addEventListener('change', () => state.settings && applyAppearance());

async function saveSettings(patch) {
  state.settings = await hub.saveSettings(patch);
  applyAppearance();
  fillSettings();
  return state.settings;
}
const SIZES = [14, 16, 18, 20, 22, 24, 28];
function stepFont(dir) {
  const i = SIZES.findIndex((s) => s >= state.settings.fontSize);
  const next = SIZES[Math.min(SIZES.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir))];
  saveSettings({ fontSize: next });
}

// ---------- tiles ----------

function renderTiles() {
  const box = $('#tiles');
  box.classList.toggle('arranging', state.arranging);
  box.replaceChildren(...state.tiles.map((t, i) => {
    const wrap = h('div', { class: 'tile-wrap', role: 'listitem', 'data-id': t.id, draggable: state.arranging ? 'true' : null });
    const kindText = t.kind === 'web' ? 'web AI' : t.kind === 'cli' ? 'command-line AI' : 'program';
    const tile = h('button', {
      type: 'button', class: 'tile', 'data-id': t.id, 'data-kind': t.kind,
      title: state.arranging ? `${t.name}: drag to move` : `Open ${t.name} (${kindText}). Right-click for more.`,
      onclick: () => (state.arranging ? null : openTile(t, tile)),
      oncontextmenu: (e) => { e.preventDefault(); hub.tileMenu(t.id); },
    },
    h('span', { class: 'tile-icon' }, picture(t, t.icon ? '' : 'letter')),
    h('span', { class: 'tile-name', text: t.name }),
    h('span', { class: 'tile-sub', text: t.subtitle }));
    wrap.append(tile);
    if (state.arranging) {
      wrap.append(h('div', { class: 'tile-edit' },
        h('button', { type: 'button', class: 'icon-btn', title: `Move ${t.name} left`, 'aria-label': `Move ${t.name} left`, disabled: i === 0, onclick: () => move(t.id, -1) }, '◀'),
        h('button', { type: 'button', class: 'icon-btn', title: `Move ${t.name} right`, 'aria-label': `Move ${t.name} right`, disabled: i === state.tiles.length - 1, onclick: () => move(t.id, 1) }, '▶'),
        h('button', { type: 'button', class: 'icon-btn', title: `Rename ${t.name}`, 'aria-label': `Rename ${t.name}`, onclick: () => rename(t.id) }, '✎'),
        h('button', { type: 'button', class: 'icon-btn', title: `Remove ${t.name}`, 'aria-label': `Remove ${t.name}`, onclick: () => removeTile(t.id) }, '✕')));
      wireDrag(wrap);
    }
    return wrap;
  }));
  $('#empty').hidden = state.tiles.length > 0;
  renderTabs(); // tab icons follow tile icons
}

async function openTile(t, el) {
  el?.classList.add('busy');
  try {
    const r = await hub.openTile(t.id);
    if (r?.opened === 'program') toast(`Starting ${t.name}…`);
    else if (r?.opened === 'browser') toast(`${t.name} opened in your browser.`);
  } catch (e) {
    toast(cleanError(e));
  } finally {
    setTimeout(() => el?.classList.remove('busy'), 600);
  }
}
const cleanError = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

async function move(id, step) {
  const ids = state.tiles.map((t) => t.id);
  const i = ids.indexOf(id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await hub.reorderTiles(ids);
  // Keep keyboard focus on the moved tile's arrow (or the other arrow at either end).
  requestAnimationFrame(() => {
    const [left, right] = /** @type {HTMLButtonElement[]} */ ($$(`.tile-wrap[data-id="${CSS.escape(id)}"] .tile-edit button`));
    const want = step < 0 ? left : right;
    (want && !want.disabled ? want : step < 0 ? right : left)?.focus();
  });
}

let dragId = null;
function wireDrag(wrap) {
  wrap.addEventListener('dragstart', (e) => { dragId = wrap.dataset.id; wrap.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
  wrap.addEventListener('dragend', () => { dragId = null; $$('.tile-wrap').forEach((w) => w.classList.remove('dragging', 'drop-before')); });
  wrap.addEventListener('dragover', (e) => { if (!dragId || dragId === wrap.dataset.id) return; e.preventDefault(); $$('.drop-before').forEach((w) => w.classList.remove('drop-before')); wrap.classList.add('drop-before'); });
  wrap.addEventListener('drop', async (e) => {
    e.preventDefault();
    const from = dragId;
    const to = wrap.dataset.id;
    if (!from || from === to) return;
    const ids = state.tiles.map((t) => t.id).filter((x) => x !== from);
    ids.splice(ids.indexOf(to), 0, from);
    await hub.reorderTiles(ids);
  });
}

async function removeTile(id) {
  const t = state.tiles.find((x) => x.id === id);
  if (!t) return;
  const custom = t.custom;
  await hub.removeTile(id);
  if (custom) {
    toast(`Removed ${t.name}.`, t.kind === 'web' && t.url ? { label: 'Undo', run: () => hub.addWeb({ name: t.name, url: t.url }) } : null);
  } else {
    toast(`Removed ${t.name}. It can be brought back from + Add a tile.`, { label: 'Undo', run: () => hub.restoreTile(id) });
  }
}

let renaming = null;
function rename(id) {
  const t = state.tiles.find((x) => x.id === id);
  if (!t) return;
  renaming = id;
  const input = /** @type {HTMLInputElement} */ ($('#rename-input'));
  input.value = t.name;
  input.required = false;
  $('#rename-original').textContent = `“${t.originalName}”`;
  openDialog($('#rename'));
  input.select();
}

function setArranging(on) {
  state.arranging = on;
  $('#btn-arrange').setAttribute('aria-pressed', String(on));
  $('#btn-arrange').textContent = on ? 'Done' : 'Arrange tiles';
  $('#arrange-hint').hidden = !on;
  renderTiles();
}

function setScanning(on) {
  $('#scan-status').textContent = on ? 'Looking for AI programs on this PC…' : '';
  /** @type {HTMLButtonElement} */ ($('#btn-rescan')).disabled = on;
}

// ---------- tabs ----------

function renderTabs() {
  const strip = $('#tabstrip');
  const active = state.tabs.find((t) => t.active);
  $('#tab-home').setAttribute('aria-selected', String(!active));
  strip.replaceChildren($('#tab-home'), ...state.tabs.map((t) => {
    const tile = state.tiles.find((x) => x.id === t.tileId);
    const label = t.title && t.title !== t.name ? `${t.name} – ${t.title}` : t.name;
    return h('div', {
      role: 'tab', tabindex: '0', class: 'tab', 'data-tab': t.id, 'aria-selected': String(t.active), title: label,
      onclick: () => hub.activateTab(t.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hub.activateTab(t.id); } if (e.key === 'Delete') hub.closeTab(t.id); },
      onauxclick: (e) => { if (e.button === 1) hub.closeTab(t.id); },
    },
    t.loading ? h('span', { class: 'loading', 'aria-hidden': 'true' }) : picture(tile || { name: t.name }, tile?.icon ? '' : 'tab-letter'),
    h('span', { class: 'tab-title', text: t.name }),
    h('button', { type: 'button', class: 'tab-close', title: `Close ${t.name}`, 'aria-label': `Close ${t.name}`, onclick: (e) => { e.stopPropagation(); hub.closeTab(t.id); } }, '✕'));
  }));

  $('#home').hidden = Boolean(active);
  $('#web').hidden = !active;
  if (active) {
    $('#web-host').textContent = active.host ? `${active.host}${active.title ? ` · ${active.title}` : ''}` : active.name;
    /** @type {HTMLButtonElement} */ ($('#web-back')).disabled = !active.canGoBack;
    /** @type {HTMLButtonElement} */ ($('#web-forward')).disabled = !active.canGoForward;
    $('#web-zoom').textContent = `${Math.round(Math.pow(1.2, active.zoom || 0) * 100)}%`;
    requestAnimationFrame(sendBounds);
  }
}

function activeTab() { return state.tabs.find((t) => t.active) || null; }

/** Tells the app where on screen the web page goes. */
function sendBounds() {
  const area = $('#web-area');
  if ($('#web').hidden) return;
  const r = area.getBoundingClientRect();
  hub.setTabBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
}
new ResizeObserver(sendBounds).observe($('#web-area'));
window.addEventListener('resize', sendBounds);

// ---------- dialogs: add, rename, settings ----------

async function openAdd() {
  const box = $('#web-presets');
  const have = new Set(state.tiles.filter((t) => t.kind === 'web').map((t) => t.url));
  box.replaceChildren(...state.webAis.map((w) => {
    const added = have.has(w.url);
    return h('button', {
      type: 'button', class: 'preset', 'data-web': w.key, disabled: added, title: added ? `${w.label} is already a tile` : `Add ${w.label} (${w.url})`,
      onclick: async (e) => {
        const btn = /** @type {HTMLButtonElement} */ (e.currentTarget);
        btn.disabled = true;
        try { await hub.addWeb({ key: w.key }); } catch (err) { btn.disabled = false; toast(cleanError(err)); return; }
        btn.lastChild.textContent = `${w.label} ✓`;
        toast(`Added ${w.label}.`);
      },
    }, h('span', { class: 'letter', style: { background: w.color }, text: letterOf(w.label) }), added ? `${w.label} ✓` : w.label);
  }));
  /** @type {HTMLInputElement} */ ($('#add-web-name')).value = '';
  /** @type {HTMLInputElement} */ ($('#add-web-url')).value = '';
  $('#add-web-error').hidden = true;
  const hidden = await hub.hiddenTiles();
  $('#hidden-section').hidden = hidden.length === 0;
  $('#hidden-list').replaceChildren(...hidden.map((x) => h('button', {
    type: 'button', class: 'preset', 'data-restore': x.id,
    onclick: async (e) => { const btn = /** @type {HTMLElement} */ (e.currentTarget); await hub.restoreTile(x.id); btn.remove(); toast(`${x.name} is back.`); if (!$('#hidden-list').children.length) $('#hidden-section').hidden = true; },
  }, h('span', { class: 'letter', style: { background: colorFor(x.name) }, text: letterOf(x.name) }), x.name)));
  openDialog($('#add'));
}

async function addWebAddress() {
  const name = /** @type {HTMLInputElement} */ ($('#add-web-name')).value;
  const url = /** @type {HTMLInputElement} */ ($('#add-web-url')).value;
  const err = $('#add-web-error');
  try {
    await hub.addWeb({ name, url });
    err.hidden = true;
    /** @type {HTMLDialogElement} */ ($('#add')).close();
    toast('Tile added.');
  } catch (e) {
    err.textContent = cleanError(e);
    err.hidden = false;
  }
}

function fillSettings() {
  const s = state.settings;
  /** @type {HTMLSelectElement} */ ($('#set-theme')).value = s.theme;
  const font = /** @type {HTMLSelectElement} */ ($('#set-font'));
  if (![...font.options].some((o) => o.value === String(s.fontSize))) font.append(h('option', { value: s.fontSize, text: `Custom (${s.fontSize})` }));
  font.value = String(s.fontSize);
  /** @type {HTMLSelectElement} */ ($('#set-tiles')).value = s.tileSize;
  for (const r of /** @type {HTMLInputElement[]} */ ($$('input[name="openWeb"]'))) r.checked = r.value === s.openWeb;
  /** @type {HTMLInputElement} */ ($('#set-cli')).checked = s.showCli;
  /** @type {HTMLInputElement} */ ($('#set-startup')).checked = s.startWithWindows;
  /** @type {HTMLInputElement} */ ($('#set-tray')).checked = s.closeToTray;
  /** @type {HTMLInputElement} */ ($('#set-update')).checked = s.autoUpdate;
}

// ---------- updates ----------

function updateText(u) {
  switch (u?.state) {
    case 'checking': return 'Checking for updates…';
    case 'current': return `You have the latest version (${u.current}).`;
    case 'downloading': return `Downloading version ${u.version}… ${u.percent || 0}%`;
    case 'ready': return `Version ${u.version} is ready to install.`;
    case 'error': return u.detail || 'Could not check for updates.';
    case 'unsupported': return u.detail || '';
    default: return u?.current ? `Version ${u.current}.` : '';
  }
}
function onUpdate(u) {
  state.update = u;
  $('#update-status').textContent = updateText(u);
  const banner = $('#update-banner');
  if (u?.state === 'ready' && !state.updateDismissed) {
    $('#update-text').textContent = `AI Hub ${u.version} is ready. It will be installed the next time AI Hub quits.`;
    banner.hidden = false;
  } else if (u?.state !== 'ready') banner.hidden = true;
  requestAnimationFrame(sendBounds);
}

// ---------- keyboard ----------

function handleKey(key) {
  const tab = activeTab();
  switch (key) {
    case 'close-tab': if (tab) hub.closeTab(tab.id); break;
    case 'next-tab': hub.nextTab(1); break;
    case 'prev-tab': hub.nextTab(-1); break;
    case 'home': hub.activateTab(null); break;
    case 'zoom-in': if (tab) hub.zoomTab(tab.id, 'in'); else stepFont(1); break;
    case 'zoom-out': if (tab) hub.zoomTab(tab.id, 'out'); else stepFont(-1); break;
    case 'zoom-reset': if (tab) hub.zoomTab(tab.id, 'reset'); else saveSettings({ fontSize: 18 }); break;
    case 'back': case 'forward': case 'reload': if (tab) hub.navTab(tab.id, key); break;
    default: break;
  }
}
document.addEventListener('keydown', (e) => {
  if ($$('dialog').some((d) => /** @type {HTMLDialogElement} */ (d).open)) return;
  const ctrl = e.ctrlKey || e.metaKey;
  let key = null;
  if (ctrl && (e.key === '=' || e.key === '+')) key = 'zoom-in';
  else if (ctrl && e.key === '-') key = 'zoom-out';
  else if (ctrl && e.key === '0') key = 'zoom-reset';
  else if (ctrl && e.key.toLowerCase() === 'w') key = 'close-tab';
  else if (ctrl && e.key === 'Tab') key = e.shiftKey ? 'prev-tab' : 'next-tab';
  else if (e.altKey && e.key === 'Home') key = 'home';
  else if (ctrl && e.key === ',') { e.preventDefault(); openSettings(); return; }
  else if (e.key === 'Escape' && state.arranging) { setArranging(false); return; }
  if (!key) return;
  e.preventDefault();
  handleKey(key);
});

function openSettings() { fillSettings(); openDialog($('#settings')); }

// ---------- wiring ----------

function wire() {
  $('#tab-home').addEventListener('click', () => hub.activateTab(null));
  $('#btn-smaller').addEventListener('click', () => stepFont(-1));
  $('#btn-larger').addEventListener('click', () => stepFont(1));
  $('#btn-theme').addEventListener('click', () => saveSettings({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }));
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-add').addEventListener('click', openAdd);
  $('#btn-arrange').addEventListener('click', () => setArranging(!state.arranging));
  $('#btn-rescan').addEventListener('click', () => hub.rescan());

  $('#btn-add-web').addEventListener('click', addWebAddress);
  $('#add-web-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addWebAddress(); } });
  $('#btn-add-program').addEventListener('click', async () => {
    const r = await hub.chooseProgram();
    if (r) { /** @type {HTMLDialogElement} */ ($('#add')).close(); toast(`Added ${r.name}.`); }
  });

  $('#rename-cancel').addEventListener('click', () => /** @type {HTMLDialogElement} */ ($('#rename')).close());
  $('#rename-form').addEventListener('submit', () => { if (renaming) hub.renameTile(renaming, /** @type {HTMLInputElement} */ ($('#rename-input')).value); renaming = null; });

  $('#set-theme').addEventListener('change', (e) => saveSettings({ theme: /** @type {HTMLSelectElement} */ (e.target).value }));
  $('#set-font').addEventListener('change', (e) => saveSettings({ fontSize: Number(/** @type {HTMLSelectElement} */ (e.target).value) }));
  $('#set-tiles').addEventListener('change', (e) => saveSettings({ tileSize: /** @type {HTMLSelectElement} */ (e.target).value }));
  for (const r of $$('input[name="openWeb"]')) r.addEventListener('change', (e) => saveSettings({ openWeb: /** @type {HTMLInputElement} */ (e.target).value }));
  $('#set-cli').addEventListener('change', (e) => saveSettings({ showCli: /** @type {HTMLInputElement} */ (e.target).checked }));
  $('#set-startup').addEventListener('change', (e) => saveSettings({ startWithWindows: /** @type {HTMLInputElement} */ (e.target).checked }));
  $('#set-tray').addEventListener('change', (e) => saveSettings({ closeToTray: /** @type {HTMLInputElement} */ (e.target).checked }));
  $('#set-update').addEventListener('change', (e) => saveSettings({ autoUpdate: /** @type {HTMLInputElement} */ (e.target).checked }));
  $('#btn-signout').addEventListener('click', async () => {
    /** @type {HTMLDialogElement} */ ($('#settings')).close();
    if (await confirmBox('This closes every web tab and signs you out of every web AI inside AI Hub (your normal browser is not affected). You will need to sign in again.', 'Sign out of all')) {
      await hub.signOutAll();
      toast('Signed out of all web AIs in AI Hub.');
    }
  });
  $('#btn-check-update').addEventListener('click', async () => { onUpdate({ ...state.update, state: 'checking' }); onUpdate(await hub.checkUpdate()); });
  $('#btn-data-folder').addEventListener('click', () => hub.openDataFolder());
  $('#btn-quit').addEventListener('click', () => hub.quit());

  $('#btn-update-later').addEventListener('click', () => { state.updateDismissed = true; $('#update-banner').hidden = true; requestAnimationFrame(sendBounds); });
  $('#btn-update-now').addEventListener('click', async () => { if (await hub.installUpdate()) $('#update-text').textContent = 'Restarting to install the update…'; });

  $('#web-back').addEventListener('click', () => activeTab() && hub.navTab(activeTab().id, 'back'));
  $('#web-forward').addEventListener('click', () => activeTab() && hub.navTab(activeTab().id, 'forward'));
  $('#web-reload').addEventListener('click', () => activeTab() && hub.navTab(activeTab().id, 'reload'));
  $('#web-start').addEventListener('click', () => activeTab() && hub.navTab(activeTab().id, 'start'));
  $('#web-external').addEventListener('click', () => activeTab() && hub.navTab(activeTab().id, 'external'));
  $('#web-close').addEventListener('click', () => activeTab() && hub.closeTab(activeTab().id));
  $('#web-zoom-in').addEventListener('click', () => activeTab() && hub.zoomTab(activeTab().id, 'in'));
  $('#web-zoom-out').addEventListener('click', () => activeTab() && hub.zoomTab(activeTab().id, 'out'));
  $('#web-zoom-reset').addEventListener('click', () => activeTab() && hub.zoomTab(activeTab().id, 'reset'));

  hub.onTiles((tiles) => { state.tiles = tiles; renderTiles(); });
  hub.onScanning(setScanning);
  hub.onTabs((tabs) => { state.tabs = tabs; renderTabs(); });
  hub.onKey(handleKey);
  hub.onToast((text) => toast(text));
  hub.onSettings((s) => { state.settings = s; applyAppearance(); fillSettings(); });
  hub.onTileAction(({ action, id }) => {
    if (action === 'rename') rename(id);
    else if (action === 'remove') removeTile(id);
    else if (action === 'move-left') move(id, -1);
    else if (action === 'move-right') move(id, 1);
  });
  hub.onUpdate(onUpdate);
}

async function start() {
  const init = await hub.init();
  Object.assign(state, { settings: init.settings, tiles: init.tiles, tabs: init.tabs, webAis: init.webAis, platform: init.platform });
  $('#about-version').textContent = `version ${init.version}${init.fake ? ' (test mode)' : ''}`;
  $('#startup-note').hidden = init.packaged;
  wire();
  applyAppearance();
  renderTiles();
  setScanning(init.scanning);
  hub.updateStatus().then(onUpdate);
  document.body.dataset.ready = '1';
}

start();
