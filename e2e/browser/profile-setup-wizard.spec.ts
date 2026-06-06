import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { forcePublish } from '../fixtures/db-helpers.js'
import { verifyEmailViaMailpit } from '../fixtures/mailpit.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'

test('profile setup wizard: signup → walk wizard → public page shows bio/mediums/support', async ({ page }) => {
  const suffix = Date.now()
  const email = `wizard-${suffix}@e2e.test`
  const password = 'testpass123'

  // Sign up + verify (lands on /dashboard).
  await page.goto('/signup')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await expect(page.getByText(/check your inbox/i)).toBeVisible()
  await verifyEmailViaMailpit(page, email)
  await expect(page).toHaveURL('/dashboard')

  // Visiting /profile must redirect a brand-new artist to the wizard.
  await page.goto('/profile')
  await expect(page).toHaveURL(/\/profile\/setup$/)

  // Step 1 — name.
  await expect(page.getByRole('heading', { name: "Let's build your page" })).toBeVisible()
  // The label has no htmlFor — use placeholder to locate the input.
  await page.getByPlaceholder('e.g. Lady Gabe').fill('Wizard Test Artist')
  await page.getByRole('button', { name: /Continue/ }).click()

  // Step 2 — photos: skip.
  await expect(page.getByRole('heading', { name: 'Add some photos' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  // Step 3 — bio.
  await expect(page.getByRole('heading', { name: 'Tell people who you are' })).toBeVisible()
  await page.locator('textarea').fill('I paint bold folkloric murals across the South West.')
  await page.getByRole('button', { name: /Continue/ }).click()

  // Step 4 — location: skip.
  await expect(page.getByRole('heading', { name: 'Where are you based?' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  // Step 5 — mediums: pick two.
  await expect(page.getByRole('heading', { name: 'What do you make?' })).toBeVisible()
  await page.getByTestId('medium-picker').getByRole('button', { name: 'mural' }).click()
  await page.getByTestId('medium-picker').getByRole('button', { name: 'lettering' }).click()
  await page.getByRole('button', { name: /Continue/ }).click()

  // Step 6 — social: skip.
  await expect(page.getByRole('heading', { name: 'Where can people find you?' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  // Step 7 — support link.
  await expect(page.getByRole('heading', { name: 'Let people support you' })).toBeVisible()
  await page.getByTestId('support-link-input').fill('https://buymeacoffee.com/wizardartist')
  await page.getByRole('button', { name: /Continue/ }).click()

  // Step 8 — first work: skip.
  await expect(page.getByRole('heading', { name: 'Show your first piece' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  // Step 9 — review. Finish for now (avoids the billing gate in the test).
  await expect(page.getByRole('heading', { name: "You're ready" })).toBeVisible()
  await page.getByRole('button', { name: /Finish for now/ }).click()
  await expect(page).toHaveURL('/profile')

  // Grab the profile and force-publish (bypasses billing), then assert public page.
  const me = await page.request.get(`${API}/profiles/me`)
  const profile = await me.json()
  expect(profile.support_url).toBe('https://buymeacoffee.com/wizardartist')
  expect(profile.setup_completed_at).toBeTruthy()

  const db = new Client({ connectionString: DB_URL })
  await db.connect()
  try {
    // forcePublish takes userId, not profile.id
    await forcePublish(db, profile.user_id)
  } finally {
    await db.end()
  }

  await page.goto(`/artists/${profile.id}`)
  await expect(page.getByRole('heading', { name: 'Wizard Test Artist' })).toBeVisible()
  await expect(page.getByText('I paint bold folkloric murals across the South West.')).toBeVisible()
  await expect(page.getByText('mural', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /support/i })).toBeVisible()

  // Re-visiting /profile now lands on the editor, not the wizard.
  await page.goto('/profile')
  await expect(page).toHaveURL('/profile')
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
})
