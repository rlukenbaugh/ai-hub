'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { matchAiApp } = require('../../src/core/catalog');
const { discover, parseStartApps, storeFamily, appIdPath, manifestLogo, pickLogoFile, idFor } = require('../../src/core/discovery');
const { launchSpec, terminalPath } = require('../../src/core/launch');
const { safeWebUrl, externalUrl, navigable } = require('../../src/core/urls');
const { createStore, mergeSettings, buildTiles, mergeTiles } = require('../../src/core/store');

const P = path.win32;

// ---------- a pretend Windows file system ----------

function fakeFs(files) {
  const set = new Set(files.map((f) => f.toLowerCase()));
  const dirs = new Map();
  for (const f of files) {
    let child = f;
    let parent = P.dirname(f);
    while (parent !== child) {
      if (!dirs.has(parent.toLowerCase())) dirs.set(parent.toLowerCase(), new Map());
      dirs.get(parent.toLowerCase()).set(P.basename(child), child === f ? 'file' : 'dir');
      child = parent; parent = P.dirname(parent);
    }
  }
  return {
    readdirSync(dir) {
      const m = dirs.get(String(dir).toLowerCase());
      if (!m) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return [...m].map(([name, kind]) => ({ name, isDirectory: () => kind === 'dir', isFile: () => kind === 'file' }));
    },
    statSync(file) {
      if (!set.has(String(file).toLowerCase())) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { isFile: () => true };
    },
  };
}

const ENV = {
  USERPROFILE: 'C:\\Users\\Ron',
  APPDATA: 'C:\\Users\\Ron\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\Ron\\AppData\\Local',
  ProgramData: 'C:\\ProgramData',
  ProgramW6432: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  SystemRoot: 'C:\\Windows',
  PATH: 'C:\\Windows\\System32;C:\\Users\\Ron\\.local\\bin;C:\\Users\\Ron\\AppData\\Roaming\\npm',
};
const USER_MENU = 'C:\\Users\\Ron\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs';
const ALL_MENU = 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs';

// ---------- catalog ----------

test('AI names are recognised, and uninstallers, help links and AI Hub itself are not', () => {
  for (const name of ['Claude', 'ChatGPT', 'Copilot', 'Microsoft 365 Copilot', 'Perplexity', 'LM Studio', 'Ollama', 'Ron Assistant', 'Jarvis', 'Cursor']) assert.ok(matchAiApp(name), name);
  for (const name of ['Uninstall Claude', 'LM Studio Help', 'Ollama website', 'AI Hub', 'Notepad', 'Claudette', 'Microsoft Edge', 'Jan Tool']) assert.equal(matchAiApp(name), null, name);
});

// ---------- discovery ----------

test('Get-StartApps output is read whether it is one entry, a list, nothing, or not JSON', () => {
  assert.deepEqual(parseStartApps('{"Name":"Claude","AppID":"com.squirrel.AnthropicClaude.claude"}'), [{ name: 'Claude', appId: 'com.squirrel.AnthropicClaude.claude' }]);
  assert.equal(parseStartApps('[{"Name":"A","AppID":"x"},{"Name":"B","AppID":"y"},{"Name":5}]').length, 2);
  assert.deepEqual(parseStartApps(''), []);
  assert.deepEqual(parseStartApps('Get-StartApps : not recognised'), []);
  assert.equal(parseStartApps('\uFEFF[{"Name":"A","AppID":"x"}]').length, 1);
});

test('Store AppIDs and desktop AppIDs are told apart, and folder GUIDs become real paths', () => {
  assert.deepEqual(storeFamily('OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0!ChatGPT'), { family: 'OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0', app: 'ChatGPT' });
  assert.equal(storeFamily('com.squirrel.AnthropicClaude.claude'), null);
  assert.equal(appIdPath('{6D809377-6AF0-444B-8957-A3773F02200E}\\Ollama\\ollama app.exe', ENV), 'C:\\Program Files\\Ollama\\ollama app.exe');
  assert.equal(appIdPath('{7c5a40ef-a0fb-4bfc-874a-c0f2e0b9fa8e}\\Tool\\t.exe', ENV), 'C:\\Program Files (x86)\\Tool\\t.exe');
  assert.equal(appIdPath('C:\\Tools\\jan.exe', ENV), 'C:\\Tools\\jan.exe');
  assert.equal(appIdPath('Microsoft.Windows.Explorer', ENV), null);
});

