import { newId } from '@shared/defaults'
import type { HistoryEntry, Id, Presentation } from '@shared/types'
import { dataPath } from '../paths'
import { Emitter } from './emitter'
import { JsonStore } from './jsonStore'

const MAX_ENTRIES = 300

/** A log of everything that went live, so anything can be brought back in one click. */
export class HistoryStore extends Emitter<{ changed: HistoryEntry[] }> {
  private store = new JsonStore<{ version: 1; entries: HistoryEntry[] }>(
    dataPath('history.json'),
    () => ({ version: 1, entries: [] }),
    (raw) => ({ version: 1, entries: (raw as { entries?: HistoryEntry[] }).entries ?? [] })
  )

  all(): HistoryEntry[] {
    return this.store.data.entries
  }

  add(p: Presentation): void {
    if (p.kind === 'ambient' && !p.entryId) return
    const entries = this.store.data.entries
    const last = entries[0]
    // A presentation that is re-shown right away (e.g. Back) only refreshes its timestamp.
    if (last && last.mediaId && last.mediaId === p.mediaId && last.presentation.page === p.page) {
      last.at = Date.now()
    } else {
      entries.unshift({
        id: newId(),
        at: Date.now(),
        title: p.title,
        subtitle: p.subtitle,
        kind: p.kind,
        mediaId: p.mediaId,
        thumb: p.thumb,
        presentation: { ...p, transport: undefined, zoom: undefined }
      })
      if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES
    }
    this.changed()
  }

  removeMedia(ids: Id[]): void {
    const gone = new Set(ids)
    const before = this.store.data.entries.length
    this.store.data.entries = this.store.data.entries.filter((e) => !(e.mediaId && gone.has(e.mediaId)))
    if (this.store.data.entries.length !== before) this.changed()
  }

  referencedMedia(): Set<Id> {
    return new Set(this.store.data.entries.map((e) => e.mediaId).filter((x): x is Id => !!x))
  }

  clear(): void {
    this.store.data.entries = []
    this.changed()
  }

  flush(): void {
    this.store.flush()
  }

  private changed(): void {
    this.store.save()
    this.emit('changed', this.store.data.entries)
  }
}
