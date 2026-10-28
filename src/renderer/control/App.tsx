import { useEffect, type CSSProperties } from 'react'
import clsx from 'clsx'
import { Upload } from 'lucide-react'
import { bridge } from './lib/api'
import { runUiCommand } from './lib/commands'
import { usePaste, useFileDrop } from './lib/dnd'
import { useKeyboard } from './lib/keyboard'
import { useApp, useSettings } from './lib/store'
import { useUI } from './lib/ui'
import { LiveBar } from './layout/LiveBar'
import { Resizer } from './layout/Resizer'
import { Sidebar } from './layout/Sidebar'
import { Toasts } from './layout/Toasts'
import { TopBar } from './layout/TopBar'
import { Workspace } from './layout/Workspace'
import { MonitorsPanel } from './monitors/MonitorsPanel'
import { Dialogs } from './features/Dialogs'
import { TooltipProvider } from './ui/Tooltip'
import s from './App.module.css'

export function App() {
  const ready = useApp((st) => st.ready)
  const settings = useSettings()
  useKeyboard()
  usePaste()
  const dropping = useFileDrop()

  useEffect(() => bridge.on('ui:command', runUiCommand), [])

  // Restore where the operator left off.
  useEffect(() => {
    if (!ready || !settings) return
    const ui = useUI.getState()
    const plans = useApp.getState().plans
    const planId =
      settings.ui.planId && plans.some((p) => p.id === settings.ui.planId)
        ? settings.ui.planId
        : (plans[0]?.id ?? null)
    ui.setPlan(planId)
    ui.setTab(settings.ui.tab)
    if (!settings.ui.firstRunDone) ui.open('welcome', true)
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  if (!ready || !settings) {
    return (
      <div className={s.splash}>
        <div className={s.splashMark} />
      </div>
    )
  }

  const vars = {
    '--left-w': `${settings.ui.leftWidth}px`,
    '--right-w': `${settings.ui.rightWidth}px`
  } as CSSProperties
  return (
    <TooltipProvider>
      <div className={clsx(s.app, `platform-${bridge.platform}`)} style={vars}>
        <TopBar />
        <div className={s.main}>
          <Sidebar />
          <Resizer side="left" />
          <Workspace />
          <Resizer side="right" />
          <MonitorsPanel />
        </div>
        <LiveBar />
      </div>
      <Toasts />
      <Dialogs />
      {dropping && (
        <div className={s.dropOverlay}>
          <div className={s.dropCard}>
            <Upload size={22} />
            <span>Drop to add to your library</span>
          </div>
        </div>
      )}
    </TooltipProvider>
  )
}
