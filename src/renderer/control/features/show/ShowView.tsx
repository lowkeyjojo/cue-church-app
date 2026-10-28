import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  ExternalLink,
  Eye,
  FolderOpen,
  NotebookPen,
  Play,
  Plus,
  Presentation as PresentationIcon,
  Sparkles,
  Star,
  Type
} from 'lucide-react'
import type { FitMode, Id, MediaItem, Plan, PlanEntry, PresentOptions, VideoEndAction } from '@shared/types'
import { domainOf, formatBytes, formatTime, kindLabel, pageFile, thumbUrl } from '@shared/util'
import { AmbientView } from '../../../stage/views/AmbientView'
import { useElementSize } from '../../../stage/useElementSize'
import { attempt, dispatch } from '../../lib/api'
import { setMediaDrag } from '../../lib/dnd'
import { addMediaToPlan, previewEntry, previewMedia, showEntry, showMedia } from '../../lib/planActions'
import { useApp, useSettings, useShow } from '../../lib/store'
import { useUI } from '../../lib/ui'
import { Toolbar } from '../../layout/Workspace'
import { Button } from '../../ui/Button'
import { EmptyState, Field, Segmented, Select, Slider, Switch, TextArea, TextField } from '../../ui/Controls'
import { DeckThumb } from '../common/Thumb'
import { entryInfo, itemSubtitle } from '../plan/entryInfo'
import s from './ShowView.module.css'

interface Target {
  plan?: Plan
  entry?: PlanEntry
  item?: MediaItem
}

/** Resolve what the Show tab is about: the focused item, else whatever is live. */
function useTarget(): Target | null {
  const focus = useUI((st) => st.focus)
  const plans = useApp((st) => st.plans)
  const items = useApp((st) => st.items)
  const live = useShow()?.live
  const resolveEntry = (planId: Id, entryId: Id): Target | null => {
    const plan = plans.find((p) => p.id === planId)
    const entry = plan?.entries.find((e) => e.id === entryId)
    if (!plan || !entry) return null
    return { plan, entry, item: entry.mediaId ? items[entry.mediaId] : undefined }
  }
  if (focus?.type === 'entry') return resolveEntry(focus.planId, focus.entryId)
  if (focus?.type === 'media') return items[focus.mediaId] ? { item: items[focus.mediaId] } : null
  if (live?.planId && live.entryId) return resolveEntry(live.planId, live.entryId)
  if (live?.mediaId && items[live.mediaId]) return { item: items[live.mediaId] }
  return null
}

export function ShowView({ active }: { active: boolean }) {
  const target = useTarget()
  if (!target) {
    return (
      <div className={s.view}>
        <EmptyState icon={<PresentationIcon />} title="Nothing selected">
          Click an item in your service plan to see its pages here, search the web for an image, or browse
          your library.
        </EmptyState>
      </div>
    )
  }
  const { plan, entry, item } = target
  const info = entry
    ? entryInfo(entry, item)
    : item
      ? { title: item.name, subtitle: itemSubtitle(item), missing: false }
      : null
  const paged = item && (item.kind === 'pdf' || item.kind === 'deck')
  return (
    <div className={s.view}>
      <Toolbar active={active}>
        <ShowToolbar target={target} />
      </Toolbar>
      <div className={s.scroll}>
        <div className={s.header}>
          <div className={s.kicker}>
            {entry ? `${plan?.name ?? 'Plan'} · item` : item?.saved ? 'Library' : 'From the web'}
          </div>
          <h1 className={s.title}>{info?.title}</h1>
          <div className={s.subtitle}>{info?.subtitle}</div>
        </div>
        {paged && item && <PageGrid item={item} plan={plan} entry={entry} />}
        {!paged && item && (item.kind === 'image' || item.kind === 'video' || item.kind === 'audio') && (
          <MediaDetail item={item} plan={plan} entry={entry} />
        )}
        {entry?.type === 'ambient' && plan && <AmbientDetail plan={plan} entry={entry} />}
        {entry?.type === 'color' && plan && <ColorDetail plan={plan} entry={entry} />}
        {paged && item && <PresentOptionsPanel item={item} plan={plan} entry={entry} />}
        {entry && plan && <Notes plan={plan} entry={entry} />}
      </div>
    </div>
  )
}

