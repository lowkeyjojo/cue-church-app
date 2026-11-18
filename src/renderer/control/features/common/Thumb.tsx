import clsx from 'clsx'
import { AudioLines, FileText, Film, Image as ImageIcon, SunMedium } from 'lucide-react'
import type { AmbientConfig, Deck, Id, MediaItem, Presentation } from '@shared/types'
import { pageFile, thumbUrl } from '@shared/util'
import { AMBIENT_THEMES } from '../../../stage/GenerativeBackground'
import { SlideView } from '../../../stage/slides/SlideView'
import { useElementSize } from '../../../stage/useElementSize'
import { useApp } from '../../lib/store'
import s from './Thumb.module.css'

/** A slide rendered live at thumbnail size (identical to what the audience sees). */
export function DeckThumb({
  deck,
  index = 0,
  className
}: {
  deck: Deck
  index?: number
  className?: string
}) {
  const [ref, size] = useElementSize<HTMLDivElement>()
  const media = useDeckMedia(deck)
  return (
    <div ref={ref} className={clsx(s.thumb, className)}>
      {size.width > 0 && deck.slides.length > 0 && (
        <SlideView
          deck={deck}
          index={index}
          media={media}
          width={size.width}
          height={size.height}
          role="preview"
        />
      )}
    </div>
  )
}

function useDeckMedia(deck: Deck): Record<Id, { kind: 'image' | 'video'; src: string }> {
  const items = useApp((st) => st.items)
  const ids = [deck.background.mediaId, ...deck.slides.map((sl) => sl.background?.mediaId)].filter(
    Boolean
  ) as Id[]
  const out: Record<Id, { kind: 'image' | 'video'; src: string }> = {}
  for (const id of ids) {
    const item = items[id]
    // Thumbnails use the still thumbnail even for video backgrounds.
    const src = item ? thumbUrl(item) : undefined
    if (src) out[id] = { kind: 'image', src }
  }
  return out
}

export function AmbientThumb({ config, className }: { config: AmbientConfig; className?: string }) {
  const items = useApp((st) => st.items)
  const first = config.source === 'media' ? items[config.mediaIds[0]] : undefined
  const firstThumb = first ? thumbUrl(first) : undefined
  const [c0, c1, c2, c3] = (AMBIENT_THEMES[config.theme] ?? AMBIENT_THEMES.ember).colors
  return (
    <div
      className={clsx(s.thumb, s.ambient, className)}
      style={
        firstThumb
          ? undefined
          : {
              background: `radial-gradient(70% 90% at 30% 30%, ${c2}cc, transparent 70%), radial-gradient(60% 80% at 75% 70%, ${c3}66, transparent 70%), linear-gradient(160deg, ${c1}, ${c0})`
            }
      }
    >
      {firstThumb && <img src={firstThumb} alt="" draggable={false} loading="lazy" />}
      <SunMedium className={s.ambientIcon} size={12} />
    </div>
  )
}

export function MediaThumb({
  item,
  className,
  page = 0
}: {
  item: MediaItem
  className?: string
  page?: number
}) {
  if (item.kind === 'deck' && item.deck)
    return <DeckThumb deck={item.deck} index={page} className={className} />
  if (item.kind === 'audio')
    return (
      <div className={clsx(s.thumb, s.icon, className)}>
        <AudioLines size={16} />
      </div>
    )
  const src =
    item.kind === 'pdf' && page > 0
      ? `cue-media://media/${item.id}/${pageFile(page + 1, 'thumb')}`
      : thumbUrl(item)
  if (!src) {
    const Icon = item.kind === 'video' ? Film : item.kind === 'pdf' ? FileText : ImageIcon
    return (
      <div className={clsx(s.thumb, s.icon, item.status === 'processing' && s.processing, className)}>
        <Icon size={16} />
      </div>
    )
  }
  return (
    <div className={clsx(s.thumb, item.kind === 'pdf' && s.page, className)}>
      <img src={src} alt="" draggable={false} loading="lazy" />
    </div>
  )
}

/** Thumbnail for a presentation snapshot (history, palette). */
export function PresentationThumb({ p, className }: { p: Presentation; className?: string }) {
  if (p.kind === 'deck' && p.deck)
    return <DeckThumb deck={p.deck} index={p.page ?? 0} className={className} />
  if (p.kind === 'ambient' && p.ambient)
    return <AmbientThumb config={p.ambient.config} className={className} />
  if (p.kind === 'color') return <div className={clsx(s.thumb, className)} style={{ background: p.color }} />
  const src =
    p.kind === 'pdf' && p.pageBase ? `${p.pageBase}${pageFile((p.page ?? 0) + 1, 'thumb')}` : p.thumb
  if (!src)
    return (
      <div className={clsx(s.thumb, s.icon, className)}>
        {p.kind === 'audio' ? (
          <AudioLines size={16} />
        ) : p.kind === 'video' ? (
          <Film size={16} />
        ) : (
          <ImageIcon size={16} />
        )}
      </div>
    )
  return (
    <div className={clsx(s.thumb, p.kind === 'pdf' && s.page, className)}>
      <img src={src} alt="" draggable={false} loading="lazy" />
    </div>
  )
}
