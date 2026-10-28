import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, Eye, Play, Plus, Star, Trash } from 'lucide-react'
import type { HistoryEntry } from '@shared/types'
import { attempt } from '../../lib/api'
import { setMediaDrag } from '../../lib/dnd'
import { addMediaToPlan, previewPresentation, showPresentation } from '../../lib/planActions'
import { useApp } from '../../lib/store'
import { IconButton } from '../../ui/Button'
import { ContextMenu, type MenuEntry } from '../../ui/Menu'
import { PresentationThumb } from '../common/Thumb'
import s from './HistoryPanel.module.css'

function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Everything that went live today, so it can be brought back in one click. */
export function HistoryPanel() {
  const history = useApp((st) => st.history)
  const [open, setOpen] = useState(true)
  const today = useMemo(() => {
    const since = startOfToday()
    return history.filter((h) => h.at >= since)
  }, [history])
  return (
    <section className={clsx(s.panel, open && s.open)}>
      <header className={s.header}>
        <button className={s.toggle} onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronDown size={13} className={s.chevron} />
          Shown today
          {today.length > 0 && <span className={s.count}>{today.length}</span>}
        </button>
        {open && today.length > 0 && (
          <IconButton label="Clear history" size="sm" onClick={() => attempt('history:clear')}>
            <Trash />
          </IconButton>
        )}
      </header>
      {open && (
        <div className={s.list}>
          {today.length === 0 ? (
            <div className={s.empty}>Things you show appear here, ready to bring back.</div>
          ) : (
            today.map((h) => <HistoryRow key={h.id} entry={h} />)
          )}
        </div>
      )}
    </section>
  )
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const item = useApp((st) => (entry.mediaId ? st.items[entry.mediaId] : undefined))
  const live = useApp((st) => st.show?.live)
  const isLive =
    !!live &&
    live.mediaId === entry.mediaId &&
    live.page === entry.presentation.page &&
    live.kind === entry.kind
  const time = new Date(entry.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const menu: MenuEntry[] = [
    { label: 'Preview', icon: <Eye />, onSelect: () => previewPresentation(entry.presentation) },
    { label: 'Show now', icon: <Play />, onSelect: () => showPresentation(entry.presentation) },
    { type: 'separator' },
    entry.mediaId && {
      label: 'Add to service plan',
      icon: <Plus />,
      onSelect: () => void addMediaToPlan([entry.mediaId!])
    },
    item &&
      !item.saved && {
        label: 'Save to library',
        icon: <Star />,
        onSelect: () => void attempt('library:update', item.id, { saved: true })
      }
  ]
  return (
    <ContextMenu items={menu}>
      <div
        className={clsx(s.row, isLive && s.live)}
        draggable={!!entry.mediaId}
        onDragStart={(e) => entry.mediaId && setMediaDrag(e, [entry.mediaId])}
        onClick={() => previewPresentation(entry.presentation)}
        onDoubleClick={() => showPresentation(entry.presentation)}
        title={`${entry.title} — click to preview, double-click to show`}
      >
        <PresentationThumb p={entry.presentation} className={s.thumb} />
        <div className={s.text}>
          <div className={s.title}>{entry.title}</div>
          <div className={s.sub}>
            {time}
            {entry.presentation.pageCount
              ? ` · ${entry.kind === 'deck' ? 'slide' : 'p.'} ${(entry.presentation.page ?? 0) + 1}`
              : ''}
          </div>
        </div>
      </div>
    </ContextMenu>
  )
}
