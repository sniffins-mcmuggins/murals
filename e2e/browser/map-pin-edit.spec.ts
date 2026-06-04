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
  stageDecision,
  releaseDecisions,
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

    // Wait for the panel's query data to be applied to the form inputs
    await expect(page.locator('[data-testid="spot-panel"] input').first()).not.toBeEmpty({ timeout: 5_000 })

    // Update notes and save
    await page.getByPlaceholder('e.g. needs cherry picker').fill('corner of High St')
    await page.getByRole('button', { name: 'Save' }).click()

    // Panel stays open; save button returns to non-loading state
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled({ timeout: 5_000 })

    // Verify the notes PATCH actually landed on the server
    const spotsAfterSave = await fetch(`${API}/festivals/${festivalId}/spots`, {
      headers: { Authorization: `Bearer ${organiser.token}` },
    })
    expect(spotsAfterSave.ok).toBe(true)
    const { spots } = (await spotsAfterSave.json()) as { spots: Array<{ id: string; notes: string | null }> }
    const savedSpot = spots.find(s => s.id === spotId)
    expect(savedSpot?.notes).toBe('corner of High St')

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

test('release-decisions → artist in pool → assign to spot → appears on public map', async ({ browser }) => {
  const suffix = `release-flow-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  // ── Arrange via API ───────────────────────────────────────────────────────
  const artist = await createArtist(suffix)
  await createProfile(artist.token, { displayName: `Release Flow Artist ${suffix}` })
  const organiser = await createOrganiser(suffix)
  const { festivalId, slug } = await createFestival(organiser.token, {
    name: `Release Flow Fest ${suffix}`,
    slug: `release-flow-${suffix}`,
  })
  await upsertForm(organiser.token, festivalId)
  await setFestivalStatus(organiser.token, festivalId, 'open')
  const { applicationId } = await submitApplication(artist.token, festivalId)

  // Stage accept + release (the E23 data-flow)
  await stageDecision(organiser.token, festivalId, applicationId, 'accept')
  await releaseDecisions(organiser.token, festivalId)

  // ── Verify artist appears in unassigned pool ──────────────────────────────
  const spotsRes = await fetch(`${API}/festivals/${festivalId}/spots`, {
    headers: { Authorization: `Bearer ${organiser.token}` },
  })
  expect(spotsRes.ok).toBe(true)
  const { unassigned_artists } = (await spotsRes.json()) as {
    unassigned_artists: { artist_id: string }[]
  }
  expect(unassigned_artists.length).toBe(1)
  const artistProfileId = unassigned_artists[0].artist_id

  // ── UI: open map editor, place spot, assign artist ────────────────────────
  const { ctx, page } = await loginAs(browser, organiser.email, organiser.password, baseURL)
  try {
    await page.goto(`/organiser/festivals/${festivalId}/map`)
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })

    // Place a spot by clicking the map
    await page.getByTestId('add-spot-btn').click()
    await expect(page.getByTestId('add-spot-btn')).toHaveText('Click map to place…')
    await page.locator('.leaflet-container').click({ position: { x: 250, y: 200 } })
    await expect(page.getByTestId('spot-panel')).toBeVisible({ timeout: 5_000 })

    // Assign the accepted artist from the dropdown
    await page.getByTestId('spot-panel').getByRole('combobox').selectOption({ index: 1 })
    await page.getByTestId('spot-panel').getByRole('button', { name: 'Save' }).click()
    await expect(
      page.getByTestId('spot-panel').getByRole('button', { name: 'Save' }),
    ).toBeEnabled({ timeout: 5_000 })

    // ── Verify the assignment landed server-side ──────────────────────────
    const spotsAfter = await fetch(`${API}/festivals/${festivalId}/spots`, {
      headers: { Authorization: `Bearer ${organiser.token}` },
    })
    const { spots } = (await spotsAfter.json()) as {
      spots: Array<{ id: string; artist_id: string | null }>
    }
    expect(spots.some(s => s.artist_id === artistProfileId)).toBe(true)

    // ── Public map: set festival live + verify pin appears ────────────────
    await setFestivalStatus(organiser.token, festivalId, 'live')
    const mapRes = await fetch(`${API}/festivals/slug/${slug}/map`)
    expect(mapRes.ok).toBe(true)
    const { pins } = (await mapRes.json()) as {
      pins: { artist_id: string; lat: number; lng: number }[]
    }
    expect(pins.length).toBe(1)
    expect(pins[0].artist_id).toBe(artistProfileId)
  } finally {
    await ctx.close()
  }
})

test('address search recentres the map (stubbed geocode)', async ({ browser }) => {
  const suffix = `search-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  const organiser = await createOrganiser(suffix)
  const { festivalId } = await createFestival(organiser.token, {
    name: `Search Test Fest ${suffix}`,
    slug: `search-test-${suffix}`,
  })

  const { ctx, page } = await loginAs(browser, organiser.email, organiser.password, baseURL)
  try {
    // Intercept geocode search — no live Nominatim dependency in CI
    await page.route('**/geocode/search**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            display_name: 'Cheltenham, Gloucestershire, England',
            lat: 51.9007,
            lng: -2.0783,
          },
        ]),
      }),
    )

    await page.goto(`/organiser/festivals/${festivalId}/map`)
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })

    // Type into search box (3+ chars triggers the debounced fetch)
    await page.getByLabel('Search address').fill('Cheltenham')

    // Results dropdown appears
    await expect(page.getByTestId('geocode-results')).toBeVisible({ timeout: 3_000 })
    await expect(page.getByTestId('geocode-results').getByRole('option').first()).toContainText(
      'Cheltenham',
    )

    // Selecting a result clears the input and closes the dropdown
    await page.getByTestId('geocode-results').getByRole('option').first().click()
    await expect(page.getByTestId('geocode-results')).not.toBeVisible()
    await expect(page.getByLabel('Search address')).toHaveValue('')
  } finally {
    await ctx.close()
  }
})

