import { expect, test } from '@playwright/test'
import { brightness, Cue, printLogsOnFailure } from './support/cue'
import { pagePath, RESULTS, startMockGoogle, THUMB, type MockGoogle } from './support/mock-google'

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

// For most social and video sites Google's big preview never leaves its own
// thumbnail. Those results must land in Preview by themselves too, from the
// best copy there is, and be replaced if the original turns up after all.
test.describe('results whose original Google never shows', () => {
  const result = (title: string) => RESULTS.find((r) => r.title === title)!
  const click = (title: string) => clickResult(RESULTS.indexOf(result(title)))
  const pageUrl = (title: string) => `${google.base}${pagePath(result(title))}`
  const asked = (path: string) => google.requests.filter((r) => r.path === path)

  /** The library item that is in Preview now. */
  async function inPreview() {
    const id = (await cue.state()).preview?.mediaId
    return (await cue.library()).find((i) => i.id === id)
  }

  /** The page swaps in the original, as Google sometimes does long after the click. */
  async function originalArrives() {
    await cue.control.evaluate(() =>
      (
        document.querySelector('webview') as HTMLElement & { executeJavaScript(js: string): Promise<unknown> }
      ).executeJavaScript('showOriginal(); true')
    )
  }

  test.beforeAll(async () => {
    // A Cue that has shown nothing yet, told which folder of the stand-in counts as a social site.
    await cue.close()
    cue = await Cue.launch({
      env: { CUE_GOOGLE_BASE: google.searchUrl, CUE_SOCIAL_BASE: `${google.base}/social` }
    })
    await cue.control.getByRole('tab', { name: 'Search' }).click()
    const input = cue.control.getByTestId('search-input')
    await input.fill('ephesus')
    await input.press('Enter')
    await expect
      .poll(() =>
        cue.control.evaluate(() =>
          (
            document.querySelector('webview') as HTMLElement & {
              executeJavaScript(js: string): Promise<unknown>
            }
          )
            .executeJavaScript(`document.querySelectorAll('.tile').length`)
            .catch(() => 0)
        )
      )
      .toBe(RESULTS.length)
  })

  test('a post on a social site comes in from the post’s own preview image', async () => {
    const title = 'Sunrise service (reel)'
    await click(title)
    await expect.poll(async () => (await cue.state()).preview?.title).toBe(title)
    await expect.poll(inPreview).toMatchObject({
      width: 1200,
      height: 800,
      saved: false,
      source: {
        type: 'web',
        url: `${google.base}/og/5.png?size=l&v=2`,
        pageUrl: pageUrl(title),
        provider: 'google',
        query: 'ephesus',
        title
      }
    })
    const bar = cue.control.getByTestId('pick-bar')
    await expect(bar).toContainText("From the post's preview image")
    await expect(bar).toContainText('1200×800')
    // The page was asked the way a browser would ask, and the image with the page as referrer.
    expect(asked('/social/5')).toHaveLength(1)
    expect(asked('/social/5')[0].agent).toMatch(/^Mozilla\/5\.0 .*Chrome\//)
    expect(asked('/social/5')[0].agent).not.toMatch(/Electron|Cue/i)
    expect(asked('/og/5.png')[0].referer).toBe(pageUrl(title))
    expect((await cue.state()).live).toBeNull()
  })

  test('a preview image of another shape is not trusted: Google’s thumbnail is used', async () => {
    const title = 'Baptism day (post)'
    await click(title)
    await expect.poll(async () => (await cue.state()).preview?.title).toBe(title)
    await expect
      .poll(inPreview)
      .toMatchObject({ width: THUMB.w, height: THUMB.h, source: { pageUrl: pageUrl(title) } })
    // The page's image was looked at, and turned down.
    expect(asked('/social/6')).toHaveLength(1)
    expect(asked('/og/6.png')).toHaveLength(1)
    await expect(cue.control.getByTestId('pick-bar')).toContainText('Lower-resolution copy')
    expect((await cue.state()).live).toBeNull()
  })

  test('an ordinary website is never asked for its preview image', async () => {
    const title = 'Parish hall (blog)'
    await click(title)
    await expect.poll(async () => (await cue.state()).preview?.title).toBe(title)
    await expect
      .poll(inPreview)
      .toMatchObject({ width: THUMB.w, height: THUMB.h, source: { pageUrl: pageUrl(title) } })
    expect(asked('/page/7')).toEqual([])
    expect(asked('/og/7.png')).toEqual([])
    expect((await cue.state()).live).toBeNull()
  })

  test('a redirect that leaves the social site is not followed', async () => {
    const title = 'Youth camp (moved)'
    await click(title)
    await expect.poll(async () => (await cue.state()).preview?.title).toBe(title)
    await expect.poll(inPreview).toMatchObject({ width: THUMB.w, height: THUMB.h })
    expect(asked('/social/8')).toHaveLength(1)
    expect(asked('/elsewhere/8')).toEqual([])
    expect(asked('/og/8.png')).toEqual([])
    expect((await cue.state()).live).toBeNull()
  })

  test('an original that arrives late replaces its stand-in in Preview', async () => {
    const title = 'Choir on the steps (video)'
    await click(title)
    await expect.poll(inPreview).toMatchObject({ name: title, width: 900, height: 600 })
    await originalArrives()
    await expect.poll(inPreview).toMatchObject({
      name: title,
      width: 1500,
      height: 1000,
      source: { url: `${google.base}/originals/9.png` }
    })
    await expect(cue.control.getByTestId('pick-bar')).not.toContainText('preview image')
    expect((await cue.state()).live).toBeNull()
  })

  test('but never something the operator has put in Preview since', async () => {
    const title = 'Harvest table (slow site)'
    await click(title)
    await expect.poll(inPreview).toMatchObject({ name: title, width: THUMB.w, height: THUMB.h })
    const other = (await cue.library()).find((i) => i.name === 'Sunrise service (reel)')!
    await cue.dispatch({ type: 'preview', target: { type: 'media', mediaId: other.id } })
    await expect.poll(async () => (await cue.state()).preview?.mediaId).toBe(other.id)
    await originalArrives()
    // The original has come in and is what the pick bar now acts on…
    await expect
      .poll(async () => (await cue.library()).find((i) => i.name === title && i.width === 1350))
      .toMatchObject({ height: 900 })
    const bar = cue.control.getByTestId('pick-bar')
    await expect(bar).toContainText('1350×900')
    await expect(bar).not.toContainText('Lower-resolution copy')
    // …but Preview is still the operator's choice.
    expect((await cue.state()).preview?.mediaId).toBe(other.id)
    await bar.getByRole('button', { name: 'Save to library' }).click()
    await expect
      .poll(async () => (await cue.library()).filter((i) => i.name === title && i.saved).map((i) => i.width))
      .toEqual([1350])
    expect((await cue.state()).live).toBeNull()
  })

  test('with auto-preview off, the Preview button brings in the same best copy', async () => {
    await cue.invoke('settings:update', { search: { autoPreview: false } })
    const before = (await cue.state()).preview?.mediaId
    const title = 'Choir on the steps (video)'
    await click(title)
    const bar = cue.control.getByTestId('pick-bar')
    await expect(bar).toContainText(title)
    // The buttons wait for the original as long as auto-preview would, and nothing comes in by itself.
    const preview = bar.getByRole('button', { name: 'Preview' })
    await expect(preview).toBeEnabled()
    await expect(bar).toContainText('best copy')
    expect((await cue.state()).preview?.mediaId).toBe(before)
    await preview.click()
    await expect.poll(inPreview).toMatchObject({ name: title, width: 900, height: 600 })
    await expect(bar).toContainText("From the post's preview image")
    expect((await cue.state()).live).toBeNull()
    await cue.invoke('settings:update', { search: { autoPreview: true } })
  })

  test('nothing went wrong behind the scenes here either', async () => {
    expect(cue.pageErrors).toEqual([])
    expect(cue.errors()).toEqual([])
  })
})
