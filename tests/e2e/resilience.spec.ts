import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brightness, Cue, type Rgb } from './support/cue'

// Live services can't wait: Cue has to come back exactly where it was after
// a crash or power cut, and the operator controls the output window.
const dominant = (c: Rgb) => (c.r > c.g && c.r > c.b ? 'red' : c.g > c.b ? 'green' : 'blue')

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
