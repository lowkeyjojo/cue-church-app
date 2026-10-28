import { createReadStream, createWriteStream, mkdirSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
// The browser build: fflate's Node build declares a top-level `require` that clashes with
// electron-vite's ESM shim. The synchronous streaming classes used here work the same.
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate/browser'
import { newId } from '@shared/defaults'
import type { Deck, Id, MediaItem, Plan, PlanEntry } from '@shared/types'
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
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      out.destroy(err)
      return
    }
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
    const dir = library.itemDir(item.id)
    for (const file of await walk(dir)) {
      const name = `media/${item.id}/${relative(dir, file).split(sep).join('/')}`
      // Media is already compressed; store it as-is.
      const entry = new ZipPassThrough(name)
      zip.add(entry)
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(file)
        stream.on('data', (chunk) => entry.push(chunk as Buffer))
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
}

/** Import a .cueplan file: media is merged into the library (duplicates reused), then the plan is added. */
export async function importPlanBundle(
  file: string,
  library: LibraryStore,
  plans: PlansStore
): Promise<Plan> {
  const temp = dataPath(`import-${newId()}`)
  await mkdir(temp, { recursive: true })
  try {
    await extract(file, temp)
    const manifest = JSON.parse(await readFile(join(temp, 'plan.json'), 'utf8')) as BundleManifest
    if (manifest.format !== 'cue-plan' || !manifest.plan)
      throw new Error("This file isn't a Cue service plan")

    const idMap = new Map<Id, Id>()
    for (const item of manifest.items) {
      const existing = item.hash ? library.byHash(item.hash) : undefined
      if (existing) {
        idMap.set(item.id, existing.id)
        if (!existing.saved) library.update(existing.id, { saved: true })
        continue
      }
      const id = newId()
      idMap.set(item.id, id)
      const from = join(temp, 'media', item.id)
      const to = library.itemDir(id)
      await mkdir(dirname(to), { recursive: true })
      try {
        await rename(from, to)
      } catch {
        await cp(from, to, { recursive: true })
      }
    }
    // Add items after all ids are known, so slide backgrounds can be remapped.
    for (const item of manifest.items) {
      const id = idMap.get(item.id)!
      if (library.get(id)) continue
      library.add({
        ...item,
        id,
        deck: item.deck ? remapDeck(item.deck, idMap) : undefined,
        collections: [],
        saved: true,
        updatedAt: Date.now()
      })
    }
    const entries: PlanEntry[] = manifest.plan.entries.map((e) => ({
      ...e,
      id: newId(),
      mediaId: e.mediaId ? (idMap.get(e.mediaId) ?? e.mediaId) : undefined,
      ambient: e.ambient
        ? { ...e.ambient, mediaIds: e.ambient.mediaIds.map((m) => idMap.get(m) ?? m) }
        : undefined
    }))
    return plans.create(manifest.plan.name, manifest.plan.date, entries)
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
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(p)))
    else if (entry.isFile()) out.push(p)
  }
  return out
}

async function extract(file: string, dest: string): Promise<void> {
  const writes: Promise<void>[] = []
  await new Promise<void>((resolve, reject) => {
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
          return reject(err)
        }
        out.write(data)
        if (final) out.end()
      }
      entry.start()
    })
    unzip.register(UnzipInflate)
    const stream = createReadStream(file)
    stream.on('data', (chunk) => {
      try {
        unzip.push(chunk as Buffer)
      } catch (err) {
        stream.destroy()
        reject(err)
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
