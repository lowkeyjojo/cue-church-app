import { describe, expect, it } from 'vitest'
import { initialShowState, nextBack, reduceShow, type ShowContext } from '@shared/show/reducer'
import type { Presentation, ShowCommand, ShowState, ShowTarget } from '@shared/types'

type Entry = { id: string; kind: 'pdf' | 'image' | 'video' | 'section'; pages?: number; title: string }

const plan: Entry[] = [
  { id: 'e0', kind: 'section', title: 'Worship' },
  { id: 'e1', kind: 'pdf', pages: 3, title: 'Sermon' },
  { id: 'e2', kind: 'image', title: 'Map' },
  { id: 'e3', kind: 'video', title: 'Baptism video' }
]

const library: Record<string, { kind: 'pdf' | 'image' | 'video'; pages?: number; title: string }> = {
  web1: { kind: 'image', title: 'Ephesus' },
  web2: { kind: 'image', title: 'Ruins' },
  deck1: { kind: 'pdf', pages: 2, title: 'Notes' }
}

function makeCtx(settings: Partial<ShowContext['settings']> = {}): ShowContext {
  let n = 0
  const newId = () => `p${++n}`
  const build = (base: Omit<Presentation, 'id' | 'fit'>, page = 0): Presentation => {
    const p: Presentation = { id: newId(), fit: 'fit', ...base }
    if (p.kind === 'pdf') p.page = Math.min(page, (p.pageCount ?? 1) - 1)
    if (p.kind === 'video') p.transport = { playing: true, seek: { time: 0, nonce: 0 } }
    return p
  }
  return {
    newId,
    settings: { autoStandby: true, nextAcrossItems: false, ...settings },
    resolve(target: ShowTarget) {
      if (target.type === 'entry') {
        const e = plan.find((x) => x.id === target.entryId)
        if (!e || e.kind === 'section') return null
        return build(
          {
            kind: e.kind,
            title: e.title,
            planId: 'plan',
            entryId: e.id,
            mediaId: `m-${e.id}`,
            pageCount: e.pages
          },
          target.page
        )
      }
      if (target.type === 'media') {
        const m = library[target.mediaId]
        if (!m) return null
        return build(
          { kind: m.kind, title: m.title, mediaId: target.mediaId, pageCount: m.pages },
          target.page
        )
      }
      if (target.type === 'presentation') return { ...target.presentation, id: newId() }
      return null
    },
    adjacent(_planId, entryId, step) {
      let i = plan.findIndex((x) => x.id === entryId) + step
      while (i >= 0 && i < plan.length && plan[i].kind === 'section') i += step
      const e = plan[i]
      return e ? { type: 'entry', planId: 'plan', entryId: e.id } : null
    },
    ambient() {
      return { id: newId(), kind: 'ambient', title: 'Ambient', fit: 'fill' }
    }
  }
}

function run(ctx: ShowContext, ...cmds: ShowCommand[]): ShowState {
  let s = initialShowState({ kind: 'fade', duration: 500 })
  for (const cmd of cmds) s = reduceShow(s, cmd, ctx).state
  return s
}

const entry = (entryId: string, page?: number): ShowTarget => ({
  type: 'entry',
  planId: 'plan',
  entryId,
  page
})
const media = (mediaId: string): ShowTarget => ({ type: 'media', mediaId })

