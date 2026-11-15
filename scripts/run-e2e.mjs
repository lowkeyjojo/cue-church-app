#!/usr/bin/env node
// Builds Cue and runs the Playwright end-to-end suite against the bundle.
// Extra arguments go to Playwright (e.g. a spec name or --grep).
// `--no-build` reuses the current out/ folder. On Linux without a display,
// the suite re-runs itself under a virtual X server (xvfb-run).
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const build = !args.includes('--no-build')
const forward = args.filter((a) => a !== '--no-build')

if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  const result = spawnSync(
    'xvfb-run',
    ['-a', '-s', '-screen 0 1920x1080x24', process.execPath, import.meta.filename, ...args],
    { stdio: 'inherit' }
  )
  if (result.error) {
    console.error(
      'No display found and xvfb-run is not available. Install Xvfb (apt install xvfb) or set DISPLAY.'
    )
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (build) run('npx', ['electron-vite', 'build'])
run('npx', ['playwright', 'test', ...forward])
