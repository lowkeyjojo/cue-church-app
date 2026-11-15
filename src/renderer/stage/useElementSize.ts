import { useCallback, useRef, useState } from 'react'

export interface Size {
  width: number
  height: number
}

/** Track an element's content size with a ResizeObserver (via a callback ref). */
export function useElementSize<T extends HTMLElement>(): [(el: T | null) => void, Size] {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setSize((prev) =>
        prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }
      )
    }
    measure()
    observer.current = new ResizeObserver(measure)
    observer.current.observe(el)
  }, [])
  return [ref, size]
}
