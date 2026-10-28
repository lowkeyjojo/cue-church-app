/**
 * Bible references: reading what an operator types ("Rom 8:28", "1 cor 13 4-7",
 * "Ps 23") and writing it back neatly ("Romans 8:28").
 */

export interface BibleBook {
  /** USFM code, e.g. "JHN". */
  id: string
  name: string
  chapters: number
  /** Extra names and abbreviations, lowercase, without dots. */
  aliases: string[]
}

/** The 66 books in canonical order, with how many chapters each has. */
export const BIBLE_BOOKS: BibleBook[] = [
  { id: 'GEN', name: 'Genesis', chapters: 50, aliases: ['gen', 'ge', 'gn'] },
  { id: 'EXO', name: 'Exodus', chapters: 40, aliases: ['exod', 'exo', 'ex'] },
  { id: 'LEV', name: 'Leviticus', chapters: 27, aliases: ['lev', 'le', 'lv'] },
  { id: 'NUM', name: 'Numbers', chapters: 36, aliases: ['num', 'nu', 'nm', 'nb'] },
  { id: 'DEU', name: 'Deuteronomy', chapters: 34, aliases: ['deut', 'deu', 'de', 'dt'] },
  { id: 'JOS', name: 'Joshua', chapters: 24, aliases: ['josh', 'jos', 'jsh'] },
  { id: 'JDG', name: 'Judges', chapters: 21, aliases: ['judg', 'jdg', 'jg', 'jdgs'] },
  { id: 'RUT', name: 'Ruth', chapters: 4, aliases: ['ru', 'rth'] },
  { id: '1SA', name: '1 Samuel', chapters: 31, aliases: ['1 sam', '1 sa', '1 sm', '1 s'] },
  { id: '2SA', name: '2 Samuel', chapters: 24, aliases: ['2 sam', '2 sa', '2 sm', '2 s'] },
  { id: '1KI', name: '1 Kings', chapters: 22, aliases: ['1 kgs', '1 ki', '1 kin', '1 k'] },
  { id: '2KI', name: '2 Kings', chapters: 25, aliases: ['2 kgs', '2 ki', '2 kin', '2 k'] },
  { id: '1CH', name: '1 Chronicles', chapters: 29, aliases: ['1 chron', '1 chr', '1 ch'] },
  { id: '2CH', name: '2 Chronicles', chapters: 36, aliases: ['2 chron', '2 chr', '2 ch'] },
  { id: 'EZR', name: 'Ezra', chapters: 10, aliases: ['ezr'] },
  { id: 'NEH', name: 'Nehemiah', chapters: 13, aliases: ['neh', 'ne'] },
  { id: 'EST', name: 'Esther', chapters: 10, aliases: ['esth', 'est', 'es'] },
  { id: 'JOB', name: 'Job', chapters: 42, aliases: ['jb'] },
  { id: 'PSA', name: 'Psalms', chapters: 150, aliases: ['psalm', 'ps', 'psa', 'pss', 'psm'] },
  { id: 'PRO', name: 'Proverbs', chapters: 31, aliases: ['prov', 'pro', 'prv', 'pr'] },
  { id: 'ECC', name: 'Ecclesiastes', chapters: 12, aliases: ['eccl', 'eccles', 'ecc', 'ec', 'qoh'] },
  {
    id: 'SNG',
    name: 'Song of Solomon',
    chapters: 8,
    aliases: ['song of songs', 'song', 'songs', 'sos', 'sng', 'canticles', 'cant']
  },
  { id: 'ISA', name: 'Isaiah', chapters: 66, aliases: ['isa', 'is'] },
  { id: 'JER', name: 'Jeremiah', chapters: 52, aliases: ['jer', 'je', 'jr'] },
  { id: 'LAM', name: 'Lamentations', chapters: 5, aliases: ['lam', 'la'] },
  { id: 'EZK', name: 'Ezekiel', chapters: 48, aliases: ['ezek', 'eze', 'ezk'] },
  { id: 'DAN', name: 'Daniel', chapters: 12, aliases: ['dan', 'da', 'dn'] },
  { id: 'HOS', name: 'Hosea', chapters: 14, aliases: ['hos', 'ho'] },
  { id: 'JOL', name: 'Joel', chapters: 3, aliases: ['jl'] },
  { id: 'AMO', name: 'Amos', chapters: 9, aliases: ['am'] },
  { id: 'OBA', name: 'Obadiah', chapters: 1, aliases: ['obad', 'ob'] },
  { id: 'JON', name: 'Jonah', chapters: 4, aliases: ['jnh', 'jon'] },
  { id: 'MIC', name: 'Micah', chapters: 7, aliases: ['mic', 'mc'] },
  { id: 'NAM', name: 'Nahum', chapters: 3, aliases: ['nah', 'na'] },
  { id: 'HAB', name: 'Habakkuk', chapters: 3, aliases: ['hab', 'hb'] },
  { id: 'ZEP', name: 'Zephaniah', chapters: 3, aliases: ['zeph', 'zep', 'zp'] },
  { id: 'HAG', name: 'Haggai', chapters: 2, aliases: ['hag', 'hg'] },
  { id: 'ZEC', name: 'Zechariah', chapters: 14, aliases: ['zech', 'zec', 'zc'] },
  { id: 'MAL', name: 'Malachi', chapters: 4, aliases: ['mal', 'ml'] },
  { id: 'MAT', name: 'Matthew', chapters: 28, aliases: ['matt', 'mat', 'mt'] },
  { id: 'MRK', name: 'Mark', chapters: 16, aliases: ['mrk', 'mar', 'mk', 'mr'] },
  { id: 'LUK', name: 'Luke', chapters: 24, aliases: ['luk', 'lk'] },
  { id: 'JHN', name: 'John', chapters: 21, aliases: ['joh', 'jhn', 'jn'] },
  { id: 'ACT', name: 'Acts', chapters: 28, aliases: ['act', 'ac'] },
  { id: 'ROM', name: 'Romans', chapters: 16, aliases: ['rom', 'ro', 'rm'] },
  { id: '1CO', name: '1 Corinthians', chapters: 16, aliases: ['1 cor', '1 co'] },
  { id: '2CO', name: '2 Corinthians', chapters: 13, aliases: ['2 cor', '2 co'] },
  { id: 'GAL', name: 'Galatians', chapters: 6, aliases: ['gal', 'ga'] },
  { id: 'EPH', name: 'Ephesians', chapters: 6, aliases: ['eph', 'ephes'] },
  { id: 'PHP', name: 'Philippians', chapters: 4, aliases: ['phil', 'php', 'pp'] },
  { id: 'COL', name: 'Colossians', chapters: 4, aliases: ['col', 'co'] },
  { id: '1TH', name: '1 Thessalonians', chapters: 5, aliases: ['1 thess', '1 thes', '1 th'] },
  { id: '2TH', name: '2 Thessalonians', chapters: 3, aliases: ['2 thess', '2 thes', '2 th'] },
  { id: '1TI', name: '1 Timothy', chapters: 6, aliases: ['1 tim', '1 ti'] },
  { id: '2TI', name: '2 Timothy', chapters: 4, aliases: ['2 tim', '2 ti'] },
  { id: 'TIT', name: 'Titus', chapters: 3, aliases: ['tit', 'ti'] },
  { id: 'PHM', name: 'Philemon', chapters: 1, aliases: ['philem', 'phlm', 'phm', 'pm'] },
  { id: 'HEB', name: 'Hebrews', chapters: 13, aliases: ['heb'] },
  { id: 'JAS', name: 'James', chapters: 5, aliases: ['jas', 'jm'] },
  { id: '1PE', name: '1 Peter', chapters: 5, aliases: ['1 pet', '1 pe', '1 pt', '1 p'] },
  { id: '2PE', name: '2 Peter', chapters: 3, aliases: ['2 pet', '2 pe', '2 pt', '2 p'] },
  { id: '1JN', name: '1 John', chapters: 5, aliases: ['1 jn', '1 jhn', '1 jo', '1 joh'] },
  { id: '2JN', name: '2 John', chapters: 1, aliases: ['2 jn', '2 jhn', '2 jo', '2 joh'] },
  { id: '3JN', name: '3 John', chapters: 1, aliases: ['3 jn', '3 jhn', '3 jo', '3 joh'] },
  { id: 'JUD', name: 'Jude', chapters: 1, aliases: ['jud', 'jd'] },
  { id: 'REV', name: 'Revelation', chapters: 22, aliases: ['rev', 're', 'revelations', 'apocalypse'] }
]

