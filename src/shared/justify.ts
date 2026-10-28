/** Justified-row image layout (as in Google Images / Flickr): rows of equal height that fill the width. */

export interface JustifyItem {
  aspect: number
}

export interface JustifiedRow<T> {
  items: { item: T; width: number }[]
  height: number
}

export function justify<T extends JustifyItem>(
  items: T[],
  containerWidth: number,
  targetHeight: number,
  gap: number
): JustifiedRow<T>[] {
  const rows: JustifiedRow<T>[] = []
  if (containerWidth <= 0) return rows
  let current: T[] = []
  let aspectSum = 0
  const flush = (last: boolean) => {
    if (!current.length) return
    const available = containerWidth - gap * (current.length - 1)
    let height = available / aspectSum
    // Don't blow up a short final row.
    if (last && height > targetHeight * 1.25) height = targetHeight
    rows.push({ height, items: current.map((item) => ({ item, width: item.aspect * height })) })
    current = []
    aspectSum = 0
  }
  for (const item of items) {
    const aspect =
      Number.isFinite(item.aspect) && item.aspect > 0 ? Math.min(Math.max(item.aspect, 0.35), 4) : 1.5
    current.push({ ...item, aspect })
    aspectSum += aspect
    if (aspectSum * targetHeight + gap * (current.length - 1) >= containerWidth) flush(false)
  }
  flush(true)
  return rows
}
