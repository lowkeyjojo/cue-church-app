import { app, dialog, net, shell, type BrowserWindow } from 'electron'
import { basename } from 'node:path'
import { newId } from '@shared/defaults'
import type { MediaItem, SearchResponse } from '@shared/types'
import { isHttpUrl } from '@shared/util'
import { MEDIA_ITEM_EDITABLE, type MediaItemPatch } from '@shared/ipc'
import { broadcast, handle } from './ipc'
import { errorMessage, log, UserError } from './log'
import type { Importer } from './media/importer'
import type { MediaProcessor } from './media/processor'
import type { WebIngest } from './media/webIngest'
import type { OutputManager } from './output/output'
import type { Bible } from './scripture/bible'
import { dataPath, isE2E, logsDir, mediaRoot } from './paths'
import { exportPlan, importPlanBundle } from './plans/bundle'
import { searchOpenverse, searchPexels, searchWikimedia, type Fetcher } from './search/providers'
import type { ShowController } from './show/controller'
import type { HistoryStore } from './store/history'
import type { LibraryStore } from './store/library'
import type { PlansStore } from './store/plans'
import type { SettingsStore } from './store/settings'
import type { Updates } from './updates'

export interface Services {
  bible: Bible
  settings: SettingsStore
  library: LibraryStore
  plans: PlansStore
  history: HistoryStore
  show: ShowController
  output: OutputManager
  importer: Importer
  processor: MediaProcessor
  web: WebIngest
  updates: Updates
  control: () => BrowserWindow | null
}