test('discovery combines Start-menu apps, Store apps, shortcuts, usual folders and command-line AIs', async () => {
  const files = [
    `${USER_MENU}\\Claude.lnk`,
    `${USER_MENU}\\Uninstall Claude.lnk`,
    `${USER_MENU}\\LM Studio\\LM Studio.lnk`,
    `${ALL_MENU}\\Ollama.lnk`,
    `${ALL_MENU}\\Notepad++.lnk`,
    'C:\\Users\\Ron\\AppData\\Local\\Programs\\ron-assistant-claude\\Ron Assistant.exe',
    'C:\\Users\\Ron\\.local\\bin\\claude.exe',
    'C:\\Users\\Ron\\AppData\\Roaming\\npm\\codex.cmd',
  ];
  const startApps = JSON.stringify([
    { Name: 'Claude', AppID: 'com.squirrel.AnthropicClaude.claude' },
    { Name: 'ChatGPT', AppID: 'OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0!ChatGPT' },
    { Name: 'Copilot', AppID: 'Microsoft.Copilot_8wekyb3d8bbwe!App' },
    { Name: 'Claude', AppID: 'duplicate' },
    { Name: 'Uninstall Claude', AppID: 'x' },
    { Name: 'Calculator', AppID: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
  ]);
  const targets = { [`${USER_MENU}\\Claude.lnk`]: 'C:\\Users\\Ron\\AppData\\Local\\AnthropicClaude\\claude.exe', [`${USER_MENU}\\LM Studio\\LM Studio.lnk`]: 'C:\\Users\\Ron\\AppData\\Local\\Programs\\LM Studio\\LM Studio.exe' };
  const list = await discover({ env: ENV, fs: fakeFs(files), startApps: async () => startApps, readShortcut: (l) => ({ target: targets[l] }) });
  const byName = Object.fromEntries(list.map((d) => [d.name, d]));

  assert.deepEqual(Object.keys(byName).sort(), ['ChatGPT', 'Claude', 'Claude Code', 'Codex CLI', 'Copilot', 'LM Studio', 'Ollama', 'Ron Assistant'].sort());
  assert.equal(byName.Claude.appId, 'com.squirrel.AnthropicClaude.claude');
  assert.equal(byName.Claude.target, 'C:\\Users\\Ron\\AppData\\Local\\AnthropicClaude\\claude.exe', 'icon comes from the shortcut target');
  assert.equal(byName.ChatGPT.family, 'OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0');
  assert.equal(byName.ChatGPT.target, undefined);
  assert.equal(byName['LM Studio'].shortcut, `${USER_MENU}\\LM Studio\\LM Studio.lnk`, 'found from a shortcut in a sub-folder');
  assert.equal(byName['Ron Assistant'].target, 'C:\\Users\\Ron\\AppData\\Local\\Programs\\ron-assistant-claude\\Ron Assistant.exe', 'found in its usual folder');
  assert.equal(byName['Claude Code'].kind, 'cli');
  assert.equal(byName['Claude Code'].target, 'C:\\Users\\Ron\\.local\\bin\\claude.exe');
  assert.equal(byName['Codex CLI'].target, 'C:\\Users\\Ron\\AppData\\Roaming\\npm\\codex.cmd');
  assert.equal(byName.Claude.id, idFor('app', 'claude'), 'ids depend on the name only, so tiles keep their place');
  // Programs come before command-line AIs.
  assert.ok(list.findIndex((d) => d.kind === 'cli') > list.findLastIndex((d) => d.kind === 'app'));
});

test('if PowerShell fails, Start-menu shortcuts are still found', async () => {
  const list = await discover({ env: ENV, fs: fakeFs([`${USER_MENU}\\ChatGPT.lnk`]), startApps: async () => { throw new Error('no powershell'); } });
  assert.deepEqual(list.map((d) => d.name), ['ChatGPT']);
  assert.equal(list[0].shortcut, `${USER_MENU}\\ChatGPT.lnk`);
});

test('an empty computer finds nothing and does not fail', async () => {
  assert.deepEqual(await discover({ env: {}, fs: fakeFs([]), startApps: async () => '' }), []);
});

test('Store logos: the declared logo is read from the manifest and the sharpest file is chosen', () => {
  const manifest = `<Package><Properties><Logo>Assets\\StoreLogo.png</Logo></Properties><Applications>
    <Application Id="Other"><uap:VisualElements Square150x150Logo="Assets\\Other.png"/></Application>
    <Application Id="ChatGPT" Executable="ChatGPT.exe"><uap:VisualElements DisplayName="ChatGPT" Square150x150Logo="Assets\\Square150x150Logo.png" Square44x44Logo="Assets\\Square44x44Logo.png"/></Application>
  </Applications></Package>`;
  assert.equal(manifestLogo(manifest, 'ChatGPT'), 'Assets\\Square150x150Logo.png');
  assert.equal(manifestLogo('<Package><Properties><Logo>Assets\\StoreLogo.png</Logo></Properties></Package>', 'App'), 'Assets\\StoreLogo.png');
  const files = ['Square150x150Logo.scale-100.png', 'Square150x150Logo.scale-200.png', 'Square150x150Logo.scale-400.png', 'Square44x44Logo.targetsize-256.png', 'Other.png'];
  assert.equal(pickLogoFile('Assets\\Square150x150Logo.png', files), 'Square150x150Logo.scale-200.png');
  assert.equal(pickLogoFile('Assets\\Square44x44Logo.png', [...files, 'Square44x44Logo.targetsize-48.png', 'Square44x44Logo.targetsize-256_altform-unplated.png']), 'Square44x44Logo.targetsize-256.png');
  assert.equal(pickLogoFile('Assets\\StoreLogo.png', ['StoreLogo.png']), 'StoreLogo.png');
  assert.equal(pickLogoFile('Assets\\Missing.png', files), null);
});

// ---------- launching ----------

test('Start-menu and Store apps start through shell:AppsFolder, like the Start menu', () => {
  assert.deepEqual(launchSpec({ kind: 'app', name: 'ChatGPT', appId: 'OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0!ChatGPT' }, { home: 'C:\\Users\\Ron', terminal: null }),
    { type: 'spawn', command: 'explorer.exe', args: ['shell:AppsFolder\\OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0!ChatGPT'] });
});

test('programs without an AppID open their shortcut or program file', () => {
  assert.deepEqual(launchSpec({ kind: 'app', name: 'LM Studio', shortcut: 'C:\\x\\LM Studio.lnk', target: 'C:\\y\\LM Studio.exe' }, { home: 'C:\\Users\\Ron', terminal: null }), { type: 'open', file: 'C:\\x\\LM Studio.lnk' });
  assert.deepEqual(launchSpec({ kind: 'program', name: 'Tool', path: 'D:\\Tools\\tool.exe' }, { home: 'C:\\Users\\Ron', terminal: null }), { type: 'open', file: 'D:\\Tools\\tool.exe' });
});

test('command-line AIs open in Windows Terminal, or in a console window without it', () => {
  const tile = { kind: 'cli', name: 'Claude Code', target: 'C:\\Users\\Ron Smith\\.local\\bin\\claude.exe' };
  const wt = 'C:\\Users\\Ron\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe';
  assert.deepEqual(launchSpec(tile, { home: 'C:\\Users\\Ron Smith', terminal: wt }),
    { type: 'spawn', command: wt, args: ['new-tab', '--title', 'Claude Code', '-d', 'C:\\Users\\Ron Smith', 'C:\\Users\\Ron Smith\\.local\\bin\\claude.exe'] });
  // A batch file (npm's codex.cmd) runs through cmd.exe and the window stays open.
  assert.deepEqual(launchSpec({ kind: 'cli', name: 'Codex CLI', target: 'C:\\npm\\codex.cmd' }, { home: 'C:\\Users\\Ron', terminal: wt }).args.slice(-3), ['cmd.exe', '/k', 'C:\\npm\\codex.cmd']);
  const plain = launchSpec(tile, { home: 'C:\\Users\\Ron Smith', terminal: null });
  assert.equal(plain.type, 'spawn');
  if (plain.type !== 'spawn') return;
  assert.equal(plain.command, 'cmd.exe');
  assert.equal(plain.verbatim, true);
  assert.equal(plain.args.join(' '), '/d /c start "Claude Code" /D "C:\\Users\\Ron Smith" cmd.exe /k ""C:\\Users\\Ron Smith\\.local\\bin\\claude.exe""');
});

test('names and paths cannot break out of the command line', () => {
  assert.throws(() => launchSpec({ kind: 'app', name: 'x', appId: 'a" & calc & "' }, { home: 'C:\\', terminal: null }));
  assert.throws(() => launchSpec({ kind: 'cli', name: 'x', target: 'C:\\a"b.exe' }, { home: 'C:\\', terminal: null }));
  assert.throws(() => launchSpec({ kind: 'web', name: 'x', url: 'https://a.b' }, { home: 'C:\\', terminal: null }));
  assert.throws(() => launchSpec({ kind: 'app', name: 'x' }, { home: 'C:\\', terminal: null }));
  const spec = launchSpec({ kind: 'cli', name: 'Bad & "name" | x', target: 'C:\\a\\b.exe' }, { home: 'C:\\', terminal: null });
  assert.ok(spec.type === 'spawn' && spec.args[3] === '"Bad  name  x"');
  // ";" would split a Windows Terminal command, so a console window is used instead.
  const semi = launchSpec({ kind: 'cli', name: 'x', target: 'C:\\a;b\\c.exe' }, { home: 'C:\\', terminal: 'wt.exe' });
  assert.ok(semi.type === 'spawn' && semi.command === 'cmd.exe');
});

test('Windows Terminal is used only if its app alias exists', () => {
  assert.equal(terminalPath({ LOCALAPPDATA: 'C:\\L' }, () => false), null);
  assert.equal(terminalPath({ LOCALAPPDATA: 'C:\\L' }, (f) => f === 'C:\\L\\Microsoft\\WindowsApps\\wt.exe'), 'C:\\L\\Microsoft\\WindowsApps\\wt.exe');
  assert.equal(terminalPath({}, () => true), null);
});

// ---------- web addresses ----------

test('web tiles take https sites and local http pages only', () => {
  assert.equal(safeWebUrl('chatgpt.com'), 'https://chatgpt.com/');
  assert.equal(safeWebUrl('https://claude.ai/new'), 'https://claude.ai/new');
  assert.equal(safeWebUrl('http://localhost:8080'), 'http://localhost:8080/');
  assert.equal(safeWebUrl('http://127.0.0.1:1234/chat'), 'http://127.0.0.1:1234/chat');
  for (const bad of ['http://example.com', 'file:///C:/Windows/notepad.exe', 'javascript:alert(1)', 'https://user:pw@site.com', 'https://intranet', 'two words.com', '', 'data:text/html,hi']) assert.equal(safeWebUrl(bad), null, bad);
  assert.equal(externalUrl('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(externalUrl('file:///C:/x'), null);
  assert.equal(navigable('https://accounts.google.com/x'), true);
  assert.equal(navigable('ms-settings:'), false);
});

// ---------- settings and tiles ----------

test('settings: defaults are Ron\'s choices, and bad values fall back', () => {
  const d = mergeSettings({});
  assert.equal(d.startWithWindows, true);
  assert.equal(d.closeToTray, true);
  assert.equal(d.openWeb, 'hub');
  assert.equal(d.fontSize, 18);
  const s = mergeSettings({ theme: 'neon', fontSize: 99, tileSize: 'tiny', openWeb: 'x', startWithWindows: false, unknown: 1 });
  assert.equal(s.theme, 'system'); assert.equal(s.fontSize, 28); assert.equal(s.tileSize, 'large'); assert.equal(s.openWeb, 'hub'); assert.equal(s.startWithWindows, false);
  assert.equal('unknown' in s, false);
});

test('a new installation starts with a ChatGPT web tile', () => {
  const t = mergeTiles(null);
  assert.deepEqual(t.custom.map((c) => [c.id, c.url]), [['web:chatgpt', 'https://chatgpt.com/']]);
});

test('tile order: saved order first, then web tiles, programs and command-line AIs; hidden and renamed tiles respected', () => {
  const tiles = mergeTiles({
    custom: [{ id: 'web:chatgpt', kind: 'web', name: 'ChatGPT', url: 'https://chatgpt.com/' }],
    detected: [{ id: 'cli:claude-code', name: 'Claude Code', kind: 'cli' }, { id: 'app:a', name: 'Claude', kind: 'app' }, { id: 'app:b', name: 'Copilot', kind: 'app' }],
    hidden: ['app:b'], names: { 'app:a': 'Claude desktop' }, order: ['cli:claude-code'],
  });
  const settings = mergeSettings({});
  assert.deepEqual(buildTiles(tiles, settings).map((t) => t.name), ['Claude Code', 'ChatGPT', 'Claude desktop']);
  assert.deepEqual(buildTiles(tiles, { ...settings, showCli: false }).map((t) => t.id), ['web:chatgpt', 'app:a']);
});

test('the store adds, renames, reorders, removes and restores tiles, and keeps them across a new scan', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-hub-store-'));
  const store = createStore(dir);
  store.saveDetected([{ id: 'app:x', name: 'Claude', kind: 'app' }, { id: 'app:y', name: 'LM Studio', kind: 'app' }]);
  const web = store.addWeb({ name: '', url: 'perplexity.ai' });
  assert.equal(store.find(web).name, 'perplexity.ai');
  assert.throws(() => store.addWeb({ name: 'x', url: 'http://evil.example' }), /https/);
  const prog = store.addProgram({ file: 'D:\\Tools\\My AI.exe' });
  assert.equal(store.find(prog).name, 'My AI');

  store.rename('app:x', '  Claude\ndesktop ');
  assert.equal(store.find('app:x').name, 'Claude desktop');
  store.rename('app:x', '');
  assert.equal(store.find('app:x').name, 'Claude');

  const ids = store.list().map((t) => t.id).reverse();
  store.reorder(ids);
  assert.deepEqual(store.list().map((t) => t.id), ids);

  store.remove('app:y');
  store.remove(web);
  assert.equal(store.find('app:y'), null);
  assert.equal(store.find(web), null);
  assert.deepEqual(store.hiddenList().map((h) => h.id), ['app:y']);

  // A new scan finds LM Studio again: it stays removed, and Claude keeps its place.
  store.saveDetected([{ id: 'app:x', name: 'Claude', kind: 'app' }, { id: 'app:y', name: 'LM Studio', kind: 'app' }]);
  assert.equal(store.find('app:y'), null);
  store.restore('app:y');
  assert.ok(store.find('app:y'));

  // Saved files that were edited by hand cannot add unsafe tiles.
  const raw = JSON.parse(fs.readFileSync(store.files.tiles, 'utf8'));
  raw.custom.push({ id: 'custom:bad', kind: 'web', name: 'bad', url: 'file:///C:/Windows/system32/calc.exe' });
  raw.icons = { 'app:x': 'javascript:alert(1)' };
  fs.writeFileSync(store.files.tiles, JSON.stringify(raw));
  assert.equal(store.find('custom:bad'), null);
  assert.deepEqual(store.getTiles().icons, {});
  fs.rmSync(dir, { recursive: true, force: true });
});
