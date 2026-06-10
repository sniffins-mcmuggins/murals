// e2e/browser/profile-draft-publish.spec.ts
// E29.7 — Browser canary: draft edits do not leak to the public until
// publish-changes is clicked; preview shows draft; public page is frozen.
import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { forceGrant } from '../fixtures/db-helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'

async function signupAndLogin(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
) {
  await page.goto('/signup')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await expect(page.getByText(/check your inbox/i)).toBeVisible()
  // Bypass email verification via test endpoint
  const verifyRes = await fetch(`${API}/_test/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!verifyRes.ok) throw new Error(`Verify failed: ${verifyRes.status}`)
  await page.goto('/login')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard')
}

test('draft bio edit shows in preview, does not leak publicly until publish-changes', async ({ page, browser }) => {
  const suffix = Date.now()
  const email = `draft-pub-${suffix}@e2e.test`
  const password = 'testpass123'

  await signupAndLogin(page, email, password)

  // Create profile via API and mark setup complete so /profile shows the editor
  const createRes = await page.request.post(`${API}/profiles`, { data: { displayName: 'Draft Test Artist' } })
  expect(createRes.ok()).toBe(true)
  const setupRes = await page.request.post(`${API}/profiles/me/complete-setup`)
  expect(setupRes.ok()).toBe(true)

  // Get profile data
  const profileRes = await page.request.get(`${API}/profiles/me`)
  expect(profileRes.ok()).toBe(true)
  const profile = await profileRes.json()
  const profileId: string = profile.id

  // Grant entitlement and go public (seeds snapshot v1 with blank bio)
  const db = new Client({ connectionString: DB_URL })
  await db.connect()
  try {
    await forceGrant(db, profile.user_id)
  } finally {
    await db.end()
  }

  // Navigate to /profile and go public
  await page.goto('/profile')
  await page.reload()
  await expect(page.getByTestId('visibility-badge')).toHaveText('Draft')
  await page.getByRole('button', { name: /go public/i }).click()
  await expect(page.getByTestId('visibility-badge')).toHaveText('Public')

  // Edit bio — the label is a div (no htmlFor) so getByLabel won't work.
  // The bio textarea is the second textbox on the form (after Display name).
  // Display name is input[name="displayName"]; bio textarea has no name attr.
  const bioTextarea = page.locator('textarea').first()
  await bioTextarea.fill('DRAFT BIO v2')
  await page.getByRole('button', { name: 'Save profile' }).click()
  // Wait for save confirmation
  await expect(page.getByRole('status')).toHaveText(/saved/i)

  // The unpublished indicator should now appear (the PATCH triggers the dirty flag)
  // We need to reload because the PublishBar is server-rendered and the dirty flag
  // is set in the DB by a trigger — the client-side state may not reflect it yet.
  await page.reload()
  await expect(page.getByTestId('unpublished-indicator')).toBeVisible()

  // ── Preview shows the draft bio ────────────────────────────────────────────
  await page.goto('/profile/preview')
  await expect(page.getByTestId('preview-name')).toBeVisible()
  await expect(page.getByText('DRAFT BIO v2')).toBeVisible()

  // ── Anonymous page does NOT show the new bio (snapshot is frozen) ──────────
  const anonContext = await browser.newContext()
  const anonPage = await anonContext.newPage()
  try {
    await anonPage.goto(`/artists/${profileId}`)
    // Profile is public so page loads (200), but bio is still v1 (blank)
    await expect(anonPage.getByRole('heading', { name: 'Draft Test Artist' })).toBeVisible()
    // The new bio must not appear
    await expect(anonPage.getByText('DRAFT BIO v2')).toHaveCount(0)
  } finally {
    await anonPage.close()
    await anonContext.close()
  }

  // ── Publish changes ────────────────────────────────────────────────────────
  await page.goto('/profile')
  await expect(page.getByTestId('unpublished-indicator')).toBeVisible()
  await page.getByTestId('publish-changes-btn').click()
  // Indicator should disappear after publish-changes
  await expect(page.getByTestId('unpublished-indicator')).toHaveCount(0)

  // ── Anonymous page now shows the new bio ──────────────────────────────────
  const anonContext2 = await browser.newContext()
  const anonPage2 = await anonContext2.newPage()
  try {
    await anonPage2.goto(`/artists/${profileId}`)
    await expect(anonPage2.getByRole('heading', { name: 'Draft Test Artist' })).toBeVisible()
    await expect(anonPage2.getByText('DRAFT BIO v2')).toBeVisible()
  } finally {
    await anonPage2.close()
    await anonContext2.close()
  }
})
