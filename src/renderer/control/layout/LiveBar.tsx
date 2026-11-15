import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { ChevronUp, CircleOff, CornerUpLeft, Moon, Sparkles, Volume1, Volume2, VolumeX } from 'lucide-react'
import { presentationLabel } from '@shared/show/presentation'
import type { TransitionKind } from '@shared/types'
import { dispatch } from '../lib/api'
import { useShow } from '../lib/store'
import { useUI } from '../lib/ui'
import { IconButton } from '../ui/Button'
import { Segmented, Select, Slider } from '../ui/Controls'
import { Tooltip } from '../ui/Tooltip'
import s from './LiveBar.module.css'

const DURATIONS = [250, 500, 800, 1200, 2000]

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
              <Sparkles size={17} />
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
        <Tooltip label="Remove what's on screen">
          <button
            className={clsx(s.big, s.clear)}
            disabled={!show.live}
            onClick={() => dispatch({ type: 'clear' })}
          >
            <CircleOff size={16} />
            <span>Clear</span>
          </button>
        </Tooltip>
      </div>

      <div className={s.group}>
        <span className={s.label}>Transition</span>
        <Segmented<TransitionKind>
          size="sm"
          value={t.kind}
          onChange={(kind) => dispatch({ type: 'transition', transition: { kind } })}
          options={[
            { value: 'cut', label: 'Cut', tooltip: 'Instant' },
            { value: 'fade', label: 'Fade', tooltip: 'Crossfade' },
            { value: 'dip', label: 'Dip', tooltip: 'Fade through black' }
          ]}
        />
        <Select
          className={s.duration}
          value={String(t.duration)}
          disabled={t.kind === 'cut'}
          aria-label="Transition length"
          onChange={(e) => dispatch({ type: 'transition', transition: { duration: Number(e.target.value) } })}
        >
          {[...new Set([...DURATIONS, t.duration])]
            .sort((a, b) => a - b)
            .map((d) => (
              <option key={d} value={d}>
                {d < 1000 ? `${d / 1000}s`.replace(/^0/, '') : `${d / 1000}s`}
              </option>
            ))}
        </Select>
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
        <span className={s.volumeValue}>
          {show.audio.muted ? 'Muted' : `${Math.round(show.audio.volume * 100)}%`}
        </span>
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
