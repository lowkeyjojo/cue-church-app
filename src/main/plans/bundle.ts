import { createReadStream, createWriteStream, existsSync, mkdirSync, type ReadStream } from 'node:fs'
import { cp, mkdir, readdir, readFile, rename, rm, statfs } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
// The browser build: fflate's Node build declares a top-level `require` that clashes with
// electron-vite's ESM shim. The synchronous streaming classes used here work the same.
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate/browser'
import { newId } from '@shared/defaults'
import type { Deck, Id, MediaItem, MediaKind, Plan, PlanEntry } from '@shared/types'
import { UserError } from '../errors'
import { log } from '../log'
import { dataPath } from '../paths'
import type { LibraryStore } from '../store/library'
import type { PlansStore } from '../store/plans'

interface BundleManifest {
  format: 'cue-plan'
  version: 1
  exportedAt: string
  plan: Plan
  items: MediaItem[]
}

/** Every library item a plan needs, including slide background media. */
export function planMedia(plan: Plan, library: LibraryStore): MediaItem[] {
  const ids = new Set<Id>()
  const visit = (id: Id | undefined) => {
    if (!id || ids.has(id)) return
    const item = library.get(id)
    if (!item) return
    ids.add(id)
    if (item.deck) for (const m of deckMediaIds(item.deck)) visit(m)
  }
  for (const e of plan.entries) {
    visit(e.mediaId)
    for (const m of e.ambient?.mediaIds ?? []) visit(m)
  }
  return [...ids].map((id) => library.get(id)!).filter(Boolean)
}

function deckMediaIds(deck: Deck): Id[] {
  const out: Id[] = []
  if (deck.background.mediaId) out.push(deck.background.mediaId)
  for (const s of deck.slides) if (s.background?.mediaId) out.push(s.background.mediaId)
  return out
}

/** Write a plan and all of its media into a single portable .cueplan file. */
export async function exportPlan(plan: Plan, library: LibraryStore, dest: string): Promise<void> {
  const items = planMedia(plan, library)
  const out = createWriteStream(dest)
  const done = new Promise<void>((resolve, reject) => {
    out.on('finish', resolve)
    out.on('error', reject)
  })
  // Never leave an unhandled rejection behind if we bail out early.
  done.catch(() => undefined)
  try {
    const zip = new Zip((err, chunk, final) => {
      if (err) return void out.destroy(err)
      out.write(chunk)
      if (final) out.end()
    })
    const manifest: BundleManifest = {
      format: 'cue-plan',
      version: 1,
      exportedAt: new Date().toISOString(),
      plan,
      items
    }
    const json = new ZipDeflate('plan.json', { level: 6 })
    zip.add(json)
    json.push(strToU8(JSON.stringify(manifest, null, 2)), true)

    for (const item of items) {
      // Slide decks live entirely in the library file and have no folder.
      const dir = library.itemDir(item.id)
      for (const file of await walk(dir)) {
        const name = `media/${item.id}/${relative(dir, file).split(sep).join('/')}`
        // Media is already compressed; store it as-is.
        const entry = new ZipPassThrough(name)
        zip.add(entry)
        await new Promise<void>((resolve, reject) => {
          const stream = createReadStream(file)
          stream.on('data', (chunk) => {
            entry.push(chunk as Buffer)
            waitForDrain(out, stream)
          })
          stream.on('end', () => {
            entry.push(new Uint8Array(0), true)
            resolve()
          })
          stream.on('error', reject)
        })
      }
    }
    zip.end()
    await done
  } catch (err) {
    out.destroy()
    await rm(dest, { force: true })
    log.error('Plan export failed:', err)
    throw new UserError(`Couldn't export the plan: ${(err as Error).message}`)
  }
}

/** Pause reading while the file being written catches up, so big videos never pile up in memory. */
function waitForDrain(out: NodeJS.WritableStream & { writableNeedDrain: boolean }, source: ReadStream): void {
  if (!out.writableNeedDrain || source.isPaused()) return
  source.pause()
  out.once('drain', () => source.resume())
}

const ITEM_ID = /^[0-9a-z]{1,40}$/
const KINDS: MediaKind[] = ['image', 'video', 'audio', 'pdf', 'deck']
const plainName = (name: unknown) =>
  name === undefined || (typeof name === 'string' && /^[^/\\]+$/.test(name) && name !== '.' && name !== '..')

/** Only accept items whose id and file names can't point outside their own folder. */
function isSafeItem(item: MediaItem): boolean {
  return (
    !!item &&
    typeof item.id === 'string' &&
    ITEM_ID.test(item.id) &&
    KINDS.includes(item.kind) &&
    plainName(item.file) &&
    plainName(item.thumb)
  )
}

/**
 * Import a .cueplan file: media is merged into the library (duplicates reused),
 * then the plan is added. `onAdded` receives the new items, e.g. to finish
 * processing any that were still being prepared when the plan was exported.
 */
