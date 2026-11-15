import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { log } from '../log'

/**
 * A small crash-safe JSON document store.
 *
 * - Writes are debounced and atomic (write temp file, then rename).
 * - The file as it was at launch is kept as `.bak`; if the main file is ever
 *   unreadable, the backup is used and the bad file is set aside, never lost.
 */
export class JsonStore<T> {
  data: T
  private timer: ReturnType<typeof setTimeout> | null = null
  private backedUp = false

  constructor(
    private readonly file: string,
    private readonly defaults: () => T,
    private readonly migrate: (raw: unknown) => T = (raw) => raw as T,
    private readonly debounceMs = 250
  ) {
    this.data = this.load()
  }

  private load(): T {
    for (const candidate of [this.file, `${this.file}.bak`]) {
      if (!existsSync(candidate)) continue
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8'))
        if (candidate !== this.file) log.warn(`Recovered ${this.file} from backup`)
        return this.migrate(parsed)
      } catch (err) {
        log.error(`Could not read ${candidate}:`, err)
        if (candidate === this.file) {
          try {
            renameSync(candidate, `${candidate}.corrupt-${Date.now()}`)
          } catch {
            /* keep going with the backup */
          }
        }
      }
    }
    return this.defaults()
  }

  /** Schedule a debounced save. */
  save(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.debounceMs)
  }

  /** Write immediately (used on quit). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    try {
      if (!this.backedUp && existsSync(this.file)) {
        copyFileSync(this.file, `${this.file}.bak`)
        this.backedUp = true
      }
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data))
      renameSync(tmp, this.file)
    } catch (err) {
      log.error(`Could not save ${this.file}:`, err)
    }
  }
}
