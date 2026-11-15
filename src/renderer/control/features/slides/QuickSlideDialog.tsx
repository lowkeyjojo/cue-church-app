import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Eye, Save, Tv } from 'lucide-react'
import { newDeck, newSlide } from '@shared/defaults'
import { BIBLE_TRANSLATIONS, parseReference, type TranslationId } from '@shared/scripture'
import type { Slide, SlideLayout } from '@shared/types'
import { SlideView } from '../../../stage/slides/SlideView'
import { useElementSize } from '../../../stage/useElementSize'
import { attempt, cleanError } from '../../lib/api'
import { addMediaToPlan } from '../../lib/planActions'
import { lookUpScripture, presentSlides, type ScriptureSlides } from '../../lib/scripture'
import { useSettings } from '../../lib/store'
import { toast } from '../../lib/toasts'
import { useUI } from '../../lib/ui'
import { Button, IconButton } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { Field, Segmented, TextArea, TextField } from '../../ui/Controls'
import s from './QuickSlide.module.css'

export const LAYOUTS: { value: SlideLayout; label: string; tooltip: string }[] = [
  { value: 'title', label: 'Title', tooltip: 'Big title with an optional subtitle' },
  { value: 'title-body', label: 'Title + text', tooltip: 'A heading with text or bullet points' },
  { value: 'body', label: 'Text', tooltip: 'Just text, nicely centered' },
  { value: 'scripture', label: 'Scripture', tooltip: 'A verse with its reference' },
  { value: 'big', label: 'Big word', tooltip: 'One huge word or phrase' },
  { value: 'lower-third', label: 'Lower third', tooltip: 'Text along the bottom, over a background' }
]

const TRANSLATIONS = BIBLE_TRANSLATIONS.map((t) => ({ value: t.id, label: t.abbr, tooltip: t.name }))

