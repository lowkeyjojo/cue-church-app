import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Presentation, TransitionSettings } from '@shared/types'
import { pageFile } from '@shared/util'
import { useStage } from './context'
import { slideBackground, SlideView } from './slides/SlideView'
import type { Size } from './useElementSize'
import { AmbientView } from './views/AmbientView'
import { ColorView } from './views/ColorView'
import { ImageView } from './views/ImageView'
import { LEAVE_AUDIO_MS, VideoView } from './views/VideoView'

/**
 * Lifecycle of something on screen:
 *  loading -> waits invisibly until its content is decoded / playable
 *  in      -> fading in
 *  shown   -> fully visible
 *  stale   -> still visible, but something new is loading on top
 *  out     -> fading away, then removed
 */
type Phase = 'loading' | 'in' | 'shown' | 'stale' | 'out'

interface Slot {
  key: string
  /** Unique per mount, so a returning presentation never collides with its fading-out copy. */
  seq: number
  p: Presentation
  phase: Phase
  /** CSS transition for this slot's opacity. */
  ms: number
  delay: number
  endsAt: number
}

const READY_TIMEOUT = 2500
/** The Preview monitor changes quickly, whatever the live transition is. */
const PREVIEW_TRANSITION: TransitionSettings = { kind: 'fade', duration: 140 }

/**
 * Each PDF page is its own picture. Slides that share a background share a
 * slot: only their words change, so a moving background plays on.
 */
function slotKey(p: Presentation): string {
  if (p.kind === 'pdf') return `${p.id}#${p.page ?? 0}`
  if (p.kind === 'deck' && p.deck) return `${p.id}#${JSON.stringify(slideBackground(p.deck, p.page ?? 0))}`
  return p.id
}

export function ContentLayer({
  presentation,
  transition,
  size
}: {
  presentation: Presentation | null
  transition: TransitionSettings
  size: Size
}) {
  const { role } = useStage()
  const [slots, setSlots] = useState<Slot[]>([])
  const slotsRef = useRef<Slot[]>([])
  const transitionRef = useRef(transition)
  transitionRef.current = transition
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const seq = useRef(0)

  const commit = useCallback((next: Slot[]) => {
    slotsRef.current = next
    setSlots(next)
  }, [])

  const later = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.current.delete(t)
      fn()
    }, ms)
    timers.current.add(t)
  }, [])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  /** Remove finished fade-outs and settle finished fade-ins. */
  const sweep = useCallback(() => {
    const now = performance.now()
    const next = slotsRef.current
      .filter((s) => !(s.phase === 'out' && s.endsAt <= now + 16))
      .map((s) => (s.phase === 'in' && s.endsAt <= now + 16 ? { ...s, phase: 'shown' as Phase } : s))
    commit(next)
  }, [commit])

  /** Run the configured transition from whatever is visible to the slot `show` (null: to nothing). */
  const reveal = useCallback(
    (show: number | null) => {
      const t = role === 'preview' ? PREVIEW_TRANSITION : transitionRef.current
      const now = performance.now()
      const d = t.kind === 'cut' ? 0 : t.duration
      const kind = t.kind
      let total = 0
      const next = slotsRef.current.map((s): Slot => {
        if (s.seq === show && s.phase === 'loading') {
          const delay = kind === 'dip' ? d / 2 : 0
          const ms = kind === 'dip' ? d / 2 : d
          total = Math.max(total, delay + ms)
          return { ...s, phase: d ? 'in' : 'shown', ms, delay, endsAt: now + delay + ms }
        }
        if (s.phase === 'stale' || (show === null && (s.phase === 'shown' || s.phase === 'in'))) {
          // Crossfade: the outgoing image lingers a little so the screen never dips toward black.
          const delay = kind === 'fade' ? d * 0.35 : 0
          const ms = kind === 'fade' ? d * 0.65 : kind === 'dip' ? d / 2 : 0
          // Sound fades out even on a cut: keep the video (unseen) until it has.
          const audible = role === 'output' && (s.p.kind === 'video' || s.p.kind === 'audio')
          const end = Math.max(delay + ms, audible ? LEAVE_AUDIO_MS + 50 : 0)
          total = Math.max(total, end)
          return { ...s, phase: 'out', ms, delay, endsAt: now + end }
        }
        return s
      })
      commit(next)
      later(total + 30, sweep)
    },
    [commit, later, role, sweep]
  )

  const ready = useCallback(
    (slot: number) => {
      if (slotsRef.current.some((s) => s.seq === slot && s.phase === 'loading')) reveal(slot)
    },
    [reveal]
  )

  // Reconcile with the incoming presentation.
  const key = presentation ? slotKey(presentation) : null
  useLayoutEffect(() => {
    const prev = slotsRef.current
    const current = key ? prev.find((s) => s.key === key && s.phase !== 'out') : undefined
    if (current) {
      if (current.phase === 'stale') {
        // Back to what is still on screen before the newer content arrived (→ then ←):
        // keep it, and drop whatever was loading so it can't take over later.
        commit(
          prev
            .filter((s) => s.phase !== 'loading')
            .map((s) => (s === current ? { ...s, p: presentation!, phase: 'shown' as Phase } : s))
        )
      } else if (current.p !== presentation) {
        commit(prev.map((s) => (s === current ? { ...s, p: presentation! } : s)))
      }
      return
    }
    // Something new: whatever is visible goes stale; anything still loading is dropped.
    const next: Slot[] = prev
      .filter((s) => s.phase !== 'loading')
      .map((s) => (s.phase === 'shown' || s.phase === 'in' ? { ...s, phase: 'stale' as Phase } : s))
    if (presentation && key) {
      const slot = ++seq.current
      next.push({ key, seq: slot, p: presentation, phase: 'loading', ms: 0, delay: 0, endsAt: 0 })
      commit(next.slice(-4))
      later(READY_TIMEOUT, () => ready(slot))
    } else {
      commit(next)
      reveal(null)
    }
  }, [key, presentation, commit, later, ready, reveal])

  return (
    <>
      {slots.map((s) => (
        <SlotView
          key={s.seq}
          slot={s}
          size={size}
          transition={role === 'preview' ? PREVIEW_TRANSITION : transition}
          onReady={ready}
        />
      ))}
    </>
  )
}

