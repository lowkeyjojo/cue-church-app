import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests drive the built app (run `npm run test:e2e`, which builds
 * first). Each spec file launches its own Cue with a throwaway data folder.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // One Electron app at a time: they share the screen, clipboard and audio device.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results'
})
