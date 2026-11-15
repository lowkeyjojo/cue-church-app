import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { UiCommand } from '@shared/ipc'
import { parseGoogleLink } from '@shared/google'
import type { ShowCommand, WebPick } from '@shared/types'
import { registerHandlers } from './handlers'
import { addControl, broadcast, installIpc } from './ipc'
import { errorMessage, log } from './log'
import { Importer } from './media/importer'
import { MediaProcessor } from './media/processor'
import { WebIngest } from './media/webIngest'
import { MediaWorker } from './media/worker'
import { buildMenu } from './menu'
import { OutputManager } from './output/output'
import { dataPath, initPaths, isE2E, logsDir, resourcePath } from './paths'
import { clearImportLeftovers, importPlanBundle } from './plans/bundle'
import { handleAppProtocol, handleMediaProtocol, registerSchemes } from './protocol'
import { Bible } from './scripture/bible'
import { ShowController } from './show/controller'
import { ensureStarterContent } from './starter'
import { HistoryStore } from './store/history'
import { LibraryStore } from './store/library'
import { PlansStore } from './store/plans'
import { SettingsStore } from './store/settings'
import { configureAppSession, configureWebSession, createControlWindow } from './windows/control'

initPaths()
registerSchemes()
app.setName('Cue')

// .cueplan files opened from Finder or Explorer (or dropped on the Dock icon)
// can arrive before Cue is ready to import them.
const isPlanFile = (arg: string) => arg.toLowerCase().endsWith('.cueplan') && existsSync(arg)
const planFiles: string[] = process.argv.slice(1).filter(isPlanFile)
let openPlanFile: ((file: string) => void) | null = null
app.on('open-file', (event, file) => {
  if (!file.toLowerCase().endsWith('.cueplan')) return
  event.preventDefault()
  if (openPlanFile) openPlanFile(file)
  else planFiles.push(file)
})

// A second launch hands its files to the running Cue, which confirms by
// leaving a note in launches/. Each launch has an id, so it's handled once.
const launchId = randomUUID()
const handledLaunches = new Set<string>()
const launchNote = (id: string) => dataPath('launches', `${id}.ack`)
const lock = () => app.requestSingleInstanceLock({ launchId })

// In the log before anything can go wrong, so "Cue didn't open" always leaves a trace.
log.info(`Cue launched (pid ${process.pid})`)
if (lock()) start().catch(fatal)
else waitForLock().catch(fatal)

/** Starting never fails silently: say what happened and where the details are. */
function fatal(err: unknown): void {
  log.error('Cue could not start:', err)
  if (!isE2E) {
    dialog.showErrorBox(
      "Cue couldn't start",
      `${errorMessage(err)}\n\nInstalling Cue again usually fixes this; your library and plans are kept.\nDetails: ${join(logsDir(), 'cue.log')}`
    )
  }
  app.exit(1)
}

/**
 * Either another Cue is running (it confirms the hand-off and this launch
 * quits), or one has just crashed and Windows still holds its lock for a
 * moment: then keep trying, so a quick relaunch isn't silently ignored.
 */
async function waitForLock(): Promise<void> {
  log.info('Another Cue holds the lock: handing over to it, or waiting for it to close')
  for (let waited = 200; waited <= 15_000; waited += 200) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    if (existsSync(launchNote(launchId))) {
      rmSync(launchNote(launchId), { force: true })
      log.info('Handed over to the running Cue')
      return app.quit()
    }
    if (lock()) {
      log.info(`Started after waiting ${waited} ms for the previous Cue to close`)
      return start()
    }
    if (waited % 2000 === 0) log.info(`Still waiting for the previous Cue (${waited} ms)`)
  }
  log.warn('Another Cue is running but did not respond')
  if (!isE2E) {
    dialog.showErrorBox(
      "Cue is already running, but it isn't responding",
      `Close it first (${process.platform === 'darwin' ? 'Force Quit, ⌘⌥Esc' : 'Task Manager, Ctrl+Shift+Esc'}), then open Cue again.`
    )
  }
  app.quit()
}

process.on('uncaughtException', (err) => log.error('Uncaught exception:', err))
process.on('unhandledRejection', (err) => log.error('Unhandled rejection:', err))
// The console line is written at once (pipes are synchronous on Windows), so it survives a quick exit.
process.on('exit', (code) => log.info(`Cue exited (code ${code})`))

