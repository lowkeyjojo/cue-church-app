import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Dialog as D } from 'radix-ui'
import clsx from 'clsx'
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  CornerUpLeft,
  Globe,
  Keyboard,
  Landmark,
  Moon,
  PenLine,
  Plus,
  ScanSearch,
  Settings,
  SunMedium,
  SquareDot,
  Tv,
  Type,
  Upload
} from 'lucide-react'
import { BIBLE_TRANSLATIONS, formatReference, parseReference, type TranslationId } from '@shared/scripture'
import type { MediaItem, PlanEntry, Settings as AppSettings } from '@shared/types'
import { attempt, cleanError, dispatch } from '../../lib/api'
import { GOOGLE_SEARCH_EVENT, runUiCommand } from '../../lib/commands'
import { previewEntry, previewMedia, showEntry, showMedia, useCurrentPlan } from '../../lib/planActions'
import { lookUpScripture, presentSlides } from '../../lib/scripture'
import { useApp, useSettings } from '../../lib/store'
import { toast } from '../../lib/toasts'
import { useUI } from '../../lib/ui'
import { AmbientThumb, MediaThumb } from '../common/Thumb'
import { entryInfo, itemSubtitle } from '../plan/entryInfo'
import s from './CommandPalette.module.css'

interface Command {
  id: string
  group: 'Scripture' | 'Actions' | 'Service plan' | 'Library' | 'Search the web'
  label: string
  detail?: string
  icon?: ReactNode
  hint?: string
  run: () => void
  /** Secondary action (⌘/Ctrl+Enter or Shift+Enter): show immediately. */
  runLive?: () => void
}

function score(text: string, words: string[]): number {
  if (!words.length) return 1
  const t = text.toLowerCase()
  let total = 0
  for (const w of words) {
    const i = t.indexOf(w)
    if (i < 0) return 0
    total += i === 0 ? 3 : t[i - 1] === ' ' ? 2 : 1
  }
  return total
}

