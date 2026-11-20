'use strict';
// What counts as an "AI program", and the web AIs offered when adding a tile.
// Names are matched against Start-menu entries, so they follow the names apps install under.
const path = require('node:path');
const os = require('node:os');

/**
 * Start-menu names that are AI programs. `match` is tested against the whole entry name.
 * @type {{ key: string, label: string, match: RegExp, color: string }[]}
 */
const AI_APPS = [
  { key: 'claude', label: 'Claude', match: /^claude$/i, color: '#d97757' },
  { key: 'chatgpt', label: 'ChatGPT', match: /^chatgpt\b/i, color: '#10a37f' },
  { key: 'codex', label: 'Codex', match: /^codex$/i, color: '#10a37f' },
  { key: 'copilot', label: 'Copilot', match: /\bcopilot\b/i, color: '#2f6fdf' },
  { key: 'perplexity', label: 'Perplexity', match: /\bperplexity\b/i, color: '#1f8a8a' },
  { key: 'gemini', label: 'Gemini', match: /\bgemini\b/i, color: '#4f7cf7' },
  { key: 'grok', label: 'Grok', match: /\bgrok\b/i, color: '#3a3a3a' },
  { key: 'deepseek', label: 'DeepSeek', match: /\bdeepseek\b/i, color: '#4d6bfe' },
  { key: 'mistral', label: 'Le Chat', match: /\b(mistral|le chat)\b/i, color: '#fa520f' },
  { key: 'meta-ai', label: 'Meta AI', match: /\bmeta ai\b/i, color: '#0866ff' },
  { key: 'poe', label: 'Poe', match: /^poe$/i, color: '#5d5cde' },
  { key: 'lmstudio', label: 'LM Studio', match: /^lm studio\b/i, color: '#6b4fd8' },
  { key: 'ollama', label: 'Ollama', match: /^ollama\b/i, color: '#444444' },
  { key: 'jan', label: 'Jan', match: /^jan$/i, color: '#2c5bd7' },
  { key: 'gpt4all', label: 'GPT4All', match: /\bgpt4all\b/i, color: '#2c7a51' },
  { key: 'msty', label: 'Msty', match: /^msty\b/i, color: '#8a3ffc' },
  { key: 'anythingllm', label: 'AnythingLLM', match: /\banything ?llm\b/i, color: '#2e7bf6' },
  { key: 'cursor', label: 'Cursor', match: /^cursor$/i, color: '#333333' },
  { key: 'windsurf', label: 'Windsurf', match: /^windsurf\b/i, color: '#0b9f8c' },
  { key: 'antigravity', label: 'Antigravity', match: /\bantigravity\b/i, color: '#4f7cf7' },
  { key: 'kiro', label: 'Kiro', match: /^kiro$/i, color: '#7b3fe4' },
  { key: 'jarvis', label: 'Jarvis', match: /^jarvis\b/i, color: '#1d6fa5' },
  { key: 'ron-assistant', label: 'Ron Assistant', match: /^ron assistant\b/i, color: '#2457c5' },
];

/** Start-menu entries that mention an AI name but are not the program itself. */
const NOT_A_PROGRAM = /\b(uninstall|uninstaller|readme|read me|help|website|documentation|release notes|license|manual|support)\b/i;
/** This app never shows a tile for itself. */
const SELF = /^ai hub$/i;

function matchAiApp(name) {
  const n = String(name || '').trim();
  if (!n || NOT_A_PROGRAM.test(n) || SELF.test(n)) return null;
  return AI_APPS.find((a) => a.match.test(n)) || null;
}

/**
 * Command-line AI programs. They open in a terminal window.
 * `files` are looked for on PATH; `defaults` are the usual install locations.
 */
