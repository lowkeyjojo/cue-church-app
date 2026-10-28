import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import { fontFamily } from '@shared/defaults'
import type { Deck, Id, Slide, SlideBackground, SlideTheme, TransitionSettings } from '@shared/types'
import { afterPaint } from '../afterPaint'
import type { StageRole } from '../context'
import { RichText } from './richText'
import { useAutoFit } from './useAutoFit'

export const SLIDE_W = 1920
export const SLIDE_H = 1080

type MediaMap = Record<Id, { kind: 'image' | 'video'; src: string }> | undefined

interface Props {
  deck: Deck
  index: number
  media: MediaMap
  width: number
  height: number
  role: StageRole
  /** How the words change from slide to slide (live screens). Without it they switch at once. */
  transition?: TransitionSettings
  onReady?: () => void
}

/** The background a slide is shown on: its own, or the deck's. */
export function slideBackground(deck: Deck, index: number): SlideBackground {
  const slide = deck.slides[Math.max(0, Math.min(index, deck.slides.length - 1))]
  return slide?.background ?? deck.background
}

/**
 * Renders one slide. The background fills the whole screen; the text is laid
 * out on a fixed 1920×1080 canvas and scaled, so wrapping is identical on the
 * audience screen, the monitors and thumbnails. Moving to a slide with the same
 * background only changes the words, so a moving background plays on.
 */
export function SlideView({ deck, index, media, width, height, role, transition, onReady }: Props) {
  const at = Math.max(0, Math.min(index, deck.slides.length - 1))
  const layers = useTextLayers(at, transition)
  const readyRef = useRef(onReady)
  readyRef.current = onReady
  const [fontsReady, setFontsReady] = useState(false)
  const [backgroundReady, setBackgroundReady] = useState(false)
  const onBackgroundReady = useCallback(() => setBackgroundReady(true), [])

  useEffect(() => {
    let live = true
    const finish = () => live && setFontsReady(true)
    void document.fonts.ready.then(finish)
    const t = setTimeout(finish, 1200)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [])

  // Ready once the words can be set in the right font and the background can be seen.
  const reported = useRef(false)
  useEffect(() => {
    if (!fontsReady || !backgroundReady || reported.current) return
    reported.current = true
    readyRef.current?.()
  }, [fontsReady, backgroundReady])

  const slide = deck.slides[at]
  if (!slide) return null
  const scale = Math.min(width / SLIDE_W, height / SLIDE_H) || 0
  return (
    <div className="stage-fill slide-root">
      <SlideBackgroundView
        background={slideBackground(deck, at)}
        media={media}
        role={role}
        scale={scale}
        onReady={onBackgroundReady}
      />
      {layers.map((layer) => {
        const s = deck.slides[layer.index] ?? slide
        return (
          <div
            key={layer.n}
            className="slide-canvas"
            style={{
              transform: `translate(-50%, -50%) scale(${scale})`,
              width: SLIDE_W,
              height: SLIDE_H,
              ...textFade(layer.phase, transition)
            }}
          >
            <SlideContent slide={s} theme={{ ...deck.theme, ...s.theme }} />
          </div>
        )
      })}
    </div>
  )
}

type TextPhase = 'enter' | 'in' | 'out'

interface TextLayer {
  index: number
  /** Unique per change, so a slide that comes straight back never reuses its fading copy. */
  n: number
  phase: TextPhase
}

const transitionMs = (t: TransitionSettings | undefined) => (!t || t.kind === 'cut' ? 0 : t.duration)

/** The words on screen: the current slide's, plus the previous slide's while they fade out. */
function useTextLayers(index: number, transition: TransitionSettings | undefined): TextLayer[] {
  const [layers, setLayers] = useState<TextLayer[]>(() => [{ index, n: 0, phase: 'in' }])
  const count = useRef(0)
  const ms = transitionMs(transition)

  useLayoutEffect(() => {
    setLayers((prev) => {
      if (prev[prev.length - 1].index === index) return prev
      const n = ++count.current
      if (!ms) return [{ index, n, phase: 'in' }]
      return [...prev.map((l) => ({ ...l, phase: 'out' as const })), { index, n, phase: 'enter' as const }]
    })
  }, [index, ms])

  useEffect(() => {
    if (layers.some((l) => l.phase === 'enter')) {
      // Start the fade once the new words have been drawn invisibly.
      return afterPaint(() =>
        setLayers((prev) => prev.map((l) => (l.phase === 'enter' ? { ...l, phase: 'in' } : l)))
      )
    }
    if (layers.some((l) => l.phase === 'out')) {
      const t = setTimeout(() => setLayers((prev) => prev.filter((l) => l.phase !== 'out')), ms + 50)
      return () => clearTimeout(t)
    }
  }, [layers, ms])

  return layers
}

const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

/** A crossfade of the words; a dip takes them out before the new ones come in. */
function textFade(phase: TextPhase, transition: TransitionSettings | undefined): CSSProperties {
  const d = transitionMs(transition)
  if (phase === 'enter') return { opacity: 0 }
  if (!d) return phase === 'out' ? { opacity: 0 } : {}
  const dip = transition?.kind === 'dip'
  if (phase === 'out') return { opacity: 0, transition: `opacity ${dip ? d / 2 : d}ms ${EASE}` }
  return { opacity: 1, transition: `opacity ${dip ? d / 2 : d}ms ${EASE} ${dip ? d / 2 : 0}ms` }
}

export function SlideBackgroundView({
  background,
  media,
  role,
  scale,
  onReady
}: {
  background: SlideBackground
  media: MediaMap
  role: StageRole
  scale: number
  /** Called once the background can be seen (a picture decoded, a video's first frame). */
  onReady?: () => void
}) {
  const readyRef = useRef(onReady)
  readyRef.current = onReady
  const ready = useCallback(() => readyRef.current?.(), [])
  const m = background.type === 'media' && background.mediaId ? media?.[background.mediaId] : undefined
  useEffect(() => {
    if (!m) ready()
  }, [m, ready])

  const dim = background.dim ?? 0
  const blur = (background.blur ?? 0) * scale
  let layer: ReactNode
  if (m) {
    const style: CSSProperties = blur ? { filter: `blur(${blur}px)`, transform: 'scale(1.06)' } : {}
    layer =
      m.kind === 'video' ? (
        <BackgroundVideo src={m.src} style={style} playing={role !== 'preview'} onReady={ready} />
      ) : (
        <BackgroundImage src={m.src} style={style} onReady={ready} />
      )
  } else if (background.type === 'color') {
    layer = <div className="stage-fill" style={{ background: background.color ?? '#000' }} />
  } else if (background.type === 'gradient') {
    const g = background.gradient ?? { from: '#1b1c21', to: '#0b0c0e', angle: 160 }
    layer = (
      <div
        className="stage-fill"
        style={{ background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }}
      />
    )
  } else {
    layer = <div className="stage-fill" style={{ background: '#000' }} />
  }
  return (
    <div className="stage-fill">
      {layer}
      {dim > 0 && <div className="stage-fill" style={{ background: `rgba(0,0,0,${dim})` }} />}
    </div>
  )
}

function BackgroundImage({
  src,
  style,
  onReady
}: {
  src: string
  style: CSSProperties
  onReady: () => void
}) {
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    let live = true
    const done = () => live && onReady()
    ref.current?.decode().then(done, done)
    return () => {
      live = false
    }
  }, [src, onReady])
  return <img ref={ref} className="stage-media fit-fill" src={src} alt="" style={style} draggable={false} />
}

