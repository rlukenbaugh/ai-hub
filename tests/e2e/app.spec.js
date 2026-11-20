'use strict';
/* global hub */
// End-to-end checks of the real Electron app. Programs are stand-ins (AI_HUB_FAKE=1): launches,
// browser links and start-up changes are written to a log instead of happening. Web tabs load a
// small page served on this computer.
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const root = path.join(__dirname, '..', '..');
const shots = path.join(root, 'test-results', 'screens');
// Chromium refuses to run as root on Linux without this (CI on Windows does not need it).
const extraArgs = process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [];

let server;
let baseUrl;
test.beforeAll(async () => {
  fs.mkdirSync(shots, { recursive: true });
  server = http.createServer((req, res) => {
    const page = (title, body) => `<!doctype html><title>${title}</title><body style="font:20px sans-serif">${body}</body>`;
    res.setHeader('content-type', 'text/html');
    if (req.url.startsWith('/second')) return res.end(page('Second page', '<h1>Second page</h1>'));
    res.end(page('Local AI chat', '<h1>Local AI chat</h1><a id="next" href="/second">next</a> <a id="away" target="_blank" href="https://example.com/answer-link">a link in an answer</a> <a id="file" href="file:///C:/Windows/notepad.exe">file</a>'));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
});
test.afterAll(() => server?.close());

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-hub-e2e-')); }
function actions(log) { return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; }

async function launch(dataDir, extraEnv = {}) {
  const log = path.join(dataDir, 'actions.jsonl');
  const app = await electron.launch({
    args: [root, ...extraArgs],
    env: { ...process.env, AI_HUB_FAKE: '1', AI_HUB_DATA_DIR: dataDir, AI_HUB_FAKE_LOG: log, ...extraEnv },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('body[data-ready="1"]');
  return { app, page, log };
}
const tile = (page, name) => page.locator('.tile', { has: page.locator('.tile-name', { hasText: new RegExp(`^${name}$`) }) });
/** Pictures of the hub page and of the web page in the open tab (Electron draws them separately). */
async function windowShot(app, name) {
  const [hubPng, webPng] = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const view = /** @type {any} */ (w.contentView.children[0]);
    return [(await w.capturePage()).toPNG().toString('base64'), view ? (await view.webContents.capturePage()).toPNG().toString('base64') : ''];
  });
  fs.writeFileSync(path.join(shots, name), Buffer.from(hubPng, 'base64'));
  if (webPng) fs.writeFileSync(path.join(shots, name.replace('.png', '-page.png')), Buffer.from(webPng, 'base64'));
}
async function quit(app) { await app.evaluate(({ app: a }) => { a.quit(); }); await app.close().catch(() => {}); }

/** The web pages shown in the window (the tab views), with their addresses and visibility. */
async function views(app) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map((v) => ({
    url: /** @type {any} */ (v).webContents?.getURL(), visible: v.getVisible(), bounds: v.getBounds(),
  })));
}

