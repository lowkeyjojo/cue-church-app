import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const isE2E = process.env.CUE_E2E === '1'
export const isDev = !app.isPackaged

let dataDir = ''
let mediaDir = ''

/**
 * Must run before `app.whenReady()`. Tests (and power users) can point Cue at
 * an isolated data folder with CUE_USER_DATA.
 */
export function initPaths(): void {
  if (process.env.CUE_USER_DATA) app.setPath('userData', process.env.CUE_USER_DATA)
  dataDir = app.getPath('userData')
  // Media can be large: on Windows keep it out of the roaming profile.
  const local =
    process.platform === 'win32' && !process.env.CUE_USER_DATA ? process.env.LOCALAPPDATA : undefined
  mediaDir = local ? join(local, 'Cue', 'Media') : join(dataDir, 'Media')
  for (const dir of [dataDir, mediaDir, logsDir()]) mkdirSync(dir, { recursive: true })
}

export function dataPath(...parts: string[]): string {
  return join(dataDir, ...parts)
}

export function mediaRoot(): string {
  return mediaDir
}

export function logsDir(): string {
  return join(dataDir, 'logs')
}

/** Directory of the bundled main script (out/main). */
export const mainDir = import.meta.dirname

export function preloadPath(name: 'control' | 'audience' | 'worker' | 'webview'): string {
  return join(mainDir, '..', 'preload', `${name}.cjs`)
}

/** URL of a renderer page: the Vite dev server in development, cue-app:// when bundled. */
export function rendererUrl(page: 'control' | 'audience' | 'worker'): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (isDev && devUrl) return `${devUrl}/${page}.html`
  return `cue-app://app/${page}.html`
}

/** Static assets shipped with the app (icons, built-in media). */
export function resourcePath(...parts: string[]): string {
  const base = app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(mainDir, '..', '..', 'resources')
  return join(base, ...parts)
}