function cliPrograms(env = process.env) {
  const home = env.USERPROFILE || os.homedir();
  const appData = env.APPDATA || path.win32.join(home, 'AppData', 'Roaming');
  const local = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
  const npm = path.win32.join(appData, 'npm');
  return [
    { key: 'claude-code', label: 'Claude Code', color: '#d97757', files: ['claude.exe', 'claude.cmd'], defaults: [path.win32.join(home, '.local', 'bin', 'claude.exe'), path.win32.join(npm, 'claude.cmd')] },
    { key: 'codex-cli', label: 'Codex CLI', color: '#10a37f', files: ['codex.cmd', 'codex.exe'], defaults: [path.win32.join(npm, 'codex.cmd')] },
    { key: 'gemini-cli', label: 'Gemini CLI', color: '#4f7cf7', files: ['gemini.cmd', 'gemini.exe'], defaults: [path.win32.join(npm, 'gemini.cmd')] },
    { key: 'hermes', label: 'Hermes Agent', color: '#7a5af8', files: ['hermes.exe'], defaults: [path.win32.join(local, 'hermes', 'bin', 'hermes.exe')] },
    { key: 'aider', label: 'Aider', color: '#14a44d', files: ['aider.exe'], defaults: [] },
    { key: 'opencode', label: 'OpenCode', color: '#333333', files: ['opencode.cmd', 'opencode.exe'], defaults: [path.win32.join(npm, 'opencode.cmd')] },
    { key: 'qwen-code', label: 'Qwen Code', color: '#615ced', files: ['qwen.cmd'], defaults: [path.win32.join(npm, 'qwen.cmd')] },
  ];
}

/**
 * Desktop programs that are sometimes missing from the Start menu, checked by location.
 */
function knownAppPaths(env = process.env) {
  const home = env.USERPROFILE || os.homedir();
  const local = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
  const programs = path.win32.join(local, 'Programs');
  return [
    { key: 'claude', label: 'Claude', paths: [path.win32.join(local, 'AnthropicClaude', 'claude.exe')] },
    { key: 'lmstudio', label: 'LM Studio', paths: [path.win32.join(programs, 'LM Studio', 'LM Studio.exe'), path.win32.join(programs, 'lm-studio', 'LM Studio.exe')] },
    { key: 'ollama', label: 'Ollama', paths: [path.win32.join(programs, 'Ollama', 'ollama app.exe')] },
    { key: 'ron-assistant', label: 'Ron Assistant', paths: [path.win32.join(programs, 'ron-assistant-claude', 'Ron Assistant.exe')] },
    { key: 'cursor', label: 'Cursor', paths: [path.win32.join(programs, 'cursor', 'Cursor.exe')] },
    { key: 'jan', label: 'Jan', paths: [path.win32.join(programs, 'jan', 'Jan.exe')] },
  ];
}

/** Web AIs offered as one-click choices in "Add a tile". */
const WEB_AIS = [
  { key: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/', color: '#10a37f' },
  { key: 'claude', label: 'Claude', url: 'https://claude.ai/', color: '#d97757' },
  { key: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/', color: '#4f7cf7' },
  { key: 'copilot', label: 'Copilot', url: 'https://copilot.microsoft.com/', color: '#2f6fdf' },
  { key: 'perplexity', label: 'Perplexity', url: 'https://www.perplexity.ai/', color: '#1f8a8a' },
  { key: 'grok', label: 'Grok', url: 'https://grok.com/', color: '#3a3a3a' },
  { key: 'deepseek', label: 'DeepSeek', url: 'https://chat.deepseek.com/', color: '#4d6bfe' },
  { key: 'mistral', label: 'Le Chat', url: 'https://chat.mistral.ai/', color: '#fa520f' },
  { key: 'notebooklm', label: 'NotebookLM', url: 'https://notebooklm.google.com/', color: '#3c4043' },
  { key: 'meta-ai', label: 'Meta AI', url: 'https://www.meta.ai/', color: '#0866ff' },
];

/** The tiles a new installation starts with (chosen by Ron: ChatGPT). */
const DEFAULT_WEB_TILES = ['chatgpt'];

module.exports = { AI_APPS, matchAiApp, cliPrograms, knownAppPaths, WEB_AIS, DEFAULT_WEB_TILES };