function ShowToolbar({ target }: { target: Target }) {
  const { plan, entry, item } = target
  const open = useUI((st) => st.open)
  const preview = () => (entry && plan ? previewEntry(plan.id, entry) : item && previewMedia(item.id))
  const showNow = () => (entry && plan ? showEntry(plan.id, entry) : item && showMedia(item.id))
  return (
    <div className={clsx(s.toolbar, 'collapsible')}>
      <Button size="sm" variant="quiet" icon={<Eye />} onClick={preview}>
        Preview
      </Button>
      <Button size="sm" variant="quiet" icon={<Play />} onClick={showNow}>
        Show now
      </Button>
      <div className={s.toolbarSpacer} />
      {item?.kind === 'deck' && (
        <Button size="sm" icon={<Type />} onClick={() => open('deck', item.id)}>
          Edit slides
        </Button>
      )}
      {entry?.type === 'ambient' && plan && (
        <Button
          size="sm"
          icon={<Sparkles />}
          onClick={() => open('ambient', { planId: plan.id, entryId: entry.id })}
        >
          Edit ambient
        </Button>
      )}
      {item && !entry && (
        <Button size="sm" icon={<Plus />} onClick={() => addMediaToPlan([item.id])}>
          Add to plan
        </Button>
      )}
      {item && !item.saved && (
        <Button size="sm" icon={<Star />} onClick={() => attempt('library:update', item.id, { saved: true })}>
          Save to library
        </Button>
      )}
    </div>
  )
}

function PageGrid({ item, plan, entry }: { item: MediaItem; plan?: Plan; entry?: PlanEntry }) {
  const show = useShow()!
  const settings = useSettings()!
  const count = item.kind === 'pdf' ? (item.pageCount ?? 0) : (item.deck?.slides.length ?? 0)
  const ready = item.kind === 'pdf' ? (item.status === 'ready' ? count : (item.pagesReady ?? 0)) : count
  const liveHere = !!show.live && show.live.mediaId === item.id && (!entry || show.live.entryId === entry.id)
  const livePage = liveHere ? (show.live!.page ?? 0) : -1
  const previewHere =
    !!show.preview && show.preview.mediaId === item.id && (!entry || show.preview.entryId === entry.id)
  const previewPage = previewHere ? (show.preview!.page ?? 0) : -1
  const grid = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (livePage < 0) return
    grid.current
      ?.querySelector<HTMLElement>(`[data-page="${livePage}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [livePage])

  const click = (i: number) => {
    if (liveHere && settings.presenter.livePageClick) dispatch({ type: 'goto', where: 'live', page: i })
    else if (entry && plan) previewEntry(plan.id, entry, i)
    else previewMedia(item.id, i)
  }
  const doubleClick = (i: number) => (entry && plan ? showEntry(plan.id, entry, i) : showMedia(item.id, i))

  if (item.status === 'error') {
    return <div className={s.errorBox}>{item.error ?? "This file couldn't be read."}</div>
  }
  return (
    <>
      {liveHere && settings.presenter.livePageClick && (
        <div className={s.liveBanner}>
          <span className={s.liveDot} />
          On screen now — clicking a {item.kind === 'deck' ? 'slide' : 'page'} shows it immediately.
        </div>
      )}
      <div className={s.pages} ref={grid}>
        {Array.from({ length: count }).map((_, i) => (
          <button
            key={i}
            data-page={i}
            className={clsx(
              s.page,
              i === livePage && s.pageLive,
              i === previewPage && i !== livePage && s.pagePreview
            )}
            onClick={() => click(i)}
            onDoubleClick={() => doubleClick(i)}
            draggable={false}
          >
            {item.kind === 'deck' && item.deck ? (
              <DeckThumb deck={item.deck} index={i} className={s.pageThumb} />
            ) : i < ready ? (
              <div className={s.pageThumb}>
                <img
                  src={`cue-media://media/${item.id}/${pageFile(i + 1, 'thumb')}`}
                  alt=""
                  loading="lazy"
                  draggable={false}
                />
              </div>
            ) : (
              <div className={clsx(s.pageThumb, s.pagePending)}>Preparing…</div>
            )}
            <span className={s.pageNum}>{i + 1}</span>
            {i === livePage && <span className={s.pageTag}>Live</span>}
          </button>
        ))}
      </div>
    </>
  )
}

