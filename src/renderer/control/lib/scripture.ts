import { newDeck, newSlide } from '@shared/defaults'
import { passageText, splitPassage, type TranslationId } from '@shared/scripture'
import type { Settings, Slide } from '@shared/types'
import { attempt, call, dispatch } from './api'
import { previewMedia, showMedia } from './planActions'

export interface ScriptureSlides {
  /** "Psalm 23 (WEB)" */
  label: string
  slides: Slide[]
}

/** Look a passage up and lay it out as scripture slides; a long one is split over several. */
export async function lookUpScripture(
  reference: string,
  translation: TranslationId
): Promise<ScriptureSlides> {
  const passage = await call('scripture:passage', reference, translation)
  const slides = splitPassage(passage, passage.book).map((part) =>
    newSlide({
      layout: 'scripture',
      body: passageText(part.verses),
      footer: `${part.reference} (${part.translation})`
    })
  )
  return { label: `${passage.reference} (${passage.translation})`, slides }
}

/**
 * Show slides (or put them in Preview) in the default slide style. One slide
 * goes up as it is; several become a deck to step through with → , which stays
 * out of the library unless it's saved.
 */
export async function presentSlides(
  slides: Slide[],
  name: string,
  look: Settings['slides'],
  live: boolean
): Promise<void> {
  const { theme, background } = look
  if (slides.length === 1) {
    const target = { type: 'slide' as const, slide: slides[0], theme, background, title: name }
    return dispatch(live ? { type: 'show', target } : { type: 'preview', target })
  }
  const item = await attempt('library:createDeck', name, newDeck({ slides, theme, background }), {
    saved: false
  })
  if (item) (live ? showMedia : previewMedia)(item.id)
}
