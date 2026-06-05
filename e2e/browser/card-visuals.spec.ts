import { test, expect, Browser } from '@playwright/test'
import {
  createArtist, createOrganiser, createProfile,
  createFestival, setFestivalStatus, upsertForm, submitApplication,
} from '../fixtures/helpers'

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

test.describe('card visuals', () => {
  const suffix = `card-vis-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  test('slide-over has View full profile link pointing to /artists/{uuid}', async ({ browser }) => {
    const org = await createOrganiser(suffix)
    const { festivalId } = await createFestival(org.token, {
      name: `Card Vis Fest ${suffix}`,
      slug: `card-vis-${suffix}`,
    })
    await upsertForm(org.token, festivalId)
    await setFestivalStatus(org.token, festivalId, 'open')

    const artist = await createArtist(`${suffix}-artist`)
    // createProfile does not support avatarUrl — test profile link only
    await createProfile(artist.token, {
      displayName: `CV Artist ${suffix}`,
    })
    await submitApplication(artist.token, festivalId)

    const { ctx, page } = await loginAs(browser, org.email, org.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.locator('.grid-cols-5')).toBeVisible({ timeout: 10_000 })

      // Open the slide-over by clicking the card for this artist
      await page
        .locator('[class*="rounded-lg"]')
        .filter({ hasText: `CV Artist ${suffix}` })
        .first()
        .click()

      // Slide-over heading confirms correct application
      await expect(
        page.getByRole('heading', { name: `CV Artist ${suffix}` }),
      ).toBeVisible({ timeout: 5_000 })

      // Profile link present with correct href pattern and target=_blank
      const profileLink = page.getByRole('link', { name: /View full profile/ })
      await expect(profileLink).toBeVisible()

      const href = await profileLink.getAttribute('href')
      expect(href).toMatch(/^\/artists\/[0-9a-f-]{36}$/)

      const target = await profileLink.getAttribute('target')
      expect(target).toBe('_blank')
    } finally {
      await ctx.close()
    }
  })
})
