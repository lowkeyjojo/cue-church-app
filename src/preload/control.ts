import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { CueBridge, CueEvent, CueEvents, CueMethod } from '@shared/ipc'

const bridge: CueBridge = {
  invoke: (method: CueMethod, ...args: unknown[]) => ipcRenderer.invoke('cue:invoke', method, ...args),
  on<E extends CueEvent>(event: E, listener: (payload: CueEvents[E]) => void) {
    const channel = `cue:${event}`
    const handler = (_e: Electron.IpcRendererEvent, payload: CueEvents[E]) => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  platform: process.platform
} as CueBridge

contextBridge.exposeInMainWorld('cue', bridge)