export interface ScriptureRef {
  book: string
  chapter: number
  /** First verse; absent for a whole chapter. */
  verse?: number
  /** Last chapter and verse of a range (inclusive). */
  endChapter?: number
  endVerse?: number
}

const ORDINALS: Record<string, string> = {
  first: '1',
  second: '2',
  third: '3',
  i: '1',
  ii: '2',
  iii: '3',
  '1st': '1',
  '2nd': '2',
  '3rd': '3'
}

/** Book names as typed: lowercase, no dots, "1st"/"II"/"First" → "1", digit and name split by one space. */
function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\./g, ' ')
    .trim()
    .replace(/^(first|second|third|1st|2nd|3rd|iii|ii|i)\s+(?=[a-z])/, (w) => `${ORDINALS[w.trim()]} `)
    .replace(/^(\d)\s*([a-z])/, '$1 $2')
    .replace(/\s+/g, ' ')
}

const lookup = new Map<string, BibleBook>()
for (const book of BIBLE_BOOKS) {
  for (const name of [book.name, book.id, ...book.aliases]) lookup.set(normalizeName(name), book)
}

/** Find a book by any of its names or abbreviations, or by an unambiguous start of its name. */
export function findBook(raw: string): BibleBook | null {
  const name = normalizeName(raw)
  if (!name) return null
  const exact = lookup.get(name) ?? lookup.get(name.replace(/ /g, ''))
  if (exact) return exact
  const starts = BIBLE_BOOKS.filter((b) => normalizeName(b.name).startsWith(name))
  return starts.length === 1 ? starts[0] : null
}

