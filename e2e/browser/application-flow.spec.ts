import { test, expect, Browser } from '@playwright/test'
import {
  createArtist,
  createProfile,
  createOrganiser,
  createFestival,
  setFestivalStatus,
  upsertForm,
  setPin,
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

test('apply → accept → pin → map data contains pin', async ({ browser }) => {
  const suffix = Date.now()
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  // ── beforeAll equivalent: set up test data via API ────────────────────────────
  const artist = await createArtist(suffix)
  await createProfile(artist.token, { displayName: `E2E Artist ${suffix}` })
  const organiser = await createOrganiser(suffix)
  const { festivalId, slug } = await createFestival(organiser.token, {
    name: `Flow Fest ${suffix}`,
    slug: `flow-${suffix}`,
  })
  await upsertForm(organiser.token, festivalId)
  await setFestivalStatus(organiser.token, festivalId, 'open')

  // ── Artist: log in and apply ───────────────────────────────────────────────────
  const { ctx: artistCtx, page: artistPage } = await loginAs(
    browser,
    artist.email,
    artist.password,
    baseURL,
  )

  try {
    await artistPage.goto('/applications')
    await expect(artistPage.getByRole('heading', { name: 'Applications' })).toBeVisible()

    // Find the festival in the "Open festivals" list and click Apply
    await expect(artistPage.getByText(`Flow Fest ${suffix}`)).toBeVisible({ timeout: 10_000 })
    await artistPage.getByRole('link', { name: 'Apply' }).click()

    // Fill the application form
    await expect(artistPage.getByRole('form', { name: 'Application form' })).toBeVisible()
    await artistPage.fill('input, textarea', 'I paint large-scale murals for festivals.')
    await artistPage.getByRole('button', { name: 'Submit application' }).click()

    // Confirm submission
    await expect(artistPage.getByRole('heading', { name: 'Application submitted' })).toBeVisible()

    // Artist applications list shows submitted status
    await artistPage.goto('/applications')
    await expect(artistPage.getByText('submitted')).toBeVisible()
  } finally {
    // Don't close yet — we need to check again later
  }

  // ── Organiser: log in and accept ───────────────────────────────────────────────
  const { ctx: organiserCtx, page: organiserPage } = await loginAs(
    browser,
    organiser.email,
    organiser.password,
    baseURL,
  )

  try {
    await organiserPage.goto(`/organiser/festivals/${festivalId}/applications`)
    await expect(organiserPage.getByText('submitted')).toBeVisible({ timeout: 10_000 })

    await organiserPage.getByRole('button', { name: 'Accept' }).click()
    await expect(organiserPage.getByText('accepted')).toBeVisible()

    // ── Map editor: place pin ─────────────────────────────────────────────────────
    await organiserPage.goto(`/organiser/festivals/${festivalId}/map`)
    await expect(organiserPage.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })

    // Click roughly in the center of the map
    await organiserPage.locator('.leaflet-container').click({ position: { x: 400, y: 300 } })

    // PlacePinPanel appears
    await expect(organiserPage.getByRole('heading', { name: 'Place pin' })).toBeVisible()

    // Select the accepted artist from the dropdown
    await organiserPage.selectOption('#artist-select', { label: `E2E Artist ${suffix}` })

    // Fill W3W (optional but we validate the format)
    await organiserPage.fill('#w3w-input', 'three.word.address')

    // Save the pin
    await organiserPage.getByRole('button', { name: 'Save pin' }).click()
    await expect(organiserPage.getByRole('button', { name: 'Save pin' })).not.toBeVisible({ timeout: 5_000 })

    // ── Assert: map data API returns the pin ───────────────────────────────────────
    // Set festival to live (UI only supports draft/open; use API directly)
    await setFestivalStatus(organiser.token, festivalId, 'live')

    const mapRes = await fetch(`${API}/festivals/slug/${slug}/map`)
    expect(mapRes.ok).toBe(true)
    const mapData = await mapRes.json()
    expect(Array.isArray(mapData.pins)).toBe(true)
    expect(mapData.pins.length).toBeGreaterThan(0)
    expect(typeof mapData.pins[0].lat).toBe('number')
  } finally {
    await artistCtx.close()
    await organiserCtx.close()
  }
})
