import { test, expect } from '@playwright/test'
import * as path from 'path'

const API = process.env.API_URL ?? 'http://localhost:8080'
const FIXTURE_JPG = path.join(__dirname, '../fixtures/test.jpg')

test('artist onboarding: signup → profile → collection → upload → public page', async ({ page }) => {
  const suffix = Date.now()
  const email = `artist-onboard-${suffix}@e2e.test`
  const password = 'testpass123'

  // ── 1. Sign up via UI ────────────────────────────────────────────────────────
  await page.goto('/signup')
  await page.fill('#email', email)
  await page.fill('#password', password)
  // Role defaults to "Artist" — no change needed
  await page.click('button[type=submit]')

  // Signup redirects to /login?registered=1
  await expect(page).toHaveURL(/\/login/)

  // ── 2. Log in via UI ─────────────────────────────────────────────────────────
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard')

  // ── 3. Navigate to Profile and fill in details ────────────────────────────────
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()

  await page.fill('input[placeholder*="Display name"], input[placeholder*="display name"], input[name="displayName"], #displayName', 'Test Muralist')
  await page.fill('textarea', 'I paint walls.')
  await page.getByRole('button', { name: /save/i }).click()
  await expect(page.getByText(/saved|success/i)).toBeVisible()

  // ── 4. Get profile ID via API (cookies shared for localhost) ──────────────────
  const profileRes = await page.request.get(`${API}/profiles/me`)
  expect(profileRes.ok()).toBe(true)
  const profile = await profileRes.json()
  const profileId: string = profile.id

  // ── 5. Create a collection ────────────────────────────────────────────────────
  await page.goto('/collections')
  await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible()
  await page.getByRole('button', { name: 'New collection' }).click()
  await page.fill('input[placeholder*="Name"]', 'Urban Walls')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Urban Walls')).toBeVisible()

  // ── 6. Open collection and upload an image ────────────────────────────────────
  await page.getByText('Urban Walls').click()
  await expect(page.getByRole('heading', { name: 'Urban Walls' })).toBeVisible()

  // Set the file input (the drop zone wraps a hidden input)
  const fileInput = page.locator('input[type=file]')
  await fileInput.setInputFiles(FIXTURE_JPG)

  // Wait for the image thumbnail to appear
  await expect(page.locator('img[src*="localhost:9000"], img[src*="cdnUrl"], img[alt]').first()).toBeVisible({ timeout: 15_000 })

  // ── 7. Verify public artist profile page (unauthenticated) ───────────────────
  // Open public page in a fresh context (no auth)
  const publicPage = await page.context().browser()!.newPage()
  try {
    await publicPage.goto(`/artists/${profileId}`)
    await expect(publicPage.getByRole('heading', { name: 'Test Muralist' })).toBeVisible()
    await expect(publicPage.getByText('Urban Walls')).toBeVisible()
  } finally {
    await publicPage.close()
  }
})
