import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImageProbe, VideoProbe, WorkerReply } from '@shared/ipc'
import { isAnimated } from '@shared/media'
import type { Id, MediaItem } from '@shared/types'
import { mediaUrl, pageFile } from '@shared/util'
import { errorMessage, log } from '../log'
import type { LibraryStore } from '../store/library'
import type { SettingsStore } from '../store/settings'
import type { MediaWorker } from './worker'

const THUMB = 480

/**
 * Turns freshly imported files into presentable library items: dimensions,
 * durations, thumbnails and pre-rendered PDF pages. Work is queued per item and
 * survives restarts (unfinished items are picked up again at launch).
 */
export class MediaProcessor {
  private active = new Set<Id>()

  constructor(
    private library: LibraryStore,
    private worker: MediaWorker,
    private settings: SettingsStore
  ) {}

  /** Resume anything left half-done by a previous session. */
  resumePending(): void {
    for (const item of this.library.all()) {
      if (
        item.status === 'processing' ||
        (item.kind !== 'deck' && item.status === 'ready' && !item.thumb && item.kind !== 'audio')
      ) {
        this.enqueue(item.id)
      }
    }
  }

  enqueue(id: Id): void {
    if (this.active.has(id)) return
    this.active.add(id)
    void this.process(id).finally(() => this.active.delete(id))
  }

  private async process(id: Id): Promise<void> {
    const item = this.library.get(id)
    if (!item || !item.file) return
    const src = mediaUrl(item.id, item.file)
    try {
      switch (item.kind) {
        case 'image':
          await this.processImage(item, src)
          break
        case 'video':
          await this.processVideo(item, src)
          break
        case 'audio':
          await this.processAudio(item, src)
          break
        case 'pdf':
          await this.processPdf(item, src)
          break
      }
    } catch (err) {
      const message = friendlyError(item, errorMessage(err))
      log.warn(`Processing ${item.kind} "${item.name}" failed:`, errorMessage(err))
      this.library.update(id, { status: 'error', error: message })
    }
  }

  private async processImage(item: MediaItem, src: string): Promise<void> {
    const probe = await this.worker.run<ImageProbe>(
      { type: 'image', src, thumbSize: THUMB },
      { timeoutMs: 30_000 }
    )
    await this.writeFile(item.id, 'thumb.webp', probe.thumb)
    let animated = item.animated
    if (animated === undefined && item.mime && /gif|png|webp/.test(item.mime)) {
      const bytes = await readFile(this.library.filePath(item))
      animated = isAnimated(bytes, item.mime)
    }
    this.library.update(item.id, {
      width: probe.width,
      height: probe.height,
      thumb: 'thumb.webp',
      animated,
      status: 'ready',
      error: undefined
    })
  }

  private async processVideo(item: MediaItem, src: string): Promise<void> {
    const probe = await this.worker.run<VideoProbe>(
      { type: 'video', src, thumbSize: THUMB },
      { timeoutMs: 45_000 }
    )
    if (!probe.width) {
      // An audio-only file in a video container (e.g. .mp4 / .webm music).
      this.library.update(item.id, {
        kind: 'audio',
        duration: probe.duration,
        status: 'ready',
        error: undefined
      })
      return
    }
    await this.writeFile(item.id, 'thumb.webp', probe.thumb)
    this.library.update(item.id, {
      width: probe.width,
      height: probe.height,
      duration: probe.duration,
      thumb: 'thumb.webp',
      status: 'ready',
      error: undefined
    })
  }

  private async processAudio(item: MediaItem, src: string): Promise<void> {
    const probe = await this.worker.run<{ duration: number }>({ type: 'audio', src }, { timeoutMs: 30_000 })
    this.library.update(item.id, { duration: probe.duration, status: 'ready', error: undefined })
  }

  private async processPdf(item: MediaItem, src: string): Promise<void> {
    const quality = this.settings.data.slides.renderQuality
    const maxHeight = quality
    const maxWidth = Math.round((quality * 16) / 9)
    const fromPage = Math.max(1, (item.pagesReady ?? 0) + 1)
    await mkdir(join(this.library.itemDir(item.id), 'pages'), { recursive: true })
    let lastEmit = 0
    let writes = Promise.resolve()

    const onReply = (reply: WorkerReply) => {
      if (reply.kind === 'pdf-meta') {
        this.library.update(item.id, { pageCount: reply.pageCount, width: reply.width, height: reply.height })
        return
      }
      if (reply.kind !== 'pdf-page') return
      const { page, pageCount, image, thumb } = reply
      // Keep page writes in order and never let a slow disk reorder pagesReady.
      writes = writes.then(async () => {
        await this.writeFile(item.id, pageFile(page, 'page'), image)
        await this.writeFile(item.id, pageFile(page, 'thumb'), thumb)
        const now = Date.now()
        const patch: Partial<MediaItem> = { pagesReady: page, pageCount }
        if (page === 1) patch.thumb = pageFile(1, 'thumb')
        // Throttle library updates; the UI doesn't need one per page.
        if (page === 1 || page === pageCount || now - lastEmit > 400) {
          lastEmit = now
          this.library.update(item.id, patch)
        }
      })
    }

    const result = await this.worker.run<{ pageCount: number }>(
      { type: 'pdf', src, maxWidth, maxHeight, thumbSize: 360, fromPage },
      { timeoutMs: 60_000, onReply }
    )
    await writes
    this.library.update(item.id, {
      pageCount: result.pageCount,
      pagesReady: result.pageCount,
      thumb: pageFile(1, 'thumb'),
      status: 'ready',
      error: undefined
    })
  }

  private async writeFile(id: Id, name: string, data: Uint8Array): Promise<void> {
    const file = join(this.library.itemDir(id), name)
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, data)
  }
}

function friendlyError(item: MediaItem, raw: string): string {
  if (item.kind === 'video' && /decode|format|supported|MEDIA_ERR/i.test(raw)) {
    return "This video's format can't be played. Convert it to MP4 (H.264) and import it again."
  }
  if (item.kind === 'pdf' && /password/i.test(raw)) return 'This PDF is password protected.'
  if (item.kind === 'pdf') return "This PDF couldn't be read. Try exporting it again."
  if (item.kind === 'image' && /decode|load/i.test(raw)) return "This image format isn't supported."
  return raw
}
