import { Command, Search, Settings } from 'lucide-react'
import { modKey } from '../lib/api'
import { useUI } from '../lib/ui'
import { IconButton } from '../ui/Button'
import { OutputStatus } from './OutputStatus'
import s from './TopBar.module.css'

export function TopBar() {
  const open = useUI((st) => st.open)
  return (
    <header className={s.bar}>
      <div className={s.brand}>
        <span className={s.mark} aria-hidden>
          <span className={s.markLight} />
        </span>
        <span className={s.word}>Cue</span>
      </div>
      <button className={s.palette} onClick={() => open('palette', true)}>
        <Search size={14} />
        <span className={s.paletteText}>Find media, plan items, actions or a verse…</span>
        <span className={s.paletteKeys}>
          <kbd>{modKey === '⌘' ? <Command size={10} /> : 'Ctrl'}</kbd>
          <kbd>K</kbd>
        </span>
      </button>
      <div className={s.right}>
        <OutputStatus />
        <IconButton
          label="Settings"
          shortcut={`${modKey} ,`}
          onClick={() => open('settings', 'output')}
          tooltipSide="bottom"
        >
          <Settings />
        </IconButton>
      </div>
    </header>
  )
}
