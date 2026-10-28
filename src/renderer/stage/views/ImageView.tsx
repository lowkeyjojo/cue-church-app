import { useEffect, useRef, useState } from 'react'
import type { FitMode, Zoom } from '@shared/types'
import { useStage } from '../context'
import { zoomTransform } from '../zoom'

interface Props {
  src: string
  fit: FitMode
  zoom?: Zoom
  onReady: () => void
  /** Keep retrying a missing file (e.g. a PDF page that is still being rendered). */
  retry?: boolean
  alt?: string
}

/**
 * A still image (photo, GIF, rendered PDF page). It is fully decoded before it
 * reports ready, so transitions never reveal a half-painted image.
 */
export function ImageView({ src, fit, zoom, onReady, retry, alt = '' }: Props) {
  const { role } = useStage()
  const img = useRef<HTMLImageElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const readyRef = useRef(onReady)
  readyRef.current = onReady
  const url = attempt ? `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}` : src

  useEffect(() => {
    setAttempt(0)
    setFailed(false)
  }, [src])

  useEffect(() => {
    const el = img.current
    if (!el) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    el.decode().then(
      () => {
        if (cancelled) return
        setFailed(false)
        readyRef.current()
      },
      () => {
        if (cancelled) return
        if (retry && attempt < 40) {
          timer = setTimeout(() => setAttempt((a) => a + 1), 750)
        } else {
          setFailed(true)
          readyRef.current()
        }
      }
    )
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [url, retry, attempt])

  const transform = zoomTransform(zoom)
  return (
    <div className="stage-fill">
      {fit === 'blur' && <img className="stage-backdrop" src={url} alt="" draggable={false} />}
      <div
        className={`stage-zoom${role === 'output' || role === 'live' ? ' stage-zoom-animated' : ''}`}
        style={{ transform }}
      >
        <img
          ref={img}
          className={`stage-media fit-${fit === 'fill' ? 'fill' : 'fit'}`}
          src={url}
          alt={alt}
          draggable={false}
          decoding="async"
        />
      </div>
      {failed && role !== 'output' && <div className="stage-note">Image unavailable</div>}
      {retry && attempt > 0 && !failed && role !== 'output' && (
        <div className="stage-note">Preparing page…</div>
      )}
    </div>
  )
}
