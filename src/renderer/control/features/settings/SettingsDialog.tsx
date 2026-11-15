import { useEffect, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  ExternalLink,
  FolderOpen,
  Monitor,
  MousePointer2,
  Search,
  ScrollText,
  Speaker,
  Type,
  Volume2
} from 'lucide-react'
import { FONTS } from '@shared/defaults'
import { BIBLE_TRANSLATIONS, type TranslationId } from '@shared/scripture'
import type { FitMode, FontId, OutputMode, Settings, SettingsPatch, SlideTheme } from '@shared/types'
import { attempt, dispatch } from '../../lib/api'
import { useApp, useSettings, useShow } from '../../lib/store'
import { useUI } from '../../lib/ui'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { Field, Segmented, Select, Slider, Switch, TextField } from '../../ui/Controls'
import s from './SettingsDialog.module.css'

const TABS: { id: string; label: string; icon: ReactNode }[] = [
  { id: 'output', label: 'Output', icon: <Monitor size={15} /> },
  { id: 'audio', label: 'Audio', icon: <Volume2 size={15} /> },
  { id: 'presenter', label: 'Presenting', icon: <MousePointer2 size={15} /> },
  { id: 'search', label: 'Search', icon: <Search size={15} /> },
  { id: 'slides', label: 'Slides', icon: <Type size={15} /> },
  { id: 'library', label: 'Library', icon: <FolderOpen size={15} /> }
]

function update(patch: SettingsPatch) {
  void attempt('settings:update', patch)
}

