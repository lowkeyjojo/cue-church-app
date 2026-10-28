import { expect, test, type Locator } from '@playwright/test'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Cue } from './support/cue'
import { gradientPng } from './support/png'

// Planning a service: building the running order by drag and drop, then
// taking it to the church computer as a single .cueplan file.
test.describe.configure({ mode: 'serial' })

let cue: Cue
let dir: string
test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cue-plans-'))
  await writeFile(join(dir, 'cross-at-dawn.png'), gradientPng(1280, 720, [230, 150, 80], [90, 50, 40]))
  await writeFile(join(dir, 'empty-tomb.png'), gradientPng(1280, 720, [60, 90, 140], [20, 30, 50]))
  cue = await Cue.launch()
})
test.afterAll(async () => {
  await cue?.close()
  await rm(dir, { recursive: true, force: true })
})

const planButton = () => cue.control.getByRole('button', { name: 'Switch service plan' })
const entryTitles = async () => (await cue.plans())[0].entries.map((e) => e.title ?? e.type)

async function planMenu(c: Cue, item: string) {
  await c.control.getByRole('button', { name: 'Plan options' }).click()
  await c.control.getByRole('menuitem', { name: item }).click()
}

/** HTML drag and drop, as with a mouse. */
async function drag(from: Locator, to: Locator, position?: { x: number; y: number }) {
  await from.dragTo(to, { targetPosition: position })
}

test('a new plan starts from the empty state and can be renamed', async () => {
  await cue.control.getByRole('button', { name: 'New service plan' }).click()
  await expect(planButton()).toContainText('New service')
  await planMenu(cue, 'Rename…')
  const name = cue.control.getByLabel('Plan name')
  await name.fill('Easter Sunday')
  await name.press('Enter')
  await expect(planButton()).toContainText('Easter Sunday')
  expect((await cue.plans())[0].name).toBe('Easter Sunday')
})

test('library media dragged onto the plan joins it, in the order dropped', async () => {
  await cue.import([join(dir, 'cross-at-dawn.png'), join(dir, 'empty-tomb.png')])
  await cue.control.getByRole('tab', { name: 'Library' }).click()
  const tiles = cue.control.getByTestId('library-tile')
  const list = cue.control.locator('[data-arrow-nav]')
  await drag(tiles.filter({ hasText: 'Cross at dawn' }), list)
  await expect(cue.control.getByTestId('plan-entry')).toHaveCount(1)
  await drag(tiles.filter({ hasText: 'Empty tomb' }), list)
  await expect(cue.control.getByTestId('plan-entry')).toHaveCount(2)
  const items = await cue.library()
  // Anything in a plan is kept in the library for good.
  expect(items.every((i) => i.saved)).toBe(true)
  await expect.poll(async () => (await cue.plans())[0].entries.length).toBe(2)
})

test('entries reorder by dragging and sections organise the plan', async () => {
  const entries = cue.control.getByTestId('plan-entry')
  // Drop "Empty tomb" onto the top half of the first row.
  await drag(entries.filter({ hasText: 'Empty tomb' }), entries.first(), { x: 40, y: 4 })
  await expect(entries.first()).toContainText('Empty tomb')

  await cue.control.getByRole('button', { name: 'Add to plan' }).click()
  await cue.control.getByRole('menuitem', { name: 'Section heading' }).click()
  await cue.control.getByRole('button', { name: 'Add to plan' }).click()
  await cue.control.getByRole('menuitem', { name: 'Black screen' }).click()
  await expect.poll(entryTitles).toEqual(['media', 'media', 'New section', 'Black'])
  const plan = (await cue.plans())[0]
  const names = Object.fromEntries((await cue.library()).map((i) => [i.id, i.name]))
  expect(plan.entries.slice(0, 2).map((e) => names[e.mediaId!])).toEqual(['Empty tomb', 'Cross at dawn'])
})

test('number keys preview plan items and Space runs them in order', async () => {
  await cue.control.getByRole('tab', { name: 'Show' }).click()
  await cue.control.locator('body').click({ position: { x: 700, y: 450 } })
  await cue.control.keyboard.press('1')
  await expect.poll(async () => (await cue.state()).preview?.title).toBe('Empty tomb')
  await cue.control.keyboard.press('Space')
  await expect.poll(async () => (await cue.state()).live?.title).toBe('Empty tomb')
  // The plan's next item is already waiting in Preview.
  await expect.poll(async () => (await cue.state()).preview?.title).toBe('Cross at dawn')
  await cue.control.keyboard.press('Space')
  await expect.poll(async () => (await cue.state()).live?.title).toBe('Cross at dawn')
  await expect.poll(async () => (await cue.state()).preview?.title).toBe('Black')
})

test('a plan exports with its media and imports on another computer', async () => {
  const file = join(dir, 'easter.cueplan')
  await cue.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: path
    })) as typeof dialog.showSaveDialog
  }, file)
  await planMenu(cue, 'Export with media…')
  await expect.poll(async () => (await stat(file).catch(() => null))?.size ?? 0).toBeGreaterThan(5000)

  const other = await Cue.launch()
  try {
    await other.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [path]
      })) as typeof dialog.showOpenDialog
    }, file)
    await other.control.getByRole('button', { name: 'Import…' }).click()
    await expect(other.control.getByRole('button', { name: 'Switch service plan' })).toContainText(
      'Easter Sunday'
    )
    const [plan] = await other.plans()
    expect(plan.entries.map((e) => e.type)).toEqual(['media', 'media', 'section', 'color'])
    const library = await other.library()
    expect(library.map((i) => i.name).sort()).toEqual(['Cross at dawn', 'Empty tomb'])
    expect(library.every((i) => i.status === 'ready' && i.width === 1280)).toBe(true)
    await other.control.getByTestId('plan-entry').first().dblclick()
    await expect.poll(async () => (await other.state()).live?.title).toBe('Empty tomb')
    expect(other.errors()).toEqual([])
  } finally {
    await other.close()
  }
})

test('nothing went wrong behind the scenes', async () => {
  expect(cue.pageErrors).toEqual([])
  expect(cue.errors()).toEqual([])
})
