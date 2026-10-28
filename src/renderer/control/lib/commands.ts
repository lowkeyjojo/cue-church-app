import type { UiCommand } from '@shared/ipc'
import { importMedia, newPlan } from './planActions'
import { useUI } from './ui'

export const FOCUS_SEARCH_EVENT = 'cue:focus-search'
/** Run a Google Images search in the Search tab (detail: the query). */
export const GOOGLE_SEARCH_EVENT = 'cue:google-search'

/** UI commands from menus, shortcuts and the embedded browser. */
export function runUiCommand(cmd: UiCommand): void {
  const ui = useUI.getState()
  switch (cmd) {
    case 'open-settings':
      ui.open('settings', 'output')
      break
    case 'open-palette':
      ui.open('palette', true)
      break
    case 'import':
      void importMedia()
      break
    case 'quick-slide':
      ui.open('quickSlide', {})
      break
    case 'new-plan':
      void newPlan()
      break
    case 'tab-show':
      ui.setTab('show')
      break
    case 'tab-search':
      ui.setTab('search')
      break
    case 'tab-library':
      ui.setTab('library')
      break
    case 'focus-search':
      ui.setTab('search')
      requestAnimationFrame(() => window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT)))
      break
    case 'about':
      ui.open('about', true)
      break
    case 'shortcuts':
      ui.open('shortcuts', true)
      break
  }
}
