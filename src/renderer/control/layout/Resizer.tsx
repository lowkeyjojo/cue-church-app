import { useRef } from 'react'
import { attempt } from '../lib/api'
import { useApp } from '../lib/store'
import s from './Resizer.module.css'

const LIMITS = { left: [220, 440], right: [340, 760] } as const

/** Drag handle between panels; widths persist in settings. */
export function Resizer({ side }: { side: 'left' | 'right' }) {
  const start = useRef<{ x: number; width: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    const settings = useApp.getState().settings
    if (!settings) return
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, width: side === 'left' ? settings.ui.leftWidth : settings.ui.rightWidth }
    document.body.style.cursor = 'col-resize'
  }
  const widthAt = (clientX: number) => {
    const st = start.current!
    const delta = side === 'left' ? clientX - st.x : st.x - clientX
    const [min, max] = LIMITS[side]
    return Math.round(Math.max(min, Math.min(max, st.width + delta)))
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return
    const app = e.currentTarget.closest('[style*="--left-w"]') as HTMLElement | null
    app?.style.setProperty(side === 'left' ? '--left-w' : '--right-w', `${widthAt(e.clientX)}px`)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!start.current) return
    const width = widthAt(e.clientX)
    start.current = null
    document.body.style.cursor = ''
    void attempt('settings:update', { ui: side === 'left' ? { leftWidth: width } : { rightWidth: width } })
  }
  return (
    <div className={s.track}>
      <div
        className={s.handle}
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  )
}
