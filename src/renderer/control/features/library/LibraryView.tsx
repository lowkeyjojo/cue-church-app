import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  AudioLines,
  Clock,
  Copy,
  Eye,
  FileText,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  Image as ImageIcon,
  LayoutGrid,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash,
  Type,
  Upload
} from 'lucide-react'
import { newDeck, newSlide } from '@shared/defaults'
import type { Collection, Id, MediaItem } from '@shared/types'
import { formatTime } from '@shared/util'
import { attempt } from '../../lib/api'
import { claimDrop, droppedPaths, readMediaDrag, setMediaDrag, DRAG_MEDIA } from '../../lib/dnd'
import { addMediaToPlan, importMedia, importPaths, previewMedia, showMedia } from '../../lib/planActions'
import { useApp, useShow } from '../../lib/store'
import { toast } from '../../lib/toasts'
import { useUI, type LibraryView as View } from '../../lib/ui'
import { Toolbar } from '../../layout/Workspace'
import { useElementSize } from '../../../stage/useElementSize'
import { Button, IconButton } from '../../ui/Button'
import { EmptyState, Select, Slider, Spinner, TextField } from '../../ui/Controls'
import { ContextMenu, type MenuEntry } from '../../ui/Menu'
import { MediaThumb } from '../common/Thumb'
import { itemSubtitle } from '../plan/entryInfo'
import s from './LibraryView.module.css'

const VIEWS: { id: View; label: string; icon: ReactNode }[] = [
  { id: 'all', label: 'All media', icon: <LayoutGrid size={15} /> },
  { id: 'image', label: 'Images', icon: <ImageIcon size={15} /> },
  { id: 'video', label: 'Videos', icon: <Film size={15} /> },
  { id: 'pdf', label: 'PDFs', icon: <FileText size={15} /> },
  { id: 'deck', label: 'Slides', icon: <Type size={15} /> },
  { id: 'audio', label: 'Audio', icon: <AudioLines size={15} /> },
  { id: 'favorites', label: 'Favorites', icon: <Star size={15} /> },
  { id: 'recent', label: 'Recently shown', icon: <Clock size={15} /> },
  { id: 'web', label: 'Web picks', icon: <Globe size={15} /> }
]

function matches(item: MediaItem, view: View, collection: Id | null, query: string): boolean {
  if (collection && !item.collections.includes(collection)) return false
  const transientOk = view === 'web' || view === 'recent'
  if (!item.saved && !transientOk) return false
  switch (view) {
    case 'image':
    case 'video':
    case 'pdf':
    case 'deck':
    case 'audio':
      if (item.kind !== view) return false
      break
    case 'favorites':
      if (!item.favorite) return false
      break
    case 'recent':
      if (!item.lastShownAt) return false
      break
    case 'web':
      if (item.source.type !== 'web') return false
      break
  }
  if (query) {
    const hay =
      `${item.name} ${item.tags.join(' ')} ${item.source.title ?? ''} ${item.source.query ?? ''}`.toLowerCase()
    return query
      .toLowerCase()
      .split(/\s+/)
      .every((w) => hay.includes(w))
  }
  return true
}

