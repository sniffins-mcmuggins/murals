import { test, expect } from '@playwright/test'
import { pause, highlight, showDialog, addCursorOverlay } from './helpers.js'
import { API, silentLogin, myProfileId } from './_setup.js'

// Managing portfolio collections: the collections list, opening a collection and
// browsing its images, then seeing how that collection appears publicly.
test('artist-collections — organise your portfolio', async ({ page }) => {
  await addCursorOverlay(page)
  await silentLogin(page) // Lady Gabe (seeded "Murals 2027" collection, 4 images)
  const profileId = await myProfileId(page)
  const collectionsRes = await page.request.get(`${API}/profiles/${profileId}/collections`)
  const collections: Array<{ id: string }> = await collectionsRes.json()
  const collectionId = collections[0]?.id

  // ── Collections list ──────────────────────────────────────────────────────
  await page.goto('/collections')
  await expect(page.getByRole('heading', { name: /collections/i })).toBeVisible({ timeout: 8000 })
  await showDialog(page, 'Artists group their work into collections — one per project, series, or year.')
  await pause(600)

  // ── Open a collection ───────────────────────────────────────────────────────
  await highlight(page, 'text=Murals 2027')
  await page.getByText('Murals 2027').first().click()
  await expect(page.getByRole('heading', { name: 'Murals 2027' })).toBeVisible({ timeout: 8000 })
  await showDialog(page, 'Inside a collection you manage its images — add, reorder, and set the cover.', { pos: 'bottom' })
  await page.evaluate(() => window.scrollTo({ top: 350, behavior: 'smooth' }))
  await pause(1400)
  await page.evaluate(() => window.scrollTo({ top: 750, behavior: 'smooth' }))
  await pause(1600)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await pause(1000)

  // ── How it looks publicly ────────────────────────────────────────────────────
  if (collectionId) {
    await page.goto(`/artists/${profileId}/collections/${collectionId}`)
    await pause(1200)
    await showDialog(page, 'And here is the same collection as the public sees it.')
    await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'smooth' }))
    await pause(1800)
    await page.evaluate(() => window.scrollTo({ top: 1100, behavior: 'smooth' }))
    await pause(2000)
  }
})
