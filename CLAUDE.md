# Cue: notes for development

Cue is an Electron + React + TypeScript church presentation app. Read `docs/ARCHITECTURE.md` before larger changes; `README.md` has setup and commands.

## Commands

- `npm ci`, then `npm run dev` (hot reload) or `npm run build` + `npm start`
- `npm run check`: typecheck (both tsconfigs), ESLint, unit tests. Run it before every commit, plus `npx prettier --check .`
- `npm run test:e2e`: builds, then runs Playwright against `out/`. On a headless Linux box it re-runs itself under `xvfb-run`; `--no-build` skips the build, and extra arguments go to Playwright
- `node scripts/smoke-installed.mjs "<path to the installed Cue>"`: checks that a packaged Cue opens, draws, loads its resources and quits. The Release workflow runs it on the installers it builds
- `node scripts/smoke-update.mjs "<installed Cue.exe>" "<folder with the new latest.yml and installer>" "<new version>"`: checks that an installed, older Cue on Windows updates itself to the new build. The Release workflow builds the older copy for it: `npx electron-builder --config electron-builder.config.mjs --win --publish never -c.extraMetadata.version=0.0.1 -c.directories.output=release-old`
- `install.ps1` / `install.sh` (repository root): the one-line installers. `CUE_INSTALL_FROM=<folder with the installer and SHA256SUMS.txt>` uses local files, `CUE_INSTALL_NO_LAUNCH=1` doesn't open Cue, `CUE_INSTALL_DIR=<folder>` is the Mac destination
- `npm run art`: redraws the Mac disk image's window (`build/dmg-background*.png`). Set `CHROMIUM_PATH` if Playwright's own browser isn't installed
- After changing main-process imports, run `node --check out/main/index.js` once the build is done: a bad bundle makes the app exit silently at startup

## Conventions

- **Main is the source of truth.** Renderers mirror state from events and change it only through `invoke`. A new capability means: a method in `CueApi` (`src/shared/ipc.ts`), a handler in `src/main/handlers.ts`, and `call`/`attempt` in the renderer.
- **Live workflow rules live in the pure reducer** (`src/shared/show/reducer.ts`) with unit tests in `tests/unit/reducer.test.ts`. Keep I/O out of it.
- **Expected failures** that the operator should read (a refused download, an unsupported file) throw `UserError`, which is logged without a stack.
- **One Stage for every screen.** The audience output and the monitors share `src/renderer/stage`, so a visual change shows up in all of them.
- **UI primitives** are in `src/renderer/control/ui`; their CSS is in `@layer ui`, and feature CSS modules (unlayered) override them. Tokens are in `src/renderer/styles/tokens.css`.
- **Shortcuts:** when one changes, update `SHORTCUTS` in `lib/keyboard.ts`, the menu (`src/main/menu.ts`) and the README table.
- **Look:** flat and ruled (hairlines, not cards), corners of 2 to 4 px, no gradients, glows or blur. Amber means standing by and red means on screen; nothing else is coloured. Labels are condensed capitals (`font-stretch: 78%`), numbers and keys are `var(--font-mono)`. See "Look and motion" in `docs/ARCHITECTURE.md`.
- **Copy:** short, plain, operator-facing language ("Show on TV", not "Take to program").
- **Updates never interrupt.** `src/main/updates.ts` checks and downloads in the background and installs when Cue is closed. A failed check is `log.warn` only: no dialog, no toast, and never `log.error` (the installed-app smoke test fails on any `[ERROR]` line).
- **Security is never traded for convenience.** Nothing in the installers, the app or the docs may tell people to switch off SmartScreen, Defender or Gatekeeper, strip download marks, or skip a checksum.
- **Formatting:** Prettier with no semicolons, single quotes and 110 columns.
- **Tests:** E2E specs select by role, label or `data-testid`, and check results in main's state (`cue.state()`) or the output's pixels (`cue.outputColor()`), never through timing alone.

## Gotchas

- Ship one installer per platform (`electron-builder.config.mjs`). Extra variants on the Releases page get downloaded by mistake.
- The installer names carry no version (`Cue-mac.dmg`, `Cue-windows-setup.exe`). The permanent `releases/latest/download/…` links, both install scripts and the updater depend on those exact names: don't put the version back.
- A release's tag must be `v` + the version in `package.json` (the Release workflow checks). Cue compares the two to decide whether it is out of date.
- A release needs `latest.yml` and `Cue-windows-setup.exe.blockmap` next to the installer, or installed Windows copies stop updating, and `SHA256SUMS.txt`, or the install scripts refuse to install.
- Self-updating is for an installed Cue on Windows only (`process.platform === 'win32' && app.isPackaged`). Everything else, including E2E on Windows, takes the check-only path and opens the release page.
- `CUE_UPDATE_FEED` is honoured only for `http://127.0.0.1:<port>` or `http://localhost:<port>`. On an installed Windows Cue it is a folder with `latest.yml` and the installer; elsewhere Cue reads `<feed>/latest.json` (`tag_name`, `html_url`). Without it, Cue doesn't look for updates by itself in development, and not at all under `CUE_E2E`.
- The builds are unsigned, so electron-updater has no publisher to verify and relies on the SHA-512 in `latest.yml`. Don't disable any of its checks; if the builds get signed, `publisherName` appears in `app-update.yml` and signature verification starts by itself.
- `quitAndInstall` starts the installer before Cue quits, so nothing may cancel that quit: the control window's "Quit Cue?" question is skipped while `updates.installing` is set.
- The control window must always become visible: keep the reveal fallback in `windows/control.ts`.
- Entrance animations may change opacity and transform only. Animating layout breaks drag-and-drop geometry and E2E clicks.
- The fullscreen output has no Windows sizing border (`thickFrame: false`): with one, a non-resizable window is forced 14 × 7 px larger than its screen and spills onto the next one. `OutputManager.settle` also checks the fit in physical pixels, the window is never re-placed when it's already on its display, and it can't take focus. No test machine has two screens: `CUE_E2E_FULLSCREEN=1` with output mode `fullscreen` runs the real placement on the one screen, and that test is what caught the border on Windows.
- Preloads run sandboxed, so each must build to a single CommonJS file (`isolatedEntries` in `electron.vite.config.ts`).
- In the main process import `fflate/browser`; fflate's Node build collides with the bundler's `require` shim.
- Electron 44's clipboard API is asynchronous and `ClipboardItem`-based.
- `webContents.copyImageAt` on a `<webview>` takes coordinates in the host window, not the page.
- On Linux CI, Electron needs `--no-sandbox`, and `--use-angle=swiftshader --enable-unsafe-swiftshader` for WebGL and `capturePage` (the E2E helper adds these).
- On Windows, a Cue that was just killed can hold the single-instance lock briefly. A second launch waits up to 15 seconds: it quits as soon as a running Cue acknowledges the hand-off (a note in `launches/`), or starts once the lock is free.
- On Windows, Playwright starts Electron through a shell, so `app.process()` is `cmd.exe`, not Cue. To kill Cue, end its own pid (`Cue.kill()` does).
- Run the app for tests with `CUE_E2E=1 CUE_USER_DATA=<tmp> CUE_OUTPUT_MODE=window`. `CUE_GOOGLE_BASE` points the Google pane at a stand-in.
