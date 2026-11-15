import { describe, expect, it } from 'vitest'
import { BIBLE_BOOKS, findBook, formatReference, parseReference } from '@shared/scripture'

describe('findBook', () => {
  it('knows full names, common abbreviations and numbered books written every way', () => {
    expect(findBook('Genesis')?.id).toBe('GEN')
    expect(findBook('jn')?.id).toBe('JHN')
    expect(findBook('Phil.')?.id).toBe('PHP')
    expect(findBook('Philemon')?.id).toBe('PHM')
    expect(findBook('1 Cor')?.id).toBe('1CO')
    expect(findBook('1cor')?.id).toBe('1CO')
    expect(findBook('II Corinthians')?.id).toBe('2CO')
    expect(findBook('First John')?.id).toBe('1JN')
    expect(findBook('3rd John')?.id).toBe('3JN')
    expect(findBook('Song of Songs')?.id).toBe('SNG')
    expect(findBook('psalm')?.id).toBe('PSA')
  })

  it('accepts an unambiguous start of a name, nothing more', () => {
    expect(findBook('Deuter')?.id).toBe('DEU')
    expect(findBook('Zeph')?.id).toBe('ZEP')
    expect(findBook('e')).toBeNull()
    expect(findBook('Jo')).toBeNull()
    expect(findBook('Hezekiah')).toBeNull()
  })

  it('has every book with its chapter count', () => {
    expect(BIBLE_BOOKS).toHaveLength(66)
    expect(BIBLE_BOOKS.reduce((n, b) => n + b.chapters, 0)).toBe(1189)
  })
})

describe('parseReference', () => {
  it('reads single verses however they are typed', () => {
    const john316 = { book: 'JHN', chapter: 3, verse: 16 }
    expect(parseReference('John 3:16')).toEqual(john316)
    expect(parseReference('jn 3 16')).toEqual(john316)
    expect(parseReference('  JOHN 3.16 ')).toEqual(john316)
    expect(parseReference('John 3,16')).toEqual(john316)
    expect(parseReference('1 Thess. 5:16')).toEqual({ book: '1TH', chapter: 5, verse: 16 })
    expect(parseReference('1Cor13:4')).toEqual({ book: '1CO', chapter: 13, verse: 4 })
  })

  it('reads ranges, whole chapters and ranges across chapters', () => {
    expect(parseReference('1 Cor 13:4-7')).toEqual({
      book: '1CO',
      chapter: 13,
      verse: 4,
      endChapter: 13,
      endVerse: 7
    })
    expect(parseReference('Ps 23')).toEqual({ book: 'PSA', chapter: 23 })
    expect(parseReference('Rom 8:38–9:2')).toEqual({
      book: 'ROM',
      chapter: 8,
      verse: 38,
      endChapter: 9,
      endVerse: 2
    })
    expect(parseReference('Psalms 120-122')).toEqual({ book: 'PSA', chapter: 120, endChapter: 122 })
    expect(parseReference('John 3:16-16')).toEqual({ book: 'JHN', chapter: 3, verse: 16 })
  })

  it('reads a lone number in a one-chapter book as a verse', () => {
    expect(parseReference('Jude 3')).toEqual({ book: 'JUD', chapter: 1, verse: 3 })
    expect(parseReference('3 John 4')).toEqual({ book: '3JN', chapter: 1, verse: 4 })
    expect(parseReference('Philemon 1:6')).toEqual({ book: 'PHM', chapter: 1, verse: 6 })
    expect(parseReference('Jude 3-5')).toEqual({
      book: 'JUD',
      chapter: 1,
      verse: 3,
      endChapter: 1,
      endVerse: 5
    })
  })

  it('rejects what is not a reference', () => {
    expect(parseReference('John')).toBeNull()
    expect(parseReference('Psalm 151')).toBeNull()
    expect(parseReference('John 3:0')).toBeNull()
    expect(parseReference('John 3:18-16')).toBeNull()
    expect(parseReference('welcome to church')).toBeNull()
    expect(parseReference('Ephesus library 3')).toBeNull()
  })
})

describe('formatReference', () => {
  it('writes references the way they are printed', () => {
    expect(formatReference({ book: 'JHN', chapter: 3, verse: 16 })).toBe('John 3:16')
    expect(formatReference({ book: 'JHN', chapter: 3, verse: 16, endChapter: 3, endVerse: 18 })).toBe(
      'John 3:16–18'
    )
    expect(formatReference({ book: 'ROM', chapter: 8, verse: 38, endChapter: 9, endVerse: 2 })).toBe(
      'Romans 8:38–9:2'
    )
    expect(formatReference({ book: 'PSA', chapter: 23 })).toBe('Psalm 23')
    expect(formatReference({ book: 'PSA', chapter: 120, endChapter: 122 })).toBe('Psalms 120–122')
    expect(formatReference({ book: 'JUD', chapter: 1, verse: 3 })).toBe('Jude 3')
  })
})
