/**
 * Cue's shared data model. Everything that crosses a process boundary
 * (main <-> control <-> audience <-> worker) is described here.
 */

export type Id = string

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export type MediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'deck'

export type SearchProviderId = 'google' | 'wikimedia' | 'openverse' | 'pexels'

/** Where a library item came from; kept so the operator can always credit the source. */
export interface MediaSource {
  type: 'file' | 'web' | 'paste' | 'builtin' | 'created'
  originalPath?: string
  url?: string
  pageUrl?: string
  provider?: SearchProviderId
  query?: string
  title?: string
  author?: string
  license?: string
  licenseUrl?: string
}

export type FitMode = 'fit' | 'fill' | 'blur'

export type VideoEndAction = 'hold' | 'loop' | 'black' | 'ambient' | 'clear'

/** Per-item presentation options. Unset fields fall back to item defaults, then app settings. */
export interface PresentOptions {
  fit?: FitMode
  loop?: boolean
  volume?: number
  startAt?: number
  endAt?: number
  endAction?: VideoEndAction
  autoplay?: boolean
}

export interface MediaItem {
  id: Id
  kind: MediaKind
  name: string
  /** File name of the original inside the item's folder. */
  file?: string
  mime?: string
  bytes?: number
  /** SHA-1 of the original bytes, used to avoid duplicate imports. */
  hash?: string
  width?: number
  height?: number
  /** Seconds, for video/audio. */
  duration?: number
  animated?: boolean
  /** PDF page count and how many pages have been rendered so far. */
  pageCount?: number
  pagesReady?: number
  /** File name of the thumbnail inside the item's folder. */
  thumb?: string
  status: 'ready' | 'processing' | 'error'
  error?: string
  /** Slide content, for kind === 'deck'. */
  deck?: Deck
  source: MediaSource
  /** False for transient items (web picks, pastes) that are not yet part of the library. */
  saved: boolean
  favorite: boolean
  collections: Id[]
  tags: string[]
  defaults?: PresentOptions
  createdAt: number
  updatedAt: number
  lastShownAt?: number
  showCount: number
}

export interface Collection {
  id: Id
  name: string
  createdAt: number
}