function MediaDetail({ item, plan, entry }: { item: MediaItem; plan?: Plan; entry?: PlanEntry }) {
  const src = thumbUrl(item)
  return (
    <div className={s.detail}>
      <div className={s.hero} draggable onDragStart={(e) => setMediaDrag(e, [item.id])}>
        {item.kind === 'audio' ? (
          <div className={s.heroAudio}>Audio</div>
        ) : src ? (
          <img
            src={
              item.kind === 'image' && item.file
                ? `cue-media://media/${item.id}/${encodeURIComponent(item.file)}`
                : src
            }
            alt=""
            draggable={false}
          />
        ) : (
          <div className={s.heroAudio}>Preparing…</div>
        )}
        {item.kind === 'video' && item.duration ? (
          <span className={s.duration}>{formatTime(item.duration)}</span>
        ) : null}
      </div>
      <div className={s.side}>
        <dl className={s.meta}>
          <dt>Type</dt>
          <dd>{item.animated ? 'Animated GIF' : kindLabel(item.kind)}</dd>
          {item.width ? (
            <>
              <dt>Size</dt>
              <dd>
                {item.width} × {item.height}
                {item.width < 1280 && item.kind === 'image' ? (
                  <span className={s.lowres}> · low resolution</span>
                ) : null}
              </dd>
            </>
          ) : null}
          {item.duration ? (
            <>
              <dt>Length</dt>
              <dd>{formatTime(item.duration)}</dd>
            </>
          ) : null}
          <dt>File</dt>
          <dd>{formatBytes(item.bytes)}</dd>
          {item.source.type === 'web' && (
            <>
              <dt>Source</dt>
              <dd>
                {item.source.pageUrl || item.source.url ? (
                  <button
                    className={s.link}
                    onClick={() => attempt('system:openExternal', item.source.pageUrl ?? item.source.url!)}
                  >
                    {domainOf(item.source.pageUrl ?? item.source.url)} <ExternalLink size={11} />
                  </button>
                ) : (
                  'Web'
                )}
              </dd>
              {item.source.author && (
                <>
                  <dt>Credit</dt>
                  <dd>{item.source.author}</dd>
                </>
              )}
              {item.source.license && (
                <>
                  <dt>License</dt>
                  <dd>{item.source.license}</dd>
                </>
              )}
            </>
          )}
        </dl>
        {item.status === 'error' && <div className={s.errorBox}>{item.error}</div>}
        <PresentOptionsPanel item={item} plan={plan} entry={entry} />
        {item.file && (
          <Button
            size="sm"
            variant="ghost"
            icon={<FolderOpen />}
            onClick={() => attempt('library:reveal', item.id)}
          >
            Show file
          </Button>
        )}
      </div>
    </div>
  )
}

/** Fit / loop / volume / trims. Saved on the plan entry when there is one, otherwise as the item's defaults. */
function PresentOptionsPanel({ item, plan, entry }: { item: MediaItem; plan?: Plan; entry?: PlanEntry }) {
  const settings = useSettings()!
  const opts: PresentOptions = { ...item.defaults, ...entry?.options }
  const save = (patch: PresentOptions) => {
    if (entry && plan)
      void attempt('plans:updateEntry', plan.id, entry.id, { options: { ...entry.options, ...patch } })
    else void attempt('library:update', item.id, { defaults: { ...item.defaults, ...patch } })
  }
  const timed = item.kind === 'video' || item.kind === 'audio'
  if (item.kind === 'deck') return null
  return (
    <div className={s.options}>
      <div className={s.optionsTitle}>{entry ? 'In this plan' : 'When shown'}</div>
      {item.kind !== 'audio' && (
        <Field label="Scaling" inline>
          <Segmented<FitMode>
            size="sm"
            value={opts.fit ?? settings.output.defaultFit}
            onChange={(fit) => save({ fit })}
            options={[
              { value: 'fit', label: 'Fit' },
              { value: 'fill', label: 'Fill' },
              { value: 'blur', label: 'Blur' }
            ]}
          />
        </Field>
      )}
      {timed && (
        <>
          <Field label="Start playing automatically" inline>
            <Switch checked={opts.autoplay !== false} onChange={(autoplay) => save({ autoplay })} />
          </Field>
          <Field label="Loop" inline>
            <Switch checked={!!opts.loop} onChange={(loop) => save({ loop })} />
          </Field>
          {!opts.loop && (
            <Field label="When it ends" inline>
              <Select
                value={opts.endAction ?? 'hold'}
                onChange={(e) => save({ endAction: e.target.value as VideoEndAction })}
                className={s.endSelect}
              >
                <option value="hold">Hold last frame</option>
                <option value="black">Fade to black</option>
                <option value="ambient">Show ambient</option>
                <option value="clear">Clear the screen</option>
              </Select>
            </Field>
          )}
          <Field label="Volume" inline>
            <CommitSlider
              value={opts.volume ?? 1}
              onCommit={(volume) => save({ volume })}
              ariaLabel="Item volume"
            />
          </Field>
          <Field label="Start at" hint="m:ss" inline>
            <TimeInput value={opts.startAt} onChange={(startAt) => save({ startAt })} />
          </Field>
          <Field label="Stop at" hint="m:ss (optional)" inline>
            <TimeInput value={opts.endAt} onChange={(endAt) => save({ endAt })} />
          </Field>
        </>
      )}
    </div>
  )
}

