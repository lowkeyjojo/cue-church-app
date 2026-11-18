import { expect, test, type Locator } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Cue, logFile, printLogsOnFailure } from './support/cue'

// Cue looks for a newer version by itself and never interrupts anyone over it.
// These run the path every platform takes when Cue can't replace itself (an
// unpackaged or unsigned app): it says a new version is out and opens its page.
printLogsOnFailure()

const RELEASES = 'https://github.com/lowkeyjojo/cue-church-app/releases'

/** A stand-in for the releases feed on this computer: /latest.json describes the newest release. */
async function startFeed(initial: { version: string } | { status: number }) {
  const feed = {
    answer: initial,
    requests: [] as string[],
    url: '',
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
  const server = createServer((req, res) => {
    feed.requests.push(req.url ?? '')
    const { answer } = feed
    if (req.url !== '/latest.json' || 'status' in answer) {
      res.writeHead('status' in answer ? answer.status : 404).end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({ tag_name: `v${answer.version}`, html_url: `${RELEASES}/tag/v${answer.version}` })
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  feed.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return feed
}

/** Go to the settings' Library section, where updates are, with the arrow keys (Output is first, Library last). */
async function openLibrarySettings(settings: Locator): Promise<void> {
  await settings.getByRole('tab', { name: 'Output' }).press('ArrowUp')
  await expect(settings.getByRole('tab', { name: 'Library' })).toHaveAttribute('aria-selected', 'true')
}

test('a newer version is announced quietly, and “Get it” opens its download page', async () => {
  const feed = await startFeed({ version: '99.0.0' })
  const cue = await Cue.launch({ env: { CUE_UPDATE_FEED: feed.url } })
  try {
    // Record what Cue would open in the browser instead of opening it.
    await cue.app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as unknown as { __opened: string[] }).__opened = opened
      shell.openExternal = (async (url: string) => {
        opened.push(url)
      }) as typeof shell.openExternal
    })
    const opened = () => cue.app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)

    const notice = cue.control.getByTestId('update-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toHaveText('Update available')
    expect(await cue.invoke('updates:state')).toEqual({
      status: 'available',
      version: '99.0.0',
      manual: true,
      url: `${RELEASES}/tag/v99.0.0`
    })
    // No toast and nothing in the way: the operator decides when to look.
    await expect(cue.control.getByRole('dialog')).toHaveCount(0)
    expect(await opened()).toEqual([])

    await notice.click()
    const popover = cue.control.getByRole('dialog')
    await expect(popover).toContainText('Cue 99.0.0 is available')
    await popover.getByRole('button', { name: 'Get it' }).click()
    await expect.poll(opened).toEqual([`${RELEASES}/tag/v99.0.0`])
    await expect(popover).toBeHidden()

    // The settings say the same, and "Keep Cue up to date" is the operator's to switch off.
    await cue.control.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = cue.control.getByRole('dialog', { name: 'Settings' })
    await openLibrarySettings(settings)
    await expect(settings).toContainText('Cue 99.0.0 is available')
    const keep = settings.getByRole('switch', { name: 'Keep Cue up to date' })
    await expect(keep).toBeChecked()
    await keep.click()
    await expect.poll(() => cue.app.evaluate(() => globalThis.__cue.settings.data.updates.auto)).toBe(false)

    expect(cue.errors()).toEqual([])
    expect(cue.pageErrors).toEqual([])
  } finally {
    await cue.close()
    await feed.close()
  }
})

test('an older version shows nothing, and a check that fails is only a line in the log', async () => {
  const feed = await startFeed({ version: '0.0.1' })
  const cue = await Cue.launch({ env: { CUE_UPDATE_FEED: feed.url } })
  try {
    await expect.poll(async () => (await cue.invoke('updates:state')).status).toBe('current')
    expect(feed.requests).toEqual(['/latest.json'])
    await expect(cue.control.getByTestId('update-notice')).toHaveCount(0)

    // The same version is not an update either.
    const { version } = await cue.invoke('app:info')
    feed.answer = { version }
    expect(await cue.invoke('updates:check')).toEqual({ status: 'current' })

    feed.answer = { status: 500 }
    expect(await cue.invoke('updates:check')).toEqual({
      status: 'error',
      message: 'the update server answered 500'
    })
    await expect(cue.control.getByTestId('update-notice')).toHaveCount(0)
    await expect(cue.control.getByRole('dialog')).toHaveCount(0)
    await expect(cue.control.getByText("Couldn't check")).toHaveCount(0)

    await cue.control.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = cue.control.getByRole('dialog', { name: 'Settings' })
    await openLibrarySettings(settings)
    await expect(settings).toContainText("Couldn't check: the update server answered 500")
    feed.answer = { version: '0.0.1' }
    await settings.getByRole('button', { name: 'Check now' }).click()
    await expect(settings).toContainText('Cue is up to date')

    const log = await logFile(cue.dataDir)
    expect(log).toContain("[WARN] Couldn't check for updates: The update server answered 500")
    expect(log).not.toContain('[ERROR]')
    expect(cue.errors()).toEqual([])
  } finally {
    await cue.close()
    await feed.close()
  }
})

test('only a feed on this computer can stand in for the real releases', async () => {
  const cue = await Cue.launch({ env: { CUE_UPDATE_FEED: 'https://example.com/cue' } })
  try {
    await expect.poll(() => logFile(cue.dataDir)).toContain('[WARN] Ignoring CUE_UPDATE_FEED')
    // Without a feed of its own, a Cue under test doesn't look for updates at all.
    expect(await cue.invoke('updates:check')).toEqual({ status: 'idle' })
    await expect(cue.control.getByTestId('update-notice')).toHaveCount(0)
  } finally {
    await cue.close()
  }
})
