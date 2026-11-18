/**
 * Runs inside the embedded browser pane (Google Images, or any page the
 * operator navigates to). It watches for the image the operator has opened and
 * tells Cue about it, so it can be previewed and shown in one click.
 *
 * It deliberately does not depend on Google's markup (class names change
 * constantly). Instead it looks for the most prominent image on screen:
 * when you click a result, Google opens a large preview of it, first showing
 * its own low-res thumbnail and then swapping in the original image.
 */
import { ipcRenderer } from 'electron'
import { isGoogleHost as isGoogleSite } from '@shared/google'

interface GuestPick {
  url: string
  thumbUrl?: string
  full: boolean
  pageUrl?: string
  title?: string
  width?: number
  height?: number
  /** Natural size of Google's thumbnail of this image, once the page has loaded it. */
  thumbWidth?: number
  thumbHeight?: number
  x: number
  y: number
}

interface Thumb {
  url: string
  width?: number
  height?: number
}

const MIN_WIDTH = 220
const MIN_HEIGHT = 140
const thumbFor = new WeakMap<HTMLImageElement, Thumb>()
/** The thumbnail last reported as a pick, for layouts that show the original in an element of its own. */
let lastThumb: (Thumb & { alt: string; pageUrl?: string }) | null = null
let lastKey = ''
let scanTimer: ReturnType<typeof setTimeout> | null = null
let lastScan = 0

function isGoogleHost(host: string): boolean {
  return isGoogleSite(host) || host.endsWith('.gstatic.com') || host.endsWith('.googleusercontent.com')
}

function isThumb(url: string): boolean {
  if (url.startsWith('data:') || url.startsWith('blob:')) return true
  try {
    return isGoogleHost(new URL(url).hostname)
  } catch {
    return true
  }
}

function onGoogle(): boolean {
  return isGoogleSite(location.hostname) || location.hostname === '127.0.0.1'
}

function visibleArea(r: DOMRect): number {
  const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0)
  const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)
  return w > 0 && h > 0 ? w * h : 0
}

function isShown(el: Element): boolean {
  const style = getComputedStyle(el)
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.2
}

/** The nearest link to an outside page (the image's source), searching outward from the image. */
function sourcePage(img: HTMLImageElement): { url?: string; title?: string } {
  let node: Element | null = img
  for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
    const links =
      node.tagName === 'A'
        ? [node as HTMLAnchorElement]
        : Array.from(node.querySelectorAll<HTMLAnchorElement>('a[href]'))
    for (const a of links) {
      try {
        const u = new URL(a.href, location.href)
        if ((u.protocol === 'http:' || u.protocol === 'https:') && !isGoogleHost(u.hostname)) {
          const text = (a.getAttribute('aria-label') || a.textContent || '').replace(/\s+/g, ' ').trim()
          return { url: u.href, title: text.slice(0, 140) || undefined }
        }
        // Older Google layouts wrap results in /imgres?imgurl=...&imgrefurl=...
        if (u.pathname === '/imgres' && u.searchParams.get('imgrefurl')) {
          return { url: u.searchParams.get('imgrefurl')! }
        }
      } catch {
        /* ignore malformed hrefs */
      }
    }
  }
  return {}
}

function originalFromLinks(img: HTMLImageElement): string | undefined {
  const a = img.closest('a[href]') as HTMLAnchorElement | null
  if (!a) return undefined
  try {
    const u = new URL(a.href, location.href)
    if (u.pathname === '/imgres') return u.searchParams.get('imgurl') ?? undefined
  } catch {
    /* ignore */
  }
  return undefined
}

function scan(): void {
  lastScan = Date.now()
  const imgs = Array.from(document.images)
  const candidates: { img: HTMLImageElement; rect: DOMRect; area: number }[] = []
  for (const img of imgs) {
    const src = img.currentSrc || img.src
    if (!src) continue
    const rect = img.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 40) continue
    const area = visibleArea(rect)
    if (area > 0) candidates.push({ img, rect, area })
  }
  candidates.sort((a, b) => b.area - a.area)
  const top = candidates.find(
    (c) => c.rect.width >= MIN_WIDTH && c.rect.height >= MIN_HEIGHT && isShown(c.img)
  )
  let pick: GuestPick | null = null

  if (top) {
    const areas = candidates.map((c) => c.area).sort((a, b) => a - b)
    const median = areas[Math.floor(areas.length / 2)] ?? 0
    // Prominent = clearly bigger than the typical result tile (or the page's main image elsewhere).
    const prominent = onGoogle()
      ? top.area >= median * 2.2 && top.rect.width >= 260
      : top.rect.width >= Math.max(300, innerWidth * 0.25)
    if (prominent) pick = describe(top.img, top.rect)
  }

  // The thumbnail's size is part of the key so that it is sent on once the thumbnail has loaded.
  const key = pick ? `${pick.url}|${pick.full}|${pick.thumbWidth ?? 0}` : ''
  if (key === lastKey) return
  lastKey = key
  ipcRenderer.sendToHost('cue:pick', pick)
}

