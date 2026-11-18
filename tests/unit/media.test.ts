import { describe, expect, it } from 'vitest'
import { imageSize, isAnimated, parseRange, safeFileName, sniffMime } from '@shared/media'
import { gradientPng } from '../e2e/support/png'

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)))

/** A minimal GIF89a with the given frames' image data (each a list of sub-block payloads). */
function gif(frames: number[][][], extras: number[] = []) {
  const header = bytes('GIF89a', [1, 0, 1, 0, 0x80, 0, 0], [0, 0, 0, 255, 255, 255])
  const body = frames.flatMap((blocks) => [
    ...[0x21, 0xf9, 0x04, 0, 10, 0, 0, 0], // graphic control extension
    ...[0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0], // image descriptor
    2, // LZW minimum code size
    ...blocks.flatMap((b) => [b.length, ...b]),
    0
  ])
  return new Uint8Array([...header, ...extras, ...body, 0x3b])
}

function chunk(type: string, data: number[]) {
  const len = data.length
  return [
    (len >>> 24) & 255,
    (len >>> 16) & 255,
    (len >>> 8) & 255,
    len & 255,
    ...bytes(type),
    ...data,
    0,
    0,
    0,
    0
  ]
}

function png(...chunks: number[][]) {
  return new Uint8Array([...bytes([0x89], 'PNG', [13, 10, 26, 10]), ...chunks.flat()])
}

function webp(...chunks: [string, number[]][]) {
  const body = chunks.flatMap(([type, data]) => [
    ...bytes(type),
    data.length & 255,
    (data.length >>> 8) & 255,
    0,
    0,
    ...data,
    ...(data.length % 2 ? [0] : [])
  ])
  const size = body.length + 4
  return bytes('RIFF', [size & 255, (size >>> 8) & 255, 0, 0], 'WEBP', body)
}

describe('parseRange', () => {
  it('reads the common forms', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
  })

  it('ignores missing or malformed headers and serves the whole file', () => {
    expect(parseRange(undefined, 1000)).toBeNull()
    expect(parseRange('items=0-1', 1000)).toBeNull()
    expect(parseRange('bytes=-', 1000)).toBeNull()
  })

  it('reports ranges past the end as unsatisfiable', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=99999999999999999999-', 1000)).toBe('unsatisfiable')
  })
})

describe('sniffMime', () => {
  const pad = (b: Uint8Array) => new Uint8Array([...b, ...new Array(16).fill(0)])
  it('recognises formats by their content', () => {
    expect(sniffMime(pad(bytes([0xff, 0xd8, 0xff, 0xe0])))).toBe('image/jpeg')
    expect(sniffMime(pad(png()))).toBe('image/png')
    expect(sniffMime(pad(bytes('GIF89a')))).toBe('image/gif')
    expect(sniffMime(webp(['VP8 ', [0, 0, 0, 0]]))).toBe('image/webp')
    expect(sniffMime(pad(bytes('RIFF', [0, 0, 0, 0], 'WAVE')))).toBe('audio/wav')
    expect(sniffMime(pad(bytes('%PDF-1.7')))).toBe('application/pdf')
    expect(sniffMime(pad(bytes([0x1a, 0x45, 0xdf, 0xa3])))).toBe('video/webm')
    expect(sniffMime(pad(bytes([0, 0, 0, 24], 'ftypisom')))).toBe('video/mp4')
    expect(sniffMime(pad(bytes([0, 0, 0, 24], 'ftypqt  ')))).toBe('video/quicktime')
    expect(sniffMime(pad(bytes([0, 0, 0, 24], 'ftypM4A ')))).toBe('audio/mp4')
    expect(sniffMime(pad(bytes('<svg xmlns="http://www.w3.org/2000/svg">')))).toBe('image/svg+xml')
    expect(sniffMime(pad(bytes('<!DOCTYPE html><html>')))).toBe('text/html')
    expect(sniffMime(pad(bytes('hello world, plain text')))).toBeNull()
  })

  it('tells AVIF from HEIC, including AVIF files whose main brand is mif1', () => {
    expect(sniffMime(pad(bytes([0, 0, 0, 24], 'ftypavif', [0, 0, 0, 0], 'mif1')))).toBe('image/avif')
    expect(sniffMime(pad(bytes([0, 0, 0, 24], 'ftypmif1', [0, 0, 0, 0], 'avif')))).toBe('image/avif')
    expect(sniffMime(pad(bytes([0, 0, 0, 24], 'ftypheic', [0, 0, 0, 0], 'mif1')))).toBe('image/heic')
    expect(sniffMime(pad(bytes([0, 0, 0, 24], 'ftypmif1', [0, 0, 0, 0], 'heic')))).toBe('image/heic')
  })
})

