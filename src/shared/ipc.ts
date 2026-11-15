/**
 * Typed IPC contracts. The control window talks to main exclusively through
 * `CueApi` (request/response) and `CueEvents` (main -> renderer broadcasts).
 */
import type { Passage, TranslationId } from './scripture'
import type {
  AppInfo,
  Collection,
  Deck,
  DisplaysSnapshot,
  HistoryEntry,
  Id,
  LibrarySnapshot,
  MediaItem,
  OutputConfig,
  OutputMode,
  Plan,
  PlanEntry,
  PlaybackStatus,
  ProgressInfo,
  SearchFilters,
  SearchProviderId,
  SearchResponse,
  Settings,
  SettingsPatch,
  ShowCommand,
  ShowState,
  Toast,
  WebPick
} from './types'

/** The fields the control window may change on a library item. */
export const MEDIA_ITEM_EDITABLE = ['name', 'favorite', 'tags', 'defaults', 'collections', 'saved'] as const

export type MediaItemPatch = Partial<Pick<MediaItem, (typeof MEDIA_ITEM_EDITABLE)[number]>>

export type NewPlanEntry = Omit<PlanEntry, 'id'>

export type ImportResult = { items: MediaItem[]; skipped: { path: string; reason: string }[] }

export interface CueApi {
  'app:info': () => AppInfo
  'app:quit': () => void

  'show:get': () => ShowState
  'show:dispatch': (cmd: ShowCommand) => void
  'show:playback': () => PlaybackStatus | null

  'library:list': () => LibrarySnapshot
  'library:import': (paths?: string[], opts?: { collectionId?: Id }) => ImportResult
  'library:importData': (data: Uint8Array, name: string, mime?: string) => MediaItem
  'library:importWeb': (pick: WebPick, opts?: { save?: boolean }) => MediaItem
  'library:update': (id: Id, patch: MediaItemPatch) => MediaItem | null
  'library:remove': (ids: Id[]) => void
  'library:reveal': (id: Id) => void
  'library:createDeck': (name: string, deck?: Deck, opts?: { saved?: boolean }) => MediaItem
  /** Look up a Bible passage ("John 3:16", "Psalm 23") in the bundled translations. */
  'scripture:passage': (reference: string, translation?: TranslationId) => Passage & { book: string }
  'library:updateDeck': (id: Id, deck: Deck) => MediaItem | null
  'library:duplicate': (id: Id) => MediaItem | null
  'library:reprocess': (id: Id) => void
  'library:collectionCreate': (name: string) => Collection
  'library:collectionRename': (id: Id, name: string) => void
  'library:collectionRemove': (id: Id) => void
  'library:setCollection': (ids: Id[], collectionId: Id, member: boolean) => void

  'plans:list': () => Plan[]
  'plans:create': (name: string, date?: string) => Plan
  'plans:update': (id: Id, patch: Partial<Pick<Plan, 'name' | 'date'>>) => Plan | null
  'plans:remove': (id: Id) => void
  'plans:duplicate': (id: Id) => Plan | null
  'plans:addEntries': (planId: Id, entries: NewPlanEntry[], index?: number) => PlanEntry[]
  'plans:updateEntry': (planId: Id, entryId: Id, patch: Partial<Omit<PlanEntry, 'id'>>) => void
  'plans:removeEntries': (planId: Id, entryIds: Id[]) => void
  'plans:moveEntries': (planId: Id, entryIds: Id[], toIndex: number) => void
  'plans:export': (planId: Id) => string | null
  'plans:import': () => Plan | null

  'history:list': () => HistoryEntry[]
  'history:clear': () => void

  'settings:get': () => Settings
  'settings:update': (patch: SettingsPatch) => Settings

  'displays:get': () => DisplaysSnapshot
  'displays:identify': () => void
  'output:set': (opts: { mode?: OutputMode; displayId?: number | null }) => DisplaysSnapshot

  'search:query': (
    provider: SearchProviderId,
    query: string,
    page: number,
    filters: SearchFilters
  ) => SearchResponse

