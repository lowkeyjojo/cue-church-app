import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { fontFamily } from '@shared/defaults'
import type { AmbientOverlay, Presentation, ResolvedAmbient } from '@shared/types'
import type { StageRole } from '../context'
import { GenerativeBackground } from '../GenerativeBackground'
import { SLIDE_H, SLIDE_W } from '../slides/SlideView'

interface Props {
  p: Presentation
  role: StageRole
  width: number
  height: number
  onReady?: () => void
}

/** Ambient scene: generative motion or a media playlist, with an optional welcome / clock / countdown overlay. */
export function AmbientView({ p, role, width, height, onReady }: Props) {
  const amb = p.ambient
  const readyRef = useRef(onReady)
  readyRef.current = onReady
  useEffect(() => {
    readyRef.current?.()
  }, [])
  if (!amb) return null
  const config = amb.config
  return (
    <div className="stage-fill">
      {config.source === 'media' && amb.media.length ? (
        <Playlist ambient={amb} seed={p.id} role={role} />
      ) : (
        <GenerativeBackground
          theme={config.theme}
          resolution={role === 'output' ? 0.5 : 0.6}
          fps={role === 'output' ? 30 : 20}
        />
      )}
      {config.dim > 0 && <div className="stage-fill" style={{ background: `rgba(0,0,0,${config.dim})` }} />}
      {config.overlay.kind !== 'none' && (
        <OverlayText
          overlay={config.overlay}
          countdownTarget={amb.countdownTarget}
          width={width}
          height={height}
        />
      )}
    </div>
  )
}

/**
 * Rotates through stills (with a slow Ken Burns drift) and videos. The current
 * item is derived from the wall clock, so the output and monitors agree.
 */
function Playlist({ ambient, seed, role }: { ambient: ResolvedAmbient; seed: string; role: StageRole }) {
  const { config } = ambient
  const order = useMemo(() => {
    const items = ambient.media
    if (!config.shuffle) return items
    // Deterministic shuffle so every window agrees on the order.
    let h = 0
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    const arr = [...items]
    for (let i = arr.length - 1; i > 0; i--) {
      h = (h * 1103515245 + 12345) >>> 0
      const j = h % (i + 1)
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }, [ambient.media, config.shuffle, seed])

  const interval = Math.max(4, config.interval) * 1000
  const single = order.length === 1
  const [tick, setTick] = useState(() => Math.floor(Date.now() / interval))
  useEffect(() => {
    if (single) return
    const t = setInterval(() => setTick(Math.floor(Date.now() / interval)), 500)
    return () => clearInterval(t)
  }, [interval, single])

  const index = single ? 0 : tick % order.length
  const visible = single ? [0] : [index, (index - 1 + order.length) % order.length]
  return (
    <div className="stage-fill">
      {visible
        .slice()
        .reverse()
        .map((i, layer) => {
          const item = order[i]
          const current = i === index
          const style: CSSProperties = {
            opacity: current ? 1 : 0,
            transition: 'opacity 1600ms ease',
            zIndex: layer
          }
          const kb = config.kenBurns && item.kind === 'image'
          return (
            <div key={`${item.id}:${current ? tick : tick - 1}`} className="stage-fill" style={style}>
              {item.kind === 'video' ? (
                <video
                  className="stage-media fit-fill"
                  src={item.src}
                  autoPlay={role !== 'preview'}
                  muted
                  loop
                  playsInline
                  preload="auto"
                />
              ) : (
                <img
                  className={`stage-media fit-fill${kb ? ` ambient-kb ambient-kb-${tick % 4}` : ''}`}
                  style={kb ? { animationDuration: `${interval + 2000}ms` } : undefined}
                  src={item.src}
                  alt=""
                  draggable={false}
                />
              )}
            </div>
          )
        })}
    </div>
  )
}

function OverlayText({
  overlay,
  countdownTarget,
  width,
  height
}: {
  overlay: AmbientOverlay
  countdownTarget?: number
  width: number
  height: number
}) {
  const [now, setNow] = useState(Date.now())
  const ticking = overlay.kind === 'clock' || overlay.kind === 'countdown'
  useEffect(() => {
    if (!ticking) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [ticking])

  const scale = Math.min(width / SLIDE_W, height / SLIDE_H) || 0
  const font = fontFamily(overlay.font ?? 'inter')
  let headline: string | undefined
  let label: string | undefined
  let main: ReactNode = null
  let sub: string | undefined

  if (overlay.kind === 'text') {
    main = overlay.text
    sub = overlay.subtext
  } else if (overlay.kind === 'clock') {
    const d = new Date(now)
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    main = <span className="tabular">{time}</span>
    sub = overlay.text || d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  } else if (overlay.kind === 'countdown') {
    const remaining = Math.max(0, Math.ceil(((countdownTarget ?? now) - now) / 1000))
    label = overlay.subtext
    if (remaining > 0) {
      const m = Math.floor(remaining / 60)
      const s = remaining % 60
      const h = Math.floor(m / 60)
      headline = overlay.text
      main = (
        <span className="tabular">
          {h
            ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`
            : `${m}:${String(s).padStart(2, '0')}`}
        </span>
      )
    } else {
      main = overlay.countdownEndText || overlay.text || 'Welcome'
      label = undefined
    }
  }

  return (
    <div
      className="slide-canvas"
      style={{ transform: `translate(-50%, -50%) scale(${scale})`, width: SLIDE_W, height: SLIDE_H }}
    >
      <div
        className={`ambient-overlay ambient-pos-${overlay.position} ambient-kind-${overlay.kind}`}
        style={{ fontFamily: font }}
      >
        {headline && <div className="ambient-headline">{headline}</div>}
        {label && <div className="ambient-label">{label}</div>}
        {main && <div className="ambient-main">{main}</div>}
        {sub && <div className="ambient-sub">{sub}</div>}
      </div>
    </div>
  )
}
