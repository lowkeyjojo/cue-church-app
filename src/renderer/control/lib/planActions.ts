import type { Id, MediaItem, Plan, PlanEntry, Presentation } from '@shared/types'
import { todayIso } from '@shared/util'
import { attempt, call, dispatch } from './api'
import { useApp } from './store'
import { toast } from './toasts'
import { useUI } from './ui'

export function currentPlan(): Plan | undefined {
  const { planId } = useUI.getState()
  const plans = useApp.getState().plans
  return plans.find((p) => p.id === planId) ?? plans[0]
}

export function useCurrentPlan(): Plan | undefined {
  const planId = useUI((s) => s.planId)
  return useApp((s) => s.plans.find((p) => p.id === planId) ?? s.plans[0])
}

export function presentable(plan: Plan | undefined): PlanEntry[] {
  return plan ? plan.entries.filter((e) => e.type !== 'section') : []
}

export function selectPlan(planId: Id | null): void {
  useUI.getState().setPlan(planId)
  if (planId) void attempt('settings:update', { ui: { planId } })
}

/** Paged content (PDFs, slides) is easiest to run from the Show tab's page grid. */
function wantsShowTab(entry: PlanEntry): boolean {
  if (entry.type !== 'media') return entry.type === 'ambient'
  const kind = useApp.getState().items[entry.mediaId ?? '']?.kind
  return kind === 'pdf' || kind === 'deck'
}

export function previewEntry(planId: Id, entry: PlanEntry, page?: number): void {
  if (entry.type === 'section') return
  dispatch({ type: 'preview', target: { type: 'entry', planId, entryId: entry.id, page } })
  useUI.getState().setFocus({ type: 'entry', planId, entryId: entry.id }, { showTab: wantsShowTab(entry) })
}

export function showEntry(planId: Id, entry: PlanEntry, page?: number): void {
  if (entry.type === 'section') return
  dispatch({ type: 'show', target: { type: 'entry', planId, entryId: entry.id, page } })
  useUI.getState().setFocus({ type: 'entry', planId, entryId: entry.id })
}

export function previewPlanIndex(index: number): void {
  const plan = currentPlan()
  const entry = presentable(plan)[index]
  if (plan && entry) previewEntry(plan.id, entry)
}

export function previewMedia(mediaId: Id, page?: number): void {
  dispatch({ type: 'preview', target: { type: 'media', mediaId, page } })
  useUI.getState().setFocus({ type: 'media', mediaId })
}

export function showMedia(mediaId: Id, page?: number): void {
  dispatch({ type: 'show', target: { type: 'media', mediaId, page } })
  useUI.getState().setFocus({ type: 'media', mediaId })
}

export function previewPresentation(p: Presentation): void {
  dispatch({ type: 'preview', target: { type: 'presentation', presentation: p } })
}

export function showPresentation(p: Presentation): void {
  dispatch({ type: 'show', target: { type: 'presentation', presentation: p } })
}

export async function ensurePlan(): Promise<Plan | undefined> {
  const plan = currentPlan()
  if (plan) return plan
  const created = await attempt('plans:create', 'Sunday Service', todayIso())
  if (created) selectPlan(created.id)
  return created
}

export async function newPlan(): Promise<Plan | undefined> {
  const created = await attempt('plans:create', 'New service', todayIso())
  if (created) {
    selectPlan(created.id)
    useUI.getState().setTab('show')
  }
  return created
}

export async function addMediaToPlan(mediaIds: Id[], index?: number): Promise<void> {
  if (!mediaIds.length) return
  const plan = await ensurePlan()
  if (!plan) return
  const added = await attempt(
    'plans:addEntries',
    plan.id,
    mediaIds.map((mediaId) => ({ type: 'media' as const, mediaId })),
    index
  )
  if (added?.length) {
    const items = useApp.getState().items
    const name = added.length === 1 ? (items[mediaIds[0]]?.name ?? 'Item') : `${added.length} items`
    toast.show({
      id: 'added-to-plan',
      kind: 'success',
      title: `Added to “${plan.name}”`,
      message: name,
      duration: 2200
    })
  }
}

export async function importMedia(): Promise<MediaItem[]> {
  const result = await attempt('library:import')
  const items = result?.items ?? []
  if (items.length) {
    toast.success(items.length === 1 ? `Imported “${items[0].name}”` : `Imported ${items.length} items`)
    useUI.getState().setLibrary({ view: 'all', collection: null, query: '' })
    useUI.getState().setTab('library')
  }
  return items
}

export async function importPaths(
  paths: string[],
  opts: { preview?: boolean; addToPlanAt?: number } = {}
): Promise<MediaItem[]> {
  if (!paths.length) return []
  try {
    const result = await call('library:import', paths)
    const items = result.items
    if (!items.length) return []
    if (opts.preview) previewMedia(items[0].id)
    if (opts.addToPlanAt !== undefined)
      await addMediaToPlan(
        items.map((i) => i.id),
        opts.addToPlanAt
      )
    else if (!opts.preview)
      toast.success(items.length === 1 ? `Imported “${items[0].name}”` : `Imported ${items.length} items`)
    return items
  } catch (err) {
    toast.error("Couldn't import", err instanceof Error ? err.message : String(err))
    return []
  }
}
