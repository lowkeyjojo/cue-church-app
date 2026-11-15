import type { Input } from 'electron'
import type { UiCommand } from '@shared/ipc'
import type { ShowCommand } from '@shared/types'

export type GlobalMatch = { kind: 'show'; command: ShowCommand } | { kind: 'ui'; command: UiCommand }

/**
 * Modifier shortcuts that must work even while the operator is typing in the
 * embedded Google pane (which swallows ordinary keystrokes). Mirrors the
 * renderer's handling of the same combos.
 */
export function matchGlobalShortcut(
  input: Pick<Input, 'key' | 'meta' | 'control' | 'shift' | 'alt'>,
  isMac: boolean
): GlobalMatch | null {
  const mod = isMac ? input.meta : input.control
  if (!mod || input.alt) return null
  const key = input.key.toLowerCase()
  if (key === 'enter') return input.shift ? null : { kind: 'show', command: { type: 'take' } }
  if (input.shift) {
    if (key === 'b') return { kind: 'show', command: { type: 'blackout' } }
    if (key === 'a') return { kind: 'show', command: { type: 'ambient' } }
    return null
  }
  const ui: Record<string, UiCommand> = {
    k: 'open-palette',
    '1': 'tab-show',
    '2': 'tab-search',
    '3': 'tab-library',
    ',': 'open-settings',
    t: 'quick-slide',
    l: 'focus-search',
    i: 'import'
  }
  return ui[key] ? { kind: 'ui', command: ui[key] } : null
}
