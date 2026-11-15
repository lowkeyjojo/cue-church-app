import { useEffect, useRef, useState, type CSSProperties } from 'react'
import clsx from 'clsx'
import {
  CalendarDays,
  ChevronDown,
  Copy,
  Download,
  Ellipsis,
  Eye,
  FileText,
  FolderOpen,
  Heading,
  Library,
  ListPlus,
  NotebookPen,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Square,
  Trash,
  Type,
  Upload
} from 'lucide-react'
import { DEFAULT_AMBIENT, newDeck, newSlide } from '@shared/defaults'
import type { Id, Plan, PlanEntry } from '@shared/types'
import { todayIso } from '@shared/util'
import { attempt, call } from '../../lib/api'
import {
  claimDrop,
  droppedPaths,
  hasDragType,
  ingestPick,
  readMediaDrag,
  readWebDrop,
  DRAG_ENTRY,
  DRAG_MEDIA,
  DRAG_PICK
} from '../../lib/dnd'
import {
  importPaths,
  newPlan,
  previewEntry,
  selectPlan,
  showEntry,
  useCurrentPlan
} from '../../lib/planActions'
import { useApp, useShow } from '../../lib/store'
import { toast } from '../../lib/toasts'
import { useUI } from '../../lib/ui'
import { IconButton } from '../../ui/Button'
import { EmptyState } from '../../ui/Controls'
import { ContextMenu, DropdownMenu, type MenuEntry } from '../../ui/Menu'
import { AmbientThumb, MediaThumb } from '../common/Thumb'
import { entryInfo } from './entryInfo'
import s from './PlanPanel.module.css'

export function PlanPanel() {
  const plan = useCurrentPlan()
  const plans = useApp((st) => st.plans)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  if (!plan) {
    return (
      <div className={s.panel}>
        <EmptyState
          icon={<CalendarDays />}
          title="Plan your service"
          action={
            <>
              <button className={s.linkButton} onClick={() => newPlan()}>
                New service plan
              </button>
              <button className={s.linkButton} onClick={() => attempt('plans:import')}>
                Import…
              </button>
            </>
          }
        >
          Line up slides, videos and images in order, then run the service with one key.
        </EmptyState>
      </div>
    )
  }

  const accepts = (dt: DataTransfer) =>
    hasDragType(dt, DRAG_ENTRY, DRAG_MEDIA, DRAG_PICK, 'Files', 'text/uri-list')

  const indexFromEvent = (e: React.DragEvent): number => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-entry-index]') ?? [])
    for (const row of rows) {
      const r = row.getBoundingClientRect()
      if (e.clientY < r.top + r.height / 2) return Number(row.dataset.entryIndex)
    }
    return plan.entries.length
  }

  const onDragOver = (e: React.DragEvent) => {
    if (!accepts(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = hasDragType(e.dataTransfer, DRAG_ENTRY) ? 'move' : 'copy'
    setDropIndex(indexFromEvent(e))
  }

  const onDrop = async (e: React.DragEvent) => {
    const index = dropIndex ?? plan.entries.length
    setDropIndex(null)
    if (!accepts(e.dataTransfer)) return
    claimDrop(e)
    const dt = e.dataTransfer
    const entryId = dt.getData(DRAG_ENTRY)
    if (entryId) return void attempt('plans:moveEntries', plan.id, [entryId], index)
    const ids = readMediaDrag(dt)
    if (ids?.length)
      return void attempt(
        'plans:addEntries',
        plan.id,
        ids.map((mediaId) => ({ type: 'media' as const, mediaId })),
        index
      )
    const paths = droppedPaths(dt)
    if (paths.length) return void importPaths(paths, { addToPlanAt: index })
    const pick = readWebDrop(dt)
    if (pick) {
      const item = await ingestPick(pick, { save: true })
      if (item) await attempt('plans:addEntries', plan.id, [{ type: 'media', mediaId: item.id }], index)
    }
  }

  let number = 0
  return (
    <div className={s.panel}>
      <PlanHeader plan={plan} plans={plans} />
      <div
        ref={listRef}
        className={s.list}
        data-arrow-nav
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropIndex(null)
        }}
        onDrop={onDrop}
      >
        {plan.entries.length === 0 && (
          <EmptyState compact icon={<ListPlus />} title="This plan is empty">
            Drag media here from your library or search, or use <strong>Add</strong> below.
          </EmptyState>
        )}
        {plan.entries.map((entry, i) => (
          <div
            key={entry.id}
            data-entry-index={i}
            className={s.slot}
            style={{ '--i': Math.min(i, 14) } as CSSProperties}
          >
            {dropIndex === i && <div className={s.dropLine} />}
            {entry.type === 'section' ? (
              <SectionRow plan={plan} entry={entry} />
            ) : (
              <EntryRow plan={plan} entry={entry} number={++number} />
            )}
          </div>
        ))}
        {dropIndex === plan.entries.length && <div className={s.dropLine} />}
        <AddMenu plan={plan} />
      </div>
    </div>
  )
}