describe('imageSize', () => {
  const base64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'))
  const uint16 = (n: number) => [n >> 8, n & 255]
  /** A JPEG's structure up to its frame header: `sof` is the frame marker, `before` the segments ahead of it. */
  const jpeg = (sof: number, width: number, height: number, before: number[] = []) =>
    bytes(
      [0xff, 0xd8],
      [0xff, 0xe0, ...uint16(16)],
      'JFIF',
      new Array(10).fill(0),
      before,
      [0xff, sof, ...uint16(17), 8, ...uint16(height), ...uint16(width), 3],
      new Array(24).fill(0)
    )

  it('reads a PNG and a GIF', () => {
    expect(imageSize(gradientPng(321, 123, [0, 0, 0], [255, 255, 255]))).toEqual({ width: 321, height: 123 })
    expect(imageSize(bytes('GIF89a', [0x41, 0x01, 0x7b, 0x00], new Array(24).fill(0)))).toEqual({
      width: 321,
      height: 123
    })
  })

  it('reads a JPEG, baseline or progressive, past whatever comes before the frame header', () => {
    expect(imageSize(jpeg(0xc0, 1280, 720))).toEqual({ width: 1280, height: 720 })
    expect(imageSize(jpeg(0xc2, 1080, 1350))).toEqual({ width: 1080, height: 1350 })
    // An Exif block, a quantisation table, a Huffman table (0xC4 is not a frame header) and padding.
    const before = [
      ...[0xff, 0xe1, ...uint16(300), ...new Array(298).fill(0xc0)],
      ...[0xff, 0xdb, ...uint16(67), ...new Array(65).fill(1)],
      ...[0xff, 0xc4, ...uint16(31), ...new Array(29).fill(2)],
      0xff
    ]
    expect(imageSize(jpeg(0xc0, 1920, 1080, before))).toEqual({ width: 1920, height: 1080 })
  })

  // Real 321×123 files, as small as an encoder makes them.
  it('reads a WebP: lossy, lossless and extended', () => {
    const lossy =
      'UklGRpIAAABXRUJQVlA4IIYAAABwDACdASpBAXsAPm02mUmkIyKhIEgAgA2JaW7hdrEe3AAAKzeirhBkENVSa7bRcIMghqqTXbaLhBkENVSa7bRcIMghqqTXbaLhBkENVSa7bRcIMghqqTXbaLhBkENVSa7bRcIMghqqTXbaLOAA/v9xs3/+6DLOHB7//ztbDEE8AAAAAAAAAA=='
    const lossless = 'UklGRigAAABXRUJQVlA4TBsAAAAvQIEeAAdQnuLVo/8BBWkbMPVvvzsR/U/uv7IA'
    const extended = 'UklGRsIAAABXRUJQVlA4WAoAAAAQAAAAQAEAegAAQUxQSBUAAAABB1DAiAgoSNuAqX/73Ynof3L/lQUA'
    for (const file of [lossy, lossless, extended])
      expect(imageSize(base64(file))).toEqual({ width: 321, height: 123 })
  })

  it('reads an AVIF', () => {
    const avif =
      'AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAPwAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAABQQAAAHsAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAR21kYXQSAAoKGCGoHpogIaDQgDIvETHh4ZlAgggnlAAAAMIRaNaU+lPlRAd+RD3fAVUScCgIC6WfIHmadmwyyLiIkoA='
    expect(imageSize(base64(avif))).toEqual({ width: 321, height: 123 })
  })

  it('returns null for anything else, and for files cut short', () => {
    expect(imageSize(new Uint8Array(0))).toBeNull()
    expect(imageSize(bytes('<!doctype html><html><head><title>Log in</title></head></html>'))).toBeNull()
    expect(imageSize(bytes('%PDF-1.7', new Array(40).fill(0)))).toBeNull()
    const table = [0xff, 0xdb, ...uint16(67), ...new Array(65).fill(1)]
    expect(imageSize(jpeg(0xc0, 1280, 720, table).subarray(0, 60))).toBeNull()
    expect(imageSize(bytes([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff], new Array(40).fill(0)))).toBeNull()
    expect(imageSize(bytes('GIF89a', new Array(30).fill(0)))).toBeNull()
  })
})

describe('isAnimated', () => {
  it('counts the frames of a GIF', () => {
    expect(isAnimated(gif([[[0x44, 0x01]]]), 'image/gif')).toBe(false)
    expect(isAnimated(gif([[[0x44, 0x01]], [[0x44, 0x01]]]), 'image/gif')).toBe(true)
  })

  it("isn't fooled by image data or comments that look like a frame header", () => {
    expect(isAnimated(gif([[[0x21, 0xf9, 0x04, 0x00, 0x00]]]), 'image/gif')).toBe(false)
    const comment = [0x21, 0xfe, 5, 0x21, 0xf9, 0x04, 0, 0, 0]
    expect(isAnimated(gif([[[0x44, 0x01]]], comment), 'image/gif')).toBe(false)
  })

  it('finds the animation chunk of APNG and animated WebP', () => {
    const ihdr = chunk('IHDR', new Array(13).fill(0))
    expect(isAnimated(png(ihdr, chunk('IDAT', [1, 2, 3]), chunk('IEND', [])), 'image/png')).toBe(false)
    expect(
      isAnimated(png(ihdr, chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]), chunk('IDAT', [1])), 'image/png')
    ).toBe(true)
    // "acTL" inside compressed image data is just data.
    expect(isAnimated(png(ihdr, chunk('IDAT', [...bytes('acTL')])), 'image/png')).toBe(false)
    expect(isAnimated(webp(['VP8 ', [0, 0, 0, 0]]), 'image/webp')).toBe(false)
    expect(
      isAnimated(webp(['VP8X', new Array(10).fill(0)], ['ANIM', [0, 0, 0, 0, 0, 0]]), 'image/webp')
    ).toBe(true)
  })
})

describe('safeFileName', () => {
  it('keeps ordinary names and strips what file systems reject', () => {
    expect(safeFileName('Sunday slides (final).pdf')).toBe('Sunday slides (final).pdf')
    expect(safeFileName('a/b\\c:d*e?.png')).toBe('abcde.png')
    expect(safeFileName('Éfeso.jpg')).toBe('Efeso.jpg')
  })

  it('falls back when nothing usable is left', () => {
    expect(safeFileName('..')).toBe('file')
    expect(safeFileName('////', 'image')).toBe('image')
  })

  it("avoids Windows' reserved device names", () => {
    for (const name of ['con.png', 'NUL.pdf', 'aux', 'com1.jpg', 'LPT9.txt']) {
      const safe = safeFileName(name)
      expect(safe.split('.')[0].toLowerCase()).not.toMatch(/^(con|prn|aux|nul|com\d|lpt\d)$/)
    }
  })
})
