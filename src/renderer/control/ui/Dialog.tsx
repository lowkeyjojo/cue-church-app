import { Dialog as D } from 'radix-ui'
import { X } from 'lucide-react'
import clsx from 'clsx'
import { useRef, type ReactNode } from 'react'
import s from './Dialog.module.css'

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 520,
  className,
  bodyClassName,
  initialFocus = false
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
  className?: string
  bodyClassName?: string
  /** Focus the first focusable control on open (true), or the dialog itself (false). Fields can still use autoFocus. */
  initialFocus?: boolean
}) {
  const content = useRef<HTMLDivElement>(null)
  return (
    <D.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Overlay className={s.overlay} />
        <D.Content
          ref={content}
          className={clsx(s.content, className)}
          style={{ width }}
          aria-describedby={undefined}
          tabIndex={-1}
          onOpenAutoFocus={
            initialFocus
              ? undefined
              : (e) => {
                  // Keep focus inside the dialog without highlighting the close button;
                  // a field with autoFocus will already have taken focus.
                  e.preventDefault()
                  if (!content.current?.contains(document.activeElement)) content.current?.focus()
                }
          }
        >
          {title && (
            <header className={s.header}>
              <div className={s.headings}>
                <D.Title className={s.title}>{title}</D.Title>
                {description && <D.Description className={s.description}>{description}</D.Description>}
              </div>
              <D.Close className={s.close} aria-label="Close">
                <X size={14} />
              </D.Close>
            </header>
          )}
          <div className={clsx(s.body, bodyClassName)}>{children}</div>
          {footer && <footer className={s.footer}>{footer}</footer>}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
