import { BrowserWindow, ipcMain, powerSaveBlocker, screen, type Display } from 'electron'
import type { OutputIdentify } from '@shared/ipc'
import type {
  DisplayInfo,
  DisplaysSnapshot,
  OutputConfig,
  OutputMode,
  OutputStatus,
  PlaybackStatus,
  Rect,
  ShowState
} from '@shared/types'
import { debounce } from '@shared/util'
import { log } from '../log'
import { isE2E, preloadPath, rendererUrl } from '../paths'
import { Emitter } from '../store/emitter'
import type { SettingsStore } from '../store/settings'

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

/**
 * Owns the audience window: which display it's on, fullscreen vs windowed,
 * hot-plugging, crash recovery, and keeping the screen awake while it's up.
 *
 * Safety rule: the fullscreen output never covers the display the control
 * window is on. If the TV disappears, the output goes dark instead of jumping
 * onto the operator's screen.
 */
export class OutputManager extends Emitter<{
  changed: DisplaysSnapshot
  playback: PlaybackStatus | null
  /** The audience window has (re)loaded and has the current state. */
  ready: null
}> {
  private win: BrowserWindow | null = null
  private winKind: 'fullscreen' | 'window' | null = null
  private status: OutputStatus = {
    mode: 'auto',
    active: false,
    windowed: false,
    displayId: null,
    displayLabel: '',
    width: 1920,
    height: 1080
  }
  private state: ShowState | null = null
  private config: OutputConfig
  private ready = false
  private sleepBlocker: number | null = null
  private identifyTimer: ReturnType<typeof setTimeout> | null = null
  private identifyWindows: BrowserWindow[] = []
  private control: BrowserWindow | null = null
  private disposed = false
  /** Which display (and at what size and scale) the fullscreen window was last placed on. */
  private placed: string | null = null
  private settleTimers: ReturnType<typeof setTimeout>[] = []
  private reapply = debounce(() => this.apply(), 400)

  constructor(private settings: SettingsStore) {
    super()
    this.config = this.buildConfig()
    ipcMain.on('output:ready', (event) => {
      if (event.sender !== this.win?.webContents) return
      this.ready = true
      this.push()
      this.emit('ready', null)
    })
    ipcMain.on('output:playback', (event, status: PlaybackStatus | null) => {
      if (event.sender === this.win?.webContents) this.emit('playback', status)
    })
    screen.on('display-added', (_e, display) => {
      log.info('Display connected:', describe(display))
      this.reapply()
    })
    screen.on('display-removed', (_e, display) => {
      log.info('Display disconnected:', describe(display))
      // React immediately: the OS may already be moving our window onto another screen.
      if (this.status.displayId === display.id && this.winKind === 'fullscreen') this.destroyWindow()
      this.apply()
    })
    screen.on('display-metrics-changed', () => this.reapply())
    settings.on('changed', () => {
      this.config = this.buildConfig()
      this.push()
    })
  }

  attachControl(win: BrowserWindow): void {
    this.control = win
    // "moved" (after a drag) only exists on macOS and Windows; "move" fires everywhere and is debounced.
    if (process.platform === 'linux') win.on('move', () => this.reapply())
    else win.on('moved', () => this.reapply())
  }

  setShowState(state: ShowState): void {
    this.state = state
    if (this.ready) this.win?.webContents.send('output:state', state)
  }

  snapshot(): DisplaysSnapshot {
    return { displays: this.listDisplays(), output: this.status }
  }

  setMode(opts: { mode?: OutputMode; displayId?: number | null }): DisplaysSnapshot {
    const patch: { mode?: OutputMode; displayId?: number | null; displayKey?: string } = {}
    if (opts.mode) patch.mode = opts.mode
    if (opts.displayId !== undefined) {
      patch.displayId = opts.displayId
      const d = screen.getAllDisplays().find((x) => x.id === opts.displayId)
      // An empty key (not undefined, which a settings merge would skip) clears the remembered display.
      patch.displayKey = d ? displayKey(d) : ''
      // Choosing a display implies you want it used.
      if (!opts.mode && d && this.settings.data.output.mode === 'off') patch.mode = 'auto'
    }
    this.settings.update({ output: patch })
    this.apply()
    return this.snapshot()
  }

  /** Place, create or remove the audience window according to settings and connected displays. */
  apply(): void {
    // Quitting: a late display or window-move event must not bring the window back.
    if (this.disposed) return
    const out = this.settings.data.output
    // Tests have no second screen: there, CUE_OUTPUT_MODE stands in for "auto".
    const mode: OutputMode =
      isE2E && process.env.CUE_OUTPUT_MODE && out.mode === 'auto'
        ? (process.env.CUE_OUTPUT_MODE as OutputMode)
        : out.mode
    const displays = screen.getAllDisplays()
    const controlDisplay =
      this.control && !this.control.isDestroyed()
        ? screen.getDisplayMatching(this.control.getBounds())
        : screen.getPrimaryDisplay()
    const target = this.pickDisplay(displays, controlDisplay)
    const external = target && target.id !== controlDisplay.id ? target : null

    let next: { kind: 'fullscreen' | 'window' | null; display: Display | null; note?: string }
    if (mode === 'off') next = { kind: null, display: null, note: 'Output is turned off' }
    else if (mode === 'window') next = { kind: 'window', display: controlDisplay }
    else if (external) next = { kind: 'fullscreen', display: external }
    // Tests have one screen: this lets them run the real fullscreen placement on it.
    else if (mode === 'fullscreen' && isE2E && process.env.CUE_E2E_FULLSCREEN === '1')
      next = { kind: 'fullscreen', display: controlDisplay }
    else if (mode === 'fullscreen')
      next = {
        kind: 'window',
        display: controlDisplay,
        note: 'Only one display is connected, so the output is shown in a window.'
      }
    else next = { kind: null, display: null, note: `Connect a ${out.name} or projector to show the output.` }

    if (next.kind === null) {
      this.destroyWindow()
    } else if (next.kind === 'fullscreen') {
      this.showFullscreen(next.display!)
    } else {
      this.showWindowed()
    }

    const size =
      next.kind === 'fullscreen'
        ? next.display!.size
        : this.win && !this.win.isDestroyed()
          ? this.win.getContentBounds()
          : { width: 1920, height: 1080 }
    this.status = {
      mode,
      active: next.kind !== null,
      windowed: next.kind === 'window',
      displayId: next.kind === 'fullscreen' ? next.display!.id : null,
      displayLabel:
        next.kind === 'fullscreen'
          ? labelFor(next.display!, displays)
          : next.kind === 'window'
            ? 'Window'
            : '',
      width: next.kind === 'fullscreen' ? size.width : 1920,
      height: next.kind === 'fullscreen' ? size.height : 1080,
      note: next.note
    }
    this.updateSleepBlocker()
    this.emit('changed', this.snapshot())
  }

  identify(): void {
    // Pressed again while the numbers are up: replace them rather than stacking more.
    this.closeIdentify()
    const displays = screen.getAllDisplays()
    const windows: BrowserWindow[] = []
    this.identifyWindows = windows
    displays.forEach((d, i) => {
      const isOutput = this.status.displayId === d.id
      const info: OutputIdentify = {
        index: i + 1,
        label: labelFor(d, displays),
        detail: `${d.size.width}×${d.size.height}${isOutput ? ' · Audience output' : ''}`
      }
      if (isOutput && this.ready) {
        this.win?.webContents.send('output:identify', info)
        return
      }
      windows.push(identifyWindow(d, info))
    })
    this.identifyTimer = setTimeout(() => this.closeIdentify(), 3500)
  }

  private closeIdentify(): void {
    if (this.identifyTimer) clearTimeout(this.identifyTimer)
    this.identifyTimer = null
    for (const w of this.identifyWindows) if (!w.isDestroyed()) w.destroy()
    this.identifyWindows = []
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('output:identify', null)
  }

  destroy(): void {
    this.disposed = true
    this.closeIdentify()
    this.destroyWindow()
  }

  private pickDisplay(displays: Display[], controlDisplay: Display): Display | null {
    const out = this.settings.data.output
    const byId = displays.find((d) => d.id === out.displayId)
    if (byId) return byId
    const byKey = out.displayKey ? displays.find((d) => displayKey(d) === out.displayKey) : undefined
    if (byKey) return byKey
    // Automatic: prefer an external, non-primary display that isn't hosting the control window.
    const others = displays.filter((d) => d.id !== controlDisplay.id)
    return others.find((d) => !d.internal) ?? others[0] ?? null
  }

  private showFullscreen(display: Display): void {
    if (this.winKind !== 'fullscreen') this.destroyWindow()
    const key = placementKey(display)
    if (this.win && this.placed === key) {
      // Already on this display. Placing it again would blink the room's screen every time the
      // control window moves or the OS reports a display change, so only check it still fits.
      this.settle(this.win, display)
      return
    }
    const win = this.win ?? this.createWindow('fullscreen', display.bounds)
    this.placed = key
    if (isWin && win.isFullScreen()) win.setFullScreen(false)
    win.setBounds(display.bounds)
    if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setAlwaysOnTop(true, 'screen-saver')
    if (!win.isVisible()) win.showInactive()
    if (isWin) win.setFullScreen(true)
    log.info(
      `Audience output placed on ${describe(display)} at ${Math.round(display.scaleFactor * 100)}% (${formatRect(display.bounds)})`
    )
    this.settle(win, display)
  }

  /**
   * Make sure the fullscreen window covers its display exactly: now, and again once the OS has
   * finished moving it. Anything extra lands on the screen next to it, which is usually the
   * operator's, as a strip that stays on top of everything. The check is done in the display's
   * own pixels, and so is the correction, so it also holds when the two screens use different
   * scaling (a laptop at 125 % and a TV at 100 %).
   */
  private settle(win: BrowserWindow, display: Display): void {
    for (const t of this.settleTimers) clearTimeout(t)
    const key = this.placed
    let corrections = 0
    const check = () => {
      if (win.isDestroyed() || this.win !== win || this.placed !== key) return
      const { want, have } = placement(win, display)
      if (sameRect(want, have)) return
      if (corrections++ >= 6) return
      log.warn(
        `Audience output covered ${formatRect(have)} instead of its display's ${formatRect(want)}: correcting`
      )
      win.setBounds(isWin ? screen.screenToDipRect(win, want) : want)
    }
    check()
    this.settleTimers = [150, 600, 2000].map((ms) => setTimeout(check, ms))
  }

  private showWindowed(): void {
    if (this.winKind !== 'window') this.destroyWindow()
    if (this.win) {
      if (!this.win.isVisible()) this.win.showInactive()
      return
    }
    const saved = this.settings.data.output.windowBounds
    const bounds = saved && onSomeDisplay(saved) ? saved : defaultWindowBounds(this.control)
    const win = this.createWindow('window', bounds)
    win.showInactive()
  }

  private createWindow(kind: 'fullscreen' | 'window', bounds: Rect): BrowserWindow {
    const fullscreen = kind === 'fullscreen'
    const win = new BrowserWindow({
      ...bounds,
      show: false,
      frame: !fullscreen,
      title: 'Cue — Audience Output',
      backgroundColor: '#000000',
      skipTaskbar: fullscreen,
      hasShadow: !fullscreen,
      resizable: !fullscreen,
      movable: !fullscreen,
      minimizable: !fullscreen,
      maximizable: !fullscreen,
      fullscreenable: !isMac,
      // No Windows sizing border on the fullscreen picture. The border is invisible, but a window
      // that can't be resized is never allowed to be smaller than its size plus that border: the
      // picture came out 14 px wider and 7 px taller than the screen, and the extra showed as a
      // strip along the edge of the screen next to it, on top of everything.
      thickFrame: !fullscreen,
      // The room's screen never takes the keyboard: every key belongs to the control window.
      // (On Linux an unfocusable window leaves the window manager, so it stays as it is there.)
      focusable: !fullscreen || !(isWin || isMac),
      enableLargerThanScreen: fullscreen,
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadPath('audience'),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
        spellcheck: false
      }
    })
    if (!fullscreen) {
      win.setAspectRatio(16 / 9)
      const save = debounce(() => {
        if (!win.isDestroyed()) this.settings.updateQuietly({ output: { windowBounds: win.getBounds() } })
      }, 500)
      win.on('resize', save)
      win.on('move', save)
    }
    if (isMac && fullscreen) win.setHiddenInMissionControl(true)
    win.setMenuBarVisibility(false)
    this.win = win
    this.winKind = kind
    this.ready = false
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.webContents.on('render-process-gone', (_e, details) => {
      log.error('Audience output crashed:', details.reason, '— reloading')
      this.ready = false
      if (!win.isDestroyed()) this.load(win)
    })
    win.webContents.on('unresponsive', () => log.warn('Audience output is unresponsive'))
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error') log.warn('[output]', event.message)
    })
    win.on('closed', () => {
      if (this.win !== win) return
      this.win = null
      this.winKind = null
      this.placed = null
      this.ready = false
      this.emit('playback', null)
      // Closing the floating output window is the operator saying "turn it off".
      if (kind === 'window' && this.settings.data.output.mode === 'window') {
        this.settings.update({ output: { mode: 'off' } })
        this.apply()
      }
    })
    this.load(win)
    return win
  }

  private load(win: BrowserWindow): void {
    void win.loadURL(rendererUrl('audience'))
  }

  private destroyWindow(): void {
    const win = this.win
    this.win = null
    this.winKind = null
    this.placed = null
    for (const t of this.settleTimers) clearTimeout(t)
    this.settleTimers = []
    this.ready = false
    if (win && !win.isDestroyed()) win.destroy()
    this.emit('playback', null)
  }

  private push(): void {
    if (!this.ready || !this.win || this.win.isDestroyed()) return
    this.win.webContents.send('output:config', this.config)
    if (this.state) this.win.webContents.send('output:state', this.state)
  }

  private buildConfig(): OutputConfig {
    const s = this.settings.data
    return {
      background: s.output.background,
      inset: s.output.inset,
      showCredits: s.output.showCredits,
      audioDeviceId: s.audio.deviceId,
      name: s.output.name
    }
  }

  private updateSleepBlocker(): void {
    const want = this.status.active
    if (want && this.sleepBlocker === null)
      this.sleepBlocker = powerSaveBlocker.start('prevent-display-sleep')
    if (!want && this.sleepBlocker !== null) {
      powerSaveBlocker.stop(this.sleepBlocker)
      this.sleepBlocker = null
    }
  }

  private listDisplays(): DisplayInfo[] {
    const displays = screen.getAllDisplays()
    const control =
      this.control && !this.control.isDestroyed() ? screen.getDisplayMatching(this.control.getBounds()) : null
    const primary = screen.getPrimaryDisplay()
    return displays.map((d) => ({
      id: d.id,
      label: labelFor(d, displays),
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      primary: d.id === primary.id,
      internal: !!d.internal,
      hasControl: d.id === control?.id
    }))
  }
}