function describe(img: HTMLImageElement, rect: DOMRect): GuestPick {
  const src = img.currentSrc || img.src
  const linked = originalFromLinks(img)
  const page = sourcePage(img)
  const loaded = img.complete && img.naturalWidth > 0
  let url = src
  let thumb: Thumb | undefined
  let full = !isThumb(src)
  if (!full) {
    thumb = {
      url: src,
      width: loaded ? img.naturalWidth : undefined,
      height: loaded ? img.naturalHeight : undefined
    }
    thumbFor.set(img, thumb)
    lastThumb = { ...thumb, alt: img.alt, pageUrl: page.url }
    if (linked) {
      url = linked
      full = true
    }
  } else {
    // The element that showed the thumbnail, or the one Google shows the original in beside it.
    const sameResult = !!lastThumb?.pageUrl && lastThumb.pageUrl === page.url && lastThumb.alt === img.alt
    thumb = thumbFor.get(img) ?? (sameResult ? lastThumb! : undefined)
  }
  return {
    url,
    thumbUrl: full ? thumb?.url : undefined,
    thumbWidth: thumb?.width,
    thumbHeight: thumb?.height,
    full,
    pageUrl: page.url,
    title:
      (img.alt || page.title || document.title || '').replace(/\s+/g, ' ').trim().slice(0, 140) || undefined,
    width: loaded && full && url === src ? img.naturalWidth : undefined,
    height: loaded && full && url === src ? img.naturalHeight : undefined,
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2)
  }
}

/** Throttled scan: at most every 200 ms, always ending with a final scan. */
function schedule(delay = 120): void {
  if (scanTimer) clearTimeout(scanTimer)
  const since = Date.now() - lastScan
  scanTimer = setTimeout(scan, Math.max(delay, 200 - since))
}

function start(): void {
  // Clicking a result opens Google's preview; the original arrives a moment later.
  document.addEventListener(
    'click',
    () => {
      for (const t of [150, 600, 1500, 3000]) setTimeout(scan, t)
    },
    true
  )
  // A thumbnail's size is known once it has loaded (load events don't bubble, hence capture).
  document.addEventListener('load', (e) => e.target instanceof HTMLImageElement && schedule(), true)
  document.addEventListener('keyup', () => schedule(250), true)
  addEventListener('resize', () => schedule(300))
  addEventListener('popstate', () => schedule(300))
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes' && r.target instanceof HTMLImageElement) {
        schedule()
        return
      }
      if (r.type === 'childList' && r.addedNodes.length) {
        schedule(300)
        return
      }
    }
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src', 'srcset']
  })
  ipcRenderer.on('cue:scan', () => {
    lastKey = ''
    scan()
  })
  ipcRenderer.on('cue:locate', (_e, url: string) => ipcRenderer.sendToHost('cue:located', locate(url)))
  schedule(500)
}

/**
 * Where the image showing `url` is on screen right now (it may have moved
 * since it was picked): a point that hits the image itself rather than
 * anything layered over it, plus its natural size.
 */
function locate(url: string): { url: string; x: number; y: number; width: number; height: number } | null {
  const img = Array.from(document.images).find((i) => (i.currentSrc || i.src) === url && i.naturalWidth > 0)
  if (!img) return null
  const r = img.getBoundingClientRect()
  const left = Math.max(r.left, 0)
  const top = Math.max(r.top, 0)
  const right = Math.min(r.right, innerWidth)
  const bottom = Math.min(r.bottom, innerHeight)
  if (right - left < 4 || bottom - top < 4) return null
  for (const [fx, fy] of [
    [0.5, 0.5],
    [0.3, 0.3],
    [0.7, 0.3],
    [0.3, 0.7],
    [0.7, 0.7],
    [0.5, 0.15],
    [0.5, 0.85]
  ]) {
    const x = Math.round(left + (right - left) * fx)
    const y = Math.round(top + (bottom - top) * fy)
    if (document.elementFromPoint(x, y) === img) {
      return { url, x, y, width: img.naturalWidth, height: img.naturalHeight }
    }
  }
  return null
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
else start()