describe('preview and take', () => {
  it('take moves preview to live with a new instance id', () => {
    const ctx = makeCtx({ autoStandby: false })
    const s1 = run(ctx, { type: 'preview', target: media('web1') })
    expect(s1.preview?.title).toBe('Ephesus')
    const r = reduceShow(s1, { type: 'take' }, ctx)
    expect(r.state.live?.title).toBe('Ephesus')
    expect(r.state.live?.id).not.toBe(s1.preview?.id)
    expect(r.state.preview).toBeNull()
    expect(r.effects).toContainEqual({ type: 'went-live', presentation: r.state.live })
    expect(r.state.rev).toBe(s1.rev + 1)
  })

  it('take with empty preview reports nothing-to-take and keeps state', () => {
    const ctx = makeCtx()
    const s = run(ctx)
    const r = reduceShow(s, { type: 'take' }, ctx)
    expect(r.state).toBe(s)
    expect(r.effects).toEqual([{ type: 'nothing-to-take' }])
  })

  it('taking a plan entry stages the next entry (skipping sections) as standby', () => {
    const ctx = makeCtx()
    const s = run(ctx, { type: 'preview', target: entry('e1') }, { type: 'take' })
    expect(s.live?.entryId).toBe('e1')
    expect(s.cursor).toEqual({ planId: 'plan', entryId: 'e1' })
    expect(s.preview?.entryId).toBe('e2')
  })

  it('after a spontaneous item, preview returns to the plan standby', () => {
    const ctx = makeCtx()
    const s = run(
      ctx,
      { type: 'show', target: entry('e1') },
      { type: 'preview', target: media('web1') },
      { type: 'take' }
    )
    expect(s.live?.title).toBe('Ephesus')
    expect(s.preview?.entryId).toBe('e2')
    expect(s.cursor?.entryId).toBe('e1')
  })

  it('showing a non-plan item directly keeps the staged preview', () => {
    const ctx = makeCtx()
    const s = run(ctx, { type: 'preview', target: media('web2') }, { type: 'show', target: media('web1') })
    expect(s.live?.title).toBe('Ephesus')
    expect(s.preview?.title).toBe('Ruins')
  })

  it('going live lifts blackout and ambient', () => {
    const ctx = makeCtx()
    const s = run(
      ctx,
      { type: 'blackout', on: true },
      { type: 'ambient', on: true },
      { type: 'show', target: media('web1') }
    )
    expect(s.blackout).toBe(false)
    expect(s.ambient.active).toBe(false)
  })

  it('the last plan entry leaves an empty standby', () => {
    const ctx = makeCtx()
    const s = run(ctx, { type: 'show', target: entry('e3') })
    expect(s.preview).toBeNull()
  })
})

describe('paging', () => {
  it('next/prev step through pages and stop at the end by default', () => {
    const ctx = makeCtx()
    let s = run(ctx, { type: 'show', target: entry('e1') }, { type: 'next' }, { type: 'next' })
    expect(s.live?.page).toBe(2)
    const r = reduceShow(s, { type: 'next' }, ctx)
    expect(r.state).toBe(s)
    expect(r.effects).toEqual([{ type: 'boundary', direction: 'next', title: 'Sermon' }])
    s = run(ctx, { type: 'show', target: entry('e1') }, { type: 'prev' })
    expect(s.live?.page).toBe(0)
  })

  it('page changes keep the presentation instance (no full transition)', () => {
    const ctx = makeCtx()
    const s1 = run(ctx, { type: 'show', target: entry('e1') })
    const s2 = reduceShow(s1, { type: 'next' }, ctx).state
    expect(s2.live?.id).toBe(s1.live?.id)
    expect(s2.live?.page).toBe(1)
  })

  it('with nextAcrossItems, next at the end takes the standby', () => {
    const ctx = makeCtx({ nextAcrossItems: true })
    const s = run(ctx, { type: 'show', target: entry('e1', 2) }, { type: 'next' })
    expect(s.live?.entryId).toBe('e2')
    expect(s.preview?.entryId).toBe('e3')
  })

  it('with nextAcrossItems, prev at the start goes to the previous item at its last page', () => {
    const ctx = makeCtx({ nextAcrossItems: true })
    const s = run(ctx, { type: 'show', target: entry('e2') }, { type: 'prev' })
    expect(s.live?.entryId).toBe('e1')
    expect(s.live?.page).toBe(2)
  })

  it('next with nothing live starts the show from preview', () => {
    const ctx = makeCtx()
    const s = run(ctx, { type: 'preview', target: entry('e1') }, { type: 'next' })
    expect(s.live?.entryId).toBe('e1')
  })

  it('next during blackout only lifts the blackout', () => {
    const ctx = makeCtx()
    const s = run(
      ctx,
      { type: 'show', target: entry('e1') },
      { type: 'blackout', on: true },
      { type: 'next' }
    )
    expect(s.blackout).toBe(false)
    expect(s.live?.page).toBe(0)
  })

  it('goto clamps and resets zoom', () => {
    const ctx = makeCtx()
    const s = run(
      ctx,
      { type: 'show', target: entry('e1') },
      { type: 'zoom', where: 'live', zoom: { scale: 2, x: 0.5, y: 0.5 } },
      { type: 'goto', where: 'live', page: 99 }
    )
    expect(s.live?.page).toBe(2)
    expect(s.live?.zoom).toBeUndefined()
  })
})

