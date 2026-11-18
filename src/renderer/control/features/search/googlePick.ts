import type { MediaItem, WebPick } from '@shared/types'
import { call, cleanError } from '../../lib/api'
import { toast } from '../../lib/toasts'
import type { GuestPick, PickVia } from '../../lib/ui'

/**
 * How long a pick may show only Google's thumbnail before Cue stops waiting
 * for the original and brings in the best copy there is. Google swaps in most
 * originals well within a second; for social and video sites it never does.
 */
export const ORIGINAL_WAIT_MS = 1800

/** The embedded browser page, as far as bringing images in from it goes. */
export interface GuestHandle {
  contentsId: number
  /** Where the image showing `url` is now, in control-window coordinates, and its natural size. */
  locate(url: string): Promise<{ x: number; y: number; width: number; height: number } | null>
}

/** Is `pick` the original of the result `earlier` showed as a thumbnail? */
export function isOriginalOf(pick: GuestPick, earlier: GuestPick | null): boolean {
  return !!earlier && pick.full && !earlier.full && pick.thumbUrl === earlier.url
}

/**
 * Bring the image the operator opened in the Google pane into Cue, trying in
 * order: the original image URL; copying the original straight out of the page
 * (works even when a site blocks direct downloads); the preview image of the
 * page it came from, on social and video sites (main checks it is the same
 * picture); Google's own thumbnail.
 *
 * A pick that is still Google's thumbnail is not copied out of the page: that
 * copies the thumbnail's own bitmap, the same pixels its URL gives.
 */
export async function ingestGooglePick(
  pick: GuestPick,
  guest: GuestHandle | null,
  opts: { save?: boolean; query?: string } = {}
): Promise<{ item: MediaItem; via: PickVia } | null> {
  const base: WebPick = {
    url: pick.url,
    pageUrl: pick.pageUrl,
    title: pick.title,
    width: pick.width,
    height: pick.height,
    thumbWidth: pick.thumbWidth,
    thumbHeight: pick.thumbHeight,
    provider: 'google',
    query: opts.query
  }
  if (pick.full) {
    try {
      return { item: await call('library:importWeb', base, { save: opts.save }), via: 'original' }
    } catch {
      /* try the next way */
    }
    try {
      const at = guest && (await guest.locate(pick.url))
      if (guest && at) {
        const copied = await call(
          'system:copyImageAt',
          guest.contentsId,
          at.x,
          at.y,
          { ...base, width: at.width, height: at.height },
          { save: opts.save }
        )
        if (copied) return { item: copied, via: 'original' }
      }
    } catch {
      /* try the next way */
    }
  }
  try {
    const item = await call('library:importPagePreview', base, { save: opts.save })
    if (item) return { item, via: 'page' }
  } catch {
    /* fall back to the thumbnail */
  }
  const thumb = pick.thumbUrl ?? (pick.full ? undefined : pick.url)
  if (thumb) {
    try {
      const item = await call('library:importWeb', { ...base, url: thumb }, { save: opts.save })
      toast.show({
        id: 'lowres',
        kind: 'warning',
        title: 'Using a lower-resolution copy',
        message: "The website didn't share its full-size image.",
        duration: 4500
      })
      return { item, via: 'thumbnail' }
    } catch (err) {
      toast.error("Couldn't bring in that image", cleanError(err))
      return null
    }
  }
  toast.error("Couldn't bring in that image", 'The website refused to share it. Try another result.')
  return null
}
