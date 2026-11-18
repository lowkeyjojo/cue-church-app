# Cue: notes for development

Cue is an Electron + React + TypeScript church presentation app. Read `docs/ARCHITECTURE.md` before larger changes; `README.md` has setup and commands.

## Commands

- `npm ci`, then `npm run dev` (hot reload) or `npm run build` + `npm start`
- `npm run check`: typecheck (both tsconfigs), ESLint, unit tests. Run it before every commit, plus `npx prettier --check .`
- `npm run test:e2e`: builds, then runs Playwright against `out/`. On a headless Linux box it re-runs itself under `xvfb-run`; `--no-build` skips the build, and extra arguments go to Playwright
- `node scripts/smoke-installed.mjs "<path to the installed Cue>"`: checks that a packaged Cue opens, draws, loads its resources and quits. The Release workflow runs it on the installers it builds
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
- **Formatting:** Prettier with no semicolons, single quotes and 110 columns.
- **Tests:** E2E specs select by role, label or `data-testid`, and check results in main's state (`cue.state()`) or the output's pixels (`cue.outputColor()`), never through timing alone.

## Gotchas

- Ship one installer per platform (`electron-builder.config.mjs`). Extra variants on the Releases page get downloaded by mistake.
- The control window must always become visible: keep the reveal fallback in `windows/control.ts`.
- Entrance animations may change opacity and transform only. Animating layout breaks drag-and-drop geometry and E2E clicks.
- The fullscreen output is placed and checked in physical pixels on Windows (`OutputManager.settle`), never re-placed when it's already on its display, and can't take focus. Screens with different scaling make scaled sizes unreliable there, and there is no test machine with two screens: `CUE_E2E_FULLSCREEN=1` with output mode `fullscreen` runs the real placement on the one screen.
- Preloads run sandboxed, so each must build to a single CommonJS file (`isolatedEntries` in `electron.vite.config.ts`).
- In the main process import `fflate/browser`; fflate's Node build collides with the bundler's `require` shim.
- Electron 44's clipboard API is asynchronous and `ClipboardItem`-based.
- `webContents.copyImageAt` on a `<webview>` takes coordinates in the host window, not the page.
- On Linux CI, Electron needs `--no-sandbox`, and `--use-angle=swiftshader --enable-unsafe-swiftshader` for WebGL and `capturePage` (the E2E helper adds these).
- On Windows, a Cue that was just killed can hold the single-instance lock briefly. A second launch waits up to 15 seconds: it quits as soon as a running Cue acknowledges the hand-off (a note in `launches/`), or starts once the lock is free.
- On Windows, Playwright starts Electron through a shell, so `app.process()` is `cmd.exe`, not Cue. To kill Cue, end its own pid (`Cue.kill()` does).
- Run the app for tests with `CUE_E2E=1 CUE_USER_DATA=<tmp> CUE_OUTPUT_MODE=window`. `CUE_GOOGLE_BASE` points the Google pane at a stand-in.
