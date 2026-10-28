import type { MediaItem, WebPick } from '@shared/types'
import { call, cleanError } from '../../lib/api'
import { toast } from '../../lib/toasts'
import type { GuestPick } from '../../lib/ui'

/** The embedded browser page, as far as bringing images in from it goes. */
export interface GuestHandle {
  contentsId: number
  /** Where the image showing `url` is now, in control-window coordinates, and its natural size. */
  locate(url: string): Promise<{ x: number; y: number; width: number; height: number } | null>
}

/**
 * Bring the image the operator opened in the Google pane into Cue, trying in
 * order: the original image URL; copying the image straight out of the page
 * (works even when a site blocks direct downloads); Google's own thumbnail.
 */
export async function ingestGooglePick(
  pick: GuestPick,
  guest: GuestHandle | null,
  opts: { save?: boolean; query?: string } = {}
): Promise<MediaItem | null> {
  const base: WebPick = {
    url: pick.url,
    pageUrl: pick.pageUrl,
    title: pick.title,
    width: pick.width,
    height: pick.height,
    provider: 'google',
    query: opts.query
  }
  if (pick.full) {
    try {
      return await call('library:importWeb', base, { save: opts.save })
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
        if (copied) return copied
      }
    } catch {
      /* fall back to the thumbnail */
    }
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
      return item
    } catch (err) {
      toast.error("Couldn't bring in that image", cleanError(err))
      return null
    }
  }
  toast.error("Couldn't bring in that image", 'The website refused to share it. Try another result.')
  return null
}
