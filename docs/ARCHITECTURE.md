# How Cue is built

Cue is an Electron app: one Node.js **main process** that owns all state, and a few Chromium **renderers** that draw it. Everything is TypeScript; the UI is React. This document is a map for anyone changing the code.

```mermaid
flowchart LR
  subgraph Main["Main process (Node.js) · single source of truth"]
    SC[ShowController<br/>reduceShow]
    ST[(JSON stores<br/>settings · library · plans · history · show)]
    MP[Importer + MediaProcessor]
    OM[OutputManager]
    WI[WebIngest]
  end
  CW["Control window<br/>(operator UI)"] -- "invoke(method)" --> Main
  Main -- "events: show:state, library:upsert…" --> CW
  Main -- "ShowState + OutputConfig" --> AW["Audience window<br/>(the TV)"]
  AW -- "playback reports" --> Main
  MP -- "tasks" --> HW["Hidden media worker<br/>(thumbnails, probing, pdf.js)"]
  CW --- GV["&lt;webview&gt; Google Images<br/>(own session, guest preload)"]
  GV -- "the image the operator opened" --> CW
```

## Source layout

| Path                     | What lives there                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `src/shared/`            | Types, IPC contract, defaults and pure logic shared by every process               |
| `src/shared/show/`       | The show reducer: Preview/Live, standby, paging, Back, overlays, video transport   |
| `src/main/`              | App startup, IPC handlers, menus, shortcuts, windows                               |
| `src/main/store/`        | Crash-safe JSON stores for settings, library, plans and history                    |
| `src/main/media/`        | Importing, processing (via the worker), web ingest                                 |
| `src/main/show/`         | `ShowController`: resolves what to show, persists it, handles video endings        |
| `src/main/output/`       | `OutputManager`: places the audience window on the right display                   |
| `src/main/plans/`        | `.cueplan` export and import (a zip of the plan and its media)                     |
| `src/main/scripture/`    | Bible lookups in the bundled translations                                          |
| `src/main/search/`       | Wikimedia Commons, Openverse and Pexels search                                     |
| `src/preload/`           | Sandboxed bridges for each kind of window, plus the Google guest page              |
| `src/renderer/stage/`    | The **Stage**: everything the audience sees, shared by the output and the monitors |
| `src/renderer/control/`  | The operator UI: layout, features, stores, UI primitives                           |
| `src/renderer/audience/` | The audience window: a stateless mirror of main's show state                       |
| `src/renderer/worker/`   | The hidden worker page: decoders and pdf.js                                        |
| `resources/bible/`       | The World English Bible and King James Version, gzipped JSON                       |
| `tests/unit/`            | Vitest unit tests                                                                  |
| `tests/e2e/`             | Playwright tests that drive the built app                                          |

## Processes and windows

- **Main process** (`src/main/index.ts`) creates the stores and services, wires their events to the windows, and answers the control window's calls. Nothing else holds state that matters: renderers can reload or crash and pick up where they were.
- **One Cue at a time.** A second launch (say, double-clicking a `.cueplan` file) hands its files to the running Cue, which confirms by writing a note to `launches/` in the data folder, and then quits. If nobody answers, because a Cue has just crashed and Windows still holds its lock, the launch keeps trying for up to 15 seconds and then starts normally.
- **Control window** loads `control.html`. Its preload exposes `window.cue` with `invoke(method, ...args)` and `on(event, listener)`. A zustand store (`lib/store.ts`) mirrors main's state from events; a second store (`lib/ui.ts`) holds UI-only state such as the current tab, dialogs and selection.
- **Audience window** loads `audience.html` and renders `<Stage role="output">` from the `ShowState` main sends it. It reports video and audio playback back to main, which re-broadcasts it so the Live monitor stays in sync.
- **Media worker** is a hidden window with Chromium's decoders and pdf.js. Main sends it tasks (image and video thumbnails, media probing, PDF pages) and enforces a timeout on each, so a bad file can never hang an import. If the worker crashes or a task times out, the worker is restarted; the other files it was working on are retried once, so one corrupt file doesn't fail its neighbours. On quit, the worker and the audience window are shut down for good: a late event can't open a window that would keep Cue running.
- **Google Images** runs in a `<webview>` inside the control window, in its own session (`persist:web`) with its own cookies. A guest preload (`src/preload/webview.ts`) watches for the image the operator opens and tells the control window about it.

### IPC

The contract is typed in `src/shared/ipc.ts`:

