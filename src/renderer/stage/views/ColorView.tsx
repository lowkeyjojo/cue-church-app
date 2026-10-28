import { useEffect } from 'react'

export function ColorView({ color, onReady }: { color: string; onReady: () => void }) {
  useEffect(() => {
    onReady()
    // Ready as soon as it exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div className="stage-fill" style={{ background: color }} />
}
