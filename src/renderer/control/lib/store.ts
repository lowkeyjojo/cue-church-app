import { create } from 'zustand'
import type {
  AppInfo,
  Collection,
  DisplaysSnapshot,
  HistoryEntry,
  Id,
  MediaItem,
  PlaybackStatus,
  Plan,
  Settings,
  ShowState
} from '@shared/types'
import { bridge, call } from './api'
import { useToasts } from './toasts'

/** Mirror of the main process's state. Main is the single source of truth. */
export interface AppState {
  ready: boolean
  info: AppInfo | null
  show: ShowState | null
  playback: PlaybackStatus | null
  items: Record<Id, MediaItem>
  collections: Collection[]
  plans: Plan[]
  history: HistoryEntry[]
  settings: Settings | null
  displays: DisplaysSnapshot | null
  progress: Record<string, { label: string; done: number; total: number }>
}

export const useApp = create<AppState>(() => ({
  ready: false,
  info: null,
  show: null,
  playback: null,
  items: {},
  collections: [],
  plans: [],
  history: [],
  settings: null,
  displays: null,
  progress: {}
}))

const set = useApp.setState
const get = useApp.getState

/** Subscribe to main-process events, then load the initial snapshot. */
export async function bootstrap(): Promise<void> {
  bridge.on('show:state', (show) => {
    const current = get().show
    if (!current || show.rev >= current.rev) set({ show })
  })
  bridge.on('show:playback', (playback) => set({ playback }))
  bridge.on('library:upsert', (items) => {
    const next = { ...get().items }
    for (const item of items) next[item.id] = item
    set({ items: next })
  })
  bridge.on('library:remove', (ids) => {
    const next = { ...get().items }
    for (const id of ids) delete next[id]
    set({ items: next })
  })
  bridge.on('library:collections', (collections) => set({ collections }))
  bridge.on('plans:changed', (plans) => set({ plans }))
  bridge.on('history:changed', (history) => set({ history }))
  bridge.on('settings:changed', (settings) => set({ settings }))
  bridge.on('displays:changed', (displays) => set({ displays }))
  bridge.on('toast', (t) => useToasts.getState().push(t))
  bridge.on('progress', (p) => {
    const progress = { ...get().progress }
    if (p.finished) delete progress[p.id]
    else progress[p.id] = { label: p.label, done: p.done, total: p.total }
    set({ progress })
  })

  const [info, show, playback, library, plans, history, settings, displays] = await Promise.all([
    call('app:info'),
    call('show:get'),
    call('show:playback'),
    call('library:list'),
    call('plans:list'),
    call('history:list'),
    call('settings:get'),
    call('displays:get')
  ])
  const items: Record<Id, MediaItem> = {}
  for (const item of library.items) items[item.id] = item
  const current = get().show
  set({
    ready: true,
    info,
    show: current && current.rev > show.rev ? current : show,
    playback,
    items,
    collections: library.collections,
    plans,
    history,
    settings,
    displays
  })
}

export const useShow = () => useApp((s) => s.show)
export const useSettings = () => useApp((s) => s.settings)
export const useItem = (id: Id | undefined) => useApp((s) => (id ? s.items[id] : undefined))
