import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brightness, Cue, platformArgs, printLogsOnFailure, repoRoot, testEnv, type Rgb } from './support/cue'

const electronBinary = createRequire(import.meta.url)('electron') as string

// Live services can't wait: Cue has to come back exactly where it was after
// a crash or power cut, and the operator controls the output window.
const dominant = (c: Rgb) => (c.r > c.g && c.r > c.b ? 'red' : c.g > c.b ? 'green' : 'blue')
printLogsOnFailure()

test('after a crash the audience screen comes back as it was; after a normal quit it starts clean', async () => {
  const first = await Cue.launch()
  const { dataDir } = first
  await first.dispatch({ type: 'show', target: { type: 'color', color: '#336699', title: 'Announcements' } })
  await expect
    .poll(() => readFile(join(dataDir, 'show.json'), 'utf8').catch(() => ''))
    .toContain('Announcements')
  await first.kill()

  const second = await Cue.launch({ dataDir })
  try {
    expect((await second.state()).live?.title).toBe('Announcements')
    await expect(second.control.getByText('Restored after an unexpected shutdown')).toBeVisible()
    await expect.poll(async () => dominant(await second.outputColor())).toBe('blue')
  } finally {
    await second.close({ keepData: true })
  }

  const third = await Cue.launch({ dataDir })
  try {
    expect((await third.state()).live).toBeNull()
    await third.control.waitForTimeout(2000)
    await expect(third.control.getByText('Restored after an unexpected shutdown')).toHaveCount(0)
    expect(third.errors()).toEqual([])
  } finally {
    await third.close()
  }
})

test('the output window can be turned off and back on, and shows a test pattern for setup', async () => {
  const cue = await Cue.launch()
  try {
    await cue.invoke('output:set', { mode: 'off' })
    await expect.poll(() => cue.app.windows().some((w) => w.url().includes('audience.html'))).toBe(false)
    await expect(cue.control.getByText('Output is turned off')).toBeVisible()

    await cue.invoke('output:set', { mode: 'window' })
    await cue.output()
    expect(brightness(await cue.outputColor())).toBeLessThan(3)
    await cue.dispatch({ type: 'test-pattern', on: true })
    await expect.poll(async () => brightness(await cue.outputColor())).toBeGreaterThan(20)
    await cue.dispatch({ type: 'test-pattern', on: false })
    await expect.poll(async () => brightness(await cue.outputColor())).toBeLessThan(3)
    expect(cue.pageErrors).toEqual([])
    expect(cue.errors()).toEqual([])
  } finally {
    await cue.close()
  }
})

test('a Cue left running without its window steps aside for a new launch', async () => {
  const stuck = await Cue.launch()
  const { dataDir } = stuck
  // The control window is gone, but the process lives on behind its audience window:
  // from the outside, Cue "won't open any more".
  await stuck.app.evaluate(({ BrowserWindow }) => {
    const control = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('control.html')
    )!
    control.removeAllListeners('closed')
    control.destroy()
  })

  // Opening Cue again must give a working window, not hand over to the stuck one and quit.
  const fresh = await Cue.launch({ dataDir })
  try {
    await expect(fresh.control.getByTestId('take')).toBeVisible()
    expect(fresh.errors()).toEqual([])
  } finally {
    await fresh.close()
    await stuck.close()
  }
})

test('opening Cue again hands its files to the running Cue and quits', async () => {
  const cue = await Cue.launch()
  const dir = await mkdtemp(join(tmpdir(), 'cue-handoff-'))
  try {
    const plan = await cue.invoke('plans:create', 'Harvest festival', '2026-10-04')
    const file = join(dir, 'harvest.cueplan')
    await cue.app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: path
      })) as typeof dialog.showSaveDialog
    }, file)
    await cue.invoke('plans:export', plan.id)

    // Like double-clicking the file while Cue is open: a second process starts…
    const second = spawn(electronBinary, [repoRoot, ...platformArgs, file], { env: testEnv(cue.dataDir) })
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('The second launch did not hand over and quit')),
        20_000
      )
      second.once('exit', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })
    // …hands the file to the running Cue and quits.
    expect(exitCode).toBe(0)
    await expect
      .poll(async () => (await cue.plans()).filter((p) => p.name === 'Harvest festival').length)
      .toBe(2)
    await expect(cue.control.getByText('Plan imported')).toBeVisible()
    expect(cue.errors()).toEqual([])
  } finally {
    await cue.close()
    await rm(dir, { recursive: true, force: true })
  }
})
