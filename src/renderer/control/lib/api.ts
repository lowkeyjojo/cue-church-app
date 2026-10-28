import type { CueArgs, CueMethod, CueResult } from '@shared/ipc'
import type { ShowCommand } from '@shared/types'
import { toast } from './toasts'

export const bridge = window.cue
export const isMac = bridge.platform === 'darwin'
export const modKey = isMac ? '⌘' : 'Ctrl'

/** Call the main process. Throws on failure. */
export function call<M extends CueMethod>(method: M, ...args: CueArgs<M>): Promise<CueResult<M>> {
  return bridge.invoke(method, ...args)
}

/** Call the main process; on failure, tell the operator and resolve to undefined. */
export async function attempt<M extends CueMethod>(
  method: M,
  ...args: CueArgs<M>
): Promise<CueResult<M> | undefined> {
  try {
    return await bridge.invoke(method, ...args)
  } catch (err) {
    toast.error(cleanError(err))
    return undefined
  }
}

export function dispatch(cmd: ShowCommand): void {
  void attempt('show:dispatch', cmd)
}

export function cleanError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}
