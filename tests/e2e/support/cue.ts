/**
 * Launches the built app (out/) the way an operator would use it, in an
 * isolated data folder, and gives tests a view of both sides: the control
 * window as a Playwright page, and the main process's show state.
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { CueArgs, CueMethod, CueResult } from '../../../src/shared/ipc'
import type {
  MediaItem,
  PlaybackStatus,
  Plan,
  SettingsPatch,
  ShowCommand,
  ShowState
} from '../../../src/shared/types'
import type { ShowController } from '../../../src/main/show/controller'
import type { LibraryStore } from '../../../src/main/store/library'
import type { PlansStore } from '../../../src/main/store/plans'
import type { SettingsStore } from '../../../src/main/store/settings'

declare global {
  /** Services the main process exposes when CUE_E2E=1. */
  var __cue: {
    show: ShowController
    library: LibraryStore
    plans: PlansStore
    settings: SettingsStore
  }
}

export const repoRoot = resolve(import.meta.dirname, '../../..')
export const fixture = (name: string) => join(repoRoot, 'tests/e2e/fixtures', name)

export interface LaunchOptions {
  /** Start like a brand-new install: welcome walkthrough and the sample service. */
  firstRun?: boolean
  settings?: SettingsPatch
  env?: Record<string, string>
  /** Reuse a data folder from an earlier launch (to relaunch after a crash or quit). */
  dataDir?: string
}

export interface Rgb {
  r: number
  g: number
  b: number
}

export class Cue {
  readonly pageErrors: string[] = []

  private constructor(
    readonly app: ElectronApplication,
    readonly control: Page,
    readonly dataDir: string,
    /** Cue's own log lines (INFO and above) from the main process. */
    readonly logs: string[]
  ) {}

