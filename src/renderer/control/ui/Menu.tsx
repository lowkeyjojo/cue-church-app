import { ContextMenu as CM, DropdownMenu as DM } from 'radix-ui'
import { Check, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { useRef, type ReactElement, type ReactNode } from 'react'
import s from './Menu.module.css'

export type MenuEntry =
  | {
      type?: 'item'
      label: string
      icon?: ReactNode
      shortcut?: string
      onSelect: () => void
      disabled?: boolean
      danger?: boolean
    }
  | {
      type: 'check'
      label: string
      checked: boolean
      onSelect: () => void
      icon?: ReactNode
      disabled?: boolean
    }
  | { type: 'separator' }
  | { type: 'label'; label: string }
  | { type: 'sub'; label: string; icon?: ReactNode; items: MenuEntry[]; disabled?: boolean }
  | false
  | ''
  | 0
  | null
  | undefined

/** Dropdown and context menus share item rendering; their item parts are structurally identical. */
const Parts = DM as unknown as typeof DM

type Select = (action: () => void) => void

function Items({ items, select, M = Parts }: { items: MenuEntry[]; select: Select; M?: typeof DM }) {
  const visible = items.filter(Boolean) as Exclude<MenuEntry, false | '' | 0 | null | undefined>[]
  // Drop leading/trailing/double separators left behind by conditional items.
  const cleaned = visible.filter((e, i, arr) => {
    if (e.type !== 'separator') return true
    const prev = arr[i - 1]
    return i > 0 && i < arr.length - 1 && prev?.type !== 'separator'
  })
  return (
    <>
      {cleaned.map((e, i) => {
        if (e.type === 'separator') return <M.Separator key={i} className={s.separator} />
        if (e.type === 'label')
          return (
            <M.Label key={i} className={s.label}>
              {e.label}
            </M.Label>
          )
        if (e.type === 'check')
          return (
            <M.CheckboxItem
              key={i}
              className={s.item}
              checked={e.checked}
              onSelect={() => select(e.onSelect)}
              disabled={e.disabled}
            >
              <span className={s.icon}>{e.icon}</span>
              <span className={s.text}>{e.label}</span>
              <M.ItemIndicator className={s.indicator}>
                <Check size={14} />
              </M.ItemIndicator>
            </M.CheckboxItem>
          )
        if (e.type === 'sub')
          return (
            <M.Sub key={i}>
              <M.SubTrigger className={s.item} disabled={e.disabled}>
                <span className={s.icon}>{e.icon}</span>
                <span className={s.text}>{e.label}</span>
                <ChevronRight size={14} className={s.chevron} />
              </M.SubTrigger>
              <M.Portal>
                <M.SubContent className={s.content} sideOffset={4} alignOffset={-5} collisionPadding={8}>
                  <Items items={e.items} select={select} M={M} />
                </M.SubContent>
              </M.Portal>
            </M.Sub>
          )
        return (
          <M.Item
            key={i}
            className={clsx(s.item, e.danger && s.danger)}
            onSelect={() => select(e.onSelect)}
            disabled={e.disabled}
          >
            <span className={s.icon}>{e.icon}</span>
            <span className={s.text}>{e.label}</span>
            {e.shortcut && <span className={s.shortcut}>{e.shortcut}</span>}
          </M.Item>
        )
      })}
    </>
  )
}

/**
 * Menu actions run once the menu has fully closed. While it's open it holds
 * focus, so an action that opens an inline rename or a notes field would lose
 * that focus back to the row, where typing fires live shortcuts. Radix also
 * puts focus back on whatever opened the menu; anything the action focused
 * itself keeps it.
 */
function useDeferredSelect(): { select: Select; onCloseAutoFocus: (event: Event) => void } {
  const pending = useRef<(() => void) | null>(null)
  return {
    select: (action) => (pending.current = action),
    onCloseAutoFocus: (event) => {
      const action = pending.current
      pending.current = null
      action?.()
      const active = document.activeElement
      if (active && active !== document.body && !active.closest('[data-radix-menu-content]'))
        event.preventDefault()
    }
  }
}

export function DropdownMenu({
  trigger,
  items,
  align = 'start',
  side = 'bottom',
  width,
  onOpenChange
}: {
  trigger: ReactElement
  items: MenuEntry[]
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
  width?: number
  onOpenChange?: (open: boolean) => void
}) {
  const { select, onCloseAutoFocus } = useDeferredSelect()
  return (
    <DM.Root onOpenChange={onOpenChange}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content
          className={s.content}
          onCloseAutoFocus={onCloseAutoFocus}
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={8}
          style={width ? { minWidth: width } : undefined}
        >
          <Items items={items} select={select} />
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  )
}

export function ContextMenu({
  items,
  children,
  disabled,
  onOpenChange
}: {
  items: MenuEntry[] | (() => MenuEntry[])
  children: ReactElement
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { select, onCloseAutoFocus } = useDeferredSelect()
  if (disabled) return children
  return (
    <CM.Root onOpenChange={onOpenChange}>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content className={s.content} collisionPadding={8} onCloseAutoFocus={onCloseAutoFocus}>
          <Items
            items={typeof items === 'function' ? items() : items}
            select={select}
            M={CM as unknown as typeof DM}
          />
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  )
}
