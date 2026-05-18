import { test, expect } from '@playwright/test';
import path from 'path';
import { pause, scrollTo, highlight } from './helpers';

test('Demo 05 — Post-Festival Mural Trail', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(`file://${path.resolve(__dirname, '../demos/05-post-festival-trail/index.html')}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#s-home', { state: 'visible', timeout: 15000 });
  await pause(500);

  // Home — show archive card
  await page.waitForSelector('.fest-card', { timeout: 10000 });
  await highlight(page, '.fest-card:first-child');
  await pause(333);
  await page.locator('.fest-card').first().click({ force: true });
  await pause(400);

  // Festival archive — map tab
  await expect(page.locator('#s-festival-archive')).toBeVisible();
  await pause(667);

  // Show the map + legend
  await scrollTo(page, '#fest-map');
  await pause(833);

  // Try clicking a Leaflet marker
  const markerVisible = await page.locator('.leaflet-marker-icon').first().isVisible().catch(() => false);
  if (markerVisible) {
    await page.locator('.leaflet-marker-icon').first().click();
    await pause(600);
  }

  // If popup appeared, view the artist; otherwise fall back to Artists tab
  const popupVisible = await page.locator('.popup-btn.view').isVisible().catch(() => false);
  if (popupVisible) {
    await pause(500);
    await highlight(page, '.popup-btn.view');
    await page.click('.popup-btn.view');
  } else {
    await page.click('.fest-tab:nth-child(2)');
    await pause(267);
    await page.locator('.artist-row').first().click();
  }
  await pause(333);

  // Artist profile
  await expect(page.locator('#s-artist')).toBeVisible();
  await pause(500);
  await scrollTo(page, '.fest-badge');
  await pause(667);
  await scrollTo(page, '.artist-bio');
  await pause(500);
});
