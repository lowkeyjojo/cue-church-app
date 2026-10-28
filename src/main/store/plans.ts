import { newId } from '@shared/defaults'
import type { NewPlanEntry } from '@shared/ipc'
import type { Id, Plan, PlanEntry } from '@shared/types'
import { dataPath } from '../paths'
import { Emitter } from './emitter'
import { JsonStore } from './jsonStore'

interface PlansFile {
  version: 1
  plans: Plan[]
}

export class PlansStore extends Emitter<{ changed: Plan[] }> {
  private store = new JsonStore<PlansFile>(
    dataPath('plans.json'),
    () => ({ version: 1, plans: [] }),
    (raw) => ({ version: 1, plans: (raw as Partial<PlansFile>).plans ?? [] })
  )

  all(): Plan[] {
    return this.store.data.plans
  }

  get(id: Id | undefined): Plan | undefined {
    return id ? this.store.data.plans.find((p) => p.id === id) : undefined
  }

  entry(planId: Id, entryId: Id): PlanEntry | undefined {
    return this.get(planId)?.entries.find((e) => e.id === entryId)
  }

  create(name: string, date?: string, entries: PlanEntry[] = []): Plan {
    const now = Date.now()
    const plan: Plan = {
      id: newId(),
      name: name.trim() || 'Untitled service',
      date,
      entries,
      createdAt: now,
      updatedAt: now
    }
    this.store.data.plans.unshift(plan)
    this.changed()
    return plan
  }

  update(id: Id, patch: Partial<Pick<Plan, 'name' | 'date'>>): Plan | null {
    return this.mutate(id, (p) => {
      if (patch.name !== undefined) p.name = patch.name.trim() || p.name
      if ('date' in patch) p.date = patch.date || undefined
    })
  }

  remove(id: Id): void {
    this.store.data.plans = this.store.data.plans.filter((p) => p.id !== id)
    this.changed()
  }

  duplicate(id: Id): Plan | null {
    const src = this.get(id)
    if (!src) return null
    const copy = this.create(
      `${src.name} (copy)`,
      src.date,
      src.entries.map((e) => ({ ...structuredClone(e), id: newId() }))
    )
    return copy
  }

  addEntries(planId: Id, entries: NewPlanEntry[], index?: number): PlanEntry[] {
    const created = entries.map((e) => ({ ...e, id: newId() }) as PlanEntry)
    this.mutate(planId, (p) => {
      const at = index === undefined ? p.entries.length : Math.max(0, Math.min(index, p.entries.length))
      p.entries.splice(at, 0, ...created)
    })
    return created
  }

  updateEntry(planId: Id, entryId: Id, patch: Partial<Omit<PlanEntry, 'id'>>): void {
    this.mutate(planId, (p) => {
      const i = p.entries.findIndex((e) => e.id === entryId)
      if (i >= 0) p.entries[i] = { ...p.entries[i], ...patch, id: entryId }
    })
  }

  removeEntries(planId: Id, entryIds: Id[]): void {
    const ids = new Set(entryIds)
    this.mutate(planId, (p) => {
      p.entries = p.entries.filter((e) => !ids.has(e.id))
    })
  }

  /** Move entries (keeping their relative order) so the first lands at `toIndex` of the original list. */
  moveEntries(planId: Id, entryIds: Id[], toIndex: number): void {
    const ids = new Set(entryIds)
    this.mutate(planId, (p) => {
      const moving = p.entries.filter((e) => ids.has(e.id))
      if (!moving.length) return
      const before = p.entries.slice(0, toIndex).filter((e) => !ids.has(e.id)).length
      const rest = p.entries.filter((e) => !ids.has(e.id))
      rest.splice(before, 0, ...moving)
      p.entries = rest
    })
  }

  /** Every media id referenced by any plan (entries and ambient playlists). */
  referencedMedia(): Set<Id> {
    const ids = new Set<Id>()
    for (const plan of this.store.data.plans) {
      for (const e of plan.entries) {
        if (e.mediaId) ids.add(e.mediaId)
        for (const m of e.ambient?.mediaIds ?? []) ids.add(m)
      }
    }
    return ids
  }

  /** Drop entries pointing at deleted media. */
  removeMedia(mediaIds: Id[]): void {
    const gone = new Set(mediaIds)
    let touched = false
    for (const plan of this.store.data.plans) {
      const before = plan.entries.length
      plan.entries = plan.entries.filter((e) => !(e.mediaId && gone.has(e.mediaId)))
      for (const e of plan.entries) {
        if (e.ambient?.mediaIds.some((m) => gone.has(m))) {
          e.ambient = { ...e.ambient, mediaIds: e.ambient.mediaIds.filter((m) => !gone.has(m)) }
          touched = true
        }
      }
      if (plan.entries.length !== before) {
        plan.updatedAt = Date.now()
        touched = true
      }
    }
    if (touched) this.changed()
  }

  flush(): void {
    this.store.flush()
  }

  private mutate(id: Id, fn: (plan: Plan) => void): Plan | null {
    const plan = this.get(id)
    if (!plan) return null
    fn(plan)
    plan.updatedAt = Date.now()
    this.changed()
    return plan
  }

  private changed(): void {
    this.store.save()
    this.emit('changed', this.store.data.plans)
  }
}
