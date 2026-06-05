import { test, expect, Browser } from '@playwright/test'
import { uniqueSuffix, createOrganiser, createFestival } from '../fixtures/helpers'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'

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

test('organiser builds a form from template, adds library embed field, saves and reloads; fields persist', async ({ browser }) => {
  const suffix = uniqueSuffix()

  const org = await createOrganiser(suffix)
  const { festivalId } = await createFestival(org.token, {
    name: `Builder Fest ${suffix}`,
    slug: `builder-${suffix}`,
  })

  const { page } = await loginAs(browser, org.email, org.password, BASE_URL)

  await page.goto(`/organiser/festivals/${festivalId}/form`)

  // Load the starter template — button only visible when form is empty.
  await page.getByRole('button', { name: /start from a template/i }).click()

  // Open the library panel.
  await page.getByRole('button', { name: /add from library/i }).click()

  // Click the embed preset (label: "Video walkthrough or 3D model (optional)").
  await page.getByTestId('library-panel').getByRole('button', { name: /walkthrough or 3D/i }).first().click()

  // Save the form.
  await page.getByRole('button', { name: /save form/i }).click()
  await expect(page.getByText('Saved ✓')).toBeVisible()

  // Reload the page — form fields should be persisted.
  await page.reload()
  // After reload, the starter template's "Artist statement" label input must be visible.
  // The label lives in an input[value], so scope via data-testid then query input directly.
  await expect(
    page.locator('[data-testid="builder-fields"] input[placeholder="Question label"]').first(),
  ).toHaveValue(/Artist statement/i)
})
