import { createContext, useContext } from 'react'
import type { PlaybackStatus } from '@shared/types'

/**
 * - output:  the audience window — audible, authoritative playback
 * - live:    the operator's Live monitor — muted, mirrors the output's playback
 * - preview: the operator's Preview monitor — muted, still, quick transitions
 */
export type StageRole = 'output' | 'live' | 'preview'

export interface StageContextValue {
  role: StageRole
  /** Effective output volume (0..1) after master volume and mute. */
  volume: number
  sinkId: string
  playback: PlaybackStatus | null
  onPlayback?: (status: PlaybackStatus | null) => void
  transitionMs: number
}

export const StageContext = createContext<StageContextValue>({
  role: 'preview',
  volume: 0,
  sinkId: '',
  playback: null,
  transitionMs: 0
})

export const useStage = () => useContext(StageContext)
