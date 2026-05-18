import { test, expect } from '@playwright/test';
import path from 'path';
import { pause, scrollTo, highlight } from './helpers';

test('Demo 06 — The QR Moment', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(`file://${path.resolve(__dirname, '../demos/06-qr-moment/index.html')}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#s-artist', { state: 'visible', timeout: 15000 });
  await pause(667);

  // Artist profile opens cold — bio first
  await pause(400);
  await scrollTo(page, '.analytics-row');
  await pause(400);
  await scrollTo(page, '.artist-bio');
  await pause(667);

  // Gallery
  await scrollTo(page, '.gallery-grid');
  await pause(667);

  // Festival badge — this is where she exhibited
  await scrollTo(page, '.fest-badge');
  await pause(500);

  // QR section — the heart of the demo
  await scrollTo(page, '.qr-section');
  await pause(1000);

  // Socials
  await scrollTo(page, '.socials-row');
  await pause(333);
  await highlight(page, '.social-btn:first-child');
  await pause(667);
});