export function CommandPalette() {
  const close = useUI((st) => st.close)
  const items = useApp((st) => st.items)
  const settings = useSettings()
  const plan = useCurrentPlan()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  const commands = useMemo(() => {
    const q = query.trim()
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const out: (Command & { score: number })[] = []
    const add = (c: Command, text = c.label) => {
      const sc = score(`${text} ${c.detail ?? ''}`, words)
      if (sc > 0) out.push({ ...c, score: sc })
    }
    const actions: Command[] = [
      {
        id: 'take',
        group: 'Actions',
        label: 'Show preview on screen',
        icon: <Tv size={15} />,
        hint: 'Space',
        run: () => dispatch({ type: 'take' })
      },
      {
        id: 'next',
        group: 'Actions',
        label: 'Next slide',
        icon: <ChevronRight size={15} />,
        hint: '→',
        run: () => dispatch({ type: 'next' })
      },
      {
        id: 'prev',
        group: 'Actions',
        label: 'Previous slide',
        icon: <ChevronLeft size={15} />,
        hint: '←',
        run: () => dispatch({ type: 'prev' })
      },
      {
        id: 'blackout',
        group: 'Actions',
        label: 'Blackout',
        detail: 'black screen',
        icon: <Moon size={15} />,
        hint: 'B',
        run: () => dispatch({ type: 'blackout' })
      },
      {
        id: 'ambient',
        group: 'Actions',
        label: 'Ambient',
        detail: 'break loop background',
        icon: <SunMedium size={15} />,
        hint: 'A',
        run: () => dispatch({ type: 'ambient' })
      },
      {
        id: 'back',
        group: 'Actions',
        label: 'Back to previous',
        detail: 'return slides',
        icon: <CornerUpLeft size={15} />,
        hint: 'R',
        run: () => dispatch({ type: 'back' })
      },
      {
        id: 'clear',
        group: 'Actions',
        label: 'Clear screen',
        icon: <CircleOff size={15} />,
        run: () => dispatch({ type: 'clear' })
      },
      {
        id: 'quick',
        group: 'Actions',
        label: 'Quick text slide',
        detail: 'type text verse',
        icon: <Type size={15} />,
        run: () => runUiCommand('quick-slide')
      },
      {
        id: 'import',
        group: 'Actions',
        label: 'Import media',
        icon: <Upload size={15} />,
        run: () => runUiCommand('import')
      },
      {
        id: 'newplan',
        group: 'Actions',
        label: 'New service plan',
        icon: <Plus size={15} />,
        run: () => runUiCommand('new-plan')
      },
      {
        id: 'identify',
        group: 'Actions',
        label: 'Identify displays',
        icon: <ScanSearch size={15} />,
        run: () => void attempt('displays:identify')
      },
      {
        id: 'test',
        group: 'Actions',
        label: 'Test pattern',
        detail: 'calibrate overscan',
        icon: <SquareDot size={15} />,
        run: () => dispatch({ type: 'test-pattern' })
      },
      {
        id: 'window',
        group: 'Actions',
        label: 'Open output window',
        detail: 'floating',
        icon: <Tv size={15} />,
        run: () => void attempt('output:set', { mode: 'window' })
      },
      {
        id: 'settings',
        group: 'Actions',
        label: 'Settings',
        icon: <Settings size={15} />,
        run: () => runUiCommand('open-settings')
      },
      {
        id: 'keys',
        group: 'Actions',
        label: 'Keyboard shortcuts',
        icon: <Keyboard size={15} />,
        run: () => runUiCommand('shortcuts')
      }
    ]
    if (words.length) actions.forEach((a) => add(a))
    else actions.slice(0, 6).forEach((a) => add(a))

    // "John 3:16", "ps 23": the passage, ready to preview or show.
    const verse = parseReference(q)
    if (verse && settings) {
      const translation = settings.slides.bible
      const abbr = BIBLE_TRANSLATIONS.find((t) => t.id === translation)?.abbr
      const reference = formatReference(verse)
      out.push(
        {
          id: 'scripture',
          group: 'Scripture',
          label: `${reference} (${abbr})`,
          icon: <BookOpen size={15} />,
          score: 0,
          run: () => void scripture(q, translation, settings.slides, false),
          runLive: () => void scripture(q, translation, settings.slides, true)
        },
        {
          id: 'scripture-edit',
          group: 'Scripture',
          label: `Open ${reference} in a quick slide…`,
          detail: 'adjust the text first',
          icon: <PenLine size={15} />,
          score: 0,
          run: () => useUI.getState().open('quickSlide', { text: q })
        }
      )
    }

    if (plan) {
      plan.entries
        .filter((e): e is PlanEntry => e.type !== 'section')
        .forEach((e) => {
          const item = e.mediaId ? items[e.mediaId] : undefined
          const info = entryInfo(e, item)
          add({
            id: `entry-${e.id}`,
            group: 'Service plan',
            label: info.title,
            detail: info.subtitle,
            icon:
              e.type === 'ambient' && e.ambient ? (
                <AmbientThumb config={e.ambient} className={s.thumb} />
              ) : item ? (
                <MediaThumb item={item} className={s.thumb} />
              ) : undefined,
            run: () => previewEntry(plan.id, e),
            runLive: () => showEntry(plan.id, e)
          })
        })
    }

    if (words.length) {
      Object.values(items)
        .filter((i): i is MediaItem => i.saved || i.source.type === 'web')
        .forEach((i) =>
          add(
            {
              id: `media-${i.id}`,
              group: 'Library',
              label: i.name,
              detail: itemSubtitle(i),
              icon: <MediaThumb item={i} className={s.thumb} />,
              run: () => previewMedia(i.id),
              runLive: () => showMedia(i.id)
            },
            `${i.name} ${i.tags.join(' ')} ${i.source.query ?? ''}`
          )
        )
      out.push({
        id: 'web-google',
        group: 'Search the web',
        label: `Search Google Images for “${q}”`,
        icon: <Globe size={15} />,
        score: 0,
        run: () => searchWeb('google', q)
      })
      out.push({
        id: 'web-wikimedia',
        group: 'Search the web',
        label: `Search Wikimedia Commons for “${q}”`,
        icon: <Landmark size={15} />,
        score: 0,
        run: () => searchWeb('wikimedia', q)
      })
    }

    const order = { Scripture: 0, Actions: 1, 'Service plan': 2, Library: 3, 'Search the web': 4 }
    const grouped = out.sort((a, b) => order[a.group] - order[b.group] || b.score - a.score)
    // Keep each group short.
    const counts: Record<string, number> = {}
    return grouped.filter(
      (c) => (counts[c.group] = (counts[c.group] ?? 0) + 1) <= (c.group === 'Library' ? 30 : 12)
    )
  }, [query, items, plan, settings])

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const run = (c: Command | undefined, live = false) => {
    if (!c) return
    close('palette')
    if (live && c.runLive) c.runLive()
    else c.run()
  }

  let lastGroup = ''
  return (
    <D.Root open onOpenChange={(o) => !o && close('palette')}>
      <D.Portal>
        <D.Overlay className={s.overlay} />
        <D.Content className={s.palette} aria-describedby={undefined}>
          <D.Title className="sr-only">Command palette</D.Title>
          <input
            className={s.input}
            autoFocus
            placeholder="Find plan items, media, actions or a Bible passage — or search the web…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => Math.min(commands.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(commands[index], e.metaKey || e.ctrlKey || e.shiftKey)
              }
            }}
          />
          <div className={s.list} ref={list}>
            {commands.length === 0 && <div className={s.empty}>No matches</div>}
            {commands.map((c, i) => {
              const header = c.group !== lastGroup ? (lastGroup = c.group) : null
              return (
                <div key={c.id}>
                  {header && <div className={s.group}>{header}</div>}
                  <button
                    data-index={i}
                    className={clsx(s.item, i === index && s.itemOn)}
                    onMouseMove={() => setIndex(i)}
                    onClick={(e) => run(c, e.metaKey || e.ctrlKey || e.shiftKey)}
                  >
                    <span className={s.icon}>{c.icon}</span>
                    <span className={s.label}>{c.label}</span>
                    {c.detail && <span className={s.detail}>{c.detail}</span>}
                    {c.hint && <kbd>{c.hint}</kbd>}
                  </button>
                </div>
              )
            })}
          </div>
          <div className={s.footer}>
            <span>
              <kbd>↵</kbd> preview / run
            </span>
            <span>
              <kbd>⇧↵</kbd> show now
            </span>
            <span>
              <kbd>esc</kbd> close
            </span>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

async function scripture(
  reference: string,
  translation: TranslationId,
  look: AppSettings['slides'],
  live: boolean
): Promise<void> {
  try {
    const { label, slides } = await lookUpScripture(reference, translation)
    await presentSlides(slides, label, look, live)
  } catch (err) {
    toast.error(cleanError(err))
  }
}

function searchWeb(provider: 'google' | 'wikimedia', query: string) {
  const ui = useUI.getState()
  ui.setSearch({ provider, query, submitted: query })
  ui.setTab('search')
  if (provider === 'google') window.dispatchEvent(new CustomEvent(GOOGLE_SEARCH_EVENT, { detail: query }))
}
