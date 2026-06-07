import { test, expect } from '@playwright/test'
import { pause, showDialog, addCursorOverlay } from './helpers.js'
import { silentLogin } from './_setup.js'

// The analytics dashboard — aggregated reach (profile views, QR scans, link
// clicks). Privacy-clean: counts only, no per-visitor tracking.
// NOTE: the branded QR-code *download* has an API (GET /profiles/me/qr) but no
// web UI yet, so it is not part of this clip — see the demo-videos spec.
test('artist-analytics — your reach at a glance', async ({ page }) => {
  await addCursorOverlay(page)
  await silentLogin(page) // Lady Gabe (seeded analytics events)

  await page.goto('/analytics')
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible({ timeout: 8000 })
  await expect(page.getByText('Profile views')).toBeVisible({ timeout: 5000 })
  await showDialog(page, 'Artists see their reach — views, QR scans, link clicks. Aggregated only, never per-visitor.')
  await pause(2500)
})
