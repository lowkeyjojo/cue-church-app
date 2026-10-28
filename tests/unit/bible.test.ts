import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Bible } from '../../src/main/scripture/bible'
import { passageText, splitPassage } from '@shared/scripture'

const bible = new Bible((id) => readFile(join(import.meta.dirname, '../../resources/bible', `${id}.json.gz`)))

describe('Bible', () => {
  it('looks up a verse in either translation', async () => {
    const web = await bible.passage('John 3:16', 'web')
    expect(web.reference).toBe('John 3:16')
    expect(web.translation).toBe('WEB')
    expect(web.verses).toHaveLength(1)
    expect(web.verses[0].text).toMatch(/^For God so loved the world/)
    const kjv = await bible.passage('jn 3 16', 'kjv')
    expect(kjv.translation).toBe('KJV')
    expect(kjv.verses[0].text).toMatch(/only begotten Son/)
  })

  it('returns ranges, whole chapters and ranges across chapters', async () => {
    expect((await bible.passage('1 Cor 13:4-7')).verses.map((v) => v.verse)).toEqual([4, 5, 6, 7])
    expect((await bible.passage('Psalm 23')).verses).toHaveLength(6)
    const across = await bible.passage('Rom 8:38-9:2')
    expect(across.reference).toBe('Romans 8:38–9:2')
    expect(across.verses.map((v) => `${v.chapter}:${v.verse}`)).toEqual(['8:38', '8:39', '9:1', '9:2'])
  })

  it('explains what went wrong', async () => {
    await expect(bible.passage('John 3:99')).rejects.toThrow('John 3 has 36 verses')
    await expect(bible.passage('Hezekiah 1:1')).rejects.toThrow("isn't a Bible reference")
    // The WEB keeps this later addition in a footnote.
    await expect(bible.passage('Acts 8:37', 'web')).rejects.toThrow("isn't in the WEB text")
    await expect(bible.passage('Psalms 1-150')).rejects.toThrow('too long')
  })

  it('numbers verses only when there is more than one, and splits long passages into slides', async () => {
    const one = await bible.passage('John 11:35', 'kjv')
    expect(passageText(one.verses)).toBe('Jesus wept.')
    const psalm = await bible.passage('Psalm 23', 'kjv')
    expect(passageText(psalm.verses)).toMatch(/^¹ The LORD is my shepherd; I shall not want\. ² He maketh me/)
    const slides = splitPassage(psalm, psalm.book)
    expect(slides.length).toBeGreaterThan(1)
    expect(slides.flatMap((s) => s.verses)).toEqual(psalm.verses)
    expect(slides[0].reference).toMatch(/^Psalm 23:1–/)
  })

  it('fills the slides of a long passage evenly, with no lone verse at the end', async () => {
    const psalm = await bible.passage('Psalm 23', 'kjv')
    // Filled greedily this would be verses 1–3, 4–5 and 6 on its own.
    expect(splitPassage(psalm, psalm.book).map((s) => s.reference)).toEqual([
      'Psalm 23:1–3',
      'Psalm 23:4',
      'Psalm 23:5–6'
    ])
    const chapter = await bible.passage('1 Corinthians 13', 'web')
    const slides = splitPassage(chapter, chapter.book)
    const sizes = slides.map((s) => passageText(s.verses).length)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(340 + 4 * 13)
    expect(Math.min(...sizes)).toBeGreaterThan(Math.max(...sizes) / 3)
  })
})
