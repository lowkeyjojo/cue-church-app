import { newId } from '@shared/defaults'
import { initialShowState, reduceShow, type ShowContext, type ShowEffect } from '@shared/show/reducer'
import { clampPage, isTimed } from '@shared/show/presentation'
import type {
  AmbientConfig,
  AmbientOverlay,
  Deck,
  Id,
  MediaItem,
  PlaybackStatus,
  Presentation,
  PresentOptions,
  ShowCommand,
  ShowState,
  ShowTarget,
  Toast
} from '@shared/types'
import { MEDIA_SCHEME, domainOf, formatTime, mediaUrl, thumbUrl } from '@shared/util'
import { dataPath } from '../paths'
import { Emitter } from '../store/emitter'
import type { HistoryStore } from '../store/history'
import { JsonStore } from '../store/jsonStore'
import type { LibraryStore } from '../store/library'
import type { PlansStore } from '../store/plans'
import type { SettingsStore } from '../store/settings'

type Persisted = Pick<ShowState, 'live' | 'preview' | 'back' | 'blackout' | 'ambient' | 'cursor'>

interface ShowFile {
  version: 1
  cleanExit: boolean
  state?: Persisted
}

/** Commands that can replace what's live; they snapshot video position first so Back can resume it. */
const REPLACING = new Set<ShowCommand['type']>(['take', 'show', 'back', 'clear', 'next', 'prev'])

