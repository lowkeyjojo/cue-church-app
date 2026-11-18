import { useEffect } from 'react'
import { canZoom, isTimed } from '@shared/show/presentation'
import type { FitMode, ShowCommand } from '@shared/types'
import { zoomAround } from '../../stage/zoom'
import { dispatch, isMac } from './api'
import { runUiCommand } from './commands'
import { previewPlanIndex } from './planActions'
import { useApp } from './store'
import { anyDialogOpen } from './ui'

const FIT_CYCLE: FitMode[] = ['fit', 'fill', 'blur']

export interface ShortcutHelp {
  keys: string[]
  label: string
}

const mod = isMac ? '⌘' : 'Ctrl'

/** Shown in the Keyboard Shortcuts sheet. Keep in sync with the handler below. */
export const SHORTCUTS: { group: string; items: ShortcutHelp[] }[] = [
  {
    group: 'Live',
    items: [
      { keys: ['Space'], label: 'Show the preview on screen (Go)' },
      { keys: [mod, '↵'], label: 'Show the preview — works while typing or browsing' },
      { keys: ['→'], label: 'Next slide / page (also Page Down, ↓)' },
      { keys: ['←'], label: 'Previous slide / page (also Page Up, ↑)' },
      { keys: ['B'], label: 'Blackout on/off (also . or ⇧' + mod + 'B anywhere)' },
      { keys: ['A'], label: 'Ambient on/off (also ⇧' + mod + 'A anywhere)' },
      { keys: ['R'], label: 'Back to what was showing before (e.g. your slides)' },
      { keys: ['Esc'], label: 'Take everything off the screen (R brings it back)' }
    ]
  },
  {
    group: 'On screen',
    items: [
      { keys: ['F'], label: 'Cycle Fit → Fill → Blur' },
      { keys: ['+', '−'], label: 'Zoom in / out on an image or page' },
      { keys: ['0'], label: 'Reset zoom' },
      { keys: ['K'], label: 'Play / pause video' },
      { keys: ['M'], label: 'Mute / unmute' }
    ]
  },
  {
    group: 'Find & prepare',
    items: [
      { keys: ['1', '…', '9'], label: 'Preview plan item 1–9' },
      { keys: [mod, 'K'], label: 'Command palette — find anything' },
      { keys: [mod, 'L'], label: 'Search images' },
      { keys: [mod, 'V'], label: 'Paste an image, link or text into Preview' },
      { keys: [mod, 'T'], label: 'Quick text slide' },
      { keys: [mod, 'I'], label: 'Import media' },
      { keys: [mod, '1 / 2 / 3'], label: 'Show / Search / Library' },
      { keys: [mod, ','], label: 'Settings' }
    ]
  }
]

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color'].includes(type)
  }
  return false
}

function inWidget(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && !!target.closest(selector)
}

const ACTIVATABLE =
  'button, a[href], summary, [role="button"], [role="switch"], [role="tab"], [role="radio"], [role="checkbox"], [role="option"]'

/**
 * A control reached with the keyboard keeps Space and Enter for itself, as
 * everywhere else. One that was just clicked with the mouse doesn't: there Space
 * still means "Show", which is what an operator expects. (`:focus-visible` can't
 * tell the two apart: Chromium turns it on as soon as a key is pressed.)
 */
function keyboardControl(target: EventTarget | null, clicked: Element | null): boolean {
  return target instanceof Element && target !== clicked && target.matches(ACTIVATABLE)
}

/** Holding a key shouldn't flicker the blackout or page through the sermon; zooming may repeat. */
const REPEATABLE = new Set(['+', '=', '-', '_'])

function show(cmd: ShowCommand) {
  dispatch(cmd)
}