export async function importPlanBundle(
  file: string,
  library: LibraryStore,
  plans: PlansStore,
  onAdded?: (items: MediaItem[]) => void
): Promise<Plan> {
  const temp = dataPath(`import-${newId()}`)
  const moved: string[] = []
  await mkdir(temp, { recursive: true })
  try {
    await extract(file, temp)
    let manifest: BundleManifest
    try {
      manifest = JSON.parse(await readFile(join(temp, 'plan.json'), 'utf8')) as BundleManifest
    } catch {
      throw new UserError("This file isn't a Cue service plan")
    }
    if (manifest?.format !== 'cue-plan' || !manifest.plan || !Array.isArray(manifest.plan.entries))
      throw new UserError("This file isn't a Cue service plan")
    const items = (Array.isArray(manifest.items) ? manifest.items : []).filter(isSafeItem)

    const idMap = new Map<Id, Id>()
    for (const item of items) {
      const existing = item.hash ? library.byHash(item.hash) : undefined
      if (existing) {
        idMap.set(item.id, existing.id)
        if (!existing.saved) library.update(existing.id, { saved: true })
        continue
      }
      const id = newId()
      idMap.set(item.id, id)
      const from = join(temp, 'media', item.id)
      if (!existsSync(from)) continue
      const to = library.itemDir(id)
      await mkdir(dirname(to), { recursive: true })
      try {
        await rename(from, to)
      } catch {
        await cp(from, to, { recursive: true })
      }
      moved.push(to)
    }
    // Add items after all ids are known, so slide backgrounds can be remapped.
    const added: MediaItem[] = []
    for (const item of items) {
      const id = idMap.get(item.id)!
      if (library.get(id)) continue
      const copy: MediaItem = {
        ...item,
        id,
        deck: item.deck ? remapDeck(item.deck, idMap) : undefined,
        collections: [],
        saved: true,
        updatedAt: Date.now()
      }
      library.add(copy)
      added.push(copy)
    }
    moved.length = 0
    const entries: PlanEntry[] = manifest.plan.entries.map((e) => ({
      ...e,
      id: newId(),
      mediaId: e.mediaId ? (idMap.get(e.mediaId) ?? e.mediaId) : undefined,
      ambient: e.ambient
        ? { ...e.ambient, mediaIds: (e.ambient.mediaIds ?? []).map((m) => idMap.get(m) ?? m) }
        : undefined
    }))
    const plan = plans.create(String(manifest.plan.name || 'Imported plan'), manifest.plan.date, entries)
    onAdded?.(added)
    return plan
  } catch (err) {
    // Don't leave half an import behind in the library folder.
    for (const dir of moved) await rm(dir, { recursive: true, force: true })
    if (err instanceof UserError) throw err
    log.error('Plan import failed:', err)
    throw new UserError(`Couldn't import that plan: ${(err as Error).message}`)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

function remapDeck(deck: Deck, idMap: Map<Id, Id>): Deck {
  const map = (id: Id | undefined) => (id ? (idMap.get(id) ?? id) : undefined)
  return {
    ...deck,
    background: { ...deck.background, mediaId: map(deck.background.mediaId) },
    slides: deck.slides.map((s) =>
      s.background ? { ...s, background: { ...s.background, mediaId: map(s.background.mediaId) } } : s
    )
  }
}

async function walk(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(p)))
    else if (entry.isFile()) out.push(p)
  }
  return out
}

const GB = 1024 ** 3

async function extract(file: string, dest: string): Promise<void> {
  // Leave room on the disk: a damaged or malicious file can't fill it up.
  const { bavail, bsize } = await statfs(dest)
  const limit = Math.max(0, bavail * bsize - GB)
  let written = 0
  const writes: Promise<void>[] = []
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file)
    const fail = (err: unknown) => {
      stream.destroy()
      reject(err)
    }
    const unzip = new Unzip((entry) => {
      const target = join(dest, ...entry.name.split('/'))
      if (!target.startsWith(dest + sep) || entry.name.endsWith('/')) return
      // Stream each entry straight to disk so large videos never sit in memory.
      mkdirSync(dirname(target), { recursive: true })
      const out = createWriteStream(target)
      writes.push(
        new Promise<void>((res, rej) => {
          out.on('finish', res)
          out.on('error', rej)
        })
      )
      entry.ondata = (err, data, final) => {
        if (err) {
          out.destroy(err)
          return fail(err)
        }
        written += data.length
        if (written > limit) {
          out.destroy()
          return fail(new UserError('There isn’t enough free disk space to import this plan'))
        }
        out.write(data)
        waitForDrain(out, stream)
        if (final) out.end()
      }
      entry.start()
    })
    unzip.register(UnzipInflate)
    stream.on('data', (chunk) => {
      try {
        unzip.push(chunk as Buffer)
      } catch (err) {
        fail(err)
      }
    })
    stream.on('end', () => {
      try {
        unzip.push(new Uint8Array(0), true)
        resolve()
      } catch (err) {
        reject(err)
      }
    })
    stream.on('error', reject)
  })
  await Promise.all(writes)
}
