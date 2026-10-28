import type { Id, MediaItem } from './types'

export const MEDIA_SCHEME = 'cue-media'

/** URL for a file inside a library item's folder. */
export function mediaUrl(id: Id, file: string, version?: number): string {
  const v = version ? `?v=${version}` : ''
  return `${MEDIA_SCHEME}://media/${encodeURIComponent(id)}/${file.split('/').map(encodeURIComponent).join('/')}${v}`
}

export function thumbUrl(item: Pick<MediaItem, 'id' | 'thumb' | 'updatedAt'>): string | undefined {
  return item.thumb ? mediaUrl(item.id, item.thumb, item.updatedAt) : undefined
}

/** File name of a rendered PDF page (1-based). */
export function pageFile(n: number, kind: 'page' | 'thumb' = 'page'): string {
  return `pages/${kind === 'page' ? 'p' : 't'}${String(n).padStart(4, '0')}.webp`
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** 0:07, 2:31, 1:02:09 */
export function formatTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

export function domainOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function isHttpUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const u = new URL(value.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Deep-merge plain objects (arrays and primitives replace). */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    out[key] = isPlainObject(out[key]) && isPlainObject(value) ? deepMerge(out[key], value) : value
  }
  return out as T
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array)
}

export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: A | null = null
  return (...args: A) => {
    const now = Date.now()
    const wait = ms - (now - last)
    if (wait <= 0) {
      last = now
      fn(...args)
    } else {
      pending = args
      if (!timer) {
        timer = setTimeout(() => {
          timer = null
          last = Date.now()
          if (pending) fn(...pending)
          pending = null
        }, wait)
      }
    }
  }
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  const debounced = (...args: A) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, ms)
  }
  debounced.flush = (...args: A) => {
    if (timer) clearTimeout(timer)
    timer = null
    fn(...args)
  }
  return debounced
}

/** Natural label for a media kind. */
export function kindLabel(kind: string): string {
  switch (kind) {
    case 'image':
      return 'Image'
    case 'video':
      return 'Video'
    case 'audio':
      return 'Audio'
    case 'pdf':
      return 'PDF'
    case 'deck':
      return 'Slides'
    case 'color':
      return 'Color'
    case 'ambient':
      return 'Ambient'
    default:
      return kind
  }
}

/**
 * A readable name from a file name: "asia-minor_map.jpg" -> "Asia minor map".
 * Hyphens are only treated as separators in slug-like names (no spaces), so
 * "Sermon - Part 1" keeps its dash.
 */
export function prettyName(fileName: string): string {
  let base = fileName.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/_+/g, ' ')
  if (!/\s/.test(base) && base.includes('-')) base = base.replace(/-+/g, ' ')
  base = base.replace(/\s+/g, ' ').trim()
  if (base && base === base.toLowerCase()) base = base[0].toUpperCase() + base.slice(1)
  return base || fileName
}

export function todayIso(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
