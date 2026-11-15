import { describe, expect, it } from 'vitest'
import { deepMerge, domainOf, formatTime, prettyName } from '@shared/util'

describe('prettyName', () => {
  it('turns slugs into readable names', () => {
    expect(prettyName('asia-minor-map.jpg')).toBe('Asia minor map')
    expect(prettyName('my_sermon_slides.pdf')).toBe('My sermon slides')
  })
  it('keeps meaningful dashes and existing capitalisation', () => {
    expect(prettyName('Sermon - Part 1.pdf')).toBe('Sermon - Part 1')
    expect(prettyName('IMG_1234.HEIC')).toBe('IMG 1234')
  })
})

describe('formatTime', () => {
  it('formats seconds and hours', () => {
    expect(formatTime(7)).toBe('0:07')
    expect(formatTime(151)).toBe('2:31')
    expect(formatTime(3729)).toBe('1:02:09')
    expect(formatTime(Number.NaN)).toBe('0:00')
  })
})

describe('deepMerge', () => {
  it('merges nested objects and replaces arrays', () => {
    const base = { a: { b: 1, c: [1, 2] }, d: 'x' }
    expect(deepMerge(base, { a: { c: [3] }, d: undefined })).toEqual({ a: { b: 1, c: [3] }, d: 'x' })
  })
})

describe('domainOf', () => {
  it('strips www and tolerates junk', () => {
    expect(domainOf('https://www.wikipedia.org/wiki/Ephesus')).toBe('wikipedia.org')
    expect(domainOf('not a url')).toBe('')
  })
})
