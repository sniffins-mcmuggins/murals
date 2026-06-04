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
// Dropping over a card in the same column triggers a rank reorder, not a decision.
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

test('V06 — Organiser: Staged Decisions', async ({ page }) => {
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

  // ── 3. Open applications — 5 cards in Undecided, Release button disabled ─────
  await page.goto(`/organiser/festivals/${festivalId}/applications`)
  await expect(page.locator('.grid-cols-5')).toBeVisible({ timeout: 8000 })
  await pause(1500)

  // Show that Release is disabled + "still need a decision" hint visible
  await page.keyboard.press('End')
  await pause(600)
  await page.keyboard.press('Home')
  await pause(1200)

  // ── 4. Rank candidates within the Undecided column before deciding ───────────
  // Drag a strong candidate up to the top of the pile, then a second one up.
  await dragCardOntoCard(page, 'Rosa Vane', 'Kit Harrow')
  await pause(600)
  await dragCardOntoCard(page, 'Amara Diallo', 'Yuki Tanaka')
  await pause(1200)

  // ── 5. Make decisions — drag each card to its column ─────────────────────────
  await dragCardToColumn(page, 'Rosa Vane', 2)   // Accept (top-ranked)
  await dragCardToColumn(page, 'Kit Harrow', 2)  // Accept
  await dragCardToColumn(page, 'Amara Diallo', 3) // Waitlist
  await dragCardToColumn(page, 'Yuki Tanaka', 3)  // Waitlist
  await dragCardToColumn(page, 'Tomás Cruz', 4)   // Decline

  // All 5 are staged — Release button should now be enabled
  await expect(page.getByRole('button', { name: /Release 5 decisions/ })).not.toBeDisabled({ timeout: 4000 })
  await pause(1500)

  // ── 6. Open confirmation modal ───────────────────────────────────────────────
  await highlight(page, 'button:has-text("decisions")')
  await page.getByRole('button', { name: /Release 5 decisions/ }).click()
  await expect(page.getByText('Release decisions?')).toBeVisible({ timeout: 5000 })
  await pause(1800)  // let viewer read the modal; "Yes, release" is disabled

  // ── 7. Check the confirmation checkbox ───────────────────────────────────────
  await page.getByRole('checkbox').check()
  await pause(1000)  // "Yes, release" is now enabled

  // ── 8. Confirm — release fires ───────────────────────────────────────────────
  await highlight(page, 'button:has-text("Yes, release")')
  await page.getByRole('button', { name: 'Yes, release' }).click()

  // ── 9. Post-release banner ───────────────────────────────────────────────────
  await expect(page.getByText('Decisions released')).toBeVisible({ timeout: 8000 })
  await pause(1200)

  // Scroll right to show the Accept / Waitlist / Decline columns with "Notified ✓"
  await page.keyboard.press('End')
  await pause(1800)
  await page.keyboard.press('Home')
  await pause(2000)

    // ── 10. Navigate to map editor ────────────────────────────────────────────
    // Click through to the festival dashboard then the Map Editor link
    await page.goto('/organiser/festivals')
    await pause(800)
    await page.getByRole('link', { name: 'Cheltenham Paint Festival 2027' }).first().click()
    await pause(800)
    await highlight(page, 'a[href*="/map"]')
    await page.getByRole('link', { name: /map/i }).click()
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })
    await pause(1200)

    // ── 11. Search to recentre on Cheltenham ──────────────────────────────────
    await highlight(page, '[data-testid="geocode-search"] input')
    await slowType(page.getByLabel('Search address'), 'Cheltenham')
    await expect(page.getByTestId('geocode-results')).toBeVisible({ timeout: 5_000 })
    await pause(800)
    await page.getByTestId('geocode-results').getByRole('option').first().click()
    await pause(1500)

    // ── 12. Place a spot by clicking the map ──────────────────────────────────
    await highlight(page, '[data-testid="add-spot-btn"]')
    await page.getByTestId('add-spot-btn').click()
    await pause(600)
    await page.locator('.leaflet-container').click({ position: { x: 380, y: 280 } })
    await expect(page.getByTestId('spot-panel')).toBeVisible({ timeout: 5_000 })
    await pause(1000)

    // ── 13. Drag to fine-tune position ────────────────────────────────────────
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

    // ── 14. Assign an accepted artist to the spot ─────────────────────────────
    await highlight(page, '[data-testid="spot-panel"] select')
    await page.getByTestId('spot-panel').getByRole('combobox').selectOption({ index: 1 })
    await pause(600)
    await highlight(page, '[data-testid="spot-panel"] button:has-text("Save")')
    await page.getByTestId('spot-panel').getByRole('button', { name: 'Save' }).click()
    await expect(
      page.getByTestId('spot-panel').getByRole('button', { name: 'Save' }),
    ).toBeEnabled({ timeout: 5_000 })
    await pause(1500)

    // ── 15. Show the external map links ──────────────────────────────────────
    await highlight(page, '[data-testid="link-w3w"]')
    await pause(1200)
    await highlight(page, '[data-testid="link-google"]')
    await pause(1200)

    // ── 16. Public map — artist appears on the spot ───────────────────────────
    // (Festival must be live — seed sets it to open; navigate to simulate the view)
    // Navigate to the public festival page if it's live, otherwise show the map editor result
    await pause(2000)
  })