export function SettingsDialog({ tab: initial }: { tab: string }) {
  const close = useUI((st) => st.close)
  const settings = useSettings()!
  const [tab, setTab] = useState(TABS.some((t) => t.id === initial) ? initial : 'output')
  return (
    <Dialog open onClose={() => close('settings')} width={860} title="Settings" bodyClassName={s.body}>
      <div className={s.layout}>
        <div className={s.nav} role="tablist" aria-orientation="vertical" aria-label="Settings sections">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              id={`settings-tab-${t.id}`}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls="settings-panel"
              tabIndex={tab === t.id ? 0 : -1}
              className={clsx(s.navItem, tab === t.id && s.navOn)}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
                if (!step) return
                e.preventDefault()
                const next = TABS[(i + step + TABS.length) % TABS.length]
                setTab(next.id)
                document.getElementById(`settings-tab-${next.id}`)?.focus()
              }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <div className={s.panel} role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab}`}>
          {tab === 'output' && <OutputSettings settings={settings} />}
          {tab === 'audio' && <AudioSettings settings={settings} />}
          {tab === 'presenter' && <PresenterSettings settings={settings} />}
          {tab === 'search' && <SearchSettings settings={settings} />}
          {tab === 'slides' && <SlidesSettings settings={settings} />}
          {tab === 'library' && <LibrarySettings />}
        </div>
      </div>
    </Dialog>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={s.group}>
      <h3 className={s.groupTitle}>{title}</h3>
      <div className={s.groupBody}>{children}</div>
    </section>
  )
}

function OutputSettings({ settings }: { settings: Settings }) {
  const snap = useApp((st) => st.displays)
  const show = useShow()!
  const o = settings.output
  return (
    <>
      <Group title="Audience screen">
        <Field label="Name" hint="Shown on buttons, e.g. “Show on TV”" inline>
          <TextField
            className={s.medium}
            value={o.name}
            onChange={(e) => update({ output: { name: e.target.value || 'TV' } })}
          />
        </Field>
        <Field label="Mode" hint={snap?.output.note} inline>
          <Segmented<OutputMode>
            size="sm"
            value={o.mode}
            onChange={(mode) => attempt('output:set', { mode })}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'fullscreen', label: 'Fullscreen' },
              { value: 'window', label: 'Window' },
              { value: 'off', label: 'Off' }
            ]}
          />
        </Field>
        <Field label="Display" hint="Cue remembers it and switches back when it's reconnected" inline>
          <Select
            className={s.medium}
            value={String(snap?.output.displayId ?? o.displayId ?? '')}
            onChange={(e) =>
              attempt('output:set', { displayId: e.target.value ? Number(e.target.value) : null })
            }
          >
            <option value="">Automatic</option>
            {snap?.displays.map((d) => (
              <option key={d.id} value={d.id} disabled={d.hasControl && snap.displays.length > 1}>
                {d.label} — {d.bounds.width}×{d.bounds.height}
                {d.hasControl ? ' (this screen)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <div className={s.buttons}>
          <Button size="sm" onClick={() => attempt('displays:identify')}>
            Identify displays
          </Button>
          <Button size="sm" pressed={show.testPattern} onClick={() => dispatch({ type: 'test-pattern' })}>
            Test pattern
          </Button>
        </div>
      </Group>
      <Group title="Picture">
        <Field
          label="Overscan inset"
          hint="Shrink the picture if a TV crops the edges. Use the test pattern to check."
          inline
        >
          <div className={s.sliderRow}>
            <Slider
              value={o.inset}
              min={0}
              max={10}
              step={0.5}
              onChange={(inset) => update({ output: { inset } })}
              ariaLabel="Overscan inset"
            />
            <span className={s.value}>{o.inset}%</span>
          </div>
        </Field>
        <Field label="Background" hint="Behind letterboxed images and slides" inline>
          <input
            className={s.color}
            type="color"
            value={o.background}
            onChange={(e) => update({ output: { background: e.target.value } })}
          />
        </Field>
        <Field label="Default scaling" inline>
          <Segmented<FitMode>
            size="sm"
            value={o.defaultFit}
            onChange={(defaultFit) => update({ output: { defaultFit } })}
            options={[
              { value: 'fit', label: 'Fit' },
              { value: 'fill', label: 'Fill' },
              { value: 'blur', label: 'Blur' }
            ]}
          />
        </Field>
        <Field
          label="Show credits on screen"
          hint="A small caption crediting web images (author · license · site)"
          inline
        >
          <Switch checked={o.showCredits} onChange={(showCredits) => update({ output: { showCredits } })} />
        </Field>
        <Field label="When Cue opens, the screen shows" inline>
          <Segmented<'black' | 'ambient'>
            size="sm"
            value={o.startup}
            onChange={(startup) => update({ output: { startup } })}
            options={[
              { value: 'black', label: 'Black' },
              { value: 'ambient', label: 'Ambient' }
            ]}
          />
        </Field>
      </Group>
    </>
  )
}

function AudioSettings({ settings }: { settings: Settings }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [testing, setTesting] = useState(false)
  useEffect(() => {
    const load = () =>
      navigator.mediaDevices
        .enumerateDevices()
        .then((all) => setDevices(all.filter((d) => d.kind === 'audiooutput')))
        .catch(() => setDevices([]))
    void load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener('devicechange', load)
  }, [])

  const playTest = async () => {
    setTesting(true)
    try {
      const ctx = new AudioContext()
      const dest = ctx.createMediaStreamDestination()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 523.25
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.05)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2)
      osc.connect(gain).connect(dest)
      const audio = new Audio() as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
      audio.srcObject = dest.stream
      if (audio.setSinkId)
        await audio.setSinkId(settings.audio.deviceId === 'default' ? '' : settings.audio.deviceId)
      await audio.play()
      osc.start()
      osc.stop(ctx.currentTime + 1.25)
      setTimeout(() => {
        void ctx.close()
        setTesting(false)
      }, 1400)
    } catch {
      setTesting(false)
    }
  }

  return (
    <Group title="Sound from videos">
      <Field
        label="Play through"
        hint="Pick the TV (HDMI) or your sound desk. The Preview and Live monitors here are always silent."
        inline
      >
        <Select
          className={s.wide}
          value={settings.audio.deviceId}
          onChange={(e) => update({ audio: { deviceId: e.target.value } })}
        >
          <option value="default">System default</option>
          {devices
            .filter((d) => d.deviceId !== 'default')
            .map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Audio output ${i + 1}`}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Test" hint="Plays a short tone on the selected output" inline>
        <Button size="sm" icon={<Speaker />} disabled={testing} onClick={playTest}>
          {testing ? 'Playing…' : 'Play test tone'}
        </Button>
      </Field>
    </Group>
  )
}