function PlanHeader({ plan, plans }: { plan: Plan; plans: Plan[] }) {
  const [editing, setEditing] = useState(false)
  const date = plan.date
    ? new Date(`${plan.date}T12:00:00`).toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      })
    : 'No date'
  const remove = async () => {
    if (!window.confirm(`Delete the plan “${plan.name}”? Its media stays in your library.`)) return
    await attempt('plans:remove', plan.id)
    selectPlan(plans.find((p) => p.id !== plan.id)?.id ?? null)
  }
  const actions: MenuEntry[] = [
    { label: 'New service plan', icon: <Plus />, onSelect: () => void newPlan() },
    {
      label: 'Duplicate',
      icon: <Copy />,
      onSelect: async () => {
        const copy = await attempt('plans:duplicate', plan.id)
        if (copy) selectPlan(copy.id)
      }
    },
    { label: 'Rename…', icon: <Pencil />, onSelect: () => setEditing(true) },
    { type: 'separator' },
    { label: 'Export with media…', icon: <Upload />, onSelect: () => void attempt('plans:export', plan.id) },
    {
      label: 'Import plan…',
      icon: <Download />,
      onSelect: async () => {
        const imported = await attempt('plans:import')
        if (imported) selectPlan(imported.id)
      }
    },
    { type: 'separator' },
    { label: 'Delete plan', icon: <Trash />, danger: true, onSelect: () => void remove() }
  ]
  const items: MenuEntry[] = [
    { type: 'label', label: 'Service plans' },
    ...plans.slice(0, 12).map((p): MenuEntry => ({
      type: 'check',
      label: p.date ? `${p.name} · ${p.date}` : p.name,
      checked: p.id === plan.id,
      onSelect: () => selectPlan(p.id)
    })),
    { type: 'separator' },
    ...actions
  ]
  return (
    <div className={s.header}>
      {editing ? (
        <PlanNameEditor plan={plan} onDone={() => setEditing(false)} />
      ) : (
        <DropdownMenu
          width={260}
          items={items}
          trigger={
            <button className={s.planButton} aria-label="Switch service plan">
              <span className={s.planName}>{plan.name}</span>
              <span className={s.planDate}>
                {date}
                <ChevronDown size={13} />
              </span>
            </button>
          }
        />
      )}
      <DropdownMenu
        align="end"
        items={actions}
        trigger={
          <IconButton label="Plan options" size="sm">
            <Ellipsis />
          </IconButton>
        }
      />
    </div>
  )
}

function PlanNameEditor({ plan, onDone }: { plan: Plan; onDone: () => void }) {
  const [name, setName] = useState(plan.name)
  const [date, setDate] = useState(plan.date ?? todayIso())
  const save = () => {
    void attempt('plans:update', plan.id, { name, date })
    onDone()
  }
  return (
    <form
      className={s.editor}
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      onKeyDown={(e) => e.key === 'Escape' && onDone()}
    >
      <input
        className={s.editName}
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.target.select()}
        aria-label="Plan name"
      />
      <input
        className={s.editDate}
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        aria-label="Service date"
      />
      <button className={s.linkButton} type="submit">
        Done
      </button>
    </form>
  )
}

