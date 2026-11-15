import { useEffect, useState } from 'react'
import type { OutputIdentify } from '@shared/ipc'
import type { OutputConfig, ShowState } from '@shared/types'
import { Stage } from '../stage/Stage'

const bridge = window.cueOutput

/**
 * The audience window. It holds no state of its own: it renders whatever the
 * main process says is live, so a reload or crash recovers instantly.
 */
export function Output() {
  const [state, setState] = useState<ShowState | null>(null)
  const [config, setConfig] = useState<OutputConfig | null>(null)
  const [identify, setIdentify] = useState<OutputIdentify | null>(null)

  useEffect(() => {
    const offs = [bridge.onState(setState), bridge.onConfig(setConfig), bridge.onIdentify(setIdentify)]
    bridge.ready()
    return () => offs.forEach((off) => off())
  }, [])

  if (!state || !config) return <div style={{ position: 'fixed', inset: 0, background: '#000' }} />
  const volume = state.audio.muted ? 0 : state.audio.volume
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Stage
        role="output"
        presentation={state.live}
        transition={state.transition}
        blackout={state.blackout}
        ambient={state.ambient}
        background={config.background}
        inset={config.inset}
        credits={config.showCredits}
        volume={volume}
        sinkId={config.audioDeviceId}
        onPlayback={bridge.reportPlayback}
        testPattern={state.testPattern}
        testPatternName={`Cue · ${config.name}`}
        identify={identify}
      />
    </div>
  )
}
