import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { fontFamily } from '@shared/defaults'
import type { Deck, Id, Slide, SlideBackground, SlideTheme } from '@shared/types'
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
  onReady?: () => void
}

/**
 * Renders one slide. The background fills the whole screen; the text is laid
 * out on a fixed 1920×1080 canvas and scaled, so wrapping is identical on the
 * audience screen, the monitors and thumbnails.
 */
export function SlideView({ deck, index, media, width, height, role, onReady }: Props) {
  const slide = deck.slides[Math.max(0, Math.min(index, deck.slides.length - 1))]
  const readyRef = useRef(onReady)
  readyRef.current = onReady

  useEffect(() => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      readyRef.current?.()
    }
    void document.fonts.ready.then(finish)
    const t = setTimeout(finish, 1200)
    return () => clearTimeout(t)
  }, [])

  if (!slide) return null
  const theme: SlideTheme = { ...deck.theme, ...slide.theme }
  const background = slide.background ?? deck.background
  const scale = Math.min(width / SLIDE_W, height / SLIDE_H) || 0
  return (
    <div className="stage-fill slide-root">
      <SlideBackgroundView background={background} media={media} role={role} scale={scale} />
      <div
        className="slide-canvas"
        style={{ transform: `translate(-50%, -50%) scale(${scale})`, width: SLIDE_W, height: SLIDE_H }}
      >
        <SlideContent slide={slide} theme={theme} />
      </div>
    </div>
  )
}

export function SlideBackgroundView({
  background,
  media,
  role,
  scale
}: {
  background: SlideBackground
  media: MediaMap
  role: StageRole
  scale: number
}) {
  const dim = background.dim ?? 0
  const blur = (background.blur ?? 0) * scale
  let layer: ReactNode
  if (background.type === 'color') {
    layer = <div className="stage-fill" style={{ background: background.color ?? '#000' }} />
  } else if (background.type === 'gradient') {
    const g = background.gradient ?? { from: '#1b1c21', to: '#0b0c0e', angle: 160 }
    layer = (
      <div
        className="stage-fill"
        style={{ background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }}
      />
    )
  } else if (background.type === 'media' && background.mediaId && media?.[background.mediaId]) {
    const m = media[background.mediaId]
    const style: CSSProperties = blur ? { filter: `blur(${blur}px)`, transform: 'scale(1.06)' } : {}
    layer =
      m.kind === 'video' ? (
        <BackgroundVideo src={m.src} style={style} playing={role !== 'preview'} />
      ) : (
        <img className="stage-media fit-fill" src={m.src} alt="" style={style} draggable={false} />
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

function BackgroundVideo({ src, style, playing }: { src: string; style: CSSProperties; playing: boolean }) {
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