function AddMenu({ plan }: { plan: Plan }) {
  const open = useUI((st) => st.open)
  const setTab = useUI((st) => st.setTab)
  const add = async (entry: Omit<PlanEntry, 'id'>) =>
    (await attempt('plans:addEntries', plan.id, [entry]))?.[0]
  const items: MenuEntry[] = [
    {
      label: 'Media from library…',
      icon: <Library />,
      onSelect: () => {
        setTab('library')
        toast.info('Drag items into the plan, or right-click → Add to plan')
      }
    },
    {
      label: 'Text slides…',
      icon: <Type />,
      onSelect: async () => {
        const deck = await attempt(
          'library:createDeck',
          'New slides',
          newDeck({ slides: [newSlide({ layout: 'title', title: '' })] })
        )
        if (!deck) return
        await add({ type: 'media', mediaId: deck.id })
        open('deck', deck.id)
      }
    },
    {
      label: 'Ambient or countdown…',
      icon: <Sparkles />,
      onSelect: async () => {
        const entry = await add({
          type: 'ambient',
          title: 'Countdown',
          ambient: {
            ...DEFAULT_AMBIENT,
            overlay: { ...DEFAULT_AMBIENT.overlay, kind: 'countdown', subtext: 'The service begins in' }
          }
        })
        if (entry) open('ambient', { planId: plan.id, entryId: entry.id })
      }
    },
    {
      label: 'Black screen',
      icon: <Square />,
      onSelect: () => void add({ type: 'color', color: '#000000', title: 'Black' })
    },
    {
      label: 'Section heading',
      icon: <Heading />,
      onSelect: () => void add({ type: 'section', title: 'New section' })
    },
    { type: 'separator' },
    {
      label: 'Import files…',
      icon: <FolderOpen />,
      onSelect: async () => {
        const paths = await attempt('system:chooseFiles', 'media')
        if (paths?.length) await importPaths(paths, { addToPlanAt: plan.entries.length })
      }
    }
  ]
  return (
    <DropdownMenu
      items={items}
      side="top"
      width={230}
      trigger={
        <button className={s.addButton}>
          <Plus size={15} />
          Add to plan
        </button>
      }
    />
  )
}

function SectionRow({ plan, entry }: { plan: Plan; entry: PlanEntry }) {
  const [editing, setEditing] = useState(false)
  return (
    <ContextMenu
      items={[
        { label: 'Rename', icon: <Pencil />, onSelect: () => setEditing(true) },
        {
          label: 'Remove',
          icon: <Trash />,
          danger: true,
          onSelect: () => void attempt('plans:removeEntries', plan.id, [entry.id])
        }
      ]}
    >
      <div
        className={s.section}
        draggable={!editing}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_ENTRY, entry.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDoubleClick={() => setEditing(true)}
      >
        {editing ? (
          <InlineTitle
            value={entry.title ?? ''}
            onDone={(title) => {
              setEditing(false)
              if (title !== undefined) void attempt('plans:updateEntry', plan.id, entry.id, { title })
            }}
          />
        ) : (
          <span>{entry.title || 'Section'}</span>
        )}
      </div>
    </ContextMenu>
  )
}

