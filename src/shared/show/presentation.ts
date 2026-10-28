import type { Presentation, PresentationKind } from '../types'

export type PagedPresentation = Presentation & { kind: 'pdf' | 'deck'; pageCount: number }
export type TimedPresentation = Presentation & { kind: 'video' | 'audio' }

export function isPaged(p: Presentation | null | undefined): p is PagedPresentation {
  return !!p && (p.kind === 'pdf' || p.kind === 'deck') && (p.pageCount ?? 0) > 0
}

export function isTimed(p: Presentation | null | undefined): p is TimedPresentation {
  return !!p && (p.kind === 'video' || p.kind === 'audio')
}

export function canZoom(p: Presentation | null | undefined): boolean {
  return !!p && (p.kind === 'image' || p.kind === 'pdf')
}

/** Do two presentations show the same underlying content (ignoring page/instance)? */
export function sameSource(a: Presentation | null | undefined, b: Presentation | null | undefined): boolean {
  if (!a || !b) return false
  if (a.kind !== b.kind) return false
  if (a.mediaId || b.mediaId) return a.mediaId === b.mediaId
  if (a.entryId || b.entryId) return a.entryId === b.entryId
  if (a.kind === 'color') return a.color === b.color
  return a.id === b.id
}

/** "Sermon slides · p. 7/24" style label. */
export function presentationLabel(p: Presentation | null | undefined): string {
  if (!p) return ''
  if (isPaged(p)) return `${p.title} · ${pageWord(p.kind)} ${(p.page ?? 0) + 1}/${p.pageCount}`
  return p.title
}

export function pageWord(kind: PresentationKind): string {
  return kind === 'deck' ? 'slide' : 'p.'
}

/** Page index clamped to the presentation's range. */
export function clampPage(p: Presentation, page: number): number {
  const count = p.pageCount ?? 1
  return Math.max(0, Math.min(count - 1, Math.round(page)))
}