test('tiles: programs on this PC and the ChatGPT web tile appear; a program tile starts the program', async () => {
  const { app, page, log } = await launch(tmpDir());
  for (const name of ['ChatGPT', 'Claude', 'LM Studio', 'Claude Code']) await expect(tile(page, name).first()).toBeVisible();
  // Two ChatGPT tiles: the web one and the Store app.
  await expect(page.locator('.tile[data-kind="web"] .tile-name')).toHaveText(['ChatGPT']);
  await expect(page.locator('.tile[data-kind="app"] .tile-name', { hasText: 'ChatGPT' })).toHaveCount(1);
  await expect(page.locator('.tile[data-kind="cli"] .tile-sub')).toHaveText(['Command line']);

  // Tiles without a picture show a coloured letter (the page's security policy must not strip the colour).
  const badge = page.locator('.tile[data-kind="cli"] .letter');
  await expect(badge).toHaveText('C');
  expect(await badge.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(217, 119, 87)');
  await page.screenshot({ path: path.join(shots, 'home-light.png') });
  await tile(page, 'LM Studio').click();
  await expect(page.locator('#toast')).toContainText('Starting LM Studio');
  await page.locator('.tile[data-kind="app"]', { hasText: 'ChatGPT' }).click();
  await tile(page, 'Claude Code').click();
  await expect.poll(() => actions(log).filter((a) => a.type === 'launch').length).toBe(3);
  const launches = actions(log).filter((a) => a.type === 'launch');
  expect(launches[0].spec).toEqual({ type: 'open', file: 'C:\\Users\\Test\\AppData\\Local\\Programs\\LM Studio\\LM Studio.exe' });
  expect(launches[1].spec).toEqual({ type: 'spawn', command: 'explorer.exe', args: ['shell:AppsFolder\\OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0!ChatGPT'] });
  // Windows Terminal if the machine has it, otherwise a console window.
  expect(launches[2].spec.command).toMatch(/(^cmd\.exe|\\wt\.exe)$/);
  await quit(app);
});

test('web tiles open in a signed-in tab inside the hub; links in answers go to the browser; unsafe links are refused', async () => {
  const { app, page, log } = await launch(tmpDir());
  // Add a local web page as a tile (the real sites are not reachable from the test machine).
  await page.locator('#btn-add').click();
  await page.locator('#add-web-name').fill('Local AI');
  await page.locator('#add-web-url').fill(baseUrl);
  await page.locator('#btn-add-web').click();
  await expect(page.locator('#add')).not.toBeVisible();
  await tile(page, 'Local AI').click();

  const tab = page.locator('.tab[data-tab]');
  await expect(tab).toHaveCount(1);
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#home')).toBeHidden();
  await expect(page.locator('#web-host')).toContainText('Local AI chat');
  await expect.poll(async () => (await views(app))[0]?.url).toBe(baseUrl);
  let v = (await views(app))[0];
  expect(v.visible).toBe(true);
  const area = await page.locator('#web-area').boundingBox();
  expect(Math.abs(v.bounds.y - area.y)).toBeLessThan(2);
  expect(Math.abs(v.bounds.height - area.height)).toBeLessThan(2);

  await windowShot(app, 'web-tab.png');
  // The page uses its own saved profile, not the hub's.
  const partition = await app.evaluate(({ BrowserWindow }) => {
    const wc = /** @type {any} */ (BrowserWindow.getAllWindows()[0].contentView.children[0]).webContents;
    return { persistent: wc.session.isPersistent(), path: wc.session.storagePath || '' };
  });
  expect(partition.persistent).toBe(true);
  expect(partition.path).toContain('web-ai');

  // Inside the page: an ordinary link, a "new tab" link and a file: link.
  const pageJs = (js) => app.evaluate(({ BrowserWindow }, code) => /** @type {any} */ (BrowserWindow.getAllWindows()[0].contentView.children[0]).webContents.executeJavaScript(code, true), js); // as if clicked by a person
  await pageJs("document.getElementById('away').click()");
  await expect.poll(() => actions(log).filter((a) => a.type === 'external').map((a) => a.url)).toEqual(['https://example.com/answer-link']);
  await pageJs("document.getElementById('file').click()");
  await pageJs("document.getElementById('next').click()");
  await expect(page.locator('#web-host')).toContainText('Second page');
  expect((await views(app))[0].url).toBe(`${baseUrl}second`);
  await expect(page.locator('#web-back')).toBeEnabled();
  await page.locator('#web-back').click();
  await expect(page.locator('#web-host')).toContainText('Local AI chat');

  // Zoom for readability.
  await page.locator('#web-zoom-in').click();
  await expect(page.locator('#web-zoom')).toHaveText('110%');
  await page.locator('#web-zoom-reset').click();
  await expect(page.locator('#web-zoom')).toHaveText('100%');

  // Home hides the page; the tab stays open. Clicking the tile again reuses the tab.
  await page.locator('#tab-home').click();
  await expect(page.locator('#home')).toBeVisible();
  expect((await views(app))[0].visible).toBe(false);
  await tile(page, 'Local AI').click();
  await expect(page.locator('.tab[data-tab]')).toHaveCount(1);
  expect((await views(app))[0].visible).toBe(true);

  // A dialog over a web tab hides the page so the dialog can be seen.
  await page.locator('#btn-settings').click();
  expect((await views(app))[0].visible).toBe(false);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await views(app))[0].visible).toBe(true);

  await page.locator('#web-close').click();
  await expect(page.locator('.tab[data-tab]')).toHaveCount(0);
  await expect(page.locator('#home')).toBeVisible();
  expect(await views(app)).toEqual([]);

  // Only https sites, or http on this computer.
  await page.locator('#btn-add').click();
  await page.locator('#add-web-url').fill('http://example.com');
  await page.locator('#btn-add-web').click();
  await expect(page.locator('#add-web-error')).toContainText('https://');
  await page.keyboard.press('Escape');
  await quit(app);
});

