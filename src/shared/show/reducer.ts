/**
 * The show reducer: Cue's live workflow rules as a pure function.
 *
 * It owns no I/O. Everything it needs from the outside world (the library,
 * plans, settings, clock, ids) comes in through `ShowContext`, and anything
 * the outside world should do in response comes back as `ShowEffect`s.
 */
import type { Id, Presentation, ShowCommand, ShowState, ShowTarget, TransitionSettings } from '../types'
import { clamp } from '../util'
import { clampPage, isPaged, isTimed, sameSource } from './presentation'

export interface ShowContext {
  /** Build a fresh presentation (with a new id) for a target, or null if it can't be shown. */
  resolve(target: ShowTarget): Presentation | null
  /** Resolve the plan entry `step` positions away from `entryId` (skipping non-presentable entries). */
  adjacent(planId: Id, entryId: Id, step: 1 | -1): ShowTarget | null
  /** A presentation for the ambient overlay using the current default ambient settings. */
  ambient(): Presentation
  newId(): string
  settings: {
    autoStandby: boolean
    nextAcrossItems: boolean
  }
}

export type ShowEffect =
  | { type: 'went-live'; presentation: Presentation }
  | { type: 'boundary'; direction: 'next' | 'prev'; title: string }
  | { type: 'nothing-to-take' }

export interface ReduceResult {
  state: ShowState
  effects: ShowEffect[]
}

export function initialShowState(transition: TransitionSettings, volume = 1): ShowState {
  return {
    preview: null,
    live: null,
    back: null,
    blackout: false,
    ambient: { active: false, presentation: null },
    transition,
    audio: { volume, muted: false },
    testPattern: false,
    cursor: null,
    rev: 0
  }
}

export function reduceShow(state: ShowState, cmd: ShowCommand, ctx: ShowContext): ReduceResult {
  const effects: ShowEffect[] = []
  const next = apply(state, cmd, ctx, effects)
  if (next === state) return { state, effects }
  return { state: { ...next, rev: state.rev + 1 }, effects }
}

