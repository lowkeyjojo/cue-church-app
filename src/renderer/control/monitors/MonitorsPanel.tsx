import { useCallback, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize2,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Scan,
  Star,
  Tv,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { canZoom, isPaged, isTimed, pageWord } from '@shared/show/presentation'
import type { FitMode, Presentation } from '@shared/types'
import { formatTime } from '@shared/util'
import { zoomAround } from '../../stage/zoom'
import { attempt, dispatch } from '../lib/api'
import { addMediaToPlan } from '../lib/planActions'
import { useApp, useSettings, useShow } from '../lib/store'
import { Button, IconButton } from '../ui/Button'
import { Segmented, Slider } from '../ui/Controls'
import { Tooltip } from '../ui/Tooltip'
import { Monitor } from './Monitor'
import s from './MonitorsPanel.module.css'

export function MonitorsPanel() {
  const aspect = useAspect()
  const [panel, setPanel] = useState({ width: 0, height: 0 })
  const chrome = useRef(new Map<Element, number>())
  const [chromeHeight, setChromeHeight] = useState(0)

  const panelRef = useCallback((node: HTMLElement | null) => {
    if (!node) return
    const ro = new ResizeObserver(() => setPanel({ width: node.clientWidth, height: node.clientHeight }))
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  // Everything in the panel that isn't a monitor (headers, controls) is "chrome".
  const chromeObserver = useMemo(
    () =>
      new ResizeObserver((entries) => {
        for (const e of entries) chrome.current.set(e.target, (e.target as HTMLElement).offsetHeight)
        setChromeHeight([...chrome.current.values()].reduce((a, b) => a + b, 0))
      }),
    []
  )
  const measure = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return
      chromeObserver.observe(node)
      return () => {
        chromeObserver.unobserve(node)
        chrome.current.delete(node)
      }
    },
    [chromeObserver]
  )

  // Both monitors share one size: as wide as the panel allows, unless the window is short.
  const PAD_X = 28
  const PAD_Y = 12 * 4 + 1
  const width = Math.max(0, panel.width - PAD_X)
  const available = Math.max(80, (panel.height - PAD_Y - chromeHeight) / 2)
  const monitorW = Math.floor(Math.min(width, available * aspect))
  const monitorH = Math.floor(monitorW / aspect)
  return (
    <aside className={s.panel} ref={panelRef}>
      <PreviewBlock width={monitorW} height={monitorH} measure={measure} />
      <LiveBlock width={monitorW} height={monitorH} measure={measure} />
    </aside>
  )
}

function useAspect(): number {
  const out = useApp((st) => st.displays?.output)
  return out && out.width && out.height ? out.width / out.height : 16 / 9
}

type Measure = (node: HTMLElement | null) => void | (() => void)

function PreviewBlock({ width, height, measure }: { width: number; height: number; measure: Measure }) {
  const show = useShow()!
  const settings = useSettings()!
  const p = show.preview
  const item = useApp((st) => (p?.mediaId ? st.items[p.mediaId] : undefined))
  const inPlan = !!p?.entryId
  return (
    <section className={clsx(s.block, s.previewBlock)}>
      <header className={s.head} ref={measure}>
        <span className={clsx(s.tag, s.tagPreview)}>
          <span className={s.tagDot} />
          Preview
        </span>
        <div className={s.titleWrap}>
          <span className={s.title}>{p ? p.title : 'Nothing staged'}</span>
          {p?.subtitle && <span className={s.subtitle}>{p.subtitle}</span>}
        </div>
        <div className={s.headActions}>
          {item && !item.saved && (
            <IconButton
              label="Save to library"
              size="sm"
              onClick={() => attempt('library:update', item.id, { saved: true })}
            >
              <Star />
            </IconButton>
          )}
          {p?.mediaId && !inPlan && (
            <IconButton label="Add to service plan" size="sm" onClick={() => addMediaToPlan([p.mediaId!])}>
              <Plus />
            </IconButton>
          )}
        </div>
      </header>
      <div className={s.slot}>{width > 0 && <Monitor role="preview" width={width} height={height} />}</div>
      <div className={clsx(s.controls, s.previewControls)} ref={measure}>
        {p && <PresentationControls p={p} where="preview" />}
        <Button
          variant="primary"
          size="lg"
          className={s.take}
          icon={<Tv />}
          disabled={!p}
          onClick={() => dispatch({ type: 'take' })}
          trailing={<kbd>Space</kbd>}
          data-testid="take"
        >
          Show on {settings.output.name}
        </Button>
      </div>
    </section>
  )
}

function LiveBlock({ width, height, measure }: { width: number; height: number; measure: Measure }) {
  const show = useShow()!
  const out = useApp((st) => st.displays?.output)
  const settings = useSettings()!
  const p = show.live
  const onAir = !!(p || show.ambient.active) && !show.blackout
  return (
    <section className={clsx(s.block, s.liveBlock)}>
      <div ref={measure}>
        <header className={s.head}>
          <span className={clsx(s.tag, s.tagLive, onAir && out?.active && s.tagOnAir)}>
            <span className={s.tagDot} />
            Live
          </span>
          <div className={s.titleWrap}>
            <span className={s.title}>
              {show.blackout
                ? 'Blackout'
                : show.ambient.active
                  ? (show.ambient.presentation?.title ?? 'Ambient')
                  : p
                    ? p.title
                    : 'Nothing on screen'}
            </span>
            {p?.subtitle && !show.blackout && !show.ambient.active && (
              <span className={s.subtitle}>{p.subtitle}</span>
            )}
          </div>
        </header>
        {out && !out.active && (
          <div className={s.warning}>
            <span>{out.note ?? `No ${settings.output.name} connected.`}</span>
            <Button size="sm" variant="quiet" onClick={() => attempt('output:set', { mode: 'window' })}>
              Open output window
            </Button>
          </div>
        )}
      </div>
      <div className={s.slot}>{width > 0 && <Monitor role="live" width={width} height={height} />}</div>
      <div className={clsx(s.controls, s.liveControls)} ref={measure}>
        {p ? (
          <PresentationControls p={p} where="live" />
        ) : (
          <div className={s.hint}>Use Show on {settings.output.name}, or double-click anything.</div>
        )}
        {p && isTimed(p) && <Transport p={p} />}
        {p && isPaged(p) && <PageStepper p={p} big />}
      </div>
    </section>
  )
}

/** Fit and zoom for whatever is in a monitor. */
function PresentationControls({ p, where }: { p: Presentation; where: 'live' | 'preview' }) {
  const fittable = p.kind === 'image' || p.kind === 'video' || p.kind === 'pdf'
  const zoomable = canZoom(p)
  const setFit = (fit: FitMode) => dispatch({ type: 'fit', where, fit })
  if (!fittable && !(isPaged(p) && where === 'preview')) return null
  return (
    <div className={s.row}>
      {fittable && (
        <Segmented<FitMode>
          size="sm"
          value={p.fit}
          onChange={setFit}
          ariaLabel="Scaling"
          options={[
            {
              value: 'fit',
              label: 'Fit',
              icon: <Minimize2 />,
              tooltip: 'Fit — show the whole image',
              shortcut: where === 'live' ? 'F' : undefined
            },
            {
              value: 'fill',
              label: 'Fill',
              icon: <Maximize />,
              tooltip: 'Fill — cover the screen (may crop)'
            },
            { value: 'blur', label: 'Blur', icon: <Scan />, tooltip: 'Fit over a soft blurred backdrop' }
          ]}
        />
      )}
      <div className={s.spacer} />
      {zoomable && (
        <div className={s.zoom}>
          <IconButton
            label="Zoom out"
            size="sm"
            shortcut={where === 'live' ? '−' : undefined}
            onClick={() => dispatch({ type: 'zoom', where, zoom: zoomAround(p.zoom, 0.8, 0.5, 0.5) })}
          >
            <ZoomOut />
          </IconButton>
          <Tooltip
            label="Reset zoom (scroll on the picture to zoom, drag to pan)"
            shortcut={where === 'live' ? '0' : undefined}
          >
            <button className={s.zoomValue} onClick={() => dispatch({ type: 'zoom', where, zoom: null })}>
              {Math.round((p.zoom?.scale ?? 1) * 100)}%
            </button>
          </Tooltip>
          <IconButton
            label="Zoom in"
            size="sm"
            shortcut={where === 'live' ? '+' : undefined}
            onClick={() => dispatch({ type: 'zoom', where, zoom: zoomAround(p.zoom, 1.25, 0.5, 0.5) })}
          >
            <ZoomIn />
          </IconButton>
        </div>
      )}
      {isPaged(p) && where === 'preview' && <PageStepper p={p} where="preview" />}
    </div>
  )
}

function PageStepper({
  p,
  big,
  where = 'live'
}: {
  p: Presentation
  big?: boolean
  where?: 'live' | 'preview'
}) {
  const page = (p.page ?? 0) + 1
  const count = p.pageCount ?? 1
  const go = (delta: number) =>
    where === 'live'
      ? dispatch({ type: delta > 0 ? 'next' : 'prev' })
      : dispatch({ type: 'goto', where, page: (p.page ?? 0) + delta })
  if (big) {
    return (
      <div className={s.stepper}>
        <Tooltip label="Previous" shortcut="←">
          <Button className={s.stepBtn} icon={<ChevronLeft />} onClick={() => go(-1)} disabled={page <= 1}>
            Previous
          </Button>
        </Tooltip>
        <span className={s.pageCount}>
          <strong>{page}</strong> / {count}
        </span>
        <Tooltip label="Next" shortcut="→">
          <Button className={s.stepBtn} onClick={() => go(1)} trailing={<ChevronRight size={16} />}>
            Next
          </Button>
        </Tooltip>
      </div>
    )
  }
  return (
    <div className={s.miniStepper}>
      <IconButton
        label={`Previous ${pageWord(p.kind)}`}
        size="sm"
        disabled={page <= 1}
        onClick={() => go(-1)}
      >
        <ChevronLeft />
      </IconButton>
      <span className={s.miniCount}>
        {page}/{count}
      </span>
      <IconButton label={`Next ${pageWord(p.kind)}`} size="sm" disabled={page >= count} onClick={() => go(1)}>
        <ChevronRight />
      </IconButton>
    </div>
  )
}

function Transport({ p }: { p: Presentation }) {
  const playback = useApp((st) => st.playback)
  const [scrub, setScrub] = useState<number | null>(null)
  const pb = playback && playback.presentationId === p.id ? playback : null
  const duration = pb?.duration || p.duration || 0
  const current = scrub ?? pb?.currentTime ?? p.transport?.seek.time ?? 0
  const playing = pb ? !pb.paused : !!p.transport?.playing
  const volume = p.volume ?? 1
  const remaining = Math.max(0, duration - current)
  const nearEnd = playing && duration > 0 && remaining < 10
  return (
    <div className={s.transport}>
      <div className={s.row}>
        <IconButton label="Restart" size="sm" onClick={() => dispatch({ type: 'video', action: 'restart' })}>
          <RotateCcw />
        </IconButton>
        <IconButton
          label={playing ? 'Pause' : 'Play'}
          shortcut="K"
          size="md"
          tone="amber"
          pressed
          onClick={() => dispatch({ type: 'video', action: 'toggle' })}
        >
          {playing ? <Pause /> : <Play />}
        </IconButton>
        <span className={s.time}>{formatTime(current)}</span>
        <Slider
          className={s.scrubber}
          value={Math.min(current, duration || current)}
          max={duration || 1}
          step={0.1}
          ariaLabel="Position"
          onChange={(v) => setScrub(v)}
          onCommit={(v) => {
            setScrub(null)
            dispatch({ type: 'seek', time: v })
          }}
        />
        <span className={clsx(s.time, nearEnd && s.timeWarn)}>−{formatTime(remaining)}</span>
      </div>
      <div className={s.row}>
        <Tooltip label="Loop">
          <Button
            size="sm"
            variant="quiet"
            pressed={!!p.loop}
            icon={<Repeat />}
            onClick={() => dispatch({ type: 'loop', on: !p.loop })}
          >
            Loop
          </Button>
        </Tooltip>
        <div className={s.spacer} />
        <IconButton
          label={volume ? 'Mute this video' : 'Unmute this video'}
          size="sm"
          onClick={() => dispatch({ type: 'video-volume', volume: volume ? 0 : 1 })}
        >
          {volume ? <Volume2 /> : <VolumeX />}
        </IconButton>
        <Slider
          className={s.videoVolume}
          value={volume}
          ariaLabel="Video volume"
          onChange={(v) => dispatch({ type: 'video-volume', volume: v })}
        />
      </div>
      {pb?.error && <div className={s.error}>{pb.error}</div>}
    </div>
  )
}
