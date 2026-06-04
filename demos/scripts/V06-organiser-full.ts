import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { pause, highlight, slowType } from './helpers.js'

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

// Reorder within a column: drag one card's handle onto another card (same column).
async function dragCardOntoCard(page: Page, fromName: string, toName: string): Promise<void> {
  const coords = await page.evaluate(({ from, to }: { from: string; to: string }) => {
    const cardOf = (name: string): HTMLElement | null => {
      const handles = Array.from(document.querySelectorAll<HTMLElement>('button[aria-label="Drag to reorder"]'))
      for (const handle of handles) {
        const card = (handle.closest('[class*="rounded-lg"]') ?? handle.parentElement) as HTMLElement | null
        if (card?.textContent?.includes(name)) return card
      }
      return null
    }
    const fromCard = cardOf(from)
    const toCard = cardOf(to)
    if (!fromCard || !toCard) return null
    const fh = fromCard.querySelector<HTMLElement>('button[aria-label="Drag to reorder"]')!.getBoundingClientRect()
    const tr = toCard.getBoundingClientRect()
    return {
      from: { x: fh.left + fh.width / 2, y: fh.top + fh.height / 2 },
      to: { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 },
    }
  }, { from: fromName, to: toName })

  if (!coords) throw new Error(`dragCardOntoCard: could not find "${fromName}" or "${toName}"`)

  await page.mouse.move(coords.from.x, coords.from.y)
  await pause(200)
  await page.mouse.down()
  await pause(500)
  await page.mouse.move(coords.to.x, coords.to.y, { steps: 25 })
  await pause(350)
  await page.mouse.up()
  await pause(900)
}

