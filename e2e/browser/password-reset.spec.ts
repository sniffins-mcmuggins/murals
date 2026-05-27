// A8 — Browser: forgot-password confirmation + reset-password redirect to /login?reset=1.
// Uses the injectResetToken seam (PR #114) because NoopMailer drops the real email.
import { test, expect } from '@playwright/test'
import { createArtist } from '../fixtures/helpers'
import { injectResetToken } from '../fixtures/auth-flows'

test('A8 — forgot-password confirmation, reset via injected token, login with new password', async ({
  page,
}) => {
  const suffix = `pwreset-${Date.now()}`
  const artist = await createArtist(suffix)
  const newPassword = 'browser-new-pw-12345'

  // ── /forgot-password shows "Check your email" confirmation ────────────────
  await page.goto('/forgot-password')
  await expect(
    page.getByRole('heading', { name: 'Forgot password', exact: true }),
  ).toBeVisible()
  await page.fill('#email', artist.email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  // The page renders "Check your email." text in a paragraph after submit.
  await expect(page.getByText('Check your email.')).toBeVisible()

  // ── Inject a token directly into the DB (NoopMailer dropped the real one) ──
  const rawToken = await injectResetToken(artist.email)

  // ── /reset-password?token=… → submit new password → redirect to /login?reset=1 ──
  await page.goto(`/reset-password?token=${rawToken}`)
  await expect(
    page.getByRole('heading', { name: 'Reset password', exact: true }),
  ).toBeVisible()
  await page.fill('#password', newPassword)
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page).toHaveURL('/login?reset=1')

  // ── Log in successfully with the new password ──────────────────────────────
  await page.fill('#email', artist.email)
  await page.fill('#password', newPassword)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/')
})
