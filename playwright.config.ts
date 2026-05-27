import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/browser',
  baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
