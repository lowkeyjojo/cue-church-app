import { describe, expect, it } from 'vitest'
import {
  cleanVersion,
  compareVersions,
  isNewerVersion,
  localUpdateFeed,
  plainUpdateError,
  releasePage,
  updateSummary
} from '@shared/updates'

describe('compareVersions', () => {
  it('orders versions by their numbers, not as text', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('0.9.1', '0.10.0')).toBeLessThan(0)
    expect(compareVersions('0.10.0', '0.9.1')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0)
  })
  it('reads release tags and ignores build details', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions(' v1.3.0 ', 'v1.2.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2.3+build.7', '1.2.3')).toBe(0)
  })
  it('puts a pre-release before its release', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBeLessThan(0)
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0)
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0)
    expect(compareVersions('1.0.0-rc.1', '1.0.0-rc.1')).toBe(0)
    expect(compareVersions('1.0.1-beta', '1.0.0')).toBeGreaterThan(0)
  })
  it("doesn't guess at things that aren't versions", () => {
    expect(compareVersions('latest', '1.0.0')).toBeNull()
    expect(compareVersions('1.0', '1.0.0')).toBeNull()
    expect(compareVersions('1.0.0', '')).toBeNull()
    expect(compareVersions('1.2.3.4', '1.2.3')).toBeNull()
  })
})

describe('isNewerVersion', () => {
  it('is true only for a later version', () => {
    expect(isNewerVersion('v0.10.1', '0.10.0')).toBe(true)
    expect(isNewerVersion('v0.10.0', '0.10.0')).toBe(false)
    expect(isNewerVersion('v0.9.9', '0.10.0')).toBe(false)
    expect(isNewerVersion('nightly', '0.10.0')).toBe(false)
  })
})

describe('cleanVersion', () => {
  it('turns a tag into a plain version', () => {
    expect(cleanVersion('v1.2.3')).toBe('1.2.3')
    expect(cleanVersion('1.2.3-beta.1+sha')).toBe('1.2.3-beta.1')
    expect(cleanVersion('release-12')).toBeNull()
  })
})

describe('localUpdateFeed', () => {
  it('accepts a server on this computer, with its port', () => {
    expect(localUpdateFeed('http://127.0.0.1:8123')).toBe('http://127.0.0.1:8123')
    expect(localUpdateFeed('http://localhost:8123/')).toBe('http://localhost:8123')
    expect(localUpdateFeed(' http://127.0.0.1:8123/feed/ ')).toBe('http://127.0.0.1:8123/feed')
  })
  it('refuses everything else', () => {
    for (const value of [
      undefined,
      '',
      'not a url',
      'https://127.0.0.1:8123',
      'http://127.0.0.1',
      'http://localhost',
      'http://example.com:8123',
      'http://localhost.example.com:8123',
      'http://127.0.0.1.example.com:8123',
      'http://127.0.0.1:8123@example.com:80',
      'http://user:secret@127.0.0.1:8123',
      'http://192.168.1.20:8123',
      'http://[::1]:8123',
      'http://127.0.0.1:8123/?to=example.com',
      'http://127.0.0.1:8123/#x',
      'file:///tmp/feed',
      'ftp://127.0.0.1:8123'
    ]) {
      expect(localUpdateFeed(value), String(value)).toBeNull()
    }
  })
})

describe('releasePage', () => {
  it("keeps Cue's own release pages and replaces anything else", () => {
    const page = 'https://github.com/lowkeyjojo/cue-church-app/releases/tag/v1.2.3'
    const latest = 'https://github.com/lowkeyjojo/cue-church-app/releases/latest'
    expect(releasePage(page)).toBe(page)
    expect(releasePage('https://example.com/cue.exe')).toBe(latest)
    expect(releasePage('http://github.com/lowkeyjojo/cue-church-app/releases/tag/v1.2.3')).toBe(latest)
    expect(releasePage('https://github.com/lowkeyjojo/cue-church-app/releases.example.com/')).toBe(latest)
    expect(releasePage('file:///C:/Windows/System32/calc.exe')).toBe(latest)
    expect(releasePage(undefined)).toBe(latest)
    expect(releasePage(42)).toBe(latest)
  })
})

describe('plainUpdateError', () => {
  it('says what went wrong in a few words', () => {
    expect(plainUpdateError('net::ERR_INTERNET_DISCONNECTED')).toBe('no internet connection')
    expect(plainUpdateError('net::ERR_NAME_NOT_RESOLVED')).toBe('no internet connection')
    expect(plainUpdateError('The operation was aborted due to timeout')).toBe('the connection timed out')
    expect(plainUpdateError('The update server answered 403')).toBe('the update server answered 403')
    expect(plainUpdateError('Cannot find latest.yml: HttpError: 404\n"headers": {…}')).toBe(
      'the update server answered 404'
    )
    expect(plainUpdateError('Something odd\n    at stack (file.js:1:1)')).toBe('Something odd')
    expect(plainUpdateError('x'.repeat(400)).length).toBeLessThanOrEqual(120)
    expect(plainUpdateError('')).toBe('something went wrong')
  })
})

describe('updateSummary', () => {
  it('puts each state in plain words', () => {
    expect(updateSummary({ status: 'idle' })).toBe('')
    expect(updateSummary({ status: 'checking' })).toBe('Checking…')
    expect(updateSummary({ status: 'current' })).toBe('Cue is up to date')
    expect(updateSummary({ status: 'available', version: '1.2.3', manual: true })).toBe(
      'Cue 1.2.3 is available'
    )
    expect(updateSummary({ status: 'downloading', version: '1.2.3', percent: 0 })).toBe('Downloading 1.2.3…')
    expect(updateSummary({ status: 'downloading', version: '1.2.3', percent: 41.6 })).toBe(
      'Downloading 1.2.3… 42%'
    )
    expect(updateSummary({ status: 'ready', version: '1.2.3' })).toBe(
      'Cue 1.2.3 is ready. It installs when you close Cue.'
    )
    expect(updateSummary({ status: 'error', message: 'no internet connection' })).toBe(
      "Couldn't check: no internet connection"
    )
  })
})
