import { expect, test, type Locator } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { newDeck, newSlide } from '../../src/shared/defaults'
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
  // Slides live in the library file rather than a media folder; they travel too.
  const deck = await cue.invoke(
    'library:createDeck',
    'Welcome slides',
    newDeck({ slides: [newSlide({ layout: 'title', title: 'He is risen' })] })
  )
  const [plan] = await cue.plans()
  await cue.invoke('plans:addEntries', plan.id, [{ type: 'media', mediaId: deck.id }])
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
    const [imported] = await other.plans()
    expect(imported.entries.map((e) => e.type)).toEqual(['media', 'media', 'section', 'color', 'media'])
    const library = await other.library()
    expect(library.map((i) => i.name).sort()).toEqual(['Cross at dawn', 'Empty tomb', 'Welcome slides'])
    expect(library.filter((i) => i.kind === 'image').every((i) => i.width === 1280)).toBe(true)
    expect(library.find((i) => i.kind === 'deck')?.deck?.slides[0].title).toBe('He is risen')
    await other.control.getByTestId('plan-entry').first().dblclick()
    await expect.poll(async () => (await other.state()).live?.title).toBe('Empty tomb')
    expect(other.errors()).toEqual([])
  } finally {
    await other.close()
  }
})

test('opening a .cueplan file (double-click) imports it and brings it up', async () => {
  const other = await Cue.launch({ args: [join(dir, 'easter.cueplan')] })
  try {
    await expect(other.control.getByRole('button', { name: 'Switch service plan' })).toContainText(
      'Easter Sunday'
    )
    await expect(other.control.getByText('Plan imported')).toBeVisible()
    await expect(other.control.getByTestId('plan-entry')).toHaveCount(4)
    expect(other.errors()).toEqual([])
  } finally {
    await other.close()
  }
})

test('a tampered plan file cannot reach outside Cue', async () => {
  // A folder next to Cue's data that a crafted file tries to pull into the library.
  const victim = join(dir, `victim-${Date.now()}`)
  await mkdir(victim)
  await writeFile(join(victim, 'notes.txt'), 'keep me')
  const escape = `../../../${basename(victim)}`
  const manifest = {
    format: 'cue-plan',
    version: 1,
    exportedAt: new Date().toISOString(),
    plan: { id: 'x', name: 'Tampered', entries: [{ id: 'e', type: 'media', mediaId: escape }] },
    items: [{ id: escape, kind: 'image', name: 'Evil', file: '../../notes.txt', status: 'ready', source: {} }]
  }
  const bad = join(dir, 'tampered.cueplan')
  await writeFile(bad, zipSync({ 'plan.json': strToU8(JSON.stringify(manifest)) }))

  const other = await Cue.launch({ dataDir: join(dir, 'tamper-data') })
  try {
    await other.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [path]
      })) as typeof dialog.showOpenDialog
    }, bad)
    await other.invoke('plans:import')
    expect(await readdir(victim)).toEqual(['notes.txt'])
    expect(await other.library()).toEqual([])
  } finally {
    await other.close()
  }
})

test('nothing went wrong behind the scenes', async () => {
  expect(cue.pageErrors).toEqual([])
  expect(cue.errors()).toEqual([])
})
