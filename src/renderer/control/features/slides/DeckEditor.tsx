import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  ImagePlus,
  Plus,
  Scissors,
  Trash,
  Tv,
  X
} from 'lucide-react'
import { FONTS, newSlide } from '@shared/defaults'
import type { Deck, FontId, MediaItem, Slide, SlideBackground, SlideLayout, SlideTheme } from '@shared/types'
import { debounce, thumbUrl } from '@shared/util'
import { SlideView } from '../../../stage/slides/SlideView'
import { useElementSize } from '../../../stage/useElementSize'
import { attempt, call, dispatch } from '../../lib/api'
import { useApp, useShow } from '../../lib/store'
import { useUI } from '../../lib/ui'
import { Button, IconButton } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { Field, Segmented, Select, Slider, Switch, TextArea, TextField } from '../../ui/Controls'
import { ContextMenu } from '../../ui/Menu'
import { Popover } from '../../ui/Popover'
import { DeckThumb } from '../common/Thumb'
import { LAYOUTS } from './QuickSlideDialog'
import s from './DeckEditor.module.css'

/**
 * Edit a slide deck with a live, exact preview. Changes save automatically —
 * and if the deck is on screen, the audience sees fixes immediately.
 */
export function DeckEditor({ deckId }: { deckId: string }) {
  const close = useUI((st) => st.close)
  const item = useApp((st) => st.items[deckId])
  if (!item?.deck) return null
  return <Editor key={deckId} item={item} deck={item.deck} onClose={() => close('deck')} />
}