/** Type something, see it exactly as the room will, show it. For spontaneous moments. */
export function QuickSlideDialog({ initialText }: { initialText?: string }) {
  const close = useUI((st) => st.close)
  const settings = useSettings()!
  // Pasted or typed "John 3:16" looks the passage up straight away.
  const initialRef = initialText && parseReference(initialText) ? initialText.trim() : ''
  const text = initialRef ? '' : (initialText ?? '')
  const [layout, setLayout] = useState<SlideLayout>(
    initialRef || text.length > 60 ? 'scripture' : text && text.length < 24 ? 'big' : 'body'
  )
  const [title, setTitle] = useState(text.length < 24 ? text : '')
  const [body, setBody] = useState(text.length >= 24 ? text : '')
  const [footer, setFooter] = useState('')
  const [ref, size] = useElementSize<HTMLDivElement>()

  const [reference, setReference] = useState(initialRef)
  const [translation, setTranslation] = useState<TranslationId>(settings.slides.bible)
  /** A passage too long for one slide, shown as several. */
  const [passage, setPassage] = useState<ScriptureSlides | null>(null)
  const [page, setPage] = useState(0)
  const [lookupError, setLookupError] = useState<string | null>(null)
  /** The verse text a lookup put in the fields, as opposed to text the operator typed. */
  const lookedUp = useRef<{ body: string; footer: string } | null>(null)

  useEffect(() => {
    const wanted = reference.trim()
    if (layout !== 'scripture' || !parseReference(wanted)) {
      setPassage(null)
      setLookupError(null)
      return
    }
    // An earlier lookup's verse must not resurface under a different reference.
    const forgetLookup = () => {
      const was = lookedUp.current
      lookedUp.current = null
      if (!was) return
      setBody((text) => (text === was.body ? '' : text))
      setFooter((text) => (text === was.footer ? '' : text))
    }
    let live = true
    const t = setTimeout(async () => {
      try {
        const found = await lookUpScripture(wanted, translation)
        if (!live) return
        setLookupError(null)
        if (found.slides.length > 1) {
          forgetLookup()
          setPassage(found)
          setPage(0)
        } else {
          // One slide: it becomes ordinary text to adjust before showing.
          const verse = { body: found.slides[0].body ?? '', footer: found.slides[0].footer ?? '' }
          lookedUp.current = verse
          setPassage(null)
          setBody(verse.body)
          setFooter(verse.footer)
        }
      } catch (err) {
        if (!live) return
        // Nothing from an earlier lookup stays ready to show under a reference that failed.
        forgetLookup()
        setPassage(null)
        setLookupError(cleanError(err) || "Couldn't look that up")
      }
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [reference, translation, layout])

  const slide: Slide = useMemo(() => newSlide({ layout, title, body, footer }), [layout, title, body, footer])
  const slides = useMemo(() => passage?.slides ?? [slide], [passage, slide])
  const deck = useMemo(
    () => newDeck({ slides, theme: settings.slides.theme, background: settings.slides.background }),
    [slides, settings.slides]
  )
  const name = passage?.label ?? (title || body.split('\n')[0] || 'Text slide').slice(0, 60)
  const empty = !passage && !title.trim() && !body.trim()
  const usesTitle =
    layout === 'title' || layout === 'title-body' || layout === 'big' || layout === 'lower-third'
  const usesBody = layout !== 'big'
  // The field to type in first.
  const first =
    layout === 'scripture' && !text ? 'reference' : usesTitle && (!text || !usesBody) ? 'title' : 'body'

  const present = (live: boolean) => {
    void presentSlides(slides, name, settings.slides, live)
    close('quickSlide')
  }
  const save = async () => {
    const item = await attempt('library:createDeck', name, deck)
    if (item) {
      await addMediaToPlan([item.id])
      toast.success('Saved as slides', name)
      close('quickSlide')
    }
  }

  return (
    <Dialog
      open
      onClose={() => close('quickSlide')}
      title="Quick text slide"
      description="Type it, check it, show it. Uses your default slide style (Settings → Slides)."
      width={880}
      footer={
        <>
          <Button variant="ghost" icon={<Save />} disabled={empty} onClick={save}>
            Save to plan
          </Button>
          <div style={{ flex: 1 }} />
          <Button icon={<Eye />} disabled={empty} onClick={() => present(false)}>
            Preview
          </Button>
          <Button variant="primary" icon={<Tv />} disabled={empty} onClick={() => present(true)}>
            Show on {settings.output.name}
          </Button>
        </>
      }
    >
      <div className={s.layout}>
        <div className={s.form}>
          <Segmented<SlideLayout>
            size="sm"
            value={layout}
            onChange={setLayout}
            options={LAYOUTS}
            className={s.layouts}
          />
          {layout === 'scripture' && (
            <div className={s.lookup}>
              <Field
                label="Look up a passage"
                hint={
                  lookupError ? (
                    <span className={s.lookupError}>{lookupError}</span>
                  ) : (
                    'John 3:16, Psalm 23, Rom 8:38–39'
                  )
                }
              >
                <TextField
                  autoFocus={first === 'reference'}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="John 3:16"
                  aria-invalid={!!lookupError}
                />
              </Field>
              <Segmented<TranslationId>
                size="sm"
                value={translation}
                onChange={setTranslation}
                options={TRANSLATIONS}
                ariaLabel="Bible translation"
              />
            </div>
          )}
          {passage ? (
            <p className={s.passageNote}>
              {passage.label} fills {passage.slides.length} slides. Once it's showing, press → for the next
              one.
            </p>
          ) : (
            <>
              {usesTitle && (
                <Field label={layout === 'big' ? 'Word or phrase' : 'Title'}>
                  <TextField
                    autoFocus={first === 'title'}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={layout === 'big' ? 'PRAY' : 'Title'}
                  />
                </Field>
              )}
              {usesBody && (
                <Field
                  label={layout === 'scripture' ? 'Verse' : 'Text'}
                  hint="**bold**, *italic*, start a line with - for bullets"
                >
                  <TextArea
                    autoFocus={first === 'body'}
                    rows={layout === 'scripture' ? 6 : 5}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={layout === 'scripture' ? 'For God so loved the world…' : 'Type here'}
                  />
                </Field>
              )}
              {layout === 'scripture' && (
                <Field label="Reference">
                  <TextField
                    value={footer}
                    onChange={(e) => setFooter(e.target.value)}
                    placeholder="John 3:16"
                  />
                </Field>
              )}
            </>
          )}
        </div>
        <div className={s.side}>
          <div className={s.preview} ref={ref}>
            {size.width > 0 && (
              <SlideView
                deck={deck}
                index={passage ? page : 0}
                media={undefined}
                width={size.width}
                height={size.height}
                role="preview"
              />
            )}
          </div>
          {passage && (
            <div className={s.pager}>
              <IconButton
                label="Previous slide"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft />
              </IconButton>
              <span>
                {page + 1} / {passage.slides.length}
              </span>
              <IconButton
                label="Next slide"
                size="sm"
                disabled={page >= passage.slides.length - 1}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight />
              </IconButton>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}
