import { test, expect } from '@playwright/test';
import path from 'path';
import { pause, slowType, scrollTo, highlight } from './helpers';

test('Demo 02 — Artist Profile Management', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(`file://${path.resolve(__dirname, '../demos/02-artist-profile/index.html')}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#s-artist-dashboard', { state: 'visible', timeout: 15000 });
  await pause(500);

  // Dashboard — analytics
  await scrollTo(page, '#s-artist-dashboard .analytics-row');
  await pause(667);

  // Scroll to QR section
  await scrollTo(page, '#s-artist-dashboard .qr-section');
  await pause(500);
  await highlight(page, '#qr-dl-btn');
  await page.click('#qr-dl-btn');
  await pause(833); // show download animation

  // Edit profile
  await scrollTo(page, '#s-artist-dashboard .edit-btn');
  await pause(267);
  await highlight(page, '#s-artist-dashboard .edit-btn');
  await page.locator('#s-artist-dashboard .edit-btn').first().click({ force: true });
  await pause(333);

  await expect(page.locator('#s-edit-profile')).toBeVisible();
  await pause(267);

  // Clear bio and retype
  const bioField = page.locator('#edit-bio');
  await bioField.click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Backspace');
  await pause(133);
  await slowType(
    bioField,
    "Rosa's monumental figures emerge from walls with a quiet intensity — bodies in conversation with architecture, never fighting it. Bristol, Berlin, Cheltenham. Her practice follows the walls that deserve it.",
    18
  );
  await pause(267);

  await highlight(page, '.save-btn');
  await page.click('.save-btn');
  await pause(667); // toast visible

  // Festival badge
  await scrollTo(page, '#s-artist-dashboard .fest-badge');
  await pause(500);
  await highlight(page, '#s-artist-dashboard .fest-badge');
  await page.locator('#s-artist-dashboard .fest-badge').click({ force: true });
  await pause(400);

  // Festival archive — end of demo
  await expect(page.locator('#s-festival-archive')).toBeVisible();
  await pause(667);
});