function apply(s: ShowState, cmd: ShowCommand, ctx: ShowContext, effects: ShowEffect[]): ShowState {
  switch (cmd.type) {
    case 'preview': {
      if (!cmd.target) return s.preview ? { ...s, preview: null } : s
      const preview = ctx.resolve(cmd.target)
      return preview ? { ...s, preview } : s
    }

    case 'take': {
      if (!s.preview) {
        effects.push({ type: 'nothing-to-take' })
        return s
      }
      return goLive(s, s.preview, ctx, effects, { fromPreview: true })
    }

    case 'show': {
      const p = ctx.resolve(cmd.target)
      return p ? goLive(s, p, ctx, effects, { fromPreview: false }) : s
    }

    case 'next':
    case 'prev': {
      const dir = cmd.type === 'next' ? 1 : -1
      // Like PowerPoint: the first press after a blackout/break brings the content back.
      if (s.blackout || s.ambient.active) {
        if (s.live) return liftOverlays(s)
        if (s.blackout && !s.preview) return liftOverlays(s)
      }
      const live = s.live
      if (live && isPaged(live)) {
        const page = (live.page ?? 0) + dir
        if (page >= 0 && page < (live.pageCount ?? 1)) {
          return { ...s, live: { ...live, page, zoom: undefined } }
        }
      }
      // At a boundary (or nothing paged is live).
      if (!live && dir === 1 && s.preview) {
        return goLive(s, s.preview, ctx, effects, { fromPreview: true })
      }
      if (live && ctx.settings.nextAcrossItems) {
        if (dir === 1 && s.preview) return goLive(s, s.preview, ctx, effects, { fromPreview: true })
        if (dir === -1 && s.cursor) {
          const target = ctx.adjacent(s.cursor.planId, s.cursor.entryId, -1)
          const p = target && ctx.resolve(target)
          if (p) {
            const atEnd = isPaged(p) ? { ...p, page: (p.pageCount ?? 1) - 1 } : p
            return goLive(s, atEnd, ctx, effects, { fromPreview: false })
          }
        }
      }
      if (live) effects.push({ type: 'boundary', direction: cmd.type, title: live.title })
      return s
    }

    case 'goto': {
      const target = cmd.where === 'live' ? s.live : s.preview
      if (!target || !isPaged(target)) return s
      const page = clampPage(target, cmd.page)
      if (page === target.page) return s
      const updated = { ...target, page, zoom: undefined }
      return cmd.where === 'live' ? { ...s, live: updated } : { ...s, preview: updated }
    }

    case 'blackout': {
      const on = cmd.on ?? !s.blackout
      return on === s.blackout ? s : { ...s, blackout: on }
    }

    case 'ambient': {
      const on = cmd.on ?? !s.ambient.active
      if (on === s.ambient.active) return s
      // Keep the old presentation while turning off so the output can fade it out.
      return on
        ? { ...s, ambient: { active: true, presentation: ctx.ambient() } }
        : { ...s, ambient: { active: false, presentation: s.ambient.presentation } }
    }

    case 'clear': {
      if (!s.live) return s
      return { ...s, live: null, back: nextBack(s.back, s.live, null) }
    }

    case 'back': {
      if (!s.back) return s
      const p: Presentation = { ...s.back, id: ctx.newId() }
      return goLive(s, p, ctx, effects, { fromPreview: false, isBack: true })
    }

    case 'fit': {
      return patchWhere(s, cmd.where, (p) => (p.fit === cmd.fit ? p : { ...p, fit: cmd.fit }))
    }

    case 'zoom': {
      return patchWhere(s, cmd.where, (p) => {
        if (!cmd.zoom || cmd.zoom.scale <= 1.001) return p.zoom ? { ...p, zoom: undefined } : p
        const scale = clamp(cmd.zoom.scale, 1, 8)
        const half = 0.5 / scale
        const zoom = { scale, x: clamp(cmd.zoom.x, half, 1 - half), y: clamp(cmd.zoom.y, half, 1 - half) }
        return { ...p, zoom }
      })
    }

    case 'video': {
      const live = s.live
      if (!isTimed(live) || !live.transport) return s
      const t = live.transport
      switch (cmd.action) {
        case 'play':
          return t.playing ? s : withTransport(s, live, { ...t, playing: true })
        case 'pause':
          return t.playing ? withTransport(s, live, { ...t, playing: false }) : s
        case 'toggle':
          return withTransport(s, live, { ...t, playing: !t.playing })
        case 'restart':
          return withTransport(s, live, {
            playing: true,
            seek: { time: live.startAt ?? 0, nonce: t.seek.nonce + 1 }
          })
      }
      return s
    }

    case 'seek': {
      const live = s.live
      if (!isTimed(live) || !live.transport) return s
      const time = Math.max(0, live.duration ? Math.min(cmd.time, live.duration) : cmd.time)
      return withTransport(s, live, {
        ...live.transport,
        seek: { time, nonce: live.transport.seek.nonce + 1 }
      })
    }

    case 'loop': {
      const live = s.live
      if (!isTimed(live) || live.loop === cmd.on) return s
      return { ...s, live: { ...live, loop: cmd.on } }
    }

    case 'video-volume': {
      const live = s.live
      if (!isTimed(live)) return s
      return { ...s, live: { ...live, volume: clamp(cmd.volume, 0, 1) } }
    }

    case 'volume': {
      const volume = clamp(cmd.volume, 0, 1)
      return volume === s.audio.volume ? s : { ...s, audio: { ...s.audio, volume } }
    }

    case 'mute': {
      const muted = cmd.on ?? !s.audio.muted
      return muted === s.audio.muted ? s : { ...s, audio: { ...s.audio, muted } }
    }

    case 'transition': {
      const t = { ...s.transition, ...cmd.transition }
      t.duration = clamp(Math.round(t.duration), 0, 5000)
      return { ...s, transition: t }
    }

    case 'test-pattern': {
      const on = cmd.on ?? !s.testPattern
      return on === s.testPattern ? s : { ...s, testPattern: on }
    }
  }
  return s
}

