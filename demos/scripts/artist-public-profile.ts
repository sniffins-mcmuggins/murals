import { test } from '@playwright/test'
import { pause, showDialog, addCursorOverlay } from './helpers.js'
import { silentLogin, myProfileId } from './_setup.js'

// The public artist page as the world sees it: headline strip, bio + medium tags,
// portfolio collection, and the organiser + peer endorsements (seeded).
test('artist-public-profile — your public artist page', async ({ page }) => {
  await addCursorOverlay(page)
  await silentLogin(page) // Lady Gabe (seeded, published)
  const id = await myProfileId(page)

  await page.goto(`/artists/${id}`)
  await pause(1200)
  await showDialog(page, 'Every artist gets a clean public page — portfolio, bio, links, and endorsements.')
  await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'smooth' }))
  await pause(1500)
  await page.evaluate(() => window.scrollTo({ top: 1100, behavior: 'smooth' }))
  await pause(1500)
  await page.evaluate(() => window.scrollTo({ top: 1900, behavior: 'smooth' }))
  await pause(2200)
})
