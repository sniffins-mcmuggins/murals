import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { pause, highlight, slowType, addCursorOverlay } from './helpers.js'

// Drag a card (identified by artist name) into a kanban column.
// Column indices: 0=Undecided, 1=Shortlisted, 2=Accept, 3=Waitlist, 4=Decline
async function dragCardToColumn(page: Page, artistName: string, colIndex: number): Promise<void> {
  const from = await page.evaluate((name: string) => {
    const handles = Array.from(document.querySelectorAll<HTMLElement>('button[aria-label="Drag to reorder"]'))
    for (const handle of handles) {
      const card = handle.closest('[class*="rounded-lg"]') ?? handle.parentElement
      if (card?.textContent?.includes(name)) {
        const r = handle.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }
    }
    return null
  }, artistName)

  const to = await page.evaluate((idx: number) => {
    const cols = document.querySelectorAll<HTMLElement>('.grid-cols-5 > div')
    const col = cols[idx]
    if (!col) return null
    const r = col.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, colIndex)

  if (!from || !to) throw new Error(`dragCardToColumn: could not find "${artistName}" or column ${colIndex}`)

  await page.mouse.move(from.x, from.y)
  await pause(200)
  await page.mouse.down()
  await pause(500)
  await page.mouse.move(to.x, to.y, { steps: 25 })
  await pause(350)
  await page.mouse.up()
  await pause(900)
}

// Open the application slide-over by clicking the card, score it, then close.
// showProfileLink=true pauses on the "View full profile" button before scoring.
async function scoreViaSlideOver(page: Page, artistName: string, stars: number, showProfileLink = false): Promise<void> {
  const card = page.locator('[class*="rounded-lg"]').filter({ hasText: artistName }).first()
  await card.click()
  await expect(page.getByRole('heading', { name: artistName })).toBeVisible({ timeout: 5_000 })
  await pause(600)
  if (showProfileLink) {
    await highlight(page, 'a:has-text("View full profile")')
    await pause(1200)
  }
  await page.getByRole('button', { name: `Score ${stars}` }).click()
  await pause(500)
  await page.keyboard.press('Escape')
  await pause(700)
}

// Stage a decision via the slide-over (faster than drag for non-hero moves).
async function stageViaSlideOver(page: Page, artistName: string, decision: 'accept' | 'waitlist' | 'decline'): Promise<void> {
  const card = page.locator('[class*="rounded-lg"]').filter({ hasText: artistName }).first()
  await card.click()
  await expect(page.getByRole('heading', { name: artistName })).toBeVisible({ timeout: 5_000 })
  await pause(600)
  const label = decision === 'accept' ? '✓ Accept' : decision === 'waitlist' ? '~ Waitlist' : '✗ Decline'
  await page.getByRole('button', { name: label }).click()
  await pause(400)
  await page.keyboard.press('Escape')
  await pause(600)
}

test('V06 — Organiser: Review Round + Staged Decisions', async ({ page }) => {
  // Inject amber cursor dot — visible in the recording on every page.
  await addCursorOverlay(page)

  // ── 1. Log in as Marcus Webb ─────────────────────────────────────────────────
  await page.goto('/login')
  await pause(800)
  await slowType(page.locator('#email'), 'marcus@cpf-demo.art')
  await slowType(page.locator('#password'), 'demo-password-2027')
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard', { timeout: 10_000 })
  await pause(1200)

  // ── 2. Navigate to CPF 2027 applications ────────────────────────────────────
  await page.goto('/organiser/festivals')
  await expect(page.getByText('Cheltenham Paint Festival 2027')).toBeVisible({ timeout: 8000 })
  await pause(600)
  await page.getByText('Cheltenham Paint Festival 2027').click()
  await pause(1000)
  const festivalId = page.url().split('/').at(-1)!

  await page.goto(`/organiser/festivals/${festivalId}/applications`)
  await expect(page.locator('.grid-cols-5')).toBeVisible({ timeout: 8000 })
  await page.keyboard.press('Home')
  await pause(1000)

  // ── 3. Open the review round ─────────────────────────────────────────────────
  await expect(page.getByRole('button', { name: 'Open review round' })).toBeVisible()
  await pause(800)
  await highlight(page, 'button:has-text("Open review round")')
  await pause(400)
  await page.getByRole('button', { name: 'Open review round' }).click()
  await expect(page.getByText('Review round')).toContainText('open', { timeout: 5_000 })
  await pause(1200)

  // ── 4. Marcus scores two artists while the round is open ─────────────────────
  // Organiser-role can score at any time — decisions are still locked (no drag handles).
  // On the first card, linger on the profile link so viewers see it.
  await scoreViaSlideOver(page, 'Rosa Vane', 5, true)
  await scoreViaSlideOver(page, 'Amara Diallo', 5)
  await pause(800)

  // ── 5. Close the round ───────────────────────────────────────────────────────
  await highlight(page, 'button:has-text("Close round")')
  await pause(400)
  await page.getByRole('button', { name: 'Close round' }).click()
  await expect(page.getByText('Review round closed · scores final')).toBeVisible({ timeout: 5_000 })
  await pause(1500)

  // ── 6. Make decisions — 3 drags for the hero moves, 1 via slide-over ─────────
  // Rosa and Amara scored highest — drag to Accept for visual impact
  await dragCardToColumn(page, 'Rosa Vane', 2)    // Accept (★ 5)
  await dragCardToColumn(page, 'Amara Diallo', 2) // Accept (★ 5)
  await dragCardToColumn(page, 'Tomás Cruz', 4)   // Decline (★ 2)
  // Kit waitlisted via slide-over
  await stageViaSlideOver(page, 'Kit Harrow', 'waitlist')

  // All 4 staged — Release button should now be enabled
  await expect(page.getByRole('button', { name: /Release 4 decisions/ })).not.toBeDisabled({ timeout: 4000 })
  await pause(1200)

  // ── 7. Release decisions ─────────────────────────────────────────────────────
  await highlight(page, 'button:has-text("Release")')
  await page.getByRole('button', { name: /Release 4 decisions/ }).click()
  await expect(page.getByText('Release decisions?')).toBeVisible({ timeout: 5000 })
  await pause(1500)
  await page.getByRole('checkbox').check()
  await pause(800)
  await highlight(page, 'button:has-text("Yes, release")')
  await page.getByRole('button', { name: 'Yes, release' }).click()
  await expect(page.getByText('Decisions released')).toBeVisible({ timeout: 8000 })
  await pause(1000)
  await page.keyboard.press('End')
  await pause(1500)
  await page.keyboard.press('Home')
  await pause(1200)

  // ── 8. Map editor ─────────────────────────────────────────────────────────────
  await page.goto('/organiser/festivals')
  await pause(600)
  await page.getByRole('link', { name: 'Cheltenham Paint Festival 2027' }).first().click()
  await pause(600)
  await highlight(page, 'a[href*="/map"]')
  await page.getByRole('link', { name: /map/i }).click()
  await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })
  await pause(1000)

  await highlight(page, '[data-testid="geocode-search"] input')
  await slowType(page.getByLabel('Search address'), 'Cheltenham')
  await expect(page.getByTestId('geocode-results')).toBeVisible({ timeout: 5_000 })
  await pause(600)
  await page.getByTestId('geocode-results').getByRole('option').first().click()
  await pause(1200)

  await highlight(page, '[data-testid="add-spot-btn"]')
  await page.getByTestId('add-spot-btn').click()
  await pause(400)
  await page.locator('.leaflet-container').click({ position: { x: 380, y: 280 } })
  await expect(page.getByTestId('spot-panel')).toBeVisible({ timeout: 5_000 })
  await pause(800)

  // ── 8b. Spot panel — external map deep-links (E23.3) ──────────────────────────
  // Clicking the map creates the spot immediately and opens its panel — no form
  // to fill. We just showcase the one-tap navigation links crews use on the day:
  // What3Words / Google Maps / Apple Maps (these fall back to the pin's lat/lng).
  await highlight(page, '[data-testid="link-w3w"]')
  await highlight(page, '[data-testid="link-google"]')
  await highlight(page, '[data-testid="link-apple"]')
  await pause(900)

  const marker = page.locator('.leaflet-marker-icon').last()
  const markerBox = await marker.boundingBox()
  if (markerBox) {
    await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2)
    await pause(300)
    await page.mouse.down()
    await pause(400)
    await page.mouse.move(markerBox.x + markerBox.width / 2 + 30, markerBox.y + markerBox.height / 2 - 20, { steps: 15 })
    await pause(300)
    await page.mouse.up()
    await pause(700)
  }

  await highlight(page, '[data-testid="artist-rail"]')
  await pause(600)
  const artistCard = page.getByTestId('artist-rail').locator('li').first()
  const targetPin = page.locator('.leaflet-marker-icon').last()
  await artistCard.dragTo(targetPin)
  await pause(2000)

  // ── 9. Spot-assignment summary on the festival page (E23.8) ───────────────────
  // Back on the festival overview, the organiser sees an at-a-glance roll-up of
  // which accepted artists have a spot and which are still unassigned.
  await page.goto(`/organiser/festivals/${festivalId}`)
  await expect(page.getByTestId('spot-assignment-summary')).toBeVisible({ timeout: 8000 })
  await page.getByTestId('spot-assignment-summary').scrollIntoViewIfNeeded()
  await pause(600)
  await highlight(page, '[data-testid="spot-assignment-summary"]')
  await pause(2500)
})
