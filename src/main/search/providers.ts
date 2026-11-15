import type { SearchFilters, SearchResponse, SearchResult } from '@shared/types'

/**
 * Native-grid image providers with official, key-free (or user-keyed) APIs.
 * Each returns normalized results including license and attribution data,
 * so Cue can always credit what it shows.
 *
 * `fetcher` is injected so the parsing can be unit-tested without a network.
 */
export type Fetcher = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>

export const USER_AGENT = 'Cue/0.9 (church presentation app; +https://github.com/lowkeyjojo/cue-church-app)'

const PAGE_SIZE = 30

export async function searchWikimedia(
  fetcher: Fetcher,
  query: string,
  page: number
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: String(PAGE_SIZE),
    gsroffset: String((page - 1) * PAGE_SIZE),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '500',
    iiextmetadatafilter: 'LicenseShortName|Artist|ObjectName|LicenseUrl'
  })
  const res = await fetcher(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'Api-User-Agent': USER_AGENT, 'User-Agent': USER_AGENT }
  })
  if (!res.ok) throw httpError('Wikimedia Commons', res.status)
  const json = (await res.json()) as WikimediaResponse
  const pages = [...(json.query?.pages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const results: SearchResult[] = []
  for (const p of pages) {
    const ii = p.imageinfo?.[0]
    if (!ii || !ii.mime?.startsWith('image/') || !ii.thumburl) continue
    const meta = ii.extmetadata ?? {}
    const direct = /^image\/(jpeg|png|gif|webp)$/.test(ii.mime) && (ii.width ?? 0) <= 3840
    // Very large or non-web formats (TIFF, SVG) are fetched as a 1920px rendition instead.
    const url = direct
      ? ii.url!
      : (ii.width ?? 0) > 1920
        ? ii.thumburl.replace(/\/\d+px-/, '/1920px-')
        : ii.thumburl
    results.push({
      id: `wm-${p.pageid}`,
      provider: 'wikimedia',
      kind: 'image',
      thumbUrl: ii.thumburl,
      url,
      pageUrl: ii.descriptionurl,
      width: ii.width,
      height: ii.height,
      title: stripHtml(meta.ObjectName?.value) || p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
      author: stripHtml(meta.Artist?.value) || undefined,
      license: stripHtml(meta.LicenseShortName?.value) || undefined,
      licenseUrl: meta.LicenseUrl?.value,
      mime: ii.mime
    })
  }
  return { results, nextPage: json.continue ? page + 1 : null }
}

export async function searchOpenverse(
  fetcher: Fetcher,
  query: string,
  page: number
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    page_size: String(PAGE_SIZE),
    mature: 'false'
  })
  const res = await fetcher(`https://api.openverse.org/v1/images/?${params}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
  })
  if (res.status === 429)
    throw new Error('Openverse is limiting searches right now. Try again in a minute, or use another source.')
  if (!res.ok) throw httpError('Openverse', res.status)
  const json = (await res.json()) as OpenverseResponse
  const results: SearchResult[] = (json.results ?? []).map((r) => ({
    id: `ov-${r.id}`,
    provider: 'openverse',
    kind: 'image',
    thumbUrl: r.thumbnail || r.url,
    url: r.url,
    pageUrl: r.foreign_landing_url,
    width: r.width ?? undefined,
    height: r.height ?? undefined,
    title: r.title || undefined,
    author: r.creator || undefined,
    license: openverseLicense(r.license, r.license_version),
    licenseUrl: r.license_url || undefined
  }))
  const pageCount = json.page_count ?? 0
  return { results, nextPage: page < pageCount ? page + 1 : null, total: json.result_count }
}

export async function searchPexels(
  fetcher: Fetcher,
  key: string,
  query: string,
  page: number,
  filters: SearchFilters
): Promise<SearchResponse> {
  if (!key) throw new Error('Add a free Pexels API key in Settings → Search to use Pexels.')
  const params = new URLSearchParams({ query, page: String(page), per_page: String(PAGE_SIZE) })
  const video = filters.media === 'video'
  const res = await fetcher(`https://api.pexels.com/${video ? 'videos' : 'v1'}/search?${params}`, {
    headers: { Authorization: key, 'User-Agent': USER_AGENT }
  })
  if (res.status === 401 || res.status === 403)
    throw new Error('Pexels did not accept the API key. Check it in Settings → Search.')
  if (res.status === 429) throw new Error('Pexels search limit reached for now. Try again later.')
  if (!res.ok) throw httpError('Pexels', res.status)
  const json = (await res.json()) as PexelsResponse
  const results: SearchResult[] = video
    ? (json.videos ?? []).flatMap((v) => {
        const file = pickVideoFile(v.video_files ?? [])
        if (!file) return []
        return [
          {
            id: `px-v${v.id}`,
            provider: 'pexels' as const,
            kind: 'video' as const,
            thumbUrl: v.image,
            url: file.link,
            pageUrl: v.url,
            width: file.width ?? v.width,
            height: file.height ?? v.height,
            duration: v.duration,
            title: titleFromPexelsUrl(v.url) || 'Pexels video',
            author: v.user?.name,
            license: 'Pexels License',
            licenseUrl: 'https://www.pexels.com/license/'
          }
        ]
      })
    : (json.photos ?? []).map((p) => ({
        id: `px-${p.id}`,
        provider: 'pexels' as const,
        kind: 'image' as const,
        thumbUrl: p.src.medium,
        url: `${p.src.original.split('?')[0]}?auto=compress&cs=tinysrgb&w=2560`,
        pageUrl: p.url,
        width: p.width,
        height: p.height,
        title: p.alt || titleFromPexelsUrl(p.url) || 'Pexels photo',
        author: p.photographer,
        license: 'Pexels License',
        licenseUrl: 'https://www.pexels.com/license/'
      }))
  return { results, nextPage: json.next_page ? page + 1 : null, total: json.total_results }
}

