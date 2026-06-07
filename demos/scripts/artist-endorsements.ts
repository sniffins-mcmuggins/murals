import { test, expect } from '@playwright/test'
import { pause, highlight, showDialog, addCursorOverlay } from './helpers.js'
import { silentLogin } from './_setup.js'

// The artist controls which endorsements appear on their public page.
// Lady Gabe has a seeded organiser endorsement (CPF) and a peer one (Amara).
test('artist-endorsements — manage who vouches for you', async ({ page }) => {
  await addCursorOverlay(page)
  await silentLogin(page) // Lady Gabe

  await page.goto('/endorsements')
  await expect(page.getByRole('heading', { name: 'Endorsements' })).toBeVisible({ timeout: 8000 })
  await showDialog(page, 'Organisers and peers can vouch for an artist — and the artist controls what shows.')
  await pause(800)

  // Hide the peer endorsement → it greys out — then show it again. Locate the
  // card by its (stable) body text, not the endorser name: the visibility PATCH
  // response omits endorser_display_name, so the name flips to "Anonymous" after
  // a toggle. The single toggle button flips Hide↔Show, so click it by element.
  const toggle = page.locator('li').filter({ hasText: 'fearless' }).getByRole('button')
  await highlight(page, 'li:has-text("fearless") button')
  await toggle.click()   // hide
  await pause(1600)
  await toggle.click()   // show
  await pause(1500)
})
