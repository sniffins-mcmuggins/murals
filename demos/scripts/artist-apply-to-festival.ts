import { test, expect } from '@playwright/test'
import { pause, highlight, slowType, scrollTo, showDialog, addCursorOverlay } from './helpers.js'
import { silentLogin } from './_setup.js'

// Applying to an open festival — Lady Gabe owns CPF, so she applies to Upfest 2027
// (a festival she doesn't own): find it, fill the form, submit.
test('artist-apply-to-festival — submit a festival application', async ({ page }) => {
  await addCursorOverlay(page)
  await silentLogin(page) // Lady Gabe

  await page.goto('/applications')
  await expect(page.getByRole('heading', { name: 'Applications', exact: true })).toBeVisible({ timeout: 8000 })
  await showDialog(page, 'Artists apply to open festivals right from their dashboard.')
  await pause(500)

  const openSection = page.locator('section').filter({ hasText: 'Open festivals' })
  const item = openSection.locator('li').filter({ hasText: 'Upfest 2027' }).first()
  await highlight(page, 'a[href*="apply"]')
  await item.getByRole('link', { name: 'Apply' }).click()

  await expect(page.getByRole('heading', { name: /^Apply to/ })).toBeVisible({ timeout: 8000 })
  await pause(700)

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
