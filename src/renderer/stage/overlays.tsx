import type { OutputIdentify } from '@shared/ipc'
import type { Size } from './useElementSize'

/** Calibration card: grid, safe areas, color bars and the live resolution. */
export function TestPattern({ size, name }: { size: Size; name: string }) {
  const W = 1920
  const H = 1080
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1
  const res = `${Math.round(size.width * dpr)} × ${Math.round(size.height * dpr)}`
  const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0']
  const lines = []
  for (let x = 120; x < W; x += 120) lines.push(<line key={`x${x}`} x1={x} y1={0} x2={x} y2={H} />)
  for (let y = 120; y < H; y += 120) lines.push(<line key={`y${y}`} x1={0} y1={y} x2={W} y2={y} />)
  return (
    <svg className="stage-fill test-pattern" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <rect width={W} height={H} fill="#141414" />
      <g stroke="#2e2e2e" strokeWidth={2}>
        {lines}
      </g>
      <rect
        x={W * 0.035}
        y={H * 0.035}
        width={W * 0.93}
        height={H * 0.93}
        fill="none"
        stroke="#d6b86c"
        strokeWidth={3}
        strokeDasharray="18 10"
      />
      <rect
        x={W * 0.05}
        y={H * 0.05}
        width={W * 0.9}
        height={H * 0.9}
        fill="none"
        stroke="#e5484d"
        strokeWidth={2}
        strokeDasharray="6 8"
      />
      <rect x={2} y={2} width={W - 4} height={H - 4} fill="none" stroke="#fff" strokeWidth={4} />
      <circle cx={W / 2} cy={H / 2} r={H * 0.42} fill="none" stroke="#5a5a5a" strokeWidth={3} />
      <line x1={W / 2 - 60} y1={H / 2} x2={W / 2 + 60} y2={H / 2} stroke="#fff" strokeWidth={3} />
      <line x1={W / 2} y1={H / 2 - 60} x2={W / 2} y2={H / 2 + 60} stroke="#fff" strokeWidth={3} />
      {bars.map((c, i) => (
        <rect
          key={c}
          x={W * 0.2 + i * ((W * 0.6) / bars.length)}
          y={H * 0.66}
          width={(W * 0.6) / bars.length}
          height={H * 0.12}
          fill={c}
        />
      ))}
      {Array.from({ length: 11 }).map((_, i) => {
        const v = Math.round((i / 10) * 255)
        return (
          <rect
            key={i}
            x={W * 0.2 + i * ((W * 0.6) / 11)}
            y={H * 0.78}
            width={(W * 0.6) / 11}
            height={H * 0.06}
            fill={`rgb(${v},${v},${v})`}
          />
        )
      })}
      <text
        x={W / 2}
        y={H * 0.3}
        fill="#fff"
        fontSize={64}
        fontWeight={700}
        textAnchor="middle"
        fontFamily="Inter Variable, sans-serif"
      >
        {name}
      </text>
      <text
        x={W / 2}
        y={H * 0.3 + 62}
        fill="#a4a6ae"
        fontSize={36}
        textAnchor="middle"
        fontFamily="Inter Variable, sans-serif"
      >
        {res} · gold = 93% action safe · red = 90% title safe
      </text>
    </svg>
  )
}

export function IdentifyOverlay({ info }: { info: OutputIdentify }) {
  return (
    <div className="stage-identify">
      <div className="stage-identify-card">
        <div className="stage-identify-num">{info.index}</div>
        <div className="stage-identify-label">{info.label}</div>
        <div className="stage-identify-detail">{info.detail}</div>
      </div>
    </div>
  )
}

export function CreditOverlay({ text }: { text: string }) {
  return <div className="stage-credit">{text}</div>
}
