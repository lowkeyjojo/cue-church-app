import { useUI } from '../lib/ui'
import { AmbientDialog } from './ambient/AmbientDialog'
import { CommandPalette } from './palette/CommandPalette'
import { SettingsDialog } from './settings/SettingsDialog'
import { DeckEditor } from './slides/DeckEditor'
import { QuickSlideDialog } from './slides/QuickSlideDialog'
import { AboutDialog, ShortcutsDialog } from './welcome/InfoDialogs'
import { WelcomeDialog } from './welcome/WelcomeDialog'

export function Dialogs() {
  const d = useUI((st) => st.dialogs)
  return (
    <>
      {d.palette && <CommandPalette />}
      {d.settings && <SettingsDialog tab={d.settings} />}
      {d.quickSlide && <QuickSlideDialog initialText={d.quickSlide.text} />}
      {d.ambient && <AmbientDialog target={d.ambient} />}
      {d.deck && <DeckEditor deckId={d.deck} />}
      {d.welcome && <WelcomeDialog />}
      {d.shortcuts && <ShortcutsDialog />}
      {d.about && <AboutDialog />}
    </>
  )
}