async function start(): Promise<void> {
  rmSync(dataPath('launches'), { recursive: true, force: true })
  let control: BrowserWindow | null = null
  let windowOpened = false
  let restarting = false
  await app.whenReady()
  nativeTheme.themeSource = 'dark'
  log.info(
    `Cue ${app.getVersion()} starting (Electron ${process.versions.electron}, ${process.platform}/${process.arch})`
  )

  // A Cue left running without its window can't help anyone, and it would answer every
  // later launch so that nothing ever appears. It starts a fresh Cue in its place instead.
  const windowLost = () => windowOpened && (!control || control.isDestroyed())
  const restart = (files: string[] = []) => {
    if (restarting) return
    restarting = true
    log.warn('This Cue has no window: restarting')
    app.relaunch({ args: [...process.argv.slice(1).filter((arg) => !isPlanFile(arg)), ...files] })
    // A moment later, so a second launch gets its answer first.
    setTimeout(() => app.exit(0), 50)
    // A Cue that is stuck may not manage to exit either; the new one starts once this is gone.
    setTimeout(() => process.kill(process.pid, 'SIGKILL'), 3000).unref()
  }

  // Registered before anything slow, so a second launch during startup is answered too.
  app.on('second-instance', (_event, argv, _cwd, data) => {
    const id = (data as { launchId?: string } | null)?.launchId
    if (id) {
      if (handledLaunches.has(id)) return
      handledLaunches.add(id)
      try {
        mkdirSync(dataPath('launches'), { recursive: true })
        writeFileSync(launchNote(id), '')
      } catch {
        /* the other launch gives up on its own after a while */
      }
    }
    if (windowLost()) return restart(argv.slice(1).filter(isPlanFile))
    if (control && !control.isDestroyed()) {
      if (control.isMinimized()) control.restore()
      if (!control.isVisible()) control.show()
      control.focus()
    }
    for (const file of argv.slice(1).filter(isPlanFile)) {
      if (openPlanFile) openPlanFile(file)
      else planFiles.push(file)
    }
  })

  // On a Mac, opening Cue again doesn't start a second process: the Dock asks this one.
  app.on('activate', () => {
    if (windowLost()) return restart()
    if (control && !control.isDestroyed() && !control.isVisible()) control.show()
  })

  handleAppProtocol()
  handleMediaProtocol()
  configureAppSession()
  configureWebSession()

  const settings = new SettingsStore()
  const library = new LibraryStore()
  const plans = new PlansStore()
  const history = new HistoryStore()
  ensureStarterContent(library, plans, settings)

  const worker = new MediaWorker()
  const processor = new MediaProcessor(library, worker, settings)
  const importer = new Importer(library, processor, (p) => broadcast('progress', p))
  const web = new WebIngest(importer, library)
  const show = new ShowController(library, plans, settings, history)
  const output = new OutputManager(settings)

  // --- wiring: stores -> renderers ---
  show.on('state', (state) => {
    broadcast('show:state', state)
    output.setShowState(state)
  })
  show.on('playback', (p) => broadcast('show:playback', p))
  show.on('toast', (t) => broadcast('toast', t))
  output.on('playback', (p) => show.onPlayback(p))
  output.on('ready', () => show.resumePlayback())
  output.on('changed', (snap) => {
    broadcast('displays:changed', snap)
    rebuildMenu()
  })
  library.on('upsert', (items) => broadcast('library:upsert', items))
  library.on('remove', (ids) => {
    broadcast('library:remove', ids)
    plans.removeMedia(ids)
    history.removeMedia(ids)
  })
  library.on('collections', (c) => broadcast('library:collections', c))
  plans.on('changed', (p) => broadcast('plans:changed', p))
  history.on('changed', (h) => broadcast('history:changed', h))
  settings.on('changed', (s) => broadcast('settings:changed', s))
  output.setShowState(show.state)

  const dispatch = (cmd: ShowCommand) => show.dispatch(cmd)
  const ui = (command: UiCommand) => {
    if (control && !control.isDestroyed()) {
      if (command !== 'focus-search') control.focus()
      broadcast('ui:command', command)
    }
  }

  /** Context-menu actions on images inside the embedded Google pane. */
  const webImage = async (
    action: 'preview' | 'show' | 'save',
    image: { srcURL: string; pageURL: string; linkURL?: string; x: number; y: number; contentsId: number }
  ) => {
    const fromLink = parseGoogleLink(image.linkURL)
    const pick: WebPick = {
      url: fromLink.imageUrl ?? image.srcURL,
      thumbUrl: image.srcURL,
      pageUrl: fromLink.pageUrl ?? image.pageURL,
      provider: 'google'
    }
    const save = action === 'save'
    try {
      let item
      try {
        item = await web.ingest({ ...pick, thumbUrl: undefined }, { save })
      } catch (err) {
        // The page is showing the image, so copy it from there before settling for the thumbnail.
        const shown = { ...pick, url: image.srcURL }
        item =
          (await web.copyFromPage(image.contentsId, image.x, image.y, shown, { save })) ??
          (pick.thumbUrl !== pick.url ? await web.ingest({ ...pick, url: image.srcURL }, { save }) : null)
        if (!item) throw err
      }
      if (action === 'preview') dispatch({ type: 'preview', target: { type: 'media', mediaId: item.id } })
      else if (action === 'show') dispatch({ type: 'show', target: { type: 'media', mediaId: item.id } })
      else {
        library.update(item.id, { saved: true })
        broadcast('toast', { kind: 'success', title: 'Saved to library', message: item.name, duration: 2500 })
      }
    } catch (err) {
      broadcast('toast', { kind: 'error', title: "Couldn't bring in that image", message: errorMessage(err) })
    }
  }

  registerHandlers({
    bible: new Bible((id) => readFile(resourcePath('bible', `${id}.json.gz`))),
    settings,
    library,
    plans,
    history,
    show,
    output,
    importer,
    processor,
    web,
    control: () => control
  })
  installIpc()

  control = createControlWindow(settings, { dispatch, ui, webImage: (a, i) => void webImage(a, i) })
  windowOpened = true
  addControl(control.webContents)
  output.attachControl(control)
  output.apply()

  /** Import a .cueplan opened from the file manager and bring it up in the plan panel. */
  const importPlanFile = async (file: string) => {
    try {
      const plan = await importPlanBundle(file, library, plans, (items) =>
        items.filter((i) => i.status === 'processing').forEach((i) => processor.enqueue(i.id))
      )
      settings.update({ ui: { planId: plan.id } })
      broadcast('plans:open', plan.id)
      broadcast('toast', { kind: 'success', title: 'Plan imported', message: `“${plan.name}” is ready.` })
    } catch (err) {
      log.warn(`Couldn't open ${file}:`, errorMessage(err))
      broadcast('toast', { kind: 'error', title: "Couldn't open that plan", message: errorMessage(err) })
    }
  }
  control.webContents.once('did-finish-load', () => {
    openPlanFile = (file) => void importPlanFile(file)
    for (const file of planFiles.splice(0)) openPlanFile(file)
  })

  function rebuildMenu() {
    buildMenu({
      ui,
      dispatch,
      setOutputMode: (mode) => output.setMode({ mode }),
      identify: () => output.identify(),
      outputMode: () => settings.data.output.mode
    })
  }
  rebuildMenu()

  processor.resumePending()
  void clearImportLeftovers()
  library.pruneTransient((id) => plans.referencedMedia().has(id) || history.referencedMedia().has(id))
  if (show.recoveredFromCrash) {
    log.warn('Recovered show state after an unexpected shutdown')
    setTimeout(
      () =>
        broadcast('toast', {
          kind: 'info',
          title: 'Restored after an unexpected shutdown',
          message: 'The audience screen is showing what it showed before.'
        }),
      1500
    )
  }

  control.on('close', (event) => {
    if (isE2E) return
    const s = show.state
    const onScreen = output.snapshot().output.active && !s.blackout && (s.live || s.ambient.active)
    if (!onScreen) return
    const choice = dialog.showMessageBoxSync(control!, {
      type: 'question',
      buttons: ['Quit Cue', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Quit Cue?',
      detail: `The ${settings.data.output.name} is showing content and will go dark.`
    })
    if (choice === 1) event.preventDefault()
  })
  control.on('closed', () => {
    control = null
    app.quit()
  })

  app.on('before-quit', () => {
    show.markCleanExit()
    settings.flush()
    library.flush()
    plans.flush()
    history.flush()
    output.destroy()
    worker.shutdown()
  })

  if (isE2E) {
    ;(globalThis as Record<string, unknown>).__cue = {
      show,
      library,
      plans,
      settings,
      history,
      importer,
      web,
      output,
      processor,
      control
    }
  }
}
