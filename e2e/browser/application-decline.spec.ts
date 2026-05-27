// Browser-driven decline path (issue #113).
// The accept path is covered by `application-flow.spec.ts`; this one drives
// the Decline button and confirms the application disappears from `submitted`
// state and lands in `declined`.
import { test, expect, Browser } from '@playwright/test'
import {
  createArtist,
  createProfile,
  createOrganiser,
  createFestival,
  setFestivalStatus,
  upsertForm,
  submitApplication,
} from '../fixtures/helpers'

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

test('organiser declines an application via the UI', async ({ browser }) => {
  const suffix = `gaps-decline-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  // Set up: artist with profile, organiser with open festival + form.
  const artist = await createArtist(suffix)
  await createProfile(artist.token, { displayName: `Decline Artist ${suffix}` })
  const organiser = await createOrganiser(suffix)
  const { festivalId } = await createFestival(organiser.token, {
    name: `Decline Fest ${suffix}`,
    slug: `decline-${suffix}`,
  })
  await upsertForm(organiser.token, festivalId)
  await setFestivalStatus(organiser.token, festivalId, 'open')
  await submitApplication(artist.token, festivalId)

  // Organiser logs in and views applications.
  const { ctx, page } = await loginAs(browser, organiser.email, organiser.password, baseURL)
  try {
    await page.goto(`/organiser/festivals/${festivalId}/applications`)
    await expect(page.getByText('submitted', { exact: true })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: 'Decline' }).click()

    // After clicking decline, the application status flips to "declined".
    await expect(page.getByText('declined', { exact: true })).toBeVisible({ timeout: 10_000 })
    // ...and is no longer in "submitted" state.
    await expect(page.getByText('submitted', { exact: true })).toHaveCount(0)
  } finally {
    await ctx.close()
  }
})
