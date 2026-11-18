#!/usr/bin/env node
// Launches an INSTALLED Cue (the packaged app, as a user would run it: no test
// flags) and checks that it really starts: the control window appears and is
// visible, the UI renders, bundled resources load, it quits, and it starts
// again. Used by the Release workflow so an installer that doesn't open is
// never published.
//
//   node scripts/smoke-installed.mjs "<path to Cue executable>"
import { _electron as electron } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const executablePath = process.argv[2]
if (!executablePath) {
  console.error('Usage: node scripts/smoke-installed.mjs "<path to Cue executable>"')
  process.exit(2)
}

// Only the data folder is redirected, so the machine's real Cue data is untouched.
const dataDir = mkdtempSync(join(tmpdir(), 'cue-smoke-'))
// The one setting that differs from a new install: Cue doesn't look for updates here, so the
// result can't depend on the network or on which release is the newest that day.
// (scripts/smoke-update.mjs is the check that an installed Cue updates itself.)
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ updates: { auto: false } }))
const env = { ...process.env, CUE_USER_DATA: dataDir }
delete env.CUE_E2E
delete env.ELECTRON_RUN_AS_NODE
// Linux CI containers have no GPU and run as root; real desktops need none of this.
const args = process.platform === 'linux' ? ['--no-sandbox', '--use-angle=swiftshader'] : []

const step = (text) => console.log(`• ${text}`)
const logText = () => {
  try {
    return readFileSync(join(dataDir, 'logs', 'cue.log'), 'utf8')
  } catch {
    return '(no log file)'
  }
}

async function launchAndCheck(round) {
  step(`${round}: starting ${executablePath}`)
  const app = await electron.launch({ executablePath, args, env, timeout: 60_000 })
  const output = []
  for (const stream of [app.process().stdout, app.process().stderr])
    stream?.on('data', (chunk) => output.push(String(chunk)))
  try {
    let page
    for (let i = 0; i < 300 && !page; i++) {
      page = app.windows().find((w) => w.url().includes('control.html'))
      if (!page) await new Promise((r) => setTimeout(r, 100))
    }
    if (!page)
      throw new Error(`No Cue window appeared within 30 s (windows: ${app.windows().map((w) => w.url())})`)
    step(`${round}: the control window exists`)

    const errors = []
    page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`))
    await page.getByTestId('take').waitFor({ timeout: 30_000 })
    step(`${round}: the interface rendered`)

    const win = await app.evaluate(({ app, BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('control.html'))
      return { visible: !!w?.isVisible(), packaged: app.isPackaged, version: app.getVersion() }
    })
    if (!win.packaged) throw new Error('This is not a packaged build')
    if (!win.visible) throw new Error('The control window exists but is not visible')
    step(`${round}: the window is visible (Cue ${win.version}, packaged)`)

    const verse = await page.evaluate(() => globalThis.cue.invoke('scripture:passage', 'John 11:35', 'kjv'))
    if (verse?.verses?.[0]?.text !== 'Jesus wept.')
      throw new Error(`Bundled Bible data did not load: ${JSON.stringify(verse)}`)
    step(`${round}: bundled resources load`)

    if (errors.length) throw new Error(`Page errors: ${errors.join(' | ')}`)
  } catch (err) {
    console.error(`--- Cue's console output ---\n${output.join('')}\n--- Cue's log ---\n${logText()}`)
    await app.close().catch(() => undefined)
    throw err
  }
  const exited = new Promise((resolve) => app.process().once('exit', resolve))
  await app.close()
  await Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Cue did not exit after quitting')), 20_000))
  ])
  step(`${round}: quit cleanly`)
}

try {
  await launchAndCheck('first launch')
  // A second start catches a first run that leaves something behind which blocks the next one.
  await launchAndCheck('second launch')
  const errors = logText()
    .split('\n')
    .filter((line) => line.includes('[ERROR]'))
  if (errors.length) throw new Error(`Cue logged errors:\n${errors.join('\n')}`)
  console.log('Cue installs and starts correctly.')
} catch (err) {
  console.error(`\nSMOKE TEST FAILED: ${err.message}`)
  process.exitCode = 1
} finally {
  rmSync(dataDir, { recursive: true, force: true })
}
