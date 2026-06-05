import { test, expect, Browser } from '@playwright/test'
import {
  createOrganiser, createFestival, setFestivalStatus, upsertForm,
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

test.describe('mural history overlay', () => {
  const suffix = `mural-hist-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  test('mural status dropdown in spot panel persists on save', async ({ browser }) => {
    test.setTimeout(60_000)
    const org = await createOrganiser(suffix)
    const { festivalId } = await createFestival(org.token, {
      name: `MH Fest ${suffix}`, slug: `mh-${suffix}`,
    })
    await upsertForm(org.token, festivalId)
    await setFestivalStatus(org.token, festivalId, 'open')

    const { ctx, page } = await loginAs(browser, org.email, org.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/map`)
      await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })

      // Place a spot
      await page.getByTestId('add-spot-btn').click()
      await page.locator('.leaflet-container').click({ position: { x: 400, y: 300 } })
      await expect(page.getByTestId('spot-panel')).toBeVisible({ timeout: 5_000 })

      // Set mural status to permanent and save
      await page.getByLabel('Mural status').selectOption('permanent')
      await page.getByRole('button', { name: /save/i }).click()

      // Wait for save to complete (panel stays open; spots query refetches)
      await page.waitForTimeout(1_500)
      await expect(page.getByLabel('Mural status')).toHaveValue('permanent')

      // Close the panel and reopen via sidebar to confirm the value persisted in the DB
      await page.getByRole('button', { name: 'Close' }).click()
      await expect(page.getByTestId('spot-panel')).not.toBeVisible({ timeout: 3_000 })
      await page.getByTestId('spots-list').getByRole('button').first().click()
      await expect(page.getByTestId('spot-panel')).toBeVisible({ timeout: 5_000 })
      await expect(page.getByLabel('Mural status')).toHaveValue('permanent')
    } finally {
      await ctx.close()
    }
  })
})
