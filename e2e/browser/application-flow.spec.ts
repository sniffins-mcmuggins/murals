import { test, expect, Browser } from '@playwright/test'
import {
  uniqueSuffix,
  createArtist,
  createProfile,
  createOrganiser,
  createFestival,
  setFestivalStatus,
  upsertForm,
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
  await expect(page).toHaveURL('/dashboard')
  return { ctx, page }
}

test('apply → accept → pin → map data contains pin', async ({ browser }) => {
  const suffix = uniqueSuffix()
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
    await expect(artistPage.getByRole('heading', { name: 'Applications', exact: true })).toBeVisible()

    // Find the festival in the "Open festivals" list and click Apply
    await expect(artistPage.getByText(`Flow Fest ${suffix}`)).toBeVisible({ timeout: 10_000 })
    await artistPage.getByRole('listitem').filter({ hasText: `Flow Fest ${suffix}` }).getByRole('link', { name: 'Apply' }).click()

    // Fill the application form
    await expect(artistPage.getByRole('form', { name: 'Application form' })).toBeVisible()
    await artistPage.fill('input, textarea', 'I paint large-scale murals for festivals.')
    await artistPage.getByRole('button', { name: 'Submit application' }).click()

    // Confirm submission
    await expect(artistPage.getByRole('heading', { name: 'Application submitted' })).toBeVisible()

    // Artist applications list shows the pending outcome (no verdict until release)
    await artistPage.goto('/applications')
    await expect(artistPage.getByText('Under review', { exact: true })).toBeVisible()
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
    // Kanban board: the submitted application starts in the Undecided column
    await expect(organiserPage.getByRole('heading', { name: 'Applications' })).toBeVisible({ timeout: 10_000 })
    await expect(organiserPage.getByText(`E2E Artist ${suffix}`)).toBeVisible({ timeout: 10_000 })

    // Open the card → stage an Accept decision in the slide-over → close
    await organiserPage.getByText(`E2E Artist ${suffix}`).first().click()
    await organiserPage.getByRole('button', { name: '✓ Accept' }).click()
    await organiserPage.keyboard.press('Escape')

    // Release the staged decision — finalises status to accepted + notifies the artist
    await organiserPage.getByRole('button', { name: /Release/ }).click()
    await organiserPage.getByRole('checkbox').check()
    await organiserPage.getByRole('button', { name: 'Yes, release' }).click()
    await expect(organiserPage.getByText('Decisions released')).toBeVisible({ timeout: 10_000 })

    // ── Map editor: create spot and assign artist ────────────────────────────────
    await organiserPage.goto(`/organiser/festivals/${festivalId}/map`)
    await expect(organiserPage.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })

    // Enter placement mode
    await organiserPage.getByTestId('add-spot-btn').click()
    await expect(organiserPage.getByTestId('add-spot-btn')).toHaveText('Click map to place…')

    // Click the map to create a spot
    await organiserPage.locator('.leaflet-container').click({ position: { x: 400, y: 300 } })

    // Spot panel opens
    await expect(organiserPage.getByTestId('spot-panel')).toBeVisible({ timeout: 5_000 })

    // Select the accepted artist from the dropdown in the panel (the panel also
    // has a "Mural status" select, so target the Artist select specifically).
    await organiserPage.getByTestId('spot-panel').getByLabel('Artist').selectOption({ label: `E2E Artist ${suffix}` })

    // Save
    await organiserPage.getByRole('button', { name: 'Save' }).click()
    await expect(organiserPage.getByRole('button', { name: 'Save' })).toBeEnabled({ timeout: 5_000 })

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
