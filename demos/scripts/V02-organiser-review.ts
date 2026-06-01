import { test, expect } from '@playwright/test'
import { pause, highlight, scrollTo, slowType } from './helpers.js'

test('V02 — Organiser Review', async ({ page }) => {
  // ── 1. Log in as Marcus ───────────────────────────────────────────────────────
  await page.goto('/login')
  await pause(800)
  await slowType(page.locator('#email'), 'marcus@cpf-demo.art')
  await slowType(page.locator('#password'), 'demo-password-2027')
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard', { timeout: 10000 })
  await pause(1500)

  // ── 2. Navigate to CPF 2027 ───────────────────────────────────────────────────
  await page.goto('/organiser/festivals')
  await expect(page.getByText('Cheltenham Paint Festival 2027')).toBeVisible({ timeout: 8000 })
  await pause(800)
  await page.getByText('Cheltenham Paint Festival 2027').click()
  await pause(1200)

  // ── 3. Open applications tab ─────────────────────────────────────────────────
  const festivalId = page.url().split('/').at(-1)!
  await page.goto(`/organiser/festivals/${festivalId}/applications`)
  await expect(page.getByRole('tab', { name: 'Pending' })).toBeVisible({ timeout: 8000 })
  await page.getByRole('tab', { name: 'Pending' }).click()
  await pause(1500)

  // ── 4. Open Kit Harrow's application ─────────────────────────────────────────
  await page.locator('.bg-warm.border.border-light').filter({ hasText: 'Kit Harrow' }).first().click()
  await pause(1200)

  // ── 5. Read the application ───────────────────────────────────────────────────
  await scrollTo(page, '[role="dialog"], aside, [class*="slide"]')
  await pause(2000)

  // ── 6. Accept Kit ────────────────────────────────────────────────────────────
  await highlight(page, 'button')
  await page.getByRole('button', { name: 'Accept' }).click()
  await pause(1500)
  await page.keyboard.press('Escape')
  await pause(800)

  // ── 7. Festival map — Kit's pin is now visible ────────────────────────────────
  await page.goto(`/organiser/festivals/${festivalId}/map`)
  await pause(2000)
  await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible({ timeout: 10000 })
  await pause(2500)

  // ── 8. Back to applications — open Tomás Cruz ────────────────────────────────
  await page.goto(`/organiser/festivals/${festivalId}/applications`)
  await page.getByRole('tab', { name: 'Pending' }).click()
  await pause(600)
  await page.locator('.bg-warm.border.border-light').filter({ hasText: 'Tomás Cruz' }).first().click()
  await pause(1200)
  await scrollTo(page, '[role="dialog"], aside, [class*="slide"]')
  await pause(1500)

  // ── 9. Decline Tomás ─────────────────────────────────────────────────────────
  await highlight(page, 'button')
  await page.getByRole('button', { name: 'Decline' }).click()
  await pause(1000)
  // Handle optional confirmation
  const confirmBtn = page.getByRole('button', { name: /confirm|yes/i })
  if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await confirmBtn.click()
  }
  await pause(1500)
  await page.keyboard.press('Escape')
  await pause(2000)
})
