import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import clsx from 'clsx'
import { useToasts } from '../lib/toasts'
import s from './Toasts.module.css'

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert }

export function Toasts() {
  const toasts = useToasts((st) => st.toasts)
  const dismiss = useToasts((st) => st.dismiss)
  return (
    <div className={s.stack} aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind]
        return (
          <div key={t.id} className={clsx(s.toast, s[t.kind])} role={t.kind === 'error' ? 'alert' : 'status'}>
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