export function LibraryView({ active }: { active: boolean }) {
  const items = useApp((st) => st.items)
  const collections = useApp((st) => st.collections)
  const filter = useUI((st) => st.library)
  const setFilter = useUI((st) => st.setLibrary)
  const selection = useUI((st) => st.selection)
  const setSelection = useUI((st) => st.setSelection)
  const tileSize = useApp((st) => st.settings?.ui.tileSize ?? 176)
  const open = useUI((st) => st.open)

  const list = useMemo(() => {
    const out = Object.values(items).filter((i) =>
      matches(i, filter.view, filter.collection, filter.query.trim())
    )
    const sort = filter.view === 'recent' ? 'used' : filter.sort
    out.sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, undefined, { numeric: true })
        : sort === 'used'
          ? (b.lastShownAt ?? 0) - (a.lastShownAt ?? 0) || b.showCount - a.showCount
          : b.createdAt - a.createdAt
    )
    return out
  }, [items, filter])

  const [toolbarRef, toolbarSize] = useElementSize<HTMLDivElement>()
  const compact = toolbarSize.width > 0 && toolbarSize.width < 600
  const tight = toolbarSize.width > 0 && toolbarSize.width < 340

  const newSlides = async () => {
    const deck = await attempt(
      'library:createDeck',
      'New slides',
      newDeck({ slides: [newSlide({ layout: 'title', title: '' })] })
    )
    if (deck) open('deck', deck.id)
  }

  return (
    <div className={s.view}>
      <Toolbar active={active}>
        <div className={s.toolbar} ref={toolbarRef}>
          <TextField
            icon={<Search />}
            className={s.search}
            value={filter.query}
            placeholder="Filter library"
            onChange={(e) => setFilter({ query: e.target.value })}
            aria-label="Filter library"
          />
          {!tight && (
            <Select
              className={s.sort}
              value={filter.sort}
              onChange={(e) => setFilter({ sort: e.target.value as typeof filter.sort })}
              aria-label="Sort"
            >
              <option value="recent">Newest</option>
              <option value="name">Name</option>
              <option value="used">Most used</option>
            </Select>
          )}
          {!compact && (
            <Slider
              className={s.size}
              value={tileSize}
              min={120}
              max={300}
              step={4}
              ariaLabel="Tile size"
              onChange={(v) =>
                useApp.setState((st) =>
                  st.settings ? { settings: { ...st.settings, ui: { ...st.settings.ui, tileSize: v } } } : {}
                )
              }
              onCommit={(v) => void attempt('settings:update', { ui: { tileSize: v } })}
            />
          )}
          <div className={s.spacer} />
          {compact ? (
            <>
              <IconButton label="New slides" size="sm" onClick={newSlides}>
                <Type />
              </IconButton>
              <IconButton label="Import media" size="sm" onClick={() => importMedia()}>
                <Upload />
              </IconButton>
            </>
          ) : (
            <>
              <Button size="sm" variant="quiet" icon={<Type />} onClick={newSlides}>
                New slides
              </Button>
              <Button size="sm" icon={<Upload />} onClick={() => importMedia()}>
                Import
              </Button>
            </>
          )}
        </div>
      </Toolbar>
      <div className={s.body}>
        <nav className={s.nav}>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={clsx(s.navItem, filter.view === v.id && !filter.collection && s.navOn)}
              onClick={() => setFilter({ view: v.id, collection: null })}
            >
              {v.icon}
              <span>{v.label}</span>
            </button>
          ))}
          <Collections collections={collections} />
        </nav>
        <Grid
          list={list}
          tileSize={tileSize}
          selection={selection}
          setSelection={setSelection}
          empty={!Object.keys(items).length}
        />
      </div>
    </div>
  )
}

function Collections({ collections }: { collections: Collection[] }) {
  const filter = useUI((st) => st.library)
  const setFilter = useUI((st) => st.setLibrary)
  const items = useApp((st) => st.items)
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<Id | null>(null)
  const [dropTarget, setDropTarget] = useState<Id | null>(null)
  const counts = useMemo(() => {
    const c: Record<Id, number> = {}
    for (const item of Object.values(items)) for (const id of item.collections) c[id] = (c[id] ?? 0) + 1
    return c
  }, [items])
  return (
    <>
      <div className={s.navLabel}>
        Collections
        <IconButton label="New collection" size="sm" onClick={() => setAdding(true)}>
          <FolderPlus />
        </IconButton>
      </div>
      {collections.map((c) =>
        renaming === c.id ? (
          <NameInput
            key={c.id}
            value={c.name}
            onDone={(name) => {
              setRenaming(null)
              if (name) void attempt('library:collectionRename', c.id, name)
            }}
          />
        ) : (
          <ContextMenu
            key={c.id}
            items={[
              { label: 'Rename', icon: <Pencil />, onSelect: () => setRenaming(c.id) },
              {
                label: 'Delete collection',
                icon: <Trash />,
                danger: true,
                onSelect: () => {
                  if (filter.collection === c.id) setFilter({ collection: null })
                  void attempt('library:collectionRemove', c.id)
                }
              }
            ]}
          >
            <button
              className={clsx(
                s.navItem,
                filter.collection === c.id && s.navOn,
                dropTarget === c.id && s.navDrop
              )}
              onClick={() => setFilter({ collection: c.id, view: 'all' })}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_MEDIA)) return
                e.preventDefault()
                setDropTarget(c.id)
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => {
                setDropTarget(null)
                const ids = readMediaDrag(e.dataTransfer)
                if (!ids) return
                claimDrop(e)
                void attempt('library:setCollection', ids, c.id, true)
                toast.success(`Added to “${c.name}”`)
              }}
            >
              {filter.collection === c.id ? <FolderOpen size={15} /> : <Folder size={15} />}
              <span>{c.name}</span>
              <span className={s.navCount}>{counts[c.id] ?? 0}</span>
            </button>
          </ContextMenu>
        )
      )}
      {adding && (
        <NameInput
          value=""
          placeholder="Collection name"
          onDone={(name) => {
            setAdding(false)
            if (name) void attempt('library:collectionCreate', name)
          }}
        />
      )}
      {!collections.length && !adding && (
        <div className={s.navHint}>Group media for a series or season — e.g. “Easter 2027”.</div>
      )}
    </>
  )
}