test('web AIs can open in the normal browser instead (setting, or right-click for one time)', async () => {
  const { app, page, log } = await launch(tmpDir());
  await page.locator('#btn-settings').click();
  await page.locator('input[name="openWeb"][value="browser"]').check();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tile[data-kind="web"] .tile-sub')).toHaveText('Web · opens in your browser');
  await page.locator('.tile[data-kind="web"]').click();
  await expect.poll(() => actions(log).filter((a) => a.type === 'external').map((a) => a.url)).toEqual(['https://chatgpt.com/']);
  await expect(page.locator('.tab[data-tab]')).toHaveCount(0);
  await quit(app);
});

test('arrange: move, rename and remove tiles; removed programs come back from Add; changes survive a restart', async () => {
  const dir = tmpDir();
  let { app, page } = await launch(dir);
  const names = () => page.locator('.tile-name').allTextContents();
  await expect(tile(page, 'Claude Code')).toBeVisible();
  const before = await names();
  expect(before[0]).toBe('ChatGPT');

  await page.locator('#btn-arrange').click();
  await expect(page.locator('#arrange-hint')).toBeVisible();
  await page.getByRole('button', { name: 'Move ChatGPT right' }).first().click();
  await expect.poll(names).toEqual([before[1], before[0], ...before.slice(2)]);
  // Keyboard focus stays on the moved tile.
  await expect(page.locator(':focus')).toHaveAttribute('aria-label', /Move ChatGPT/);

  await page.getByRole('button', { name: 'Rename LM Studio' }).click();
  await page.locator('#rename-input').fill('Local models');
  await page.locator('#rename-save').click();
  await expect(tile(page, 'Local models')).toBeVisible();

  await page.getByRole('button', { name: 'Remove Claude Code' }).click();
  await expect(tile(page, 'Claude Code')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('Removed Claude Code');
  await page.locator('#btn-arrange').click();
  await page.screenshot({ path: path.join(shots, 'home-arranged.png') });
  const arranged = await names();
  await quit(app);

  ({ app, page } = await launch(dir));
  await expect(tile(page, 'Local models')).toBeVisible();
  await expect.poll(names).toEqual(arranged);
  // A fresh scan finds Claude Code again, but it stays removed until brought back.
  await page.locator('#btn-rescan').click();
  await expect(page.locator('#btn-rescan')).toBeEnabled();
  await expect(tile(page, 'Claude Code')).toHaveCount(0);
  await page.locator('#btn-add').click();
  await page.locator('[data-restore="cli:claude-code"]').click();
  await page.keyboard.press('Escape');
  await expect(tile(page, 'Claude Code')).toBeVisible();

  // Renaming to nothing goes back to the program's own name.
  await page.locator('#btn-arrange').click();
  await page.getByRole('button', { name: 'Rename Local models' }).click();
  await page.locator('#rename-input').fill('');
  await page.locator('#rename-input').press('Enter');
  await expect(tile(page, 'LM Studio')).toBeVisible();
  await quit(app);
});

test('add a web AI with one click; it is then marked as added', async () => {
  const { app, page } = await launch(tmpDir());
  await page.locator('#btn-add').click();
  await expect(page.locator('[data-web="chatgpt"]')).toBeDisabled();
  await page.screenshot({ path: path.join(shots, 'add-dialog.png') });
  await page.locator('[data-web="claude"]').click();
  await expect(page.locator('[data-web="claude"]')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tile[data-kind="web"] .tile-name')).toHaveText(['ChatGPT', 'Claude']);
  await quit(app);
});

test('appearance: dark mode, larger text and extra-large tiles are applied and kept', async () => {
  const dir = tmpDir();
  let { app, page } = await launch(dir);
  await page.locator('#btn-theme').click();
  await page.locator('#btn-larger').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#btn-settings').click();
  await page.locator('#set-tiles').selectOption('xlarge');
  await expect(page.locator('#set-font')).toHaveValue('20');
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-tiles', 'xlarge');
  const width = await tile(page, 'Claude').evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThanOrEqual(235);
  await page.screenshot({ path: path.join(shots, 'home-dark-xlarge.png') });
  await quit(app);
  ({ app, page } = await launch(dir));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-tiles', 'xlarge');
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe('20px');
  await quit(app);
});

test('start-up and tray: on by default; closing the window keeps the app running; settings change them', async () => {
  const dir = tmpDir();
  const { app, page, log } = await launch(dir);
  await expect.poll(() => actions(log).filter((a) => a.type === 'login-item').map((a) => a.openAtLogin)).toEqual([true]);
  await page.locator('#btn-settings').click();
  await expect(page.locator('#set-startup')).toBeChecked();
  await page.screenshot({ path: path.join(shots, 'settings.png') });
  await expect(page.locator('#set-tray')).toBeChecked();
  await page.locator('#set-startup').uncheck();
  await expect.poll(() => actions(log).filter((a) => a.type === 'login-item').map((a) => a.openAtLogin)).toEqual([true, false]);
  await page.keyboard.press('Escape');

  const hasTray = !fs.readFileSync(path.join(dir, 'logs', 'app.log'), 'utf8').includes('no tray icon');
  test.skip(!hasTray, 'This desktop has no system tray.');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()))).toEqual([false]);
  // Starting AI Hub again (or clicking the tray icon) shows the same window.
  await app.evaluate(({ app: a }) => a.emit('second-instance'));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
  await quit(app);
});

