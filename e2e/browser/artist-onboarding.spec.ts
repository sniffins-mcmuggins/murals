import { test, expect } from '@playwright/test'
import * as path from 'path'
import { Client } from 'pg'
import { forcePublish } from '../fixtures/db-helpers.js'
import { verifyEmailViaMailpit } from '../fixtures/mailpit.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
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

  // Signup stays on /signup and shows "Check your inbox" success state.
  await expect(page.getByText(/check your inbox/i)).toBeVisible()

  // ── 2. Verify email via Mailpit ───────────────────────────────────────────────
  // Opens Mailpit web UI (visible in demo videos), shows the inbox,
  // then navigates to the verify link which logs the user in and
  // redirects to /dashboard.
  await verifyEmailViaMailpit(page, email)
  await expect(page).toHaveURL('/dashboard')

  // ── 3. Create + fill profile via API, then navigate to the profile editor ───
  // New users are redirected to the setup wizard before setup_completed_at is
  // stamped. We use the API directly here (cookies are shared with page.request)
  // to seed the profile data and mark setup complete, then confirm the editor
  // renders correctly. The wizard UI flow itself is covered by the wizard spec.
  const createRes = await page.request.post(`${API}/profiles`, {
    data: { displayName: 'Test Muralist' },
    headers: { 'Content-Type': 'application/json' },
  })
  expect(createRes.ok()).toBe(true)
  await page.request.patch(`${API}/profiles/me`, {
    data: { bio: 'I paint walls.' },
    headers: { 'Content-Type': 'application/json' },
  })
  await page.request.post(`${API}/profiles/me/complete-setup`, {})

  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
  await expect(page.locator('input[name="displayName"]')).toHaveValue('Test Muralist')

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

  // Publish the profile so it is visible to anonymous visitors.
  // Uses a direct DB update (forcePublish) to bypass the entitlement gate —
  // this test covers the onboarding flow, not the publish gate.
  const db = new Client({ connectionString: DB_URL })
  await db.connect()
  try {
    await forcePublish(db, profile.user_id)
  } finally {
    await db.end()
  }

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
