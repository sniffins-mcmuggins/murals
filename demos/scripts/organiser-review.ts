import { test, expect } from '@playwright/test'
import { pause, highlight, showDialog, addCursorOverlay } from './helpers.js'
import {
  silentLogin, cpfFestivalId, ORGANISER_EMAIL,
  findApplicationByName, stageDecision, releaseDecisions, createSpot, eligibleArtistId, assignArtist,
} from './_setup.js'

// The full organiser application-review story end to end: quick-select triage,
// the review-round lifecycle (open · score · close), then — once decisions are
// released and artists placed — the spot-assignment summary. The longest clip.
test('organiser-review — triage, review round, and placement', async ({ page }) => {
  await addCursorOverlay(page)
  await silentLogin(page, ORGANISER_EMAIL) // Marcus Webb
  const fid = await cpfFestivalId(page.request)

  await page.goto(`/organiser/festivals/${fid}/applications`)
  await expect(page.locator('.grid-cols-5')).toBeVisible({ timeout: 8000 })
  await showDialog(page, 'When applications arrive, the organiser works them on a kanban board.', { pos: 'bottom' })

  // ── Triage ──────────────────────────────────────────────────────────────────
  await showDialog(page, 'Triage mode is a fast first pass — one card at a time, keyboard only.', { pos: 'bottom' })
  await highlight(page, '[data-testid="open-triage"]')
  await page.getByTestId('open-triage').click()
  await expect(page.getByTestId('triage-mode')).toBeVisible({ timeout: 5000 })
  await pause(700)

  // E28: each applicant's shared links show as favicons — hover one to show it's a real link.
  await showDialog(page, 'Each shared link shows as a favicon — hover to see the address, then click straight through.', { pos: 'bottom' })
  const triageLink = page.locator('[data-testid="triage-mode"] [data-testid="shared-links"] a').first()
  await triageLink.scrollIntoViewIfNeeded()
  await triageLink.hover()
  await highlight(page, '[data-testid="triage-mode"] [data-testid="shared-links"] a')
  await pause(1400)

  await showDialog(page, '→ to shortlist, ← to pass — every artist brings a different set of links.')
  await page.keyboard.press('ArrowRight'); await pause(900)
  await page.keyboard.press('ArrowRight'); await pause(900)
  await page.keyboard.press('ArrowLeft'); await pause(900)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('triage-mode')).not.toBeVisible({ timeout: 5000 })
  await pause(800)

  // ── Review round ──────────────────────────────────────────────────────────────
  await showDialog(page, 'Opening a review round invites reviewers to score — and locks decisions until it closes.', { pos: 'bottom' })
  await highlight(page, 'button:has-text("Open review round")')
  await page.getByRole('button', { name: 'Open review round' }).click()
  await expect(page.getByText('Review round')).toContainText('open', { timeout: 5000 })
  await pause(900)

  await showDialog(page, 'Scores go in through the slide-over, with the full application alongside.')
  const card = page.locator('[class*="rounded-lg"]').filter({ hasText: 'Rosa Vane' }).first()
  await card.click()
  await expect(page.getByRole('heading', { name: 'Rosa Vane' })).toBeVisible({ timeout: 5000 })
  await pause(600)

  // E28 M1: the applicant's socials + bio + "view full profile" are pulled live
  // from their profile and shown automatically — the organiser never asked for them.
  await showDialog(page, "The applicant's links and bio show up automatically — pulled live from their profile, never re-typed.", { pos: 'bottom' })
  await highlight(page, '[data-testid="artist-socials"]')
  await pause(900)

  await page.getByRole('button', { name: 'Score 5' }).click()
  await pause(500)
  await page.keyboard.press('Escape')
  await pause(700)

  await showDialog(page, 'Closing the round freezes the scores so decisions can be made fairly.', { pos: 'bottom' })
  await highlight(page, 'button:has-text("Close round")')
  await page.getByRole('button', { name: 'Close round' }).click()
  await expect(page.getByText('Review round closed · scores final')).toBeVisible({ timeout: 5000 })
  await pause(1200)

  // ── Off-screen: decide, release, place a spot ─────────────────────────────────
  // The round is now closed, so decisions can be staged. Accept the two strongest,
  // decline the rest, release, then place and assign a spot — all so the summary
  // below has real data. (The on-camera decision + map flows are their own clips.)
  for (const name of ['Rosa Vane', 'Amara Diallo']) {
    await stageDecision(page, fid, await findApplicationByName(page, fid, name), 'accept')
  }
  for (const name of ['Kit Harrow', 'Tomás Cruz']) {
    await stageDecision(page, fid, await findApplicationByName(page, fid, name), 'decline')
  }
  await releaseDecisions(page, fid)
  const spotId = await createSpot(page, fid, 51.8994, -2.0783)
  await assignArtist(page, fid, spotId, await eligibleArtistId(page, fid, 'Rosa Vane'))

  // ── Spot-assignment summary ───────────────────────────────────────────────────
  await page.goto(`/organiser/festivals/${fid}`)
  await expect(page.getByTestId('spot-assignment-summary')).toBeVisible({ timeout: 8000 })
  await page.getByTestId('spot-assignment-summary').scrollIntoViewIfNeeded()
  await pause(500)
  await showDialog(page, 'Finally, an at-a-glance roll-up: who is placed (✓) and who still needs a wall (⚠).')
  await highlight(page, '[data-testid="spot-assignment-summary"]')
  await pause(2200)
})
