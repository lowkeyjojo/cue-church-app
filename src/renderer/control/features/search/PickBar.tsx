import { useEffect, useState } from 'react'
import { Eye, Plus, Star, Tv, X } from 'lucide-react'
import { domainOf } from '@shared/util'
import { attempt, modKey } from '../../lib/api'
import { addMediaToPlan, previewMedia, showMedia } from '../../lib/planActions'
import { useApp, useSettings } from '../../lib/store'
import { useUI } from '../../lib/ui'
import { Button, IconButton } from '../../ui/Button'
import { Spinner } from '../../ui/Controls'
import { ingestGooglePick } from './googlePick'
import s from './SearchView.module.css'

/**
 * Floating bar for the image currently open in the Google pane:
 * preview it, put it on screen, save it or add it to the plan in one click.
 */
export function PickBar({ contentsId }: { contentsId: () => number | null }) {
  const pick = useUI((st) => st.search.pick)
  const pickedId = useUI((st) => st.search.pickedMediaId)
  const busy = useUI((st) => st.search.busy)
  const query = useUI((st) => st.search.submitted)
  const setSearch = useUI((st) => st.setSearch)
  const settings = useSettings()!
  const item = useApp((st) => (pickedId ? st.items[pickedId] : undefined))
  const [waited, setWaited] = useState(false)

  // If the original never arrives, offer the low-res preview after a moment.
  useEffect(() => {
    setWaited(false)
    if (!pick || pick.full) return
    const t = setTimeout(() => setWaited(true), 2500)
    return () => clearTimeout(t)
  }, [pick])

  if (!pick) return null

  const get = async (save = false) => {
    if (item && !save) return item
    setSearch({ busy: true })
    try {
      const got = await ingestGooglePick(pick, contentsId(), { save, query })
      if (got) setSearch({ pickedMediaId: got.id })
      return got
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

  return (
    <div className={s.pickBar} data-testid="pick-bar">
      <div className={s.pickThumb}>
        <img src={thumb} alt="" draggable={false} />
      </div>
      <div className={s.pickText}>
        <div className={s.pickTitle}>{pick.title || domainOf(pick.pageUrl) || 'Selected image'}</div>
        <div className={s.pickMeta}>
          {!pick.full ? (
            waited ? (
              'Full-size image unavailable — the preview copy can still be used'
            ) : (
              <>
                <Spinner size={11} /> Loading full image…
              </>
            )
          ) : (
            <>
              {size && <span className={lowres ? s.lowres : undefined}>{size}</span>}
              {pick.pageUrl && <span>{domainOf(pick.pageUrl)}</span>}
              {item && settings.search.autoPreview && <span className={s.inPreview}>In preview</span>}
            </>
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
            disabled={busy || (!pick.full && !waited)}
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
          disabled={busy || (!pick.full && !waited)}
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
          disabled={busy || (!pick.full && !waited)}
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
          disabled={busy || (!pick.full && !waited)}
          onClick={async () => {
            const got = await get(true)
            if (got) await addMediaToPlan([got.id])
          }}
        >
          <Plus />
        </IconButton>
        <IconButton label="Dismiss" size="sm" onClick={() => setSearch({ pick: null, pickedMediaId: null })}>
          <X />
        </IconButton>
      </div>
    </div>
  )
}