/** A slider that moves freely while dragging and saves once on release. */
function CommitSlider({
  value,
  onCommit,
  ariaLabel
}: {
  value: number
  onCommit: (v: number) => void
  ariaLabel: string
}) {
  const [local, setLocal] = useState<number | null>(null)
  return (
    <Slider
      value={local ?? value}
      onChange={setLocal}
      onCommit={(v) => {
        setLocal(null)
        onCommit(v)
      }}
      ariaLabel={ariaLabel}
    />
  )
}

function TimeInput({ value, onChange }: { value?: number; onChange: (v: number | undefined) => void }) {
  const [text, setText] = useState(value ? formatTime(value) : '')
  useEffect(() => setText(value ? formatTime(value) : ''), [value])
  const commit = () => {
    const t = text.trim()
    if (!t) return onChange(undefined)
    const parts = t.split(':').map(Number)
    if (parts.some((n) => Number.isNaN(n))) return setText(value ? formatTime(value) : '')
    const seconds = parts.reduce((acc, n) => acc * 60 + n, 0)
    onChange(seconds > 0 ? seconds : undefined)
  }
  return (
    <TextField
      className={s.timeInput}
      value={text}
      placeholder="0:00"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

function AmbientDetail({ plan, entry }: { plan: Plan; entry: PlanEntry }) {
  const settings = useSettings()!
  const open = useUI((st) => st.open)
  const items = useApp((st) => st.items)
  const [ref, size] = useElementSize<HTMLDivElement>()
  const config = entry.ambient ?? settings.ambient
  // A synthetic presentation, rendered exactly as the audience would see it.
  const media = config.mediaIds
    .map((id) => items[id])
    .filter((i): i is MediaItem => !!i?.file && (i.kind === 'image' || i.kind === 'video'))
    .map((i) => ({
      id: i.id,
      kind: i.kind as 'image' | 'video',
      src: `cue-media://media/${i.id}/${encodeURIComponent(i.file!)}`
    }))
  const p = {
    id: entry.id,
    kind: 'ambient' as const,
    title: entry.title ?? 'Ambient',
    fit: 'fill' as const,
    ambient: {
      config,
      media,
      countdownTarget: config.overlay.countdownMinutes
        ? Date.now() + config.overlay.countdownMinutes * 60_000
        : undefined
    }
  }
  return (
    <div className={s.detail}>
      <div className={s.hero} ref={ref}>
        {size.width > 0 && <AmbientView p={p} role="preview" width={size.width} height={size.height} />}
      </div>
      <div className={s.side}>
        <p className={s.help}>
          Ambient scenes cover breaks and walk-in time with gentle motion and an optional welcome, clock or
          countdown. Countdowns start when the item goes live.
        </p>
        <Button icon={<Sparkles />} onClick={() => open('ambient', { planId: plan.id, entryId: entry.id })}>
          Edit ambient
        </Button>
      </div>
    </div>
  )
}

function ColorDetail({ plan, entry }: { plan: Plan; entry: PlanEntry }) {
  const color = entry.color ?? '#000000'
  return (
    <div className={s.detail}>
      <div className={s.hero} style={{ background: color }} />
      <div className={s.side}>
        <Field label="Color">
          <input
            type="color"
            className={s.color}
            value={color}
            onChange={(e) => attempt('plans:updateEntry', plan.id, entry.id, { color: e.target.value })}
          />
        </Field>
      </div>
    </div>
  )
}

function Notes({ plan, entry }: { plan: Plan; entry: PlanEntry }) {
  const [text, setText] = useState(entry.notes ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setText(entry.notes ?? ''), [entry.id, entry.notes])
  useEffect(() => {
    const focus = () => ref.current?.focus()
    window.addEventListener('cue:focus-notes', focus)
    return () => window.removeEventListener('cue:focus-notes', focus)
  }, [])
  return (
    <div className={s.notes}>
      <div className={s.notesTitle}>
        <NotebookPen size={13} />
        Private notes
        <span>Only you see these</span>
      </div>
      <TextArea
        ref={ref}
        value={text}
        placeholder="Cues for yourself: when to show this, what the pastor will say…"
        onChange={(e) => setText(e.target.value)}
        onBlur={() =>
          text !== (entry.notes ?? '') &&
          attempt('plans:updateEntry', plan.id, entry.id, { notes: text || undefined })
        }
      />
    </div>
  )
}