export class ShowController extends Emitter<{
  state: ShowState
  playback: PlaybackStatus | null
  toast: Toast
}> {
  state: ShowState
  playback: PlaybackStatus | null = null
  /** The last session ended unexpectedly with something on screen, which has been put back. */
  readonly recoveredFromCrash: boolean
  private endedHandled = ''
  private file = new JsonStore<ShowFile>(dataPath('show.json'), () => ({ version: 1, cleanExit: true }))

  constructor(
    private library: LibraryStore,
    private plans: PlansStore,
    private settings: SettingsStore,
    private history: HistoryStore
  ) {
    super()
    const s = settings.data
    this.state = initialShowState(s.transition, s.audio.volume)
    const saved = this.file.data
    const restored = saved.state && !saved.cleanExit ? this.validate(saved.state) : null
    this.recoveredFromCrash = !!(restored && (restored.live || restored.ambient.active))
    if (restored) {
      // Cue didn't shut down cleanly: put the audience screen back the way it was.
      this.state = { ...this.state, ...restored }
    } else if (s.output.startup === 'ambient') {
      this.state = {
        ...this.state,
        ambient: { active: true, presentation: this.ambientPresentation(s.ambient) }
      }
    }
    this.persist()

    library.on('upsert', (items) => this.refreshMedia(items))
    library.on('remove', (ids) => this.forgetMedia(ids))
    settings.on('changed', (next) => this.refreshDefaultAmbient(next.ambient))
  }

  /** The A-key ambient follows its settings live, so edits show up immediately. */
  private refreshDefaultAmbient(config: AmbientConfig): void {
    const amb = this.state.ambient
    if (!amb.active || !amb.presentation || amb.presentation.entryId) return
    const current = amb.presentation.ambient?.config
    const { source: _a, ...was } = current ?? ({} as AmbientConfig)
    const { source: _b, ...now } = config
    if (
      current &&
      JSON.stringify(was) === JSON.stringify(now) &&
      (current.source === config.source || !config.mediaIds.length)
    )
      return
    this.commit({
      ...this.state,
      ambient: { active: true, presentation: this.ambientPresentation(config) },
      rev: this.state.rev + 1
    })
  }

  dispatch(cmd: ShowCommand): void {
    const input = REPLACING.has(cmd.type) ? this.snapshotPlayback(this.state) : this.state
    const { state, effects } = reduceShow(input, cmd, this.context())
    if (state !== input) this.commit(this.anchorCountdown(state, input))
    for (const effect of effects) this.handleEffect(effect)
  }

  /** Playback reports from the audience window. */
  onPlayback(status: PlaybackStatus | null): void {
    const live = this.state.live
    if (!status) {
      if (this.playback) {
        this.playback = null
        this.emit('playback', null)
      }
      return
    }
    if (!live || status.presentationId !== live.id) return
    this.playback = status
    this.emit('playback', status)
    const key = `${live.id}:${live.transport?.seek.nonce ?? 0}`
    if (status.ended && this.endedHandled !== key && !live.loop) {
      this.endedHandled = key
      if (live.transport?.playing) {
        this.commit({
          ...this.state,
          live: { ...live, transport: { ...live.transport, playing: false } },
          rev: this.state.rev + 1
        })
      }
      if (live.endAction === 'black') this.dispatch({ type: 'blackout', on: true })
      else if (live.endAction === 'ambient') this.dispatch({ type: 'ambient', on: true })
      else if (live.endAction === 'clear') this.dispatch({ type: 'clear' })
    }
  }

  resolve(target: ShowTarget): Presentation | null {
    switch (target.type) {
      case 'media':
        return this.fromItem(this.library.get(target.mediaId), { page: target.page, options: target.options })
      case 'entry': {
        const entry = this.plans.entry(target.planId, target.entryId)
        if (!entry) return null
        const ref = { planId: target.planId, entryId: target.entryId }
        if (entry.type === 'media') {
          return this.fromItem(this.library.get(entry.mediaId), {
            page: target.page,
            options: entry.options,
            title: entry.title,
            ...ref
          })
        }
        if (entry.type === 'ambient') {
          return this.ambientPresentation(entry.ambient ?? this.settings.data.ambient, {
            title: entry.title,
            ...ref
          })
        }
        if (entry.type === 'color') {
          return {
            id: newId(),
            kind: 'color',
            title: entry.title || 'Solid color',
            color: entry.color ?? '#000000',
            fit: 'fill',
            ...ref
          }
        }
        return null
      }
      case 'color':
        return {
          id: newId(),
          kind: 'color',
          title: target.title ?? 'Solid color',
          color: target.color,
          fit: 'fill'
        }
      case 'ambient':
        return this.ambientPresentation(target.config ?? this.settings.data.ambient, { title: target.title })
      case 'slide': {
        const s = this.settings.data.slides
        const deck: Deck = {
          slides: [target.slide],
          theme: target.theme ?? s.theme,
          background: target.background ?? s.background
        }
        return {
          id: newId(),
          kind: 'deck',
          title: target.title || slideTitle(target.slide.title || target.slide.body) || 'Text slide',
          subtitle: 'Quick slide',
          deck,
          deckMedia: this.deckMedia(deck),
          page: 0,
          pageCount: 1,
          fit: 'fill'
        }
      }
      case 'presentation': {
        const p = target.presentation
        if (p.mediaId && !this.library.get(p.mediaId)) return null
        return { ...p, id: newId(), transport: undefined, zoom: undefined }
      }
    }
  }

  markCleanExit(): void {
    this.file.data = { version: 1, cleanExit: true, state: this.persisted() }
    this.file.flush()
  }

  private context(): ShowContext {
    const presenter = this.settings.data.presenter
    return {
      resolve: (t) => this.resolve(t),
      adjacent: (planId, entryId, step) => this.adjacent(planId, entryId, step),
      ambient: () => this.ambientPresentation(this.settings.data.ambient),
      newId,
      settings: { autoStandby: presenter.autoStandby, nextAcrossItems: presenter.nextAcrossItems }
    }
  }

  private adjacent(planId: Id, entryId: Id, step: 1 | -1): ShowTarget | null {
    const plan = this.plans.get(planId)
    if (!plan) return null
    const index = plan.entries.findIndex((e) => e.id === entryId)
    if (index < 0) return null
    for (let i = index + step; i >= 0 && i < plan.entries.length; i += step) {
      const e = plan.entries[i]
      if (e.type === 'section') continue
      if (e.type === 'media') {
        const item = this.library.get(e.mediaId)
        if (!item || item.status === 'error') continue
      }
      return { type: 'entry', planId, entryId: e.id }
    }
    return null
  }

  private fromItem(
    item: MediaItem | undefined,
    o: { page?: number; options?: PresentOptions; title?: string; planId?: Id; entryId?: Id }
  ): Presentation | null {
    if (!item || item.status === 'error') return null
    const opts: PresentOptions = { ...item.defaults, ...o.options }
    const base = {
      id: newId(),
      title: o.title || item.name,
      subtitle: subtitleFor(item),
      mediaId: item.id,
      planId: o.planId,
      entryId: o.entryId,
      thumb: thumbUrl(item),
      width: item.width,
      height: item.height,
      fit: opts.fit ?? this.settings.data.output.defaultFit,
      credit: creditFor(item)
    }
    switch (item.kind) {
      case 'image':
        if (!item.file) return null
        return { ...base, kind: 'image', src: mediaUrl(item.id, item.file), animated: item.animated }
      case 'video':
      case 'audio':
        if (!item.file) return null
        return {
          ...base,
          kind: item.kind,
          src: mediaUrl(item.id, item.file),
          duration: item.duration,
          loop: opts.loop ?? false,
          volume: opts.volume ?? 1,
          startAt: opts.startAt,
          endAt: opts.endAt,
          endAction: opts.loop ? 'loop' : (opts.endAction ?? 'hold'),
          transport: { playing: opts.autoplay !== false, seek: { time: opts.startAt ?? 0, nonce: 0 } }
        }
      case 'pdf': {
        const pageCount = item.status === 'ready' ? item.pageCount : item.pagesReady
        if (!pageCount) return null
        const p: Presentation = {
          ...base,
          kind: 'pdf',
          pageCount: item.pageCount ?? pageCount,
          pageBase: `${MEDIA_SCHEME}://media/${item.id}/`,
          page: 0
        }
        p.page = clampPage(p, o.page ?? 0)
        return p
      }
      case 'deck': {
        if (!item.deck?.slides.length) return null
        const p: Presentation = {
          ...base,
          kind: 'deck',
          fit: 'fill',
          deck: item.deck,
          deckMedia: this.deckMedia(item.deck),
          pageCount: item.deck.slides.length,
          page: 0
        }
        p.page = clampPage(p, o.page ?? 0)
        return p
      }
    }
  }

  private deckMedia(deck: Deck): Presentation['deckMedia'] {
    const ids = new Set<Id>()
    if (deck.background.type === 'media' && deck.background.mediaId) ids.add(deck.background.mediaId)
    for (const s of deck.slides)
      if (s.background?.type === 'media' && s.background.mediaId) ids.add(s.background.mediaId)
    const out: NonNullable<Presentation['deckMedia']> = {}
    for (const id of ids) {
      const item = this.library.get(id)
      if (item?.file && (item.kind === 'image' || item.kind === 'video'))
        out[id] = { kind: item.kind, src: mediaUrl(item.id, item.file) }
    }
    return out
  }

  private ambientPresentation(
    config: AmbientConfig,
    extra: { title?: string; planId?: Id; entryId?: Id } = {}
  ): Presentation {
    const media = config.mediaIds
      .map((id) => this.library.get(id))
      .filter(
        (i): i is MediaItem =>
          !!i && !!i.file && (i.kind === 'image' || i.kind === 'video') && i.status !== 'error'
      )
      .map((i) => ({
        id: i.id,
        kind: i.kind as 'image' | 'video',
        src: mediaUrl(i.id, i.file!),
        width: i.width,
        height: i.height
      }))
    const source = config.source === 'media' && media.length ? 'media' : 'theme'
    return {
      id: newId(),
      kind: 'ambient',
      title: extra.title || ambientTitle(config),
      subtitle: 'Ambient',
      planId: extra.planId,
      entryId: extra.entryId,
      fit: 'fill',
      ambient: {
        config: { ...config, source },
        media,
        countdownTarget: countdownTarget(config.overlay, Date.now())
      }
    }
  }

  /** A relative countdown ("5 minutes") starts when it goes live, not when it was previewed. */
  private anchorCountdown(state: ShowState, before: ShowState): ShowState {
    const live = state.live
    if (
      !live ||
      live === before.live ||
      live.id === before.live?.id ||
      live.kind !== 'ambient' ||
      !live.ambient
    )
      return state
    const overlay = live.ambient.config.overlay
    if (overlay.kind !== 'countdown' || !overlay.countdownMinutes) return state
    return {
      ...state,
      live: { ...live, ambient: { ...live.ambient, countdownTarget: countdownTarget(overlay, Date.now()) } }
    }
  }

  private snapshotPlayback(state: ShowState): ShowState {
    const live = state.live
    const pb = this.playback
    if (!isTimed(live) || !live.transport || !pb || pb.presentationId !== live.id) return state
    const time = pb.ended ? (live.startAt ?? 0) : pb.currentTime
    return {
      ...state,
      live: { ...live, transport: { ...live.transport, seek: { ...live.transport.seek, time } } }
    }
  }

  private handleEffect(effect: ShowEffect): void {
    switch (effect.type) {
      case 'went-live': {
        const p = effect.presentation
        this.history.add(p)
        if (p.mediaId) this.library.markShown(p.mediaId)
        if (this.playback && this.playback.presentationId !== p.id) this.onPlayback(null)
        break
      }
      case 'boundary': {
        const s = this.settings.data
        this.emit('toast', {
          id: 'boundary',
          kind: 'info',
          title: effect.direction === 'next' ? `End of “${effect.title}”` : `Start of “${effect.title}”`,
          message:
            effect.direction === 'next' && this.state.preview
              ? `Press Show on ${s.output.name} to continue with “${this.state.preview.title}”.`
              : undefined,
          duration: 2600
        })
        break
      }
      case 'nothing-to-take':
        this.emit('toast', {
          id: 'empty-preview',
          kind: 'info',
          title: 'Preview is empty',
          message: 'Pick something to show first.',
          duration: 2200
        })
        break
    }
  }

  private commit(state: ShowState): void {
    const prev = this.state
    this.state = state
    if (state.transition !== prev.transition) this.settings.updateQuietly({ transition: state.transition })
    if (state.audio.volume !== prev.audio.volume)
      this.settings.updateQuietly({ audio: { volume: state.audio.volume } })
    this.persist()
    this.emit('state', state)
  }

  private persisted(): Persisted {
    const { live, preview, back, blackout, ambient, cursor } = this.state
    return { live, preview, back, blackout, ambient, cursor }
  }

  private persist(): void {
    this.file.data = { version: 1, cleanExit: false, state: this.persisted() }
    this.file.save()
  }

  /** Drop references to media that no longer exists (e.g. deleted while Cue was closed). */
  private validate(saved: Persisted): Persisted {
    const ok = (p: Presentation | null) => (p && (!p.mediaId || this.library.get(p.mediaId)) ? p : null)
    return {
      live: ok(saved.live),
      preview: ok(saved.preview),
      back: ok(saved.back),
      blackout: !!saved.blackout,
      ambient: saved.ambient ?? { active: false, presentation: null },
      cursor:
        saved.cursor && this.plans.entry(saved.cursor.planId, saved.cursor.entryId) ? saved.cursor : null
    }
  }

  /** Keep on-screen presentations in sync when their media changes (PDF pages arriving, slides edited live). */
  private refreshMedia(items: MediaItem[]): void {
    const byId = new Map(items.map((i) => [i.id, i]))
    let changed = false
    const refresh = (p: Presentation | null): Presentation | null => {
      if (!p?.mediaId) return p
      const item = byId.get(p.mediaId)
      if (!item) return p
      let next = p
      if (item.kind === 'pdf' && item.pageCount && item.pageCount !== p.pageCount)
        next = { ...p, pageCount: item.pageCount }
      if (item.kind === 'deck' && item.deck && item.deck !== p.deck) {
        const pageCount = item.deck.slides.length
        next = {
          ...p,
          deck: item.deck,
          deckMedia: this.deckMedia(item.deck),
          pageCount,
          page: Math.min(p.page ?? 0, pageCount - 1)
        }
      }
      if ((item.kind === 'video' || item.kind === 'audio') && item.duration && item.duration !== p.duration)
        next = { ...p, duration: item.duration }
      if (item.width && (item.width !== p.width || item.height !== p.height))
        next = { ...next, width: item.width, height: item.height }
      const thumb = thumbUrl(item)
      if (thumb !== p.thumb) next = { ...next, thumb }
      if (next !== p) changed = true
      return next
    }
    const live = refresh(this.state.live)
    const preview = refresh(this.state.preview)
    const back = refresh(this.state.back)
    if (changed) this.commit({ ...this.state, live, preview, back, rev: this.state.rev + 1 })
  }

  private forgetMedia(ids: Id[]): void {
    const gone = new Set(ids)
    const drop = (p: Presentation | null) => (p?.mediaId && gone.has(p.mediaId) ? null : p)
    const preview = drop(this.state.preview)
    const back = drop(this.state.back)
    if (preview !== this.state.preview || back !== this.state.back) {
      this.commit({ ...this.state, preview, back, rev: this.state.rev + 1 })
    }
  }
}

