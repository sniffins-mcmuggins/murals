import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './scripts',
  // Only the V## demo scripts are tests; helpers.ts / mailpit.ts are shared
  // modules imported by them. Playwright forbids a test file importing another
  // test file, so they must not match testMatch.
  testMatch: '**/V[0-9]*.ts',
  workers: 1,
  timeout: 180000,
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