function pickVideoFile(files: PexelsVideoFile[]): PexelsVideoFile | undefined {
  const mp4 = files.filter((f) => f.file_type === 'video/mp4' && f.link)
  const sized = mp4.filter((f) => (f.width ?? 0) <= 1920).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
  return sized[0] ?? mp4.sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0]
}

function titleFromPexelsUrl(url: string | undefined): string {
  const slug = url?.split('/').filter(Boolean).pop() ?? ''
  return slug
    .replace(/-\d+$/, '')
    .replace(/-/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
}

export function openverseLicense(license?: string, version?: string): string | undefined {
  if (!license) return undefined
  const l = license.toLowerCase()
  if (l === 'cc0') return 'CC0'
  if (l === 'pdm') return 'Public Domain'
  return `CC ${l.toUpperCase()}${version ? ` ${version}` : ''}`
}

export function stripHtml(html: string | undefined): string {
  if (!html) return ''
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function httpError(service: string, status: number): Error {
  return new Error(`${service} search failed (HTTP ${status}). Try again in a moment.`)
}

// --- Response shapes (only the fields Cue uses) ---

interface WikimediaResponse {
  continue?: Record<string, unknown>
  query?: {
    pages?: {
      pageid: number
      title: string
      index?: number
      imageinfo?: {
        url?: string
        thumburl?: string
        descriptionurl?: string
        width?: number
        height?: number
        mime?: string
        extmetadata?: Record<string, { value?: string }>
      }[]
    }[]
  }
}

interface OpenverseResponse {
  result_count?: number
  page_count?: number
  results?: {
    id: string
    title?: string
    url: string
    thumbnail?: string
    width?: number | null
    height?: number | null
    creator?: string
    license?: string
    license_version?: string
    license_url?: string
    foreign_landing_url?: string
  }[]
}

interface PexelsVideoFile {
  file_type?: string
  width?: number
  height?: number
  link: string
}

interface PexelsResponse {
  total_results?: number
  next_page?: string
  photos?: {
    id: number
    width: number
    height: number
    url: string
    alt?: string
    photographer?: string
    src: { original: string; medium: string }
  }[]
  videos?: {
    id: number
    width: number
    height: number
    url: string
    image: string
    duration: number
    user?: { name?: string }
    video_files?: PexelsVideoFile[]
  }[]
}
