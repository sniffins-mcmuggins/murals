import { test, expect } from '@playwright/test'
import { slowType, pause, highlight } from './helpers.js'
import * as path from 'path'
import * as fs from 'fs'

const API = process.env.API_URL ?? 'http://localhost:8080'

const GABE_BIO =
  'South-West based muralist. Bold colour, mythological themes, outdoor work across the UK. ' +
  'Available for festivals, commissions, and residencies.'
const GABE_INSTAGRAM = 'https://instagram.com/ladygabeart'

// Reuse the existing e2e fixture image
const FIXTURE_JPG = path.join(__dirname, '../../e2e/fixtures/test.jpg')

test('V03 — Artist Signup', async ({ page }) => {
  const suffix = Date.now()
  const email = `gabe-signup-${suffix}@demo.art`
  const password = 'demo-password-2027'

  // ── 1. Sign up ───────────────────────────────────────────────────────────────
  await page.goto('/signup')
  await pause(1200)
  await slowType(page.locator('#email'), email)
  await slowType(page.locator('#password'), password)
  await pause(800)
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
  await pause(600)

  // ── 2. Log in ─────────────────────────────────────────────────────────────────
  await slowType(page.locator('#email'), email)
  await slowType(page.locator('#password'), password)
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard', { timeout: 10000 })
  await pause(1500)

  // ── 3. Fill in profile ────────────────────────────────────────────────────────
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
  await pause(1000)

  await slowType(page.locator('input[name="displayName"]'), 'Lady Gabe')
  await pause(400)
  await slowType(page.locator('textarea').first(), GABE_BIO)
  await pause(400)
  await slowType(page.locator('input[aria-label="Instagram"]'), GABE_INSTAGRAM)
  await pause(600)

  await highlight(page, 'button[type=submit]')
  await page.getByRole('button', { name: /save profile/i }).click()
  await expect(page.locator('[role="status"]')).toBeVisible({ timeout: 8000 })
  await pause(1200)

  // ── 4. Redeem promo code for access (behind the scenes — not shown on screen) ──
  // DEMO2027 is seeded by task demo:seed — gives artist_basic for 2 years.
  const redeemRes = await page.request.post(`${API}/promo/redeem`, {
    data: { code: 'DEMO2027' },
    headers: { 'Content-Type': 'application/json' },
  })
  if (!redeemRes.ok()) throw new Error(`Promo redeem: ${redeemRes.status()}`)
  await pause(600)

  // ── 5. Create collection and upload image ─────────────────────────────────────
  await page.goto('/collections')
  await expect(page.getByRole('heading', { name: /collections/i })).toBeVisible()
  await pause(800)

  await page.getByRole('button', { name: /new collection/i }).click()
  await pause(400)
  await slowType(page.locator('input[placeholder*="Name" i], input[name="name"]').first(), 'Murals 2027')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Murals 2027')).toBeVisible({ timeout: 6000 })
  await pause(600)

  await page.getByText('Murals 2027').click()
  await expect(page.getByRole('heading', { name: 'Murals 2027' })).toBeVisible()
  await pause(800)

  if (!fs.existsSync(FIXTURE_JPG)) throw new Error(`Fixture not found: ${FIXTURE_JPG}`)
  await page.locator('input[type=file]').setInputFiles(FIXTURE_JPG)
  await expect(page.locator('img').first()).toBeVisible({ timeout: 30000 })
  await pause(1500)

  // ── 6. Publish profile ────────────────────────────────────────────────────────
  await page.goto('/profile')
  await expect(page.locator('[data-testid="publish-bar"]')).toBeVisible({ timeout: 8000 })
  await pause(1000)
  await highlight(page, '[data-testid="publish-bar"] button')
  await page.locator('[data-testid="publish-bar"]').getByRole('button', { name: /go public|publish/i }).click()
  await pause(1200)
  await expect(page.locator('[data-testid="visibility-badge"]')).toContainText(/public/i, { timeout: 8000 })
  await pause(1000)

  // ── 7. View public profile ────────────────────────────────────────────────────
  const profilePageRes = await page.request.get(`${API}/profiles/me`)
  const { id: profileId } = await profilePageRes.json()
  await page.goto(`/artists/${profileId}`)
  await pause(2500)
})
