import { useEffect, useState } from 'react'
import { Eye, Plus, Star, Tv, X } from 'lucide-react'
import { youtubeVideoId } from '@shared/pagePreview'
import { domainOf } from '@shared/util'
import { attempt, modKey } from '../../lib/api'
import { addMediaToPlan, previewMedia, showMedia } from '../../lib/planActions'
import { useApp, useSettings } from '../../lib/store'
import { useUI } from '../../lib/ui'
import { Button, IconButton } from '../../ui/Button'
import { Spinner } from '../../ui/Controls'
import { ORIGINAL_WAIT_MS, ingestGooglePick, type GuestHandle } from './googlePick'
import s from './SearchView.module.css'

/**
 * Floating bar for the image currently open in the Google pane:
 * preview it, put it on screen, save it or add it to the plan in one click.
 */
export function PickBar({ guest, onDismiss }: { guest: () => GuestHandle | null; onDismiss?: () => void }) {
  const pick = useUI((st) => st.search.pick)
  const pickedId = useUI((st) => st.search.pickedMediaId)
  const via = useUI((st) => st.search.pickedVia)
  const busy = useUI((st) => st.search.busy)
  const query = useUI((st) => st.search.submitted)
  const setSearch = useUI((st) => st.setSearch)
  const settings = useSettings()!
  const item = useApp((st) => (pickedId ? st.items[pickedId] : undefined))
  const [waited, setWaited] = useState(false)

  // If the original doesn't arrive, the best copy there is can be used after a moment.
  useEffect(() => {
    setWaited(false)
    if (!pick || pick.full) return
    const t = setTimeout(() => setWaited(true), ORIGINAL_WAIT_MS)
    return () => clearTimeout(t)
  }, [pick])

  if (!pick) return null

  const get = async (save = false) => {
    // Keep what is in hand, which the operator has seen: fetching again could bring another copy.
    if (item)
      return save && !item.saved
        ? ((await attempt('library:update', item.id, { saved: true })) ?? item)
        : item
    setSearch({ busy: true })
    try {
      const got = await ingestGooglePick(pick, guest(), { save, query })
      // The operator may have opened another image meanwhile; don't attach this one to it.
      if (useUI.getState().search.pick === pick)
        setSearch(got ? { pickedMediaId: got.item.id, pickedVia: got.via } : { pickedVia: 'failed' })
      return got?.item ?? null
    } finally {
      setSearch({ busy: false })
    }
  }
  const size = item?.width
    ? `${item.width}×${item.height}`
    : pick.width
      ? `${pick.width}×${pick.height}`
      : null
  const lowres = (item?.width ?? pick.width ?? 9999) < 1000
  const thumb = pick.thumbUrl ?? pick.url
  // Until the original has had its moment, there is nothing to act on yet.
  const waiting = !pick.full && !waited && !item
  const note = !item
    ? null
    : via === 'page'
      ? `From the ${youtubeVideoId(pick.pageUrl) ? 'video' : 'post'}'s preview image`
      : via === 'thumbnail'
        ? 'Lower-resolution copy'
        : null

  return (
    <div className={s.pickBar} data-testid="pick-bar">
      <div className={s.pickThumb}>
        <img src={thumb} alt="" draggable={false} />
      </div>
      <div className={s.pickText}>
        <div className={s.pickTitle}>{pick.title || domainOf(pick.pageUrl) || 'Selected image'}</div>
        <div className={s.pickMeta}>
          {pick.full || item ? (
            <>
              {size && <span className={lowres ? s.lowres : undefined}>{size}</span>}
              {pick.pageUrl && <span>{domainOf(pick.pageUrl)}</span>}
              {note && <span>{note}</span>}
              {item && settings.search.autoPreview && <span className={s.inPreview}>In preview</span>}
            </>
          ) : waiting ? (
            <>
              <Spinner size={11} /> Loading full image…
            </>
          ) : via === 'failed' ? (
            "Couldn't bring in this image"
          ) : settings.search.autoPreview || busy ? (
            <>
              <Spinner size={11} /> Getting the best copy there is…
            </>
          ) : (
            'No full-size image. Cue will use the best copy there is'
          )}
        </div>
      </div>
      <div className={s.pickActions}>
        {busy && <Spinner />}
        {(!settings.search.autoPreview || !item) && (
          <Button
            size="sm"
            variant="quiet"
            icon={<Eye />}
            disabled={busy || waiting}
            onClick={async () => {
              const got = await get()
              if (got) previewMedia(got.id)
            }}
          >
            Preview
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          icon={<Tv />}
          disabled={busy || waiting}
          onClick={async () => {
            const got = await get()
            if (got) showMedia(got.id)
          }}
          trailing={
            item && settings.search.autoPreview ? <kbd>{modKey === '⌘' ? '⌘↵' : 'Ctrl↵'}</kbd> : undefined
          }
        >
          Show on {settings.output.name}
        </Button>
        <IconButton
          label="Save to library"
          disabled={busy || waiting}
          pressed={!!item?.saved}
          tone="amber"
          onClick={async () => {
            const got = await get(true)
            if (got) void attempt('library:update', got.id, { saved: true })
          }}
        >
          <Star />
        </IconButton>
        <IconButton
          label="Add to service plan"
          disabled={busy || waiting}
          onClick={async () => {
            const got = await get(true)
            if (got) await addMediaToPlan([got.id])
          }}
        >
          <Plus />
        </IconButton>
        <IconButton
          label="Dismiss"
          size="sm"
          onClick={() => {
            onDismiss?.()
            setSearch({ pick: null, pickedMediaId: null, pickedVia: null })
          }}
        >
          <X />
        </IconButton>
      </div>
    </div>
  )
}
