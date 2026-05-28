import { test, expect, Browser } from '@playwright/test'
import {
  createUser,
  createOrganiser,
  createFestival,
  setFestivalStatus,
  upsertForm,
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

test('apply without artist profile shows inline profile_required CTA', async ({ browser }) => {
  const suffix = Date.now()
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  const organiser = await createOrganiser(suffix)
  const { festivalId } = await createFestival(organiser.token, {
    name: `NoProfile Fest ${suffix}`,
    slug: `noprofile-${suffix}`,
  })
  await upsertForm(organiser.token, festivalId)
  await setFestivalStatus(organiser.token, festivalId, 'open')

  const artistNoProfile = await createUser('noprofile', suffix + 1)
  const { page } = await loginAs(browser, artistNoProfile.email, artistNoProfile.password, baseURL)

  await page.goto(`/applications/apply/${festivalId}`)
  await page.fill('[name="artist-statement"]', 'Walls and big colours')
  await page.getByRole('button', { name: /submit|apply/i }).click()

  await expect(page.getByText(/need an artist profile/i)).toBeVisible()
  await expect(page.getByRole('link', { name: /set up your artist profile/i })).toBeVisible()
})
