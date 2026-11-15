import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * Shrink text until it fits its box. Sets the CSS variable `--fit` (0.25..1) on
 * the content element and measures synchronously before paint, so long verses
 * never overflow and never flash at the wrong size.
 */
export function useAutoFit(
  box: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  deps: unknown[]
): void {
  const [fontsTick, setFontsTick] = useState(0)

  useLayoutEffect(() => {
    const onFonts = () => setFontsTick((t) => t + 1)
    document.fonts.addEventListener('loadingdone', onFonts)
    return () => document.fonts.removeEventListener('loadingdone', onFonts)
  }, [])

  useLayoutEffect(() => {
    const b = box.current
    const c = content.current
    if (!b || !c) return
    const fits = () => c.scrollHeight <= b.clientHeight + 1 && c.scrollWidth <= b.clientWidth + 1
    const apply = (k: number) => c.style.setProperty('--fit', String(k))
    apply(1)
    if (fits()) return
    let lo = 0.25
    let hi = 1
    let best = 0.25
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2
      apply(mid)
      if (fits()) {
        best = mid
        lo = mid
      } else hi = mid
    }
    apply(best)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, fontsTick])
}
