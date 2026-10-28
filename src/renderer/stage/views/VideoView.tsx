import { useEffect, useRef, useState } from 'react'
import type { Presentation } from '@shared/types'
import { useStage } from '../context'

interface Props {
  p: Presentation
  /** True while this video is being transitioned away from. */
  leaving: boolean
  onReady: () => void
}

/**
 * Video (and audio-only) playback.
 *
 * - On the audience output it is audible, follows the declarative transport
 *   (play/pause/seek nonce), ramps volume in and out to avoid pops, routes audio
 *   to the chosen device and reports playback back to the operator.
 * - On the Live monitor it is muted and kept in sync with the output.
 * - On the Preview monitor it rests on its first frame.
 */
export function VideoView({ p, leaving, onReady }: Props) {
  const { role, volume, sinkId, playback, onPlayback, transitionMs } = useStage()
  const ref = useRef<HTMLVideoElement>(null)
  const backdrop = useRef<HTMLCanvasElement>(null)
  const appliedNonce = useRef<number | null>(null)
  const readyFired = useRef(false)
  const gain = useRef(0)
  const ramp = useRef<number | null>(null)
  const lastReport = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const output = role === 'output'
  const isAudio = p.kind === 'audio'
  const transport = p.transport
  const target = leaving ? 0 : volume * (p.volume ?? 1)

  const report = (force = false) => {
    const v = ref.current
    if (!v || !output || leaving || !onPlayback) return
    const now = Date.now()
    if (!force && now - lastReport.current < 240) return
    lastReport.current = now
    onPlayback({
      presentationId: p.id,
      currentTime: v.currentTime,
      duration: Number.isFinite(v.duration) ? v.duration : (p.duration ?? 0),
      paused: v.paused,
      ended: v.ended || (!!p.endAt && v.currentTime >= p.endAt && v.paused),
      buffering: v.readyState < 3 && !v.paused,
      error: error ?? undefined,
      at: now
    })
  }

  // Listeners are attached once; they read the latest props through this ref.
  const latest = useRef({ p, report, transport, role })
  latest.current = { p, report, transport, role }

  // Wire element events once.
  useEffect(() => {
    const v = ref.current!
    const markReady = () => {
      if (readyFired.current) return
      readyFired.current = true
      onReady()
    }
    const onMeta = () => {
      const { p, transport, role } = latest.current
      const start = role === 'preview' ? (p.startAt ?? 0) : (transport?.seek.time ?? p.startAt ?? 0)
      if (start > 0 && Number.isFinite(v.duration))
        v.currentTime = Math.min(start, Math.max(0, v.duration - 0.1))
      appliedNonce.current = transport?.seek.nonce ?? 0
    }
    const onError = () => {
      const code = v.error?.code
      setError(code === 4 ? "This video's format isn't supported" : "This video couldn't be played")
      markReady()
      latest.current.report(true)
    }
    const onTime = () => {
      const { p, report } = latest.current
      if (p.endAt && v.currentTime >= p.endAt) {
        if (p.loop) v.currentTime = p.startAt ?? 0
        else if (!v.paused) {
          v.pause()
          report(true)
        }
      }
      report()
    }
    const forceReport = () => latest.current.report(true)
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('loadeddata', markReady)
    v.addEventListener('canplay', markReady)
    v.addEventListener('error', onError)
    v.addEventListener('timeupdate', onTime)
    for (const e of ['play', 'pause', 'seeked', 'ended', 'waiting', 'playing', 'durationchange'])
      v.addEventListener(e, forceReport)
    const fallback = setTimeout(markReady, 4000)
    return () => {
      clearTimeout(fallback)
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('loadeddata', markReady)
      v.removeEventListener('canplay', markReady)
      v.removeEventListener('error', onError)
      v.removeEventListener('timeupdate', onTime)
      for (const e of ['play', 'pause', 'seeked', 'ended', 'waiting', 'playing', 'durationchange'])
        v.removeEventListener(e, forceReport)
    }
    // Element wiring is per mounted presentation instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Play / pause.
  useEffect(() => {
    const v = ref.current!
    v.loop = !!p.loop && !p.endAt
    if (role === 'preview') {
      v.pause()
      return
    }
    if (role === 'live') return // follows playback reports below
    if (leaving) return // the volume ramp pauses it when silent
    if (transport?.playing) void v.play().catch(() => undefined)
    else v.pause()
  }, [role, leaving, transport?.playing, p.loop, p.endAt])

  // Seek requests.
  useEffect(() => {
    const v = ref.current!
    if (!transport || role === 'preview' || appliedNonce.current === null) return
    if (transport.seek.nonce !== appliedNonce.current) {
      appliedNonce.current = transport.seek.nonce
      v.currentTime = transport.seek.time
    }
  }, [role, transport?.seek.nonce, transport?.seek.time, transport])

  // Smooth volume changes (and the fade-out when leaving).
  useEffect(() => {
    const v = ref.current!
    if (!output) {
      v.muted = true
      return
    }
    v.muted = false
    if (ramp.current) cancelAnimationFrame(ramp.current)
    const from = gain.current
    const duration = leaving ? Math.max(150, transitionMs) : 220
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      gain.current = from + (target - from) * t
      v.volume = Math.max(0, Math.min(1, gain.current))
      if (t < 1) ramp.current = requestAnimationFrame(step)
      else {
        ramp.current = null
        if (leaving) v.pause()
      }
    }
    ramp.current = requestAnimationFrame(step)
    return () => {
      if (ramp.current) cancelAnimationFrame(ramp.current)
    }
  }, [output, target, leaving, transitionMs])

  // Route audio to the chosen output device.
  useEffect(() => {
    const v = ref.current as HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }
    if (!output || !v.setSinkId) return
    v.setSinkId(sinkId === 'default' ? '' : sinkId).catch(() => undefined)
  }, [output, sinkId])

  // The Live monitor mirrors the output's playback.
  useEffect(() => {
    const v = ref.current!
    if (role !== 'live' || !playback || playback.presentationId !== p.id) return
    const expected = playback.currentTime + (playback.paused ? 0 : (Date.now() - playback.at) / 1000)
    if (Math.abs(v.currentTime - expected) > 0.35) v.currentTime = expected
    if (playback.paused && !v.paused) v.pause()
    if (!playback.paused && v.paused) void v.play().catch(() => undefined)
  }, [role, playback, p.id])

  // Blurred backdrop for "blur" fit: a tiny canvas fed with video frames.
  useEffect(() => {
    if (p.fit !== 'blur' || isAudio) return
    const v = ref.current! as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number
      cancelVideoFrameCallback?: (id: number) => void
    }
    const c = backdrop.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    let handle = 0
    let stopped = false
    const draw = () => {
      if (stopped) return
      try {
        ctx.drawImage(v, 0, 0, c.width, c.height)
      } catch {
        /* not ready yet */
      }
      handle = v.requestVideoFrameCallback ? v.requestVideoFrameCallback(draw) : requestAnimationFrame(draw)
    }
    draw()
    return () => {
      stopped = true
      if (v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(handle)
      else cancelAnimationFrame(handle)
    }
  }, [p.fit, isAudio])

  return (
    <div className="stage-fill">
      {p.fit === 'blur' && !isAudio && (
        <canvas ref={backdrop} className="stage-backdrop" width={64} height={36} />
      )}
      <video
        ref={ref}
        className={`stage-media fit-${p.fit === 'fill' ? 'fill' : 'fit'}${isAudio ? ' stage-hidden' : ''}`}
        src={p.src}
        preload="auto"
        playsInline
        crossOrigin="anonymous"
        disablePictureInPicture
        disableRemotePlayback
        muted={!output}
      />
      {isAudio && role !== 'output' && (
        <div className="stage-audio">
          <span className="stage-audio-icon">♪</span>
          <span>{p.title}</span>
        </div>
      )}
      {error && role !== 'output' && <div className="stage-note">{error}</div>}
    </div>
  )
}