function EntryRow({ plan, entry, number }: { plan: Plan; entry: PlanEntry; number: number }) {
  const show = useShow()!
  const item = useApp((st) => (entry.mediaId ? st.items[entry.mediaId] : undefined))
  const focus = useUI((st) => st.focus)
  const open = useUI((st) => st.open)
  const setFocus = useUI((st) => st.setFocus)
  const [editing, setEditing] = useState(false)
  const row = useRef<HTMLDivElement>(null)
  const info = entryInfo(entry, item)
  const live = show.live?.entryId === entry.id && show.live?.planId === plan.id
  const standby = show.preview?.entryId === entry.id && show.preview?.planId === plan.id
  const focused = focus?.type === 'entry' && focus.entryId === entry.id
  const page = live && show.live?.pageCount ? `${(show.live.page ?? 0) + 1}/${show.live.pageCount}` : null

  useEffect(() => {
    if (live) row.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [live])

  const remove = () => void attempt('plans:removeEntries', plan.id, [entry.id])
  const menu = (): MenuEntry[] => [
    { label: 'Preview', icon: <Eye />, onSelect: () => previewEntry(plan.id, entry) },
    { label: 'Show now', icon: <Play />, onSelect: () => showEntry(plan.id, entry) },
    { type: 'separator' },
    item?.kind === 'deck' && { label: 'Edit slides…', icon: <Type />, onSelect: () => open('deck', item.id) },
    entry.type === 'ambient' && {
      label: 'Edit ambient…',
      icon: <Sparkles />,
      onSelect: () => open('ambient', { planId: plan.id, entryId: entry.id })
    },
    { label: 'Rename', icon: <Pencil />, onSelect: () => setEditing(true) },
    {
      label: entry.notes ? 'Edit notes' : 'Add notes',
      icon: <NotebookPen />,
      onSelect: () => {
        setFocus({ type: 'entry', planId: plan.id, entryId: entry.id }, { showTab: true })
        requestAnimationFrame(() => window.dispatchEvent(new Event('cue:focus-notes')))
      }
    },
    item && { label: 'Show in library', icon: <Library />, onSelect: () => revealInLibrary(item.id) },
    {
      label: 'Duplicate',
      icon: <Copy />,
      onSelect: () => {
        const { id: _id, ...copy } = entry
        void attempt('plans:addEntries', plan.id, [copy], plan.entries.indexOf(entry) + 1)
      }
    },
    { type: 'separator' },
    { label: 'Remove from plan', icon: <Trash />, danger: true, onSelect: remove }
  ]

  return (
    <ContextMenu items={menu}>
      <div
        ref={row}
        className={clsx(
          s.row,
          live && s.live,
          standby && s.standby,
          focused && s.focused,
          info.missing && s.missing
        )}
        tabIndex={0}
        draggable={!editing}
        data-testid="plan-entry"
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_ENTRY, entry.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onClick={() => previewEntry(plan.id, entry)}
        onDoubleClick={() => showEntry(plan.id, entry)}
        onKeyDown={(e) => {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault()
            remove()
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const rows = Array.from(
              e.currentTarget
                .closest('[data-arrow-nav]')
                ?.querySelectorAll<HTMLElement>('[data-testid="plan-entry"]') ?? []
            )
            const next = rows[rows.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1)]
            next?.focus()
            next?.click()
          }
        }}
      >
        <span className={s.num}>{number}</span>
        <div className={s.thumbWrap}>
          {entry.type === 'ambient' && entry.ambient ? (
            <AmbientThumb config={entry.ambient} className={s.thumb} />
          ) : entry.type === 'color' ? (
            <div className={s.thumb} style={{ background: entry.color }} />
          ) : item ? (
            <MediaThumb item={item} className={s.thumb} />
          ) : (
            <div className={clsx(s.thumb, s.thumbMissing)}>
              <FileText size={14} />
            </div>
          )}
        </div>
        <div className={s.text}>
          {editing ? (
            <InlineTitle
              value={info.title}
              onDone={(title) => {
                setEditing(false)
                if (title !== undefined)
                  void attempt('plans:updateEntry', plan.id, entry.id, {
                    title: title === item?.name ? undefined : title
                  })
              }}
            />
          ) : (
            <div className={s.title}>{info.title}</div>
          )}
          <div className={s.sub}>{info.subtitle}</div>
        </div>
        <div className={s.side}>
          {live ? (
            <span className={clsx(s.chip, s.chipLive)}>{page ?? 'Live'}</span>
          ) : standby ? (
            <span className={clsx(s.chip, s.chipNext)}>Next</span>
          ) : null}
          {entry.notes && <NotebookPen size={12} className={s.noteIcon} aria-label="Has notes" />}
          {!live && (
            <IconButton
              className={s.quickShow}
              label="Show now"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                showEntry(plan.id, entry)
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <Play />
            </IconButton>
          )}
        </div>
      </div>
    </ContextMenu>
  )
}

function InlineTitle({ value, onDone }: { value: string; onDone: (value?: string) => void }) {
  const [text, setText] = useState(value)
  return (
    <input
      className={s.inlineInput}
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => onDone(text.trim() || value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onDone(text.trim() || value)
        if (e.key === 'Escape') onDone(undefined)
      }}
    />
  )
}

function revealInLibrary(id: Id) {
  const ui = useUI.getState()
  ui.setLibrary({ view: 'all', collection: null, query: '' })
  ui.setSelection([id])
  ui.setTab('library')
  requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('cue:reveal-media', { detail: id })))
}

export { revealInLibrary }

/** Ensure a deck item exists and add it (used by Quick slide "Save to plan"). */
export async function addDeckToPlan(planId: Id, deckId: Id): Promise<void> {
  await call('plans:addEntries', planId, [{ type: 'media', mediaId: deckId }])
}
