import { expect, test } from '@playwright/test'
import { brightness, Cue, printLogsOnFailure } from './support/cue'
import { startMockGoogle, type MockGoogle } from './support/mock-google'

// The headline workflow: search Google Images inside Cue, click a result,
// and it's in Preview, full size, one key away from the screen. A local
// stand-in for Google keeps the test offline and deterministic.
test.describe.configure({ mode: 'serial' })
printLogsOnFailure()

let cue: Cue
let google: MockGoogle
test.beforeAll(async () => {
  google = await startMockGoogle()
  cue = await Cue.launch({ env: { CUE_GOOGLE_BASE: google.searchUrl } })
})
test.afterAll(async () => {
  await cue?.close()
  await google?.close()
})

/** Click a result tile inside the embedded page, as the operator would. */
async function clickResult(index: number) {
  await cue.control.evaluate(
    (i) =>
      (
        document.querySelector('webview') as HTMLElement & { executeJavaScript(js: string): Promise<unknown> }
      ).executeJavaScript(`document.querySelectorAll('.tile')[${i}].click(); true`),
    index
  )
}

async function webItem(title: string) {
  const items = await cue.library()
  return items.find((i) => i.source.type === 'web' && i.name === title)
}

test('searching opens Google Images with SafeSearch on', async () => {
  await cue.control.getByRole('tab', { name: 'Search' }).click()
  const input = cue.control.getByTestId('search-input')
  await input.fill('ephesus')
  await input.press('Enter')
  await expect
    .poll(() => google.requests.find((r) => r.path === '/search' && r.query.includes('q=ephesus'))?.query)
    .toContain('safe=active')
})

test('clicking a result puts the full-size original in Preview', async () => {
  await clickResult(0)
  const bar = cue.control.getByTestId('pick-bar')
  await expect(bar).toContainText('Library of Celsus, Ephesus')
  await expect.poll(async () => (await cue.state()).preview?.title).toBe('Library of Celsus, Ephesus')
  await expect
    .poll(() => webItem('Library of Celsus, Ephesus'))
    .toMatchObject({ width: 1600, height: 1000, saved: false, source: { pageUrl: `${google.base}/page/1` } })
  // Previewing never touches the audience screen.
  expect((await cue.state()).live).toBeNull()
})

test('Ctrl/⌘+Enter shows it even while the Google page has focus', async () => {
  await cue.app.evaluate(({ webContents }) => {
    const guest = webContents.getAllWebContents().find((w) => w.getType() === 'webview')!
    const modifiers: ('meta' | 'control')[] = [process.platform === 'darwin' ? 'meta' : 'control']
    guest.focus()
    guest.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers })
    guest.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers })
  })
  await expect.poll(async () => (await cue.state()).live?.title).toBe('Library of Celsus, Ephesus')
  const output = await cue.output()
  await expect(output.locator('.stage-slot[data-kind="image"][data-phase="in"]')).toBeVisible()
  await expect.poll(async () => brightness(await cue.outputColor())).toBeGreaterThan(30)
})

test('hotlink-protected originals are fetched with the source page as referrer', async () => {
  await clickResult(2)
  await expect.poll(async () => (await cue.state()).preview?.title).toBe('Theatre at Ephesus')
  await expect.poll(() => webItem('Theatre at Ephesus')).toMatchObject({ width: 1400, height: 933 })
})

test('originals a site refuses to serve are copied out of the page at full size', async () => {
  await cue.app.evaluate(({ clipboard }) => clipboard.writeText('the operator’s own clipboard'))
  await clickResult(3)
  await expect.poll(async () => (await cue.state()).preview?.title).toBe('Harbour road (protected)')
  await expect
    .poll(() => webItem('Harbour road (protected)'))
    .toMatchObject({ width: 1200, height: 800, source: { pageUrl: `${google.base}/page/4` } })
  // Copying went through the clipboard, which is put back afterwards.
  expect(await cue.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('the operator’s own clipboard')
})

test('the pick bar saves the image to the library and shows it', async () => {
  const bar = cue.control.getByTestId('pick-bar')
  await bar.getByRole('button', { name: 'Save to library' }).click()
  await expect.poll(async () => (await webItem('Harbour road (protected)'))?.saved).toBe(true)
  await bar.getByRole('button', { name: /Show on TV/ }).click()
  await expect.poll(async () => (await cue.state()).live?.title).toBe('Harbour road (protected)')
})

test('nothing went wrong behind the scenes', async () => {
  expect(cue.pageErrors).toEqual([])
  expect(cue.errors()).toEqual([])
})
