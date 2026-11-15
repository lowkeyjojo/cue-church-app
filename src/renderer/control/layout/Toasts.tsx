import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useToasts, type ToastEntry } from '../lib/toasts'
import s from './Toasts.module.css'

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert }

const LEAVE_MS = 180

/** Keeps toasts that were just dismissed for a moment, marked as leaving, so they can fade out. */
function useLeaving(current: ToastEntry[]): (ToastEntry & { leaving?: boolean })[] {
  const [shown, setShown] = useState<(ToastEntry & { leaving?: boolean })[]>(current)
  useEffect(() => {
    setShown((prev) => {
      const ids = new Set(current.map((t) => t.id))
      const gone = prev.filter((t) => !ids.has(t.id)).map((t) => ({ ...t, leaving: true }))
      return [...gone, ...current]
    })
    const timer = setTimeout(() => setShown((prev) => prev.filter((t) => !t.leaving)), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [current])
  return shown
}

export function Toasts() {
  const toasts = useLeaving(useToasts((st) => st.toasts))
  const dismiss = useToasts((st) => st.dismiss)
  return (
    <div className={s.stack} aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind]
        return (
          <div
            key={`${t.id}:${t.createdAt}`}
            className={clsx(s.toast, s[t.kind], t.leaving && s.leaving)}
            role={t.kind === 'error' ? 'alert' : 'status'}
            aria-hidden={t.leaving || undefined}
          >
            <Icon size={16} className={s.icon} />
            <div className={s.text}>
              <div className={s.title}>{t.title}</div>
              {t.message && <div className={s.message}>{t.message}</div>}
            </div>
            <button className={s.close} aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
