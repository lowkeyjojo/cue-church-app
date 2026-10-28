import { describe, expect, it } from 'vitest'
import { justify } from '@shared/justify'

describe('justify', () => {
  it('fills full rows exactly to the container width', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i, aspect: i % 2 ? 1.5 : 0.75 }))
    const rows = justify(items, 1000, 180, 8)
    for (const row of rows.slice(0, -1)) {
      const total = row.items.reduce((sum, x) => sum + x.width, 0) + 8 * (row.items.length - 1)
      expect(total).toBeCloseTo(1000, 5)
    }
    expect(rows.flatMap((r) => r.items).length).toBe(10)
  })

  it('does not stretch a short last row', () => {
    const rows = justify([{ aspect: 1 }], 1200, 180, 8)
    expect(rows[0].height).toBe(180)
  })

  it('clamps extreme or missing aspect ratios', () => {
    const rows = justify([{ aspect: 50 }, { aspect: 0 }, { aspect: NaN }], 2000, 100, 0)
    const widths = rows.flatMap((r) => r.items.map((x) => x.width / r.height))
    expect(widths).toEqual([4, 1.5, 1.5])
  })

  it('returns nothing for a zero-width container', () => {
    expect(justify([{ aspect: 1 }], 0, 100, 4)).toEqual([])
  })
})
