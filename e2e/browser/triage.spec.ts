import { test, expect, Browser } from '@playwright/test'
import {
  uniqueSuffix,
  createArtist,
  createProfile,
  createOrganiser,
  createFestival,
  setFestivalStatus,
  upsertForm,
  submitApplication,
} from '../fixtures/helpers'

const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

async function loginAs(
  browser: Browser,
  email: string,
  password: string,
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

test('organiser triages submitted applications into the shortlist', async ({ browser }) => {
  const suffix = uniqueSuffix()

  // ── Set up test data via API ──────────────────────────────────────────────────
  const organiser = await createOrganiser(suffix)
  const { festivalId } = await createFestival(organiser.token, {
    name: `Triage Fest ${suffix}`,
    slug: `triage-${suffix}`,
  })
  // Use the default form field so submitApplication's hardcoded answer matches.
  await upsertForm(organiser.token, festivalId)
  // Festival must be open so artists can apply.
  await setFestivalStatus(organiser.token, festivalId, 'open')

  // Two artists each create a profile then submit an application.
  const artist1 = await createArtist(`${suffix}a`)
  await createProfile(artist1.token, { displayName: `Triage Artist 1 ${suffix}` })
  await submitApplication(artist1.token, festivalId)

  const artist2 = await createArtist(`${suffix}b`)
  await createProfile(artist2.token, { displayName: `Triage Artist 2 ${suffix}` })
  await submitApplication(artist2.token, festivalId)

  // ── Organiser: log in and open the applications board ─────────────────────────
  const { ctx: organiserCtx, page } = await loginAs(
    browser,
    organiser.email,
    organiser.password,
  )

  try {
    await page.goto(`/organiser/festivals/${festivalId}/applications`)

    // Both applications should be loaded (column header shows count > 0).
    await expect(page.getByRole('heading', { name: 'Applications', exact: true })).toBeVisible()

    // Open triage mode.
    await page.getByTestId('open-triage').click()
    await expect(page.getByTestId('triage-mode')).toBeVisible()

    // ArrowRight: shortlist the first application and advance.
    await page.keyboard.press('ArrowRight')

    // Escape: exit triage overlay.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('triage-mode')).not.toBeVisible()

    // Back on the board: one application is now in the ⭐ Shortlisted column.
    // The column header text is "⭐ Shortlisted (1)" — assert it shows 1 item.
    await expect(
      page.getByText('⭐ Shortlisted', { exact: false }).filter({ hasText: '(1)' }),
    ).toBeVisible()
  } finally {
    await organiserCtx.close()
  }
})
