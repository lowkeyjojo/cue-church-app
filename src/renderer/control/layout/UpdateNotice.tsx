import { useState } from 'react'
import { ArrowDownToLine } from 'lucide-react'
import { attempt } from '../lib/api'
import { useApp, useSettings, useShow } from '../lib/store'
import { Button } from '../ui/Button'
import { Popover } from '../ui/Popover'
import s from './UpdateNotice.module.css'

/**
 * Says when a new version has been downloaded (Windows), or is out and has to
 * be fetched by hand (everywhere else). Shows nothing the rest of the time.
 */
export function UpdateNotice() {
  const update = useApp((st) => st.updates)
  const show = useShow()
  const outputActive = useApp((st) => st.displays?.output.active)
  const screen = useSettings()?.output.name ?? 'TV'
  const [open, setOpen] = useState(false)
  const [warned, setWarned] = useState(false)

  const ready = update.status === 'ready'
  const manual = update.status === 'available' && !!update.manual
  if (!ready && !manual) return null

  // The same test main makes before it lets Cue quit.
  const onScreen = !!outputActive && !!show && !show.blackout && (!!show.live || show.ambient.active)
  const toggle = (next: boolean) => {
    setOpen(next)
    if (!next) setWarned(false)
  }
  const install = () => {
    toggle(false)
    void attempt('updates:install')
  }

  return (
    <Popover
      align="end"
      width={300}
      open={open}
      onOpenChange={toggle}
      trigger={
        <button className={s.notice} data-testid="update-notice">
          <ArrowDownToLine size={13} />
          {ready ? 'Update ready' : 'Update available'}
        </button>
      }
    >
      <div className={s.panel}>
        {manual ? (
          <>
            <p className={s.text}>Cue {update.version} is available</p>
            <div className={s.actions}>
              <Button size="sm" variant="ghost" onClick={() => toggle(false)}>
                Later
              </Button>
              <Button size="sm" variant="primary" onClick={install}>
                Get it
              </Button>
            </div>
          </>
        ) : warned ? (
          <>
            <p className={s.text}>
              The {screen} is showing something. It will go dark for a moment while Cue restarts, and you show
              it again afterwards.
            </p>
            <div className={s.actions}>
              <Button size="sm" variant="ghost" onClick={() => toggle(false)}>
                Not now
              </Button>
              <Button size="sm" variant="danger" onClick={install}>
                Restart anyway
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className={s.text}>Cue {update.version} is ready. It installs when you close Cue.</p>
            <div className={s.actions}>
              <Button size="sm" variant="ghost" onClick={() => toggle(false)}>
                Later
              </Button>
              <Button size="sm" variant="primary" onClick={() => (onScreen ? setWarned(true) : install())}>
                Restart now
              </Button>
            </div>
          </>
        )}
      </div>
    </Popover>
  )
}
