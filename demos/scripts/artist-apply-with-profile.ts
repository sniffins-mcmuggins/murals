import { test, expect } from '@playwright/test'
import { pause, highlight, slowType, scrollTo, showDialog, addCursorOverlay } from './helpers.js'
import { silentLogin } from './_setup.js'

// E28 "never type twice": the application form arrives pre-filled from the
// artist's profile (portfolio, Instagram), with a one-click "Apply with my
// profile" CTA. Lady Gabe only adds the festival-specific questions.
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

  // ── The headline: the form is already filled from her profile ────────────────
  await showDialog(page, 'Her socials, bio and portfolio already live on her profile — so the form arrives pre-filled.')
  await scrollTo(page, 'input[name="f9"]')
  await highlight(page, 'input[name="f9"]') // Instagram — pre-filled, "from your profile"
  await pause(900)

  await showDialog(page, 'One click drops in everything her profile already knows — no re-typing.', { pos: 'bottom' })
  await scrollTo(page, 'button:has-text("Apply with my profile")')
  await highlight(page, 'button:has-text("Apply with my profile")')
  await pause(1000)

  // ── She only adds the festival-specific questions ────────────────────────────
  await showDialog(page, 'She only answers what is specific to this festival.')
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
