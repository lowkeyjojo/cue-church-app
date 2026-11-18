import type { Session } from 'electron'
import { isPublicHttps, isSocialHost, previewImagesIn, youtubeThumbnails } from '@shared/pagePreview'
import { localUpdateFeed } from '@shared/updates'
import { isE2E } from '../paths'
import { fetchGuarded } from './webFetch'

const PAGE_TIMEOUT_MS = 8000
/** Preview tags are in a page's <head>; this is far more than any head. */
const PAGE_MAX_BYTES = 1.5 * 1024 * 1024

/**
 * Tests only (CUE_E2E): CUE_SOCIAL_BASE names a folder on a server on this
 * computer (http://127.0.0.1:<port>/<path>) whose pages stand in for a social
 * site, and whose server may then serve their preview images.
 */
const standIn = isE2E ? localUpdateFeed(process.env.CUE_SOCIAL_BASE) : null
const standInOrigin = standIn ? new URL(standIn).origin : null

/** A page Cue may ask for its preview image: https, on a known social or video site. */
function isSocialPage(url: URL): boolean {
  if (standIn && url.href.startsWith(`${standIn}/`)) return true
  return isPublicHttps(url) && isSocialHost(url.hostname)
}

/** An address a preview image may be fetched from (or redirect to): https, on a public host. */
export function isPreviewImageUrl(url: URL): boolean {
  if (standInOrigin && url.origin === standInOrigin) return true
  return isPublicHttps(url)
}

export interface PagePreview {
  from: 'video' | 'page'
  /** Candidate images, best first. */
  images: string[]
}

/**
 * The preview images of the page a picked image came from: a YouTube video's
 * own thumbnails, or what a social site's page names in its <meta> tags.
 * Null for every other site, which is not contacted at all: an ordinary
 * website's preview image is often its logo or a banner.
 */
export async function pagePreviewImages(ses: Session, pageUrl: string): Promise<PagePreview | null> {
  const video = youtubeThumbnails(pageUrl)
  if (video.length) return { from: 'video', images: video }
  let url: URL
  try {
    url = new URL(pageUrl)
  } catch {
    return null
  }
  if (!isSocialPage(url)) return null
  const page = await fetchGuarded(ses, url.href, {
    // A redirect has to stay on a social site too (twitter.com to x.com, a login page), or it isn't followed.
    allow: isSocialPage,
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
    timeoutMs: PAGE_TIMEOUT_MS,
    maxBytes: PAGE_MAX_BYTES,
    truncate: true
  })
  const html = new TextDecoder().decode(page.bytes)
  return { from: 'page', images: previewImagesIn(html, page.url, isPreviewImageUrl) }
}
