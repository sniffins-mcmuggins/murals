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
  // Signup now shows "Check your inbox" — email verification required.
  await expect(page.getByText(/check your inbox/i)).toBeVisible()
  // Bypass email verification via test endpoint so we can log in immediately.
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

test('entitled artist: publish → public → unpublish → draft', async ({ page }) => {
  const suffix = Date.now()
  const email = `pub-entitled-${suffix}@e2e.test`
  const password = 'testpass123'

  await signupAndLogin(page, email, password)

  // Create a profile via API + mark setup complete so /profile shows the editor
  // (a brand-new artist is otherwise redirected to the /profile/setup wizard).
  const createRes = await page.request.post(`${API}/profiles`, { data: { displayName: 'Publish Test Artist' } })
  expect(createRes.ok()).toBe(true)
  const setupRes = await page.request.post(`${API}/profiles/me/complete-setup`)
  expect(setupRes.ok()).toBe(true)
  await page.goto('/profile')

  // Get user_id via API for DB grant
  const profileRes = await page.request.get(`${API}/profiles/me`)
  expect(profileRes.ok()).toBe(true)
  const profile = await profileRes.json()

  // Grant access in DB
  const db = new Client({ connectionString: DB_URL })
  await db.connect()
  try {
    await forceGrant(db, profile.user_id)
  } finally {
    await db.end()
  }

  // Reload — should see Draft badge and Go Public button
  await page.reload()
  await expect(page.getByTestId('visibility-badge')).toHaveText('Draft')
  await expect(page.getByRole('button', { name: /go public/i })).toBeVisible()

  // Publish
  await page.getByRole('button', { name: /go public/i }).click()
  await expect(page.getByTestId('visibility-badge')).toHaveText('Public')
  await expect(page.getByRole('button', { name: /take offline/i })).toBeVisible()

  // Verify public page accessible (no auth)
  const publicContext = await page.context().browser()!.newPage()
  try {
    const publicRes = await publicContext.request.get(`${API}/profiles/${profile.id}`)
    expect(publicRes.ok()).toBe(true)
  } finally {
    await publicContext.close()
  }

  // Unpublish
  await page.getByRole('button', { name: /take offline/i }).click()
  await expect(page.getByTestId('visibility-badge')).toHaveText('Draft')
  await expect(page.getByRole('button', { name: /go public/i })).toBeVisible()

  // Verify no longer public
  const anonContext = await page.context().browser()!.newPage()
  try {
    const draftRes = await anonContext.request.get(`${API}/profiles/${profile.id}`)
    expect(draftRes.status()).toBe(404)
  } finally {
    await anonContext.close()
  }
})

test('non-entitled artist: Go Public shows upsell, profile stays draft', async ({ page }) => {
  const suffix = Date.now()
  const email = `pub-nopay-${suffix}@e2e.test`
  const password = 'testpass123'

  await signupAndLogin(page, email, password)

  // Create a profile via API + mark setup complete so /profile shows the editor
  // (a brand-new artist is otherwise redirected to the /profile/setup wizard).
  const createRes = await page.request.post(`${API}/profiles`, { data: { displayName: 'No Pay Artist' } })
  expect(createRes.ok()).toBe(true)
  const setupRes = await page.request.post(`${API}/profiles/me/complete-setup`)
  expect(setupRes.ok()).toBe(true)
  await page.goto('/profile')

  // Reload to render PublishBar from server
  await page.reload()
  await expect(page.getByTestId('visibility-badge')).toHaveText('Draft')

  // Click Go Public — no entitlement
  await page.getByRole('button', { name: /go public/i }).click()

  // Upsell panel appears
  await expect(page.getByTestId('upsell-panel')).toBeVisible()

  // Profile is still draft — button is still Go Public
  await expect(page.getByRole('button', { name: /go public/i })).toBeVisible()
  await expect(page.getByTestId('visibility-badge')).toHaveText('Draft')
})
