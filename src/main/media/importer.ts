import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, open, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { newId } from '@shared/defaults'
import type { ImportResult } from '@shared/ipc'
import {
  SLIDESHOW_EXTENSIONS,
  extForMime,
  extOf,
  kindForExt,
  mimeForExt,
  safeFileName,
  sniffMime
} from '@shared/media'
import type { Id, MediaItem, MediaKind, MediaSource } from '@shared/types'
import { prettyName } from '@shared/util'
import { log, UserError } from '../log'
import type { LibraryStore } from '../store/library'
import type { MediaProcessor } from './processor'

const MAX_DEPTH = 3

export class Importer {
  private pending = new Map<string, Promise<MediaItem>>()

  constructor(
    private library: LibraryStore,
    private processor: MediaProcessor,
    private onProgress: (info: {
      id: string
      label: string
      done: number
      total: number
      finished?: boolean
    }) => void
  ) {}

  /** Import files and folders from disk. Duplicates are recognised and reused. */
  async importPaths(paths: string[], opts: { collectionId?: Id } = {}): Promise<ImportResult> {
    const files: string[] = []
    const skipped: ImportResult['skipped'] = []
    for (const p of paths) await collect(p, 0, files, skipped)

    const items: MediaItem[] = []
    const progressId = newId()
    const showProgress = files.length > 1
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (showProgress)
        this.onProgress({
          id: progressId,
          label: `Importing ${basename(file)}`,
          done: i,
          total: files.length
        })
      try {
        const item = await this.importFile(file, opts.collectionId)
        items.push(item)
      } catch (err) {
        log.warn('Import failed for', file, err)
        skipped.push({ path: file, reason: (err as Error).message })
      }
    }
    if (showProgress)
      this.onProgress({
        id: progressId,
        label: 'Import complete',
        done: files.length,
        total: files.length,
        finished: true
      })
    return { items, skipped }
  }

  private async importFile(path: string, collectionId?: Id): Promise<MediaItem> {
    const ext = extOf(path)
    const kind = kindForExt(ext)
    if (!kind) throw new UserError('Unsupported file type')
    const info = await stat(path)
    const hash = await quickHash(path, info.size)
    const item = await this.once(hash, () => this.copyIn(path, ext, kind, info.size, hash))
    if (collectionId && !item.collections.includes(collectionId)) {
      return (
        this.library.update(item.id, { saved: true, collections: [...item.collections, collectionId] }) ??
        item
      )
    }
    return item.saved ? item : (this.library.update(item.id, { saved: true }) ?? item)
  }

  /**
   * Run one import per content at a time, so the same file dropped twice (or a
   * plan and its media arriving together) becomes one library item.
   */
  private once(hash: string, work: () => Promise<MediaItem>): Promise<MediaItem> {
    const existing = this.library.byHash(hash)
    if (existing) return Promise.resolve(existing)
    let running = this.pending.get(hash)
    if (!running) {
      running = work().finally(() => this.pending.delete(hash))
      this.pending.set(hash, running)
    }
    return running
  }

  private async copyIn(
    path: string,
    ext: string,
    kind: MediaKind,
    size: number,
    hash: string
  ): Promise<MediaItem> {
    const id = newId()
    const dir = this.library.itemDir(id)
    await mkdir(dir, { recursive: true })
    const fileName = safeFileName(basename(path), `media.${ext}`)
    // COPYFILE_FICLONE makes this instant on APFS/ReFS when possible.
    await copyFile(path, join(dir, fileName), constants.COPYFILE_FICLONE)
    const item = this.library.add(
      newItem({
        id,
        kind,
        name: prettyName(basename(path)),
        file: fileName,
        mime: mimeForExt(ext),
        bytes: size,
        hash,
        source: { type: 'file', originalPath: path },
        saved: true
      })
    )
    this.processor.enqueue(id)
    return item
  }

  /** Import raw bytes (clipboard paste, downloaded file). */
  async importBytes(
    bytes: Uint8Array,
    opts: { name?: string; mime?: string; source: MediaSource; saved: boolean }
  ): Promise<MediaItem> {
    const sniffed = sniffMime(bytes)
    const mime = sniffed ?? opts.mime ?? 'application/octet-stream'
    if (mime === 'text/html') throw new UserError('That link is a web page, not an image')
    if (mime === 'image/heic')
      throw new UserError('HEIC photos are not supported yet. Export the photo as JPEG.')
    const ext = extForMime(mime)
    const kind: MediaKind | null = kindForExt(ext)
    if (!kind || kind === 'deck') throw new UserError("That file isn't an image, video or PDF Cue can show")
    const hash = fingerprint(bytes)
    const item = await this.once(hash, () => this.writeIn(bytes, mime, kind, ext, hash, opts))
    return opts.saved && !item.saved ? (this.library.update(item.id, { saved: true }) ?? item) : item
  }

  private async writeIn(
    bytes: Uint8Array,
    mime: string,
    kind: MediaKind,
    ext: string,
    hash: string,
    opts: { name?: string; source: MediaSource; saved: boolean }
  ): Promise<MediaItem> {
    const id = newId()
    const dir = this.library.itemDir(id)
    await mkdir(dir, { recursive: true })
    const base = safeFileName(opts.name ? opts.name.replace(/\.[a-z0-9]{1,5}$/i, '') : kind, kind).slice(
      0,
      80
    )
    const fileName = `${base}.${ext}`
    await writeFile(join(dir, fileName), bytes)
    const item = this.library.add(
      newItem({
        id,
        kind,
        name: opts.name ? prettyName(opts.name) : defaultName(opts.source, kind),
        file: fileName,
        mime,
        bytes: bytes.byteLength,
        hash,
        source: opts.source,
        saved: opts.saved,
        // Images and videos can be shown right away; probing only adds metadata.
        status: kind === 'pdf' ? 'processing' : 'ready'
      })
    )
    this.processor.enqueue(id)
    return item
  }
}

