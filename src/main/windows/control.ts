import { BrowserWindow, Menu, screen, session, shell, type WebContents } from 'electron'
import type { UiCommand } from '@shared/ipc'
import type { ShowCommand } from '@shared/types'
import { debounce, isHttpUrl } from '@shared/util'
import { WEB_PARTITION } from '../media/webIngest'
import { isDev, isE2E, preloadPath, rendererUrl, resourcePath } from '../paths'
import type { SettingsStore } from '../store/settings'
import { matchGlobalShortcut } from '../shortcuts'

const isMac = process.platform === 'darwin'

export interface ControlHooks {
  dispatch(cmd: ShowCommand): void
  ui(command: UiCommand): void
  /** Context-menu actions on images inside the embedded browser. */
  webImage(
    action: 'preview' | 'show' | 'save',
    image: { srcURL: string; pageURL: string; linkURL?: string; x: number; y: number; contentsId: number }
  ): void
}

export function createControlWindow(settings: SettingsStore, hooks: ControlHooks): BrowserWindow {
  const saved = settings.data.ui.controlBounds
  const visible = saved && screen.getAllDisplays().some((d) => intersects(saved, d.workArea))
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    ...(visible ? saved : {}),
    minWidth: 1100,
    minHeight: 680,
    show: false,
    title: 'Cue',
    backgroundColor: '#0B0C0E',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 15 },
    titleBarOverlay: isMac ? undefined : { color: '#0B0C0E', symbolColor: '#A7A8AE', height: 44 },
    icon: isMac ? undefined : resourcePath('icon.png'),
    webPreferences: {
      preload: preloadPath('control'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: true
    }
  })

  win.once('ready-to-show', () => {
    if (settings.data.ui.maximized && !isE2E) win.maximize()
    if (!isE2E || process.env.CUE_E2E_SHOW === '1') win.show()
    else win.showInactive()
  })

  const saveBounds = debounce(() => {
    if (win.isDestroyed() || win.isMinimized()) return
    settings.updateQuietly({
      ui: {
        controlBounds: win.isMaximized() ? settings.data.ui.controlBounds : win.getNormalBounds(),
        maximized: win.isMaximized()
      }
    })
  }, 500)
  win.on('resize', saveBounds)
  win.on('move', saveBounds)
  win.on('maximize', saveBounds)
  win.on('unmaximize', saveBounds)

  const contents = win.webContents
  // The control UI is a single page: never navigate it away (e.g. by dropping a file on it).
  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault()
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Lock down every embedded browser view (the Google Images pane).
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    delete (webPreferences as { preloadURL?: string }).preloadURL
    webPreferences.preload = preloadPath('webview')
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.partition = WEB_PARTITION
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
    const allowed =
      params.src.startsWith('https://') ||
      params.src === 'about:blank' ||
      (isE2E && params.src.startsWith('http://127.0.0.1'))
    if (!allowed) event.preventDefault()
  })
  contents.on('did-attach-webview', (_event, guest) => configureGuest(guest, hooks))

  void win.loadURL(rendererUrl('control'))
  if (isDev && process.env.CUE_DEVTOOLS === '1') contents.openDevTools({ mode: 'detach' })
  return win
}

function configureGuest(guest: WebContents, hooks: ControlHooks): void {
  // Links that would open a new window stay inside the pane instead.
  guest.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void guest.loadURL(url)
    return { action: 'deny' }
  })
  guest.on('will-navigate', (event, url) => {
    if (!isHttpUrl(url) && !url.startsWith('about:')) event.preventDefault()
  })
  // Cue's live shortcuts keep working while the operator is browsing.
  guest.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const match = matchGlobalShortcut(input, isMac)
    if (!match) return
    event.preventDefault()
    if (match.kind === 'show') hooks.dispatch(match.command)
    else hooks.ui(match.command)
  })
  guest.on('context-menu', (_event, params) => {
    const items: Electron.MenuItemConstructorOptions[] = []
    const image = params.mediaType === 'image' && params.srcURL ? params.srcURL : null
    if (image) {
      const info = {
        srcURL: image,
        pageURL: params.pageURL,
        linkURL: params.linkURL || undefined,
        x: params.x,
        y: params.y,
        contentsId: guest.id
      }
      items.push(
        { label: 'Preview in Cue', click: () => hooks.webImage('preview', info) },
        { label: 'Show on Screen Now', click: () => hooks.webImage('show', info) },
        { label: 'Save to Library', click: () => hooks.webImage('save', info) },
        { type: 'separator' },
        {
          label: 'Open Image in Browser',
          enabled: isHttpUrl(image),
          click: () => void shell.openExternal(image)
        },
        { label: 'Copy Image', click: () => guest.copyImageAt(params.x, params.y) },
        { type: 'separator' }
      )
    }
    if (params.linkURL && isHttpUrl(params.linkURL) && !image) {
      items.push(
        { label: 'Open Link in Browser', click: () => void shell.openExternal(params.linkURL) },
        { type: 'separator' }
      )
    }
    if (params.isEditable)
      items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' })
    else if (params.selectionText) items.push({ role: 'copy' }, { type: 'separator' })
    items.push(
      {
        label: 'Back',
        enabled: guest.navigationHistory.canGoBack(),
        click: () => guest.navigationHistory.goBack()
      },
      {
        label: 'Forward',
        enabled: guest.navigationHistory.canGoForward(),
        click: () => guest.navigationHistory.goForward()
      },
      { label: 'Reload', click: () => guest.reload() }
    )
    Menu.buildFromTemplate(items).popup()
  })
}

/** A realistic Chrome user agent for the embedded browser, so sites serve their normal pages. */
export function configureWebSession(): void {
  const ses = session.fromPartition(WEB_PARTITION)
  const ua = ses.getUserAgent().replace(/\s(Electron|cue|Cue)\/\S+/g, '')
  ses.setUserAgent(ua)
  // The embedded browser never needs camera, mic, notifications, etc.
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(permission === 'fullscreen' || permission === 'clipboard-sanitized-write')
  )
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    a.x < b.x + b.width - 60 && a.x + a.width > b.x + 60 && a.y < b.y + b.height - 60 && a.y + a.height > b.y
  )
}
