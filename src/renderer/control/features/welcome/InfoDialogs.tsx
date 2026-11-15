import { Fragment } from 'react'
import { attempt } from '../../lib/api'
import { SHORTCUTS } from '../../lib/keyboard'
import { useApp } from '../../lib/store'
import { useUI } from '../../lib/ui'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import s from './Welcome.module.css'

export function ShortcutsDialog() {
  const close = useUI((st) => st.close)
  return (
    <Dialog
      open
      initialFocus={false}
      onClose={() => close('shortcuts')}
      title="Keyboard shortcuts"
      description="Live shortcuts work whenever you're not typing in a box."
      width={640}
    >
      <div className={s.shortcuts}>
        {SHORTCUTS.map((group) => (
          <section key={group.group}>
            <h3 className={s.groupTitle}>{group.group}</h3>
            <div className={s.keyList}>
              {group.items.map((item) => (
                <Fragment key={item.label}>
                  <span className={s.keys}>
                    {item.keys.map((k, i) => (
                      <kbd key={i}>{k}</kbd>
                    ))}
                  </span>
                  <span className={s.keyLabel}>{item.label}</span>
                </Fragment>
              ))}
            </div>
          </section>
        ))}
        <p className={s.note}>
          Presentation clickers work too — they send Page Up / Page Down, which Cue treats as previous / next.
        </p>
      </div>
    </Dialog>
  )
}

export function AboutDialog() {
  const close = useUI((st) => st.close)
  const info = useApp((st) => st.info)
  return (
    <Dialog open initialFocus={false} onClose={() => close('about')} width={420} title="About Cue">
      <div className={s.about}>
        <div className={s.aboutMark}>
          <span />
        </div>
        <div className={s.aboutName}>Cue</div>
        <div className={s.aboutVersion}>Version {info?.version}</div>
        <p className={s.aboutText}>Find visuals privately. Show them to the room intentionally.</p>
        <dl className={s.aboutMeta}>
          <dt>Platform</dt>
          <dd>
            {info?.platform} · {info?.arch}
          </dd>
          <dt>Engine</dt>
          <dd>
            Electron {info?.electron} · Chromium {info?.chrome}
          </dd>
          <dt>Library</dt>
          <dd title={info?.libraryPath}>{info?.libraryPath}</dd>
        </dl>
        <Button size="sm" variant="ghost" onClick={() => attempt('system:revealLogs')}>
          Show log files
        </Button>
      </div>
    </Dialog>
  )
}