  static async launch(opts: LaunchOptions = {}): Promise<Cue> {
    const dataDir = opts.dataDir ?? (await mkdtemp(join(tmpdir(), 'cue-e2e-')))
    if (!opts.dataDir) {
      // Skip the welcome walkthrough (and sample service) unless the test is about first run.
      const seed: SettingsPatch = opts.firstRun
        ? { ...opts.settings }
        : { ...opts.settings, ui: { firstRunDone: true, ...opts.settings?.ui } }
      await writeFile(join(dataDir, 'settings.json'), JSON.stringify(seed))
    }
    // Containers run as root without a GPU: Chromium needs these on Linux CI.
    const linux = process.platform === 'linux'
    const app = await electron.launch({
      args: [
        repoRoot,
        ...(linux ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])
      ],
      cwd: repoRoot,
      env: {
        ...(process.env as Record<string, string>),
        NODE_OPTIONS: '',
        CUE_E2E: '1',
        CUE_USER_DATA: dataDir,
        // A plain window stands in for the TV, whatever displays the machine has.
        CUE_OUTPUT_MODE: 'window',
        ...opts.env
      },
      timeout: 60_000
    })
    const logs: string[] = []
    for (const stream of [app.process().stdout, app.process().stderr]) {
      stream?.on('data', (chunk: Buffer) => {
        for (const line of String(chunk).split('\n')) if (/\[(INFO|WARN|ERROR)\]/.test(line)) logs.push(line)
      })
    }
    const control = await windowByUrl(app, 'control.html')
    const cue = new Cue(app, control, dataDir, logs)
    control.on('pageerror', (err) => cue.pageErrors.push(`${err.name}: ${err.message}`))
    await control.waitForLoadState('domcontentloaded')
    await control.getByTestId('take').waitFor()
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('control.html'))
      win?.setBounds({ x: 0, y: 0, width: 1440, height: 900 })
    })
    return cue
  }

  /** The audience output window. */
  output(): Promise<Page> {
    return windowByUrl(this.app, 'audience.html')
  }

  /** Call the main process exactly as the control UI does. */
  invoke<M extends CueMethod>(method: M, ...args: CueArgs<M>): Promise<CueResult<M>> {
    type Loose = (method: string, ...args: unknown[]) => Promise<unknown>
    return this.control.evaluate(([m, a]) => (window.cue.invoke as Loose)(m, ...a), [
      method,
      args as unknown[]
    ] as const) as Promise<CueResult<M>>
  }

  dispatch(cmd: ShowCommand): Promise<void> {
    return this.invoke('show:dispatch', cmd)
  }

  state(): Promise<ShowState> {
    return this.app.evaluate(() => globalThis.__cue.show.state)
  }

  /** What the output last reported about the playing video or audio. */
  playback(): Promise<PlaybackStatus | null> {
    return this.app.evaluate(() => globalThis.__cue.show.playback)
  }

  library(): Promise<MediaItem[]> {
    return this.app.evaluate(() => globalThis.__cue.library.all())
  }

  plans(): Promise<Plan[]> {
    return this.app.evaluate(() => globalThis.__cue.plans.all())
  }

  /** Import files and wait until Cue has finished processing them (thumbnails, pages, duration). */
  async import(paths: string[]): Promise<MediaItem[]> {
    const { items } = await this.invoke('library:import', paths)
    const ids = items.map((i) => i.id)
    for (let i = 0; i < 300; i++) {
      const all = await this.library()
      const done = ids.map((id) => all.find((x) => x.id === id)!)
      if (done.every((x) => x && x.status !== 'processing')) return done
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error('Import did not finish')
  }

  /**
   * Average colour of what the audience currently sees, optionally within a
   * region given as fractions of the screen ([left, top, right, bottom]).
   */
  async outputColor(region: [number, number, number, number] = [0, 0, 1, 1]): Promise<Rgb> {
    return this.app.evaluate(async ({ BrowserWindow }, [x0, y0, x1, y1]) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('audience.html'))
      if (!win) throw new Error('No output window')
      // A window that was just opened may not have painted its first frame yet.
      let image: Electron.NativeImage | null = null
      for (let attempt = 0; attempt < 30 && !image; attempt++) {
        image = await win.webContents.capturePage().catch(() => null)
        if (image?.isEmpty()) image = null
        if (!image) await new Promise((r) => setTimeout(r, 100))
      }
      if (!image) throw new Error('The output window never painted')
      const { width, height } = image.getSize()
      const bitmap = image.toBitmap() // BGRA
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let y = Math.floor(y0 * height); y < Math.min(height, y1 * height); y += 4) {
        for (let x = Math.floor(x0 * width); x < Math.min(width, x1 * width); x += 4) {
          const i = (y * width + x) * 4
          b += bitmap[i]
          g += bitmap[i + 1]
          r += bitmap[i + 2]
          n++
        }
      }
      return { r: r / n, g: g / n, b: b / n }
    }, region)
  }

  /** Lines the main process logged at ERROR level. */
  errors(): string[] {
    return this.logs.filter((l) => l.includes('[ERROR]'))
  }

  /** Quit normally; the data folder is deleted unless it is kept for a relaunch. */
  async close(opts: { keepData?: boolean } = {}): Promise<void> {
    await this.app.close().catch(() => undefined)
    if (!opts.keepData) await rm(this.dataDir, { recursive: true, force: true }).catch(() => undefined)
  }

  /** End the app abruptly, like a crash or a power cut, keeping its data. */
  async kill(): Promise<void> {
    const proc = this.app.process()
    const exited = new Promise((resolve) => proc.once('exit', resolve))
    proc.kill('SIGKILL')
    await exited
  }
}

export async function windowByUrl(app: ElectronApplication, fragment: string): Promise<Page> {
  for (let i = 0; i < 150; i++) {
    const page = app.windows().find((w) => w.url().includes(fragment))
    if (page) return page
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`No window for ${fragment}`)
}

export const brightness = (c: Rgb) => (c.r + c.g + c.b) / 3
