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

const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'])

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
    // The major brand, then the compatible brands: AVIF files may lead with the generic "mif1".
    const end = Math.min(b.length, new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0))
    const brands = [ascii(8, 4)]
    for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(i, 4))
    if (brands.some((x) => x === 'avif' || x === 'avis')) return 'image/avif'
    if (brands.some((x) => HEIF_BRANDS.has(x))) return 'image/heic'
    if (brands[0] === 'qt  ') return 'video/quicktime'
    if (brands[0].startsWith('M4A')) return 'audio/mp4'
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

/**
 * Width and height of a PNG, JPEG, GIF, WebP or AVIF, read from its header
 * (no decoding). A JPEG's orientation tag is not applied. Null when unreadable.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const b = bytes
  if (b.length < 30) return null
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const ascii = (start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len))
  const size = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null)
  if (b[0] === 0x89 && ascii(1, 3) === 'PNG') return size(view.getUint32(16), view.getUint32(20))
  if (ascii(0, 4) === 'GIF8') return size(view.getUint16(6, true), view.getUint16(8, true))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const format = ascii(12, 4)
    if (format === 'VP8 ') return size(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
    if (format === 'VP8L') {
      const bits = view.getUint32(21, true)
      return size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
    }
    if (format === 'VP8X') {
      const uint24 = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)
      return size(uint24(24) + 1, uint24(27) + 1)
    }
    return null
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    // Walk the segments to the frame header (SOF0…SOF15, which excludes the DHT, JPG and DAC markers).
    for (let i = 2; i + 9 <= b.length;) {
      if (b[i] !== 0xff) return null
      const marker = b[i + 1]
      if (marker === 0xff) i++
      else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) i += 2
      else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return size(view.getUint16(i + 7), view.getUint16(i + 5))
      else i += 2 + view.getUint16(i + 2)
    }
    return null
  }
  if (ascii(4, 4) === 'ftyp') {
    // AVIF: the largest "image spatial extents" property is the picture itself (others are tiles or alpha).
    let best: { width: number; height: number } | null = null
    const end = Math.min(b.length, 256 * 1024) - 16
    for (let i = 8; i <= end; i++) {
      if (b[i] !== 0x69 || b[i + 1] !== 0x73 || b[i + 2] !== 0x70 || b[i + 3] !== 0x65) continue
      const found = size(view.getUint32(i + 8), view.getUint32(i + 12))
      if (found && (!best || found.width * found.height > best.width * best.height)) best = found
    }
    return best
  }
  return null
}

/** Does this GIF / PNG / WebP contain more than one frame? Reads the file's structure, not just its bytes. */
export function isAnimated(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/gif') return gifFrames(bytes, 2) > 1
  if (mime === 'image/png' || mime === 'image/apng') return pngHasChunk(bytes, 'acTL')
  if (mime === 'image/webp') return webpHasChunk(bytes, 'ANIM')
  return false
}

/** Count a GIF's image frames, stopping at `limit`. */
function gifFrames(b: Uint8Array, limit: number): number {
  if (b.length < 13) return 0
  const colorTable = (flags: number) => (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0)
  const skipSubBlocks = (i: number) => {
    while (i < b.length && b[i] !== 0) i += b[i] + 1
    return i + 1
  }
  let i = 13 + colorTable(b[10])
  let frames = 0
  while (i < b.length) {
    if (b[i] === 0x21) {
      // Extension: introducer, label, then data sub-blocks.
      i = skipSubBlocks(i + 2)
    } else if (b[i] === 0x2c) {
      if (++frames >= limit) break
      // Image descriptor, optional local colour table, LZW code size, then image data sub-blocks.
      i = skipSubBlocks(i + 10 + colorTable(b[i + 9]) + 1)
    } else {
      break // trailer (0x3b) or a damaged file
    }
  }
  return frames
}

function pngHasChunk(b: Uint8Array, type: string): boolean {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  for (let i = 8; i + 8 <= b.length;) {
    const name = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7])
    if (name === type) return true
    // The animation control chunk must come before the image data.
    if (name === 'IDAT' || name === 'IEND') return false
    i += 12 + view.getUint32(i)
  }
  return false
}

function webpHasChunk(b: Uint8Array, type: string): boolean {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  for (let i = 12; i + 8 <= b.length;) {
    if (String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]) === type) return true
    const size = view.getUint32(i + 4, true)
    i += 8 + size + (size % 2)
  }
  return false
}

/** A filesystem-safe version of a file name, on every platform. */
export function safeFileName(name: string, fallback = 'file'): string {
  let cleaned = name
    .normalize('NFKD')
    .replace(/[^\w.\- ()]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-120)
    .replace(/[. ]+$/, '')
  // Windows reserves device names, with or without an extension.
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(cleaned)) cleaned = `_${cleaned}`
  return cleaned && !/^\.+$/.test(cleaned) ? cleaned : fallback
}
