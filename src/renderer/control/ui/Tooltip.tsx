import { Tooltip as T } from 'radix-ui'
import type { ReactElement, ReactNode } from 'react'
import s from './Tooltip.module.css'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <T.Provider delayDuration={450} skipDelayDuration={250}>
      {children}
    </T.Provider>
  )
}

export function Tooltip({
  label,
  shortcut,
  side = 'top',
  children
}: {
  label?: ReactNode
  shortcut?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: ReactElement
}) {
  if (!label) return children
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content className={s.tooltip} side={side} sideOffset={6} collisionPadding={8}>
          <span>{label}</span>
          {shortcut && (
            <span className={s.keys}>
              {shortcut.split(' ').map((k, i) => (
                <kbd key={i}>{k}</kbd>
              ))}
            </span>
          )}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
