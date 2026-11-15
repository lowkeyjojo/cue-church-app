import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Library, Presentation, Search } from 'lucide-react'
import { attempt, modKey } from '../lib/api'
import { useUI, type Tab } from '../lib/ui'
import { LibraryView } from '../features/library/LibraryView'
import { SearchView } from '../features/search/SearchView'
import { ShowView } from '../features/show/ShowView'
import { Tooltip } from '../ui/Tooltip'
import s from './Workspace.module.css'

const TABS: { id: Tab; label: string; icon: ReactNode; key: string }[] = [
  { id: 'show', label: 'Show', icon: <Presentation size={15} />, key: '1' },
  { id: 'search', label: 'Search', icon: <Search size={15} />, key: '2' },
  { id: 'library', label: 'Library', icon: <Library size={15} />, key: '3' }
]

const ToolbarSlot = createContext<HTMLElement | null>(null)

/** Lets the active view put its controls in the tab row. */
export function Toolbar({ active, children }: { active: boolean; children: ReactNode }) {
  const slot = useContext(ToolbarSlot)
  return active && slot ? createPortal(children, slot) : null
}

export function Workspace() {
  const tab = useUI((st) => st.tab)
  const setTab = useUI((st) => st.setTab)
  const [slot, setSlot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    void attempt('settings:update', { ui: { tab } })
  }, [tab])

  return (
    <main className={s.workspace}>
      <div className={s.tabbar}>
        <div className={clsx(s.tabs, 'collapsible')} role="tablist" aria-label="Workspace">
          {TABS.map((t) => (
            <Tooltip key={t.id} label={t.label} shortcut={`${modKey} ${t.key}`} side="bottom">
              <button
                role="tab"
                aria-selected={tab === t.id}
                className={clsx(s.tab, tab === t.id && s.tabOn)}
                onClick={() => setTab(t.id)}
              >
                {t.icon}
                <span data-label>{t.label}</span>
              </button>
            </Tooltip>
          ))}
        </div>
        <div className={s.toolbar} ref={setSlot} />
      </div>
      <ToolbarSlot.Provider value={slot}>
        <div className={s.views}>
          <div
            className={clsx(s.view, tab === 'show' && s.active)}
            role="tabpanel"
            aria-hidden={tab !== 'show'}
          >
            <ShowView active={tab === 'show'} />
          </div>
          <div
            className={clsx(s.view, tab === 'search' && s.active)}
            role="tabpanel"
            aria-hidden={tab !== 'search'}
          >
            <SearchView active={tab === 'search'} />
          </div>
          <div
            className={clsx(s.view, tab === 'library' && s.active)}
            role="tabpanel"
            aria-hidden={tab !== 'library'}
          >
            <LibraryView active={tab === 'library'} />
          </div>
        </div>
      </ToolbarSlot.Provider>
    </main>
  )
}
