import { test, expect } from '@playwright/test'
import {
  createArtist,
  createProfile,
  createCollection,
  uploadImage,
  createOrganiser,
  createFestival,
  setFestivalStatus,
  upsertForm,
  submitApplication,
  acceptArtist,
  createSpot,
  assignArtistToSpot,
} from '../fixtures/helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'

test.describe('public visitor flow', () => {
  let festivalId: string
  let profileId: string
  let collectionId: string
  let artistDisplayName: string

  test.beforeAll(async () => {
    const suffix = Date.now()
    artistDisplayName = `Public Artist ${suffix}`

    // Set up artist with profile, collection, and image
    const artist = await createArtist(suffix)
    const { profileId: pid } = await createProfile(artist.token, { displayName: artistDisplayName })
    profileId = pid
    const { collectionId: cid } = await createCollection(artist.token, { name: 'Wall Pieces' })
    collectionId = cid
    await uploadImage(artist.token, collectionId)

    // Set up organiser with a live festival with a pinned artist
    const organiser = await createOrganiser(suffix)
    const { festivalId: fid, slug } = await createFestival(organiser.token, {
      name: `Public Fest ${suffix}`,
      slug: `public-${suffix}`,
    })
    festivalId = fid
    await upsertForm(organiser.token, festivalId)
    await setFestivalStatus(organiser.token, festivalId, 'open')

    // Artist applies
    const { applicationId } = await submitApplication(artist.token, festivalId)

    // Organiser accepts and gets the artist's ID from the spots endpoint (unassigned_artists)
    await acceptArtist(organiser.token, festivalId, applicationId)
    const spotsRes = await fetch(`${API}/festivals/${festivalId}/spots`, {
      headers: { Authorization: `Bearer ${organiser.token}` },
    })
    if (!spotsRes.ok) throw new Error(`Get spots failed: ${spotsRes.status}`)
    const { unassigned_artists } = (await spotsRes.json()) as { unassigned_artists: { artist_id: string }[] }
    const artistId = unassigned_artists[0].artist_id

    // Create a spot and assign the accepted artist
    const { spotId } = await createSpot(organiser.token, festivalId, 51.9, -2.07)
    await assignArtistToSpot(organiser.token, festivalId, spotId, artistId)

    // Set festival to live
    await setFestivalStatus(organiser.token, festivalId, 'live')
  })

  test('visitor views festival, opens map, clicks pin, navigates to artist profile', async ({ page }) => {
    // ── 1. Festival page loads ───────────────────────────────────────────────────
    await page.goto(`/festivals/${festivalId}`)
    await expect(page.locator('h1')).toContainText(/Public Fest/)

    // ── 2. Navigate to map ────────────────────────────────────────────────────────
    await page.getByRole('link', { name: /map/i }).click()
    await expect(page).toHaveURL(/\/map/)
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })

    // ── 3. At least one marker is visible ────────────────────────────────────────
    await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible({ timeout: 10_000 })

    // ── 4. Click marker to open pin panel ────────────────────────────────────────
    await page.locator('.leaflet-marker-icon').first().click()
    await expect(page.locator('[data-testid="map-pin-panel"]')).toBeVisible()
    await expect(page.locator('[data-testid="map-pin-panel"]')).toContainText(artistDisplayName)

    // ── 5. Navigate to artist profile ────────────────────────────────────────────
    await page.locator('[data-testid="map-pin-panel"]').getByRole('link').first().click()
    await expect(page).toHaveURL(new RegExp(`/artists/${profileId}`))
    await expect(page.getByRole('heading', { name: artistDisplayName })).toBeVisible()

    // ── 6. Collection image visible ───────────────────────────────────────────────
    await expect(page.getByText('Wall Pieces')).toBeVisible()
    // The cover image is set by uploadImage helper (PATCH coverS3Key)
    await expect(page.locator('section[aria-label="Collections"] img').first()).toBeVisible()
  })

  test('visitor clicks collection card, lands on collection detail page', async ({ page }) => {
    await page.goto(`/artists/${profileId}`)
    await expect(page.getByRole('heading', { name: artistDisplayName })).toBeVisible()

    // ── Collection strip is visible ───────────────────────────────────────────────
    await expect(page.getByText('Wall Pieces')).toBeVisible()

    // ── Click the collection card ─────────────────────────────────────────────────
    await page.getByText('Wall Pieces').click()
    await expect(page).toHaveURL(new RegExp(`/artists/${profileId}/collections/${collectionId}`))

    // ── Detail page shows the collection name ─────────────────────────────────────
    await expect(page.getByRole('heading', { name: 'Wall Pieces' })).toBeVisible()
    // The image uploaded in beforeAll should appear in the grid
    await expect(page.locator('img').first()).toBeVisible()
  })
})
