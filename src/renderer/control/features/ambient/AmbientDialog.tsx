import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Check, Eye, Tv } from 'lucide-react'
import { DEFAULT_AMBIENT, FONTS } from '@shared/defaults'
import type {
  AmbientConfig,
  AmbientOverlay,
  AmbientThemeId,
  FontId,
  Id,
  MediaItem,
  Presentation
} from '@shared/types'
import { mediaUrl, thumbUrl } from '@shared/util'
import { AMBIENT_THEMES } from '../../../stage/GenerativeBackground'
import { useElementSize } from '../../../stage/useElementSize'
import { AmbientView } from '../../../stage/views/AmbientView'
import { attempt, dispatch } from '../../lib/api'
import { useApp, useSettings } from '../../lib/store'
import { toast } from '../../lib/toasts'
import { useUI } from '../../lib/ui'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { Field, Segmented, Select, Slider, Switch, TextField } from '../../ui/Controls'
import s from './AmbientDialog.module.css'

export function AmbientDialog({ target }: { target: { planId?: Id; entryId?: Id } }) {
  const close = useUI((st) => st.close)
  const settings = useSettings()!
  const plans = useApp((st) => st.plans)
  const items = useApp((st) => st.items)
  const plan = plans.find((p) => p.id === target.planId)
  const entry = plan?.entries.find((e) => e.id === target.entryId)
  const [config, setConfig] = useState<AmbientConfig>(() =>
    structuredClone(entry?.ambient ?? settings.ambient ?? DEFAULT_AMBIENT)
  )
  const [title, setTitle] = useState(entry?.title ?? '')
  const [ref, size] = useElementSize<HTMLDivElement>()

  const patch = (p: Partial<AmbientConfig>) => setConfig((c) => ({ ...c, ...p }))
  const overlay = (p: Partial<AmbientOverlay>) =>
    setConfig((c) => ({ ...c, overlay: { ...c.overlay, ...p } }))

  const media = useMemo(
    () =>
      Object.values(items)
        .filter(
          (i) => i.saved && (i.kind === 'image' || i.kind === 'video') && i.status !== 'error' && i.file
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    [items]
  )

  const preview: Presentation = useMemo(() => {
    const chosen = config.mediaIds
      .map((id) => items[id])
      .filter((i): i is MediaItem => !!i?.file)
      .map((i) => ({ id: i.id, kind: i.kind as 'image' | 'video', src: mediaUrl(i.id, i.file!) }))
    const source = config.source === 'media' && chosen.length ? 'media' : 'theme'
    return {
      id: 'ambient-preview',
      kind: 'ambient',
      title: 'Ambient',
      fit: 'fill',
      ambient: {
        config: { ...config, source },
        media: chosen,
        countdownTarget: countdownPreview(config.overlay)
      }
    }
  }, [config, items])

  const save = async () => {
    if (plan && entry)
      await attempt('plans:updateEntry', plan.id, entry.id, {
        ambient: config,
        title: title.trim() || undefined
      })
    else await attempt('settings:update', { ambient: config })
    toast.success(entry ? 'Ambient item saved' : 'Default ambient saved')
    close('ambient')
  }

  return (
    <Dialog
      open
      onClose={() => close('ambient')}
      width={980}
      title={entry ? `Ambient · ${entry.title || 'Plan item'}` : 'Ambient'}
      description={
        entry
          ? `Part of “${plan?.name}”.`
          : 'What the A key shows during breaks, before and after the service.'
      }
      footer={
        <>
          <Button
            variant="ghost"
            icon={<Eye />}
            onClick={() =>
              dispatch({
                type: 'preview',
                target:
                  entry && plan
                    ? { type: 'entry', planId: plan.id, entryId: entry.id }
                    : { type: 'ambient', config }
              })
            }
          >
            Preview
          </Button>
          <Button
            variant="ghost"
            icon={<Tv />}
            onClick={() =>
              dispatch({ type: 'show', target: { type: 'ambient', config, title: title || undefined } })
            }
          >
            Show now
          </Button>
          <div style={{ flex: 1 }} />
          <Button onClick={() => close('ambient')}>Cancel</Button>
          <Button variant="primary" icon={<Check />} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className={s.layout}>
        <div className={s.left}>
          <div className={s.preview} ref={ref}>
            {size.width > 0 && (
              <AmbientView p={preview} role="preview" width={size.width} height={size.height} />
            )}
          </div>
          {entry && (
            <Field label="Name in plan">
              <TextField value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ambient" />
            </Field>
          )}
        </div>
        <div className={s.right}>
          <section>
            <div className={s.sectionTitle}>Background</div>
            <Segmented<'theme' | 'media'>
              size="sm"
              value={config.source}
              onChange={(source) => patch({ source })}
              options={[
                { value: 'theme', label: 'Motion' },
                { value: 'media', label: 'Your photos & videos' }
              ]}
            />
            {config.source === 'theme' ? (
              <div className={s.themes}>
                {(Object.keys(AMBIENT_THEMES) as AmbientThemeId[]).map((id) => {
                  const [c0, c1, c2, c3] = AMBIENT_THEMES[id].colors
                  return (
                    <button
                      key={id}
                      className={clsx(s.theme, config.theme === id && s.themeOn)}
                      onClick={() => patch({ theme: id })}
                      style={{
                        background: `radial-gradient(80% 90% at 30% 30%, ${c2}, transparent 70%), radial-gradient(70% 80% at 80% 75%, ${c3}88, transparent 70%), linear-gradient(160deg, ${c1}, ${c0})`
                      }}
                    >
                      <span>{AMBIENT_THEMES[id].label}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <>
                <div className={s.mediaGrid}>
                  {media.length === 0 && (
                    <div className={s.hint}>
                      Import some photos or looping videos into your library first.
                    </div>
                  )}
                  {media.map((i) => {
                    const on = config.mediaIds.includes(i.id)
                    return (
                      <button
                        key={i.id}
                        className={clsx(s.mediaItem, on && s.mediaOn)}
                        onClick={() =>
                          patch({
                            mediaIds: on
                              ? config.mediaIds.filter((x) => x !== i.id)
                              : [...config.mediaIds, i.id]
                          })
                        }
                        title={i.name}
                      >
                        {thumbUrl(i) && <img src={thumbUrl(i)} alt="" draggable={false} />}
                        {on && (
                          <span className={s.mediaCheck}>
                            <Check size={12} />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
                <div className={s.row}>
                  <Field label={`Each photo shows for ${config.interval}s`} className={s.grow}>
                    <Slider
                      value={config.interval}
                      min={4}
                      max={60}
                      step={1}
                      onChange={(interval) => patch({ interval })}
                      ariaLabel="Seconds per photo"
                    />
                  </Field>
                  <Field label="Slow zoom" inline>
                    <Switch checked={config.kenBurns} onChange={(kenBurns) => patch({ kenBurns })} />
                  </Field>
                  <Field label="Shuffle" inline>
                    <Switch checked={config.shuffle} onChange={(shuffle) => patch({ shuffle })} />
                  </Field>
                </div>
              </>
            )}
            <Field label="Darken" hint="Helps text stand out over busy backgrounds">
              <Slider
                value={config.dim}
                min={0}
                max={0.8}
                onChange={(dim) => patch({ dim })}
                ariaLabel="Darken background"
              />
            </Field>
          </section>

          <section>
            <div className={s.sectionTitle}>On top</div>
            <Segmented<AmbientOverlay['kind']>
              size="sm"
              value={config.overlay.kind}
              onChange={(kind) => overlay({ kind })}
              options={[
                { value: 'none', label: 'Nothing' },
                { value: 'text', label: 'Text' },
                { value: 'clock', label: 'Clock' },
                { value: 'countdown', label: 'Countdown' }
              ]}
            />
            {config.overlay.kind !== 'none' && (
              <div className={s.overlayFields}>
                {(config.overlay.kind === 'text' || config.overlay.kind === 'countdown') && (
                  <Field label={config.overlay.kind === 'countdown' ? 'Headline' : 'Text'}>
                    <TextField
                      value={config.overlay.text ?? ''}
                      onChange={(e) => overlay({ text: e.target.value })}
                      placeholder="Welcome"
                    />
                  </Field>
                )}
                {config.overlay.kind === 'text' && (
                  <Field label="Smaller line">
                    <TextField
                      value={config.overlay.subtext ?? ''}
                      onChange={(e) => overlay({ subtext: e.target.value })}
                      placeholder="We're glad you're here"
                    />
                  </Field>
                )}
                {config.overlay.kind === 'clock' && (
                  <Field label="Line under the clock" hint="Leave empty to show the date">
                    <TextField
                      value={config.overlay.text ?? ''}
                      onChange={(e) => overlay({ text: e.target.value })}
                    />
                  </Field>
                )}
                {config.overlay.kind === 'countdown' && (
                  <>
                    <Field label="Label above the timer">
                      <TextField
                        value={config.overlay.subtext ?? ''}
                        onChange={(e) => overlay({ subtext: e.target.value })}
                        placeholder="The service begins in"
                      />
                    </Field>
                    <div className={s.row}>
                      <Segmented<'minutes' | 'until'>
                        size="sm"
                        value={config.overlay.countdownMinutes ? 'minutes' : 'until'}
                        onChange={(mode) =>
                          overlay(
                            mode === 'minutes'
                              ? { countdownMinutes: 5 }
                              : {
                                  countdownMinutes: undefined,
                                  countdownTo: config.overlay.countdownTo ?? '10:30'
                                }
                          )
                        }
                        options={[
                          { value: 'minutes', label: 'For' },
                          { value: 'until', label: 'Until' }
                        ]}
                      />
                      {config.overlay.countdownMinutes ? (
                        <>
                          <TextField
                            className={s.small}
                            type="number"
                            min={1}
                            max={240}
                            value={config.overlay.countdownMinutes}
                            onChange={(e) =>
                              overlay({ countdownMinutes: Math.max(1, Number(e.target.value) || 1) })
                            }
                          />
                          <span className={s.unit}>minutes, from when it goes live</span>
                        </>
                      ) : (
                        <>
                          <TextField
                            className={s.small}
                            type="time"
                            value={config.overlay.countdownTo ?? '10:30'}
                            onChange={(e) => overlay({ countdownTo: e.target.value })}
                          />
                          <span className={s.unit}>today</span>
                        </>
                      )}
                    </div>
                    <Field label="When it reaches zero, show">
                      <TextField
                        value={config.overlay.countdownEndText ?? ''}
                        onChange={(e) => overlay({ countdownEndText: e.target.value })}
                        placeholder="Welcome"
                      />
                    </Field>
                  </>
                )}
                <div className={s.row}>
                  <Field label="Position" className={s.grow}>
                    <Select
                      value={config.overlay.position}
                      onChange={(e) => overlay({ position: e.target.value as AmbientOverlay['position'] })}
                    >
                      <option value="center">Center</option>
                      <option value="bottom">Bottom</option>
                      <option value="lower-left">Lower left</option>
                    </Select>
                  </Field>
                  <Field label="Font" className={s.grow}>
                    <Select
                      value={config.overlay.font ?? 'inter'}
                      onChange={(e) => overlay({ font: e.target.value as FontId })}
                    >
                      {FONTS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </Dialog>
  )
}

function countdownPreview(overlay: AmbientOverlay): number | undefined {
  if (overlay.kind !== 'countdown') return undefined
  if (overlay.countdownMinutes) return Date.now() + overlay.countdownMinutes * 60_000
  const m = /^(\d{1,2}):(\d{2})$/.exec(overlay.countdownTo ?? '')
  if (!m) return undefined
  const d = new Date()
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return d.getTime()
}
