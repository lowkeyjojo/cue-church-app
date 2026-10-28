import type { CueBridge, OutputBridge, WorkerBridge } from '../shared/ipc'

declare global {
  interface Window {
    cue: CueBridge
    cueOutput: OutputBridge
    cueWorker: WorkerBridge
  }
}

export {}
