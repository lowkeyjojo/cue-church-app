import { expect, test } from '@playwright/test'
import { Cue, printLogsOnFailure } from './support/cue'

// Text on screen: a spontaneous slide typed mid-service, and a deck whose
// typo gets fixed while it is on screen.
test.describe.configure({ mode: 'serial' })
printLogsOnFailure()

let cue: Cue
test.beforeAll(async () => {
  cue = await Cue.launch()
})
test.afterAll(async () => {
  await cue?.close()
})

test('a quick text slide goes straight to the screen', async () => {
  await cue.control.keyboard.press('ControlOrMeta+t')
  const dialog = cue.control.getByRole('dialog', { name: 'Quick text slide' })
  await dialog.getByRole('textbox').fill('Please stand for the reading')
  // The dialog previews it exactly as the room will see it.
  await expect(dialog.getByText('Please stand for the reading', { exact: true }).last()).toBeVisible()
  await dialog.getByRole('button', { name: 'Show on TV' }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(async () => (await cue.state()).live?.title).toBe('Please stand for the reading')
  const output = await cue.output()
  await expect(output.getByText('Please stand for the reading')).toBeVisible()
})

test('a big word can be staged in Preview first', async () => {
  await cue.control.keyboard.press('ControlOrMeta+t')
  const dialog = cue.control.getByRole('dialog', { name: 'Quick text slide' })
  await dialog.getByRole('radio', { name: 'Big word' }).click()
  await dialog.getByRole('textbox').first().fill('PRAY')
  await dialog.getByRole('button', { name: 'Preview' }).click()
  await expect.poll(async () => (await cue.state()).preview?.title).toBe('PRAY')
  expect((await cue.state()).live?.title).toBe('Please stand for the reading')
  await cue.control.keyboard.press('Space')
  await expect.poll(async () => (await cue.state()).live?.title).toBe('PRAY')
})

test('slides edited while on screen update for the audience as you type', async () => {
  await cue.control.getByRole('button', { name: 'New service plan' }).click()
  await cue.control.getByRole('button', { name: 'Add to plan' }).click()
  await cue.control.getByRole('menuitem', { name: 'Text slides…' }).click()
  const editor = cue.control.getByRole('dialog')
  const title = editor.getByRole('textbox', { name: 'Title', exact: true })
  await title.fill('Amazing Grace')
  await editor.getByRole('button', { name: 'Show slide' }).click()
  const output = await cue.output()
  await expect(output.getByText('Amazing Grace', { exact: true })).toBeVisible()
  await expect(editor).toContainText('This deck is on screen')

  await title.fill('Amazing Grace — verse 1')
  await expect(output.getByText('Amazing Grace — verse 1', { exact: true })).toBeVisible()

  await editor.getByRole('button', { name: 'Add slide' }).click()
  await editor.getByRole('textbox', { name: 'Text', exact: true }).fill('How sweet the sound')
  await editor.getByRole('button', { name: 'Done' }).click()
  await expect(editor).toBeHidden()
  await expect
    .poll(async () => (await cue.library()).find((i) => i.kind === 'deck')?.deck?.slides.length)
    .toBe(2)
  // The live deck picked up the new slide: → goes to it.
  expect((await cue.state()).live?.pageCount).toBe(2)
  await cue.control.keyboard.press('ArrowRight')
  await expect(output.getByText('How sweet the sound')).toBeVisible()
})

test('a Bible verse goes on screen straight from the command palette', async () => {
  await cue.control.keyboard.press('ControlOrMeta+k')
  const palette = cue.control.getByRole('dialog', { name: 'Command palette' })
  await palette.getByRole('textbox').fill('jn 3 16')
  await expect(palette.getByRole('button', { name: 'John 3:16 (WEB)' })).toBeVisible()
  await cue.control.keyboard.press('Shift+Enter')
  await expect.poll(async () => (await cue.state()).live?.title).toBe('John 3:16 (WEB)')
  const output = await cue.output()
  await expect(output.getByText(/For God so loved the world/)).toBeVisible()
  await expect(output.getByText('John 3:16 (WEB)')).toBeVisible()
})

test('a long passage is shown over several slides, in the translation chosen', async () => {
  const psalm = await cue.invoke('scripture:passage', 'Psalm 23', 'kjv')
  expect(psalm.verses.map((v) => v.verse)).toEqual([1, 2, 3, 4, 5, 6])
  await cue.control.keyboard.press('ControlOrMeta+t')
  const dialog = cue.control.getByRole('dialog', { name: 'Quick text slide' })
  await dialog.getByRole('radio', { name: 'Scripture' }).click()
  await dialog.getByRole('radio', { name: 'KJV' }).click()
  const lookup = dialog.getByRole('textbox', { name: 'Look up a passage' })
  const show = dialog.getByRole('button', { name: 'Show on TV' })
  // A single verse becomes text to adjust before showing.
  await lookup.fill('John 11:35')
  await expect(dialog.getByRole('textbox', { name: 'Verse' })).toHaveValue('Jesus wept.')
  await expect(dialog.getByRole('textbox', { name: 'Reference' })).toHaveValue('John 11:35 (KJV)')
  // A reference that doesn't exist says why, and nothing looked up before stays ready to show.
  await lookup.fill('John 11:99')
  await expect(dialog).toContainText('John 11 has 57 verses')
  await expect(dialog.getByRole('textbox', { name: 'Verse' })).toHaveValue('')
  await expect(show).toBeDisabled()
  await lookup.fill('Psalm 23')
  await expect(dialog).toContainText('Psalm 23 (KJV) fills 3 slides')
  await lookup.fill('Psalm 23:9')
  await expect(dialog).toContainText('Psalm 23 has 6 verses')
  await expect(dialog).not.toContainText('fills 3 slides')
  await expect(show).toBeDisabled()
  await lookup.fill('Psalm 23')
  await expect(dialog).toContainText('Psalm 23 (KJV) fills 3 slides')
  await show.click()
  await expect.poll(async () => (await cue.state()).live?.title).toBe('Psalm 23 (KJV)')
  const output = await cue.output()
  await expect(output.getByText(/The LORD is my shepherd/)).toBeVisible()
  await cue.control.keyboard.press('ArrowRight')
  await expect(output.getByText(/Yea, though I walk through the valley/)).toBeVisible()
  expect((await cue.state()).live?.page).toBe(1)
  // Shown for the moment rather than kept: it isn't added to the library.
  expect((await cue.library()).find((i) => i.name === 'Psalm 23 (KJV)')?.saved).toBe(false)
})

test('nothing went wrong behind the scenes', async () => {
  expect(cue.pageErrors).toEqual([])
  expect(cue.errors()).toEqual([])
})
