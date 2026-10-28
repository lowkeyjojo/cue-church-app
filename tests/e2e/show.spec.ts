import { expect, test } from '@playwright/test'
import { brightness, Cue } from './support/cue'

// A brand-new install: the welcome walkthrough, then the sample service run
// the way an operator would on a Sunday morning.
test.describe.configure({ mode: 'serial' })

let cue: Cue
test.beforeAll(async () => {
  cue = await Cue.launch({ firstRun: true })
})
test.afterAll(async () => {
  await cue?.close()
})

test('first run walks through setup and names the screen', async () => {
  const dialog = cue.control.getByRole('dialog')
  await expect(dialog).toContainText('Welcome to Cue')
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await expect(dialog).toContainText('Your audience screen')
  await dialog.getByRole('textbox').fill('Projector')
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await expect(dialog).toContainText('Three keys to remember')
  await dialog.getByRole('button', { name: 'Start using Cue' }).click()
  await expect(dialog).toBeHidden()
  await expect(cue.control.getByTestId('take')).toHaveText(/Show on Projector/)
})

test('the sample service is ready to run', async () => {
  const entries = cue.control.getByTestId('plan-entry')
  await expect(entries.filter({ hasText: 'Welcome & announcements' })).toBeVisible()
  await expect(entries.filter({ hasText: 'The Light of the World' })).toBeVisible()
  await expect(entries.filter({ hasText: 'Countdown' })).toBeVisible()
})

test('preview first: nothing reaches the screen until Show', async () => {
  await cue.control.getByTestId('plan-entry').filter({ hasText: 'Welcome & announcements' }).click()
  await expect.poll(async () => (await cue.state()).preview?.title).toBe('Welcome & announcements')
  expect((await cue.state()).live).toBeNull()
  expect(brightness(await cue.outputColor())).toBeLessThan(3)

  await cue.control.getByTestId('take').click()
  await expect.poll(async () => (await cue.state()).live?.title).toBe('Welcome & announcements')
  const output = await cue.output()
  await expect(output.locator('.stage-slot[data-kind="deck"]')).toBeVisible()
  await expect(output.getByText("We're so glad you're here")).toBeVisible()
  // Standby: the next item in the plan is staged automatically.
  expect((await cue.state()).preview?.title).toBe('Sermon — The Light of the World')
})

test('arrow keys page through slides; the first press after blackout only lifts it', async () => {
  const output = await cue.output()
  await cue.control.keyboard.press('ArrowRight')
  await expect(output.getByText('Prayer meeting — Wednesday 7 pm')).toBeVisible()
  expect((await cue.state()).live?.page).toBe(1)

  await cue.control.keyboard.press('b')
  await expect.poll(async () => (await cue.state()).blackout).toBe(true)
  await expect.poll(async () => brightness(await cue.outputColor())).toBeLessThan(3)
  await expect(cue.control.getByTestId('blackout')).toHaveAttribute('aria-pressed', 'true')

  await cue.control.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await cue.state()).blackout).toBe(false)
  expect((await cue.state()).live?.page).toBe(1)
  await expect.poll(async () => brightness(await cue.outputColor())).toBeGreaterThan(3)
})

test('Space takes the standby; Back returns to the slides at the same page', async () => {
  await cue.control.keyboard.press('Space')
  await expect.poll(async () => (await cue.state()).live?.title).toBe('Sermon — The Light of the World')
  await cue.control.keyboard.press('ArrowRight')
  await expect.poll(async () => (await cue.state()).live?.page).toBe(1)

  // Something spontaneous: a quick colour, then back to the sermon.
  await cue.dispatch({ type: 'show', target: { type: 'color', color: '#2255aa', title: 'Blue' } })
  await expect.poll(async () => (await cue.state()).live?.kind).toBe('color')
  await expect(cue.control.getByTestId('back')).toBeEnabled()
  await cue.control.getByTestId('back').click()
  await expect.poll(async () => (await cue.state()).live?.title).toBe('Sermon — The Light of the World')
  expect((await cue.state()).live?.page).toBe(1)
  const screen = await cue.screen()
  await expect(screen.getByText('Then spake Jesus again unto them', { exact: false })).toBeVisible()
})

test('ambient covers the screen for a break and the next key brings the content back', async () => {
  await cue.control.getByTestId('ambient').click()
  await expect.poll(async () => (await cue.state()).ambient.active).toBe(true)
  const output = await cue.output()
  await expect(output.locator('.stage-ambient')).toHaveCSS('opacity', '1')
  await cue.control.keyboard.press('ArrowRight')
  await expect.poll(async () => (await cue.state()).ambient.active).toBe(false)
  expect((await cue.state()).live?.page).toBe(1)
})

test('the countdown plays on the ambient background', async () => {
  await cue.control.getByTestId('plan-entry').filter({ hasText: 'Countdown' }).dblclick()
  await expect.poll(async () => (await cue.state()).live?.kind).toBe('ambient')
  const output = await cue.output()
  await expect(output.getByText('The service begins in')).toBeVisible()
  await expect(output.getByText(/^[0-9]:[0-5][0-9]$/)).toBeVisible()
})

test('nothing went wrong behind the scenes', async () => {
  expect(cue.pageErrors).toEqual([])
  expect(cue.errors()).toEqual([])
})
