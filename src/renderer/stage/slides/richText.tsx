import { Fragment, type ReactNode } from 'react'

/**
 * Minimal, forgiving formatting for slide text:
 *   **bold**, *italic*, line breaks, and "- " / "• " bullet lines.
 */
export function RichText({ text, bulletClass }: { text: string; bulletClass?: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => {
    if (!bullets.length) return
    blocks.push(
      <ul key={`ul${blocks.length}`} className="slide-bullets">
        {bullets.map((b, i) => (
          <li key={i}>
            <span className={bulletClass ?? 'slide-bullet'} />
            <span>{inline(b)}</span>
          </li>
        ))}
      </ul>
    )
    bullets = []
  }
  lines.forEach((line, i) => {
    const m = /^\s*(?:[-•*]|\d+[.)])\s+(.*)$/.exec(line)
    if (m && !/^\s*\*\*/.test(line)) {
      bullets.push(m[1])
      return
    }
    flush()
    blocks.push(
      <span key={`l${i}`} className="slide-line">
        {line.trim() ? inline(line) : ' '}
      </span>
    )
  })
  flush()
  return <>{blocks}</>
}

function inline(text: string): ReactNode {
  const parts: ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[2]) parts.push(<strong key={m.index}>{m[2]}</strong>)
    else parts.push(<em key={m.index}>{m[3] ?? m[4]}</em>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)
}