function PresenterSettings({ settings }: { settings: Settings }) {
  const p = settings.presenter
  return (
    <>
      <Group title="Running the service">
        <Field
          label="Get the next plan item ready automatically"
          hint="After something from the plan goes live, the following item appears in Preview"
          inline
        >
          <Switch
            checked={p.autoStandby}
            onChange={(autoStandby) => update({ presenter: { autoStandby } })}
          />
        </Field>
        <Field
          label="Next continues into the next item"
          hint="At the last slide, → (or a clicker) moves on to the next plan item. Off is safer with clickers."
          inline
        >
          <Switch
            checked={p.nextAcrossItems}
            onChange={(nextAcrossItems) => update({ presenter: { nextAcrossItems } })}
          />
        </Field>
        <Field
          label="Clicking a page of what's live shows it immediately"
          hint="In the Show tab's page grid. When off, clicking previews the page."
          inline
        >
          <Switch
            checked={p.livePageClick}
            onChange={(livePageClick) => update({ presenter: { livePageClick } })}
          />
        </Field>
      </Group>
      <Group title="Transitions">
        <Field label="Default transition" inline>
          <div className={s.sliderRow}>
            <Segmented
              size="sm"
              value={settings.transition.kind}
              onChange={(kind) => dispatch({ type: 'transition', transition: { kind } })}
              options={[
                { value: 'cut', label: 'Cut' },
                { value: 'fade', label: 'Fade' },
                { value: 'dip', label: 'Dip' }
              ]}
            />
            <Select
              className={s.small}
              value={String(settings.transition.duration)}
              onChange={(e) =>
                dispatch({ type: 'transition', transition: { duration: Number(e.target.value) } })
              }
            >
              {[250, 500, 800, 1200, 2000].map((d) => (
                <option key={d} value={d}>
                  {d / 1000}s
                </option>
              ))}
            </Select>
          </div>
        </Field>
      </Group>
    </>
  )
}

function SearchSettings({ settings }: { settings: Settings }) {
  const sr = settings.search
  return (
    <>
      <Group title="Image search">
        <Field label="SafeSearch" hint="Filters explicit results from Google. Recommended." inline>
          <Switch checked={sr.safeSearch} onChange={(safeSearch) => update({ search: { safeSearch } })} />
        </Field>
        <Field
          label="Clicking an image puts it in Preview"
          hint="Saves a click: open an image in Google and it's ready to show"
          inline
        >
          <Switch checked={sr.autoPreview} onChange={(autoPreview) => update({ search: { autoPreview } })} />
        </Field>
      </Group>
      <Group title="Pexels (optional)">
        <Field
          label="API key"
          hint={
            <>
              Free stock photos and videos. Get a key at{' '}
              <button
                className={s.link}
                onClick={() => attempt('system:openExternal', 'https://www.pexels.com/api/')}
              >
                pexels.com/api <ExternalLink size={10} />
              </button>
            </>
          }
        >
          <TextField
            value={sr.pexelsKey}
            onChange={(e) => update({ search: { pexelsKey: e.target.value.trim() } })}
            placeholder="Paste your key"
          />
        </Field>
      </Group>
      <p className={s.note}>
        Respect copyright: images found online often belong to someone. Wikimedia Commons, Openverse and
        Pexels are free to use; for Google results, the “Creative Commons only” filter helps, and Cue keeps
        each image's source so you can credit it.
      </p>
    </>
  )
}

