import type {
  AmbientConfig,
  Deck,
  FontId,
  Settings,
  Slide,
  SlideBackground,
  SlideTheme,
  TransitionSettings
} from './types'

export const DEFAULT_TRANSITION: TransitionSettings = { kind: 'fade', duration: 500 }

export const DEFAULT_AMBIENT: AmbientConfig = {
  source: 'theme',
  theme: 'ember',
  mediaIds: [],
  interval: 12,
  kenBurns: true,
  shuffle: false,
  dim: 0.15,
  overlay: {
    kind: 'none',
    text: 'Welcome',
    subtext: "We're glad you're here",
    countdownMinutes: 5,
    countdownEndText: 'Starting now',
    position: 'center'
  }
}

export const DEFAULT_SLIDE_THEME: SlideTheme = {
  font: 'inter',
  titleFont: 'montserrat',
  textColor: '#FFFFFF',
  accentColor: '#F2A33A',
  align: 'center',
  vAlign: 'middle',
  scale: 1,
  shadow: true,
  uppercaseTitle: false
}

export const DEFAULT_SLIDE_BACKGROUND: SlideBackground = {
  type: 'gradient',
  gradient: { from: '#1B1C21', to: '#0B0C0E', angle: 160 },
  dim: 0
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  output: {
    mode: 'auto',
    displayId: null,
    background: '#000000',
    inset: 0,
    showCredits: false,
    defaultFit: 'fit',
    name: 'TV',
    startup: 'black'
  },
  transition: DEFAULT_TRANSITION,
  audio: { deviceId: 'default', volume: 1 },
  search: {
    safeSearch: true,
    defaultProvider: 'google',
    licensedOnly: false,
    autoPreview: true,
    pexelsKey: ''
  },
  ambient: DEFAULT_AMBIENT,
  presenter: {
    nextAcrossItems: false,
    autoStandby: true,
    livePageClick: true
  },
  slides: {
    renderQuality: 1440,
    theme: DEFAULT_SLIDE_THEME,
    background: DEFAULT_SLIDE_BACKGROUND
  },
  ui: {
    leftWidth: 288,
    rightWidth: 420,
    tileSize: 176,
    tab: 'search',
    firstRunDone: false
  }
}

export const FONTS: { id: FontId; label: string; family: string; kind: 'sans' | 'serif' | 'display' }[] = [
  { id: 'inter', label: 'Inter', family: "'Inter Variable', 'Inter', system-ui, sans-serif", kind: 'sans' },
  {
    id: 'montserrat',
    label: 'Montserrat',
    family: "'Montserrat Variable', 'Montserrat', system-ui, sans-serif",
    kind: 'sans'
  },
  {
    id: 'playfair',
    label: 'Playfair Display',
    family: "'Playfair Display Variable', 'Playfair Display', Georgia, serif",
    kind: 'serif'
  },
  { id: 'lora', label: 'Lora', family: "'Lora Variable', 'Lora', Georgia, serif", kind: 'serif' },
  {
    id: 'source-serif',
    label: 'Source Serif',
    family: "'Source Serif 4 Variable', 'Source Serif 4', Georgia, serif",
    kind: 'serif'
  },
  {
    id: 'oswald',
    label: 'Oswald',
    family: "'Oswald Variable', 'Oswald', Impact, sans-serif",
    kind: 'display'
  },
  { id: 'bebas', label: 'Bebas Neue', family: "'Bebas Neue', Impact, sans-serif", kind: 'display' }
]

export function fontFamily(id: FontId | undefined): string {
  return (FONTS.find((f) => f.id === id) ?? FONTS[0]).family
}

export function newSlide(partial: Partial<Slide> = {}): Slide {
  return { id: newId(), layout: 'title-body', title: '', body: '', ...partial }
}

export function newDeck(partial: Partial<Deck> = {}): Deck {
  return {
    slides: partial.slides ?? [newSlide({ layout: 'title', title: 'Title' })],
    theme: { ...DEFAULT_SLIDE_THEME, ...partial.theme },
    background: { ...DEFAULT_SLIDE_BACKGROUND, ...partial.background }
  }
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** 12-char random id, safe for file names and URLs. */
export function newId(): string {
  const bytes = new Uint8Array(12)
  globalThis.crypto.getRandomValues(bytes)
  let id = ''
  for (const b of bytes) id += ALPHABET[b % 36]
  return id
}