export interface LibrarySnapshot {
  items: MediaItem[]
  collections: Collection[]
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

export type FontId = 'inter' | 'montserrat' | 'playfair' | 'lora' | 'source-serif' | 'oswald' | 'bebas'

export type SlideLayout = 'title' | 'title-body' | 'body' | 'scripture' | 'lower-third' | 'big'

export interface SlideBackground {
  type: 'color' | 'gradient' | 'media'
  color?: string
  gradient?: { from: string; to: string; angle: number }
  mediaId?: Id
  /** 0..1 darkening overlay to keep text readable over photos. */
  dim?: number
  /** Background blur in px at 1080p. */
  blur?: number
}

export interface SlideTheme {
  font: FontId
  titleFont: FontId
  textColor: string
  accentColor: string
  align: 'left' | 'center' | 'right'
  vAlign: 'top' | 'middle' | 'bottom'
  /** Text size multiplier, 0.6..1.6 */
  scale: number
  shadow: boolean
  uppercaseTitle: boolean
}

export interface Slide {
  id: Id
  layout: SlideLayout
  title?: string
  body?: string
  /** Reference / attribution line (e.g. "John 3:16"). */
  footer?: string
  background?: SlideBackground
  theme?: Partial<SlideTheme>
  /** Private operator notes, never shown on the audience screen. */
  notes?: string
}

export interface Deck {
  slides: Slide[]
  theme: SlideTheme
  background: SlideBackground
}

// ---------------------------------------------------------------------------
// Ambient
// ---------------------------------------------------------------------------

export type AmbientThemeId = 'ember' | 'dawn' | 'ocean' | 'aurora' | 'graphite'

export interface AmbientOverlay {
  kind: 'none' | 'text' | 'clock' | 'countdown'
  text?: string
  subtext?: string
  /** Countdown target as local "HH:MM" (today). Used when countdownMinutes is unset. */
  countdownTo?: string
  /** Countdown duration in minutes, measured from the moment the ambient goes live. */
  countdownMinutes?: number
  countdownEndText?: string
  position: 'center' | 'bottom' | 'lower-left'
  font?: FontId
}

export interface AmbientConfig {
  source: 'theme' | 'media'
  theme: AmbientThemeId
  /** Playlist of image/video library items when source === 'media'. */
  mediaIds: Id[]
  /** Seconds each still image is shown. */
  interval: number
  kenBurns: boolean
  shuffle: boolean
  /** 0..1 darkening applied over the background (helps overlay text). */
  dim: number
  overlay: AmbientOverlay
}

// ---------------------------------------------------------------------------
// Service plans
// ---------------------------------------------------------------------------

export type PlanEntryType = 'media' | 'ambient' | 'section' | 'color'

export interface PlanEntry {
  id: Id
  type: PlanEntryType
  mediaId?: Id
  /** Title override, or the section heading for type === 'section'. */
  title?: string
  options?: PresentOptions
  ambient?: AmbientConfig
  color?: string
  /** Private operator notes. */
  notes?: string
}

export interface Plan {
  id: Id
  name: string
  /** ISO date (YYYY-MM-DD) of the service, optional. */
  date?: string
  entries: PlanEntry[]
  createdAt: number
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Show (live state)
// ---------------------------------------------------------------------------

export type PresentationKind = 'image' | 'video' | 'audio' | 'pdf' | 'deck' | 'color' | 'ambient'

/** Normalized zoom: `x`/`y` are the stage point (0..1) shown at the center. */
export interface Zoom {
  scale: number
  x: number
  y: number
}

export interface VideoTransport {
  playing: boolean
  /** Bumping `nonce` asks the output to jump to `time`. */
  seek: { time: number; nonce: number }
}

export interface ResolvedAmbient {
  config: AmbientConfig
  /** Library items for the playlist, resolved to URLs. */
  media: { id: Id; kind: 'image' | 'video'; src: string; width?: number; height?: number }[]
  /** Absolute countdown target (epoch ms), resolved when the ambient goes live. */
  countdownTarget?: number
}

/**
 * A fully-resolved description of something on screen. Renderers never need to
 * look anything up in the library: everything they need is in here.
 */
export interface Presentation {
  /** Unique per instance; a new id means "transition to this". */
  id: Id
  kind: PresentationKind
  title: string
  subtitle?: string
  mediaId?: Id
  planId?: Id
  entryId?: Id
  src?: string
  thumb?: string
  width?: number
  height?: number
  duration?: number
  animated?: boolean
  /** Paged content (pdf / deck): current page (0-based) and count. */
  page?: number
  pageCount?: number
  /** Base URL for rendered pdf pages: `${pageBase}${n}.webp`, n 1-based zero-padded to 4. */
  pageBase?: string
  deck?: Deck
  /** Resolved slide background media for decks, keyed by media id. */
  deckMedia?: Record<Id, { kind: 'image' | 'video'; src: string }>
  color?: string
  ambient?: ResolvedAmbient
  fit: FitMode
  zoom?: Zoom
  loop?: boolean
  volume?: number
  startAt?: number
  endAt?: number
  endAction?: VideoEndAction
  transport?: VideoTransport
  /** Attribution line for web media. */
  credit?: string
}

export type TransitionKind = 'cut' | 'fade' | 'dip'

export interface TransitionSettings {
  kind: TransitionKind
  /** Milliseconds. */
  duration: number
}

export interface PlaybackStatus {
  presentationId: Id
  currentTime: number
  duration: number
  paused: boolean
  ended: boolean
  buffering: boolean
  error?: string
  /** Epoch ms when this status was sampled. */
  at: number
}

export interface ShowState {
  preview: Presentation | null
  live: Presentation | null
  /** The presentation that "Back" returns to (e.g. sermon slides at the page you left). */
  back: Presentation | null
  blackout: boolean
  ambient: { active: boolean; presentation: Presentation | null }
  transition: TransitionSettings
  audio: { volume: number; muted: boolean }
  testPattern: boolean
  /** The plan entry most recently taken live: the "playhead" of the service plan. */
  cursor: { planId: Id; entryId: Id } | null
  /** Increments on every change. */
  rev: number
}

export type ShowTarget =
  | { type: 'media'; mediaId: Id; page?: number; options?: PresentOptions }
  | { type: 'entry'; planId: Id; entryId: Id; page?: number }
  | { type: 'color'; color: string; title?: string }
  | { type: 'ambient'; config?: AmbientConfig; title?: string }
  | { type: 'slide'; slide: Slide; theme?: SlideTheme; background?: SlideBackground; title?: string }
  | { type: 'presentation'; presentation: Presentation }

export type ShowCommand =
  | { type: 'preview'; target: ShowTarget | null }
  | { type: 'take' }
  | { type: 'show'; target: ShowTarget }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'goto'; where: 'live' | 'preview'; page: number }
  | { type: 'blackout'; on?: boolean }
  | { type: 'ambient'; on?: boolean }
  | { type: 'clear' }
  | { type: 'back' }
  | { type: 'fit'; where: 'live' | 'preview'; fit: FitMode }
  | { type: 'zoom'; where: 'live' | 'preview'; zoom: Zoom | null }
  | { type: 'video'; action: 'play' | 'pause' | 'toggle' | 'restart' }
  | { type: 'seek'; time: number }
  | { type: 'loop'; on: boolean }
  | { type: 'video-volume'; volume: number }
  | { type: 'volume'; volume: number }
  | { type: 'mute'; on?: boolean }
  | { type: 'transition'; transition: Partial<TransitionSettings> }
  | { type: 'test-pattern'; on?: boolean }

export interface HistoryEntry {
  id: Id
  at: number
  title: string
  subtitle?: string
  kind: PresentationKind
  mediaId?: Id
  thumb?: string
  presentation: Presentation
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchFilters {
  licensedOnly?: boolean
  safeSearch?: boolean
  size?: 'any' | 'large'
  type?: 'any' | 'photo' | 'clipart' | 'lineart' | 'animated'
  /** For providers that have both (Pexels). */
  media?: 'image' | 'video'
}

export interface SearchResult {
  id: string
  provider: SearchProviderId
  kind: 'image' | 'video'
  thumbUrl: string
  url: string
  pageUrl?: string
  width?: number
  height?: number
  title?: string
  author?: string
  license?: string
  licenseUrl?: string
  mime?: string
  duration?: number
}

export interface SearchResponse {
  results: SearchResult[]
  nextPage: number | null
  total?: number
  error?: string
}

/** An image the operator picked on the web (search grid, Google, paste, drag). */
export interface WebPick {
  url: string
  thumbUrl?: string
  pageUrl?: string
  title?: string
  width?: number
  height?: number
  provider?: SearchProviderId
  query?: string
  author?: string
  license?: string
  licenseUrl?: string
  kind?: 'image' | 'video'
}

// ---------------------------------------------------------------------------
// Displays & output
// ---------------------------------------------------------------------------

export type OutputMode = 'auto' | 'fullscreen' | 'window' | 'off'

export interface DisplayInfo {
  id: number
  label: string
  bounds: Rect
  scaleFactor: number
  primary: boolean
  internal: boolean
  /** True if the control window is (mostly) on this display. */
  hasControl: boolean
}

export interface OutputStatus {
  mode: OutputMode
  /** Is the audience window currently visible somewhere? */
  active: boolean
  windowed: boolean
  displayId: number | null
  displayLabel: string
  width: number
  height: number
  /** Why the output is not fullscreen, if relevant (shown to the operator). */
  note?: string
}

export interface DisplaysSnapshot {
  displays: DisplayInfo[]
  output: OutputStatus
}

/** Visual configuration the audience window needs besides the show state. */
export interface OutputConfig {
  background: string
  /** Overscan compensation, percent of each edge (0..10). */
  inset: number
  showCredits: boolean
  audioDeviceId: string
  name: string
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface Settings {
  version: 1
  output: {
    mode: OutputMode
    displayId: number | null
    /** "label|WxH" of the chosen display, used to find it again after reconnects. */
    displayKey?: string
    windowBounds?: Rect
    background: string
    inset: number
    showCredits: boolean
    defaultFit: FitMode
    /** What the operator calls the audience screen ("TV", "Projector", "Screen"). */
    name: string
    startup: 'black' | 'ambient'
  }
  transition: TransitionSettings
  audio: { deviceId: string; volume: number }
  search: {
    safeSearch: boolean
    defaultProvider: SearchProviderId
    licensedOnly: boolean
    autoPreview: boolean
    pexelsKey: string
  }
  ambient: AmbientConfig
  presenter: {
    /** At the last page, should "Next" move on to the next plan item? */
    nextAcrossItems: boolean
    /** After taking a plan item live, load the following item into Preview. */
    autoStandby: boolean
    /** Clicking a page of the presentation that is already live shows it immediately. */
    livePageClick: boolean
  }
  slides: {
    renderQuality: 1080 | 1440 | 2160
    theme: SlideTheme
    background: SlideBackground
  }
  ui: {
    leftWidth: number
    rightWidth: number
    tileSize: number
    tab: 'show' | 'search' | 'library'
    planId?: Id
    firstRunDone: boolean
    controlBounds?: Rect
    maximized?: boolean
  }
}

export type SettingsPatch = {
  [K in keyof Settings]?: Settings[K] extends object ? Partial<Settings[K]> : Settings[K]
}

// ---------------------------------------------------------------------------
// App / misc
// ---------------------------------------------------------------------------

export interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  electron: string
  chrome: string
  dataPath: string
  libraryPath: string
  logsPath: string
  e2e: boolean
  /** Test-only override for the Google Images base URL. */
  googleBase?: string
}

export interface Toast {
  id?: string
  kind: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  /** ms; 0 keeps it until dismissed. */
  duration?: number
}

export interface ProgressInfo {
  id: string
  label: string
  done: number
  total: number
  finished?: boolean
}
