import type { MediaItem, PlanEntry } from '@shared/types'
import { domainOf, formatTime } from '@shared/util'
import { AMBIENT_THEMES } from '../../../stage/GenerativeBackground'

export interface EntryInfo {
  title: string
  subtitle: string
  missing: boolean
}

export function itemSubtitle(item: MediaItem): string {
  switch (item.kind) {
    case 'image': {
      const web = item.source.type === 'web' ? domainOf(item.source.pageUrl ?? item.source.url) : ''
      return [item.animated ? 'GIF' : 'Image', web].filter(Boolean).join(' · ')
    }
    case 'video':
      return item.duration ? `Video · ${formatTime(item.duration)}` : 'Video'
    case 'audio':
      return item.duration ? `Audio · ${formatTime(item.duration)}` : 'Audio'
    case 'pdf':
      if (item.status === 'processing')
        return item.pageCount
          ? `PDF · preparing ${item.pagesReady ?? 0}/${item.pageCount}`
          : 'PDF · preparing…'
      return `PDF · ${item.pageCount ?? 0} pages`
    case 'deck': {
      const n = item.deck?.slides.length ?? 0
      return `Slides · ${n} ${n === 1 ? 'slide' : 'slides'}`
    }
  }
}

export function entryInfo(entry: PlanEntry, item: MediaItem | undefined): EntryInfo {
  if (entry.type === 'media') {
    if (!item)
      return {
        title: entry.title || 'Missing media',
        subtitle: 'This item was removed from the library',
        missing: true
      }
    const status = item.status === 'error' ? `Can't be shown · ${item.error ?? 'error'}` : itemSubtitle(item)
    return { title: entry.title || item.name, subtitle: status, missing: item.status === 'error' }
  }
  if (entry.type === 'ambient') {
    const a = entry.ambient
    const theme = a
      ? a.source === 'media' && a.mediaIds.length
        ? `${a.mediaIds.length} backgrounds`
        : AMBIENT_THEMES[a.theme]?.label
      : 'Default'
    const overlay = a?.overlay
    const what =
      overlay?.kind === 'countdown'
        ? overlay.countdownMinutes
          ? `Countdown · ${overlay.countdownMinutes} min`
          : `Countdown to ${overlay.countdownTo ?? '…'}`
        : overlay?.kind === 'clock'
          ? 'Clock'
          : overlay?.kind === 'text'
            ? 'Text'
            : 'Ambient'
    return { title: entry.title || 'Ambient', subtitle: `${what} · ${theme}`, missing: false }
  }
  if (entry.type === 'color')
    return { title: entry.title || 'Solid color', subtitle: entry.color ?? '#000000', missing: false }
  return { title: entry.title || 'Section', subtitle: '', missing: false }
}