function NameInput({
  value,
  placeholder,
  onDone
}: {
  value: string
  placeholder?: string
  onDone: (v: string | null) => void
}) {
  const [text, setText] = useState(value)
  return (
    <input
      className={s.navInput}
      autoFocus
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(text.trim() || null)
        if (e.key === 'Escape') onDone(null)
      }}
    />
  )
}

function Grid({
  list,
  tileSize,
  selection,
  setSelection,
  empty
}: {
  list: MediaItem[]
  tileSize: number
  selection: Id[]
  setSelection: (ids: Id[]) => void
  empty: boolean
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const anchor = useRef<number>(-1)
  const [renaming, setRenaming] = useState<Id | null>(null)
  const [dropping, setDropping] = useState(false)

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const gap = 14
  const padding = 16
  const columns = Math.max(1, Math.floor((width - padding * 2 + gap) / (tileSize + gap)))
  const tileW = columns > 0 ? (width - padding * 2 - gap * (columns - 1)) / columns : tileSize
  const rowH = tileW * (9 / 16) + 46 + gap
  const rows = Math.ceil(list.length / columns)
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowH,
    overscan: 4
  })

  useEffect(() => virtualizer.measure(), [rowH, virtualizer])

  // Scroll to an item revealed from elsewhere ("Show in library").
  useEffect(() => {
    const reveal = (e: Event) => {
      const index = list.findIndex((i) => i.id === (e as CustomEvent<string>).detail)
      if (index >= 0) virtualizer.scrollToIndex(Math.floor(index / columns), { align: 'center' })
    }
    window.addEventListener('cue:reveal-media', reveal)
    return () => window.removeEventListener('cue:reveal-media', reveal)
  }, [list, columns, virtualizer])

  const click = (e: React.MouseEvent, index: number) => {
    const id = list[index].id
    if (e.shiftKey && anchor.current >= 0) {
      const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)]
      setSelection(list.slice(a, b + 1).map((i) => i.id))
      return
    }
    if (e.metaKey || e.ctrlKey) {
      anchor.current = index
      setSelection(selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id])
      return
    }
    anchor.current = index
    setSelection([id])
    if (list[index].status !== 'error') previewMedia(id)
  }

  const onDrop = (e: React.DragEvent) => {
    setDropping(false)
    const paths = droppedPaths(e.dataTransfer)
    if (!paths.length) return
    claimDrop(e)
    void importPaths(paths)
  }

  // One scroll element for both states, so its size is tracked from the first import on.
  return (
    <div
      ref={scroller}
      className={clsx(s.grid, dropping && s.gridDrop)}
      onClick={(e) => e.target === e.currentTarget && setSelection([])}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDropping(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={onDrop}
    >
      {empty ? (
        <EmptyState
          icon={<Upload />}
          title="Your library is empty"
          action={
            <Button icon={<Upload />} onClick={() => importMedia()}>
              Import media
            </Button>
          }
        >
          Drag photos, videos, PDFs and audio here — or search the web and save what you find. Everything is
          copied into Cue so it works offline.
        </EmptyState>
      ) : !list.length ? (
        <EmptyState compact icon={<Search />} title="Nothing here">
          No media matches this view.
        </EmptyState>
      ) : (
        width > 0 && (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((row) => (
              <div
                key={row.key}
                className={s.gridRow}
                style={{
                  transform: `translateY(${row.start}px)`,
                  gridTemplateColumns: `repeat(${columns}, ${tileW}px)`,
                  gap
                }}
              >
                {list.slice(row.index * columns, row.index * columns + columns).map((item, i) => {
                  const index = row.index * columns + i
                  return (
                    <Tile
                      key={item.id}
                      item={item}
                      selected={selection.includes(item.id)}
                      selection={selection}
                      renaming={renaming === item.id}
                      onRename={() => setRenaming(item.id)}
                      onRenamed={() => setRenaming(null)}
                      onClick={(e) => click(e, index)}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}

function Tile({
  item,
  selected,
  selection,
  renaming,
  onRename,
  onRenamed,
  onClick
}: {
  item: MediaItem
  selected: boolean
  selection: Id[]
  renaming: boolean
  onRename: () => void
  onRenamed: () => void
  onClick: (e: React.MouseEvent) => void
}) {
  const show = useShow()!
  const collections = useApp((st) => st.collections)
  const open = useUI((st) => st.open)
  const live = show.live?.mediaId === item.id
  const preview = show.preview?.mediaId === item.id
  const targets = selected && selection.length > 1 ? selection : [item.id]
  const [name, setName] = useState(item.name)

  const remove = async () => {
    const count = targets.length
    const ok = window.confirm(
      count === 1 ? `Delete “${item.name}” from your library?` : `Delete ${count} items from your library?`
    )
    if (!ok) return
    await attempt('library:remove', targets)
    useUI.getState().setSelection([])
  }

  const menu = (): MenuEntry[] => [
    {
      label: 'Preview',
      icon: <Eye />,
      onSelect: () => previewMedia(item.id),
      disabled: item.status === 'error'
    },
    {
      label: 'Show now',
      icon: <Play />,
      onSelect: () => showMedia(item.id),
      disabled: item.status === 'error'
    },
    { type: 'separator' },
    {
      label: targets.length > 1 ? `Add ${targets.length} to plan` : 'Add to service plan',
      icon: <Plus />,
      onSelect: () => void addMediaToPlan(targets)
    },
    item.kind === 'deck' && { label: 'Edit slides…', icon: <Type />, onSelect: () => open('deck', item.id) },
    {
      label: item.favorite ? 'Remove from favorites' : 'Add to favorites',
      icon: <Star />,
      onSelect: () =>
        targets.forEach((id) => void attempt('library:update', id, { favorite: !item.favorite }))
    },
    {
      type: 'sub',
      label: 'Collection',
      icon: <Folder />,
      items: [
        ...collections.map((c): MenuEntry => ({
          type: 'check',
          label: c.name,
          checked: item.collections.includes(c.id),
          onSelect: () =>
            void attempt('library:setCollection', targets, c.id, !item.collections.includes(c.id))
        })),
        collections.length > 0 && { type: 'separator' },
        {
          label: 'New collection…',
          icon: <FolderPlus />,
          onSelect: async () => {
            const name = window.prompt('Name for the new collection')
            if (!name?.trim()) return
            const col = await attempt('library:collectionCreate', name.trim())
            if (col) void attempt('library:setCollection', targets, col.id, true)
          }
        }
      ]
    },
    !item.saved && {
      label: 'Save to library',
      icon: <Star />,
      onSelect: () => void attempt('library:update', item.id, { saved: true })
    },
    { type: 'separator' },
    { label: 'Rename', icon: <Pencil />, onSelect: onRename },
    item.kind === 'deck' && {
      label: 'Duplicate',
      icon: <Copy />,
      onSelect: () => void attempt('library:duplicate', item.id)
    },
    item.file && {
      label: 'Show file',
      icon: <FolderOpen />,
      onSelect: () => void attempt('library:reveal', item.id)
    },
    (item.status === 'error' || item.kind === 'pdf') &&
      item.kind !== 'deck' && {
        label: 'Process again',
        icon: <RotateCcw />,
        onSelect: () => void attempt('library:reprocess', item.id)
      },
    { type: 'separator' },
    {
      label: targets.length > 1 ? `Delete ${targets.length} items` : 'Delete',
      icon: <Trash />,
      danger: true,
      onSelect: () => void remove()
    }
  ]

  return (
    <ContextMenu items={menu}>
      <div
        className={clsx(
          s.tile,
          selected && s.selected,
          live && s.tileLive,
          preview && !live && s.tilePreview,
          item.status === 'error' && s.tileError
        )}
        onClick={onClick}
        onDoubleClick={() => item.status !== 'error' && showMedia(item.id)}
        draggable={!renaming}
        onDragStart={(e) => setMediaDrag(e, targets)}
        data-testid="library-tile"
        title={item.error ?? item.name}
      >
        <div className={s.tileThumb}>
          <MediaThumb item={item} className={s.tileImg} />
          {item.kind === 'video' && item.duration ? (
            <span className={s.badge}>{formatTime(item.duration)}</span>
          ) : null}
          {item.animated && <span className={s.badge}>GIF</span>}
          {item.status === 'processing' && (
            <span className={s.processing}>
              <Spinner size={12} />
              {item.kind === 'pdf' && item.pageCount
                ? `${item.pagesReady ?? 0}/${item.pageCount}`
                : 'Preparing'}
            </span>
          )}
          {live && <span className={clsx(s.tag, s.tagLive)}>Live</span>}
          <button
            className={clsx(s.fav, item.favorite && s.favOn)}
            aria-label={item.favorite ? 'Remove from favorites' : 'Add to favorites'}
            onClick={(e) => {
              e.stopPropagation()
              void attempt('library:update', item.id, { favorite: !item.favorite })
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Star size={13} />
          </button>
        </div>
        <div className={s.tileText}>
          {renaming ? (
            <input
              className={s.tileInput}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => {
                onRenamed()
                if (name.trim() && name.trim() !== item.name)
                  void attempt('library:update', item.id, { name: name.trim() })
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') {
                  setName(item.name)
                  onRenamed()
                }
              }}
            />
          ) : (
            <div className={s.tileName}>{item.name}</div>
          )}
          <div className={s.tileMeta}>{item.status === 'error' ? 'Can’t be shown' : itemSubtitle(item)}</div>
        </div>
      </div>
    </ContextMenu>
  )
}
