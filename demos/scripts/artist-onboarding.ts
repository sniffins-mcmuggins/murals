import { test, expect } from '@playwright/test'
import { pause, highlight, slowType, showDialog, addCursorOverlay } from './helpers.js'
import { API, redeemPromo } from './_setup.js'
import * as path from 'path'
import * as fs from 'fs'

const AVATAR = path.join(__dirname, '../fixtures/lady-gabe-portrait.jpg')
const PHOTO1 = path.join(__dirname, '../fixtures/lady-gabe-1.jpg')
const PHOTO2 = path.join(__dirname, '../fixtures/lady-gabe-2.jpg')
const COVER = path.join(__dirname, '../fixtures/lady-gabe-3.jpg')

// The full new-artist onboarding: register, sign in, then a slow, narrated walk
// through the 9-step guided profile wizard ending in a published page. This is
// the one clip that shows auth, and the most thorough of the set (>30s by design).
test('artist-onboarding — sign up and build your page', async ({ page }) => {
  await addCursorOverlay(page)
  for (const f of [AVATAR, PHOTO1, PHOTO2, COVER]) if (!fs.existsSync(f)) throw new Error(`Fixture not found: ${f}`)

  const email = `gabe-${Date.now()}@demo.art`
  const password = 'demo-password-2027'

  // ── Register ────────────────────────────────────────────────────────────────
  await page.goto('/signup')
  await pause(800)
  await showDialog(page, 'New artists join in seconds — just an email and password to get started.')
  await slowType(page.locator('#email'), email)
  await slowType(page.locator('#password'), password)
  await pause(400)
  await highlight(page, 'button[type=submit]')
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible({ timeout: 8000 })
  await showDialog(page, 'We send a verification link to confirm the email address.', { pos: 'bottom' })

  // Verify behind the scenes (the link would arrive by email).
  await page.request.post(`${API}/_test/verify-email`, {
    data: { email }, headers: { 'Content-Type': 'application/json' },
  })

  // ── Sign in ──────────────────────────────────────────────────────────────────
  await page.goto('/login')
  await pause(600)
  await slowType(page.locator('#email'), email)
  await slowType(page.locator('#password'), password)
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard', { timeout: 10000 })
  await pause(800)

  // Grant access off-screen so the wizard's final publish step succeeds.
  await redeemPromo(page)

  // ── Guided profile wizard — slow, narrated walkthrough ────────────────────────
  await page.goto('/profile/setup')
  await expect(page.getByText('Step 1 / 9')).toBeVisible({ timeout: 10000 })
  await showDialog(page, 'The setup wizard builds a polished public page step by step — nothing to design yourself.')

  // Step 1 — name
  await slowType(page.getByPlaceholder('e.g. Lady Gabe'), 'Lady Gabe')
  await pause(500)
  await page.getByRole('button', { name: /continue/i }).click()

  // Step 2 — photos
  await expect(page.getByText('Step 2 / 9')).toBeVisible({ timeout: 8000 })
  await showDialog(page, 'Add a profile picture and a few headline shots — the first thing visitors see.', { pos: 'bottom' })
  await page.locator('input[type=file]').nth(0).setInputFiles(AVATAR)
  await expect(page.getByRole('button', { name: 'Upload Profile pic' }).locator('img')).toBeVisible({ timeout: 30000 })
  await pause(400)
  await page.locator('input[type=file]').nth(1).setInputFiles(PHOTO1)
  await expect(page.getByRole('button', { name: 'Upload Photo 1' }).locator('img')).toBeVisible({ timeout: 30000 })
  await page.locator('input[type=file]').nth(2).setInputFiles(PHOTO2)
  await expect(page.getByRole('button', { name: 'Upload Photo 2' }).locator('img')).toBeVisible({ timeout: 30000 })
  await pause(700)
  await page.getByRole('button', { name: /continue/i }).click()

  // Step 3 — bio
  await expect(page.getByText('Step 3 / 9')).toBeVisible({ timeout: 8000 })
  await showDialog(page, 'Write a short bio in your own voice — quick prompts help if you get stuck.')
  await slowType(page.locator('textarea').first(), 'South-West muralist. Bold colour, mythological themes, outdoor work.')
  await pause(500)
  await page.getByRole('button', { name: /continue/i }).click()

  // Step 4 — location
  await expect(page.getByText('Step 4 / 9')).toBeVisible({ timeout: 8000 })
  await showDialog(page, 'Set a city or region — never an exact address.', { pos: 'bottom' })
  await slowType(page.getByPlaceholder('e.g. Cheltenham, UK'), 'Cheltenham, UK')
  await pause(500)
  await page.getByRole('button', { name: /continue/i }).click()

  // Step 5 — mediums
  await expect(page.getByText('Step 5 / 9')).toBeVisible({ timeout: 8000 })
  await showDialog(page, 'Tag your mediums from the quick-picks, or add your own.')
  await page.getByRole('button', { name: 'mural', exact: true }).click()
  await pause(300)
  await page.getByRole('button', { name: 'painting', exact: true }).click()
  await pause(300)
  await slowType(page.locator('input[aria-label="Add a custom medium"]'), 'spray paint')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await pause(600)
  await page.getByRole('button', { name: /continue/i }).click()

  // Step 6 — social links
  await expect(page.getByText('Step 6 / 9')).toBeVisible({ timeout: 8000 })
  await showDialog(page, 'Link the places people already follow your work.', { pos: 'bottom' })
  await slowType(page.locator('input[aria-label="Instagram"]'), 'https://instagram.com/ladygabeart')
  await pause(500)
  await page.getByRole('button', { name: /continue/i }).click()

  // Step 7 — support link
  await expect(page.getByText('Step 7 / 9')).toBeVisible({ timeout: 8000 })
  await showDialog(page, 'Optionally add a tip or support link so fans can back you.')
  await slowType(page.locator('input[aria-label="Support link"]'), 'https://ko-fi.com/ladygabe')
  await pause(500)
  await page.getByRole('button', { name: /continue/i }).click()

  // Step 8 — first collection
  await expect(page.getByText('Step 8 / 9')).toBeVisible({ timeout: 8000 })
  await showDialog(page, 'Create a first collection with a cover image so the page is never empty.', { pos: 'bottom' })
  await slowType(page.getByPlaceholder('e.g. Cheltenham 2026'), 'Murals 2027')
  await page.locator('input[type=file]').setInputFiles(COVER)
  await expect(page.getByRole('button', { name: 'Upload Cover image' }).locator('img')).toBeVisible({ timeout: 30000 })
  await pause(600)
  await page.getByRole('button', { name: /continue/i }).click()

  // Step 9 — review + publish
  await expect(page.getByText('Step 9 / 9')).toBeVisible({ timeout: 8000 })
  await showDialog(page, 'A quick preview — then one click to go live.')
  await highlight(page, 'button:has-text("Publish")')
  await page.getByRole('button', { name: /publish my page/i }).click()
  await expect(page).toHaveURL('/profile', { timeout: 15000 })
  await showDialog(page, 'Published. The artist now has a live, shareable page.', { pos: 'bottom' })
})