/** Install Cue's keyboard shortcuts on the control window. */
export function useKeyboard(): void {
  useEffect(() => {
    // Which control the mouse last focused, so Space and Enter know who they belong to.
    let pointer = false
    let clicked: Element | null = null
    const onPointer = () => (pointer = true)
    const onFocus = (e: FocusEvent) => (clicked = pointer && e.target instanceof Element ? e.target : null)

    const onKey = (e: KeyboardEvent) => {
      pointer = false
      if (e.defaultPrevented || e.isComposing) return
      const primary = isMac ? e.metaKey : e.ctrlKey
      const key = e.key

      // Modifier shortcuts work everywhere, including while typing.
      if (primary && !e.altKey) {
        const k = key.toLowerCase()
        if (e.repeat && (key === 'Enter' || (e.shiftKey && (k === 'b' || k === 'a')))) {
          e.preventDefault()
          return
        }
        if (key === 'Enter' && !e.shiftKey) {
          // Dialogs (e.g. the command palette) use ⌘/Ctrl+Enter themselves.
          if (anyDialogOpen()) return
          e.preventDefault()
          return show({ type: 'take' })
        }
        if (e.shiftKey && k === 'b') {
          e.preventDefault()
          return show({ type: 'blackout' })
        }
        if (e.shiftKey && k === 'a') {
          e.preventDefault()
          return show({ type: 'ambient' })
        }
        if (e.shiftKey) return
        const ui = (
          {
            k: 'open-palette',
            '1': 'tab-show',
            '2': 'tab-search',
            '3': 'tab-library',
            ',': 'open-settings',
            t: 'quick-slide',
            i: 'import',
            l: 'focus-search',
            f: 'focus-search'
          } as const
        )[k as 'k']
        if (ui) {
          e.preventDefault()
          runUiCommand(ui)
        }
        return
      }

      if (e.altKey || e.metaKey || e.ctrlKey) return
      if (isTyping(e.target) || anyDialogOpen()) return
      // Menus, listboxes and sliders own their keys.
      if (
        inWidget(
          e.target,
          '[role="menu"],[role="listbox"],[role="dialog"],[role="slider"],[data-radix-popper-content-wrapper]'
        )
      )
        return

      const state = useApp.getState().show
      const live = state?.live ?? null
      const arrowNav = inWidget(e.target, '[data-arrow-nav]')
      if ((key === ' ' || key === 'Enter') && keyboardControl(e.target, clicked)) return
      if (e.repeat && !REPEATABLE.has(key) && !(arrowNav && (key === 'ArrowDown' || key === 'ArrowUp'))) {
        e.preventDefault()
        return
      }
      let handled = true
      switch (key) {
        case ' ':
        case 'Enter':
          show({ type: 'take' })
          break
        case 'ArrowRight':
        case 'PageDown':
          show({ type: 'next' })
          break
        case 'ArrowLeft':
        case 'PageUp':
          show({ type: 'prev' })
          break
        case 'ArrowDown':
          if (arrowNav) handled = false
          else show({ type: 'next' })
          break
        case 'ArrowUp':
          if (arrowNav) handled = false
          else show({ type: 'prev' })
          break
        case 'b':
        case 'B':
        case '.':
          show({ type: 'blackout' })
          break
        case 'a':
        case 'A':
          show({ type: 'ambient' })
          break
        case 'r':
        case 'R':
          show({ type: 'back' })
          break
        case 'Escape':
          // Escape first closes whatever is open (a menu, a popover); with nothing open it
          // takes the picture off the screen, as it ends a slideshow anywhere else. Both
          // commands do nothing when there is nothing to take off, so this doesn't need to
          // know what is showing: this window's copy of the state can be a moment behind.
          if (document.querySelector('[role="menu"],[data-radix-popper-content-wrapper]')) handled = false
          else {
            show({ type: 'clear' })
            show({ type: 'ambient', on: false })
          }
          break
        case 'f':
        case 'F':
          if (live && live.kind !== 'deck' && live.kind !== 'ambient' && live.kind !== 'color') {
            const next = FIT_CYCLE[(FIT_CYCLE.indexOf(live.fit) + 1) % FIT_CYCLE.length]
            show({ type: 'fit', where: 'live', fit: next })
          }
          break
        case 'k':
        case 'K':
          if (isTimed(live)) show({ type: 'video', action: 'toggle' })
          break
        case 'm':
        case 'M':
          show({ type: 'mute' })
          break
        case '+':
        case '=':
          if (canZoom(live))
            show({ type: 'zoom', where: 'live', zoom: zoomAround(live!.zoom, 1.25, 0.5, 0.5) })
          break
        case '-':
        case '_':
          if (canZoom(live))
            show({ type: 'zoom', where: 'live', zoom: zoomAround(live!.zoom, 0.8, 0.5, 0.5) })
          break
        case '0':
          // Always sent: resetting a picture that isn't zoomed does nothing, and this
          // window's copy of the state may not have caught up with a zoom made a moment ago.
          show({ type: 'zoom', where: 'live', zoom: null })
          break
        default:
          if (/^[1-9]$/.test(key)) previewPlanIndex(Number(key) - 1)
          else handled = false
      }
      if (handled) e.preventDefault()
    }
    // Capture phase: decide before a focused button turns Space/Enter into a click.
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('focusin', onFocus, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('focusin', onFocus, true)
    }
  }, [])
}
