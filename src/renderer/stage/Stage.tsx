import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { OutputIdentify } from '@shared/ipc'
import type { PlaybackStatus, Presentation, ShowState, TransitionSettings } from '@shared/types'
import { ContentLayer } from './ContentLayer'
import { StageContext, type StageRole } from './context'
import { CreditOverlay, IdentifyOverlay, TestPattern } from './overlays'
import { useElementSize, type Size } from './useElementSize'
import { AmbientView } from './views/AmbientView'
import './stage.css'

export interface StageProps {
  role: StageRole
  presentation: Presentation | null
  transition: TransitionSettings
  blackout?: boolean
  ambient?: ShowState['ambient'] | null
  background?: string
  /** Overscan compensation in percent of each edge. */
  inset?: number
  credits?: boolean
  /** Effective volume 0..1 (output only). */
  volume?: number
  sinkId?: string
  playback?: PlaybackStatus | null
  onPlayback?: (status: PlaybackStatus | null) => void
  testPattern?: boolean
  testPatternName?: string
  identify?: OutputIdentify | null
  children?: ReactNode
}

/**
 * Everything the audience sees, rendered identically on the audience output
 * and in the operator's monitors. Layers, bottom to top:
 * content (with transitions) → credit → ambient → test pattern → blackout.
 */
export function Stage(props: StageProps) {
  const { role, presentation, transition, blackout = false, ambient, background = '#000', inset = 0 } = props
  const [ref, size] = useElementSize<HTMLDivElement>()
  const ctx = useMemo(
    () => ({
      role,
      volume: props.volume ?? 0,
      sinkId: props.sinkId ?? '',
      playback: props.playback ?? null,
      onPlayback: props.onPlayback,
      transitionMs: transition.kind === 'cut' ? 0 : transition.duration
    }),
    [role, props.volume, props.sinkId, props.playback, props.onPlayback, transition.kind, transition.duration]
  )
  const blackoutMs = transition.kind === 'cut' ? 0 : Math.min(700, Math.max(280, transition.duration))
  const canvasStyle = inset > 0 ? { inset: `${inset}%` } : undefined
  return (
    <StageContext.Provider value={ctx}>
      <div className={`stage stage-role-${role}`} style={{ background }}>
        <div ref={ref} className="stage-canvas" style={canvasStyle}>
          {size.width > 0 && <ContentLayer presentation={presentation} transition={transition} size={size} />}
          {props.credits && presentation?.credit && <CreditOverlay text={presentation.credit} />}
          {ambient && <AmbientLayer ambient={ambient} size={size} role={role} />}
          {props.testPattern && <TestPattern size={size} name={props.testPatternName ?? 'Cue'} />}
        </div>
        <div
          className="stage-blackout"
          style={{ opacity: blackout ? 1 : 0, transitionDuration: `${blackoutMs}ms` }}
        />
        {props.identify && <IdentifyOverlay info={props.identify} />}
        {props.children}
      </div>
    </StageContext.Provider>
  )
}

/** Fades the ambient scene over the content and back, unmounting it when hidden. */
function AmbientLayer({
  ambient,
  size,
  role
}: {
  ambient: ShowState['ambient']
  size: Size
  role: StageRole
}) {
  const { active, presentation } = ambient
  const [mounted, setMounted] = useState(active)
  const [visible, setVisible] = useState(active)
  useEffect(() => {
    if (active) {
      setMounted(true)
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
      return () => cancelAnimationFrame(raf)
    }
    setVisible(false)
    const t = setTimeout(() => setMounted(false), 1000)
    return () => clearTimeout(t)
  }, [active])
  if (!presentation || !mounted) return null
  return (
    <div className="stage-ambient" style={{ opacity: visible ? 1 : 0 }}>
      <AmbientView p={presentation} role={role} width={size.width} height={size.height} />
    </div>
  )
}