function BackgroundVideo({
  src,
  style,
  playing,
  onReady
}: {
  src: string
  style: CSSProperties
  playing: boolean
  onReady: () => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (playing) void v.play().catch(() => undefined)
    else v.pause()
  }, [playing])
  return (
    <video
      ref={ref}
      className="stage-media fit-fill"
      src={src}
      style={style}
      muted
      loop
      playsInline
      preload="auto"
      onLoadedData={onReady}
      onError={onReady}
    />
  )
}

export function SlideContent({ slide, theme }: { slide: Slide; theme: SlideTheme }) {
  const box = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useAutoFit(box, content, [
    slide.layout,
    slide.title,
    slide.body,
    slide.footer,
    theme.font,
    theme.titleFont,
    theme.scale,
    theme.uppercaseTitle
  ])

  const vars = {
    '--s': theme.scale,
    '--text': theme.textColor,
    '--accent': theme.accentColor,
    '--font': fontFamily(theme.font),
    '--title-font': fontFamily(theme.titleFont),
    '--align': theme.align,
    '--justify': theme.vAlign === 'top' ? 'flex-start' : theme.vAlign === 'bottom' ? 'flex-end' : 'center',
    '--items': theme.align === 'left' ? 'flex-start' : theme.align === 'right' ? 'flex-end' : 'center'
  } as CSSProperties

  const title = slide.title?.trim()
  const body = slide.body?.trim()
  const footer = slide.footer?.trim()
  const titleText = title && theme.uppercaseTitle ? title.toUpperCase() : title

  return (
    <div className={`slide layout-${slide.layout}${theme.shadow ? ' slide-shadow' : ''}`} style={vars}>
      <div ref={box} className="slide-box">
        <div ref={content} className="slide-content">
          {slide.layout === 'scripture' ? (
            <>
              {body && (
                <div className="slide-verse">
                  <span className="slide-quote" aria-hidden>
                    “
                  </span>
                  <RichText text={body} />
                </div>
              )}
              {(footer || title) && <div className="slide-reference">{footer || title}</div>}
            </>
          ) : slide.layout === 'big' ? (
            <div className="slide-big">{titleText || body}</div>
          ) : (
            <>
              {titleText && <div className="slide-title">{titleText}</div>}
              {titleText && body && slide.layout === 'title' && <div className="slide-rule" />}
              {body && (
                <div className="slide-body">
                  <RichText text={body} />
                </div>
              )}
              {footer && <div className="slide-footer">{footer}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