  'system:openExternal': (url: string) => void
  'system:chooseFiles': (kind?: 'media' | 'image' | 'video') => string[]
  'system:revealLogs': () => void
  'system:revealLibrary': () => void
  /** Copy the image at a point (in control-window coordinates) out of the embedded browser. */
  'system:copyImageAt': (
    webContentsId: number,
    x: number,
    y: number,
    pick: WebPick,
    opts?: { save?: boolean }
  ) => MediaItem | null
}

export type CueMethod = keyof CueApi
export type CueArgs<M extends CueMethod> = Parameters<CueApi[M]>
export type CueResult<M extends CueMethod> = Awaited<ReturnType<CueApi[M]>>

/** Commands main can push to the control UI (menus, global shortcuts, webview keys). */
export type UiCommand =
  | 'open-settings'
  | 'open-palette'
  | 'import'
  | 'quick-slide'
  | 'new-plan'
  | 'tab-show'
  | 'tab-search'
  | 'tab-library'
  | 'focus-search'
  | 'about'
  | 'shortcuts'

export interface CueEvents {
  'show:state': ShowState
  'show:playback': PlaybackStatus | null
  'library:upsert': MediaItem[]
  'library:remove': Id[]
  'library:collections': Collection[]
  'plans:changed': Plan[]
  'history:changed': HistoryEntry[]
  'settings:changed': Settings
  'displays:changed': DisplaysSnapshot
  toast: Toast
  progress: ProgressInfo
  'ui:command': UiCommand
  /** A plan was opened from a .cueplan file; bring it up. */
  'plans:open': Id
}

export type CueEvent = keyof CueEvents

/** How main answers `cue:invoke`: failures come back as values rather than rejections. */
export type InvokeReply = { ok: true; value: unknown } | { ok: false; error: string }

/** The bridge exposed on `window.cue` in the control window. */
export interface CueBridge {
  invoke<M extends CueMethod>(method: M, ...args: CueArgs<M>): Promise<CueResult<M>>
  on<E extends CueEvent>(event: E, listener: (payload: CueEvents[E]) => void): () => void
  /** Absolute filesystem path for a dropped File (empty string if not a local file). */
  pathForFile(file: File): string
  platform: string
}

// ---------------------------------------------------------------------------
// Audience output window
// ---------------------------------------------------------------------------

export interface OutputIdentify {
  index: number
  label: string
  detail: string
}

export interface OutputBridge {
  onState(listener: (state: ShowState) => void): () => void
  onConfig(listener: (config: OutputConfig) => void): () => void
  onIdentify(listener: (info: OutputIdentify | null) => void): () => void
  reportPlayback(status: PlaybackStatus | null): void
  ready(): void
}

// ---------------------------------------------------------------------------
// Hidden media worker window
// ---------------------------------------------------------------------------

export type WorkerTask =
  | { id: string; type: 'image'; src: string; thumbSize: number }
  | { id: string; type: 'video'; src: string; thumbSize: number }
  | { id: string; type: 'audio'; src: string }
  | {
      id: string
      type: 'pdf'
      src: string
      maxWidth: number
      maxHeight: number
      thumbSize: number
      /** 1-based page to resume from. */
      fromPage: number
    }

export interface ImageProbe {
  width: number
  height: number
  thumb: Uint8Array
}

export interface VideoProbe {
  width: number
  height: number
  duration: number
  thumb: Uint8Array
}

export type WorkerReply =
  | { id: string; kind: 'done'; data: ImageProbe | VideoProbe | { duration: number } | { pageCount: number } }
  | { id: string; kind: 'error'; error: string }
  | { id: string; kind: 'pdf-meta'; pageCount: number; width: number; height: number }
  | {
      id: string
      kind: 'pdf-page'
      page: number
      pageCount: number
      image: Uint8Array
      thumb: Uint8Array
      width: number
      height: number
    }

export interface WorkerBridge {
  onTask(listener: (task: WorkerTask) => void): () => void
  reply(reply: WorkerReply): void
  ready(): void
}
