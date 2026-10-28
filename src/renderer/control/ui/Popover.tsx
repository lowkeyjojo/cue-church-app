import { Popover as P } from 'radix-ui'
import clsx from 'clsx'
import type { ReactElement, ReactNode } from 'react'
import s from './Popover.module.css'

export function Popover({
  trigger,
  children,
  align = 'center',
  side = 'bottom',
  width = 300,
  open,
  onOpenChange,
  className
}: {
  trigger: ReactElement
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
  width?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content
          className={clsx(s.content, className)}
          align={align}
          side={side}
          sideOffset={8}
          collisionPadding={10}
          style={{ width }}
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}

export const PopoverClose = P.Close