test('dragging a marker persists the new position without wiping other fields', async ({
  browser,
}) => {
  const suffix = `drag-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  const organiser = await createOrganiser(suffix)
  const { festivalId } = await createFestival(organiser.token, {
    name: `Drag Test Fest ${suffix}`,
    slug: `drag-test-${suffix}`,
  })

  // Pre-create a spot with notes (to verify the full-replace guard)
  const { spotId } = await createSpot(organiser.token, festivalId, 51.9007, -2.0783)
  // Set notes via PATCH so they exist before the drag
  await fetch(`${API}/festivals/${festivalId}/spots/${spotId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organiser.token}` },
    body: JSON.stringify({ lat: 51.9007, lng: -2.0783, notes: 'do not wipe me' }),
  })

  const { ctx, page } = await loginAs(browser, organiser.email, organiser.password, baseURL)
  try {
    await page.goto(`/organiser/festivals/${festivalId}/map`)
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.leaflet-marker-icon')).toBeVisible({ timeout: 5_000 })

    // Drag the marker
    const marker = page.locator('.leaflet-marker-icon').first()
    const box = await marker.boundingBox()
    if (!box) throw new Error('marker bounding box is null')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 60, { steps: 12 })
    await page.mouse.up()

    // Wait for the PATCH to land (query refetch)
    await page.waitForTimeout(1_500)

    // Verify new position was saved and notes were NOT wiped
    const spotsRes = await fetch(`${API}/festivals/${festivalId}/spots`, {
      headers: { Authorization: `Bearer ${organiser.token}` },
    })
    const { spots } = (await spotsRes.json()) as {
      spots: Array<{ id: string; lat: number; lng: number; notes: string | null }>
    }
    const s = spots.find(x => x.id === spotId)!
    expect(s.notes).toBe('do not wipe me')
    // Position should have changed (dragged by ~60px at zoom ~6 = small but non-zero delta)
    const latMoved = Math.abs(s.lat - 51.9007) > 0.0001 || Math.abs(s.lng - (-2.0783)) > 0.0001
    expect(latMoved).toBe(true)
  } finally {
    await ctx.close()
  }
})
