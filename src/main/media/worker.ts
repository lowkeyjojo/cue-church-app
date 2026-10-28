import { BrowserWindow, ipcMain } from 'electron'
import { newId } from '@shared/defaults'
import type { WorkerReply, WorkerTask } from '@shared/ipc'
import { log } from '../log'
import { preloadPath, rendererUrl } from '../paths'

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never
export type TaskInput = DistributiveOmit<WorkerTask, 'id'>

interface Job {
  task: WorkerTask
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  onReply?: (reply: WorkerReply) => void
  timeoutMs: number
  timer?: ReturnType<typeof setTimeout>
  /** Times this job was retried because the worker restarted under it. */
  retries: number
}

/** How long the worker page gets to start before it's considered broken. */
const STARTUP_MS = 20_000

/**
 * A hidden renderer that does Chromium-native media work: decoding images,
 * grabbing video frames and rasterizing PDFs with pdf.js. Running it in its own
 * process keeps the control UI smooth and means a corrupt file can only crash
 * the worker, which is restarted automatically. Other files that were being
 * processed at the time are retried rather than marked unreadable.
 */
export class MediaWorker {
  private win: BrowserWindow | null = null
  private ready: Promise<void> | null = null
  private markReady: (() => void) | null = null
  private jobs = new Map<string, Job>()
  private queue: Job[] = []
  private running = 0
  private readonly concurrency = 2
  private closed = false

  constructor() {
    ipcMain.on('worker:ready', (event) => {
      if (event.sender === this.win?.webContents) this.markReady?.()
    })
    ipcMain.on('worker:reply', (event, reply: WorkerReply) => {
      if (event.sender !== this.win?.webContents) return
      const job = this.jobs.get(reply.id)
      if (!job) return
      if (reply.kind === 'done' || reply.kind === 'error') {
        this.finish(job)
        if (reply.kind === 'done') job.resolve(reply.data)
        else job.reject(new Error(reply.error))
      } else {
        this.arm(job)
        job.onReply?.(reply)
      }
    })
  }

  run<T>(
    input: TaskInput,
    opts: { timeoutMs?: number; onReply?: (reply: WorkerReply) => void } = {}
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task = { ...input, id: newId() } as WorkerTask
      const job: Job = {
        task,
        resolve: resolve as (data: unknown) => void,
        reject,
        onReply: opts.onReply,
        timeoutMs: opts.timeoutMs ?? 45_000,
        retries: 0
      }
      this.queue.push(job)
      this.pump()
    })
  }

  destroy(): void {
    const win = this.win
    this.win = null
    this.ready = null
    this.markReady = null
    if (win && !win.isDestroyed()) win.destroy()
  }

  /** Cue is quitting: close the worker for good (a new window would keep the app open). */
  shutdown(): void {
    this.closed = true
    this.destroy()
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!
      this.running++
      this.jobs.set(job.task.id, job)
      void this.start(job)
    }
  }

  private async start(job: Job): Promise<void> {
    try {
      await this.ensure()
      // The job may have been retried or failed while the worker was starting.
      if (this.jobs.get(job.task.id) !== job || !this.win) return
      this.arm(job)
      this.win.webContents.send('worker:task', job.task)
    } catch (err) {
      if (this.jobs.get(job.task.id) !== job) return
      this.finish(job)
      job.reject(err as Error)
    }
  }

  private arm(job: Job): void {
    if (job.timer) clearTimeout(job.timer)
    job.timer = setTimeout(() => {
      log.warn(`Media worker task ${job.task.type} timed out; restarting worker`)
      this.finish(job)
      job.reject(new Error('Timed out while processing this file'))
      this.destroy()
      this.retryInFlight(new Error('The media worker was restarted'))
    }, job.timeoutMs)
  }

  private finish(job: Job): void {
    if (job.timer) clearTimeout(job.timer)
    if (this.jobs.delete(job.task.id)) {
      this.running--
      queueMicrotask(() => this.pump())
    }
  }

  private ensure(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Cue is closing'))
    if (this.ready && this.win && !this.win.isDestroyed()) return this.ready
    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        preload: preloadPath('worker'),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
        spellcheck: false
      }
    })
    this.win = win
    const ready = new Promise<void>((resolve, reject) => {
      const fail = (err: Error) => {
        clearTimeout(timer)
        if (this.win === win) this.destroy()
        reject(err)
      }
      const timer = setTimeout(() => fail(new Error("The media worker didn't start")), STARTUP_MS)
      this.markReady = () => {
        clearTimeout(timer)
        resolve()
      }
      win.webContents.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
        if (isMainFrame) fail(new Error(`The media worker couldn't load (${description || code})`))
      })
    })
    // Waiting jobs handle the failure; don't also report it as unhandled.
    ready.catch((err: Error) => log.error(err.message))
    this.ready = ready
    win.webContents.setAudioMuted(true)
    win.webContents.on('render-process-gone', (_e, details) => {
      if (this.win !== win) return
      log.error('Media worker crashed:', details.reason)
      this.destroy()
      this.retryInFlight(new Error('The media worker stopped unexpectedly while processing this file'))
    })
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error' || event.level === 'warning') log.warn('[worker]', event.message)
    })
    void win.loadURL(rendererUrl('worker'))
    return ready
  }

  /**
   * After a restart, run the jobs that were in flight again: one of them may
   * have caused it, so a job that was already retried once fails instead.
   */
  private retryInFlight(err: Error): void {
    for (const job of [...this.jobs.values()]) {
      this.finish(job)
      if (job.retries >= 1) {
        job.reject(err)
      } else {
        job.retries++
        this.queue.unshift(job)
      }
    }
  }
}
