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

  // ── 3. Open applications page ────────────────────────────────────────────────
  // The URL is now /organiser/festivals/{id} — extract ID, go to applications
  const festivalId = page.url().split('/').at(-1)!
  await page.goto(`/organiser/festivals/${festivalId}/applications`)
  // Tabs are plain <button> elements (not ARIA tabs); Pending is active by default
  await expect(page.getByRole('button', { name: /Pending/ })).toBeVisible({ timeout: 8000 })
  await pause(1500)

  // ── 4. Review Kit Harrow — Accept inline ─────────────────────────────────────
  // Applications show inline Accept/Waitlist/Decline buttons on each card
  const kitItem = page.locator('li').filter({ hasText: 'Kit Harrow' })
  await expect(kitItem).toBeVisible({ timeout: 6000 })
  await pause(800)
  // Scroll to and highlight the Accept button on Kit's card
  await scrollTo(page, 'li:has-text("Kit Harrow") button:has-text("Accept")')
  await highlight(page, 'li:has-text("Kit Harrow") button:has-text("Accept")')
  await kitItem.getByRole('button', { name: 'Accept' }).click()
  await pause(1500)

  // ── 5. Navigate to festival map — Kit's pin now visible ───────────────────────
  await page.goto(`/organiser/festivals/${festivalId}/map`)
  await pause(2000)
  await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible({ timeout: 10000 })
  await pause(2500)

  // ── 6. Back to applications — decline Tomás Cruz ─────────────────────────────
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

  // Handle optional confirmation dialog
  const confirmBtn = page.getByRole('button', { name: /confirm|yes/i })
  if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await confirmBtn.click()
  }
  await pause(2000)
})
