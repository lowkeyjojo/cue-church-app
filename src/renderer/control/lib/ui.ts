import { create } from 'zustand'
import type { Id, SearchFilters, SearchProviderId } from '@shared/types'

export type Tab = 'show' | 'search' | 'library'

/** What the Show tab is displaying in detail. */
export type Focus = { type: 'entry'; planId: Id; entryId: Id } | { type: 'media'; mediaId: Id } | null

export type LibraryView =
  'all' | 'image' | 'video' | 'pdf' | 'deck' | 'audio' | 'favorites' | 'recent' | 'web'

export interface LibraryFilter {
  view: LibraryView
  collection: Id | null
  query: string
  sort: 'recent' | 'name' | 'used'
}

/** An image reported by the embedded Google pane. */
export interface GuestPick {
  url: string
  thumbUrl?: string
  full: boolean
  pageUrl?: string
  title?: string
  width?: number
  height?: number
  x: number
  y: number
}

export interface SearchState {
  provider: SearchProviderId
  query: string
  submitted: string
  filters: SearchFilters
  pick: GuestPick | null
  /** Media id of the item the current pick was ingested as. */
  pickedMediaId: Id | null
  busy: boolean
}

export interface Dialogs {
  settings: string | null
  palette: boolean
  quickSlide: { text?: string } | null
  ambient: { planId?: Id; entryId?: Id } | null
  deck: Id | null
  welcome: boolean
  shortcuts: boolean
  about: boolean
}

interface UIState {
  tab: Tab
  focus: Focus
  planId: Id | null
  selection: Id[]
  library: LibraryFilter
  search: SearchState
  dialogs: Dialogs
  setTab(tab: Tab): void
  setFocus(focus: Focus, opts?: { showTab?: boolean }): void
  setPlan(planId: Id | null): void
  setSelection(ids: Id[]): void
  setLibrary(patch: Partial<LibraryFilter>): void
  setSearch(patch: Partial<SearchState>): void
  open<K extends keyof Dialogs>(dialog: K, value: Dialogs[K]): void
  close(dialog: keyof Dialogs): void
}

const closedDialogs: Dialogs = {
  settings: null,
  palette: false,
  quickSlide: null,
  ambient: null,
  deck: null,
  welcome: false,
  shortcuts: false,
  about: false
}

export const useUI = create<UIState>((set, get) => ({
  tab: 'search',
  focus: null,
  planId: null,
  selection: [],
  library: { view: 'all', collection: null, query: '', sort: 'recent' },
  search: {
    provider: 'google',
    query: '',
    submitted: '',
    filters: { licensedOnly: false, size: 'any', type: 'any', media: 'image' },
    pick: null,
    pickedMediaId: null,
    busy: false
  },
  dialogs: closedDialogs,
  setTab: (tab) => set({ tab }),
  setFocus: (focus, opts) => set({ focus, ...(opts?.showTab ? { tab: 'show' as Tab } : {}) }),
  setPlan: (planId) => set({ planId }),
  setSelection: (selection) => set({ selection }),
  setLibrary: (patch) => set({ library: { ...get().library, ...patch } }),
  setSearch: (patch) => set({ search: { ...get().search, ...patch } }),
  open: (dialog, value) => set({ dialogs: { ...get().dialogs, [dialog]: value } }),
  close: (dialog) => set({ dialogs: { ...get().dialogs, [dialog]: closedDialogs[dialog] } })
}))

/** Is any modal surface open (so live shortcuts should stand down)? */
export function anyDialogOpen(): boolean {
  const d = useUI.getState().dialogs
  return !!(
    d.settings ||
    d.palette ||
    d.quickSlide ||
    d.ambient ||
    d.deck ||
    d.welcome ||
    d.shortcuts ||
    d.about
  )
}
