#!/usr/bin/env node
// Proves that an INSTALLED Cue updates itself, the way it will on a church's
// PC: an older Cue is running, a newer release appears, Cue downloads it in
// the background, and closing Cue installs it. Used by the Release workflow
// on Windows, so a build that can't update is never published.
//
//   node scripts/smoke-update.mjs "<installed Cue.exe>" "<folder with the new latest.yml and installer>" "<new version>"
//
// The folder is served on this computer only, and the installed (older) Cue is
// pointed at it with CUE_UPDATE_FEED. Everything else is as shipped.
import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

const [executablePath, feedArg, expected] = process.argv.slice(2)
if (!executablePath || !feedArg || !expected) {
  console.error(
    'Usage: node scripts/smoke-update.mjs "<installed Cue executable>" "<folder with the new release>" "<new version>"'
  )
  process.exit(2)
}

const READY_TIMEOUT = 3 * 60_000
const INSTALL_TIMEOUT = 3 * 60_000
const feedDir = resolve(feedArg)
// What electron-updater asks a feed for on each platform.
const channelFile =
  process.platform === 'win32'
    ? 'latest.yml'
    : process.platform === 'darwin'
      ? 'latest-mac.yml'
      : 'latest-linux.yml'
// Linux CI containers have no GPU and run as root; real desktops need none of this.
const args = process.platform === 'linux' ? ['--no-sandbox', '--use-angle=swiftshader'] : []

const step = (text) => console.log(`• ${text}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** Remove a throwaway folder. Windows can hold on to a file for a moment; that is no reason to fail. */
const discard = (dir) => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    // Left for the system to clean up.
  }
}
const readLog = (dataDir) => {
  try {
    return readFileSync(join(dataDir, 'logs', 'cue.log'), 'utf8')
  } catch {
    return '(no log file)'
  }
}

function environment(dataDir, extra = {}) {
  const env = { ...process.env, CUE_USER_DATA: dataDir, ...extra }
  delete env.CUE_E2E
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

/** Serve the new release's files, on this computer only. */
function serve(dir) {
  const server = createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    const file = resolve(join(dir, name))
    const found = file.startsWith(dir + sep) && existsSync(file) && statSync(file).isFile()
    console.log(`  feed: ${req.method} ${req.url} -> ${found ? 200 : 404}`)
    if (req.method !== 'GET' || !found) {
      res.writeHead(found ? 405 : 404).end()
      return
    }
    res.writeHead(200, { 'Content-Length': statSync(file).size })
    createReadStream(file).pipe(res)
  })
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)))
}

/** Is the installer that the update started still at work? (Windows; elsewhere there is none to wait for.) */
function installerRunning(installerName) {
  if (process.platform !== 'win32') return false
  try {
    const list = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${installerName}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8'
    })
    return list.toLowerCase().includes(installerName.toLowerCase())
  } catch {
    return false
  }
}

/** Start the installed Cue with settings that keep it off the network, and ask it for its version. */
async function installedVersion() {
  const dataDir = mkdtempSync(join(tmpdir(), 'cue-update-after-'))
  writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ updates: { auto: false } }))
  let app
  try {
    app = await electron.launch({ executablePath, args, env: environment(dataDir), timeout: 60_000 })
    return await app.evaluate(({ app }) => app.getVersion())
  } finally {
    await app?.close().catch(() => undefined)
    discard(dataDir)
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'cue-update-'))
const output = []
let server
let app
try {
  if (!existsSync(join(feedDir, channelFile))) throw new Error(`There is no ${channelFile} in ${feedDir}`)
  const described = readFileSync(join(feedDir, channelFile), 'utf8')
  const offered = /^version:\s*(\S+)/m.exec(described)?.[1]
  const installerName = basename(/^path:\s*(\S+)/m.exec(described)?.[1] ?? '')
  if (offered !== expected) throw new Error(`${channelFile} offers ${offered}, not ${expected}`)
  if (!installerName || !existsSync(join(feedDir, installerName)))
    throw new Error(`${channelFile} names ${installerName || 'no file'}, which is not in ${feedDir}`)

  server = await serve(feedDir)
  const feed = `http://127.0.0.1:${server.address().port}`
  step(`serving ${feedDir} at ${feed} (Cue ${expected}, ${installerName})`)

  step(`starting the installed Cue: ${executablePath}`)
  app = await electron.launch({
    executablePath,
    args,
    env: environment(dataDir, { CUE_UPDATE_FEED: feed }),
    timeout: 60_000
  })
  let exited = false
  app.process().once('exit', () => (exited = true))
  for (const stream of [app.process().stdout, app.process().stderr])
    stream?.on('data', (chunk) => output.push(String(chunk)))
  const before = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged }))
  if (!before.packaged) throw new Error('This is not a packaged build')
  if (before.version === expected)
    throw new Error(`The installed Cue is already ${expected}: there is nothing to update from`)
  step(`it is Cue ${before.version}; waiting for it to fetch ${expected} by itself`)

  // Cue checks a second after its window opens, downloads, and says so in its log.
  let ready
  let downloading = false
  for (const deadline = Date.now() + READY_TIMEOUT; !ready; await sleep(500)) {
    const log = readLog(dataDir)
    ready = /\[INFO\] Update (\S+) is ready/.exec(log)?.[1]
    if (ready) break
    if (!downloading && /\[INFO\] Downloading update/.test(log)) {
      downloading = true
      step('the download has started')
    }
    if (exited) throw new Error('Cue closed before the update was ready')
    if (Date.now() > deadline)
      throw new Error(`The update was not ready within ${READY_TIMEOUT / 60_000} minutes`)
  }
  if (ready !== expected) throw new Error(`Cue downloaded ${ready}, not ${expected}`)
  step(`Cue says update ${ready} is ready, and it kept running`)

  // Closed the ordinary way, Cue installs the update on its way out.
  const gone = new Promise((done) => app.process().once('exit', done))
  await app.close()
  await Promise.race([
    gone,
    sleep(30_000).then(() => {
      throw new Error('Cue did not exit after quitting')
    })
  ])
  app = undefined
  step('Cue closed; the update installs now')

  let version
  let problem
  for (const deadline = Date.now() + INSTALL_TIMEOUT; Date.now() < deadline; await sleep(3000)) {
    // Opening Cue in the middle of the installation would get in its way.
    if (installerRunning(installerName)) continue
    try {
      version = await installedVersion()
      problem = undefined
    } catch (err) {
      // The files may be half replaced: try again in a moment.
      problem = err
    }
    if (version === expected) break
  }
  if (version !== expected) {
    throw new Error(
      `After ${INSTALL_TIMEOUT / 60_000} minutes the installed Cue is ${version ?? 'not starting'}, not ${expected}${
        problem ? ` (${problem.message.split('\n')[0]})` : ''
      }`
    )
  }
  step(`the installed Cue is now ${version}`)
  const updater = readLog(dataDir)
    .split('\n')
    .filter((line) => /updat/i.test(line))
  console.log(`--- What the older Cue logged about it ---\n${updater.join('\n')}`)
  console.log('Cue updates itself correctly.')
} catch (err) {
  console.error(`\nUPDATE TEST FAILED: ${err.message}`)
  console.error(`--- Cue's console output ---\n${output.join('')}\n--- Cue's log ---\n${readLog(dataDir)}`)
  process.exitCode = 1
} finally {
  await app?.close().catch(() => undefined)
  server?.closeAllConnections()
  await new Promise((done) => (server ? server.close(done) : done()))
  discard(dataDir)
}
