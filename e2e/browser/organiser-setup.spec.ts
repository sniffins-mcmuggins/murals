import { test, expect } from '@playwright/test'

const API = process.env.API_URL ?? 'http://localhost:8080'

test('organiser setup: signup → create festival → publish → public page visible', async ({ page }) => {
  const suffix = Date.now()
  const email = `organiser-setup-${suffix}@e2e.test`
  const password = 'testpass123'
  const slug = `e2e-fest-${suffix}`

  // ── 1. Sign up as organiser via UI ────────────────────────────────────────────
  await page.goto('/signup')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.selectOption('#role', 'organiser')
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/login/)

  // ── 2. Log in ─────────────────────────────────────────────────────────────────
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard')

  // ── 3. Navigate to organiser festivals and create festival ────────────────────
  await page.goto('/organiser/festivals')
  await expect(page.getByRole('heading', { name: 'Festivals' })).toBeVisible()

  await page.getByRole('button', { name: 'New festival' }).click()
  await page.fill('input[placeholder*="Name"]', 'E2E Fest 2027')
  await page.fill('input[placeholder*="Slug"]', slug)
  await page.fill('textarea[placeholder*="Description"]', 'An e2e test festival')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('E2E Fest 2027')).toBeVisible()

  // ── 4. Open festival detail page ──────────────────────────────────────────────
  await page.getByText('E2E Fest 2027').click()
  await expect(page.getByRole('heading', { name: 'E2E Fest 2027' })).toBeVisible()

  // ── 5. Get the festival ID so we can set up the form via API ──────────────────
  // The URL is /organiser/festivals/{id}
  const url = page.url()
  const festivalId = url.split('/').at(-1)!

  // Set up the application form via the API using the browser's session cookie.
  // page.request carries the authenticated session automatically — no Bearer token needed.
  const formRes = await page.request.put(`${API}/festivals/${festivalId}/form`, {
    data: { fields: [{ type: 'text', label: 'Artist statement', required: true }] },
    headers: { 'Content-Type': 'application/json' },
  })
  expect(formRes.ok()).toBe(true)

  // ── 6. Publish the festival via UI ────────────────────────────────────────────
  await page.getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByText('open')).toBeVisible()

  // ── 7. Verify public festival page ────────────────────────────────────────────
  const publicPage = await page.context().browser()!.newPage()
  try {
    await publicPage.goto(`/festivals/${festivalId}`)
    await expect(publicPage.getByRole('heading', { name: 'E2E Fest 2027' })).toBeVisible()
    await expect(publicPage.getByText('An e2e test festival')).toBeVisible()
  } finally {
    await publicPage.close()
  }
})
