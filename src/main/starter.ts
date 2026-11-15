import { DEFAULT_AMBIENT, newDeck, newId, newSlide } from '@shared/defaults'
import type { MediaItem, Slide, SlideTheme } from '@shared/types'
import { todayIso } from '@shared/util'
import { newItem } from './media/importer'
import type { LibraryStore } from './store/library'
import type { PlansStore } from './store/plans'
import type { SettingsStore } from './store/settings'

/**
 * On a brand-new install, create a small sample service so the operator can
 * try every workflow (slides, countdown, ambient, Back) without any media.
 */
export function ensureStarterContent(
  library: LibraryStore,
  plans: PlansStore,
  settings: SettingsStore
): void {
  if (settings.data.ui.firstRunDone || library.all().length || plans.all().length) return

  const welcome = deckItem('Welcome & announcements', [
    newSlide({ layout: 'title', title: 'Welcome', body: "We're so glad you're here" }),
    newSlide({
      layout: 'title-body',
      title: 'This week',
      body: 'Prayer meeting — Wednesday 7 pm\nYouth night — Friday 6:30 pm\nPotluck lunch after the service'
    })
  ])
  const sermon = deckItem(
    'Sermon — The Light of the World',
    [
      newSlide({ layout: 'title', title: 'The Light of the World', body: 'John 8:12' }),
      newSlide({
        layout: 'scripture',
        body: 'Then spake Jesus again unto them, saying, I am the light of the world: he that followeth me shall not walk in darkness, but shall have the light of life.',
        footer: 'John 8:12 (KJV)'
      }),
      newSlide({ layout: 'big', title: 'Walk in the light' })
    ],
    { titleFont: 'playfair', font: 'lora' }
  )
  library.add(welcome)
  library.add(sermon)

  const plan = plans.create('Sunday Service', nextSunday())
  plans.addEntries(plan.id, [
    { type: 'section', title: 'Before the service' },
    {
      type: 'ambient',
      title: 'Countdown',
      ambient: {
        ...DEFAULT_AMBIENT,
        theme: 'ember',
        overlay: {
          kind: 'countdown',
          text: 'Welcome',
          subtext: 'The service begins in',
          countdownMinutes: 5,
          countdownEndText: 'Welcome',
          position: 'center'
        }
      }
    },
    { type: 'media', mediaId: welcome.id },
    { type: 'section', title: 'Message' },
    { type: 'media', mediaId: sermon.id },
    { type: 'section', title: 'After the service' },
    {
      type: 'ambient',
      title: 'Thank you',
      ambient: {
        ...DEFAULT_AMBIENT,
        theme: 'dawn',
        overlay: {
          kind: 'text',
          text: 'Thank you for joining us',
          subtext: 'Have a blessed week',
          position: 'center'
        }
      }
    }
  ])
  settings.update({ ui: { planId: plan.id } })
}

function deckItem(name: string, slides: Slide[], theme: Partial<SlideTheme> = {}): MediaItem {
  return newItem({
    id: newId(),
    kind: 'deck',
    name,
    status: 'ready',
    source: { type: 'created' },
    deck: newDeck({ slides, theme: { ...newDeck().theme, ...theme } })
  })
}

function nextSunday(): string {
  const d = new Date()
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7))
  return todayIso(d)
}