test('V06 — Organiser: Review Round + Staged Decisions', async ({ page }) => {
  // ── 1. Log in as Marcus Webb ─────────────────────────────────────────────────
  await page.goto('/login')
  await pause(800)
  await slowType(page.locator('#email'), 'marcus@cpf-demo.art')
  await slowType(page.locator('#password'), 'demo-password-2027')
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard', { timeout: 10_000 })
  await pause(1500)

  // ── 2. Navigate to CPF 2027 ──────────────────────────────────────────────────
  await page.goto('/organiser/festivals')
  await expect(page.getByText('Cheltenham Paint Festival 2027')).toBeVisible({ timeout: 8000 })
  await pause(800)
  await page.getByText('Cheltenham Paint Festival 2027').click()
  await pause(1200)
  const festivalId = page.url().split('/').at(-1)!

  // ── 3. Open applications — review round banner visible ───────────────────────
  await page.goto(`/organiser/festivals/${festivalId}/applications`)
  await expect(page.locator('.grid-cols-5')).toBeVisible({ timeout: 8000 })
  await pause(1200)

  // Scroll to show the "Open review round" banner clearly
  await page.keyboard.press('Home')
  await pause(800)
  await expect(page.getByRole('button', { name: 'Open review round' })).toBeVisible()
  await pause(1500)

  // ── 4. Open the review round ─────────────────────────────────────────────────
  await highlight(page, 'button:has-text("Open review round")')
  await pause(600)
  await page.getByRole('button', { name: 'Open review round' }).click()

  // Round opens — decisions are now locked, drag handles disappear
  await expect(page.getByText('Review round')).toContainText('open', { timeout: 5_000 })
  await pause(2000)

  // Show the locked state: no drag handles on cards
  await expect(page.getByLabel('Drag to reorder')).toHaveCount(0)
  await pause(1500)

  // ── 5. Close the round (reviewers have scored) ───────────────────────────────
  // Sophie Park (the invited panellist) has already scored all five artists.
  // Marcus is satisfied — close the round to unlock decisions.
  await highlight(page, 'button:has-text("Close round")')
  await pause(600)
  await page.getByRole('button', { name: 'Close round' }).click()

  // "Review round closed · scores final" banner
  await expect(page.getByText('Review round closed · scores final')).toBeVisible({ timeout: 5_000 })
  await pause(1800)

  // Cards now show ★ average scores — scroll to make them visible
  await expect(page.locator('.grid-cols-5')).toBeVisible()
  await pause(1200)

  // ── 6. Rank candidates within the Undecided column ──────────────────────────
  // High-scoring artists bubble up; drag Rosa (★ 5) and Amara (★ 5) to top.
  await dragCardOntoCard(page, 'Rosa Vane', 'Kit Harrow')
  await pause(600)
  await dragCardOntoCard(page, 'Amara Diallo', 'Yuki Tanaka')
  await pause(1200)

  // ── 7. Make decisions — drag each card to its column ─────────────────────────
  await dragCardToColumn(page, 'Rosa Vane', 2)    // Accept (★ 5, top-ranked)
  await dragCardToColumn(page, 'Amara Diallo', 2) // Accept (★ 5)
  await dragCardToColumn(page, 'Kit Harrow', 3)   // Waitlist (★ 4)
  await dragCardToColumn(page, 'Yuki Tanaka', 3)  // Waitlist (★ 3)
  await dragCardToColumn(page, 'Tomás Cruz', 4)   // Decline  (★ 2)

  // All 5 staged — Release button enabled
  await expect(page.getByRole('button', { name: /Release 5 decisions/ })).not.toBeDisabled({ timeout: 4000 })
  await pause(1500)

  // ── 8. Open confirmation modal ───────────────────────────────────────────────
  await highlight(page, 'button:has-text("decisions")')
  await page.getByRole('button', { name: /Release 5 decisions/ }).click()
  await expect(page.getByText('Release decisions?')).toBeVisible({ timeout: 5000 })
  await pause(1800)

  // ── 9. Check the confirmation checkbox ───────────────────────────────────────
  await page.getByRole('checkbox').check()
  await pause(1000)

  // ── 10. Release fires ────────────────────────────────────────────────────────
  await highlight(page, 'button:has-text("Yes, release")')
  await page.getByRole('button', { name: 'Yes, release' }).click()

  // ── 11. Post-release banner ───────────────────────────────────────────────────
  await expect(page.getByText('Decisions released')).toBeVisible({ timeout: 8000 })
  await pause(1200)

  // Scroll to show Accept / Waitlist / Decline columns with "Notified ✓"
  await page.keyboard.press('End')
  await pause(1800)
  await page.keyboard.press('Home')
  await pause(2000)

  // ── 12. Navigate to map editor ────────────────────────────────────────────────
  await page.goto('/organiser/festivals')
  await pause(800)
  await page.getByRole('link', { name: 'Cheltenham Paint Festival 2027' }).first().click()
  await pause(800)
  await highlight(page, 'a[href*="/map"]')
  await page.getByRole('link', { name: /map/i }).click()
  await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })
  await pause(1200)

  // ── 13. Search to recentre on Cheltenham ──────────────────────────────────────
  await highlight(page, '[data-testid="geocode-search"] input')
  await slowType(page.getByLabel('Search address'), 'Cheltenham')
  await expect(page.getByTestId('geocode-results')).toBeVisible({ timeout: 5_000 })
  await pause(800)
  await page.getByTestId('geocode-results').getByRole('option').first().click()
  await pause(1500)

  // ── 14. Place a spot by clicking the map ──────────────────────────────────────
  await highlight(page, '[data-testid="add-spot-btn"]')
  await page.getByTestId('add-spot-btn').click()
  await pause(600)
  await page.locator('.leaflet-container').click({ position: { x: 380, y: 280 } })
  await expect(page.getByTestId('spot-panel')).toBeVisible({ timeout: 5_000 })
  await pause(1000)

  // ── 15. Drag to fine-tune position ────────────────────────────────────────────
  const marker = page.locator('.leaflet-marker-icon').last()
  const markerBox = await marker.boundingBox()
  if (markerBox) {
    await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2)
    await pause(400)
    await page.mouse.down()
    await pause(500)
    await page.mouse.move(
      markerBox.x + markerBox.width / 2 + 30,
      markerBox.y + markerBox.height / 2 - 20,
      { steps: 15 },
    )
    await pause(400)
    await page.mouse.up()
    await pause(900)
  }

  // ── 16. Drag an accepted artist from the rail onto the pin ────────────────────
  await highlight(page, '[data-testid="artist-rail"]')
  await pause(800)
  const artistCard = page.getByTestId('artist-rail').locator('li').first()
  const targetPin = page.locator('.leaflet-marker-icon').last()
  await artistCard.dragTo(targetPin)
  await pause(1500)

  // ── 17. Show the external map links ───────────────────────────────────────────
  await highlight(page, '[data-testid="link-w3w"]')
  await pause(1200)
  await highlight(page, '[data-testid="link-google"]')
  await pause(2000)
})
