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

  // ── 3. Open applications — 3 cards in Undecided, Release button disabled ─────
  await page.goto(`/organiser/festivals/${festivalId}/applications`)
  await expect(page.locator('.grid-cols-5')).toBeVisible({ timeout: 8000 })
  await pause(1500)

  // Show that Release is disabled + hint text visible
  await page.keyboard.press('End')
  await pause(600)
  await page.keyboard.press('Home')
  await pause(1000)

  // ── 4. Drag Kit Harrow → Accept ──────────────────────────────────────────────
  await dragCardToColumn(page, 'Kit Harrow', 2)

  // ── 5. Drag Yuki Tanaka → Waitlist ───────────────────────────────────────────
  await dragCardToColumn(page, 'Yuki Tanaka', 3)

  // ── 6. Drag Tomás Cruz → Decline — Release button enables ────────────────────
  await dragCardToColumn(page, 'Tomás Cruz', 4)
  // All 3 are staged — Release button should now be enabled
  await expect(page.getByRole('button', { name: /Release 3 decisions/ })).not.toBeDisabled({ timeout: 4000 })
  await pause(1500)

  // ── 7. Open confirmation modal ───────────────────────────────────────────────
  await highlight(page, 'button:has-text("decisions")')
  await page.getByRole('button', { name: /Release 3 decisions/ }).click()
  await expect(page.getByText('Release decisions?')).toBeVisible({ timeout: 5000 })
  await pause(1800)  // let viewer read the modal; "Yes, release" is disabled

  // ── 8. Check the confirmation checkbox ───────────────────────────────────────
  await page.getByRole('checkbox').check()
  await pause(1000)  // "Yes, release" is now enabled

  // ── 9. Confirm — release fires ───────────────────────────────────────────────
  await highlight(page, 'button:has-text("Yes, release")')
  await page.getByRole('button', { name: 'Yes, release' }).click()

  // ── 10. Post-release banner ──────────────────────────────────────────────────
  await expect(page.getByText('Decisions released')).toBeVisible({ timeout: 8000 })
  await pause(1200)

  // Scroll right to show the Accept / Waitlist / Decline columns with "Notified ✓"
  await page.keyboard.press('End')
  await pause(1800)
  await page.keyboard.press('Home')
  await pause(2000)
})
