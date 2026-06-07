import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { pause, highlight, showDialog, addCursorOverlay } from './helpers.js'
import {
  silentLogin, cpfFestivalId, ORGANISER_EMAIL,
  openRound, closeRound, findApplicationByName, stageDecision,
} from './_setup.js'

// Drag a card (by artist name) into a kanban column. 0=Undecided 1=Shortlisted
// 2=Accept 3=Waitlist 4=Decline.
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
    const col = document.querySelectorAll<HTMLElement>('.grid-cols-5 > div')[idx]
    if (!col) return null
    const r = col.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, colIndex)
  if (!from || !to) throw new Error(`dragCardToColumn: "${artistName}" or column ${colIndex} not found`)
  await page.mouse.move(from.x, from.y)
  await pause(200)
  await page.mouse.down()
  await pause(450)
  await page.mouse.move(to.x, to.y, { steps: 22 })
  await pause(350)
  await page.mouse.up()
  await pause(800)
}

// Staged decisions → bulk release. The three clear "no"s are pre-sorted off-screen
// so the clip focuses on the two hero accepts + the release confirmation.
test('organiser-decisions-release — stage and release decisions', async ({ page }) => {
  await addCursorOverlay(page)
  await silentLogin(page, ORGANISER_EMAIL) // Marcus Webb
  const fid = await cpfFestivalId(page.request)

  // Off-screen: round closed + declines staged for the non-hero applicants, so the
  // board opens ready to make the two accept decisions on camera.
  await openRound(page, fid)
  await closeRound(page, fid)
  for (const name of ['Kit Harrow', 'Tomás Cruz']) {
    await stageDecision(page, fid, await findApplicationByName(page, fid, name), 'decline')
  }

  await page.goto(`/organiser/festivals/${fid}/applications`)
  await expect(page.locator('.grid-cols-5')).toBeVisible({ timeout: 8000 })
  await page.keyboard.press('Home')
  await showDialog(page, 'After the round closes, the organiser stages decisions by dragging cards — nothing is final yet.', { pos: 'bottom' })
  await pause(600)

  await dragCardToColumn(page, 'Rosa Vane', 2)    // Accept (★5)
  await dragCardToColumn(page, 'Amara Diallo', 2) // Accept (★5)

  await expect(page.getByRole('button', { name: /Release \d+ decisions/ })).not.toBeDisabled({ timeout: 4000 })
  await showDialog(page, 'One release sends every accept, waitlist, and decline together — so no one hears early.', { pos: 'bottom' })
  await highlight(page, 'button:has-text("Release")')
  await page.getByRole('button', { name: /Release \d+ decisions/ }).click()
  await expect(page.getByText('Release decisions?')).toBeVisible({ timeout: 5000 })
  await pause(800)
  await page.getByRole('checkbox').check()
  await pause(400)
  await highlight(page, 'button:has-text("Yes, release")')
  await page.getByRole('button', { name: 'Yes, release' }).click()
  await expect(page.getByText('Decisions released')).toBeVisible({ timeout: 8000 })
  await pause(2000)
})
