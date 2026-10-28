import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import {
  BIBLE_BOOKS,
  BIBLE_TRANSLATIONS,
  formatReference,
  parseReference,
  type Passage,
  type PassageVerse,
  type TranslationId
} from '@shared/scripture'
import { UserError } from '../errors'

interface BibleData {
  id: string
  abbr: string
  books: { id: string; chapters: string[][] }[]
}

/** Longest passage Cue will put on slides in one go. */
const MAX_VERSES = 176

/** The bundled public-domain translations, loaded the first time they're needed. */
export class Bible {
  private loaded = new Map<string, Promise<BibleData>>()

  /** `read` returns a translation's gzipped data file (`resources/bible/<id>.json.gz`). */
  constructor(private read: (id: TranslationId) => Promise<Buffer>) {}

  private load(id: TranslationId): Promise<BibleData> {
    let data = this.loaded.get(id)
    if (!data) {
      data = this.read(id)
        .then((zipped) => promisify(gunzip)(zipped))
        .then((json) => JSON.parse(json.toString('utf8')) as BibleData)
      // A failed load can be retried.
      data.catch(() => this.loaded.delete(id))
      this.loaded.set(id, data)
    }
    return data
  }

  /** Look up a passage like "John 3:16-18" or "Psalm 23". */
  async passage(reference: string, translation: TranslationId = 'web'): Promise<Passage & { book: string }> {
    const ref = parseReference(reference)
    if (!ref)
      throw new UserError(`“${reference.trim()}” isn't a Bible reference Cue recognizes. Try “John 3:16”.`)
    if (!BIBLE_TRANSLATIONS.some((t) => t.id === translation)) translation = 'web'
    const data = await this.load(translation)
    const book = data.books.find((b) => b.id === ref.book)
    const name = BIBLE_BOOKS.find((b) => b.id === ref.book)?.name ?? ref.book
    if (!book) throw new UserError(`${name} isn't in this translation`)

    const endChapter = ref.endChapter ?? ref.chapter
    const verses: PassageVerse[] = []
    for (let c = ref.chapter; c <= endChapter; c++) {
      const chapter = book.chapters[c - 1] ?? []
      const from = c === ref.chapter ? (ref.verse ?? 1) : 1
      const to =
        c === endChapter
          ? (ref.endVerse ?? (ref.verse !== undefined && !ref.endChapter ? from : chapter.length))
          : chapter.length
      if (from > chapter.length) {
        // "Psalm 23 has 6 verses", "Jude has 25 verses"
        const where = book.chapters.length === 1 ? name : formatReference({ book: ref.book, chapter: c })
        throw new UserError(`${where} has ${chapter.length} verses`)
      }
      for (let v = from; v <= Math.min(to, chapter.length); v++) {
        const text = chapter[v - 1]
        if (text) verses.push({ chapter: c, verse: v, text })
      }
    }
    if (!verses.length) throw new UserError(`${formatReference(ref)} isn't in the ${data.abbr} text`)
    if (verses.length > MAX_VERSES)
      throw new UserError('That passage is too long for slides. Try a shorter range.')
    return { reference: formatReference(ref), translation: data.abbr, verses, book: ref.book }
  }
}
