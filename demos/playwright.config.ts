import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './scripts',
  // Each clip is a persona-prefixed file (artist-*.ts / organiser-*.ts). Shared
  // modules (_setup.ts, helpers.ts, mailpit.ts) deliberately don't match — Playwright
  // forbids a test file importing another test file.
  testMatch: ['**/artist-*.ts', '**/organiser-*.ts'],
  workers: 1,
  // Bounded so a stuck selector doesn't waste minutes mid-batch, but generous
  // enough for the long narrated clips (onboarding, organiser-review).
  timeout: 150000,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    headless: false,
    slowMo: 60,
    video: 'on',
    viewport: { width: 1280, height: 800 },
  },
  outputDir: './output/raw',
  cleanOutputDir: false,
})