function subtitleFor(item: MediaItem): string {
  switch (item.kind) {
    case 'image':
      return [
        item.animated ? 'GIF' : 'Image',
        item.width ? `${item.width}×${item.height}` : '',
        domainOf(item.source.pageUrl ?? item.source.url)
      ]
        .filter(Boolean)
        .join(' · ')
    case 'video':
      return `Video · ${formatTime(item.duration)}`
    case 'audio':
      return `Audio · ${formatTime(item.duration)}`
    case 'pdf':
      return `PDF · ${item.pageCount ?? '…'} pages`
    case 'deck':
      return `Slides · ${item.deck?.slides.length ?? 0}`
  }
}

function creditFor(item: MediaItem): string | undefined {
  const s = item.source
  if (s.type !== 'web') return undefined
  const parts = [s.author, s.license, domainOf(s.pageUrl ?? s.url)].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}

function slideTitle(text: string | undefined): string {
  const line =
    (text ?? '')
      .split('\n')
      .find((l) => l.trim())
      ?.trim() ?? ''
  return line.length > 48 ? `${line.slice(0, 46)}…` : line
}

function ambientTitle(config: AmbientConfig): string {
  switch (config.overlay.kind) {
    case 'countdown':
      return 'Countdown'
    case 'clock':
      return 'Clock'
    case 'text':
      return config.overlay.text || 'Ambient'
    default:
      return 'Ambient'
  }
}

/** Absolute countdown target for an overlay, or undefined if it isn't a countdown. */
export function countdownTarget(overlay: AmbientOverlay, now: number): number | undefined {
  if (overlay.kind !== 'countdown') return undefined
  if (overlay.countdownMinutes) return now + overlay.countdownMinutes * 60_000
  const m = /^(\d{1,2}):(\d{2})$/.exec(overlay.countdownTo ?? '')
  if (!m) return now + 5 * 60_000
  const d = new Date(now)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return d.getTime()
}
