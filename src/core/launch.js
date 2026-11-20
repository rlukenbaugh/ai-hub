'use strict';
// How a program tile is started. Builds the command only; main.js runs it.
// Nothing here goes through a shell that could read a name as a command, and every path or
// AppID is refused if it contains quotes or line breaks.
const path = require('node:path');

const P = path.win32;
const UNSAFE = /["\r\n\0]/;

/**
 * @typedef {{ type: 'spawn', command: string, args: string[], verbatim?: boolean }
 *   | { type: 'open', file: string }} LaunchSpec
 */

/**
 * @param {object} tile  a program tile (detected or added by hand)
 * @param {object} opts
 * @param {string} opts.home     the folder a terminal starts in
 * @param {string|null} opts.terminal  Windows Terminal (wt.exe), or null to use a console window
 * @returns {LaunchSpec}
 */
function launchSpec(tile, { home, terminal }) {
  if (!tile || !['app', 'cli', 'program'].includes(tile.kind)) throw new Error('This tile is not a program.');
  if (tile.kind === 'cli') return terminalSpec(tile, { home, terminal });

  if (tile.appId) {
    // Starts it exactly as the Start menu would (Store apps have no program file to open).
    if (UNSAFE.test(tile.appId)) throw new Error('This program cannot be started safely.');
    return { type: 'spawn', command: 'explorer.exe', args: [`shell:AppsFolder\\${tile.appId}`] };
  }
  const file = tile.shortcut || tile.target || tile.path;
  if (!file || UNSAFE.test(file)) throw new Error('This program has no location to start from.');
  if (/\.(cmd|bat)$/i.test(file)) return terminalSpec({ ...tile, target: file }, { home, terminal });
  return { type: 'open', file };
}

/**
 * A command-line AI opens in its own terminal window, starting in the user's home folder.
 * @returns {LaunchSpec}
 */
function terminalSpec(tile, { home, terminal }) {
  const file = tile.target || tile.path;
  if (!file || UNSAFE.test(file) || UNSAFE.test(home || '')) throw new Error('This program has no location to start from.');
  const title = String(tile.name || 'AI').replace(/["\r\n\0&|<>^%;]/g, '').slice(0, 60) || 'AI';
  const batch = /\.(cmd|bat)$/i.test(file);
  if (terminal && !/;/.test(file + home)) {
    // Windows Terminal reads its own command line, so ordinary argument quoting is right
    // (";" separates Windows Terminal commands, so such paths use a console window instead).
    return { type: 'spawn', command: terminal, args: ['new-tab', '--title', title, '-d', home, ...(batch ? ['cmd.exe', '/k', file] : [file])] };
  }
  // cmd.exe has its own quoting rules, so the line is written out in full:
  //   /c start "Title" /D "home" cmd.exe /k ""C:\path\program.exe""
  // `start` opens a new console window; /k keeps it open after the program exits.
  return { type: 'spawn', command: 'cmd.exe', verbatim: true, args: ['/d', '/c', 'start', `"${title}"`, '/D', `"${home}"`, 'cmd.exe', '/k', `""${file}""`] };
}

/** Windows Terminal is an app alias in WindowsApps on Windows 11. */
function terminalPath(env, exists) {
  const local = env.LOCALAPPDATA;
  const wt = local ? P.join(local, 'Microsoft', 'WindowsApps', 'wt.exe') : null;
  return wt && exists(wt) ? wt : null;
}

module.exports = { launchSpec, terminalPath };