function displayKey(d: Display): string {
  return `${d.label}|${d.size.width}x${d.size.height}`
}

function labelFor(d: Display, all: Display[]): string {
  if (d.label) return d.label
  if (d.internal) return 'Built-in display'
  return `Display ${all.findIndex((x) => x.id === d.id) + 1}`
}

function describe(d: Display): string {
  return `${d.label || d.id} ${d.size.width}x${d.size.height}`
}

/** Changes whenever the display the window was placed on changes size, position or scaling. */
function placementKey(d: Display): string {
  return `${d.id}:${formatRect(d.bounds)}@${d.scaleFactor}`
}

function formatRect(r: Rect): string {
  return `${r.width}x${r.height} at ${r.x},${r.y}`
}

function sameRect(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.x - b.x) <= 1 &&
    Math.abs(a.y - b.y) <= 1 &&
    Math.abs(a.width - b.width) <= 1 &&
    Math.abs(a.height - b.height) <= 1
  )
}

/**
 * Where a display is and where a window really is, in the units the OS places windows in.
 * On Windows those are physical pixels: the scaled units Electron normally uses depend on which
 * screen it believes the window is on.
 */
function placement(win: BrowserWindow, display: Display): { want: Rect; have: Rect } {
  if (!isWin) return { want: display.bounds, have: win.getBounds() }
  return {
    want: screen.dipToScreenRect(null, display.bounds),
    have: screen.dipToScreenRect(win, win.getBounds())
  }
}

