import { test, expect } from '@playwright/test';
import path from 'path';
import { pause, slowType, scrollTo, highlight } from './helpers';

test('Demo 03 — Artist Applying to a Festival', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(`file://${path.resolve(__dirname, '../demos/03-artist-apply/index.html')}`);
  await expect(page.locator('#s-home')).toBeVisible();
  await pause(1500);

  // Home — see CPF 2027 applications open
  await highlight(page, '.fest-card');
  await page.click('.fest-card');
  await pause(1000);

  // Festival page
  await expect(page.locator('#s-festival-open')).toBeVisible();
  await pause(1500);
  await scrollTo(page, '#s-festival-open .btn-view.amber');
  await pause(800);
  await highlight(page, '#s-festival-open .btn-view.amber');
  await page.click('#s-festival-open .btn-view.amber');
  await pause(1000);

  // Application form
  await expect(page.locator('#s-apply-form')).toBeVisible();
  await pause(800);

  await slowType(
    page.locator('#q-proposed'),
    'A piece built entirely from words already on this building — planning notices, civic language, decades of text — reconfigured into something that feels inevitable.',
    60
  );
  await pause(500);

  await scrollTo(page, '#q-wall');
  await slowType(page.locator('#q-wall'), '12m × 8m');
  await pause(400);

  await scrollTo(page, '#rq-yes');
  await highlight(page, '#rq-yes');
  await page.click('#rq-yes');
  await pause(600);

  await scrollTo(page, '#q-p1');
  await slowType(page.locator('#q-p1'), 'kharrow.co.uk/cheltenham-college', 50);
  await pause(200);
  await slowType(page.locator('#q-p2'), 'kharrow.co.uk/oxford-street-2024', 50);
  await pause(200);
  await slowType(page.locator('#q-p3'), 'instagram.com/kit.harrow', 50);
  await pause(500);

  await scrollTo(page, '#ri-yes');
  await page.click('#ri-yes');
  await pause(500);

  await scrollTo(page, '#rm-spray');
  await highlight(page, '#rm-spray');
  await page.click('#rm-spray');
  await pause(500);

  await scrollTo(page, '#ra-full');
  await highlight(page, '#ra-full');
  await page.click('#ra-full');
  await pause(800);

  await scrollTo(page, '.submit-btn');
  await pause(800);
  await highlight(page, '.submit-btn');
  await page.click('.submit-btn');
  await pause(1500);

  // Submitted
  await expect(page.locator('#s-submitted')).toBeVisible();
  await pause(2000);

  // Fast-forward to notifications
  await highlight(page, '#s-submitted button.btn-view');
  await page.click('#s-submitted button.btn-view');
  await pause(1000);

  await expect(page.locator('#s-notifications')).toBeVisible();
  await pause(1500);
  await highlight(page, '.notif-item.unread');
  await page.click('.notif-item.unread');
  await pause(1000);

  // Acceptance
  await expect(page.locator('#s-acceptance')).toBeVisible();
  await pause(3000);
});