export function newItem(
  fields: Partial<MediaItem> & Pick<MediaItem, 'id' | 'kind' | 'name' | 'source'>
): MediaItem {
  const now = Date.now()
  return {
    status: 'processing',
    saved: true,
    favorite: false,
    collections: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    showCount: 0,
    ...fields
  }
}

function defaultName(source: MediaSource, kind: MediaKind): string {
  if (source.title) return source.title.slice(0, 120)
  if (source.url) {
    try {
      const u = new URL(source.url)
      const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '')
      if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return prettyName(last).slice(0, 120)
      return u.hostname.replace(/^www\./, '')
    } catch {
      /* fall through */
    }
  }
  if (source.type === 'paste') return `Pasted ${kind}`
  return kind === 'image' ? 'Image' : kind === 'video' ? 'Video' : 'Media'
}

async function collect(
  path: string,
  depth: number,
  out: string[],
  skipped: ImportResult['skipped']
): Promise<void> {
  let info
  try {
    info = await stat(path)
  } catch {
    skipped.push({ path, reason: 'File not found' })
    return
  }
  if (info.isDirectory()) {
    if (depth >= MAX_DEPTH) return
    const entries = await readdir(path)
    for (const name of entries.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      if (name.startsWith('.')) continue
      await collect(join(path, name), depth + 1, out, skipped)
    }
    return
  }
  const ext = extOf(path)
  if (kindForExt(ext)) out.push(path)
  else if (SLIDESHOW_EXTENSIONS.includes(ext)) {
    skipped.push({
      path,
      reason: 'Export this presentation to PDF (File → Export → PDF), then import the PDF'
    })
  } else if (depth === 0) skipped.push({ path, reason: 'Unsupported file type' })
}

const CHUNK = 4 * 1024 * 1024

/** Same fingerprint as `quickHash`, for bytes already in memory. */
export function fingerprint(bytes: Uint8Array): string {
  const size = bytes.byteLength
  const hash = createHash('sha1').update(String(size))
  hash.update(bytes.subarray(0, Math.min(CHUNK, size)))
  if (size > CHUNK * 2) hash.update(bytes.subarray(size - CHUNK))
  else if (size > CHUNK) hash.update(bytes.subarray(CHUNK))
  return hash.digest('hex')
}

/** Fast content fingerprint: size + first and last 4 MB. Enough to spot re-imports of the same file. */
async function quickHash(path: string, size: number): Promise<string> {
  const hash = createHash('sha1').update(String(size))
  const fh = await open(path, 'r')
  try {
    const head = Buffer.alloc(Math.min(CHUNK, size))
    await fh.read(head, 0, head.length, 0)
    hash.update(head)
    if (size > CHUNK * 2) {
      const tail = Buffer.alloc(CHUNK)
      await fh.read(tail, 0, CHUNK, size - CHUNK)
      hash.update(tail)
    } else if (size > CHUNK) {
      const rest = Buffer.alloc(size - CHUNK)
      await fh.read(rest, 0, rest.length, CHUNK)
      hash.update(rest)
    }
  } finally {
    await fh.close()
  }
  return hash.digest('hex')
}
