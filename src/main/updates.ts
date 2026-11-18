import { app, net, shell } from 'electron'
import { autoUpdater, type AppUpdater } from 'electron-updater'
import type { UpdateState } from '@shared/types'
import {
  cleanVersion,
  isNewerVersion,
  LATEST_RELEASE_API,
  localUpdateFeed,
  plainUpdateError,
  releasePage
} from '@shared/updates'
import { errorMessage, log, UserError } from './log'
import { isE2E } from './paths'
import { Emitter } from './store/emitter'
import type { SettingsStore } from './store/settings'

const FIRST_CHECK_MS = 15_000
const FIRST_CHECK_TEST_MS = 1000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/** Tests may serve their own releases from this computer (CUE_UPDATE_FEED); nothing else is accepted. */
function testFeed(): string | null {
  const value = process.env.CUE_UPDATE_FEED
  if (!value) return null
  const feed = localUpdateFeed(value)
  if (feed) log.info(`Updates come from the test feed ${feed}`)
  else log.warn('Ignoring CUE_UPDATE_FEED: it must be http://127.0.0.1:<port> or http://localhost:<port>')
  return feed
}

/**
 * Keeps Cue up to date without getting in the way of a service.
 *
 * An installed Cue on Windows downloads a new version in the background and
 * installs it when Cue is closed; it never restarts on its own. Everywhere
 * else the builds can't replace themselves (that needs a signed app), so Cue
 * only finds out that a new version exists and points at its download page.
 * A check that fails is a line in the log, never a dialog.
 */
export class Updates extends Emitter<{ state: UpdateState }> {
  state: UpdateState = { status: 'idle' }
  /** Cue is quitting to install an update: nothing should hold that quit up. */
  installing = false

  private readonly feed = testFeed()
  private readonly selfInstall = process.platform === 'win32' && app.isPackaged
  private timers: NodeJS.Timeout[] = []
  private checking: Promise<UpdateState> | null = null
  private wired = false

  constructor(private settings: SettingsStore) {
    super()
    let auto = settings.data.updates.auto
    settings.on('changed', (s) => {
      // Switched back on: don't wait hours for the next round.
      if (s.updates.auto && !auto && this.timers.length) void this.check()
      auto = s.updates.auto
    })
  }

  /** Look for updates shortly after startup and a few times a day, while the setting is on. */
  start(): void {
    // Not while developing or under test, unless a test supplies its own feed.
    if (!this.feed && (!app.isPackaged || isE2E)) return
    const tick = () => {
      if (this.settings.data.updates.auto) void this.check()
    }
    const first = setTimeout(tick, this.feed ? FIRST_CHECK_TEST_MS : FIRST_CHECK_MS)
    const every = setInterval(tick, CHECK_EVERY_MS)
    this.timers = [first, every]
    for (const timer of this.timers) timer.unref()
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
  }

  /** Look for a new version now. Resolves with where that got to; it never rejects. */
  check(): Promise<UpdateState> {
    // Tests stay off the network.
    if (isE2E && !this.feed) return Promise.resolve(this.state)
    if (this.state.status === 'downloading' || this.installing) return Promise.resolve(this.state)
    this.checking ??= (this.selfInstall ? this.checkAndDownload() : this.checkOnly())
      .catch((err) => this.failed(err))
      .then(() => this.state)
      .finally(() => (this.checking = null))
    return this.checking
  }

  /** Restart into the downloaded update, or open the page the new version is downloaded from. */
  install(): void {
    const { status, version, manual, url } = this.state
    if (status === 'available' && manual) {
      const page = releasePage(url)
      log.info(`Opening ${page} for Cue ${version}`)
      void shell.openExternal(page)
      return
    }
    if (status !== 'ready' || !this.selfInstall) throw new UserError('There is no update to install yet.')
    log.info(`Installing update ${version} and restarting`)
    this.installing = true
    // Silently, and start Cue again afterwards.
    this.updater().quitAndInstall(true, true)
  }

  /** Cue is restarting itself rather than closing: keep a downloaded update for the next real quit. */
  skipInstallOnQuit(): void {
    if (this.wired) autoUpdater.autoInstallOnAppQuit = false
  }

  private async checkOnly(): Promise<void> {
    this.set({ status: 'checking' })
    const response = await net.fetch(this.feed ? `${this.feed}/latest.json` : LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20_000)
    })
    if (!response.ok) throw new Error(`The update server answered ${response.status}`)
    const release = (await response.json()) as { tag_name?: unknown; html_url?: unknown }
    const version = typeof release.tag_name === 'string' ? cleanVersion(release.tag_name) : null
    if (!version) throw new Error('The latest release has no version number')
    if (isNewerVersion(version, app.getVersion())) {
      this.set({ status: 'available', version, manual: true, url: releasePage(release.html_url) })
    } else {
      this.set({ status: 'current' })
    }
  }

  private async checkAndDownload(): Promise<void> {
    // The rest arrives as events: the download carries on after the check itself is done.
    await this.updater().checkForUpdates()
  }

  /**
   * electron-updater, set up on first use. The builds aren't signed, so there
   * is no publisher to compare a download's signature with; what it downloads
   * is checked against the SHA-512 published in the release's latest.yml.
   */
  private updater(): AppUpdater {
    const updater = autoUpdater
    if (this.wired) return updater
    this.wired = true
    updater.logger = {
      debug: (message) => log.debug('Updater:', message),
      info: (message) => log.info('Updater:', message),
      warn: (message) => log.warn('Updater:', message),
      // A failed update is never worth more than a warning: Cue itself is fine.
      error: (message) => log.warn('Updater:', message)
    }
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.disableWebInstaller = true
    if (this.feed) updater.setFeedURL({ provider: 'generic', url: this.feed })
    updater.on('checking-for-update', () => this.set({ status: 'checking' }))
    updater.on('update-not-available', () => this.set({ status: 'current' }))
    updater.on('update-available', (info) =>
      this.set({ status: 'downloading', version: info.version, percent: 0 })
    )
    updater.on('download-progress', (progress) =>
      this.set({ status: 'downloading', version: this.state.version, percent: Math.floor(progress.percent) })
    )
    updater.on('update-downloaded', (info) => this.set({ status: 'ready', version: info.version }))
    updater.on('error', (err) => this.failed(err))
    return updater
  }

  private failed(err: unknown): void {
    this.installing = false
    const message = plainUpdateError(errorMessage(err))
    if (this.state.status === 'error' && this.state.message === message) return
    log.warn("Couldn't check for updates:", errorMessage(err))
    this.set({ status: 'error', message })
  }

  private set(next: UpdateState): void {
    const now = this.state
    const known = now.status === 'available' || now.status === 'downloading' || now.status === 'ready'
    // Looking again, or failing to, doesn't take away an update Cue already knows about.
    if (known && next.status === 'checking') return
    if (known && next.status === 'error' && now.status !== 'downloading') return
    // A downloaded update stays ready unless a newer one starts to arrive.
    if (now.status === 'ready' && next.status !== 'ready') {
      if (next.status !== 'downloading' || next.version === now.version) return
    }
    if (JSON.stringify(next) === JSON.stringify(now)) return
    this.state = next
    if (next.status !== now.status || next.version !== now.version) {
      if (next.status === 'current') log.info(`Cue ${app.getVersion()} is up to date`)
      else if (next.status === 'available') log.info(`Update ${next.version} is available at ${next.url}`)
      else if (next.status === 'downloading') log.info(`Downloading update ${next.version}`)
      else if (next.status === 'ready') log.info(`Update ${next.version} is ready`)
    }
    this.emit('state', next)
  }
}