function Editor({ item, deck: initial, onClose }: { item: MediaItem; deck: Deck; onClose: () => void }) {
  const show = useShow()!
  const items = useApp((st) => st.items)
  const [deck, setDeck] = useState<Deck>(initial)
  const [index, setIndex] = useState(() => {
    const live = show.live?.mediaId === item.id ? (show.live.page ?? 0) : 0
    return Math.min(live, Math.max(0, initial.slides.length - 1))
  })
  const [name, setName] = useState(item.name)
  const [ref, size] = useElementSize<HTMLDivElement>()
  const thumbs = useRef<(HTMLButtonElement | null)[]>([])
  const saveDeck = useMemo(
    () => debounce((d: Deck) => void attempt('library:updateDeck', item.id, d), 350),
    [item.id]
  )
  const latest = useRef(deck)
  const pendingName = useRef<string | null>(null)
  const saveName = useCallback(() => {
    const next = pendingName.current?.trim()
    pendingName.current = null
    if (next) void attempt('library:update', item.id, { name: next })
  }, [item.id])

  useEffect(() => {
    latest.current = deck
  }, [deck])
  // Flush pending edits when the editor closes (Escape closes it without a blur).
  useEffect(() => () => saveDeck.flush(latest.current), [saveDeck])
  useEffect(() => saveName, [saveName])

  const change = (next: Deck) => {
    setDeck(next)
    saveDeck(next)
  }
  const slide = deck.slides[index]
  const setSlide = (patch: Partial<Slide>) =>
    change({ ...deck, slides: deck.slides.map((sl, i) => (i === index ? { ...sl, ...patch } : sl)) })
  const setTheme = (patch: Partial<SlideTheme>) => change({ ...deck, theme: { ...deck.theme, ...patch } })
  const setBackground = (patch: Partial<SlideBackground>) =>
    change({ ...deck, background: { ...deck.background, ...patch } })

  const addSlide = (after = index) => {
    const base = deck.slides[after]
    const fresh = newSlide({
      layout: base?.layout === 'title' ? 'title-body' : (base?.layout ?? 'title-body')
    })
    const slides = [...deck.slides]
    slides.splice(after + 1, 0, fresh)
    change({ ...deck, slides })
    setIndex(after + 1)
  }
  const duplicate = (i: number) => {
    const slides = [...deck.slides]
    slides.splice(i + 1, 0, { ...structuredClone(deck.slides[i]), id: newSlide().id })
    change({ ...deck, slides })
    setIndex(i + 1)
  }
  /** Returns the slide selected afterwards: the same one, or the removed one's neighbour. */
  const remove = (i: number) => {
    if (deck.slides.length <= 1) return index
    change({ ...deck, slides: deck.slides.filter((_, x) => x !== i) })
    const next = i < index ? index - 1 : Math.min(index, deck.slides.length - 2)
    setIndex(next)
    return next
  }
  /** Select from the keyboard: focus goes along, so Delete acts on the slide that is selected. */
  const focusSlide = (i: number) => {
    setIndex(i)
    requestAnimationFrame(() => thumbs.current[i]?.focus())
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= deck.slides.length) return
    const slides = [...deck.slides]
    ;[slides[i], slides[j]] = [slides[j], slides[i]]
    change({ ...deck, slides })
    setIndex(j)
  }
  /** Turn paragraphs (separated by blank lines) into one slide each — handy for lyrics or long passages. */
  const split = () => {
    const parts = (slide.body ?? '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length < 2) return
    const made = parts.map((body, i) =>
      i === 0 ? { ...slide, body } : { ...slide, id: newSlide().id, body }
    )
    const slides = [...deck.slides]
    slides.splice(index, 1, ...made)
    change({ ...deck, slides })
  }

  const media: Record<string, { kind: 'image' | 'video'; src: string }> = useMemo(() => {
    const out: Record<string, { kind: 'image' | 'video'; src: string }> = {}
    for (const bg of [deck.background, ...deck.slides.map((x) => x.background)]) {
      const m = bg?.mediaId ? items[bg.mediaId] : undefined
      if (m?.file && (m.kind === 'image' || m.kind === 'video'))
        out[m.id] = { kind: m.kind, src: `cue-media://media/${m.id}/${encodeURIComponent(m.file)}` }
    }
    return out
  }, [deck, items])

  const onScreen = show.live?.mediaId === item.id
  const showSlide = (live: boolean) => {
    saveDeck.flush(deck)
    const target = { type: 'media' as const, mediaId: item.id, page: index }
    // Give the save a moment to land so the newest text is what goes out.
    setTimeout(() => dispatch(live ? { type: 'show', target } : { type: 'preview', target }), 60)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      width={1240}
      className={s.dialog}
      bodyClassName={s.body}
      title={
        <input
          className={s.name}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            pendingName.current = e.target.value
          }}
          onBlur={() => {
            saveName()
            if (!name.trim()) setName(item.name)
          }}
          aria-label="Slide deck name"
        />
      }
      description={
        onScreen
          ? 'This deck is on screen — edits appear on the audience screen as you type.'
          : 'Changes save automatically.'
      }
      footer={
        <>
          <div className={s.nav}>
            <IconButton label="Previous slide" disabled={index === 0} onClick={() => setIndex(index - 1)}>
              <ChevronLeft />
            </IconButton>
            <span className={s.count}>
              {index + 1} / {deck.slides.length}
            </span>
            <IconButton
              label="Next slide"
              disabled={index >= deck.slides.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              <ChevronRight />
            </IconButton>
          </div>
          <div style={{ flex: 1 }} />
          <Button variant="ghost" icon={<Eye />} onClick={() => showSlide(false)}>
            Preview slide
          </Button>
          <Button variant="ghost" icon={<Tv />} onClick={() => showSlide(true)}>
            Show slide
          </Button>
          <Button variant="primary" icon={<Check />} onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className={s.layout}>
        <div className={s.list} data-arrow-nav>
          {deck.slides.map((sl, i) => (
            <ContextMenu
              key={sl.id}
              items={[
                { label: 'Add slide after', icon: <Plus />, onSelect: () => addSlide(i) },
                { label: 'Duplicate', icon: <Copy />, onSelect: () => duplicate(i) },
                { label: 'Move up', icon: <ArrowUp />, onSelect: () => move(i, -1), disabled: i === 0 },
                {
                  label: 'Move down',
                  icon: <ArrowDown />,
                  onSelect: () => move(i, 1),
                  disabled: i === deck.slides.length - 1
                },
                { type: 'separator' },
                {
                  label: 'Delete slide',
                  icon: <Trash />,
                  danger: true,
                  onSelect: () => remove(i),
                  disabled: deck.slides.length <= 1
                }
              ]}
            >
              <button
                ref={(el) => {
                  thumbs.current[i] = el
                }}
                className={clsx(s.thumbButton, i === index && s.thumbOn)}
                // One stop for Tab; the arrow keys move within the list.
                tabIndex={i === index ? 0 : -1}
                aria-current={i === index}
                onClick={() => setIndex(i)}
                onKeyDown={(e) => {
                  const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
                  if (step) {
                    e.preventDefault()
                    if (deck.slides[i + step]) focusSlide(i + step)
                  } else if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault()
                    focusSlide(remove(i))
                  }
                }}
              >
                <span className={s.thumbNum}>{i + 1}</span>
                <DeckThumb deck={{ ...deck, slides: deck.slides }} index={i} className={s.thumb} />
              </button>
            </ContextMenu>
          ))}
          <button className={s.add} onClick={() => addSlide(deck.slides.length - 1)}>
            <Plus size={14} /> Add slide
          </button>
        </div>

        <div className={s.stage}>
          <div className={s.canvas} ref={ref}>
            {size.width > 0 && slide && (
              <SlideView
                deck={deck}
                index={index}
                media={media}
                width={size.width}
                height={size.height}
                role="preview"
              />
            )}
          </div>
        </div>

        <div className={s.inspector}>
          {slide && (
            <section className={s.section}>
              <div className={s.sectionTitle}>This slide</div>
              <Field label="Layout">
                <Select
                  value={slide.layout}
                  onChange={(e) => setSlide({ layout: e.target.value as SlideLayout })}
                >
                  {LAYOUTS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {slide.layout !== 'scripture' && slide.layout !== 'body' && (
                <Field label={slide.layout === 'big' ? 'Word or phrase' : 'Title'}>
                  <TextField
                    value={slide.title ?? ''}
                    onChange={(e) => setSlide({ title: e.target.value })}
                    placeholder="Title"
                  />
                </Field>
              )}
              {slide.layout !== 'big' && (
                <Field
                  label={
                    slide.layout === 'scripture' ? 'Verse' : slide.layout === 'title' ? 'Subtitle' : 'Text'
                  }
                  hint="**bold**, *italic*, “- ” for bullets"
                >
                  <TextArea
                    rows={slide.layout === 'title' ? 2 : 6}
                    value={slide.body ?? ''}
                    onChange={(e) => setSlide({ body: e.target.value })}
                  />
                </Field>
              )}
              {/\n\s*\n/.test(slide.body ?? '') && (
                <Button size="sm" variant="quiet" icon={<Scissors />} onClick={split}>
                  Split paragraphs into slides
                </Button>
              )}
              {(slide.layout === 'scripture' || slide.layout === 'title-body') && (
                <Field label={slide.layout === 'scripture' ? 'Reference' : 'Footer'}>
                  <TextField
                    value={slide.footer ?? ''}
                    onChange={(e) => setSlide({ footer: e.target.value })}
                    placeholder={slide.layout === 'scripture' ? 'John 3:16' : ''}
                  />
                </Field>
              )}
              <Field label="Own background" hint="Otherwise uses the deck background" inline>
                <Switch
                  checked={!!slide.background}
                  onChange={(on) =>
                    setSlide({ background: on ? structuredClone(deck.background) : undefined })
                  }
                />
              </Field>
              {slide.background && (
                <BackgroundEditor
                  value={slide.background}
                  onChange={(patch) => setSlide({ background: { ...slide.background!, ...patch } })}
                />
              )}
            </section>
          )}

          <section className={s.section}>
            <div className={s.sectionTitle}>Style · all slides</div>
            <div className={s.pair}>
              <Field label="Title font">
                <FontSelect value={deck.theme.titleFont} onChange={(titleFont) => setTheme({ titleFont })} />
              </Field>
              <Field label="Text font">
                <FontSelect value={deck.theme.font} onChange={(font) => setTheme({ font })} />
              </Field>
            </div>
            <Field label="Alignment" inline>
              <Segmented
                size="sm"
                value={deck.theme.align}
                onChange={(align) => setTheme({ align })}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'center', label: 'Center' },
                  { value: 'right', label: 'Right' }
                ]}
              />
            </Field>
            <Field label="Vertical" inline>
              <Segmented
                size="sm"
                value={deck.theme.vAlign}
                onChange={(vAlign) => setTheme({ vAlign })}
                options={[
                  { value: 'top', label: 'Top' },
                  { value: 'middle', label: 'Middle' },
                  { value: 'bottom', label: 'Bottom' }
                ]}
              />
            </Field>
            <Field label={`Text size · ${Math.round(deck.theme.scale * 100)}%`}>
              <Slider
                value={deck.theme.scale}
                min={0.6}
                max={1.6}
                step={0.05}
                onChange={(scale) => setTheme({ scale })}
                ariaLabel="Text size"
              />
            </Field>
            <Field label="Colors" hint="Text · accent" inline>
              <div className={s.colors}>
                <input
                  type="color"
                  value={deck.theme.textColor}
                  onChange={(e) => setTheme({ textColor: e.target.value })}
                  aria-label="Text color"
                />
                <input
                  type="color"
                  value={deck.theme.accentColor}
                  onChange={(e) => setTheme({ accentColor: e.target.value })}
                  aria-label="Accent color"
                />
              </div>
            </Field>
            <Field label="Text shadow" inline>
              <Switch checked={deck.theme.shadow} onChange={(shadow) => setTheme({ shadow })} />
            </Field>
            <Field label="Uppercase titles" inline>
              <Switch
                checked={deck.theme.uppercaseTitle}
                onChange={(uppercaseTitle) => setTheme({ uppercaseTitle })}
              />
            </Field>
          </section>

          <section className={s.section}>
            <div className={s.sectionTitle}>Background · all slides</div>
            <BackgroundEditor value={deck.background} onChange={setBackground} />
          </section>

          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void call('settings:update', { slides: { theme: deck.theme, background: deck.background } })
            }
          >
            Use this style for new slides
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function FontSelect({ value, onChange }: { value: FontId; onChange: (f: FontId) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as FontId)}>
      {FONTS.map((f) => (
        <option key={f.id} value={f.id}>
          {f.label}
        </option>
      ))}
    </Select>
  )
}

