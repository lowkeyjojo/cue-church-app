/** Minimal typed event emitter for store change notifications. */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<(payload: never) => void>>()

  on<E extends keyof Events>(event: E, fn: (payload: Events[E]) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) this.listeners.set(event, (set = new Set()))
    set.add(fn as (payload: never) => void)
    return () => set!.delete(fn as (payload: never) => void)
  }

  emit<E extends keyof Events>(event: E, payload: Events[E]): void {
    for (const fn of this.listeners.get(event) ?? []) (fn as (p: Events[E]) => void)(payload)
  }
}
