import { useMemo, useState } from 'react'
import { Eye, Save, Tv } from 'lucide-react'
import { newDeck, newSlide } from '@shared/defaults'
import type { Slide, SlideLayout } from '@shared/types'
import { SlideView } from '../../../stage/slides/SlideView'
import { useElementSize } from '../../../stage/useElementSize'
import { attempt, dispatch } from '../../lib/api'
import { addMediaToPlan } from '../../lib/planActions'
import { useSettings } from '../../lib/store'
import { toast } from '../../lib/toasts'
import { useUI } from '../../lib/ui'
import { Button } from '../../ui/Button'
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

/** Type something, see it exactly as the room will, show it. For spontaneous moments. */
export function QuickSlideDialog({ initialText }: { initialText?: string }) {
  const close = useUI((st) => st.close)
  const settings = useSettings()!
  const looksLikeVerse = !!initialText && initialText.length > 60
  const [layout, setLayout] = useState<SlideLayout>(
    looksLikeVerse ? 'scripture' : initialText && initialText.length < 24 ? 'big' : 'body'
  )
  const [title, setTitle] = useState(initialText && initialText.length < 24 ? initialText : '')
  const [body, setBody] = useState(initialText && initialText.length >= 24 ? initialText : '')
  const [footer, setFooter] = useState('')
  const [ref, size] = useElementSize<HTMLDivElement>()

  const slide: Slide = useMemo(() => newSlide({ layout, title, body, footer }), [layout, title, body, footer])
  const deck = useMemo(
    () => newDeck({ slides: [slide], theme: settings.slides.theme, background: settings.slides.background }),
    [slide, settings.slides]
  )
  const empty = !title.trim() && !body.trim()
  const usesTitle =
    layout === 'title' || layout === 'title-body' || layout === 'big' || layout === 'lower-third'
  const usesBody = layout !== 'big'

  const target = {
    type: 'slide' as const,
    slide,
    theme: deck.theme,
    background: deck.background,
    title: title || body.split('\n')[0]
  }
  const save = async () => {
    const name = (title || body.split('\n')[0] || 'Text slide').slice(0, 60)
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
          <Button
            icon={<Eye />}
            disabled={empty}
            onClick={() => {
              dispatch({ type: 'preview', target })
              close('quickSlide')
            }}
          >
            Preview
          </Button>
          <Button
            variant="primary"
            icon={<Tv />}
            disabled={empty}
            onClick={() => {
              dispatch({ type: 'show', target })
              close('quickSlide')
            }}
          >
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
          {usesTitle && (
            <Field label={layout === 'big' ? 'Word or phrase' : 'Title'}>
              <TextField
                autoFocus={!initialText}
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
                autoFocus={!!initialText}
                rows={layout === 'scripture' ? 6 : 5}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={layout === 'scripture' ? 'For God so loved the world…' : 'Type here'}
              />
            </Field>
          )}
          {layout === 'scripture' && (
            <Field label="Reference">
              <TextField value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="John 3:16" />
            </Field>
          )}
        </div>
        <div className={s.preview} ref={ref}>
          {size.width > 0 && (
            <SlideView
              deck={deck}
              index={0}
              media={undefined}
              width={size.width}
              height={size.height}
              role="preview"
            />
          )}
        </div>
      </div>
    </Dialog>
  )
}