- `CueApi` maps each method (`show:dispatch`, `library:import`, `plans:export`…) to its arguments and result. Main registers handlers with `handle(method, fn)` (`src/main/handlers.ts`). Only the control window is a trusted caller; anything else is rejected.
- Failures come back as `{ ok: false, error }` values rather than rejected promises. The preload turns them back into thrown `Error`s, so the renderer can simply `await` and catch. Errors thrown as `UserError` (`src/main/errors.ts`: a site refusing a download, an unsupported file, a reference that isn't in the Bible) are expected and logged as warnings without stack traces; their message is written for the operator.
- `CueEvents` are broadcast from main to the control window: `show:state`, `library:upsert`, `plans:changed`, `settings:changed`, `displays:changed`, `toast`, `progress`, `ui:command` and `plans:open`.

## The show engine

`reduceShow(state, command, context)` in `src/shared/show/reducer.ts` is a pure function and holds all of Cue's live workflow rules. The controller supplies a `ShowContext` (how to resolve a target into a `Presentation`, the next plan entry, the settings), applies the result, persists it and acts on the returned effects.

- **Preview and Live.** `preview` stages something; `take` (Space) moves it to Live with a new instance id, which is what makes the output transition. `show` puts something on screen directly.
- **Standby.** When something from a plan goes live, the plan's cursor moves there and the following entry is staged in Preview. Spontaneous items don't move the cursor, so Preview returns to the plan afterwards.
- **Paging.** `next` and `prev` step through PDF and slide pages in place (no transition). At the last page they stop and report a boundary, or, with _Next continues into the next item_, take the standby. After a blackout or ambient, the first press only brings the content back.
- **Back.** Paged content is sticky: after slides → map → photo, Back still returns to the slides at the page you left; once the slides are back, Back offers the last spontaneous item.
- **Overlays.** Blackout and ambient sit above the content, so lifting them reveals exactly what was there. Ambient keeps its presentation while fading out.
- **Video.** Transport is declarative: Live carries `playing` and a `seek { time, nonce }`. Bumping the nonce asks the output to jump; the output reports its position back as `PlaybackStatus`.

`ShowController` (`src/main/show/controller.ts`) builds presentations from library items and plan entries, applies per-item options (fit, start and end times, loop, end action), keeps on-screen presentations up to date when their media changes (a PDF still rendering, a deck edited live), and writes the state to `show.json` with `cleanExit: false`. A clean quit sets it to `true`; if Cue starts and finds `false` with something on screen, it puts the audience screen back the way it was. It also notes the live video's position every few seconds, so a video picks up where it was when the audience window reloads or Cue restarts.

## The Stage

`src/renderer/stage/Stage.tsx` renders the audience picture, and the very same component draws the Preview and Live monitors in the control window, so what you see is what the room sees.

- **Layers:** content (with transitions) → credit → ambient → test pattern → blackout → display identification.
- **Transitions:** each presentation instance gets a slot. A new slot loads invisibly and is revealed only once its media is ready (a slide waits for its fonts and its background picture or video), then fades or dips in while the old one leaves, so there's never a flash of black or a half-loaded image. Cut, fade and dip are supported. Each PDF page is its own slot; slides that share a background share one, and only their words cross-fade (`SlideView`), so a looping background video plays on. A video cut away from stays mounted, unseen, until its sound has faded out, so a cut never clicks.
- **Pictures:** fit, fill and blur-fill (the image over a blurred, enlarged copy of itself), plus zoom and pan in normalized coordinates, so a zoom set in a small monitor matches the TV exactly.
- **Video and audio** play only on the output, through the chosen audio device (`setSinkId`) with short volume ramps. The monitors show the same frames but stay silent, following the output's playback reports.
- **Slides** are laid out on a fixed 1920 × 1080 canvas and scaled to fit, so a deck looks identical everywhere; text shrinks to fit its box automatically.
- **Ambient** is either a WebGL shader (slow, drifting light, driven by the wall clock so every view is in step) or a playlist of the church's own photos and videos with a gentle Ken Burns move, with an optional text, clock or countdown on top. Each playlist item fades in over the previous one once it has loaded.

## Scripture

References are parsed in `src/shared/scripture.ts`: all 66 books with their usual abbreviations ("jn", "1 cor", "Ps", "II Kings"), single verses, ranges, whole chapters, ranges across chapters ("Rom 8:38–9:2") and one-chapter books ("Jude 3"). `Bible` (`src/main/scripture/bible.ts`) loads a translation from `resources/bible/<id>.json.gz` on first use (`{ id, name, abbr, books: [{ id, name, chapters: string[][] }] }`) and answers `scripture:passage`. In the renderer, `lib/scripture.ts` turns a passage into scripture slides: verse numbers appear as superscripts when there's more than one verse, and `splitPassage` spreads a long passage over the fewest slides that hold it, evenly. One slide is shown directly; several become a deck that stays out of the library unless it's saved. `scripts/build-bible.mjs` (`npm run bible`) downloads and converts the texts. Only public-domain translations are bundled.

## Media

1. **Import** (`src/main/media/importer.ts`): files are identified by content (magic bytes, not only the extension), deduplicated by a fingerprint hash, and copied into `Media/<id>/`, using a copy-on-write clone where the file system supports it.
2. **Processing** (`processor.ts` + the worker): images get a thumbnail and their size; animated GIF/PNG/WebP are detected; videos are probed for size and duration; audio-only files become audio items; PDFs are rendered page by page to WebP at the chosen quality. Pages appear as they're rendered, so a long PDF is usable right away, and processing resumes after a restart.
3. **Serving:** renderers read media through the `cue-media://` scheme (`src/main/protocol.ts`), with HTTP range support so videos can seek. The app's own pages load from `cue-app://`, which gives them a proper origin without touching the network.

Web images picked but never saved are kept for 30 days unless a plan or the history still uses them.

### Images from the web

`WebIngest` (`src/main/media/webIngest.ts`) brings in the image the operator opened, in this order:

1. Download the original URL through the browser pane's own session, with the source page as referrer, so sites with hotlink protection still hand it over.
2. If the site refuses, copy the image out of the page itself, since the embedded browser is already displaying it. Electron addresses a `<webview>` by a point in the host window, so the page reports where the image is at that moment; the copied bitmap must match the image's natural size, so an overlay or a thumbnail is never shown by mistake. The operator's clipboard is restored afterwards.
3. Otherwise use Google's thumbnail, with a toast saying the copy is low resolution.

The guest preload doesn't depend on Google's markup, which changes often. It looks for the most prominent image on screen and follows Google's swap from its own thumbnail to the original.

## Storage

All data lives in the user data folder (see the README). Each store is a `JsonStore` (`src/main/store/jsonStore.ts`): debounced, atomic writes (temporary file, then rename), with the previous version kept as `.bak` and used automatically if the main file is ever unreadable. The corrupt file is set aside, never deleted.

| File            | Contents                                                     |
| --------------- | ------------------------------------------------------------ |
| `settings.json` | Settings, merged over defaults so new options appear safely  |
| `library.json`  | Media items and collections                                  |
| `plans.json`    | Service plans                                                |
| `history.json`  | What was shown, for "Shown today"                            |
| `show.json`     | The live state and the clean-exit flag, for crash recovery   |
| `Media/`        | One folder per item: the file, its thumbnail, rendered pages |
| `logs/cue.log`  | Rotating log                                                 |

## Displays

`OutputManager` (`src/main/output/output.ts`) decides where the audience window goes. In **Auto** it uses the external display (remembering which one by its identity, so it returns when reconnected) and never covers the operator's own screen; with one display it waits and says so. **Fullscreen**, **Window** and **Off** override that. It reacts to displays being plugged in or removed, keeps the computer from sleeping while something is on screen, and can show each display's number for identification.

## Security

- Every window uses context isolation and a sandboxed preload; nothing in a renderer can reach Node.js.
- Each page has a strict Content-Security-Policy (`electron.vite.config.ts`). Only the control page may load `https:` images (search thumbnails); the audience page shows local media only.
- Cue's windows only load the bundled pages; navigation and new windows are refused. External links open in the system browser.
- The `<webview>` is configured by main, not by the page: its preload, partition and web preferences are fixed in `will-attach-webview`, and it can't open windows.
- Permissions are allowlisted per session: Cue's windows may enumerate audio outputs, choose a speaker and go fullscreen; the browser pane may only go fullscreen and write to the clipboard.
- IPC handlers only answer the control window.

## Tests

- **Unit** (`npm test`): the show reducer's workflow rules, scripture references and lookups, file-format detection, the justified image grid and utilities.
- **End to end** (`npm run test:e2e`): Playwright launches the built app per spec file, with `CUE_E2E=1`, a throwaway `CUE_USER_DATA` folder and `CUE_OUTPUT_MODE=window`, and drives it like an operator: keyboard, clicks, drag and drop. It checks results both in main's state (exposed as `globalThis.__cue` only in E2E mode) and in the pixels of the audience window. `CUE_GOOGLE_BASE` points the Google pane at a local stand-in (`tests/e2e/support/mock-google.ts`) that reproduces the thumbnail-then-original behaviour and hotlink protection. Fixtures (PNG, PDF, WAV) are generated by the tests; a small WebM clip is checked in.

## Build

`electron.vite.config.ts` builds three targets: the main process (ESM), the preloads (each a single, self-contained CommonJS file, since sandboxed preloads can't load chunks), and the renderer pages. It also copies pdf.js's character maps, fonts and wasm decoders next to the renderer, so PDFs render offline, and injects each page's CSP. `electron-builder.config.mjs` packages `out/` into installers.
