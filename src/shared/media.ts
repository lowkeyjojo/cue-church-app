/** Pure media helpers shared by main and tests: file types, MIME types, byte ranges, sniffing. */
import type { MediaKind } from './types'

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  apng: 'image/apng',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  map: 'application/json',
  woff2: 'font/woff2',
  woff: 'font/woff',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json',
  wasm: 'application/wasm',
  bcmap: 'application/octet-stream',
  pfb: 'application/octet-stream',
  ttf: 'font/ttf',
  icc: 'application/octet-stream'
}

const KIND_BY_EXT: Record<string, MediaKind> = {
  jpg: 'image',
  jpeg: 'image',
  jfif: 'image',
  png: 'image',
  apng: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  ico: 'image',
  svg: 'image',
  mp4: 'video',
  m4v: 'video',
  mov: 'video',
  webm: 'video',
  ogv: 'video',
  mkv: 'video',
  mp3: 'audio',
  m4a: 'audio',
  aac: 'audio',
  wav: 'audio',
  ogg: 'audio',
  oga: 'audio',
  opus: 'audio',
  flac: 'audio',
  pdf: 'pdf'
}

/** Presentation formats we can't open directly but can explain how to bring in. */
export const SLIDESHOW_EXTENSIONS = ['ppt', 'pptx', 'key', 'odp']

export function extOf(name: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name.split(/[?#]/)[0])
  return m ? m[1].toLowerCase() : ''
}

export function mimeForExt(ext: string): string {
  return MIME[ext.toLowerCase()] ?? 'application/octet-stream'
}

export function kindForExt(ext: string): MediaKind | null {
  return KIND_BY_EXT[ext.toLowerCase()] ?? null
}

export function extForMime(mime: string): string {
  const m = mime.toLowerCase().split(';')[0].trim()
  const special: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a'
  }
  if (special[m]) return special[m]
  const found = Object.entries(MIME).find(([, v]) => v === m)
  return found ? found[0] : m.split('/')[1]?.replace(/[^a-z0-9]/g, '') || 'bin'
}

export interface ByteRange {
  start: number
  end: number
}

/**
 * Parse an HTTP Range header for a resource of `size` bytes.
 * Returns null for "no range / ignore", or 'unsatisfiable' for a 416.
 */
export function parseRange(
  header: string | null | undefined,
  size: number
): ByteRange | null | 'unsatisfiable' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)(?:,.*)?$/.exec(header.trim())
  if (!m) return null
  const [, a, b] = m
  if (a === '' && b === '') return null
  let start: number
  let end: number
  if (a === '') {
    const suffix = Number(b)
    if (suffix === 0) return 'unsatisfiable'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(a)
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1)
  }
  if (start >= size || start > end) return 'unsatisfiable'
  return { start, end }
}

/** Identify common image/video/pdf formats from their first bytes. */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes
  const ascii = (start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len))
  if (b.length < 12) return null
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && ascii(1, 3) === 'PNG') return 'image/png'
  if (ascii(0, 4) === 'GIF8') return 'image/gif'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'audio/wav'
  if (ascii(0, 2) === 'BM') return 'image/bmp'
  if (ascii(0, 4) === '%PDF') return 'application/pdf'
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm'
  if (ascii(0, 4) === 'OggS') return 'audio/ogg'
  if (ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg'
  if (ascii(0, 4) === 'fLaC') return 'audio/flac'
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon'
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4)
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'heim') return 'image/heic'
    if (brand === 'qt  ') return 'video/quicktime'
    if (brand.startsWith('M4A')) return 'audio/mp4'
    return 'video/mp4'
  }
  const head = new TextDecoder()
    .decode(b.subarray(0, Math.min(b.length, 512)))
    .trimStart()
    .toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml'
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'text/html'
  return null
}

/** Does this GIF / PNG / WebP contain more than one frame? */
export function isAnimated(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/gif') {
    // Count Graphic Control Extensions (0x21 0xF9 0x04); two or more means animation.
    let count = 0
    for (let i = 0; i < bytes.length - 3; i++) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) {
        if (++count > 1) return true
        i += 7
      }
    }
    return false
  }
  if (mime === 'image/png' || mime === 'image/apng') {
    return indexOfAscii(bytes, 'acTL', 8, 4096) !== -1
  }
  if (mime === 'image/webp') {
    return indexOfAscii(bytes, 'ANIM', 12, 4096) !== -1
  }
  return false
}

function indexOfAscii(bytes: Uint8Array, needle: string, from: number, limit: number): number {
  const end = Math.min(bytes.length - needle.length, from + limit)
  outer: for (let i = from; i <= end; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle.charCodeAt(j)) continue outer
    return i
  }
  return -1
}

/** A filesystem-safe version of a file name. */
export function safeFileName(name: string, fallback = 'file'): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w.\- ()]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-120)
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : fallback
}
