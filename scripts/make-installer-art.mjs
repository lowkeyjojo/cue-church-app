#!/usr/bin/env node
// Renders the artwork installers show, from the HTML in build/installer/:
//   build/dmg-background.png     the Mac disk image's window (640 × 400)
//   build/dmg-background@2x.png  the same for Retina screens
// Run it after changing the HTML; the images are committed. It needs
// Playwright's Chromium (`npx playwright install chromium`), or set
// CHROMIUM_PATH to any Chrome or Chromium.
import { chromium } from '@playwright/test'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = join(import.meta.dirname, '..')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
try {
  for (const scale of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: scale })
    await page.goto(pathToFileURL(join(root, 'build/installer/dmg-background.html')).href)
    await page.evaluate(() => globalThis.document.fonts.ready)
    const file = join(root, `build/dmg-background${scale === 2 ? '@2x' : ''}.png`)
    await page.screenshot({ path: file })
    console.log(`wrote ${file}`)
    await page.close()
  }
} finally {
  await browser.close()
}
