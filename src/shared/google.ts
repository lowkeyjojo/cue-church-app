/** Helpers for working with Google Images pages loaded in the embedded browser. */

export const GOOGLE_IMAGES_BASE = 'https://www.google.com/search'

export interface GoogleQueryOptions {
  safeSearch: boolean
  licensedOnly?: boolean
  size?: 'any' | 'large'
  type?: 'any' | 'photo' | 'clipart' | 'lineart' | 'animated'
}

/** Build a Google Images results URL for a query. */
export function googleImagesUrl(query: string, opts: GoogleQueryOptions, base = GOOGLE_IMAGES_BASE): string {
  const params = new URLSearchParams({ q: query, udm: '2' })
  if (opts.safeSearch) params.set('safe', 'active')
  const tbs: string[] = []
  // "Creative Commons licenses" usage-rights filter.
  if (opts.licensedOnly) tbs.push('il:cl')
  if (opts.size === 'large') tbs.push('isz:l')
  if (opts.type && opts.type !== 'any') tbs.push(`itp:${opts.type}`)
  if (tbs.length) params.set('tbs', tbs.join(','))
  return `${base}?${params.toString()}`
}

/** Read the query back out of a Google results URL (to keep Cue's search box in sync). */
export function queryFromGoogleUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (!/(^|\.)google\.[a-z.]+$/.test(u.hostname) && !u.hostname.startsWith('127.0.0.1')) return null
    return u.searchParams.get('q')
  } catch {
    return null
  }
}

/**
 * Google wraps results in links like /imgres?imgurl=<image>&imgrefurl=<page>
 * or /url?q=<target>. Pull the real image and page URLs out of them.
 */
export function parseGoogleLink(link: string | undefined): { imageUrl?: string; pageUrl?: string } {
  if (!link) return {}
  try {
    const u = new URL(link)
    if (!/(^|\.)google\.[a-z.]+$/.test(u.hostname)) return {}
    if (u.pathname === '/imgres') {
      return {
        imageUrl: u.searchParams.get('imgurl') ?? undefined,
        pageUrl: u.searchParams.get('imgrefurl') ?? undefined
      }
    }
    if (u.pathname === '/url') {
      const target = u.searchParams.get('q') ?? u.searchParams.get('url') ?? undefined
      return { pageUrl: target }
    }
  } catch {
    /* not a URL */
  }
  return {}
}

/** Is this an image URL that is only Google's own thumbnail (low resolution)? */
export function isGoogleThumbnail(url: string | undefined): boolean {
  if (!url) return false
  if (url.startsWith('data:')) return true
  try {
    const host = new URL(url).hostname
    return (
      host.endsWith('gstatic.com') ||
      host.endsWith('googleusercontent.com') ||
      /(^|\.)google\.[a-z.]+$/.test(host)
    )
  } catch {
    return false
  }
}
