import { test, expect } from '@playwright/test';
import path from 'path';
import { pause, scrollTo, highlight } from './helpers';

test('Demo 01 — Public Visitor at the Festival', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(`file://${path.resolve(__dirname, '../demos/01-public-visitor/index.html')}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#s-home', { state: 'visible', timeout: 30000 });
  await pause(500);

  // Home — see the CPF 2026 archive card
  await page.waitForSelector('.fest-card', { timeout: 10000 });
  await highlight(page, '.fest-card:first-child');
  await pause(333);
  await page.locator('.fest-card').first().click({ force: true });
  await pause(400);

  // Festival archive
  await expect(page.locator('#s-festival-archive')).toBeVisible();
  await pause(667);

  // Switch to Artists tab (skip map to avoid GPU rendering issues)
  await highlight(page, '.fest-tab:nth-child(2)');
  await page.click('.fest-tab:nth-child(2)');
  await pause(333);

  // Click first artist row
  await page.waitForSelector('.artist-row', { timeout: 5000 });
  await highlight(page, '.artist-row:first-child');
  await pause(267);
  await page.locator('.artist-row').first().click();
  await pause(333);

  // Artist profile
  await expect(page.locator('#s-artist')).toBeVisible();
  await pause(500);
  await scrollTo(page, '.analytics-row');
  await pause(400);
  await scrollTo(page, '.artist-bio');
  await pause(400);
  await scrollTo(page, '.gallery-grid');
  await pause(500);
  await scrollTo(page, '.qr-section');
  await pause(667);
  await scrollTo(page, '.socials-row');
  await pause(333);
  await highlight(page, '.social-btn:first-child');
  await pause(500);
});
