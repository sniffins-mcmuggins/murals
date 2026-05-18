import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './playwright',
  testMatch: '**/*.ts',
  use: {
    headless: false,
    slowMo: 80,
    video: 'on',
  },
  outputDir: './output',
  reporter: 'list',
  workers: 1,
  timeout: 180000,
});
