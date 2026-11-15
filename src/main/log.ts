import { createWriteStream, existsSync, renameSync, statSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'
import { logsDir } from './paths'

type Level = 'debug' | 'info' | 'warn' | 'error'

const MAX_BYTES = 5 * 1024 * 1024
let stream: WriteStream | null = null
let written = 0

function open(): WriteStream | null {
  if (stream) return stream
  try {
    const file = join(logsDir(), 'cue.log')
    if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, join(logsDir(), 'cue.1.log'))
    written = existsSync(file) ? statSync(file).size : 0
    stream = createWriteStream(file, { flags: 'a' })
    stream.on('error', () => (stream = null))
  } catch {
    stream = null
  }
  return stream
}

function write(level: Level, args: unknown[]): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${format(...args)}\n`
  if (level === 'error') console.error(line.trimEnd())
  else if (level === 'warn') console.warn(line.trimEnd())
  else if (process.env.CUE_VERBOSE || level === 'info') console.log(line.trimEnd())
  const s = open()
  if (!s) return
  s.write(line)
  written += line.length
  if (written > MAX_BYTES) {
    s.end()
    stream = null
  }
}

export const log = {
  debug: (...args: unknown[]) => write('debug', args),
  info: (...args: unknown[]) => write('info', args),
  warn: (...args: unknown[]) => write('warn', args),
  error: (...args: unknown[]) => write('error', args)
}

export { UserError } from './errors'

export function errorMessage(err: unknown): string {
  // Never an empty message: the operator would see a failure that says nothing.
  if (err instanceof Error) return err.message || err.name || 'Something went wrong'
  return String(err) || 'Something went wrong'
}
