import { Check, Monitor, MonitorSpeaker, ScanSearch, SquareDot } from 'lucide-react'
import clsx from 'clsx'
import type { OutputMode } from '@shared/types'
import { attempt, dispatch } from '../lib/api'
import { useApp, useSettings, useShow } from '../lib/store'
import { useUI } from '../lib/ui'
import { Button } from '../ui/Button'
import { Segmented } from '../ui/Controls'
import { Popover } from '../ui/Popover'
import s from './OutputStatus.module.css'

/** Status pill for the audience screen, with display and mode controls. */
export function OutputStatus() {
  const snap = useApp((st) => st.displays)
  const settings = useSettings()
  const show = useShow()
  const open = useUI((st) => st.open)
  if (!snap || !settings) return null
  const { output, displays } = snap
  const name = settings.output.name
  const state = output.active ? (output.windowed ? 'window' : 'on') : 'off'
  const text = output.active
    ? output.windowed
      ? 'Window'
      : output.displayLabel
    : settings.output.mode === 'off'
      ? 'Off'
      : 'Not connected'

  return (
    <Popover
      align="end"
      width={340}
      trigger={
        <button className={clsx(s.pill, s[state])} aria-label={`${name} output: ${text}`}>
          <span className={s.dot} />
          <span className={s.name}>{name}</span>
          <span className={s.detail}>{text}</span>
        </button>
      }
    >
      <div className={s.panel}>
        <div className={s.head}>
          <MonitorSpeaker size={16} />
          <div>
            <div className={s.title}>Audience screen</div>
            <div className={s.sub}>
              {output.active
                ? output.windowed
                  ? 'Showing in a floating window'
                  : `Fullscreen on ${output.displayLabel} · ${output.width}×${output.height}`
                : (output.note ?? 'Not showing')}
            </div>
          </div>
        </div>
        <div className={s.label}>Display</div>
        <div className={s.displays}>
          {displays.map((d) => {
            const chosen = output.displayId === d.id
            return (
              <button
                key={d.id}
                className={clsx(s.display, chosen && s.displayOn)}
                disabled={d.hasControl && displays.length > 1}
                onClick={() =>
                  attempt('output:set', {
                    displayId: d.id,
                    mode:
                      settings.output.mode === 'window' || settings.output.mode === 'off' ? 'auto' : undefined
                  })
                }
              >
                <Monitor size={16} />
                <span className={s.displayText}>
                  <span className={s.displayName}>{d.label}</span>
                  <span className={s.displayMeta}>
                    {d.bounds.width}×{d.bounds.height}
                    {d.hasControl ? ' · this screen' : d.primary ? ' · main' : ''}
                  </span>
                </span>
                {chosen && <Check size={15} className={s.check} />}
              </button>
            )
          })}
        </div>
        <div className={s.label}>Mode</div>
        <Segmented<OutputMode>
          value={settings.output.mode}
          onChange={(mode) => attempt('output:set', { mode })}
          options={[
            { value: 'auto', label: 'Auto', tooltip: 'Fullscreen whenever a second display is connected' },
            { value: 'fullscreen', label: 'Fullscreen' },
            { value: 'window', label: 'Window', tooltip: 'A floating window — handy for testing or capture' },
            { value: 'off', label: 'Off' }
          ]}
          className={s.modes}
        />
        <div className={s.actions}>
          <Button size="sm" icon={<ScanSearch />} onClick={() => attempt('displays:identify')}>
            Identify
          </Button>
          <Button
            size="sm"
            icon={<SquareDot />}
            pressed={!!show?.testPattern}
            onClick={() => dispatch({ type: 'test-pattern' })}
          >
            Test pattern
          </Button>
          <Button size="sm" variant="ghost" onClick={() => open('settings', 'output')}>
            More…
          </Button>
        </div>
      </div>
    </Popover>
  )
}
