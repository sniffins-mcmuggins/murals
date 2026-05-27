// A15 — MFA login via the browser.
//
// Set up an MFA-enabled user via API helpers (signup → enroll → confirm), then
// drive the login UI: email + password → 2FA screen → 6-digit code → land on /.
// The login form's MFA branch lives in web/src/app/(auth)/login/page.tsx.
import { test, expect } from '@playwright/test'
import { createArtist } from '../fixtures/helpers'
import { enrollMFA, confirmMFA, totpCode } from '../fixtures/auth-flows'

test('A15 — log in with MFA enabled and land on /', async ({ page }) => {
  // ── Set up MFA-enabled artist via API ────────────────────────────────────────
  const artist = await createArtist(Date.now())
  const { secret } = await enrollMFA(artist.token)

  // Confirm. Retry once across a 30s boundary if we straddle one.
  let confirm = await confirmMFA(artist.token, totpCode(secret))
  if (confirm.status === 401) {
    confirm = await confirmMFA(
      artist.token,
      totpCode(secret, new Date(Date.now() + 1500)),
    )
  }
  expect(confirm.status).toBe(200)

  // ── Drive the login form ─────────────────────────────────────────────────────
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
  await page.fill('#email', artist.email)
  await page.fill('#password', artist.password)
  await page.click('button[type=submit]')

  // 2FA screen should render. The H1 is "Two-factor authentication".
  await expect(
    page.getByRole('heading', { name: 'Two-factor authentication', exact: true }),
  ).toBeVisible()

  // Generate the code as late as possible so we don't straddle a TOTP window
  // boundary between the helper call and the form submission.
  await page.fill('#totp', totpCode(secret))
  await page.getByRole('button', { name: 'Verify' }).click()

  await expect(page).toHaveURL('/')
})
