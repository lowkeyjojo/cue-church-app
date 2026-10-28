import { ipcMain, type WebContents } from 'electron'
import type { CueArgs, CueEvent, CueEvents, CueMethod, CueResult } from '@shared/ipc'
import { errorMessage, log } from './log'

type Handler<M extends CueMethod> = (...args: CueArgs<M>) => CueResult<M> | Promise<CueResult<M>>

const handlers = new Map<CueMethod, (...args: unknown[]) => unknown>()
const controls = new Set<WebContents>()

/** Register the control window's webContents as a trusted caller and event receiver. */
export function addControl(contents: WebContents): void {
  controls.add(contents)
  contents.once('destroyed', () => controls.delete(contents))
}

export function handle<M extends CueMethod>(method: M, fn: Handler<M>): void {
  handlers.set(method, fn as (...args: unknown[]) => unknown)
}

export function broadcast<E extends CueEvent>(event: E, payload: CueEvents[E]): void {
  for (const wc of controls) {
    if (!wc.isDestroyed()) wc.send(`cue:${event}`, payload)
  }
}

export function installIpc(): void {
  ipcMain.handle('cue:invoke', async (event, method: CueMethod, ...args: unknown[]) => {
    if (!controls.has(event.sender)) {
      log.warn(`Rejected ${method} from untrusted sender`)
      throw new Error('Not allowed')
    }
    const fn = handlers.get(method)
    if (!fn) throw new Error(`Unknown method ${method}`)
    try {
      return await fn(...args)
    } catch (err) {
      log.error(`${method} failed:`, err)
      // Re-throw a plain Error so the renderer gets a readable message.
      throw new Error(errorMessage(err), { cause: err })
    }
  })
}
