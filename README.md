# AI Hub

A personal Windows 11 app that puts every AI in one place: large tiles for the AI programs installed on this PC, found automatically, and web AIs such as ChatGPT that open in signed-in tabs inside the hub. One click opens any of them.

It is a companion to [Ron Assistant](https://github.com/rlukenbaugh/ron-assistant-claude) and works the same way: its own program folder, its own data in `%APPDATA%\ai-hub`, the same readable fonts and dark mode, and the same installer and automatic updates.

## Install

Run `AI-Hub-Setup-<version>-x64.exe` (from `release\` or the GitHub release). Until code signing is set up ([docs/code-signing.md](docs/code-signing.md)), Windows shows a SmartScreen warning: choose **More info → Run anyway**. A portable `.exe` that needs no installation is also built.

The installed app **updates itself**: it checks GitHub Releases at start-up and every six hours and downloads a new version in the background. Because AI Hub usually stays in the tray, the update is installed the next time it quits; **Restart now** on the banner (or **Restart to install** in the tray menu) installs it at once.

## Use

- **Click a tile** to open that AI. Programs start as they would from the Start menu. Command-line AIs (Claude Code, Codex …) open in Windows Terminal, or a console window if Windows Terminal is missing. Web AIs open in a **tab** at the top of the window.
- **Web tabs** stay signed in between sessions (AI Hub keeps its own web profile, separate from your normal browser). The bar above a page has Back, Forward, Reload, the AI's start page, page size (− 100 % +), **Open in browser** and **Close tab**. **Home** (or Alt+Home) goes back to the tiles; the tabs stay open.
- **Right-click a tile** for *Open in a tab here*, *Open in my browser*, *Rename*, *Move left/right* and *Remove tile*.
- **+ Add a tile**: one click adds ChatGPT, Claude, Gemini, Copilot, Perplexity, Grok, DeepSeek, Le Chat, NotebookLM or Meta AI. You can also type any `https://` address (or `http://localhost…` for a local AI web page such as Open WebUI), or choose a program on this PC. Programs whose tiles you removed are listed there so you can bring them back.
- **Arrange tiles**: drag tiles, or use ◀ ▶ under each one; ✎ renames and ✕ removes. **Done** (or Esc) finishes.
- **↻ Find programs** looks for AI programs again (it also does this every time AI Hub starts).
- **A− / A+** change the hub's text size (Ctrl − / Ctrl + do the same on the tile page). In a web tab, Ctrl − / Ctrl + / Ctrl 0 or the **− 100 % +** buttons change the page size. ◐ switches light/dark; ⚙ (Ctrl ,) opens Settings.
- Keyboard: Ctrl+W closes a tab, Ctrl+Tab / Ctrl+Shift+Tab switch tabs, Alt+← / Alt+→ go back and forward, F5 reloads.

### Settings

- **Appearance**: theme, text size, and Large or Extra-large tiles.
- **Web AIs**: open in tabs inside AI Hub (default) or in your normal browser. **Sign out of all web AIs in AI Hub** clears AI Hub's web profile (your normal browser is not affected).
- **Programs**: show or hide command-line AIs.
- **Start-up**: start with Windows (it opens straight to the tray) and keep running in the tray when the window is closed. Both are on by default. Right-click the tray icon to open any tile, turn start-up on or off, or **Quit AI Hub**.
- **Updates**: automatic checks on/off and **Check for updates now**.

## How programs are found

1. **Start-menu apps** through PowerShell's `Get-StartApps`, which lists ordinary programs and Microsoft Store apps (ChatGPT, Copilot …) with the ID Windows uses to start them.
2. **Start-menu shortcuts**, for program icons and in case PowerShell is unavailable.
3. **Usual install folders** for programs without a Start-menu entry (Claude, LM Studio, Ollama, Ron Assistant, Cursor, Jan).
4. **Command-line AIs** on PATH or in their usual folders: Claude Code, Codex CLI, Gemini CLI, Hermes Agent, Aider, OpenCode and Qwen Code.

A program counts as an AI if its name matches the list in [`src/core/catalog.js`](src/core/catalog.js) (Claude, ChatGPT, Codex, Copilot, Perplexity, Gemini, Grok, DeepSeek, Le Chat, Meta AI, Poe, LM Studio, Ollama, Jan, GPT4All, Msty, AnythingLLM, Cursor, Windsurf, Antigravity, Kiro, Jarvis, Ron Assistant). Uninstallers and help links are skipped. Anything missed can be added with **+ Add a tile → Choose a program…**.

## Privacy and safety

- AI Hub itself sends nothing anywhere except update checks to github.com (installed app only, can be turned off). Web pages you open talk to their own sites, as in any browser.
- The hub's own page has no network access and no permissions. Web tabs are sandboxed, may use the microphone (for voice chat) and the clipboard, and nothing else: no camera, location or notifications.
- Links in a web AI's answer open in your normal browser; only sign-in pop-ups stay inside AI Hub. Links to files on this PC or to other programs are refused.
- The hub page can only ask to open a tile by its ID; program locations come from the scan or from the file picker, never from the page. Names and paths that could break a command line are refused.
- The log (`%APPDATA%\ai-hub\logs\app.log`) records status only (starts, scans, errors), not pages or addresses you visit inside sites.

## Known limits

- Some sites (notably Google sign-in) refuse to sign in inside apps. Sign in with email instead, or right-click the tile and choose **Open in my browser**.
- Program icons come from Windows at 32 × 32 pixels, so some look soft on large tiles. Store apps use their own large tile logos.
- Start with Windows is only registered by the installed or portable app, not by `npm start`.

## Develop

```powershell
npm install
npm start            # run the app
npm run lint
npm run typecheck    # TypeScript checks the plain JavaScript (JSDoc types); nothing is compiled
npm test             # unit tests (discovery, launching, tile storage) — run on any OS
npm run test:e2e     # real Electron window with stand-in programs and a local web page
npm run check        # lint + typecheck + unit + e2e
npm run dist:win     # installer + portable exe in release\
```

Releases: bump `version` in `package.json`, push a `v<version>` tag, and the **Desktop Release** workflow builds, tests and publishes the installer, portable exe and update files.

## Verified on 2026-11-20 (0.1.0)

On Linux (the development container), not yet on Windows:

- Lint and type check clean. 17 unit tests: AI name matching; `Get-StartApps` output in every shape; Store vs desktop AppIDs and folder GUIDs; a full scan of a simulated Windows PC (Start-menu apps, Store apps, duplicate and uninstaller entries, shortcuts in sub-folders, usual folders, CLIs on PATH and in npm's folder); falling back to shortcuts when PowerShell fails; Store logo selection from `AppxManifest.xml`; launch commands for Store apps, shortcuts, programs, Windows Terminal and console windows; refusal of quotes, `&` and `;` tricks; web address rules; settings defaults and limits; tile order, rename, remove/restore across rescans; and hand-edited files that try to add unsafe tiles.
- 10 Electron end-to-end tests: tiles appear and start the right command; a web tile opens a tab in the saved `persist:web-ai` profile, positioned exactly over the page area; links in answers go to the browser, `file:` links are refused; back/forward, zoom, Home, reusing a tab, dialogs hiding the page, closing tabs; opening in the browser instead; arranging, renaming, removing and restoring tiles, kept after a restart and a rescan; one-click web AIs; dark mode, text size and extra-large tiles kept after a restart; start-with-Windows on by default and switchable, closing to the tray and reopening; the update banner; the empty state; and the page being unable to open unknown tiles, change protected settings or reach the network.

**Still to check on Windows** (they cannot run on Linux): the real `Get-StartApps` scan and icons on Ron's PC, starting real programs and Store apps, Claude Code / Codex opening in Windows Terminal, the tray icon and its menu, start-up at sign-in, real sign-ins to ChatGPT and other sites inside a tab, the installer, and an update from one release to the next. CI runs the same tests on Windows for every pull request.