test('an update that has been downloaded shows a banner with Restart now and Later', async () => {
  const { app, page } = await launch(tmpDir(), { AI_HUB_FAKE_UPDATE: '0.2.0' });
  await page.locator('#btn-settings').click();
  await page.locator('#btn-check-update').click();
  await expect(page.locator('#update-status')).toContainText('0.2.0 is ready');
  await page.keyboard.press('Escape');
  await expect(page.locator('#update-banner')).toBeVisible();
  await expect(page.locator('#update-text')).toContainText('AI Hub 0.2.0 is ready');
  await page.locator('#btn-update-later').click();
  await expect(page.locator('#update-banner')).toBeHidden();
  await quit(app);
});

test('no programs found: an explanation is shown instead of an empty page', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'tiles.json'), JSON.stringify({ custom: [] }));
  const { app, page } = await launch(dir, { AI_HUB_FAKE_EMPTY: '1' });
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#empty')).toContainText('Add a tile');
  await quit(app);
});

test('the hub page cannot open programs or pages it was not given', async () => {
  const { app, page, log } = await launch(tmpDir());
  const err = await page.evaluate(() => hub.openTile('custom:not-a-tile').then(() => 'opened', (e) => String(e.message)));
  expect(err).toContain('no longer exists');
  // Settings the page may not set are ignored.
  const s = await page.evaluate(() => hub.saveSettings({ trayHintShown: true, evil: 1 }));
  expect(s.trayHintShown).toBe(false);
  expect('evil' in s).toBe(false);
  // The hub page itself has no network access.
  const fetched = await page.evaluate(() => fetch('https://example.com').then(() => 'ok', () => 'blocked'));
  expect(fetched).toBe('blocked');
  expect(actions(log).filter((a) => a.type === 'launch' || a.type === 'external')).toEqual([]);
  await quit(app);
});
