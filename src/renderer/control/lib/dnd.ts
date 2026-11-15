import { useEffect, useState } from 'react'
import type { Id, MediaItem, WebPick } from '@shared/types'
import { isHttpUrl } from '@shared/util'
import { bridge, call, cleanError } from './api'
import { importPaths, previewMedia } from './planActions'
import { toast } from './toasts'
import { useUI } from './ui'

export const DRAG_MEDIA = 'application/x-cue-media'
export const DRAG_ENTRY = 'application/x-cue-entry'
export const DRAG_PICK = 'application/x-cue-pick'

export function setMediaDrag(e: React.DragEvent, ids: Id[]): void {
  e.dataTransfer.setData(DRAG_MEDIA, JSON.stringify(ids))
  e.dataTransfer.effectAllowed = 'copy'
}

export function readMediaDrag(dt: DataTransfer): Id[] | null {
  const raw = dt.getData(DRAG_MEDIA)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Id[]
  } catch {
    return null
  }
}

export function setPickDrag(e: React.DragEvent, pick: WebPick): void {
  e.dataTransfer.setData(DRAG_PICK, JSON.stringify(pick))
  e.dataTransfer.setData('text/uri-list', pick.url)
  e.dataTransfer.effectAllowed = 'copy'
}

export function hasDragType(dt: DataTransfer, ...types: string[]): boolean {
  return types.some((t) => dt.types.includes(t))
}

/** An image dragged from a web page (e.g. the Google pane) or another browser. */
export function readWebDrop(dt: DataTransfer): WebPick | null {
  const pick = dt.getData(DRAG_PICK)
  if (pick) {
    try {
      return JSON.parse(pick) as WebPick
    } catch {
      /* fall through */
    }
  }
  const html = dt.getData('text/html')
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const img = doc.querySelector('img')
    const src = img?.getAttribute('src')
    if (src && (isHttpUrl(src) || src.startsWith('data:image/'))) {
      const link = doc.querySelector('a')?.getAttribute('href') ?? undefined
      return {
        url: src,
        pageUrl: link && isHttpUrl(link) ? link : undefined,
        title: img?.getAttribute('alt') || undefined
      }
    }
  }
  const uri = (dt.getData('text/uri-list') || dt.getData('text/plain'))
    .split('\n')
    .find((l) => l.trim() && !l.startsWith('#'))
  if (uri && isHttpUrl(uri.trim())) return { url: uri.trim() }
  return null
}

/** Paths of local files in a drop. */
export function droppedPaths(dt: DataTransfer): string[] {
  return Array.from(dt.files)
    .map((f) => bridge.pathForFile(f))
    .filter(Boolean)
}

/** Bring a web image into the cache and return it (does not preview). */
export async function ingestPick(pick: WebPick, opts: { save?: boolean } = {}): Promise<MediaItem | null> {
  useUI.getState().setSearch({ busy: true })
  try {
    return await call('library:importWeb', pick, opts)
  } catch (err) {
    toast.error("Couldn't bring in that image", cleanError(err))
    return null
  } finally {
    useUI.getState().setSearch({ busy: false })
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return (
    t.isContentEditable ||
    t.tagName === 'TEXTAREA' ||
    (t.tagName === 'INPUT' &&
      !['checkbox', 'radio', 'range', 'button'].includes((t as HTMLInputElement).type))
  )
}

/**
 * Paste anywhere (outside text fields):
 * an image → Preview; an image link → Preview; a web page link → opens in the
 * browser pane; plain text → a quick text slide.
 */
export function usePaste(): void {
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (isTypingTarget(e.target) || !e.clipboardData) return
      const dt = e.clipboardData
      const file = Array.from(dt.files).find((f) => /^(image|video)\//.test(f.type))
      if (file) {
        e.preventDefault()
        try {
          const bytes = new Uint8Array(await file.arrayBuffer())
          const item = await call('library:importData', bytes, file.name || 'Pasted image', file.type)
          previewMedia(item.id)
        } catch (err) {
          toast.error("Couldn't paste that", cleanError(err))
        }
        return
      }
      const text = dt.getData('text/plain').trim()
      if (!text) return
      e.preventDefault()
      if (isHttpUrl(text)) {
        try {
          const item = await call('library:importWeb', { url: text })
          previewMedia(item.id)
        } catch {
          // Not an image: open the page in the browser pane instead.
          useUI.getState().setSearch({ provider: 'google' })
          useUI.getState().setTab('search')
          window.dispatchEvent(new CustomEvent('cue:browse', { detail: text }))
        }
        return
      }
      useUI.getState().open('quickSlide', { text })
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])
}

/** Files dragged from the desktop onto the window import into the library. */
export function useFileDrop(): boolean {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const isFiles = (e: DragEvent) => !!e.dataTransfer && e.dataTransfer.types.includes('Files')
    const enter = (e: DragEvent) => {
      if (!isFiles(e)) return
      depth++
      setOver(true)
    }
    const leave = (e: DragEvent) => {
      if (!isFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setOver(false)
    }
    const overHandler = (e: DragEvent) => {
      // Always prevent the default, or Electron would navigate to the dropped file.
      e.preventDefault()
    }
    // Capture phase: always clear the overlay, even if a drop zone claims the drop.
    const reset = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setOver(false)
    }
    // Bubble phase: only reached when no specific drop zone claimed the files.
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer || !isFiles(e)) return
      const paths = droppedPaths(e.dataTransfer)
      if (paths.length) void importPaths(paths)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overHandler)
    window.addEventListener('drop', reset, true)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overHandler)
      window.removeEventListener('drop', reset, true)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return over
}

/** Mark a drop as handled by a specific drop zone so the window-level importer skips it. */
export function claimDrop(e: React.DragEvent): void {
  e.preventDefault()
  e.stopPropagation()
}
