import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './scripts',
  testMatch: '**/*.ts',
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    headless: false,
    slowMo: 60,
    video: 'on',
    viewport: { width: 1280, height: 800 },
  },
  outputDir: './output/raw',
})
