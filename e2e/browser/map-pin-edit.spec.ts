// Map editor pin update (issue #113).
//
// The existing browser spec (`application-flow.spec.ts`) only exercises
// adding a pin. This one places an initial pin and then UPDATEs it by
// clicking a different point on the map and saving again.
//
// Delete: the API exposes only PATCH /festivals/{id}/artists/{aid}/pin
// (SetArtistPinHandler). There is no DELETE endpoint and no UI affordance
// to clear a pin. This test covers update only — see the commit body for
// the report on why delete is omitted.
import { test, expect, Browser } from '@playwright/test'
import {
  acceptArtist,
  createArtist,
  createOrganiser,
  createProfile,
  createFestival,
  setFestivalStatus,
  upsertForm,
  setPin,
  submitApplication,
} from '../fixtures/helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'

async function loginAs(
  browser: Browser,
  email: string,
  password: string,
  baseURL: string,
) {
  const ctx = await browser.newContext({ baseURL })
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/')
  return { ctx, page }
}

test('organiser updates an existing pin', async ({ browser }) => {
  const suffix = `gaps-pin-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  // Set up festival, artist, application, acceptance, and an initial pin via API.
  const artist = await createArtist(suffix)
  await createProfile(artist.token, { displayName: `Pin Artist ${suffix}` })
  const organiser = await createOrganiser(suffix)
  const { festivalId, slug } = await createFestival(organiser.token, {
    name: `Pin Fest ${suffix}`,
    slug: `pin-${suffix}`,
  })
  await upsertForm(organiser.token, festivalId)
  await setFestivalStatus(organiser.token, festivalId, 'open')
  const { applicationId } = await submitApplication(artist.token, festivalId)
  await acceptArtist(organiser.token, festivalId, applicationId)

  // Fetch the artist's profile id from the accepted list (handler returns profile.id).
  const acceptedRes = await fetch(`${API}/festivals/${festivalId}/artists/accepted`, {
    headers: { Authorization: `Bearer ${organiser.token}` },
  })
  expect(acceptedRes.ok).toBe(true)
  const accepted = (await acceptedRes.json()) as { artist_id: string }[]
  expect(accepted.length).toBe(1)
  const artistProfileId = accepted[0].artist_id

  // Seed the initial pin via API.
  await setPin(organiser.token, festivalId, artistProfileId, 51.9, -2.07)

  // Organiser opens the map editor — initial pin should be summarised in the list.
  const { ctx, page } = await loginAs(browser, organiser.email, organiser.password, baseURL)
  try {
    await page.goto(`/organiser/festivals/${festivalId}/map`)
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })
    // Initial coords surface in the accepted-artists list.
    await expect(page.getByText('51.9000, -2.0700')).toBeVisible()

    // Click a different point on the map to start an update.
    await page.locator('.leaflet-container').click({ position: { x: 200, y: 150 } })
    await expect(page.getByRole('heading', { name: 'Place pin' })).toBeVisible()

    // Select the same artist (whose option shows "(pin set)" since we already
    // placed one) and save — this updates the existing pin.
    await page.selectOption('#artist-select', { label: `Pin Artist ${suffix} (pin set)` })
    await page.getByRole('button', { name: 'Save pin' }).click()

    // Place-pin panel closes; the old coordinate string is no longer shown.
    await expect(page.getByRole('button', { name: 'Save pin' })).not.toBeVisible({ timeout: 5_000 })
    await expect(page.getByText('51.9000, -2.0700')).not.toBeVisible()

    // Confirm via API: the pin lat/lng changed (and is on the public map once live).
    await setFestivalStatus(organiser.token, festivalId, 'live')
    const mapRes = await fetch(`${API}/festivals/slug/${slug}/map`)
    expect(mapRes.ok).toBe(true)
    const { pins } = (await mapRes.json()) as { pins: { lat: number; lng: number }[] }
    expect(pins.length).toBe(1)
    expect(pins[0].lat).not.toBeCloseTo(51.9, 4)
  } finally {
    await ctx.close()
  }
})
