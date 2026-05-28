// Map editor spot flow.
//
// Covers: organiser pre-creates a spot via API, assigns an artist to it,
// opens the map editor, verifies the spot appears, and uses the UI to
// update the spot's notes.
import { test, expect, Browser } from '@playwright/test'
import {
  createArtist,
  createOrganiser,
  createProfile,
  createFestival,
  setFestivalStatus,
  upsertForm,
  submitApplication,
  acceptArtist,
  createSpot,
  assignArtistToSpot,
} from '../fixtures/helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'

async function loginAs(browser: Browser, email: string, password: string, baseURL: string) {
  const ctx = await browser.newContext({ baseURL })
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard')
  return { ctx, page }
}

test('organiser views and edits a pre-created spot', async ({ browser }) => {
  const suffix = `spot-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  // Arrange: festival, artist, acceptance, spot assignment
  const artist = await createArtist(suffix)
  await createProfile(artist.token, { displayName: `Spot Artist ${suffix}` })
  const organiser = await createOrganiser(suffix)
  const { festivalId, slug } = await createFestival(organiser.token, {
    name: `Spot Fest ${suffix}`,
    slug: `spot-${suffix}`,
  })
  await upsertForm(organiser.token, festivalId)
  await setFestivalStatus(organiser.token, festivalId, 'open')
  const { applicationId } = await submitApplication(artist.token, festivalId)
  await acceptArtist(organiser.token, festivalId, applicationId)

  // Get the artist profile ID from the spots endpoint
  const spotsRes = await fetch(`${API}/festivals/${festivalId}/spots`, {
    headers: { Authorization: `Bearer ${organiser.token}` },
  })
  expect(spotsRes.ok).toBe(true)
  const { unassigned_artists } = (await spotsRes.json()) as { unassigned_artists: { artist_id: string }[] }
  expect(unassigned_artists.length).toBe(1)
  const artistProfileId = unassigned_artists[0].artist_id

  // Create a spot and assign the artist via API
  const { spotId } = await createSpot(organiser.token, festivalId, 51.9007, -2.0783)
  await assignArtistToSpot(organiser.token, festivalId, spotId, artistProfileId)

  // Open map editor and verify the assigned spot is visible
  const { ctx, page } = await loginAs(browser, organiser.email, organiser.password, baseURL)
  try {
    await page.goto(`/organiser/festivals/${festivalId}/map`)
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })

    // Spot appears in sidebar as assigned
    await expect(page.getByTestId('spots-list')).toBeVisible()
    // The 'assigned' badge is inside the spots list (strict: use first match within list)
    await expect(page.getByTestId('spots-list').getByText('assigned')).toBeVisible()

    // Click the spot in the sidebar to open the panel
    await page.getByTestId('spots-list').getByRole('button', { name: /Spot 1/ }).click()
    await expect(page.getByTestId('spot-panel')).toBeVisible()

    // Update notes and save
    await page.getByPlaceholder('e.g. needs cherry picker').fill('corner of High St')
    await page.getByRole('button', { name: 'Save' }).click()

    // Panel stays open; save button returns to non-loading state
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled({ timeout: 5_000 })

    // Confirm via public map API that the spot is pinned correctly
    await setFestivalStatus(organiser.token, festivalId, 'live')
    const mapRes = await fetch(`${API}/festivals/slug/${slug}/map`)
    expect(mapRes.ok).toBe(true)
    const { pins } = (await mapRes.json()) as { pins: { lat: number; lng: number; artist_id: string }[] }
    expect(pins.length).toBe(1)
    expect(pins[0].lat).toBeCloseTo(51.9007, 3)
    expect(pins[0].artist_id).toBe(artistProfileId)
  } finally {
    await ctx.close()
  }
})

test('organiser creates a new spot via the UI', async ({ browser }) => {
  const suffix = `newspot-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  const organiser = await createOrganiser(suffix)
  const { festivalId } = await createFestival(organiser.token, {
    name: `New Spot Fest ${suffix}`,
    slug: `newspot-${suffix}`,
  })

  const { ctx, page } = await loginAs(browser, organiser.email, organiser.password, baseURL)
  try {
    await page.goto(`/organiser/festivals/${festivalId}/map`)
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })

    // No spots yet
    await expect(page.getByText('No spots yet.')).toBeVisible()

    // Click "Add spot" to arm placement mode
    await page.getByTestId('add-spot-btn').click()
    await expect(page.getByTestId('add-spot-btn')).toHaveText('Click map to place…')

    // Click the map to place a spot
    await page.locator('.leaflet-container').click({ position: { x: 250, y: 200 } })

    // A spot should appear in the sidebar and the panel should open
    await expect(page.getByTestId('spot-panel')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('spots-list').getByText('Spot 1')).toBeVisible()
  } finally {
    await ctx.close()
  }
})
