import { HistoryPanel } from '../features/history/HistoryPanel'
import { PlanPanel } from '../features/plan/PlanPanel'
import s from './Sidebar.module.css'

export function Sidebar() {
  return (
    <aside className={s.sidebar}>
      <PlanPanel />
      <HistoryPanel />
    </aside>
  )
}
