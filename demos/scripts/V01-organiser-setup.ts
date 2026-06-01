import { test, expect } from '@playwright/test'
import { slowType, pause, highlight } from './helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'

test('V01 — Organiser Setup', async ({ page }) => {
  const suffix = Date.now()
  const email = `marcus-demo-${suffix}@cpf-demo.art`
  const password = 'demo-password-2027'

  // ── 1. Sign up ───────────────────────────────────────────────────────────────
  await page.goto('/signup')
  await pause(1200)
  await slowType(page.locator('#email'), email)
  await slowType(page.locator('#password'), password)
  await page.selectOption('#role', 'organiser')
  await pause(800)
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
  await pause(600)

  // ── 2. Log in ─────────────────────────────────────────────────────────────────
  await slowType(page.locator('#email'), email)
  await slowType(page.locator('#password'), password)
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard', { timeout: 10000 })
  await pause(1500)

  // ── 3. Navigate to festivals list ─────────────────────────────────────────────
  await page.goto('/organiser/festivals')
  await expect(page.getByRole('heading', { name: 'Festivals' })).toBeVisible()
  await pause(1200)

  // ── 4. Create festival ────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'New festival' }).click()
  await pause(600)

  await slowType(page.locator('input[name="name"], input[placeholder*="Name" i]').first(), 'Cheltenham Paint Festival 2027')
  await pause(400)
  await slowType(page.locator('input[name="slug"], input[placeholder*="Slug" i]').first(), `cpf-2027-${suffix}`)
  await pause(400)
  await slowType(
    page.locator('textarea').first(),
    'Eight days of live mural creation across the town centre. Join us for CPF 2027.',
  )
  await pause(600)

  await page.getByRole('button', { name: 'Create' }).click()
  await pause(1500)

  // ── 5. Navigate to festival detail and extract ID ─────────────────────────────
  // After creation the modal closes and returns to the list page.
  // Get the ID from the festival's link href, then navigate to the detail page.
  await expect(page.getByText('Cheltenham Paint Festival 2027')).toBeVisible({ timeout: 8000 })
  const festivalHref = await page.locator('a[href*="/organiser/festivals/"]').first().getAttribute('href')
  const festivalId = festivalHref!.split('/').at(-1)!
  await page.goto(`/organiser/festivals/${festivalId}`)
  await pause(1200)

  const formRes = await page.request.put(`${API}/festivals/${festivalId}/form`, {
    data: {
      fields: [
        { id: 'f1', type: 'textarea', label: 'Describe your proposed mural concept', required: true },
        { id: 'f2', type: 'select', label: 'Preferred wall size', options: ['Small (up to 4m²)', 'Medium (4–20m²)', 'Large (20m²+)'], required: true },
        { id: 'f3', type: 'select', label: 'Primary medium', options: ['Spray paint', 'Brush', 'Mixed media', 'Roller'], required: true },
        { id: 'f4', type: 'textarea', label: 'Portfolio links (up to 3 URLs)', required: true },
        { id: 'f5', type: 'select', label: 'Do you have public liability insurance?', options: ['Yes', 'No', 'In progress'], required: true },
        { id: 'f6', type: 'select', label: 'Full festival availability (10–17 October)?', options: ['Full period', 'Partial — specify below'], required: true },
        { id: 'f7', type: 'select', label: 'Previous outdoor mural experience', options: ['Yes', 'No'], required: false },
        { id: 'f8', type: 'textarea', label: "Anything else you'd like to tell us?", required: false },
      ],
    },
    headers: { 'Content-Type': 'application/json' },
  })
  if (!formRes.ok()) throw new Error(`Form setup failed: ${formRes.status()}`)
  await page.reload()
  await pause(1500)

  // ── 6. Publish the festival ───────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Publish' }).click()
  await pause(1000)
  await expect(page.getByText('open')).toBeVisible({ timeout: 8000 })
  await pause(2000)
})
