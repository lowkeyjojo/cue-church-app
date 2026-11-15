import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { UiCommand } from '@shared/ipc'
import type { OutputMode, ShowCommand } from '@shared/types'
import { isDev, logsDir } from './paths'

const isMac = process.platform === 'darwin'

export interface MenuHooks {
  ui(command: UiCommand): void
  dispatch(cmd: ShowCommand): void
  setOutputMode(mode: OutputMode): void
  identify(): void
  outputMode(): OutputMode
}

/**
 * The application menu. Live shortcuts are handled by the control window itself
 * (so they work identically on every platform); menu items here are for
 * discoverability and only register accelerators for idempotent UI actions.
 */
export function buildMenu(hooks: MenuHooks): void {
  const accel = (key: string): Partial<MenuItemConstructorOptions> =>
    isMac ? { accelerator: key } : { accelerator: key, registerAccelerator: false }
  const ui = (
    label: string,
    command: UiCommand,
    extra: Partial<MenuItemConstructorOptions> = {}
  ): MenuItemConstructorOptions => ({
    label,
    click: () => hooks.ui(command),
    ...extra
  })
  const show = (label: string, cmd: ShowCommand, hint?: string): MenuItemConstructorOptions => ({
    label: hint ? `${label}\t${hint}` : label,
    click: () => hooks.dispatch(cmd)
  })
  const mode = hooks.outputMode()
  const outputMode = (label: string, value: OutputMode): MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: mode === value,
    click: () => hooks.setOutputMode(value)
  })

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              ui('About Cue', 'about'),
              { type: 'separator' },
              ui('Settings…', 'open-settings', accel('CmdOrCtrl+,')),
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } as MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'File',
      submenu: [
        ui('Import Media…', 'import'),
        ui('New Service Plan', 'new-plan'),
        ui('Quick Text Slide…', 'quick-slide'),
        ...(!isMac
          ? ([
              { type: 'separator' },
              ui('Settings…', 'open-settings', accel('CmdOrCtrl+,')),
              { type: 'separator' },
              { role: 'quit', label: 'Exit' }
            ] as MenuItemConstructorOptions[])
          : [])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        ui('Show', 'tab-show', accel('CmdOrCtrl+1')),
        ui('Search', 'tab-search', accel('CmdOrCtrl+2')),
        ui('Library', 'tab-library', accel('CmdOrCtrl+3')),
        { type: 'separator' },
        ui('Command Palette…', 'open-palette', accel('CmdOrCtrl+K')),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev
          ? ([
              { type: 'separator' },
              { role: 'reload' },
              { role: 'toggleDevTools' }
            ] as MenuItemConstructorOptions[])
          : [])
      ]
    },
    {
      label: 'Output',
      submenu: [
        show('Show Preview on Screen', { type: 'take' }, 'Space'),
        show('Next', { type: 'next' }, '→'),
        show('Previous', { type: 'prev' }, '←'),
        { type: 'separator' },
        show('Blackout', { type: 'blackout' }, 'B'),
        show('Ambient', { type: 'ambient' }, 'A'),
        show('Back to Previous', { type: 'back' }, 'R'),
        show('Clear Screen', { type: 'clear' }),
        { type: 'separator' },
        { label: 'Identify Displays', click: () => hooks.identify() },
        show('Test Pattern', { type: 'test-pattern' }),
        { type: 'separator' },
        outputMode('Automatic (use external display)', 'auto'),
        outputMode('Fullscreen', 'fullscreen'),
        outputMode('Floating Window', 'window'),
        outputMode('Off', 'off')
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        ui('Keyboard Shortcuts', 'shortcuts'),
        { label: 'Show Log Files', click: () => void shell.openPath(logsDir()) },
        ...(!isMac ? [ui('About Cue', 'about')] : [])
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
