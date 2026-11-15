/**
 * Run `fn` once the browser has drawn what is on screen now, so a CSS
 * transition can start from it (e.g. fading in something just mounted at
 * opacity 0). Returns a cancel function.
 */
export function afterPaint(fn: () => void): () => void {
  let raf = requestAnimationFrame(() => {
    raf = requestAnimationFrame(fn)
  })
  return () => cancelAnimationFrame(raf)
}
