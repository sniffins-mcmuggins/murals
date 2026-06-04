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

test.describe('review round', () => {
  const suffix = `review-round-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  test('organiser opens round → decisions locked → closes → unlocked', async ({ browser }) => {
    const org = await createOrganiser(suffix)
    const { festivalId } = await createFestival(org.token, { name: `RR ${suffix}`, slug: `rr-${suffix}` })
    await upsertForm(org.token, festivalId)
    await setFestivalStatus(org.token, festivalId, 'open')
    const applicant = await createArtist(`${suffix}-art`)
    await createProfile(applicant.token, { displayName: `RR Artist ${suffix}` })
    await submitApplication(applicant.token, festivalId)

    const { ctx, page } = await loginAs(browser, org.email, org.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.getByRole('button', { name: 'Open review round' })).toBeVisible({ timeout: 10_000 })

      // Open the round.
      await page.getByRole('button', { name: 'Open review round' }).click()
      await expect(page.getByText('Review round')).toContainText('open', { timeout: 5_000 })

      // While open, drag handles are gone (decisions locked).
      await expect(page.getByLabel('Drag to reorder')).toHaveCount(0)

      // Close the round.
      await page.getByRole('button', { name: 'Close round' }).click()
      await expect(page.getByText('Review round closed · scores final')).toBeVisible({ timeout: 5_000 })
    } finally {
      await ctx.close()
    }
  })
})