export function registerHandlers(s: Services): void {
  // --- app ---
  handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    dataPath: dataPath(),
    libraryPath: mediaRoot(),
    logsPath: logsDir(),
    e2e: isE2E,
    googleBase: isE2E ? process.env.CUE_GOOGLE_BASE : undefined
  }))
  handle('app:quit', () => app.quit())

  // --- show ---
  handle('show:get', () => s.show.state)
  handle('show:dispatch', (cmd) => s.show.dispatch(cmd))
  handle('show:playback', () => s.show.playback)

  // --- library ---
  handle('library:list', () => ({ items: s.library.all(), collections: s.library.collections() }))
  handle('library:import', async (paths, opts) => {
    const list = paths?.length ? paths : await chooseFiles(s.control(), 'media')
    if (!list.length) return { items: [], skipped: [] }
    const result = await s.importer.importPaths(list, opts)
    if (result.skipped.length) {
      const first = result.skipped[0]
      broadcast('toast', {
        kind: 'warning',
        title:
          result.skipped.length === 1
            ? `Couldn't import ${basename(first.path)}`
            : `${result.skipped.length} files were skipped`,
        message: first.reason,
        duration: 6000
      })
    }
    return result
  })
  handle('library:importData', (data, name, mime) =>
    s.importer.importBytes(new Uint8Array(data), { name, mime, source: { type: 'paste' }, saved: false })
  )
  handle('library:importWeb', (pick, opts) => s.web.ingest(pick, opts))
  handle('scripture:passage', (reference, translation) =>
    s.bible.passage(reference, translation ?? s.settings.data.slides.bible)
  )
  handle('library:update', (id, patch) => {
    // Only operator-editable fields: never the id or file names that locate the media on disk.
    const allowed = Object.fromEntries(
      Object.entries(patch ?? {}).filter(([key]) => (MEDIA_ITEM_EDITABLE as readonly string[]).includes(key))
    ) as MediaItemPatch
    return s.library.update(id, allowed)
  })
  handle('library:remove', (ids) => {
    const live = s.show.state.live
    if (live?.mediaId && ids.includes(live.mediaId)) {
      throw new UserError(`“${live.title}” is on screen right now. Clear the screen before deleting it.`)
    }
    s.library.remove(ids)
  })
  handle('library:reveal', (id) => {
    const item = s.library.get(id)
    if (item?.file) shell.showItemInFolder(s.library.filePath(item))
  })
  handle('library:createDeck', (name, deck, opts) => {
    const now = Date.now()
    const item: MediaItem = {
      id: newId(),
      kind: 'deck',
      name: name.trim() || 'Untitled slides',
      status: 'ready',
      deck: deck ?? {
        slides: [],
        theme: s.settings.data.slides.theme,
        background: s.settings.data.slides.background
      },
      source: { type: 'created' },
      saved: opts?.saved ?? true,
      favorite: false,
      collections: [],
      tags: [],
      createdAt: now,
      updatedAt: now,
      showCount: 0
    }
    return s.library.add(item)
  })
  handle('library:updateDeck', (id, deck) => {
    const item = s.library.update(id, { deck })
    // A deck on screen is updated before the operator's next key press is handled.
    s.library.publish()
    return item
  })
  handle('library:duplicate', (id) => {
    const item = s.library.get(id)
    if (!item || item.kind !== 'deck' || !item.deck) return null
    const now = Date.now()
    return s.library.add({
      ...structuredClone(item),
      id: newId(),
      name: `${item.name} (copy)`,
      createdAt: now,
      updatedAt: now,
      showCount: 0,
      lastShownAt: undefined
    })
  })
  handle('library:reprocess', (id) => {
    s.library.update(id, { status: 'processing', error: undefined, pagesReady: 0 })
    s.processor.enqueue(id)
  })
  handle('library:collectionCreate', (name) => s.library.createCollection(name))
  handle('library:collectionRename', (id, name) => s.library.renameCollection(id, name))
  handle('library:collectionRemove', (id) => s.library.removeCollection(id))
  handle('library:setCollection', (ids, collectionId, member) =>
    s.library.setCollection(ids, collectionId, member)
  )

  // --- plans ---
  handle('plans:list', () => s.plans.all())
  handle('plans:create', (name, date) => s.plans.create(name, date))
  handle('plans:update', (id, patch) => s.plans.update(id, patch))
  handle('plans:remove', (id) => s.plans.remove(id))
  handle('plans:duplicate', (id) => s.plans.duplicate(id))
  handle('plans:addEntries', (planId, entries, index) => {
    // Anything placed in a plan becomes part of the library.
    for (const e of entries) {
      const item = s.library.get(e.mediaId)
      if (item && !item.saved) s.library.update(item.id, { saved: true })
    }
    return s.plans.addEntries(planId, entries, index)
  })
  handle('plans:updateEntry', (planId, entryId, patch) => s.plans.updateEntry(planId, entryId, patch))
  handle('plans:removeEntries', (planId, entryIds) => s.plans.removeEntries(planId, entryIds))
  handle('plans:moveEntries', (planId, entryIds, toIndex) => s.plans.moveEntries(planId, entryIds, toIndex))
  handle('plans:export', async (planId) => {
    const plan = s.plans.get(planId)
    if (!plan) return null
    const win = s.control()
    const options = {
      title: 'Export Service Plan',
      defaultPath: `${plan.name.replace(/[\\/:*?"<>|]+/g, '-')}.cueplan`,
      filters: [{ name: 'Cue Service Plan', extensions: ['cueplan'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await exportPlan(plan, s.library, result.filePath)
    broadcast('toast', {
      kind: 'success',
      title: 'Plan exported',
      message: `Saved “${basename(result.filePath)}” with all of its media.`
    })
    return result.filePath
  })
  handle('plans:import', async () => {
    const win = s.control()
    const options = {
      title: 'Import Service Plan',
      properties: ['openFile' as const],
      filters: [{ name: 'Cue Service Plan', extensions: ['cueplan'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const plan = await importPlanBundle(result.filePaths[0], s.library, s.plans, (items) =>
      items.filter((i) => i.status === 'processing').forEach((i) => s.processor.enqueue(i.id))
    )
    broadcast('toast', { kind: 'success', title: 'Plan imported', message: `“${plan.name}” is ready.` })
    return plan
  })

  // --- history ---
  handle('history:list', () => s.history.all())
  handle('history:clear', () => s.history.clear())

  // --- settings / displays ---
  handle('settings:get', () => s.settings.data)
  handle('settings:update', (patch) => s.settings.update(patch))
  handle('displays:get', () => s.output.snapshot())
  handle('displays:identify', () => s.output.identify())
  handle('output:set', (opts) => s.output.setMode(opts))

  // --- updates ---
  handle('updates:state', () => s.updates.state)
  handle('updates:check', () => s.updates.check())
  handle('updates:install', () => s.updates.install())

  // --- search ---
  handle('search:query', async (provider, query, page, filters): Promise<SearchResponse> => {
    const q = query.trim()
    if (!q) return { results: [], nextPage: null }
    const fetcher: Fetcher = (url, init) =>
      net.fetch(url, { headers: init?.headers, signal: AbortSignal.timeout(20_000) })
    try {
      switch (provider) {
        case 'wikimedia':
          return await searchWikimedia(fetcher, q, page)
        case 'openverse':
          return await searchOpenverse(fetcher, q, page)
        case 'pexels':
          return await searchPexels(fetcher, s.settings.data.search.pexelsKey, q, page, filters)
        default:
          return { results: [], nextPage: null, error: 'Google results are shown in the browser pane.' }
      }
    } catch (err) {
      log.warn(`Search (${provider}) failed:`, errorMessage(err))
      const offline =
        /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_TIMED_OUT|TimeoutError|aborted/i.test(
          errorMessage(err)
        )
      return {
        results: [],
        nextPage: null,
        error: offline
          ? "Can't reach the internet right now. Your library still works offline."
          : errorMessage(err)
      }
    }
  })

  // --- system ---
  handle('system:openExternal', (url) => {
    if (isHttpUrl(url)) void shell.openExternal(url)
  })
  handle('system:chooseFiles', (kind) => chooseFiles(s.control(), kind ?? 'media'))
  handle('system:revealLogs', () => void shell.openPath(logsDir()))
  handle('system:revealLibrary', () => void shell.openPath(mediaRoot()))
  handle('system:copyImageAt', (contentsId, x, y, pick, opts) =>
    s.web.copyFromPage(contentsId, x, y, pick, opts)
  )
}

async function chooseFiles(win: BrowserWindow | null, kind: 'media' | 'image' | 'video'): Promise<string[]> {
  const filters =
    kind === 'image'
      ? [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg'] }]
      : kind === 'video'
        ? [{ name: 'Videos', extensions: ['mp4', 'm4v', 'mov', 'webm'] }]
        : [
            {
              name: 'Images, videos, audio and PDFs',
              extensions: [
                'jpg',
                'jpeg',
                'png',
                'gif',
                'webp',
                'avif',
                'bmp',
                'svg',
                'mp4',
                'm4v',
                'mov',
                'webm',
                'mp3',
                'm4a',
                'wav',
                'aac',
                'ogg',
                'flac',
                'pdf'
              ]
            },
            { name: 'All files', extensions: ['*'] }
          ]
  const options: Electron.OpenDialogOptions = {
    title: 'Import Media',
    properties: ['openFile', 'multiSelections'],
    filters
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled ? [] : result.filePaths
}
