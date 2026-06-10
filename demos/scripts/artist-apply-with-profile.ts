import { test, expect } from '@playwright/test'
import { pause, highlight, slowType, scrollTo, showDialog, addCursorOverlay } from './helpers.js'
import { silentLogin } from './_setup.js'

// E28 "never type twice" + favicon link fields: the application form arrives
// pre-filled from the artist's profile as one field per platform (each with its
// favicon), and a per-link Share checkbox. Lady Gabe picks what to share and only
// adds the festival-specific questions.
test('artist-apply-with-profile — application pre-filled from the artist profile', async ({ page }) => {
  await addCursorOverlay(page)
  await silentLogin(page) // Lady Gabe

  await page.goto('/applications')
  await expect(page.getByRole('heading', { name: 'Applications', exact: true })).toBeVisible({ timeout: 8000 })

  const openSection = page.locator('section').filter({ hasText: 'Open festivals' })
  const item = openSection.locator('li').filter({ hasText: 'Cheltenham Paint Festival 2027' }).first()
  await item.getByRole('link', { name: 'Apply' }).click()
  await expect(page.getByRole('heading', { name: /^Apply to/ })).toBeVisible({ timeout: 8000 })
  await pause(700)

  // ── Headline: link fields, one per platform, pre-filled from her profile with favicons ──
  await showDialog(page, 'Her links arrive pre-filled from her profile — one field per platform, each with its favicon.')
  await scrollTo(page, 'input[name="link_instagram"]')
  await highlight(page, 'input[name="link_instagram"]')
  await pause(900)

  // ── She chooses which links to share ──
  await showDialog(page, 'She chooses which links to share — untick any she\'d rather leave off.', { pos: 'bottom' })
  await highlight(page, 'input[aria-label="Share TikTok"]')
  await page.getByRole('checkbox', { name: 'Share TikTok' }).uncheck()
  await pause(900)

  // ── Only the festival-specific questions are left ──
  await showDialog(page, 'All that\'s left is what\'s specific to this festival.')
  await scrollTo(page, 'textarea[name="f1"]')
  await slowType(
    page.locator('textarea[name="f1"]'),
    'A bold mythological triptych across three connected walls — the River Chelt in colour.',
  )
  await page.selectOption('select[name="f2"]', 'Large (20m²+)')
  await page.selectOption('select[name="f3"]', 'Spray paint')
  await page.selectOption('select[name="f5"]', 'Yes')
  await page.selectOption('select[name="f6"]', 'Full period')

  await scrollTo(page, 'button[type=submit]')
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')

  await expect(page.getByRole('heading', { name: 'Application submitted' })).toBeVisible({ timeout: 10000 })
  await pause(2500)
})