const REF =
  /^(?<book>(?:[1-3]|i{1,3}|first|second|third|1st|2nd|3rd)?\s*\.?\s*[a-z][a-z .]*?)\s*(?<chapter>\d{1,3})(?:\s*(?:[:.,]|\s)\s*(?<verse>\d{1,3}))?(?:\s*[-–—]\s*(?<a>\d{1,3})(?:\s*[:.]\s*(?<b>\d{1,3}))?)?\s*$/i

/** Read a reference like "John 3:16", "jn 3 16-18", "1 Cor 13", "Rom 8:38-9:2" or "Jude 3". */
export function parseReference(text: string): ScriptureRef | null {
  const m = REF.exec(text.trim())
  if (!m?.groups) return null
  const book = findBook(m.groups.book)
  if (!book) return null
  let chapter = Number(m.groups.chapter)
  let verse = m.groups.verse ? Number(m.groups.verse) : undefined
  const a = m.groups.a ? Number(m.groups.a) : undefined
  const b = m.groups.b ? Number(m.groups.b) : undefined
  // In one-chapter books a lone number is a verse: "Jude 3".
  if (book.chapters === 1 && verse === undefined && chapter > 1) {
    verse = chapter
    chapter = 1
  }
  if (chapter < 1 || chapter > book.chapters || verse === 0) return null
  const ref: ScriptureRef = { book: book.id, chapter, verse }
  if (a !== undefined) {
    if (b !== undefined) {
      // "8:38-9:2"
      ref.endChapter = a
      ref.endVerse = b
    } else if (verse !== undefined) {
      // "3:16-18"
      ref.endChapter = chapter
      ref.endVerse = a
    } else if (book.chapters === 1) {
      // "Jude 3-5" was read as chapter 3 to 5 of a one-chapter book
      ref.verse = chapter
      ref.chapter = 1
      ref.endChapter = 1
      ref.endVerse = a
    } else {
      // "Ps 120-122": whole chapters
      ref.endChapter = a
    }
    const endChapter = ref.endChapter ?? chapter
    if (endChapter > book.chapters || endChapter < ref.chapter) return null
    if (endChapter === ref.chapter && ref.endVerse !== undefined && ref.endVerse < (ref.verse ?? 1))
      return null
    if (endChapter === ref.chapter && ref.endVerse === ref.verse) {
      delete ref.endChapter
      delete ref.endVerse
    }
  }
  return ref
}

