import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// install.sh is the Mac one-line installer. Its logic is plain bash, so it can
// be run anywhere bash exists, with stand-ins for the macOS tools it calls.
// What matters most: a download that doesn't match its checksum is never opened.
const script = resolve(import.meta.dirname, '../../install.sh')
const sha256 = (data: string) => createHash('sha256').update(data).digest('hex')

describe.skipIf(process.platform === 'win32')('install.sh', () => {
  let dir = ''
  let from = ''
  let dest = ''
  let calls = ''

  /** Run the installer with stand-ins for uname, hdiutil, pgrep, osascript and open on the PATH. */
  const install = (env: Record<string, string> = {}) =>
    spawnSync('bash', [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(dir, 'bin')}${delimiter}${process.env.PATH}`,
        CALLS: calls,
        FAKE_DISK: join(dir, 'disk'),
        CUE_INSTALL_FROM: from,
        CUE_INSTALL_DIR: dest,
        CUE_INSTALL_NO_LAUNCH: '1',
        ...env
      }
    })
  const called = () => (existsSync(calls) ? readFileSync(calls, 'utf8') : '')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cue-install-test-'))
    from = join(dir, 'from')
    dest = join(dir, 'Applications')
    calls = join(dir, 'calls.log')
    mkdirSync(from)
    writeFileSync(join(from, 'Cue-mac.dmg'), 'a disk image')
    writeFileSync(join(from, 'SHA256SUMS.txt'), `${sha256('a disk image')}  Cue-mac.dmg\n`)
    // What the stand-in hdiutil "mounts".
    mkdirSync(join(dir, 'disk', 'Cue.app', 'Contents'), { recursive: true })
    writeFileSync(join(dir, 'disk', 'Cue.app', 'Contents', 'marker'), 'new')
    const stub = (name: string, body: string) => {
      mkdirSync(join(dir, 'bin'), { recursive: true })
      writeFileSync(join(dir, 'bin', name), `#!/bin/sh\necho "${name} $*" >> "$CALLS"\n${body}\n`)
      chmodSync(join(dir, 'bin', name), 0o755)
    }
    stub('uname', 'echo Darwin')
    stub(
      'hdiutil',
      'if [ "$1" = attach ]; then for a; do last=$a; done; cp -R "$FAKE_DISK/Cue.app" "$last/"; fi'
    )
    stub('pgrep', 'exit 1')
    stub('osascript', 'exit 0')
    stub('open', 'exit 0')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('checks a file against the list of checksums', () => {
    const verify = (file: string, name: string) =>
      spawnSync('bash', ['-c', 'source "$0"; verify_sha256 "$1" "$2" "$3"', script, file, sums, name]).status
    const sums = join(dir, 'sums.txt')
    const good = join(from, 'Cue-mac.dmg')
    writeFileSync(
      sums,
      `${sha256('other')}  Other.dmg\r\n${sha256('a disk image').toUpperCase()} *Cue-mac.dmg\r\n`
    )
    expect(verify(good, 'Cue-mac.dmg')).toBe(0)
    expect(verify(good, 'Other.dmg')).not.toBe(0)
    expect(verify(good, 'Missing.dmg')).not.toBe(0)
    writeFileSync(sums, `not-a-checksum  Cue-mac.dmg\n`)
    expect(verify(good, 'Cue-mac.dmg')).not.toBe(0)
    writeFileSync(sums, '')
    expect(verify(good, 'Cue-mac.dmg')).not.toBe(0)
  })

  it('installs a disk image that matches its checksum, replacing the Cue that was there', () => {
    mkdirSync(join(dest, 'Cue.app', 'Contents'), { recursive: true })
    writeFileSync(join(dest, 'Cue.app', 'Contents', 'marker'), 'old')
    const result = install()
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(readFileSync(join(dest, 'Cue.app', 'Contents', 'marker'), 'utf8')).toBe('new')
    expect(result.stdout).toContain(`is installed in ${dest}`)
    expect(called()).toMatch(/hdiutil attach .* -nobrowse -readonly/)
    expect(called()).toContain('hdiutil detach')
    // Asked not to open Cue, and no running Cue to close.
    expect(called()).not.toContain('open ')
    expect(called()).not.toContain('osascript')
    // The files it was given are still there.
    expect(existsSync(join(from, 'Cue-mac.dmg'))).toBe(true)
  })

  it('opens Cue afterwards unless told not to', () => {
    expect(install({ CUE_INSTALL_NO_LAUNCH: '' }).status).toBe(0)
    expect(called()).toContain(`open ${join(dest, 'Cue.app')}`)
  })

  it('never opens a disk image that does not match its checksum', () => {
    writeFileSync(join(from, 'Cue-mac.dmg'), 'a different disk image')
    const result = install()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("doesn't match its published checksum")
    expect(called()).not.toContain('hdiutil')
    expect(existsSync(join(dest, 'Cue.app'))).toBe(false)
  })

  it('has no way to skip the checksum', () => {
    rmSync(join(from, 'SHA256SUMS.txt'))
    const result = install()
    expect(result.status).toBe(1)
    expect(called()).not.toContain('hdiutil')
    const text = readFileSync(script, 'utf8')
    // And nothing that switches off the system's own protection.
    expect(text).not.toMatch(/xattr|spctl|quarantine/i)
  })

  it.skipIf(process.platform === 'darwin')('refuses to run anywhere but macOS', () => {
    const result = spawnSync('bash', [script], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('this installer is for macOS')
  })
})

describe('install.ps1', () => {
  const text = readFileSync(resolve(import.meta.dirname, '../../install.ps1'), 'utf8')

  it('is plain ASCII, so Windows PowerShell 5.1 reads it the same however it was fetched', () => {
    expect([...text].filter((ch) => ch.charCodeAt(0) > 126)).toEqual([])
  })

  it('checks the SHA-256 and switches off none of the protection in Windows', () => {
    expect(text).toContain('Get-FileHash')
    expect(text).not.toMatch(
      /Unblock-File|Add-MpPreference|Set-MpPreference|Set-ExecutionPolicy|Zone\.Identifier/i
    )
    expect(text).not.toMatch(/SkipCertificateCheck|ServerCertificateValidationCallback/i)
  })
})