function SlidesSettings({ settings }: { settings: Settings }) {
  const t = settings.slides.theme
  const bg = settings.slides.background
  const theme = (patch: Partial<SlideTheme>) => update({ slides: { theme: { ...t, ...patch } } })
  return (
    <>
      <Group title="Default style for new slides">
        <Field label="Title font" inline>
          <FontSelect value={t.titleFont} onChange={(titleFont) => theme({ titleFont })} />
        </Field>
        <Field label="Text font" inline>
          <FontSelect value={t.font} onChange={(font) => theme({ font })} />
        </Field>
        <Field label="Colors" hint="Text and accent" inline>
          <div className={s.sliderRow}>
            <input
              className={s.color}
              type="color"
              value={t.textColor}
              onChange={(e) => theme({ textColor: e.target.value })}
            />
            <input
              className={s.color}
              type="color"
              value={t.accentColor}
              onChange={(e) => theme({ accentColor: e.target.value })}
            />
          </div>
        </Field>
        <Field label="Background gradient" inline>
          <div className={s.sliderRow}>
            <input
              className={s.color}
              type="color"
              value={bg.gradient?.from ?? '#1b1c21'}
              onChange={(e) =>
                update({
                  slides: {
                    background: {
                      ...bg,
                      type: 'gradient',
                      gradient: { angle: 160, to: '#0b0c0e', ...bg.gradient, from: e.target.value }
                    }
                  }
                })
              }
            />
            <input
              className={s.color}
              type="color"
              value={bg.gradient?.to ?? '#0b0c0e'}
              onChange={(e) =>
                update({
                  slides: {
                    background: {
                      ...bg,
                      type: 'gradient',
                      gradient: { angle: 160, from: '#1b1c21', ...bg.gradient, to: e.target.value }
                    }
                  }
                })
              }
            />
          </div>
        </Field>
      </Group>
      <Group title="Scripture">
        <Field label="Bible translation" hint="For passages you look up; both are public domain" inline>
          <Select
            className={s.medium}
            value={settings.slides.bible}
            onChange={(e) => update({ slides: { bible: e.target.value as TranslationId } })}
          >
            {BIBLE_TRANSLATIONS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.abbr})
              </option>
            ))}
          </Select>
        </Field>
      </Group>
      <Group title="PDF quality">
        <Field
          label="Render PDF pages at"
          hint="Higher is sharper on 4K screens but takes longer to import"
          inline
        >
          <Select
            className={s.small}
            value={String(settings.slides.renderQuality)}
            onChange={(e) =>
              update({ slides: { renderQuality: Number(e.target.value) as 1080 | 1440 | 2160 } })
            }
          >
            <option value="1080">1080p</option>
            <option value="1440">1440p</option>
            <option value="2160">4K</option>
          </Select>
        </Field>
      </Group>
    </>
  )
}

function FontSelect({ value, onChange }: { value: FontId; onChange: (f: FontId) => void }) {
  return (
    <Select className={s.medium} value={value} onChange={(e) => onChange(e.target.value as FontId)}>
      {FONTS.map((f) => (
        <option key={f.id} value={f.id}>
          {f.label}
        </option>
      ))}
    </Select>
  )
}

function LibrarySettings() {
  const info = useApp((st) => st.info)
  const items = useApp((st) => st.items)
  const all = Object.values(items)
  const transient = all.filter((i) => !i.saved).length
  return (
    <>
      <Group title="Storage">
        <Field label="Media folder" hint={info?.libraryPath} inline>
          <Button size="sm" icon={<FolderOpen />} onClick={() => attempt('system:revealLibrary')}>
            Open
          </Button>
        </Field>
        <Field
          label="In your library"
          hint={`${all.length - transient} saved items · ${transient} recent web picks (kept 30 days)`}
          inline
        >
          <span />
        </Field>
      </Group>
      <Group title="Help">
        <Field label="Log files" hint="Useful if something goes wrong on a Sunday" inline>
          <Button size="sm" icon={<ScrollText />} onClick={() => attempt('system:revealLogs')}>
            Show logs
          </Button>
        </Field>
        <Field label="Version" inline>
          <span className={s.value}>
            Cue {info?.version} · Electron {info?.electron}
          </span>
        </Field>
      </Group>
    </>
  )
}
