import { contextBridge, ipcRenderer } from 'electron'
import type { OutputBridge, OutputIdentify } from '@shared/ipc'
import type { OutputConfig, PlaybackStatus, ShowState } from '@shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const bridge: OutputBridge = {
  onState: (listener) => subscribe<ShowState>('output:state', listener),
  onConfig: (listener) => subscribe<OutputConfig>('output:config', listener),
  onIdentify: (listener) => subscribe<OutputIdentify | null>('output:identify', listener),
  reportPlayback: (status: PlaybackStatus | null) => ipcRenderer.send('output:playback', status),
  ready: () => ipcRenderer.send('output:ready')
}

contextBridge.exposeInMainWorld('cueOutput', bridge)