function SlotView({
  slot,
  size,
  transition,
  onReady
}: {
  slot: Slot
  size: Size
  transition: TransitionSettings
  onReady: (slot: number) => void
}) {
  const { role } = useStage()
  const p = slot.p
  const visible = slot.phase === 'in' || slot.phase === 'shown' || slot.phase === 'stale'
  const style = {
    opacity: visible ? 1 : 0,
    transition: slot.ms ? `opacity ${slot.ms}ms cubic-bezier(0.4, 0, 0.2, 1) ${slot.delay}ms` : 'none'
  }
  const ready = useCallback(() => onReady(slot.seq), [onReady, slot.seq])
  const leaving = slot.phase === 'out'
  return (
    <div className="stage-slot" style={style} data-kind={p.kind} data-phase={slot.phase} data-key={slot.key}>
      <ItemView p={p} size={size} role={role} transition={transition} leaving={leaving} onReady={ready} />
    </div>
  )
}

function ItemView({
  p,
  size,
  role,
  transition,
  leaving,
  onReady
}: {
  p: Presentation
  size: Size
  role: ReturnType<typeof useStage>['role']
  transition: TransitionSettings
  leaving: boolean
  onReady: () => void
}) {
  switch (p.kind) {
    case 'image':
      return <ImageView src={p.src!} fit={p.fit} zoom={p.zoom} onReady={onReady} alt={p.title} />
    case 'pdf':
      return (
        <ImageView
          src={`${p.pageBase}${pageFile((p.page ?? 0) + 1)}`}
          fit={p.fit === 'blur' ? 'blur' : p.fit}
          zoom={p.zoom}
          onReady={onReady}
          retry
        />
      )
    case 'video':
    case 'audio':
      return <VideoView p={p} leaving={leaving} onReady={onReady} />
    case 'deck':
      return p.deck ? (
        <SlideView
          deck={p.deck}
          index={p.page ?? 0}
          media={p.deckMedia}
          width={size.width}
          height={size.height}
          role={role}
          transition={transition}
          onReady={onReady}
        />
      ) : null
    case 'color':
      return <ColorView color={p.color ?? '#000'} onReady={onReady} />
    case 'ambient':
      return <AmbientView p={p} role={role} width={size.width} height={size.height} onReady={onReady} />
  }
}
