import { test, expect } from '@playwright/test'
import { slowType, pause, highlight, scrollTo } from './helpers.js'

test('V04 — Artist Apply', async ({ page }) => {
  // ── 1. Log in as Lady Gabe ────────────────────────────────────────────────────
  await page.goto('/login')
  await pause(800)
  await page.fill('#email', 'ladygabe@demo.art')
  await page.fill('#password', 'demo-password-2027')
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard', { timeout: 10000 })
  await pause(1500)

  // ── 2. Find CPF 2027 in open festivals ────────────────────────────────────────
  await page.goto('/applications')
  await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible({ timeout: 8000 })
  await pause(1200)

  await expect(page.getByText('Cheltenham Paint Festival 2027')).toBeVisible({ timeout: 8000 })
  await pause(800)
  await highlight(page, 'a[href*="apply"]')

  // Scope to the CPF 2027 list item to avoid strict-mode violations
  const festivalItem = page.locator('li').filter({ hasText: 'Cheltenham Paint Festival 2027' })
  await festivalItem.getByRole('link', { name: 'Apply' }).click()
  await pause(1200)

  // ── 3. Fill the application form ─────────────────────────────────────────────
  await expect(page.getByRole('heading', { name: /apply|application/i })).toBeVisible({ timeout: 8000 })
  await pause(1000)

  // f1 — mural concept (textarea)
  await scrollTo(page, 'textarea[name="f1"]')
  await slowType(
    page.locator('textarea[name="f1"]'),
    'A large-scale triptych exploring the mythology of the River Chelt — its source, journey, and meeting with the Severn. Water, memory, and time rendered in bold colour across three connected walls.',
  )
  await pause(600)

  // f2 — wall size (select)
  await page.selectOption('select[name="f2"]', 'Large (20m²+)')
  await pause(400)

  // f3 — medium (select)
  await page.selectOption('select[name="f3"]', 'Spray paint')
  await pause(400)

  // f4 — portfolio links (textarea)
  await scrollTo(page, 'textarea[name="f4"]')
  await slowType(
    page.locator('textarea[name="f4"]'),
    'https://ladygabe.com/portfolio\nhttps://instagram.com/ladygabeart\nhttps://vimeo.com/ladygabe',
  )
  await pause(600)

  // f5 — insurance (select)
  await page.selectOption('select[name="f5"]', 'Yes')
  await pause(400)

  // f6 — availability (select)
  await page.selectOption('select[name="f6"]', 'Full period')
  await pause(400)

  // f7 — experience (select)
  await page.selectOption('select[name="f7"]', 'Yes')
  await pause(400)

  // f8 — anything else: leave blank, scroll past to submit
  await scrollTo(page, 'button[type=submit]')
  await pause(800)

  // ── 4. Submit ─────────────────────────────────────────────────────────────────
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')
  await pause(1200)

  // ── 5. Confirmation ───────────────────────────────────────────────────────────
  await expect(page.getByText(/submitted|thank you|we.ll be in touch/i)).toBeVisible({ timeout: 10000 })
  await pause(3000)
})
