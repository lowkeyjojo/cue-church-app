import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { newId } from '@shared/defaults'
import type { Collection, Id, MediaItem } from '@shared/types'
import { log } from '../log'
import { dataPath, mediaRoot } from '../paths'
import { Emitter } from './emitter'
import { JsonStore } from './jsonStore'

interface LibraryFile {
  version: 1
  items: Record<Id, MediaItem>
  collections: Collection[]
}

const TRANSIENT_TTL_DAYS = 30

export class LibraryStore extends Emitter<{
  upsert: MediaItem[]
  remove: Id[]
  collections: Collection[]
}> {
  private store = new JsonStore<LibraryFile>(
    dataPath('library.json'),
    () => ({ version: 1, items: {}, collections: [] }),
    (raw) => {
      const data = raw as Partial<LibraryFile>
      return { version: 1, items: data.items ?? {}, collections: data.collections ?? [] }
    },
    400
  )
  private pending = new Map<Id, MediaItem>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  all(): MediaItem[] {
    return Object.values(this.store.data.items)
  }

  collections(): Collection[] {
    return this.store.data.collections
  }

  get(id: Id | undefined): MediaItem | undefined {
    return id ? this.store.data.items[id] : undefined
  }

  byHash(hash: string): MediaItem | undefined {
    return this.all().find((i) => i.hash === hash)
  }

  itemDir(id: Id): string {
    return join(mediaRoot(), id)
  }

  filePath(item: MediaItem, file = item.file): string {
    if (!file) throw new Error(`Item ${item.id} has no file`)
    return join(this.itemDir(item.id), file)
  }

  add(item: MediaItem): MediaItem {
    this.store.data.items[item.id] = item
    this.changed(item)
    return item
  }

  update(id: Id, patch: Partial<MediaItem> | ((item: MediaItem) => Partial<MediaItem>)): MediaItem | null {
    const current = this.store.data.items[id]
    if (!current) return null
    const changes = typeof patch === 'function' ? patch(current) : patch
    const next: MediaItem = { ...current, ...changes, updatedAt: Date.now() }
    this.store.data.items[id] = next
    this.changed(next)
    return next
  }

  remove(ids: Id[]): void {
    const removed: Id[] = []
    for (const id of ids) {
      if (!this.store.data.items[id]) continue
      delete this.store.data.items[id]
      this.pending.delete(id)
      removed.push(id)
      try {
        rmSync(this.itemDir(id), { recursive: true, force: true })
      } catch (err) {
        log.warn(`Could not delete media folder for ${id}:`, err)
      }
    }
    if (!removed.length) return
    this.store.save()
    this.emit('remove', removed)
  }

  markShown(id: Id): void {
    this.update(id, (i) => ({ lastShownAt: Date.now(), showCount: (i.showCount ?? 0) + 1 }))
  }

  createCollection(name: string): Collection {
    const col: Collection = { id: newId(), name: name.trim() || 'Untitled', createdAt: Date.now() }
    this.store.data.collections.push(col)
    this.collectionsChanged()
    return col
  }

  renameCollection(id: Id, name: string): void {
    const col = this.store.data.collections.find((c) => c.id === id)
    if (!col) return
    col.name = name.trim() || col.name
    this.collectionsChanged()
  }

  removeCollection(id: Id): void {
    this.store.data.collections = this.store.data.collections.filter((c) => c.id !== id)
    for (const item of this.all()) {
      if (item.collections.includes(id))
        this.update(item.id, { collections: item.collections.filter((c) => c !== id) })
    }
    this.collectionsChanged()
  }

  setCollection(ids: Id[], collectionId: Id, member: boolean): void {
    for (const id of ids) {
      this.update(id, (item) => {
        const set = new Set(item.collections)
        if (member) set.add(collectionId)
        else set.delete(collectionId)
        return { collections: [...set], saved: member ? true : item.saved }
      })
    }
  }

  /** Forget transient web picks nobody has used in a while. */
  pruneTransient(isReferenced: (id: Id) => boolean): void {
    const cutoff = Date.now() - TRANSIENT_TTL_DAYS * 86_400_000
    const stale = this.all()
      .filter((i) => !i.saved && (i.lastShownAt ?? i.createdAt) < cutoff && !isReferenced(i.id))
      .map((i) => i.id)
    if (stale.length) {
      log.info(`Pruning ${stale.length} unused web picks`)
      this.remove(stale)
    }
  }

  flush(): void {
    this.flushPending()
    this.store.flush()
  }

  private changed(item: MediaItem): void {
    this.store.save()
    this.pending.set(item.id, item)
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flushPending(), 30)
  }

  private flushPending(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    if (!this.pending.size) return
    const items = [...this.pending.values()]
    this.pending.clear()
    this.emit('upsert', items)
  }

  private collectionsChanged(): void {
    this.store.save()
    this.emit('collections', this.store.data.collections)
  }
}
