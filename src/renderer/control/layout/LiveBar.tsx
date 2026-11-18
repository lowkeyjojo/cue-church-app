import { useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  Blend,
  ChevronUp,
  CircleOff,
  CornerUpLeft,
  Moon,
  SunMedium,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react'
import { presentationLabel } from '@shared/show/presentation'
import type { ShowState, TransitionKind } from '@shared/types'
import { dispatch } from '../lib/api'
import { useShow } from '../lib/store'
import { useUI } from '../lib/ui'
import { IconButton } from '../ui/Button'
import { Segmented, Select, Slider } from '../ui/Controls'
import { Popover } from '../ui/Popover'
import { Tooltip } from '../ui/Tooltip'
import s from './LiveBar.module.css'

const DURATIONS = [250, 500, 800, 1200, 2000]

const seconds = (ms: number) => `${ms / 1000}s`
const KIND_NAMES: Record<TransitionKind, string> = { cut: 'Cut', fade: 'Fade', dip: 'Dip' }
const transitionName = (t: ShowState['transition']) =>
  t.kind === 'cut' ? 'Cut' : `${KIND_NAMES[t.kind]} · ${seconds(t.duration)}`

/** The always-visible strip of live controls. */
export function LiveBar() {
  const show = useShow()!
  const open = useUI((st) => st.open)
  const t = show.transition
  const back = show.back
  return (
    <footer className={s.bar}>
      <div className={s.group}>
        <Tooltip label={show.blackout ? 'Bring the picture back' : 'Fade the screen to black'} shortcut="B">
          <button
            className={clsx(s.big, s.blackout, show.blackout && s.blackoutOn)}
            aria-pressed={show.blackout}
            onClick={() => dispatch({ type: 'blackout' })}
            data-testid="blackout"
          >
            <Moon size={17} />
            <span>{show.blackout ? 'Blackout on' : 'Blackout'}</span>
            <kbd>B</kbd>
          </button>
        </Tooltip>
        <div className={s.split}>
          <Tooltip
            label={show.ambient.active ? 'Return to the content' : 'Show the ambient loop (for breaks)'}
            shortcut="A"
          >
            <button
              className={clsx(s.big, s.ambient, show.ambient.active && s.ambientOn)}
              aria-pressed={show.ambient.active}
              onClick={() => dispatch({ type: 'ambient' })}
              data-testid="ambient"
            >
              <SunMedium size={17} />
              <span>Ambient</span>
              <kbd>A</kbd>
            </button>
          </Tooltip>
          <IconButton label="Ambient settings" className={s.splitMore} onClick={() => open('ambient', {})}>
            <ChevronUp />
          </IconButton>
        </div>
        <Tooltip
          label={back ? `Back to ${presentationLabel(back)}` : 'Nothing to go back to yet'}
          shortcut="R"
        >
          <button
            className={clsx(s.big, s.back)}
            disabled={!back}
            onClick={() => dispatch({ type: 'back' })}
            data-testid="back"
          >
            <CornerUpLeft size={17} />
            <span className={s.backText}>{back ? `Back to ${presentationLabel(back)}` : 'Back'}</span>
            <kbd>R</kbd>
          </button>
        </Tooltip>
        <Tooltip label="Take it off the screen" shortcut="Esc">
          <button
            className={clsx(s.big, s.clear)}
            disabled={!show.live}
            onClick={() => dispatch({ type: 'clear' })}
          >
            <CircleOff size={16} />
            <span>Clear</span>
            <kbd>Esc</kbd>
          </button>
        </Tooltip>
      </div>

      {/* How things change on screen is set once and left alone, so it lives behind one button. */}
      <div className={s.group}>
        <Popover
          side="top"
          width={280}
          trigger={
            <button className={clsx(s.big, s.transition)} aria-label={`Transition: ${transitionName(t)}`}>
              <Blend size={16} />
              <span>{transitionName(t)}</span>
              <ChevronUp size={14} className={s.caret} />
            </button>
          }
        >
          <div className={s.transitionPanel}>
            <div className={s.panelTitle}>How things change on screen</div>
            <Segmented<TransitionKind>
              className={s.wide}
              value={t.kind}
              ariaLabel="Transition"
              onChange={(kind) => dispatch({ type: 'transition', transition: { kind } })}
              options={[
                { value: 'cut', label: 'Cut' },
                { value: 'fade', label: 'Fade' },
                { value: 'dip', label: 'Dip' }
              ]}
            />
            <p className={s.panelHint}>
              {t.kind === 'cut'
                ? 'Changes instantly.'
                : t.kind === 'fade'
                  ? 'One picture melts into the next.'
                  : 'Fades to black, then to the next picture.'}
            </p>
            <label className={s.panelRow}>
              <span>Length</span>
              <Select
                className={s.duration}
                value={String(t.duration)}
                disabled={t.kind === 'cut'}
                aria-label="Transition length"
                onChange={(e) =>
                  dispatch({ type: 'transition', transition: { duration: Number(e.target.value) } })
                }
              >
                {[...new Set([...DURATIONS, t.duration])]
                  .sort((a, b) => a - b)
                  .map((d) => (
                    <option key={d} value={d}>
                      {seconds(d)}
                    </option>
                  ))}
              </Select>
            </label>
          </div>
        </Popover>
      </div>

      <div className={s.group}>
        <IconButton
          label={show.audio.muted ? 'Unmute' : 'Mute'}
          shortcut="M"
          pressed={show.audio.muted}
          tone="live"
          onClick={() => dispatch({ type: 'mute' })}
        >
          {show.audio.muted ? <VolumeX /> : show.audio.volume < 0.5 ? <Volume1 /> : <Volume2 />}
        </IconButton>
        <Slider
          className={s.volume}
          value={show.audio.muted ? 0 : show.audio.volume}
          ariaLabel="Master volume"
          onChange={(volume) => dispatch({ type: 'volume', volume })}
        />
        <Clock />
      </div>
    </footer>
  )
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className={s.clock}>
      {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
    </span>
  )
}