function goLive(
  s: ShowState,
  incoming: Presentation,
  ctx: ShowContext,
  effects: ShowEffect[],
  opts: { fromPreview: boolean; isBack?: boolean }
): ShowState {
  const live = prepareForLive({ ...incoming, id: opts.fromPreview ? ctx.newId() : incoming.id })
  const back = opts.isBack ? nextBackAfterReturn(s.live, live) : nextBack(s.back, s.live, live)
  const fromPlan = live.planId && live.entryId ? { planId: live.planId, entryId: live.entryId } : null
  const cursor = fromPlan ?? s.cursor

  // Preview changes only when it was just consumed (take) or the plan's playhead moved.
  // Showing a spontaneous item directly leaves whatever the operator staged untouched.
  let preview = s.preview
  if (opts.fromPreview || fromPlan) {
    if (ctx.settings.autoStandby && cursor) {
      // Keep the service flowing: Preview shows what comes after the plan's playhead.
      const standby = ctx.adjacent(cursor.planId, cursor.entryId, 1)
      preview = standby ? ctx.resolve(standby) : null
    } else if (opts.fromPreview) {
      preview = null
    }
  }

  effects.push({ type: 'went-live', presentation: live })
  return {
    ...s,
    live,
    back,
    preview,
    cursor,
    blackout: false,
    ambient: s.ambient.active ? { active: false, presentation: s.ambient.presentation } : s.ambient
  }
}

/** Fresh transport for timed media; zoom state carries over from preview. */
function prepareForLive(p: Presentation): Presentation {
  if (!isTimed(p)) return p
  const resumeAt = p.transport?.seek.time
  return {
    ...p,
    transport: {
      playing: p.transport ? p.transport.playing : true,
      seek: { time: resumeAt ?? p.startAt ?? 0, nonce: 1 }
    }
  }
}

/**
 * Decide what "Back" should return to after `leaving` is replaced by `incoming`.
 *
 * Paged presentations (sermon slides, PDFs) are sticky: after slides -> map -> photo,
 * Back still returns to the slides at the page you left. When the slides come back
 * on screen, Back offers the last spontaneous item instead.
 */
export function nextBack(
  back: Presentation | null,
  leaving: Presentation | null,
  incoming: Presentation | null
): Presentation | null {
  let result = back
  if (leaving) {
    if (isPaged(leaving) || !back || !isPaged(back)) result = leaving
  }
  if (result && incoming && sameSource(result, incoming)) {
    result = leaving && !sameSource(leaving, incoming) ? leaving : null
  }
  return result
}

function nextBackAfterReturn(leaving: Presentation | null, incoming: Presentation): Presentation | null {
  if (!leaving || sameSource(leaving, incoming)) return null
  return leaving
}

function liftOverlays(s: ShowState): ShowState {
  return {
    ...s,
    blackout: false,
    ambient: s.ambient.active ? { active: false, presentation: s.ambient.presentation } : s.ambient
  }
}

function patchWhere(
  s: ShowState,
  where: 'live' | 'preview',
  fn: (p: Presentation) => Presentation
): ShowState {
  const target = where === 'live' ? s.live : s.preview
  if (!target) return s
  const updated = fn(target)
  if (updated === target) return s
  return where === 'live' ? { ...s, live: updated } : { ...s, preview: updated }
}

function withTransport(
  s: ShowState,
  live: Presentation,
  transport: NonNullable<Presentation['transport']>
): ShowState {
  return { ...s, live: { ...live, transport } }
}
