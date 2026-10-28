import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { ExternalLink, Eye, ImageOff, Play, Plus, Star } from 'lucide-react'
import { justify } from '@shared/justify'
import type { SearchFilters, SearchProviderId, SearchResult, WebPick } from '@shared/types'
import { domainOf, formatTime } from '@shared/util'
import { useElementSize } from '../../../stage/useElementSize'
import { attempt, call } from '../../lib/api'
import { ingestPick, setPickDrag } from '../../lib/dnd'
import { addMediaToPlan, previewMedia, showMedia } from '../../lib/planActions'
import { EmptyState, Spinner } from '../../ui/Controls'
import { ContextMenu, type MenuEntry } from '../../ui/Menu'
import s from './SearchView.module.css'

const PROVIDER_INFO: Record<Exclude<SearchProviderId, 'google'>, { name: string; blurb: string }> = {
  wikimedia: {
    name: 'Wikimedia Commons',
    blurb: 'Free, openly licensed photos, maps and historical art. Great for places and Bible lands.'
  },
  openverse: {
    name: 'Openverse',
    blurb: 'Hundreds of millions of Creative Commons images from across the web.'
  },
  pexels: { name: 'Pexels', blurb: 'Beautiful free stock photos and videos — great for backgrounds.' }
}

function toPick(r: SearchResult, query: string): WebPick {
  return {
    url: r.url,
    thumbUrl: r.thumbUrl,
    pageUrl: r.pageUrl,
    title: r.title,
    width: r.width,
    height: r.height,
    provider: r.provider,
    query,
    author: r.author,
    license: r.license,
    licenseUrl: r.licenseUrl,
    kind: r.kind
  }
}

/** Native results grid for providers with an official API. */
export function ResultsGrid({
  provider,
  query,
  filters
}: {
  provider: Exclude<SearchProviderId, 'google'>
  query: string
  filters: SearchFilters
}) {
  const [results, setResults] = useState<SearchResult[]>([])
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [ref, size] = useElementSize<HTMLDivElement>()
  const sentinel = useRef<HTMLDivElement>(null)
  const request = useRef(0)
  const filterKey = `${filters.media}`

  const load = useCallback(
    async (page: number) => {
      const id = ++request.current
      setLoading(true)
      if (page === 1) {
        setError(null)
        setResults([])
      }
      try {
        const res = await call('search:query', provider, query, page, filters)
        if (id !== request.current) return
        if (res.error) setError(res.error)
        setResults((prev) =>
          page === 1 ? res.results : [...prev, ...res.results.filter((r) => !prev.some((p) => p.id === r.id))]
        )
        setNextPage(res.nextPage)
      } catch (err) {
        if (id === request.current) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (id === request.current) setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [provider, query, filterKey]
  )

  useEffect(() => {
    if (query.trim()) void load(1)
    else {
      setResults([])
      setNextPage(null)
      setError(null)
    }
  }, [load, query])

  // Infinite scroll.
  useEffect(() => {
    const el = sentinel.current
    if (!el || !nextPage) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading) void load(nextPage)
      },
      { rootMargin: '600px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [nextPage, loading, load])

  const rows = useMemo(
    () =>
      justify(
        results.map((r) => ({ ...r, aspect: r.width && r.height ? r.width / r.height : 1.5 })),
        Math.max(0, size.width - 4),
        168,
        8
      ),
    [results, size.width]
  )

  const open = async (r: SearchResult, action: 'preview' | 'show' | 'save' | 'plan') => {
    setBusyId(r.id)
    try {
      const item = await ingestPick(toPick(r, query), { save: action === 'save' || action === 'plan' })
      if (!item) return
      if (action === 'preview') previewMedia(item.id)
      else if (action === 'show') showMedia(item.id)
      else if (action === 'plan') await addMediaToPlan([item.id])
      else void attempt('library:update', item.id, { saved: true })
    } finally {
      setBusyId(null)
    }
  }

  const info = PROVIDER_INFO[provider]
  if (!query.trim()) {
    return (
      <div className={s.gridScroll} ref={ref}>
        <EmptyState icon={<Eye />} title={`Search ${info.name}`}>
          {info.blurb}
        </EmptyState>
      </div>
    )
  }

  return (
    <div className={s.gridScroll} ref={ref}>
      {error && !results.length && (
        <EmptyState icon={<ImageOff />} title="Search didn't work">
          {error}
        </EmptyState>
      )}
      {!error && !loading && !results.length && (
        <EmptyState icon={<ImageOff />} title="No results">
          Try different words, or search Google.
        </EmptyState>
      )}
      <div className={s.rows}>
        {rows.map((row, i) => (
          <div key={i} className={s.resultRow} style={{ height: row.height }}>
            {row.items.map(({ item: r, width }) => {
              const menu: MenuEntry[] = [
                { label: 'Preview', icon: <Eye />, onSelect: () => void open(r, 'preview') },
                { label: 'Show now', icon: <Play />, onSelect: () => void open(r, 'show') },
                { type: 'separator' },
                { label: 'Save to library', icon: <Star />, onSelect: () => void open(r, 'save') },
                { label: 'Add to service plan', icon: <Plus />, onSelect: () => void open(r, 'plan') },
                r.pageUrl && { type: 'separator' },
                r.pageUrl && {
                  label: 'Open source page',
                  icon: <ExternalLink />,
                  onSelect: () => void attempt('system:openExternal', r.pageUrl!)
                }
              ]
              return (
                <ContextMenu key={r.id} items={menu}>
                  <button
                    className={clsx(s.result, busyId === r.id && s.resultBusy)}
                    style={{ width }}
                    onClick={() => open(r, 'preview')}
                    onDoubleClick={() => open(r, 'show')}
                    draggable
                    onDragStart={(e) => setPickDrag(e, toPick(r, query))}
                    title={[r.title, r.author && `by ${r.author}`, r.license].filter(Boolean).join(' · ')}
                  >
                    <img src={r.thumbUrl} alt={r.title ?? ''} loading="lazy" draggable={false} />
                    {r.kind === 'video' && (
                      <span className={s.resultBadge}>{r.duration ? formatTime(r.duration) : 'Video'}</span>
                    )}
                    <span className={s.resultInfo}>
                      <span className={s.resultTitle}>{r.title}</span>
                      <span className={s.resultMeta}>
                        {[r.width && `${r.width}×${r.height}`, r.license, r.author]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    {busyId === r.id && (
                      <span className={s.resultSpinner}>
                        <Spinner size={18} />
                      </span>
                    )}
                  </button>
                </ContextMenu>
              )
            })}
          </div>
        ))}
      </div>
      <div ref={sentinel} className={s.sentinel}>
        {loading && <Spinner size={18} />}
      </div>
      {results.length > 0 && (
        <div className={s.attribution}>
          Results from {info.name}
          {provider !== 'pexels'
            ? ' are openly licensed — credit the author where the license asks (Settings → Output → Show credits).'
            : ` (${domainOf('https://www.pexels.com')}).`}
        </div>
      )}
    </div>
  )
}
