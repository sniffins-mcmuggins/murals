import { test, expect } from '@playwright/test'
import { pause, highlight, scrollTo, slowType } from './helpers.js'

test('V06 — Organiser Full', async ({ page }) => {
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

  // ── 3. Browse the festival detail — shows status, dates, form fields ──────────
  const festivalId = page.url().split('/').at(-1)!
  await page.keyboard.press('End')
  await pause(1500)
  await page.keyboard.press('Home')
  await pause(1000)

  // ── 4. Open applications inbox ───────────────────────────────────────────────
  await page.goto(`/organiser/festivals/${festivalId}/applications`)
  await expect(page.getByRole('button', { name: /Pending/ })).toBeVisible({ timeout: 8000 })
  await pause(1500)

  // ── 5. Accept Kit Harrow ─────────────────────────────────────────────────────
  const kitItem = page.locator('li').filter({ hasText: 'Kit Harrow' })
  await expect(kitItem).toBeVisible({ timeout: 6000 })
  await pause(800)
  await scrollTo(page, 'li:has-text("Kit Harrow") button:has-text("Accept")')
  await highlight(page, 'li:has-text("Kit Harrow") button:has-text("Accept")')
  await kitItem.getByRole('button', { name: 'Accept' }).click()
  await pause(1500)

  // ── 6. View festival map — Kit's pin now visible ──────────────────────────────
  await page.goto(`/organiser/festivals/${festivalId}/map`)
  await pause(2000)
  await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible({ timeout: 10000 })
  await pause(2500)

  // ── 7. Back to inbox — decline Tomás Cruz ────────────────────────────────────
  await page.goto(`/organiser/festivals/${festivalId}/applications`)
  await expect(page.getByRole('button', { name: /Pending/ })).toBeVisible({ timeout: 8000 })
  await pause(600)

  const tomasItem = page.locator('li').filter({ hasText: 'Tomás Cruz' })
  await expect(tomasItem).toBeVisible({ timeout: 6000 })
  await pause(800)
  await scrollTo(page, 'li:has-text("Tomás Cruz") button:has-text("Decline")')
  await highlight(page, 'li:has-text("Tomás Cruz") button:has-text("Decline")')
  await tomasItem.getByRole('button', { name: 'Decline' }).click()
  await pause(1000)

  const confirmBtn = page.getByRole('button', { name: /confirm|yes/i })
  if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await confirmBtn.click()
  }
  await pause(2000)
})
