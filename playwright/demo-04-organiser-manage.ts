import { test, expect } from '@playwright/test';
import path from 'path';
import { pause, slowType, scrollTo, highlight } from './helpers';

test('Demo 04 — Organiser Creating and Managing', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });

  const file = `file://${path.resolve(__dirname, '../demos/04-organiser-manage/index.html')}`;
  await page.goto(file);
  await expect(page.locator('#s-org-empty')).toBeVisible();
  await pause(2000);

  // Organiser sees empty 2027 state
  await scrollTo(page, '.empty-state');
  await pause(1500);
  await highlight(page, '.create-festival-btn');
  await page.click('.create-festival-btn');
  await pause(1000);

  // Create festival form
  await expect(page.locator('#festival-name')).toBeVisible();
  await pause(600);
  await slowType(page.locator('#festival-name'), 'Cheltenham Paint Festival 2027');
  await pause(400);
  await slowType(page.locator('#festival-dates'), '3–19 October 2027');
  await pause(400);
  await slowType(page.locator('#festival-location'), 'Cheltenham Town Centre, GL50');
  await pause(400);
  await slowType(page.locator('#festival-description'), 'The 11th edition of Cheltenham\'s flagship paint festival returns to transform the town\'s walls and buildings with large-scale public art.');
  await pause(1000);
  await highlight(page, '#next-form-builder-btn');
  await page.click('#next-form-builder-btn');
  await pause(1200);

  // Form builder — scroll to show all questions
  await expect(page.locator('#formQuestionsList')).toBeVisible();
  await pause(1500);
  await scrollTo(page, '#formQuestionsList');
  await pause(1000);
  await highlight(page, '.question-item:nth-child(3) .drag-handle');
  await pause(1200);

  // Add new question
  await scrollTo(page, '#add-question-btn');
  await highlight(page, '#add-question-btn');
  await page.click('#add-question-btn');
  await pause(600);
  await slowType(page.locator('#new-question-input'), 'What is your estimated budget for materials?');
  await pause(400);
  await page.click('#save-question-btn');
  await pause(1000);
  await scrollTo(page, '#go-live-btn');
  await highlight(page, '#go-live-btn');
  await page.click('#go-live-btn');
  await pause(1200);

  // Go live confirmation
  await expect(page.locator('#confirm-go-live-btn')).toBeVisible();
  await pause(2000);
  await highlight(page, '#confirm-go-live-btn');
  await page.click('#confirm-go-live-btn');
  await pause(2500); // counter animation

  // Live dashboard
  await expect(page.locator('#s-org-live')).toBeVisible();
  await pause(1500);
  await scrollTo(page, '.application-list');
  await pause(1500);

  // Review Kit's application
  await highlight(page, '#app-kit-live .btn-view-detail');
  await page.click('#app-kit-live .btn-view-detail');
  await pause(1000);

  await expect(page.locator('#app-detail-name')).toBeVisible();
  await pause(1500);
  await scrollTo(page, '.portfolio-links');
  await pause(1200);
  await scrollTo(page, '.proposed-work');
  await pause(1500);
  await scrollTo(page, '.btn-accept-from-detail');
  await pause(800);
  await highlight(page, '.btn-accept-from-detail');
  await page.click('.btn-accept-from-detail');
  await pause(1500);

  // Back on live dashboard — Kit accepted
  await pause(1000);
  await scrollTo(page, '#app-tomas-live');
  await highlight(page, '#app-tomas-live .btn-view-detail');
  await page.click('#app-tomas-live .btn-view-detail');
  await pause(1000);

  await expect(page.locator('#app-detail-name')).toBeVisible();
  await pause(1200);
  await highlight(page, '.btn-decline-from-detail');
  await page.click('.btn-decline-from-detail');
  await pause(800);

  // Decline modal
  await expect(page.locator('#decline-modal')).toBeVisible();
  await pause(800);
  await slowType(
    page.locator('#decline-message'),
    'Thank you for applying — we\'ve reached capacity for community portraiture this year. We hope to see you at CPF 2028.',
    65
  );
  await pause(800);
  await highlight(page, '#send-decline-btn');
  await page.click('#send-decline-btn');
  await pause(1500);

  // Bulk reminder
  await scrollTo(page, '#bulk-reminder-btn');
  await pause(800);
  await highlight(page, '#bulk-reminder-btn');
  await page.click('#bulk-reminder-btn');
  await pause(1000);
  await expect(page.locator('#bulk-modal')).toBeVisible();
  await pause(1500);
  await page.click('#confirm-bulk-btn');
  await pause(2000);
});