function BackgroundEditor({
  value,
  onChange
}: {
  value: SlideBackground
  onChange: (patch: Partial<SlideBackground>) => void
}) {
  const items = useApp((st) => st.items)
  const chosen = value.mediaId ? items[value.mediaId] : undefined
  const media = useMemo(
    () =>
      Object.values(items)
        .filter((i) => i.saved && (i.kind === 'image' || i.kind === 'video') && i.status !== 'error')
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 120),
    [items]
  )
  return (
    <div className={s.bg}>
      <Segmented<SlideBackground['type']>
        size="sm"
        value={value.type}
        onChange={(type) => onChange({ type })}
        options={[
          { value: 'color', label: 'Color' },
          { value: 'gradient', label: 'Gradient' },
          { value: 'media', label: 'Image / video' }
        ]}
      />
      {value.type === 'color' && (
        <div className={s.colors}>
          <input
            type="color"
            value={value.color ?? '#000000'}
            onChange={(e) => onChange({ color: e.target.value })}
            aria-label="Background color"
          />
        </div>
      )}
      {value.type === 'gradient' && (
        <div className={s.colors}>
          <input
            type="color"
            value={value.gradient?.from ?? '#1b1c21'}
            onChange={(e) =>
              onChange({ gradient: { angle: 160, to: '#0b0c0e', ...value.gradient, from: e.target.value } })
            }
            aria-label="Gradient start"
          />
          <input
            type="color"
            value={value.gradient?.to ?? '#0b0c0e'}
            onChange={(e) =>
              onChange({ gradient: { angle: 160, from: '#1b1c21', ...value.gradient, to: e.target.value } })
            }
            aria-label="Gradient end"
          />
        </div>
      )}
      {value.type === 'media' && (
        <Popover
          width={360}
          align="start"
          trigger={
            <button className={s.mediaPick}>
              {chosen && thumbUrl(chosen) ? <img src={thumbUrl(chosen)} alt="" /> : <ImagePlus size={16} />}
              <span>{chosen ? chosen.name : 'Choose from library…'}</span>
            </button>
          }
        >
          <div className={s.mediaGrid}>
            {media.length === 0 && (
              <div className={s.hint}>Import images or videos to use them as backgrounds.</div>
            )}
            {media.map((m) => (
              <button
                key={m.id}
                className={clsx(s.mediaItem, m.id === value.mediaId && s.mediaOn)}
                onClick={() => onChange({ mediaId: m.id })}
                title={m.name}
              >
                {thumbUrl(m) && <img src={thumbUrl(m)} alt="" />}
              </button>
            ))}
          </div>
          {value.mediaId && (
            <Button size="sm" variant="ghost" icon={<X />} onClick={() => onChange({ mediaId: undefined })}>
              Remove
            </Button>
          )}
        </Popover>
      )}
      <Field label={`Darken · ${Math.round((value.dim ?? 0) * 100)}%`}>
        <Slider
          value={value.dim ?? 0}
          min={0}
          max={0.85}
          onChange={(dim) => onChange({ dim })}
          ariaLabel="Darken background"
        />
      </Field>
      {value.type === 'media' && (
        <Field label={`Blur · ${value.blur ?? 0}px`}>
          <Slider
            value={value.blur ?? 0}
            min={0}
            max={40}
            step={1}
            onChange={(blur) => onChange({ blur })}
            ariaLabel="Blur background"
          />
        </Field>
      )}
    </div>
  )
}