/** "John 3:16", "John 3:16-18", "Romans 8:38–9:2", "Psalm 23", "Jude 3". */
export function formatReference(ref: ScriptureRef): string {
  const book = BIBLE_BOOKS.find((b) => b.id === ref.book)
  const name =
    book?.id === 'PSA' && (ref.endChapter ?? ref.chapter) === ref.chapter ? 'Psalm' : (book?.name ?? ref.book)
  const oneChapter = book?.chapters === 1
  const start =
    ref.verse === undefined ? `${ref.chapter}` : oneChapter ? `${ref.verse}` : `${ref.chapter}:${ref.verse}`
  const endVerse = ref.endVerse
  let end = ''
  if (ref.endChapter !== undefined && ref.endChapter !== ref.chapter) {
    end = endVerse !== undefined ? `–${ref.endChapter}:${endVerse}` : `–${ref.endChapter}`
  } else if (endVerse !== undefined && endVerse !== ref.verse) {
    end = `–${endVerse}`
  }
  return `${name} ${start}${end}`
}

export interface PassageVerse {
  chapter: number
  verse: number
  text: string
}

export interface Passage {
  /** Formatted reference, e.g. "John 3:16–18". */
  reference: string
  /** Translation abbreviation, e.g. "WEB". */
  translation: string
  verses: PassageVerse[]
}

export const BIBLE_TRANSLATIONS = [
  { id: 'web', abbr: 'WEB', name: 'World English Bible' },
  { id: 'kjv', abbr: 'KJV', name: 'King James Version' }
] as const

export type TranslationId = (typeof BIBLE_TRANSLATIONS)[number]['id']

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const superscript = (n: number) => [...String(n)].map((d) => SUPERSCRIPT[Number(d)]).join('')

/** The passage as slide text: verse numbers (as superscripts) only when there's more than one verse. */
export function passageText(verses: PassageVerse[]): string {
  if (verses.length === 1) return verses[0].text
  return verses.map((v) => `${superscript(v.verse)} ${v.text}`).join(' ')
}

/** Whole verses, in order, in groups of up to `cap` characters (a longer verse stands alone). */
function groupVerses(verses: PassageVerse[], cap: number): PassageVerse[][] {
  const groups: PassageVerse[][] = []
  let current: PassageVerse[] = []
  let length = 0
  for (const v of verses) {
    const size = v.text.length + 4
    if (current.length && length + size > cap) {
      groups.push(current)
      current = []
      length = 0
    }
    current.push(v)
    length += size
  }
  if (current.length) groups.push(current)
  return groups
}

/**
 * Split a long passage into slide-sized groups of whole verses, each with its
 * own reference ("John 3:16–17"), so nothing has to shrink to fit. It uses as
 * few slides as it can and fills them evenly, so no slide ends up with a lone
 * line.
 */
export function splitPassage(passage: Passage, book: string, maxChars = 340): Passage[] {
  const count = groupVerses(passage.verses, maxChars).length
  if (count <= 1) return [passage]
  // The smallest size per slide that still needs no more slides.
  let lo = 1
  let hi = Math.max(maxChars, ...passage.verses.map((v) => v.text.length + 4))
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (groupVerses(passage.verses, mid).length <= count) hi = mid
    else lo = mid + 1
  }
  return groupVerses(passage.verses, lo).map((verses) => {
    const first = verses[0]
    const last = verses[verses.length - 1]
    const reference = formatReference({
      book,
      chapter: first.chapter,
      verse: first.verse,
      endChapter: last.chapter,
      endVerse: last.verse
    })
    return { reference, translation: passage.translation, verses }
  })
}
