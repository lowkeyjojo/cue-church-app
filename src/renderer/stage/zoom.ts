import type { Zoom } from '@shared/types'
import { clamp } from '@shared/util'

/**
 * CSS transform for a zoom (with transform-origin 0 0): the normalized point
 * (x, y) of the stage is moved to the center and everything scaled by `scale`.
 */
export function zoomTransform(z: Zoom | undefined): string | undefined {
  if (!z || z.scale <= 1.001) return undefined
  const tx = (0.5 - z.x * z.scale) * 100
  const ty = (0.5 - z.y * z.scale) * 100
  return `translate(${tx}%, ${ty}%) scale(${z.scale})`
}

/** Keep the zoomed view inside the content. */
export function clampZoom(z: Zoom): Zoom {
  const scale = clamp(z.scale, 1, 8)
  const half = 0.5 / scale
  return { scale, x: clamp(z.x, half, 1 - half), y: clamp(z.y, half, 1 - half) }
}

/** Zoom by `factor` around the viewport point (vx, vy) in 0..1, keeping that point fixed. */
export function zoomAround(z: Zoom | undefined, factor: number, vx: number, vy: number): Zoom {
  const cur = z ?? { scale: 1, x: 0.5, y: 0.5 }
  const scale = clamp(cur.scale * factor, 1, 8)
  // Content point under the cursor before zooming...
  const px = cur.x + (vx - 0.5) / cur.scale
  const py = cur.y + (vy - 0.5) / cur.scale
  // ...must stay under the cursor after zooming.
  return clampZoom({ scale, x: px - (vx - 0.5) / scale, y: py - (vy - 0.5) / scale })
}

/** Pan by a viewport-relative delta (dx, dy in 0..1 of the viewport). */
export function panBy(z: Zoom, dx: number, dy: number): Zoom {
  return clampZoom({ ...z, x: z.x - dx / z.scale, y: z.y - dy / z.scale })
}
