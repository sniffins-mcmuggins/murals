import { test, expect } from '@playwright/test'
import { pause, highlight, slowType, showDialog, addCursorOverlay } from './helpers.js'
import { silentLogin, cpfFestivalId, ORGANISER_EMAIL, decideAllAndRelease } from './_setup.js'

// The map editor: search an address, drop and confirm a draft pin, see the
// crew navigation deep-links, then drag an accepted artist onto the spot.
test('organiser-map-editor — place a spot and assign an artist', async ({ page }) => {
  await addCursorOverlay(page)
  await silentLogin(page, ORGANISER_EMAIL) // Marcus Webb
  const fid = await cpfFestivalId(page.request)

  // Off-screen: accept Rosa & Amara and release, so they're eligible to place.
  await decideAllAndRelease(page, fid, ['Rosa Vane', 'Amara Diallo'])

  await page.goto(`/organiser/festivals/${fid}/map`)
  await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10000 })
  await showDialog(page, 'The map editor turns accepted artists into placed walls — search an address to begin.')
  await pause(500)

  await highlight(page, '[data-testid="geocode-search"] input')
  await slowType(page.getByLabel('Search address'), 'Cheltenham')
  await expect(page.getByTestId('geocode-results')).toBeVisible({ timeout: 5000 })
  await pause(500)
  await page.getByTestId('geocode-results').getByRole('option').first().click()
  await pause(800)

  // Confirm the draft pin → it becomes a spot and the panel opens.
  await expect(page.getByTestId('draft-pin-confirm')).toBeVisible({ timeout: 5000 })
  await highlight(page, '[data-testid="confirm-draft-spot"]')
  await page.getByTestId('confirm-draft-spot').click()
  await expect(page.getByTestId('spot-panel')).toBeVisible({ timeout: 5000 })
  await pause(700)

  // Crew navigation deep-links (What3Words / Google / Apple).
  await highlight(page, '[data-testid="link-w3w"]')
  await highlight(page, '[data-testid="link-google"]')
  await pause(600)

  // Drag an accepted artist from the rail onto the pin.
  await showDialog(page, 'Then drag an accepted artist straight onto their wall.', { pos: 'bottom' })
  await highlight(page, '[data-testid="artist-rail"]')
  await pause(400)
  const artistCard = page.getByTestId('artist-rail').locator('li').first()
  const targetPin = page.locator('.leaflet-marker-icon').last()
  await artistCard.dragTo(targetPin)
  await pause(2500)
})
