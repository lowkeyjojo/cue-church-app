import { expect, test } from '@playwright/test'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MediaItem } from '../../src/shared/types'
import { brightness, Cue, fixture, type Rgb } from './support/cue'
import { makePdf } from './support/pdf'
import { gradientPng } from './support/png'
import { makeWav } from './support/wav'

// Bringing in the church's own media and running it: photos, PDF slides,
// video and audio, with the on-screen controls an operator reaches for.
test.describe.configure({ mode: 'serial' })

let cue: Cue
let dir: string
let items: Record<'photo' | 'slides' | 'video' | 'tone', MediaItem>

const dominant = (c: Rgb) => (c.r > c.g && c.r > c.b ? 'red' : c.g > c.b ? 'green' : 'blue')

test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cue-media-'))
  await writeFile(join(dir, 'sunrise-portrait.png'), gradientPng(600, 1000, [250, 200, 120], [200, 120, 60]))
  await writeFile(
    join(dir, 'sermon-notes.pdf'),
    makePdf([
      { title: 'Point one', color: [190, 40, 40] },
      { title: 'Point two', color: [40, 170, 60] },
      { title: 'Point three', color: [40, 70, 200] }
    ])
  )
  await writeFile(join(dir, 'organ-tone.wav'), makeWav(4))
  await copyFile(fixture('clip.webm'), join(dir, 'baptism-clip.webm'))
  cue = await Cue.launch()
})
test.afterAll(async () => {
  await cue?.close()
  await rm(dir, { recursive: true, force: true })
})

test('imports photos, PDFs, video and audio with friendly names', async () => {
  const [photo, slides, video, tone] = await cue.import(
    ['sunrise-portrait.png', 'sermon-notes.pdf', 'baptism-clip.webm', 'organ-tone.wav'].map((f) =>
      join(dir, f)
    )
  )
  items = { photo, slides, video, tone }
  expect(photo).toMatchObject({
    kind: 'image',
    name: 'Sunrise portrait',
    width: 600,
    height: 1000,
    status: 'ready'
  })
  expect(slides).toMatchObject({ kind: 'pdf', name: 'Sermon notes', pageCount: 3, status: 'ready' })
  expect(video).toMatchObject({
    kind: 'video',
    name: 'Baptism clip',
    width: 320,
    height: 180,
    status: 'ready'
  })
  expect(video.duration).toBeCloseTo(3, 0)
  expect(tone).toMatchObject({ kind: 'audio', name: 'Organ tone', status: 'ready' })
  expect(tone.duration).toBeCloseTo(4, 0)

  await cue.control.getByRole('tab', { name: 'Library' }).click()
  const tiles = cue.control.getByTestId('library-tile')
  for (const name of ['Sunrise portrait', 'Sermon notes', 'Baptism clip', 'Organ tone']) {
    await expect(tiles.filter({ hasText: name })).toBeVisible()
  }
})

test('importing the same file twice reuses the library item', async () => {
  const [again] = await cue.import([join(dir, 'sunrise-portrait.png')])
  expect(again.id).toBe(items.photo.id)
})

test('a PDF pages forward and back on screen', async () => {
  await cue.control.getByTestId('library-tile').filter({ hasText: 'Sermon notes' }).dblclick()
  await expect.poll(async () => (await cue.state()).live?.title).toBe('Sermon notes')
  await expect.poll(async () => dominant(await cue.outputColor())).toBe('red')
  await cue.control.keyboard.press('ArrowRight')
  await expect.poll(async () => dominant(await cue.outputColor())).toBe('green')
  await cue.control.keyboard.press('ArrowRight')
  await expect.poll(async () => dominant(await cue.outputColor())).toBe('blue')
  // At the end it stays put (and says so) rather than jumping elsewhere.
  await cue.control.keyboard.press('ArrowRight')
  expect((await cue.state()).live?.page).toBe(2)
  await cue.control.keyboard.press('ArrowLeft')
  await expect.poll(async () => dominant(await cue.outputColor())).toBe('green')
})

test('fit letterboxes a portrait photo; F switches to fill; zoom keys zoom and reset', async () => {
  await cue.dispatch({ type: 'show', target: { type: 'media', mediaId: items.photo.id } })
  await expect.poll(async () => (await cue.state()).live?.title).toBe('Sunrise portrait')
  const leftEdge: [number, number, number, number] = [0, 0.2, 0.12, 0.8]
  await expect.poll(async () => brightness(await cue.outputColor(leftEdge))).toBeLessThan(3)

  await cue.control.keyboard.press('f')
  await expect.poll(async () => (await cue.state()).live?.fit).toBe('fill')
  await expect.poll(async () => brightness(await cue.outputColor(leftEdge))).toBeGreaterThan(60)

  await cue.control.keyboard.press('=')
  await expect.poll(async () => (await cue.state()).live?.zoom?.scale ?? 1).toBeGreaterThan(1)
  await cue.control.keyboard.press('0')
  await expect.poll(async () => (await cue.state()).live?.zoom).toBeUndefined()
})

test('video plays, pauses with K, and seeks', async () => {
  await cue.dispatch({ type: 'show', target: { type: 'media', mediaId: items.video.id } })
  await expect.poll(async () => (await cue.playback())?.currentTime ?? 0).toBeGreaterThan(0.4)
  await expect.poll(async () => brightness(await cue.outputColor())).toBeGreaterThan(60)

  await cue.control.keyboard.press('k')
  await expect.poll(async () => (await cue.playback())?.paused).toBe(true)
  const pausedAt = (await cue.playback())!.currentTime
  await cue.control.waitForTimeout(500)
  expect((await cue.playback())!.currentTime).toBeCloseTo(pausedAt, 1)

  await cue.dispatch({ type: 'seek', time: 2.5 })
  await expect.poll(async () => (await cue.playback())?.currentTime ?? 0).toBeGreaterThan(2.3)
  await cue.control.keyboard.press('k')
  await expect.poll(async () => (await cue.playback())?.paused).toBe(false)
})

test('audio plays through the output', async () => {
  await cue.dispatch({ type: 'show', target: { type: 'media', mediaId: items.tone.id } })
  await expect.poll(async () => (await cue.state()).live?.kind).toBe('audio')
  await expect.poll(async () => (await cue.playback())?.currentTime ?? 0).toBeGreaterThan(0.4)
})

test('media on screen cannot be deleted until it is cleared', async () => {
  await expect(cue.invoke('library:remove', [items.tone.id])).rejects.toThrow(/on screen right now/)
  await cue.dispatch({ type: 'clear' })
  await cue.invoke('library:remove', [items.tone.id])
  expect((await cue.library()).some((i) => i.id === items.tone.id)).toBe(false)
})

test('nothing went wrong behind the scenes', async () => {
  expect(cue.pageErrors).toEqual([])
  expect(cue.errors()).toEqual([])
})
