import { contextBridge, ipcRenderer } from 'electron'
import type { WorkerBridge, WorkerReply, WorkerTask } from '@shared/ipc'

const bridge: WorkerBridge = {
  onTask(listener) {
    const handler = (_e: Electron.IpcRendererEvent, task: WorkerTask) => listener(task)
    ipcRenderer.on('worker:task', handler)
    return () => ipcRenderer.removeListener('worker:task', handler)
  },
  reply: (reply: WorkerReply) => ipcRenderer.send('worker:reply', reply),
  ready: () => ipcRenderer.send('worker:ready')
}

contextBridge.exposeInMainWorld('cueWorker', bridge)
