// Writes release notes for the current package version (Markdown for the GitHub release page).
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const outIndex = process.argv.indexOf('--out');
const notes = `# AI Hub v${version}

## Downloads
- **Installer (recommended):** \`AI-Hub-Setup-${version}-x64.exe\`
- **Portable:** \`AI-Hub-Portable-${version}-x64.exe\` (no installation and no automatic updates; settings still live in %APPDATA%\\ai-hub)

## Highlights
- Large tiles for the AI programs on this PC, found automatically: Start-menu and Microsoft Store apps (Claude, ChatGPT, Copilot, LM Studio, Ollama, Ron Assistant …) and command-line AIs (Claude Code, Codex …), which open in a terminal window.
- Web AIs (ChatGPT to start with; Claude, Gemini, Copilot, Perplexity and more one click away) open in tabs inside the hub and stay signed in. Or open them in your normal browser.
- Add, remove, rename and reorder tiles (drag, or the arrow buttons).
- Readable: Segoe UI at 18 px by default, adjustable text and tile size, light and dark themes, page zoom in web tabs.
- Starts with Windows and waits in the system tray (both can be turned off in Settings).
- The installed app updates itself from GitHub Releases (can be turned off in Settings).

## Notes
- Windows shows a SmartScreen warning when a build is unsigned; signed builds are set up in docs/code-signing.md.
- Some sites block "Sign in with Google" inside apps. If that happens, sign in with email, or right-click the tile and choose *Open in my browser*.
`;
if (outIndex > -1) fs.writeFileSync(process.argv[outIndex + 1], notes); else process.stdout.write(notes);
