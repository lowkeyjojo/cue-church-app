#!/usr/bin/env node
// Downloads the public-domain Bible translations Cue ships with and writes
// them in Cue's compact format to resources/bible/<id>.json.gz:
//   { id, name, abbr, books: [{ id, name, chapters: string[][] }] }
// Run it once when adding or updating a translation; the output is committed.
//
// Sources:
// - World English Bible (public domain): github.com/TehShrike/world-english-bible
// - King James Version (public domain text): github.com/thiagobodruk/bible (en_kjv)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const out = join(import.meta.dirname, '..', 'resources', 'bible')

/** USFM book codes and English names, in canonical order. */
const BOOKS = [
  ['GEN', 'Genesis'],
  ['EXO', 'Exodus'],
  ['LEV', 'Leviticus'],
  ['NUM', 'Numbers'],
  ['DEU', 'Deuteronomy'],
  ['JOS', 'Joshua'],
  ['JDG', 'Judges'],
  ['RUT', 'Ruth'],
  ['1SA', '1 Samuel'],
  ['2SA', '2 Samuel'],
  ['1KI', '1 Kings'],
  ['2KI', '2 Kings'],
  ['1CH', '1 Chronicles'],
  ['2CH', '2 Chronicles'],
  ['EZR', 'Ezra'],
  ['NEH', 'Nehemiah'],
  ['EST', 'Esther'],
  ['JOB', 'Job'],
  ['PSA', 'Psalms'],
  ['PRO', 'Proverbs'],
  ['ECC', 'Ecclesiastes'],
  ['SNG', 'Song of Solomon'],
  ['ISA', 'Isaiah'],
  ['JER', 'Jeremiah'],
  ['LAM', 'Lamentations'],
  ['EZK', 'Ezekiel'],
  ['DAN', 'Daniel'],
  ['HOS', 'Hosea'],
  ['JOL', 'Joel'],
  ['AMO', 'Amos'],
  ['OBA', 'Obadiah'],
  ['JON', 'Jonah'],
  ['MIC', 'Micah'],
  ['NAM', 'Nahum'],
  ['HAB', 'Habakkuk'],
  ['ZEP', 'Zephaniah'],
  ['HAG', 'Haggai'],
  ['ZEC', 'Zechariah'],
  ['MAL', 'Malachi'],
  ['MAT', 'Matthew'],
  ['MRK', 'Mark'],
  ['LUK', 'Luke'],
  ['JHN', 'John'],
  ['ACT', 'Acts'],
  ['ROM', 'Romans'],
  ['1CO', '1 Corinthians'],
  ['2CO', '2 Corinthians'],
  ['GAL', 'Galatians'],
  ['EPH', 'Ephesians'],
  ['PHP', 'Philippians'],
  ['COL', 'Colossians'],
  ['1TH', '1 Thessalonians'],
  ['2TH', '2 Thessalonians'],
  ['1TI', '1 Timothy'],
  ['2TI', '2 Timothy'],
  ['TIT', 'Titus'],
  ['PHM', 'Philemon'],
  ['HEB', 'Hebrews'],
  ['JAS', 'James'],
  ['1PE', '1 Peter'],
  ['2PE', '2 Peter'],
  ['1JN', '1 John'],
  ['2JN', '2 John'],
  ['3JN', '3 John'],
  ['JUD', 'Jude'],
  ['REV', 'Revelation']
]

async function json(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return JSON.parse((await res.text()).replace(/^\uFEFF/, ''))
}

const tidy = (text) => text.replace(/\s+/g, ' ').trim()

async function web() {
  const base = 'https://raw.githubusercontent.com/TehShrike/world-english-bible/master/json'
  const books = []
  for (const [id, name] of BOOKS) {
    const file = name.toLowerCase().replace(/\s+/g, '')
    const parts = await json(`${base}/${file}.json`)
    const chapters = []
    for (const p of parts) {
      if (typeof p.value !== 'string' || !p.chapterNumber || !p.verseNumber) continue
      const verses = (chapters[p.chapterNumber - 1] ??= [])
      verses[p.verseNumber - 1] = tidy(`${verses[p.verseNumber - 1] ?? ''} ${p.value}`)
    }
    books.push({ id, name, chapters: chapters.map((c) => Array.from(c, (v) => v ?? '')) })
    process.stdout.write('.')
  }
  process.stdout.write('\n')
  return { id: 'web', name: 'World English Bible', abbr: 'WEB', books }
}

async function kjv() {
  const data = await json('https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json')
  if (data.length !== BOOKS.length) throw new Error(`Expected ${BOOKS.length} books, got ${data.length}`)
  const books = data.map((book, i) => ({
    id: BOOKS[i][0],
    name: BOOKS[i][1],
    chapters: book.chapters.map((verses) => verses.map(tidy))
  }))
  return { id: 'kjv', name: 'King James Version', abbr: 'KJV', books }
}

mkdirSync(out, { recursive: true })
for (const make of [web, kjv]) {
  const bible = await make()
  const verses = bible.books.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c.length, 0), 0)
  const data = gzipSync(JSON.stringify(bible), { level: 9 })
  writeFileSync(join(out, `${bible.id}.json.gz`), data)
  console.log(
    `${bible.abbr}: ${bible.books.length} books, ${verses} verses, ${(data.length / 1024).toFixed(0)} KB`
  )
}