function onSomeDisplay(r: Rect): boolean {
  return screen.getAllDisplays().some((d) => {
    const b = d.workArea
    return (
      r.x < b.x + b.width - 40 &&
      r.x + r.width > b.x + 40 &&
      r.y < b.y + b.height - 40 &&
      r.y + r.height > b.y
    )
  })
}

function defaultWindowBounds(control: BrowserWindow | null): Rect {
  const d =
    control && !control.isDestroyed()
      ? screen.getDisplayMatching(control.getBounds())
      : screen.getPrimaryDisplay()
  const width = Math.min(960, Math.round(d.workArea.width * 0.5))
  const height = Math.round((width * 9) / 16)
  return { x: d.workArea.x + d.workArea.width - width - 32, y: d.workArea.y + 48, width, height }
}

function identifyWindow(d: Display, info: OutputIdentify): BrowserWindow {
  const w = 420
  const h = 240
  const win = new BrowserWindow({
    x: Math.round(d.bounds.x + (d.bounds.width - w) / 2),
    y: Math.round(d.bounds.y + (d.bounds.height - h) / 2),
    width: w,
    height: h,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, javascript: false }
  })
  const html = `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:transparent;font-family:-apple-system,'Segoe UI',system-ui,sans-serif">
  <div style="width:400px;height:220px;border-radius:28px;background:rgba(21,19,17,.94);border:1px solid rgba(240,228,205,.14);display:grid;place-items:center;text-align:center;color:#F4EEE2">
  <div><div style="font-size:96px;font-weight:700;line-height:1;color:#A7BC93">${info.index}</div>
  <div style="margin-top:10px;font-size:20px;font-weight:600">${escapeHtml(info.label)}</div>
  <div style="margin-top:4px;font-size:14px;color:#BDB5A6">${escapeHtml(info.detail)}</div></div></div></body></html>`
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  win.once('ready-to-show', () => win.showInactive())
  return win
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  )
}
