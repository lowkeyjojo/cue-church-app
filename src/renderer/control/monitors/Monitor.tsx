import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { canZoom } from '@shared/show/presentation'
import type { Zoom } from '@shared/types'
import { throttle } from '@shared/util'
import { Stage } from '../../stage/Stage'
import { panBy, zoomAround } from '../../stage/zoom'
import { dispatch } from '../lib/api'
import {
  claimDrop,
  droppedPaths,
  hasDragType,
  ingestPick,
  readMediaDrag,
  readWebDrop,
  DRAG_MEDIA,
  DRAG_PICK
} from '../lib/dnd'
import { importPaths, previewMedia, showMedia } from '../lib/planActions'
import { useApp, useSettings, useShow } from '../lib/store'
import s from './Monitor.module.css'

interface Props {
  role: 'preview' | 'live'
  width: number
  height: number
}

/**
 * A live, interactive mirror of the audience screen (Live) or of what's staged
 * next (Preview). Scroll to zoom into an image or page, drag to pan, and drop
 * media onto it.
 */
export function Monitor({ role, width, height }: Props) {
  const show = useShow()!
  const settings = useSettings()!
  const playback = useApp((st) => (role === 'live' ? st.playback : null))
  const p = role === 'live' ? show.live : show.preview
  const el = useRef<HTMLDivElement>(null)
  const zoom = useRef<Zoom | undefined>(p?.zoom)
  const panning = useRef<{ id: number } | null>(null)
  const [dropping, setDropping] = useState(false)
  const zoomable = canZoom(p)

  useEffect(() => {
    if (!panning.current) zoom.current = p?.zoom
  }, [p?.zoom, p?.id])

  const send = useMemo(
    () =>
      throttle(
        (z: Zoom | undefined) =>
          dispatch({ type: 'zoom', where: role, zoom: z && z.scale > 1.001 ? z : null }),
        33
      ),
    [role]
  )

  // Wheel needs a non-passive listener to stop the panel from scrolling.
  useEffect(() => {
    const node = el.current
    if (!node || !zoomable) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = node.getBoundingClientRect()
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))
      zoom.current = zoomAround(
        zoom.current,
        factor,
        (e.clientX - r.left) / r.width,
        (e.clientY - r.top) / r.height
      )
      send(zoom.current)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [zoomable, send])

  const onPointerDown = (e: React.PointerEvent) => {
    if (!zoomable || !zoom.current || zoom.current.scale <= 1.001 || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    panning.current = { id: e.pointerId }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!panning.current || !zoom.current) return
    const r = e.currentTarget.getBoundingClientRect()
    zoom.current = panBy(zoom.current, e.movementX / r.width, e.movementY / r.height)
    send(zoom.current)
  }
  const onPointerUp = () => {
    panning.current = null
  }
  const onDoubleClick = () => {
    if (role === 'preview') dispatch({ type: 'take' })
    else if (p?.zoom) dispatch({ type: 'zoom', where: 'live', zoom: null })
  }

  const accepts = (dt: DataTransfer) =>
    hasDragType(dt, DRAG_MEDIA, DRAG_PICK, 'Files', 'text/uri-list', 'text/html')
  const onDragOver = (e: React.DragEvent) => {
    if (!accepts(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropping(true)
  }
  const onDrop = async (e: React.DragEvent) => {
    setDropping(false)
    if (!accepts(e.dataTransfer)) return
    claimDrop(e)
    const dt = e.dataTransfer
    const go = (id: string) => (role === 'live' ? showMedia(id) : previewMedia(id))
    const ids = readMediaDrag(dt)
    if (ids?.length) return go(ids[0])
    const paths = droppedPaths(dt)
    if (paths.length) {
      const items = await importPaths(paths)
      if (items[0]) go(items[0].id)
      return
    }
    const pick = readWebDrop(dt)
    if (pick) {
      const item = await ingestPick(pick)
      if (item) go(item.id)
    }
  }

  const onAir = role === 'live' && !!(show.live || show.ambient.active) && !show.blackout
  const volume = 0
  return (
    <div
      ref={el}
      className={clsx(
        s.monitor,
        s[role],
        onAir && s.onAir,
        dropping && s.dropping,
        zoomable && p?.zoom && s.pannable
      )}
      style={{ width, height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onDragOver={onDragOver}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
      data-testid={`monitor-${role}`}
    >
      <Stage
        role={role}
        presentation={p}
        transition={show.transition}
        blackout={role === 'live' && show.blackout}
        ambient={role === 'live' ? show.ambient : null}
        background={settings.output.background}
        inset={role === 'live' ? settings.output.inset : 0}
        credits={settings.output.showCredits}
        volume={volume}
        playback={playback}
        testPattern={role === 'live' && show.testPattern}
        testPatternName={`Cue · ${settings.output.name}`}
      />
      {!p && !(role === 'live' && show.ambient.active) && (
        <div className={s.empty}>
          {role === 'preview' ? 'Click anything to preview it here' : 'Nothing on screen'}
        </div>
      )}
      {role === 'live' && show.blackout && (
        <div className={s.state}>
          <span className={s.stateBadge}>Blackout</span>
          {show.live && <span className={s.stateBehind}>Behind: {show.live.title}</span>}
        </div>
      )}
      {role === 'live' && !show.blackout && show.ambient.active && (
        <span className={clsx(s.corner, s.cornerAmbient)}>Ambient</span>
      )}
      {p?.zoom && <span className={s.zoomBadge}>{Math.round(p.zoom.scale * 100)}%</span>}
      {dropping && <div className={s.drop}>{role === 'live' ? 'Drop to show now' : 'Drop to preview'}</div>}
    </div>
  )
}
