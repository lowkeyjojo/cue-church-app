#!/usr/bin/env node
// Draws Cue's app icon: a sage-green tile, softly lit from above, with a
// cream C on it. Writes every file the platforms need:
//   build/icon.icns     macOS app icon
//   build/icon.ico      Windows app and installer icon
//   build/icon.png      1024 px master (Linux packages)
//   resources/icon.png  window icon at runtime (Windows, Linux)
// Shapes are distance fields, so each size is drawn directly, not scaled.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { deflateSync } from 'node:zlib'

const root = join(import.meta.dirname, '..')

// --- colour helpers (sRGB 0..1) -------------------------------------------

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
const SAGE_TOP = hex('#b3c79f')
const SAGE_BOTTOM = hex('#6f8859')
const CREAM = hex('#f6f0e3')

/** Signed distance (in canvas units) to a superellipse "squircle" of half-size a. */
function squircle(u, v, a, n = 5) {
  const x = Math.abs(u) / a
  const y = Math.abs(v) / a
  const f = Math.pow(Math.pow(x, n) + Math.pow(y, n), 1 / n)
  if (f === 0) return -a
  const gx = Math.pow(x, n - 1) * Math.pow(f, 1 - n)
  const gy = Math.pow(y, n - 1) * Math.pow(f, 1 - n)
  return ((f - 1) * a) / Math.max(Math.hypot(gx, gy), 1e-6)
}

/**
 * Render the icon at `size` px. `body` is the tile's half-size as a fraction
 * of the canvas (macOS icons leave a margin for their shadow).
 */
function render(size, { body, shadow }) {
  const out = Buffer.alloc(size * size * 4)
  const px = 2 / size // one pixel in canvas units (canvas spans -1..1)
  const aa = (d) => clamp01(0.5 - d / px) // coverage of a shape from its distance
  // The C: a ring with a slot cut out of its right side. Heavier at small sizes so it survives 16 px.
  const small = size <= 32
  const outer = (small ? 0.64 : 0.58) * body
  const stroke = (small ? 0.3 : 0.25) * body
  const slot = (small ? 0.2 : 0.17) * body

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * px - 1
      const v = (y + 0.5) * px - 1
      // Premultiplied colour, composited bottom to top.
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      const over = (color, alpha) => {
        r = color[0] * alpha + r * (1 - alpha)
        g = color[1] * alpha + g * (1 - alpha)
        b = color[2] * alpha + b * (1 - alpha)
        a = alpha + a * (1 - alpha)
      }

      if (shadow) {
        const ds = squircle(u, v - 0.024, body)
        over([0, 0, 0], 0.42 * (1 - smoothstep(-0.03, 0.06, ds)))
      }

      const d = squircle(u, v, body)
      const inside = aa(d)
      if (inside > 0) {
        // Lit from above: lighter sage at the top, deeper at the bottom.
        over(mix(SAGE_TOP, SAGE_BOTTOM, clamp01((v + body) / (2 * body))), inside)
        const rc = Math.hypot(u, v)
        // Distance to the ring, then to the ring minus the slot on its right.
        const ring = Math.abs(rc - (outer - stroke / 2)) - stroke / 2
        const inSlot = u > 0 ? slot - Math.abs(v) : -1
        const c = Math.max(ring, inSlot)
        over(CREAM, aa(c) * inside)
      }

      const i = (y * size + x) * 4
      out[i] = a > 0 ? Math.round((r / a) * 255) : 0
      out[i + 1] = a > 0 ? Math.round((g / a) * 255) : 0
      out[i + 2] = a > 0 ? Math.round((b / a) * 255) : 0
      out[i + 3] = Math.round(a * 255)
    }
  }
  return encodePng(size, size, out)
}

// --- file formats -----------------------------------------------------------

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(body))
  return Buffer.concat([head, body, tail])
}
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** Windows .ico holding PNG images. */
function encodeIco(images) {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, png }, i) => {
    const e = 6 + i * 16
    header[e] = size >= 256 ? 0 : size
    header[e + 1] = size >= 256 ? 0 : size
    header.writeUInt16LE(1, e + 4) // colour planes
    header.writeUInt16LE(32, e + 6) // bits per pixel
    header.writeUInt32LE(png.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...images.map((i) => i.png)])
}

/** macOS .icns holding PNG images. */
function encodeIcns(entries) {
  const parts = entries.map(({ type, png }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + parts.reduce((n, p) => n + p.length, 0), 4)
  return Buffer.concat([head, ...parts])
}

// --- write everything --------------------------------------------------------

function write(rel, data) {
  const file = join(root, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, data)
  console.log(`${rel}  ${(data.length / 1024).toFixed(1)} KB`)
}

// macOS: the tile sits inside Apple's icon grid (824 of 1024) with a soft shadow.
const mac = (size) => render(size, { body: 824 / 1024, shadow: true })
// Windows and Linux: the tile fills nearly the whole square.
const flat = (size) => render(size, { body: 0.94, shadow: false })

const icns = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32],
  ['ic12', 64],
  ['ic13', 256],
  ['ic14', 512]
]
const macCache = new Map()
const macPng = (size) => macCache.get(size) ?? macCache.set(size, mac(size)).get(size)

write('build/icon.icns', encodeIcns(icns.map(([type, size]) => ({ type, png: macPng(size) }))))
write('build/icon.ico', encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: flat(size) }))))
write('build/icon.png', flat(1024))
write('resources/icon.png', flat(512))
