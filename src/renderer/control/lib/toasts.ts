import { create } from 'zustand'
import { newId } from '@shared/defaults'
import type { Toast } from '@shared/types'

export interface ToastEntry extends Toast {
  id: string
  createdAt: number
}

interface ToastState {
  toasts: ToastEntry[]
  push(t: Toast): void
  dismiss(id: string): void
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(t) {
    const id = t.id ?? newId()
    const entry: ToastEntry = { ...t, id, createdAt: Date.now() }
    // A toast with a known id replaces the previous one (e.g. repeated "end of slides").
    set({ toasts: [...get().toasts.filter((x) => x.id !== id), entry].slice(-4) })
    const ms = t.duration ?? (t.kind === 'error' ? 7000 : 3800)
    clearTimeout(timers.get(id))
    if (ms > 0)
      timers.set(
        id,
        setTimeout(() => get().dismiss(id), ms)
      )
  },
  dismiss(id) {
    clearTimeout(timers.get(id))
    timers.delete(id)
    set({ toasts: get().toasts.filter((x) => x.id !== id) })
  }
}))

export const toast = {
  info: (title: string, message?: string) => useToasts.getState().push({ kind: 'info', title, message }),
  success: (title: string, message?: string) =>
    useToasts.getState().push({ kind: 'success', title, message }),
  warning: (title: string, message?: string) =>
    useToasts.getState().push({ kind: 'warning', title, message }),
  error: (title: string, message?: string) => useToasts.getState().push({ kind: 'error', title, message }),
  show: (t: Toast) => useToasts.getState().push(t)
}