describe('back', () => {
  it('returns to the slides at the page you left, even after several spontaneous items', () => {
    const ctx = makeCtx()
    const s = run(
      ctx,
      { type: 'show', target: entry('e1') },
      { type: 'next' },
      { type: 'show', target: media('web1') },
      { type: 'show', target: media('web2') },
      { type: 'back' }
    )
    expect(s.live?.entryId).toBe('e1')
    expect(s.live?.page).toBe(1)
    // Back now offers the last spontaneous item.
    expect(s.back?.title).toBe('Ruins')
  })

  it('without paged content, back is simply the previous item', () => {
    const ctx = makeCtx()
    const s = run(ctx, { type: 'show', target: media('web1') }, { type: 'show', target: media('web2') })
    expect(s.back?.title).toBe('Ephesus')
  })

  it('clear remembers what was live', () => {
    const ctx = makeCtx()
    const s = run(ctx, { type: 'show', target: media('web1') }, { type: 'clear' })
    expect(s.live).toBeNull()
    expect(s.back?.title).toBe('Ephesus')
  })

  it('nextBack never points at what is going live', () => {
    const slides = {
      id: 'a',
      kind: 'pdf',
      title: 'S',
      mediaId: 'm1',
      fit: 'fit',
      pageCount: 3
    } as Presentation
    const img = { id: 'b', kind: 'image', title: 'I', mediaId: 'm2', fit: 'fit' } as Presentation
    expect(nextBack(slides, img, { ...slides, id: 'c' })).toBe(img)
    expect(nextBack(null, slides, { ...slides, id: 'c' })).toBeNull()
  })
})

describe('overlays, zoom and video', () => {
  it('blackout and ambient toggle; ambient keeps its presentation for the fade-out', () => {
    const ctx = makeCtx()
    let s = run(ctx, { type: 'blackout' })
    expect(s.blackout).toBe(true)
    s = run(ctx, { type: 'ambient' }, { type: 'ambient' })
    expect(s.ambient.active).toBe(false)
    expect(s.ambient.presentation?.kind).toBe('ambient')
  })

  it('zoom is clamped so the image always covers the screen', () => {
    const ctx = makeCtx()
    const s = run(
      ctx,
      { type: 'show', target: media('web1') },
      { type: 'zoom', where: 'live', zoom: { scale: 2, x: 0, y: 1 } }
    )
    expect(s.live?.zoom).toEqual({ scale: 2, x: 0.25, y: 0.75 })
    const reset = reduceShow(s, { type: 'zoom', where: 'live', zoom: null }, ctx).state
    expect(reset.live?.zoom).toBeUndefined()
  })

  it('video transport: toggle, seek and restart bump the seek nonce', () => {
    const ctx = makeCtx()
    let s = run(ctx, { type: 'show', target: entry('e3') })
    expect(s.live?.transport?.playing).toBe(true)
    s = reduceShow(s, { type: 'video', action: 'toggle' }, ctx).state
    expect(s.live?.transport?.playing).toBe(false)
    const nonce = s.live!.transport!.seek.nonce
    s = reduceShow(s, { type: 'seek', time: 12 }, ctx).state
    expect(s.live?.transport?.seek).toEqual({ time: 12, nonce: nonce + 1 })
    s = reduceShow(s, { type: 'video', action: 'restart' }, ctx).state
    expect(s.live?.transport).toEqual({ playing: true, seek: { time: 0, nonce: nonce + 2 } })
  })

  it('volume is clamped and unchanged commands do not bump rev', () => {
    const ctx = makeCtx()
    const s = run(ctx, { type: 'volume', volume: 3 })
    expect(s.audio.volume).toBe(1)
    const r = reduceShow(s, { type: 'volume', volume: 1 }, ctx)
    expect(r.state).toBe(s)
  })
})
