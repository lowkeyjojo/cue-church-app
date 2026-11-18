/**
 * Finding a better copy of a picked image than Google's thumbnail: the
 * preview image its source page publishes for link cards (`og:image`), or a
 * video's own thumbnail. Pure helpers; the fetching is in the main process.
 */

export interface Size {
  width: number
  height: number
}

/**
 * Sites where a page's preview image is the post's own picture or the video's
 * frame. Anywhere else it is as likely to be a logo or a share banner.
 */
const SOCIAL_SITES = [
  'instagram.com',
  'tiktok.com',
  'facebook.com',
  'x.com',
  'twitter.com',
  'reddit.com',
  'vimeo.com',
  'threads.net',
  'threads.com',
  'linkedin.com'
]

/** One of the social or video sites above, or a subdomain of one (and Pinterest in any country). */
export function isSocialHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (SOCIAL_SITES.some((site) => host === site || host.endsWith(`.${site}`))) return true
  // pinterest.com, pinterest.co.uk, pinterest.de… but not pinterest.com.example.org.
  return /(^|\.)pinterest\.(com?\.)?[a-z]{2,3}$/.test(host)
}

/** The video id from a YouTube watch, short-link, Shorts, live or embed address. */
export function youtubeVideoId(pageUrl: string | undefined): string | null {
  if (!pageUrl) return null
  let url: URL
  try {
    url = new URL(pageUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  let id: string | null | undefined
  if (host === 'youtu.be') id = url.pathname.split('/')[1]
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    id =
      url.pathname === '/watch'
        ? url.searchParams.get('v')
        : /^\/(?:shorts|embed|live|v)\/([^/]+)/.exec(url.pathname)?.[1]
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null
}

/**
 * A YouTube video's own thumbnails, largest first. Not every size exists for
 * every video (a missing one answers 404 with a 120×90 placeholder), and the
 * 4:3 ones are letterboxed, so each still has to pass `fitsThumbnail`.
 */
export function youtubeThumbnails(pageUrl: string | undefined): string[] {
  const id = youtubeVideoId(pageUrl)
  if (!id) return []
  const names = ['maxresdefault', 'hq720', 'hqdefault']
  // Shorts are upright; this one keeps the video's own shape.
  if (/\/shorts\//.test(pageUrl ?? '')) names.unshift('oardefault')
  return names.map((name) => `https://i.ytimg.com/vi/${id}/${name}.jpg`)
}

/** YouTube's "no such thumbnail" picture is 120×90; nothing that small is worth showing. */
const PLACEHOLDER: Size = { width: 120, height: 90 }
/** How far a candidate's shape may differ from the thumbnail's and still be the same picture. */
const ASPECT_TOLERANCE = 0.15

/**
 * Is `image` plausibly the picture the operator clicked, of which `thumb` is
 * Google's thumbnail? It must have the same shape (a page's preview image can
 * be a different crop, or a different picture altogether) and be no smaller.
 */
export function fitsThumbnail(image: Size, thumb: Size): boolean {
  const all = [image.width, image.height, thumb.width, thumb.height]
  if (!all.every((n) => Number.isFinite(n) && n > 0)) return false
  if (image.width <= PLACEHOLDER.width || image.height <= PLACEHOLDER.height) return false
  const ratio = image.width / image.height / (thumb.width / thumb.height)
  if (ratio > 1 + ASPECT_TOLERANCE || ratio < 1 / (1 + ASPECT_TOLERANCE)) return false
  return image.width * image.height >= thumb.width * thumb.height
}

/**
 * A named host on the public internet: not an IP address, not this computer,
 * not a name that only resolves inside a local network.
 */
export function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  // IPv6 literals keep their brackets in URL.hostname; IPv4 ones are normalised to four numbers.
  if (!host || host.includes(':') || host.startsWith('[') || /^[\d.]+$/.test(host)) return false
  if (!host.includes('.')) return false
  return !/(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|home\.arpa)$/.test(host)
}

export function isPublicHttps(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && isPublicHost(url.hostname)
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (whole, body: string) => {
    if (body[0] !== '#') return ENTITIES[body.toLowerCase()] ?? whole
    const code =
      body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

const SPACE = /\s/
/** No real <meta> tag is longer; a cap keeps a page that never closes one from being read over and over. */
const MAX_TAG = 8192

/**
 * Attributes of the tag whose name ends at `from`: lower-cased names,
 * entity-decoded values. Null when the tag never closes (the page was cut
 * off mid-tag, so its last value may be too).
 */
function readAttributes(html: string, from: number): Record<string, string> | null {
  const attrs: Record<string, string> = {}
  const end = Math.min(html.length, from + MAX_TAG)
  let i = from
  while (i < end) {
    while (i < end && (SPACE.test(html[i]) || html[i] === '/')) i++
    if (i >= end) break
    if (html[i] === '>') return attrs
    let start = i
    while (i < end && !SPACE.test(html[i]) && html[i] !== '=' && html[i] !== '>') i++
    const name = html.slice(start, i).toLowerCase()
    while (i < end && SPACE.test(html[i])) i++
    let value = ''
    if (html[i] === '=') {
      i++
      while (i < end && SPACE.test(html[i])) i++
      const quote = html[i]
      if (quote === '"' || quote === "'") {
        start = ++i
        while (i < end && html[i] !== quote) i++
        value = html.slice(start, i)
        i++
      } else {
        start = i
        while (i < end && !SPACE.test(html[i]) && html[i] !== '>') i++
        value = html.slice(start, i)
      }
    }
    if (name && !(name in attrs)) attrs[name] = decodeEntities(value)
  }
  return null
}

/** Which <meta> names carry a page's preview image, best first. */
const IMAGE_KEYS = ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']

/**
 * The preview images a page names in its <meta> tags, best first, as absolute
 * addresses. Only ones `allow` accepts are returned: by default https on a
 * public host.
 */
export function previewImagesIn(
  html: string,
  pageUrl: string,
  allow: (url: URL) => boolean = isPublicHttps
): string[] {
  const found: { rank: number; url: string }[] = []
  const lower = html.toLowerCase()
  for (let at = lower.indexOf('<meta'); at !== -1; at = lower.indexOf('<meta', at + 5)) {
    const after = html[at + 5]
    if (after !== undefined && !SPACE.test(after) && after !== '/') continue
    const attrs = readAttributes(html, at + 5)
    if (!attrs) continue
    const rank = IMAGE_KEYS.indexOf((attrs.property ?? attrs.name ?? '').trim().toLowerCase())
    const content = attrs.content?.trim()
    if (rank === -1 || !content) continue
    try {
      const url = new URL(content, pageUrl)
      if (allow(url) && !found.some((f) => f.url === url.href)) found.push({ rank, url: url.href })
    } catch {
      /* not an address */
    }
  }
  // A stable sort: pages that list several images put the main one first.
  return found.sort((a, b) => a.rank - b.rank).map((f) => f.url)
}
