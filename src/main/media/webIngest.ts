import { clipboard, ClipboardItem, session, webContents } from 'electron'
import type { MediaItem, WebPick } from '@shared/types'
import { log, UserError } from '../log'
import type { LibraryStore } from '../store/library'
import type { Importer } from './importer'

export const WEB_PARTITION = 'persist:web'

const MAX_IMAGE_BYTES = 80 * 1024 * 1024
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024

/**
 * Brings an image the operator picked on the web into the library cache so it
 * can be shown offline-safe from local disk. Requests go through the same
 * browser session as the embedded Google view, with the page as referrer, so
 * sites that guard against hotlinking still hand over the image.
 */
export class WebIngest {
  constructor(
    private importer: Importer,
    private library: LibraryStore
  ) {}

  async ingest(pick: WebPick, opts: { save?: boolean } = {}): Promise<MediaItem> {
    const known = this.library.all().find((i) => i.source.url === pick.url && i.status !== 'error')
    if (known) {
      return opts.save && !known.saved ? (this.library.update(known.id, { saved: true }) ?? known) : known
    }
    const candidates = [pick.url]
    if (pick.thumbUrl && pick.thumbUrl !== pick.url) candidates.push(pick.thumbUrl)
    let lastError: unknown = null
    for (const url of candidates) {
      try {
        const { bytes, mime } = url.startsWith('data:') ? decodeDataUrl(url) : await download(url, pick)
        return await this.importer.importBytes(bytes, {
          mime,
          name: pick.title,
          saved: !!opts.save,
          source: {
            type: 'web',
            // Inline data: URLs can be huge; the bytes themselves are what we keep.
            url: pick.url.startsWith('data:') ? undefined : pick.url,
            pageUrl: pick.pageUrl,
            provider: pick.provider,
            query: pick.query,
            title: pick.title,
            author: pick.author,
            license: pick.license,
            licenseUrl: pick.licenseUrl
          }
        })
      } catch (err) {
        lastError = err
        log.warn(`Web ingest failed for ${url.slice(0, 120)}:`, (err as Error).message)
      }
    }
    throw lastError instanceof Error ? lastError : new UserError("Couldn't download that image")
  }

  /**
   * Fallback for images a site refuses to serve directly: ask the embedded
   * browser, which is already displaying the image, to copy it. `x`/`y` are in
   * the host window's coordinates (how Electron addresses a <webview> page).
   * When the pick carries the image's natural size, anything else that ends
   * up on the clipboard (an overlay, a thumbnail) is rejected rather than shown.
   */
  async copyFromPage(
    contentsId: number,
    x: number,
    y: number,
    pick: WebPick,
    opts: { save?: boolean } = {}
  ): Promise<MediaItem | null> {
    const contents = webContents.fromId(contentsId)
    if (!contents || contents.isDestroyed() || contents.getType() !== 'webview') return null
    const previous = await snapshotClipboard()
    let png: Uint8Array | null = null
    try {
      clipboard.clear()
      contents.copyImageAt(Math.round(x), Math.round(y))
      let hasImage = false
      for (let i = 0; i < 25 && !hasImage; i++) {
        await new Promise((r) => setTimeout(r, 40))
        hasImage = await clipboard.has('image/png')
      }
      const item = hasImage ? (await clipboard.read()).find((i) => i.types.includes('image/png')) : undefined
      if (item) png = new Uint8Array(await ((await item.getType('image/png')) as Blob).arrayBuffer())
    } finally {
      // Put the operator's clipboard back the way it was.
      await restoreClipboard(previous)
    }
    if (!png) return null
    const size = pngSize(png)
    if (pick.width && pick.height && (!size || !matchesSize(size, pick.width, pick.height))) {
      log.warn(`Copied image was ${size?.width}×${size?.height}, expected ${pick.width}×${pick.height}`)
      return null
    }
    return this.importer.importBytes(png, {
      mime: 'image/png',
      name: pick.title,
      saved: !!opts.save,
      source: {
        type: 'web',
        url: pick.url.startsWith('data:') ? undefined : pick.url,
        pageUrl: pick.pageUrl,
        provider: pick.provider,
        query: pick.query,
        title: pick.title
      }
    })
  }
}

/** Width and height from a PNG's header. */
export function pngSize(png: Uint8Array): { width: number; height: number } | null {
  if (png.length < 24 || png[0] !== 0x89 || png[1] !== 0x50) return null
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/**
 * The browser copies an image's full decoded bitmap, which can be larger than
 * its natural size on high-density `srcset` images, but never smaller and
 * never a different shape.
 */
function matchesSize(got: { width: number; height: number }, width: number, height: number): boolean {
  const aspect = got.width / got.height / (width / height)
  return got.width >= width * 0.98 && aspect > 0.97 && aspect < 1.03
}

async function download(
  url: string,
  pick: WebPick
): Promise<{ bytes: Uint8Array; mime: string | undefined }> {
  const ses = session.fromPartition(WEB_PARTITION)
  const headers: Record<string, string> = {
    Accept: 'image/avif,image/webp,image/apng,image/*,video/*;q=0.9,*/*;q=0.5'
  }
  if (pick.pageUrl) headers.Referer = pick.pageUrl
  const res = await ses.fetch(url, { headers, signal: AbortSignal.timeout(45_000), redirect: 'follow' })
  if (!res.ok) throw new UserError(`The website refused to share this image (HTTP ${res.status})`)
  const max = pick.kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > max) throw new UserError('This file is too large to bring in')
  if (!res.body) throw new UserError('The website sent an empty response')
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel()
      throw new UserError('This file is too large to bring in')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.byteLength
  }
  return { bytes, mime: res.headers.get('content-type') ?? undefined }
}

type ClipboardSnapshot = Record<string, Blob | string>[]

/** Copy the clipboard's current contents so they can be put back afterwards. */
async function snapshotClipboard(): Promise<ClipboardSnapshot> {
  const out: ClipboardSnapshot = []
  try {
    for (const item of await clipboard.read()) {
      const entry: Record<string, Blob | string> = {}
      for (const type of item.types) {
        if (type === 'electron application/bookmark') continue
        try {
          const value = await item.getType(type)
          if (value instanceof Blob) entry[type] = value
        } catch {
          /* skip formats we can't read back */
        }
      }
      if (Object.keys(entry).length) out.push(entry)
    }
  } catch {
    /* an unreadable clipboard is simply not restored */
  }
  return out
}

async function restoreClipboard(snapshot: ClipboardSnapshot): Promise<void> {
  try {
    if (!snapshot.length) clipboard.clear()
    else await clipboard.write(snapshot.map((entry) => new ClipboardItem(entry)))
  } catch {
    /* best effort */
  }
}

export function decodeDataUrl(url: string): { bytes: Uint8Array; mime: string | undefined } {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url)
  if (!m) throw new Error('Unreadable image data')
  const [, mime, b64, data] = m
  const bytes = b64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8')
  return { bytes: new Uint8Array(bytes), mime: mime || undefined }
}
