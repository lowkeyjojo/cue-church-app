import { useLayoutEffect, type RefObject } from 'react'

/**
 * Lets a tab row or segmented control slide one highlight between its options,
 * rather than each option switching its own background on and off.
 *
 * It measures the option matching `selected` and sets --thumb-x/-y/-w/-h on the
 * container, which draws the highlight (see `.thumbHost` in base.css). Until the
 * first measurement the selected option keeps its ordinary background, and the
 * first placement doesn't animate.
 */
export function useSlidingThumb(
  container: RefObject<HTMLElement | null>,
  selected: string,
  /** Changes whenever the selection (or the set of options) does. */
  key: unknown
): void {
  useLayoutEffect(() => {
    const el = container.current
    if (!el) return
    let raf = 0
    const place = () => {
      const on = el.querySelector<HTMLElement>(selected)
      if (!on || !on.offsetWidth) return el.removeAttribute('data-thumb')
      el.style.setProperty('--thumb-x', `${on.offsetLeft}px`)
      el.style.setProperty('--thumb-y', `${on.offsetTop}px`)
      el.style.setProperty('--thumb-w', `${on.offsetWidth}px`)
      el.style.setProperty('--thumb-h', `${on.offsetHeight}px`)
      if (el.hasAttribute('data-thumb')) return
      el.setAttribute('data-thumb', 'placed')
      raf = requestAnimationFrame(() => el.setAttribute('data-thumb', 'ready'))
    }
    place()
    // Labels can collapse or wrap when the window is resized.
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [container, selected, key])
}
